// READ-ONLY report for docs/reference/student-data-retention-requirements.md. Counts classrooms and students by school year and
// says how many would be due for deletion today under the proposed rule (60 days after 31 July). It changes nothing and prints no
// names or email addresses, so it is safe to run on production and to paste into a chat.
//
// Run (cPanel, with the nodevenv prefix):   node scripts/report-student-retention.js [--grace=60]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { DEFAULT_GRACE_DAYS, summarize } = require('../lib/student-retention');

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--grace='));
  const grace = arg ? Number(arg.slice(8)) : DEFAULT_GRACE_DAYS;
  if (!Number.isInteger(grace) || grace < 0 || grace > 365) { console.error('--grace must be a whole number from 0 to 365'); process.exit(1); }

  const [rows] = await pool.query(
    `SELECT c.id, c.academic_year, c.created_at,
            (c.archived_at IS NOT NULL) AS archived,
            (su.id IS NULL) AS teacher_missing,
            (su.id IS NOT NULL AND su.closed_at IS NOT NULL) AS teacher_closed,
            COALESCE(su.is_sales_demo, 0) AS is_demo,
            (SELECT COUNT(*) FROM classroom_students s WHERE s.classroom_id = c.id AND s.is_active = 1) AS active_students,
            (SELECT COUNT(*) FROM classroom_students s WHERE s.classroom_id = c.id AND s.is_active = 0) AS removed_students
     FROM classrooms c
     LEFT JOIN site_users su ON su.id = c.teacher_site_user_id`
  );
  const today = new Date().toISOString().slice(0, 10);
  const r = summarize(rows, today, grace);

  console.log(`Student data retention report, ${r.today} (grace ${r.graceDays} days after 31 July). Nothing was changed.`);
  console.log(`Classrooms: ${r.classrooms} (${r.archived} archived). Students: ${r.students} active + ${r.removedStudents} removed but still stored.`);
  console.log(`Academic Year set: ${r.yearSet}. Inferred from the created date: ${r.yearInferred}. Unreadable: ${r.yearUnreadable}.`);
  console.log(`Teacher account gone: ${r.teacherAccountGone}. Teacher account closed: ${r.teacherAccountClosed}. Demo/QA classrooms: ${r.demoOrQa}.`);
  console.log(`DUE TODAY: ${r.dueNow.classrooms} classrooms, ${r.dueNow.students} student records.`);
  console.log(`Due within 90 days: ${r.dueWithin90Days.classrooms} classrooms, ${r.dueWithin90Days.students} student records.`);
  console.log('By school year (classrooms / active students / removed students, date data is due):');
  for (const [label, s] of Object.entries(r.byYear).sort()) {
    console.log(`  ${label}: ${s.classrooms} / ${s.students} / ${s.removedStudents}, due ${s.dueDate}`);
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
