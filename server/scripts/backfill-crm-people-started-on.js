require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G16 (FR-CON-02): fills in "started" for the people who were already on an account before the CRM recorded it. The day they were added to the account (the date
// the entry was made) is used, because it is the only evidence there is; nothing is guessed from a deal, a purchase or an email. Nothing is ever overwritten: a person who already
// has a start date, or has left, is not touched. Report only unless --apply. Idempotent; safe to re-run. No restart needed.
//
//   node scripts/backfill-crm-people-started-on.js            report: how many entries would get a start date
//   node scripts/backfill-crm-people-started-on.js --apply    write them

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM crm_account_contacts WHERE started_on IS NULL AND created_at IS NOT NULL');
    console.log(`${n} account entr${Number(n) === 1 ? 'y has' : 'ies have'} no start date yet.`);
    if (!apply) { console.log('Report only. Nothing was changed. Run again with --apply to fill them in.'); return; }
    const [r] = await db.query('UPDATE crm_account_contacts SET started_on = DATE(created_at) WHERE started_on IS NULL AND created_at IS NOT NULL');
    console.log(`Filled in ${r.affectedRows}.`);
    const [[{ m }]] = await db.query('SELECT COUNT(*) AS m FROM crm_accounts a WHERE a.archived_at IS NULL AND (SELECT COUNT(*) FROM crm_account_contacts ac WHERE ac.account_id = a.id AND ac.is_primary = 1 AND ac.ended_on IS NULL) > 1');
    console.log(`${m} account${Number(m) === 1 ? '' : 's'} still ${Number(m) === 1 ? 'has' : 'have'} more than one primary contact. They are listed on the Reports page (Reconciliation); pick one on each account.`);
  } finally { await db.end(); }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
