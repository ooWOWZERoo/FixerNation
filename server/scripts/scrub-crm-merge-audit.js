require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list S12: contact-merge audit rows written before this fix copied the removed person's name and email into prev_value. This removes those two keys from
// those rows and leaves everything else (ids, label, subscription status) in place. DRY RUN by default: it only counts. Add --apply to change rows. Safe to re-run.
//
//   node scripts/scrub-crm-merge-audit.js            (count only)
//   node scripts/scrub-crm-merge-audit.js --apply

function scrubOne(raw) {
  let v;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object' || (!('name' in v) && !('email' in v))) return null;
  delete v.name; delete v.email;
  return JSON.stringify(v);
}

async function run(db, { apply = false } = {}) {
  const [rows] = await db.query("SELECT id, prev_value FROM school_audit_log WHERE action = 'crm_contact_merged' AND prev_value IS NOT NULL");
  let changed = 0;
  for (const r of rows) {
    const next = scrubOne(r.prev_value);
    if (next === null) continue;
    changed++;
    if (apply) await db.query('UPDATE school_audit_log SET prev_value = ? WHERE id = ?', [next, r.id]);
  }
  return { examined: rows.length, changed, applied: apply };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  try {
    const r = await run(db, { apply });
    console.log(`${r.examined} merge audit row(s) looked at; ${r.changed} ${apply ? 'cleaned' : 'would be cleaned (dry run; add --apply to change them)'}.`);
  } finally { await db.end(); }
}

module.exports = { run, scrubOne };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
