// Adds Bill To and Ship To address columns (Release 97):
//   invoices            bill_to_* (+ bill_to_saved_at: NULL means "still read Bill To from the CRM contact, as before") and ship_to_*
//   quote_requests      bill_to_street/city/state/zip and ship_to_* (the quote builder's address fields)
//   newsletter_contacts ship_to_* (the contact's optional shipping address; its existing address stays the Bill To address)
// Every column is added only if it is missing, so it is safe to re-run. Run it BEFORE restarting the Node app: the new code reads
// and writes these columns. Existing rows are not touched.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const SHIP = [
  ['ship_to_name', 'VARCHAR(255) NULL'], ['ship_to_company', 'VARCHAR(255) NULL'], ['ship_to_street', 'VARCHAR(255) NULL'],
  ['ship_to_city', 'VARCHAR(128) NULL'], ['ship_to_state', 'VARCHAR(64) NULL'], ['ship_to_zip', 'VARCHAR(32) NULL'],
];
const BILL_ADDRESS = [
  ['bill_to_street', 'VARCHAR(255) NULL'], ['bill_to_city', 'VARCHAR(128) NULL'], ['bill_to_state', 'VARCHAR(64) NULL'], ['bill_to_zip', 'VARCHAR(32) NULL'],
];
const PLAN = {
  invoices: [
    ['bill_to_name', 'VARCHAR(255) NULL'], ['bill_to_company', 'VARCHAR(255) NULL'], ['bill_to_email', 'VARCHAR(255) NULL'],
    ...BILL_ADDRESS, ['bill_to_saved_at', 'DATETIME NULL'], ...SHIP,
  ],
  quote_requests: [...BILL_ADDRESS, ...SHIP],
  newsletter_contacts: [...SHIP],
};

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  for (const [table, columns] of Object.entries(PLAN)) {
    const [have] = await conn.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, table]
    );
    const existing = new Set(have.map((r) => r.COLUMN_NAME));
    for (const [name, type] of columns) {
      if (existing.has(name)) { console.log(`Skipped (already exists): ${table}.${name}`); continue; }
      try {
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${type}`);
        console.log(`Added column: ${table}.${name}`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
        console.log(`Skipped (already exists): ${table}.${name}`);
      }
    }
  }
  await conn.end();
  console.log('Done.');
}

main().catch((err) => { console.error('alter-add-bill-ship-to failed:', err.message); process.exit(1); });
