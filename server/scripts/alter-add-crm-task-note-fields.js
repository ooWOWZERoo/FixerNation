require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G14 (ACT-01, ACT-02): more on a task (priority, where it came from, a remind-me date, the quote it is about) and a history for edited notes.
//   crm_tasks:  priority (low | normal | high, default normal), source (manual | daily_check | request, default manual), remind_on (a date), quote_id (a quote on the task's deal)
//   crm_notes:  edited_at, edited_by_admin_id
//   crm_note_versions: the text a note had before each edit (deleting a note deletes its versions)
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the task and note screens and the daily check read these columns. Additive only: no row is changed.
//
//   node scripts/alter-add-crm-task-note-fields.js

const COLUMNS = [
  ['crm_tasks', 'priority', "VARCHAR(6) NOT NULL DEFAULT 'normal'"],
  ['crm_tasks', 'source', "VARCHAR(16) NOT NULL DEFAULT 'manual'"],
  ['crm_tasks', 'remind_on', 'DATE NULL'],
  ['crm_tasks', 'quote_id', 'INT UNSIGNED NULL'],
  ['crm_notes', 'edited_at', 'DATETIME NULL'],
  ['crm_notes', 'edited_by_admin_id', 'INT UNSIGNED NULL'],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['crm_tasks', 'crm_notes']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here (run scripts/alter-create-crm-execution.js first). Nothing was changed.`); process.exit(1); }
  }
  for (const [table, name, ddl] of COLUMNS) {
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, table, name]);
    if (Number(c.n)) { console.log(`Skipped: ${table}.${name} already exists.`); continue; }
    try { await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); console.log(`Added ${table}.${name}.`); }
    catch (err) { if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: ${table}.${name} already exists.`); else throw err; }
  }
  if (await hasTable('crm_note_versions')) console.log('Skipped: crm_note_versions already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_note_versions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      note_id INT UNSIGNED NOT NULL,
      body TEXT NOT NULL,
      kind VARCHAR(8) NULL,
      changed_by_admin_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_crm_note_versions_note (note_id, created_at),
      CONSTRAINT fk_crm_note_versions_note FOREIGN KEY (note_id) REFERENCES crm_notes (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_note_versions.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
