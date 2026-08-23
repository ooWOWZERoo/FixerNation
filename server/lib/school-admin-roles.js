const pool = require('../db/pool');

// If a site_user has no remaining active school_license_admins (or, since
// the district-admin role was added, district_license_admins) assignment,
// their site_users.role drifts back to 'teacher' — every requireSchoolAdmin/
// requireDistrictAdmin check gates on role first, so leaving a stale role
// value with zero active assignments is a dead-end account (correct-looking
// role, always denied). Conversely, activating any assignment should always
// promote the role back, or a reactivated assignment leaves them stuck
// denied. Shared by the FNE super-admin's admin-school-admins.js /
// admin-districts.js and the school-admin self-service teacher-removal
// route in school-admin.js — all of these can deactivate an assignment.
//
// role is a single mutually-exclusive value (same simplification the
// codebase already accepts for 'admin' vs 'school_license_admin') — a
// site_user holding both an active district and an active school assignment
// at once resolves to 'district_admin' (the broader scope wins). This isn't
// expected to occur in practice; it's a documented limitation, not a
// supported multi-role configuration.
async function syncRoleToAssignments(siteUserId) {
  // Guarded separately from the school_license_admins check below: if
  // alter-create-districts.js hasn't been run yet on this environment,
  // district_license_admins won't exist — treat that the same as "zero
  // active district assignments" rather than letting every role sync in the
  // app (including the pre-existing school-admin teacher-removal path) start
  // throwing until the migration catches up.
  let activeDistrictCount = 0;
  try {
    const [[row]] = await pool.query(
      'SELECT COUNT(*) AS activeDistrictCount FROM district_license_admins WHERE site_user_id = ? AND is_active = 1',
      [siteUserId]
    );
    activeDistrictCount = Number(row.activeDistrictCount);
  } catch {
    activeDistrictCount = 0;
  }
  if (activeDistrictCount > 0) {
    await pool.query("UPDATE site_users SET role = 'district_admin' WHERE id = ? AND role NOT IN ('admin', 'district_admin')", [siteUserId]);
    return;
  }

  const [[{ activeCount }]] = await pool.query(
    'SELECT COUNT(*) AS activeCount FROM school_license_admins WHERE site_user_id = ? AND is_active = 1',
    [siteUserId]
  );
  if (Number(activeCount) === 0) {
    await pool.query("UPDATE site_users SET role = 'teacher' WHERE id = ? AND role IN ('school_license_admin', 'district_admin')", [siteUserId]);
  } else {
    await pool.query("UPDATE site_users SET role = 'school_license_admin' WHERE id = ? AND role NOT IN ('admin', 'school_license_admin')", [siteUserId]);
  }
}

module.exports = { syncRoleToAssignments };
