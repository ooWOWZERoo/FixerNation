require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM update, phase 4b (docs/reference/sales-crm-update-requirements.md, "4b to 4d spec"): quote revisions, acceptance evidence and the quote event log.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app (the accept page, the quote routes and the webhook now read and write these columns).
// Everything is additive: no existing column, status or row is changed or removed.
//
//   node scripts/alter-create-crm-quotes.js
//
// Adds to quote_requests:  revision_number (default 1), supersedes_quote_id (self link, SET NULL), version_status ('current' | 'superseded'),
//                          created_by_admin_id, and the acceptance evidence: acceptance_name, acceptance_title, acceptance_terms_version,
//                          acceptance_document_hash, acceptance_recorded_at, acceptance_recorded_by ('buyer' | 'staff')
// Creates:                 crm_quote_events (created, sent, superseded, accepted, page_opened)
// Adds to purchases:       an index on quote_id and, ONLY if no purchase points at a quote that does not exist, a foreign key to quote_requests(id) ON DELETE SET NULL
//                          (never cascade: deleting a quote must not delete a purchase). With orphans it lists their ids, skips the key and says so.

const COLUMNS = [
  ['quote_requests', 'revision_number', 'INT UNSIGNED NOT NULL DEFAULT 1'],
  ['quote_requests', 'supersedes_quote_id', 'INT UNSIGNED NULL'],
  ['quote_requests', 'version_status', "VARCHAR(16) NOT NULL DEFAULT 'current'"],
  ['quote_requests', 'created_by_admin_id', 'INT UNSIGNED NULL'],
  ['quote_requests', 'acceptance_name', 'VARCHAR(255) NULL'],
  ['quote_requests', 'acceptance_title', 'VARCHAR(255) NULL'],
  ['quote_requests', 'acceptance_terms_version', 'VARCHAR(32) NULL'],
  ['quote_requests', 'acceptance_document_hash', 'CHAR(64) NULL'],
  ['quote_requests', 'acceptance_recorded_at', 'DATETIME NULL'],
  ['quote_requests', 'acceptance_recorded_by', 'VARCHAR(16) NULL'],
];

const EVENTS_DDL = `CREATE TABLE crm_quote_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    quote_id INT UNSIGNED NOT NULL,
    opportunity_id INT UNSIGNED NULL,
    event_type VARCHAR(16) NOT NULL,
    detail VARCHAR(255) NULL,
    actor_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crm_quote_events_quote (quote_id, created_at),
    KEY idx_crm_quote_events_deal (opportunity_id, created_at),
    CONSTRAINT fk_crm_quote_events_quote FOREIGN KEY (quote_id) REFERENCES quote_requests (id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_quote_events_admin FOREIGN KEY (actor_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

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
  const hasConstraint = (t, c) => has("SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?", schema, t, c);

  for (const t of ['admin_users', 'quote_requests', 'purchases']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
  }
  if (!(await hasTable('crm_opportunities'))) { console.error('Stopped: run scripts/alter-create-crm-core.js first (phase 1). Nothing was changed.'); process.exit(1); }

  for (const [table, column, def] of COLUMNS) {
    if (await hasColumn(table, column)) { console.log(`Skipped: ${table}.${column} already exists.`); continue; }
    try { await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); console.log(`Added ${table}.${column}.`); }
    catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; console.log(`Skipped: ${table}.${column} already exists.`); }
  }

  const links = [
    ['idx_quote_requests_supersedes', 'KEY', 'ADD KEY idx_quote_requests_supersedes (supersedes_quote_id)'],
    ['fk_quote_requests_supersedes', 'FK', 'ADD CONSTRAINT fk_quote_requests_supersedes FOREIGN KEY (supersedes_quote_id) REFERENCES quote_requests (id) ON DELETE SET NULL'],
    ['fk_quote_requests_created_by', 'FK', 'ADD CONSTRAINT fk_quote_requests_created_by FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL'],
  ];
  for (const [name, kind, ddl] of links) {
    const exists = kind === 'KEY' ? await hasIndex('quote_requests', name) : await hasConstraint('quote_requests', name);
    if (exists) { console.log(`Skipped: quote_requests ${name} already exists.`); continue; }
    try { await db.query(`ALTER TABLE quote_requests ${ddl}`); console.log(`Added ${name}.`); }
    catch (err) { if (!['ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_CANT_CREATE_TABLE'].includes(err.code)) throw err; console.log(`Skipped: ${name} (${err.code}).`); }
  }

  if (await hasTable('crm_quote_events')) console.log('Skipped: crm_quote_events already exists.');
  else { await db.query(EVENTS_DDL); console.log('Created crm_quote_events.'); }

  // purchases.quote_id: index always; foreign key only when nothing is orphaned.
  if (!(await hasIndex('purchases', 'idx_purchases_quote'))) {
    try { await db.query('ALTER TABLE purchases ADD KEY idx_purchases_quote (quote_id)'); console.log('Added purchases.idx_purchases_quote.'); }
    catch (err) { if (err.code !== 'ER_DUP_KEYNAME') throw err; }
  } else console.log('Skipped: purchases.idx_purchases_quote already exists.');
  if (await hasConstraint('purchases', 'fk_purchases_quote')) console.log('Skipped: purchases.fk_purchases_quote already exists.');
  else {
    const [orphans] = await db.query('SELECT p.id FROM purchases p LEFT JOIN quote_requests q ON q.id = p.quote_id WHERE p.quote_id IS NOT NULL AND q.id IS NULL ORDER BY p.id LIMIT 50');
    if (orphans.length) {
      console.log(`NOT added: purchases.fk_purchases_quote. ${orphans.length} purchase(s) point at a quote that does not exist (ids: ${orphans.map(o => o.id).join(', ')}). Fix or clear their quote_id, then run this script again.`);
    } else {
      await db.query('ALTER TABLE purchases ADD CONSTRAINT fk_purchases_quote FOREIGN KEY (quote_id) REFERENCES quote_requests (id) ON DELETE SET NULL');
      console.log('Added purchases.fk_purchases_quote (ON DELETE SET NULL).');
    }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
