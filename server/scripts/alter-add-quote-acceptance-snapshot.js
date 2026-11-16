require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list S10. Idempotent; safe to re-run. Run it BEFORE restarting the Node app (the app tolerates the column being absent, but it stores the proof
// only once the column exists). Additive: nothing is dropped or changed.
//
//   node scripts/alter-add-quote-acceptance-snapshot.js
//
// Adds quote_requests.acceptance_document_snapshot: the exact text the buyer was shown when they accepted (the same text the stored SHA-256 is computed from), so a later
// price edit can be disproved from the database instead of only detected. Quotes accepted before this script ran keep a hash only.

const STEPS = [{ table: 'quote_requests', name: 'acceptance_document_snapshot', ddl: 'ADD COLUMN acceptance_document_snapshot MEDIUMTEXT NULL' }];

async function ensure(db, schema, log = console.log) {
  const done = { added: [], skipped: [] };
  for (const s of STEPS) {
    const [rows] = await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, s.table, s.name]);
    if (rows.length) { log(`Skipped: ${s.table}.${s.name} already exists.`); done.skipped.push(s.name); continue; }
    try { await db.query(`ALTER TABLE ${s.table} ${s.ddl}`); log(`Added ${s.table}.${s.name}.`); done.added.push(s.name); }
    catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      log(`Skipped: ${s.table}.${s.name} already exists.`); done.skipped.push(s.name);
    }
  }
  return done;
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try { await ensure(db, process.env.DB_NAME); } finally { await db.end(); }
}

module.exports = { STEPS, ensure };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
