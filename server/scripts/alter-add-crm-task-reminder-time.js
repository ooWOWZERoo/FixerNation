require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Customer Hub follow-up to G14: a time of day on a task's reminder, and the separate reminder email at that time. Two columns on crm_tasks (the time and the time zone it is in) and one small
// table that records each reminder email claimed (so none is sent twice). Idempotent; safe to re-run. Run it BEFORE restarting the Node app: until it has run, tasks and their remind-me DATES
// work as before, saving a task with a time simply leaves the time out, and no reminder email can be sent. Additive only: nothing is dropped, renamed or rewritten.
//
//   node scripts/alter-add-crm-task-reminder-time.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  const hasColumn = async (t, c) => (await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, t, c]))[0].length > 0;
  for (const t of ['crm_tasks', 'admin_users']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
  }
  if (!(await hasColumn('crm_tasks', 'remind_on'))) { console.error('Stopped: crm_tasks.remind_on is not there. Run alter-add-crm-task-note-fields.js first. Nothing was changed.'); process.exit(1); }
  for (const [col, ddl] of [['remind_time', 'TIME NULL'], ['remind_tz', 'VARCHAR(64) NULL']]) {
    if (await hasColumn('crm_tasks', col)) { console.log(`Skipped: crm_tasks.${col} already exists.`); continue; }
    try { await db.query(`ALTER TABLE crm_tasks ADD COLUMN ${col} ${ddl}`); console.log(`Added crm_tasks.${col}.`); }
    catch (err) { if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: crm_tasks.${col} already exists.`); else throw err; }
  }
  if (await hasTable('crm_task_reminder_sends')) console.log('Skipped: crm_task_reminder_sends already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_task_reminder_sends (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      task_id INT UNSIGNED NOT NULL,
      fire_at DATETIME NOT NULL,
      owner_admin_id INT UNSIGNED NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'claimed',
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 1,
      claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME NULL,
      UNIQUE KEY uq_crm_task_reminder (task_id, fire_at),
      KEY idx_crm_task_reminder_status (status, claimed_at),
      CONSTRAINT fk_crm_task_reminder_task FOREIGN KEY (task_id) REFERENCES crm_tasks (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_task_reminder_admin FOREIGN KEY (owner_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_task_reminder_sends.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
