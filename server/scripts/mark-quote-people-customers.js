require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Marks the licensed teachers and school admins on ONE quote's paid purchase as hand-set Customers (the owner asked for this for quote #307785). A dry run by default: it lists who would be marked
// and changes nothing. Run it first and read the list.
//
//   node scripts/mark-quote-people-customers.js 307785                          list them (changes nothing)
//   node scripts/mark-quote-people-customers.js 307785 --apply --as <admin username>   mark them (the named admin must be a CRM Admin)
//
// The label is the Hub's own CRM Admin override: a reason and the evidence are recorded, the label is locked against the nightly check, and the change is written to the history and the audit
// log. It does not change the Customer rule for anyone else, and it never touches the purchase, invoice, seats or licenses. Safe to run again. Output shows names and counts, never email addresses.
// To undo one person: Customer Hub > Contacts > the person > release the hand-set label.
const mysql = require('mysql2/promise');
const Q = require('../lib/crm-quote-people');

async function main() {
  const args = process.argv.slice(2);
  const number = args.find(a => /^\d+$/.test(a));
  const apply = args.includes('--apply');
  const asIdx = args.indexOf('--as');
  const asName = asIdx !== -1 ? args[asIdx + 1] : null;
  if (!number) { console.error('Give the six-digit quote number, for example: node scripts/mark-quote-people-customers.js 307785'); process.exitCode = 1; return; }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  try {
    let admin = null;
    if (apply) {
      if (!asName) { console.error('Applying needs --as <the admin username doing it>, so the change is recorded against a real CRM Admin.'); process.exitCode = 1; return; }
      const [[a]] = await db.query('SELECT id, username, crm_role FROM admin_users WHERE username = ?', [asName]);
      if (!a) { console.error('No admin has that username. Nothing was changed.'); process.exitCode = 1; return; }
      if (a.crm_role !== 'admin') { console.error('That admin is not a CRM Admin (Hub Settings sets roles). Nothing was changed.'); process.exitCode = 1; return; }
      admin = a;
    }
    const plan = await Q.planQuote(db, number);
    if (plan.error) { console.error(plan.error); process.exitCode = 1; return; }
    console.log(`Quote ${plan.quote.number}, purchase #${plan.purchaseId} (${plan.basis}): ${plan.people.length} licensed ${plan.people.length === 1 ? 'person' : 'people'} found.`);
    const verb = { mark: 'would be marked Customer', lock: 'is already Customer, would be locked', already: 'already a locked Customer', no_contact: 'has no contact record, left alone' };
    for (const p of plan.people) console.log(`  ${p.role.padEnd(18)} ${p.action === 'no_contact' ? '(no contact)' : `${p.name || '(no name)'} [contact ${p.contactId}, now ${p.label}${p.locked ? ', locked' : ''}]`} -> ${verb[p.action]}`);
    const s = plan.skipped;
    console.log(`Left out: ${s.pendingSeats} pending invitation(s), ${s.revokedOrInactive} revoked or inactive, ${s.closedAccounts} closed account(s), ${s.testAddresses} test address(es). No contact record: ${s.noContact}.`);
    if (!apply) { console.log('Dry run: nothing was changed. To mark them: add --apply --as <your admin username>.'); return; }
    const r = await Q.applyPlan(db, plan, { adminId: admin.id });
    console.log(`Done as ${admin.username}: ${r.marked} marked Customer, ${r.locked} locked, ${r.already} already done, ${r.noContact} with no contact, ${r.failed} failed.`);
  } finally { await db.end(); }
}

main().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
