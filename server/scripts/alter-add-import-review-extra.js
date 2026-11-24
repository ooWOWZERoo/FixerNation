require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Contact screens merge, phase 5: the merged importer also reads a street, city, ZIP, signup date, source, notes and email groups. A row that has to wait in Import review keeps those
// in one new text column, crm_import_review.extra_json, so deciding it later still has them. One column, additive only: nothing is dropped, renamed or rewritten, and rows already waiting
// simply have none. Idempotent; safe to re-run. Run it BEFORE restarting the Node app: until it has run, imports still work and a queued row just waits without its extras.
//
//   node scripts/alter-add-import-review-extra.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  const hasColumn = async (t, c) => (await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, t, c]))[0].length > 0;
  if (!(await hasTable('crm_import_review'))) { console.error('Stopped: crm_import_review does not exist here. Run alter-create-crm-import.js first. Nothing was changed.'); process.exit(1); }
  if (await hasColumn('crm_import_review', 'extra_json')) console.log('Skipped: crm_import_review.extra_json already exists.');
  else {
    try { await db.query('ALTER TABLE crm_import_review ADD COLUMN extra_json TEXT NULL'); console.log('Added crm_import_review.extra_json.'); }
    catch (err) { if (err.code === 'ER_DUP_FIELDNAME') console.log('Skipped: crm_import_review.extra_json already exists.'); else throw err; }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
