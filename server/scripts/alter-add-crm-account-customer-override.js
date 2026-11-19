require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Customer Hub follow-up F13: a CRM Admin can mark a school or district account a Customer by hand (with a reason and the evidence), like the hand-set label on a person. Five small columns on
// crm_accounts hold it. Idempotent; safe to re-run. Run it BEFORE restarting the Node app: until it has run, accounts and their labels work exactly as before and the "Mark as Customer
// (hand-set)" button says it is not available yet. Additive only: nothing is dropped, renamed or rewritten.
//
//   node scripts/alter-add-crm-account-customer-override.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  const hasColumn = async (t, c) => (await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, t, c]))[0].length > 0;
  if (!(await hasTable('crm_accounts'))) { console.error('Stopped: crm_accounts does not exist here. Run the Customer Hub setup first. Nothing was changed.'); process.exit(1); }
  for (const [col, ddl] of [['label_override', 'VARCHAR(12) NULL'], ['label_override_reason', 'VARCHAR(120) NULL'], ['label_override_evidence', 'VARCHAR(120) NULL'], ['label_override_by_admin_id', 'INT UNSIGNED NULL'], ['label_override_at', 'DATETIME NULL']]) {
    if (await hasColumn('crm_accounts', col)) { console.log(`Skipped: crm_accounts.${col} already exists.`); continue; }
    try { await db.query(`ALTER TABLE crm_accounts ADD COLUMN ${col} ${ddl}`); console.log(`Added crm_accounts.${col}.`); }
    catch (err) { if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: crm_accounts.${col} already exists.`); else throw err; }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
