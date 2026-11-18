require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Customer Hub follow-up to G22: undo a prospect import. One small table listing who each import CREATED (so only those people can ever be removed), and four columns on
// crm_import_batches that say an import was undone, by whom, and how many people went and stayed. Idempotent; safe to re-run. Run it BEFORE restarting the Node app: until it has run,
// imports and the batch list work as before, and the Undo button says it is not available yet. Additive only: nothing is dropped, renamed or rewritten, and imports made before this
// have no list of who they created, so they can never be undone (there is no guessing).
//
//   node scripts/alter-add-crm-import-undo.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  const hasColumn = async (t, c) => (await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, t, c]))[0].length > 0;
  if (!(await hasTable('crm_import_batches'))) { console.error('Stopped: crm_import_batches does not exist here. Run alter-create-crm-import.js first. Nothing was changed.'); process.exit(1); }
  for (const [col, ddl] of [['undone_at', 'DATETIME NULL'], ['undone_by_admin_id', 'INT UNSIGNED NULL'], ['undo_removed', 'INT UNSIGNED NULL'], ['undo_kept', 'INT UNSIGNED NULL']]) {
    if (await hasColumn('crm_import_batches', col)) { console.log(`Skipped: crm_import_batches.${col} already exists.`); continue; }
    try { await db.query(`ALTER TABLE crm_import_batches ADD COLUMN ${col} ${ddl}`); console.log(`Added crm_import_batches.${col}.`); }
    catch (err) { if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: crm_import_batches.${col} already exists.`); else throw err; }
  }
  if (await hasTable('crm_import_people')) console.log('Skipped: crm_import_people already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_import_people (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      batch_id INT UNSIGNED NOT NULL,
      contact_id INT UNSIGNED NOT NULL,
      email_norm VARCHAR(254) NOT NULL,
      account_id INT UNSIGNED NULL,
      via_review_id INT UNSIGNED NULL,
      snapshot_json TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_crm_import_people_batch (batch_id),
      KEY idx_crm_import_people_contact (contact_id),
      CONSTRAINT fk_crm_import_people_batch FOREIGN KEY (batch_id) REFERENCES crm_import_batches (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_import_people.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
