require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G20: the record of which quotes the daily job has already made a follow-up task for, so a quote gets at most one task, ever.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app and before the daily job runs with the new code (the job skips this step, and says so, while the table is missing).
// Everything is additive: no existing table, column or row is changed, and nothing is back-filled.
//
//   node scripts/alter-create-crm-quote-followups.js
//
// Creates crm_quote_followup_tasks (quote_id, task_id), unique on quote_id. Deleting a quote removes its row; deleting a task clears task_id but keeps the row, so a task
// someone deleted on purpose is not made again.

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['quote_requests', 'crm_tasks']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here (run scripts/alter-create-crm-execution.js first). Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_quote_followup_tasks')) console.log('Skipped: crm_quote_followup_tasks already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_quote_followup_tasks (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      quote_id INT UNSIGNED NOT NULL,
      task_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_quote_followup (quote_id),
      KEY idx_crm_quote_followup_task (task_id),
      CONSTRAINT fk_crm_quote_followup_quote FOREIGN KEY (quote_id) REFERENCES quote_requests (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_quote_followup_task FOREIGN KEY (task_id) REFERENCES crm_tasks (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_quote_followup_tasks.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
