require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G3 (FR-TRIAL-03): the record of which trial review tasks the daily job has already made, so a trial gets at most one task per reason, ever.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app and before the daily job runs with the new code (the job skips this step, and says so, while the table is missing).
// Everything is additive: no existing table, column or row is changed, and nothing is back-filled.
//
//   node scripts/alter-create-crm-trial-review-tasks.js
//
// Creates crm_trial_review_tasks (purchase_id, reason, task_id), unique on (purchase_id, reason). Deleting a purchase removes its rows; deleting a task clears task_id but keeps the
// row, so a task someone deleted on purpose is not made again.

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['purchases', 'crm_tasks']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here (run scripts/alter-create-crm-execution.js first). Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_trial_review_tasks')) console.log('Skipped: crm_trial_review_tasks already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_trial_review_tasks (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      purchase_id INT UNSIGNED NOT NULL,
      reason VARCHAR(16) NOT NULL,
      task_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_trial_review (purchase_id, reason),
      KEY idx_crm_trial_review_task (task_id),
      CONSTRAINT fk_crm_trial_review_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_trial_review_task FOREIGN KEY (task_id) REFERENCES crm_tasks (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_trial_review_tasks.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
