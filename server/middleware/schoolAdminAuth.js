const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('../lib/session');

// Verifies that the requester is a logged-in site_user with at least one
// active school_license_admins assignment. Deliberately does NOT also
// require role==='school_license_admin' — role is a single mutually-
// exclusive value that can't represent an account holding this role
// alongside teacher/parent/district_admin at the same time (e.g. a district
// admin who is also a school admin), and the assignments query below is
// already the correct, sufficient check on its own (revoking is_active
// correctly locks them out without any role check needed).
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

  const [userRows] = await pool.query(
    'SELECT id, first_name, last_name, email, session_invalidated_at FROM site_users WHERE id = ?',
    [payload.userId]
  );
  const user = userRows[0];
  if (!user) {
    return res.status(403).json({ error: 'School License Administrator access required' });
  }
  // Same revocation check requireSiteAuth already enforces — this middleware
  // has its own DB lookup instead of reusing requireSiteAuth, so it needs its
  // own copy of the check or a revoked session survives here regardless.
  if (user.session_invalidated_at && payload.iat * 1000 < new Date(user.session_invalidated_at).getTime()) {
    return res.status(401).json({ error: 'Not logged in', reason: 'revoked' });
  }

  // Load their purchase scope
  const [assignments] = await pool.query(
    `SELECT sla.id AS assignment_id, sla.purchase_id, sla.permission_level,
            p.school_domain, p.seat_count, p.payment_status, p.payment_method,
            p.invoice_id, p.purchased_at, p.notes AS purchase_notes,
            p.license_status, p.expiration_date,
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

// Rejects a write action for a read_only admin — evaluated for the SPECIFIC
// purchase the action targets, not just req.schoolAdmin.permissionLevel
// (which is only ever the first assignment once sorted by purchase date, per
// requireSchoolAdmin above). A multi-school admin can hold different
// permission levels on different purchases; a blanket check using only the
// most-recently-purchased assignment's level let a read_only assignment on
// an older purchase silently inherit a primary/secondary assignment's write
// access from a newer one, regardless of which purchase a request actually
// targeted. Call this once the target purchaseId is known — immediately for
// routes that receive it directly in the query/body, or after a row lookup
// for routes that resolve it from a nested resource (an invitation, seat, or
// teacher id) first. Returns true (and has already sent the 403) if blocked.
function blockIfReadOnly(req, res, purchaseId) {
  const assignment = req.schoolAdmin.purchases.find(p => p.purchase_id === purchaseId);
  // Fail CLOSED, not open: every current call site pre-validates purchaseId
  // against req.schoolAdmin.purchaseIds first, so `assignment` missing here
  // can't happen today — but a future route resolving purchaseId from a new
  // source without that pre-check should be denied by default, not silently
  // allowed through.
  if (!assignment || assignment.permission_level === 'read_only') {
    res.status(403).json({ error: 'Your administrator role is read-only' });
    return true;
  }
  return false;
}

// Stricter than blockIfReadOnly: also blocks 'secondary' admins, for the
// three actions that actually revoke a seat (invitation revoke, teacher
// removal, direct seat revoke). admin-school-admins.html's own permission-
// level copy has always claimed secondaries "can invite teachers but cannot
// revoke seats" — the backend never enforced that distinction until now.
function blockIfCannotRevoke(req, res, purchaseId) {
  const assignment = req.schoolAdmin.purchases.find(p => p.purchase_id === purchaseId);
  // Same fail-closed reasoning as blockIfReadOnly above.
  if (!assignment || assignment.permission_level !== 'primary') {
    res.status(403).json({ error: 'Only a primary administrator can revoke a seat' });
    return true;
  }
  return false;
}

module.exports = { requireSchoolAdmin, requireSchoolAdminRead, blockIfReadOnly, blockIfCannotRevoke };
