// Deletes the 2 legacy classroom-level parent_classroom_links rows
// (student_id IS NULL) found by audit-legacy-parent-links.js for real
// (non-QA) accounts: johnfshaw@yahoo.com and service@vssus.com, both on
// classroom 1 ("7th Grade SEL Class"). User decision: treat these as
// leftover test/setup data from before per-child invites existed, not
// live parents needing a re-invite — delete rather than leave or re-invite.
//
// Matches by link id AND student_id IS NULL as a safety condition, so this
// can never delete a real per-child link even if ids were somehow reused.
// Does not touch the QA fixture's own legacy row (already harmless — the
// API filters student_id-NULL rows out of the parent portal regardless).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const LINK_IDS_TO_DELETE = [1, 3];

async function main() {
  const conn = await pool.getConnection();
  try {
    const [before] = await conn.query(
      `SELECT pcl.id, su.email, c.name AS classroom_name
       FROM parent_classroom_links pcl
       JOIN site_users su ON su.id = pcl.site_user_id
       JOIN classrooms c ON c.id = pcl.classroom_id
       WHERE pcl.id IN (?) AND pcl.student_id IS NULL`,
      [LINK_IDS_TO_DELETE]
    );

    if (!before.length) {
      console.log('None of the target link ids still exist as legacy (student_id IS NULL) rows. Nothing to delete.');
      return;
    }

    console.log('About to delete:');
    before.forEach(r => console.log(`  link #${r.id} — ${r.email} -> classroom "${r.classroom_name}"`));

    const [result] = await conn.query(
      'DELETE FROM parent_classroom_links WHERE id IN (?) AND student_id IS NULL',
      [LINK_IDS_TO_DELETE]
    );
    console.log(`Deleted ${result.affectedRows} row(s).`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
