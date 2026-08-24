const pool = require('../db/pool');

// Keeps site_users.role roughly in sync with assignment changes, mostly for
// display/hint purposes (the JWT payload's role field, the optimistic nav
// render, the default landing experience). It is NOT what gates access
// anymore — requireSchoolAdmin/requireDistrictAdmin (server/middleware/
// schoolAdminAuth.js, districtAdminAuth.js) and the school/district admin
// login pages check for a real active assignment row directly, independent
// of this column, specifically so an account can hold both roles (or
// teacher/parent alongside either) at once without one silently locking out
// the other. Shared by the FNE super-admin's admin-school-admins.js /
// admin-districts.js and the school-admin self-service teacher-removal
// route in school-admin.js — all of these can deactivate an assignment.
//
// role itself is still a single value, so a site_user holding both an
// active district and an active school assignment resolves to 'district_admin'
// here (the broader scope wins) — that only affects which portal the login
// response/nav *defaults* to highlighting, not which portals they can
// actually reach.
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
