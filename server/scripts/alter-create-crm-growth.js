require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM update, phase 6 (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec"): the renewal and expansion generator's unique key and the
// first and latest touch ("how they found us") on contacts. Idempotent; safe to re-run. Run it BEFORE restarting the Node app (the public forms and the contact
// page read and write the attribution columns, and the renewal script refuses to run without its key column).
// Everything is additive: no existing column, status or row is changed or removed, and no data is back-filled (a contact's first touch is never guessed).
//
//   node scripts/alter-create-crm-growth.js
//
// Adds to crm_opportunities:      generated_key VARCHAR(64) NULL, with a UNIQUE index. NULL for deals people make; 'crm.purchase.renewal_due:<purchaseId>' or
//                                 'crm.purchase.expansion_due:<purchaseId>' for a deal the renewal script made, so it can never make the same one twice.
// Adds to newsletter_contacts:    first_touch_source, _medium, _campaign, _landing, _at and the same five as latest_touch_*, plus an index on first_touch_source.

const TOUCH = [['source', 'VARCHAR(100) NULL'], ['medium', 'VARCHAR(100) NULL'], ['campaign', 'VARCHAR(100) NULL'], ['landing', 'VARCHAR(255) NULL'], ['at', 'DATETIME NULL']];
const COLUMNS = [['crm_opportunities', 'generated_key', 'VARCHAR(64) NULL']];
for (const which of ['first', 'latest']) for (const [name, def] of TOUCH) COLUMNS.push(['newsletter_contacts', `${which}_touch_${name}`, def]);

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const has = async (sql, ...p) => (await db.query(sql, p))[0].length > 0;
  const hasTable = t => has('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', schema, t);
  const hasColumn = (t, c) => has('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', schema, t, c);
  const hasIndex = (t, i) => has('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?', schema, t, i);

  for (const t of ['newsletter_contacts', 'crm_opportunities']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here (run scripts/alter-create-crm-core.js first). Nothing was changed.`); process.exit(1); }
  }
  for (const [table, column, def] of COLUMNS) {
    if (await hasColumn(table, column)) { console.log(`Skipped: ${table}.${column} already exists.`); continue; }
    try { await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); console.log(`Added ${table}.${column}.`); }
    catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; console.log(`Skipped: ${table}.${column} already exists.`); }
  }
  for (const [table, name, ddl] of [
    ['crm_opportunities', 'uq_crm_opp_generated_key', 'ADD UNIQUE KEY uq_crm_opp_generated_key (generated_key)'],
    ['newsletter_contacts', 'idx_contacts_first_touch_source', 'ADD KEY idx_contacts_first_touch_source (first_touch_source)'],
  ]) {
    if (await hasIndex(table, name)) { console.log(`Skipped: ${table}.${name} already exists.`); continue; }
    try { await db.query(`ALTER TABLE ${table} ${ddl}`); console.log(`Added ${table}.${name}.`); }
    catch (err) { if (err.code !== 'ER_DUP_KEYNAME') throw err; console.log(`Skipped: ${table}.${name} already exists.`); }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
