// Brings the "Morning Boost Recipients" group in line with the rules in
// docs/reference/morning-boost-recipient-group-requirements.md: creates the group if it is missing, switches it on as a Morning
// Boost recipient group, adds every licensed teacher, school license administrator and district administrator who qualifies,
// and removes anyone who no longer does. The daily license-expiry job runs the same sync, so this is for the first run and
// for checking.
//
//   node scripts/sync-morning-boost-group.js                     DRY RUN: prints what would change, changes nothing
//   node scripts/sync-morning-boost-group.js --apply             does it
//   node scripts/sync-morning-boost-group.js --since=2026-10-15  start date for this run (default: the setting, else 2026-10-15)
//   add --list to print every email that would be added or removed
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { syncMorningBoostGroup } = require('../lib/morning-boost-group');

async function main() {
  const apply = process.argv.includes('--apply');
  const list = process.argv.includes('--list');
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.slice('--since='.length) : null;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since must look like 2026-10-15');

  const r = await syncMorningBoostGroup(pool, { apply, since });
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing was changed; add --apply to do it)');
  console.log(`Start date ${r.startDate}, today ${r.today}. The group ${r.groupExists ? 'exists' : 'does not exist yet'}${apply ? `; switched on as a Morning Boost recipient group: ${r.activated ? 'yes' : 'NO, Morning Boost has no configuration yet (open Morning Boost email settings once, then run again)'}` : ''}.`);
  console.log(`People who qualify: ${r.eligible} (teachers ${r.byRole.teacher}, school license administrators ${r.byRole.school_admin}, district administrators ${r.byRole.district_admin}; one person can hold several roles).`);
  console.log(`${apply ? 'Added' : 'Would add'}: ${r.add}.  ${apply ? 'Removed' : 'Would remove'}: ${r.remove}.  ${apply ? 'CRM contacts created' : 'CRM contacts that would be created'}: ${r.contactsToCreate}.`);
  if (r.excluded.length) console.log(`Left out as test or demo addresses: ${r.excluded.length}${list ? ' (' + r.excluded.join(', ') + ')' : ''}.`);
  const show = (label, emails) => { if (emails.length) { console.log(`\n${label}:`); (list ? emails : emails.slice(0, 15)).forEach((e) => console.log('  ' + e)); if (!list && emails.length > 15) console.log(`  ... and ${emails.length - 15} more (use --list)`); } };
  show(apply ? 'Added' : 'Would add', r.addEmails);
  show(apply ? 'Removed' : 'Would remove', r.removeEmails);
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
