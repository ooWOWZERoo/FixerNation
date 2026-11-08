// Saves the de-identified Graduate Evidence year totals (docs/reference/pog-evidence-requirements.md section 14). Counts only; it prints
// no names and no student ids. DRY RUN by default: it says what it would write and writes nothing until you add --apply.
// It only accepts a school year that has ended, and a classroom already saved for that year is never touched again.
//
// Run (cPanel, with the nodevenv prefix):   node scripts/snapshot-pog-evidence.js [--year=2025] [--apply]
//   --year  the year the school year STARTS in (2025 = school year 2025-2026). Default: the most recent school year that has ended.
// Best run in August, once the school year has just ended and before the student-data purge exists to remove the records.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { snapshotYear, lastEndedSchoolYear } = require('../lib/pog-evidence-snapshot');

async function main() {
  const apply = process.argv.includes('--apply');
  const arg = process.argv.find((a) => a.startsWith('--year='));
  const year = arg ? Number(arg.slice(7)) : lastEndedSchoolYear();
  if (!Number.isInteger(year)) { console.error('--year must be a whole year such as 2025'); process.exit(1); }
  const r = await snapshotYear({ schoolYearStart: year, apply });
  console.log(`Graduate Evidence year snapshot, school year ${r.schoolYear}, state ${r.state}. ${apply ? 'APPLIED.' : 'DRY RUN, nothing was written (add --apply).'}`);
  console.log(`Classrooms with students and no snapshot yet: ${r.classrooms}. Attributes with a verified direct connection today: ${r.connectedItems}.`);
  if (apply) console.log(`Written: ${r.written} classrooms (${r.rows} rows). Skipped, already saved: ${r.exists}. Skipped, no students: ${r.noStudents}.`);
  await pool.end();
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
