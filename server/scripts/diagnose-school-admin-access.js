// Read-only. The timezone/session_invalidated_at theory (previous
// diagnostic) came back clean — DB and Node both run in UTC, and the
// account that bounced isn't even in the invalidated-session list. So the
// bounce-back is more likely requireSchoolAdmin's OTHER two rejection
// paths (schoolAdminAuth.js:26-27 and :50-52), both of which return
// non-2xx from GET /api/school-admin/me — which school-admin-nav.js
// treats identically to "not logged in" and redirects to login for:
//   1. site_users.role !== 'school_license_admin'
//   2. no row in school_license_admins with is_active = 1 for that user
// This lists every school_license_admin-role user next to their
// school_license_admins assignments (active or not) so the actual gap is
// visible directly instead of guessed at.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const conn = await pool.getConnection();
  try {
    const [users] = await conn.query(
      `SELECT id, email, first_name, last_name, role, email_verified
       FROM site_users
       WHERE role = 'school_license_admin'
       ORDER BY email`
    );

    if (!users.length) {
      console.log('No site_users have role = school_license_admin at all.');
      return;
    }

    for (const u of users) {
      const [assignments] = await conn.query(
        `SELECT sla.id, sla.purchase_id, sla.permission_level, sla.is_active,
                p.school_domain, p.payment_status
         FROM school_license_admins sla
         JOIN purchases p ON p.id = sla.purchase_id
         WHERE sla.site_user_id = ?`,
        [u.id]
      );

      const activeCount = assignments.filter(a => a.is_active).length;
      const flag = !u.email_verified ? '[UNVERIFIED EMAIL]'
        : activeCount === 0 ? '[NO ACTIVE ASSIGNMENT — will bounce at login]'
        : '[looks OK]';

      console.log(`${flag} ${u.email} (site_user_id ${u.id}, email_verified=${u.email_verified})`);
      if (!assignments.length) {
        console.log('    no school_license_admins rows at all');
      } else {
        assignments.forEach(a => {
          console.log(`    assignment #${a.id} -> purchase ${a.purchase_id} (${a.school_domain || 'no domain'}, payment_status=${a.payment_status}) permission=${a.permission_level} is_active=${a.is_active}`);
        });
      }
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
