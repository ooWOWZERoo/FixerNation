require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list B15. Idempotent; safe to re-run, and a run that stopped half way is finished by the next one. Run it BEFORE restarting the Node app: the
// Customer rule (lib/crm-classification.js) now reads purchases.is_trial_flag. Everything is additive: nothing is dropped, changed or removed, so rolling the code
// back needs no undo (the old code simply ignores the new column and index).
//
//   node scripts/alter-crm-trial-flag-and-quote-index.js
//
// Adds purchases.is_trial_flag (NULL = not looked at yet): whether the purchase's product was a trial WHEN the CRM first looked at it. Until now the Customer rule read
// license_products.is_trial live, so editing a product later could turn an old paid purchase into a "trial" (or the other way round) and move a Customer's label.
// Then it fills the flag for every existing purchase from its product as the product is today (the best record there is), and adds the composite index
// quote_requests (opportunity_id, revision_number) that the deal page's quote list and the revise routes sort and look up by.

const STEPS = [
  { kind: 'column', table: 'purchases', name: 'is_trial_flag', ddl: 'ADD COLUMN is_trial_flag TINYINT(1) NULL' },
  { kind: 'index', table: 'quote_requests', name: 'idx_quote_requests_opp_revision', ddl: 'ADD INDEX idx_quote_requests_opp_revision (opportunity_id, revision_number)' },
];
const BACKFILL = 'UPDATE purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id SET p.is_trial_flag = COALESCE(lp.is_trial, 0) WHERE p.is_trial_flag IS NULL';

// `db` needs query(sql, params). Returns what it did, so the script and the test read the same thing.
async function ensure(db, schema, log = console.log) {
  const has = async (sql, ...p) => (await db.query(sql, p))[0].length > 0;
  const done = { added: [], skipped: [], backfilled: 0 };
  for (const s of STEPS) {
    const exists = s.kind === 'column'
      ? await has('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', schema, s.table, s.name)
      : await has('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?', schema, s.table, s.name);
    if (exists) { log(`Skipped: ${s.table}.${s.name} already exists.`); done.skipped.push(s.name); continue; }
    try { await db.query(`ALTER TABLE ${s.table} ${s.ddl}`); log(`Added ${s.table}.${s.name}.`); done.added.push(s.name); }
    catch (err) {
      if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(err.code)) throw err;
      log(`Skipped: ${s.table}.${s.name} already exists.`); done.skipped.push(s.name);
    }
  }
  const [r] = await db.query(BACKFILL);
  done.backfilled = Number((r && r.affectedRows) || 0);
  log(`Filled is_trial_flag on ${done.backfilled} purchase(s) that had none.`);
  return done;
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    for (const t of ['purchases', 'quote_requests', 'license_products']) {
      const [rows] = await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, t]);
      if (!rows.length) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
    }
    await ensure(db, process.env.DB_NAME);
  } finally {
    await db.end();
  }
}

module.exports = { STEPS, BACKFILL, ensure };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
