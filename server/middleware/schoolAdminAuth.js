const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('../lib/session');

// Verifies that the requester is a logged-in site_user with role='school_license_admin'
// AND has at least one active school_license_admins assignment.
// Sets req.schoolAdmin = { siteUserId, email, firstName, lastName, purchaseIds, purchases, permissionLevel }
// where purchases is the array of purchase rows this admin manages.
async function requireSchoolAdmin(req, res, next) {
  const token = req.cookies && req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return res.status(401).json({ error: 'Not logged in' });
  }

  // Always verify role against DB — role could have been revoked since token was issued
  const [userRows] = await pool.query(
    'SELECT id, first_name, last_name, email, role FROM site_users WHERE id = ?',
    [payload.userId]
  );
  const user = userRows[0];
  if (!user || user.role !== 'school_license_admin') {
    return res.status(403).json({ error: 'School License Administrator access required' });
  }

  // Load their purchase scope
  const [assignments] = await pool.query(
    `SELECT sla.id AS assignment_id, sla.purchase_id, sla.permission_level,
            p.school_domain, p.seat_count, p.payment_status, p.payment_method,
            p.invoice_id, p.purchased_at, p.notes AS purchase_notes,
            lp.name AS plan_name
     FROM school_license_admins sla
     JOIN purchases p ON p.id = sla.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE sla.site_user_id = ? AND sla.is_active = 1
     ORDER BY p.purchased_at DESC`,
    [user.id]
  );

  if (!assignments.length) {
    return res.status(403).json({ error: 'No active school administrator assignment found' });
  }

  req.schoolAdmin = {
    siteUserId: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    permissionLevel: assignments[0].permission_level,
    purchaseIds: assignments.map(a => a.purchase_id),
    purchases: assignments,
  };

  next();
}

// Like requireSchoolAdmin but only requires read access (any permission level)
async function requireSchoolAdminRead(req, res, next) {
  return requireSchoolAdmin(req, res, next);
}

// Rejects write actions for read_only admins
function requireWritePermission(req, res, next) {
  if (req.schoolAdmin && req.schoolAdmin.permissionLevel === 'read_only') {
    return res.status(403).json({ error: 'Your administrator role is read-only' });
  }
  next();
}

module.exports = { requireSchoolAdmin, requireSchoolAdminRead, requireWritePermission };
