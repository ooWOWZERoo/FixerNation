// Internal Fixer Nation admin routes for managing school license administrators.
// Protected by requireAuth — school admins cannot access these.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  assignSchoolLicenseAdmin,
  resendSchoolAdminWelcome,
  revokeSchoolAdminAssignment,
  updateSchoolAdminAssignment,
} = require('../lib/school-admin-assignment');

const router = express.Router();

// GET /api/admin/school-admins?q=&page=&limit=
// Lists all school license admin assignments (q searches school domain and admin email)
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || req.query.domain || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;

  // Excludes anyone who's also an active district admin -- a district admin
  // overseeing a school shouldn't show up in the "school license admins"
  // report at all; that's a different tier of authority, even if they
  // happen to hold both assignments (e.g. the multi-role QA fixture).
  let where = `WHERE sla.is_active = 1
    AND NOT EXISTS (SELECT 1 FROM district_license_admins dla WHERE dla.site_user_id = sla.site_user_id AND dla.is_active = 1)`;
  const params = [];
  if (q) {
    where += ' AND (p.school_domain LIKE ? OR su.email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM school_license_admins sla
     JOIN site_users su ON su.id = sla.site_user_id
     JOIN purchases p ON p.id = sla.purchase_id
     ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT sla.id, sla.permission_level, sla.is_active, sla.notes, sla.created_at,
            su.id AS site_user_id, su.first_name, su.last_name, su.email, su.role, su.email_verified,
            p.id AS purchase_id, p.school_domain, p.seat_count, p.payment_status,
            lp.name AS plan_name
     FROM school_license_admins sla
     JOIN site_users su ON su.id = sla.site_user_id
     JOIN purchases p ON p.id = sla.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     ${where}
     ORDER BY sla.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({ admins: rows, total: Number(total), page, limit });
});

// POST /api/admin/school-admins/assign
// Assigns the school_license_admin role to a user for a given purchase.
// Creates a site_user account if one doesn't exist for that email.
router.post('/assign', requireAuth, async (req, res) => {
  const { email, purchaseId, permissionLevel = 'primary', notes, firstName: bodyFirstName, lastName: bodyLastName } = req.body || {};

  if (!email || !purchaseId) {
    return res.status(400).json({ error: 'email and purchaseId are required' });
  }

  let result;
  try {
    result = await assignSchoolLicenseAdmin({
      email, purchaseId, permissionLevel, notes,
      createdByAdminId: req.user.userId,
      firstName: bodyFirstName, lastName: bodyLastName,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  res.status(201).json({
    ok: true,
    siteUserId: result.user.id,
    isNewUser: result.isNewUser,
    purchaseId,
    schoolDomain: result.purchase.school_domain,
  });
});

// POST /api/admin/school-admins/:assignmentId/resend-welcome
router.post('/:assignmentId/resend-welcome', requireAuth, async (req, res) => {
  try {
    const { email } = await resendSchoolAdminWelcome(req.params.assignmentId);
    console.log(`[school-admin] Resent welcome email to ${email} (assignment ${req.params.assignmentId})`);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(`[school-admin] resend-welcome failed:`, err.message);
    res.status(500).json({ error: `Failed to send email: ${err.message}` });
  }
});

// DELETE /api/admin/school-admins/:assignmentId
// Removes a school admin assignment; also reverts role if they have no other assignments
router.delete('/:assignmentId', requireAuth, async (req, res) => {
  try {
    await revokeSchoolAdminAssignment(req.params.assignmentId);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// PUT /api/admin/school-admins/:assignmentId — update permission level
router.put('/:assignmentId', requireAuth, async (req, res) => {
  const { permissionLevel, isActive, notes } = req.body || {};
  try {
    await updateSchoolAdminAssignment(req.params.assignmentId, { permissionLevel, isActive, notes });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

module.exports = router;
