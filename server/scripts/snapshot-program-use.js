// Saves the monthly school-level totals behind the District Program Use Report's history (docs/reference/district-program-report-requirements.md
// section 8). Counts only: it prints no names and saves no student or teacher id. DRY RUN by default: it says what it would save and saves nothing
// until you add --apply. A month already saved is never touched again.
//
// Run (cPanel, with the nodevenv prefix):
//   node scripts/snapshot-program-use.js [--apply]              the month that just ended (cron: 04:15 on the 1st of each month)
//   node scripts/snapshot-program-use.js --backfill [--apply]   every finished month of the current school year, once, from live activity
//   --today=YYYY-MM-DD    pretend it is that day (testing)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const use = require('../lib/program-use');
const { getSetting } = require('../lib/settings');

async function main() {
  const apply = process.argv.includes('--apply'), backfill = process.argv.includes('--backfill');
  const arg = process.argv.find((a) => a.startsWith('--today='));
  const today = arg ? new Date(`${arg.slice(8)}T12:00:00Z`) : new Date();
  if (Number.isNaN(today.getTime())) { console.error('--today must look like 2026-11-09'); process.exit(1); }
  const { schoolYearStart, monthKeys } = use.monthsToSnapshot({ today, backfill });
  console.log(`Program use snapshot, ${backfill ? 'backfill of school year ' + schoolYearStart : 'monthly'}. ${apply ? 'APPLIED.' : 'DRY RUN, nothing was saved (add --apply).'}`);
  if (!monthKeys.length) { console.log('No finished month to save yet.'); await pool.end(); return; }
  const settings = {
    regularWeeks: await getSetting('program_report_regular_weeks'), lowUsePct: await getSetting('program_report_low_use_pct'),
    minTeachers: await getSetting('program_report_min_teachers'), minStudents: await getSetting('pog_evidence_min_group'),
  };
  const [districts] = await pool.query('SELECT DISTINCT district_id FROM schools WHERE district_id IS NOT NULL ORDER BY district_id');
  let total = { rows: 0, written: 0, skipped: 0 };
  for (const d of districts) {
    const groups = await use.districtSchoolGroups(d.district_id);
    if (!groups.length) continue;
    const rows = await use.snapshotRowsFor({ groups, schoolYearStart, monthKeys, districtId: d.district_id, source: backfill ? 'backfill' : 'monthly', settings });
    total.rows += rows.length;
    if (apply) { const r = await use.writeSnapshotRows(rows); total.written += r.written; total.skipped += r.skipped; }
  }
  console.log(`Months: ${monthKeys.join(', ')}. Districts: ${districts.length}. School-month rows ${apply ? 'considered' : 'that would be saved'}: ${total.rows}.`);
  if (apply) console.log(`Saved: ${total.written}. Already saved, left alone: ${total.skipped}.`);
  await pool.end();
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
