require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G13 (QUOTE-03): a quote can be DECLINED, by the customer on the accept page or by staff on the customer's behalf. Three optional columns on quote_requests.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the accept page, the Needs Attention rules and the quote follow-up job now read declined_at.
// Additive only: no row is changed.
//
//   node scripts/alter-add-quote-decline.js

const COLUMNS = [
  ['declined_at', 'DATETIME NULL'],
  ['declined_by', 'VARCHAR(12) NULL'],
  ['decline_reason', 'VARCHAR(500) NULL'],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const [[t]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, 'quote_requests']);
  if (!Number(t.n)) { console.error('Stopped: quote_requests does not exist here. Nothing was changed.'); process.exit(1); }
  for (const [name, ddl] of COLUMNS) {
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, 'quote_requests', name]);
    if (Number(c.n)) { console.log(`Skipped: quote_requests.${name} already exists.`); continue; }
    try {
      await db.query(`ALTER TABLE quote_requests ADD COLUMN ${name} ${ddl}`);
      console.log(`Added quote_requests.${name}.`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: quote_requests.${name} already exists.`);
      else throw err;
    }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
