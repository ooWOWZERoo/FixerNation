// Lists everyone sitting in a school Community group who does not belong to that school (no seat or administrator assignment for
// its domain, and not an administrator of its district), and with --apply removes them from that group. Their posts and comments
// there stay. Rule A and D in docs/reference/community-group-privacy-requirements.md. Changes nothing without --apply.
//
//   node scripts/clean-school-group-members.js           DRY RUN
//   node scripts/clean-school-group-members.js --apply   removes them from those groups
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { findStrangersInSchoolGroups, removeStrangersFromSchoolGroups } = require('../lib/community-groups');

async function main() {
  const apply = process.argv.includes('--apply');
  const strangers = await findStrangersInSchoolGroups(pool);
  console.log(apply ? 'APPLYING' : 'DRY RUN (nothing was changed; add --apply to remove them)');
  console.log(`People in a school group who do not belong to that school: ${strangers.length}`);
  strangers.forEach((s) => console.log(`  ${s.schoolDomain} group: ${s.name || '(no name)'} <${s.email}>`));
  if (apply) console.log(`Removed: ${await removeStrangersFromSchoolGroups(pool)}`);
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
