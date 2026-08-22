// Reactivates school_license_admins assignment #1 (johnfshaw@yahoo.com,
// purchase 21) — found is_active=0 by diagnose-school-admin-access.js,
// which is why GET /api/school-admin/me returned 403 ("no active school
// administrator assignment found") and school-admin-nav.js bounced the
// user back to school-admin-login.html right after a successful login.
// User confirmed this should be reactivated, not left off.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const ASSIGNMENT_ID = 1;

async function main() {
  const conn = await pool.getConnection();
  try {
    const [[before]] = await conn.query(
      `SELECT sla.id, sla.is_active, sla.permission_level, su.email
       FROM school_license_admins sla
       JOIN site_users su ON su.id = sla.site_user_id
       WHERE sla.id = ?`,
      [ASSIGNMENT_ID]
    );
    if (!before) { console.log(`Assignment #${ASSIGNMENT_ID} not found. Nothing to do.`); return; }
    console.log(`Before: assignment #${before.id} for ${before.email} — is_active=${before.is_active}, permission=${before.permission_level}`);

    const [result] = await conn.query(
      'UPDATE school_license_admins SET is_active = 1 WHERE id = ?',
      [ASSIGNMENT_ID]
    );
    console.log(`Updated ${result.affectedRows} row(s).`);

    const [[after]] = await conn.query('SELECT id, is_active FROM school_license_admins WHERE id = ?', [ASSIGNMENT_ID]);
    console.log(`After: assignment #${after.id} — is_active=${after.is_active}`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
