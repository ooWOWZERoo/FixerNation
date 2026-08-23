const pool = require('../db/pool');

// If a site_user has no remaining active school_license_admins assignment,
// their site_users.role drifts back to 'teacher' — every requireSchoolAdmin
// check gates on role first, so leaving it at 'school_license_admin' with
// zero active assignments is a dead-end account (correct-looking role,
// always denied). Conversely, activating any assignment should always
// promote the role back, or a reactivated assignment leaves them stuck
// denied. Shared by both the FNE super-admin's admin-school-admins.js and
// the school-admin self-service teacher-removal route in school-admin.js —
// both can deactivate an assignment, and only one of them used to sync this.
async function syncRoleToAssignments(siteUserId) {
  const [[{ activeCount }]] = await pool.query(
    'SELECT COUNT(*) AS activeCount FROM school_license_admins WHERE site_user_id = ? AND is_active = 1',
    [siteUserId]
  );
  if (Number(activeCount) === 0) {
    await pool.query("UPDATE site_users SET role = 'teacher' WHERE id = ? AND role = 'school_license_admin'", [siteUserId]);
  } else {
    await pool.query("UPDATE site_users SET role = 'school_license_admin' WHERE id = ? AND role NOT IN ('admin', 'school_license_admin')", [siteUserId]);
  }
}

module.exports = { syncRoleToAssignments };
