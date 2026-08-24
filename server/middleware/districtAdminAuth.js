const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('../lib/session');

// District admins are a THIRD role on the existing site_user / fn_user_session
// system, structurally identical to requireSchoolAdmin (school_license_admin)
// — not a fourth session cookie. Verifies the requester is a logged-in
// site_user with at least one active district_license_admins assignment.
// Deliberately does NOT also require role==='district_admin' — role is a
// single mutually-exclusive value that can't represent an account holding
// this role alongside teacher/parent/school_license_admin at the same time,
// and the assignments query below is already the correct, sufficient check
// on its own.
// Sets req.districtAdmin = { siteUserId, email, firstName, lastName, districtIds, districts }
async function requireDistrictAdmin(req, res, next) {
  const token = req.cookies && req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const [userRows] = await pool.query(
    'SELECT id, first_name, last_name, email, session_invalidated_at FROM site_users WHERE id = ?',
    [payload.userId]
  );
  const user = userRows[0];
  if (!user) {
    return res.status(403).json({ error: 'District Administrator access required' });
  }
  // Same revocation check requireSiteAuth/requireSchoolAdmin enforce — this
  // middleware has its own DB lookup rather than reusing requireSiteAuth, so
  // it needs its own copy of the check or a revoked session survives here.
  if (user.session_invalidated_at && payload.iat * 1000 < new Date(user.session_invalidated_at).getTime()) {
    return res.status(401).json({ error: 'Not logged in', reason: 'revoked' });
  }

  const [assignments] = await pool.query(
    `SELECT dla.id AS assignment_id, dla.district_id, d.name AS district_name
     FROM district_license_admins dla
     JOIN districts d ON d.id = dla.district_id
     WHERE dla.site_user_id = ? AND dla.is_active = 1
     ORDER BY d.name`,
    [user.id]
  );

  if (!assignments.length) {
    return res.status(403).json({ error: 'No active district administrator assignment found' });
  }

  req.districtAdmin = {
    siteUserId: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    districtIds: assignments.map(a => a.district_id),
    districts: assignments,
  };

  next();
}

module.exports = { requireDistrictAdmin };
