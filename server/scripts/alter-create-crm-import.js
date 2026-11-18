require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G22 (FR-CON-05): the prospect import. Two small tables: one row per import run (so staff can see what an import did) and the review queue of rows that look like
// someone who is already in the CRM. Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the Import people button and the Import review tab need them (both say "not
// available yet" until then). Additive only: no existing table, column or row is changed.
//
//   node scripts/alter-create-crm-import.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['newsletter_contacts', 'admin_users']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_import_batches')) console.log('Skipped: crm_import_batches already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_import_batches (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      total_rows INT UNSIGNED NOT NULL DEFAULT 0,
      added INT UNSIGNED NOT NULL DEFAULT 0,
      already_there INT UNSIGNED NOT NULL DEFAULT 0,
      queued INT UNSIGNED NOT NULL DEFAULT 0,
      left_out INT UNSIGNED NOT NULL DEFAULT 0,
      created_by_admin_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_crm_import_batches_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_import_batches.');
  }
  if (await hasTable('crm_import_review')) console.log('Skipped: crm_import_review already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_import_review (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      batch_id INT UNSIGNED NOT NULL,
      name VARCHAR(255) NULL,
      email VARCHAR(254) NOT NULL,
      company VARCHAR(255) NULL,
      state_text VARCHAR(64) NULL,
      phone VARCHAR(32) NULL,
      title VARCHAR(128) NULL,
      account_id INT UNSIGNED NULL,
      reason VARCHAR(16) NOT NULL,
      candidates_json TEXT NOT NULL,
      state VARCHAR(16) NOT NULL DEFAULT 'waiting',
      resolved_contact_id INT UNSIGNED NULL,
      decided_by_admin_id INT UNSIGNED NULL,
      decided_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_crm_import_review_state (state, id),
      KEY idx_crm_import_review_batch (batch_id),
      CONSTRAINT fk_crm_import_review_batch FOREIGN KEY (batch_id) REFERENCES crm_import_batches (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_import_review.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
