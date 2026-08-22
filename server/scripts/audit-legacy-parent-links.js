// Read-only audit: parent_classroom_links rows with student_id IS NULL are
// leftovers from the removed parent_code self-join flow (the migration in
// alter-add-parent-student-invites.js added student_id as nullable and
// additive — it never touched or back-filled existing rows). As of
// server/routes/parent.js's GET /children, those rows are now filtered out
// of the parent portal entirely, so any real (non-QA) parent still on one
// of these rows currently sees "No children linked yet" until their
// teacher sends them a real per-student invite.
//
// This makes no changes — it only reports, so the affected parents (if any)
// can be told to expect a re-invite, or to help decide whether to build a
// one-time backfill instead.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

function looksLikeTestEmail(email) {
  const e = (email || '').toLowerCase();
  return e.startsWith('qa-') || e.includes('@example.com') || e.includes('+test') || e.includes('test@');
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(`
      SELECT pcl.id AS link_id, pcl.classroom_id, c.name AS classroom_name,
             su.id AS site_user_id, su.email, su.first_name, su.last_name, su.created_at AS account_created_at
      FROM parent_classroom_links pcl
      JOIN classrooms c ON c.id = pcl.classroom_id
      JOIN site_users su ON su.id = pcl.site_user_id
      WHERE pcl.student_id IS NULL
      ORDER BY su.email
    `);

    if (!rows.length) {
      console.log('No legacy classroom-level parent links found. Nothing affected.');
      return;
    }

    console.log(`Found ${rows.length} legacy classroom-level parent link(s) (student_id IS NULL):\n`);
    let realCount = 0;
    rows.forEach(r => {
      const flag = looksLikeTestEmail(r.email) ? '[QA/test]' : '[REAL — investigate]';
      if (flag.startsWith('[REAL')) realCount++;
      console.log(
        `${flag} link #${r.link_id} — ${r.first_name || ''} ${r.last_name || ''} <${r.email}> ` +
        `(site_user_id ${r.site_user_id}, account created ${r.account_created_at}) ` +
        `-> classroom "${r.classroom_name}" (id ${r.classroom_id})`
      );
    });

    console.log(`\n${realCount} of ${rows.length} flagged as real (non-QA) parents — those are currently seeing an empty parent portal.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
