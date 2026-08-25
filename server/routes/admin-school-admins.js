// Internal Fixer Nation admin routes for managing school license administrators.
// Protected by requireAuth — school admins cannot access these.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createToken } = require('../lib/site-tokens');
const { sendSchoolAdminWelcomeEmail } = require('../lib/mailer');
const { syncRoleToAssignments } = require('../lib/school-admin-roles');
const { assignSchoolLicenseAdmin } = require('../lib/school-admin-assignment');

const router = express.Router();

// GET /api/admin/school-admins?q=&page=&limit=
// Lists all school license admin assignments (q searches school domain and admin email)
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || req.query.domain || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;

  let where = 'WHERE sla.is_active = 1';
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
  const [[assignment]] = await pool.query(
    `SELECT sla.id, sla.site_user_id, p.school_domain
     FROM school_license_admins sla
     JOIN purchases p ON p.id = sla.purchase_id
     WHERE sla.id = ?`,
    [req.params.assignmentId]
  );
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  const [[user]] = await pool.query(
    'SELECT id, first_name, email, email_verified FROM site_users WHERE id = ?',
    [assignment.site_user_id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  const siteUrl = process.env.SITE_URL || '';
  const resetToken = await createToken(user.id, 'reset', 7 * 24 * 60 * 60 * 1000);
  const activateUrl = `${siteUrl}/reset-password.html?token=${resetToken}&next=/school-admin-dashboard.html`;

  try {
    await sendSchoolAdminWelcomeEmail({
      to: user.email,
      firstName: user.first_name,
      schoolDomain: assignment.school_domain,
      portalUrl: `${siteUrl}/school-admin-login.html`,
      activateUrl,
      isNewUser: !user.email_verified,
    });
    console.log(`[school-admin] Resent welcome email to ${user.email} (assignment ${req.params.assignmentId})`);
  } catch (e) {
    console.error(`[school-admin] resend-welcome failed for ${user.email}:`, e.message);
    return res.status(500).json({ error: `Failed to send email: ${e.message}` });
  }

  res.json({ ok: true });
});

// DELETE /api/admin/school-admins/:assignmentId
// Removes a school admin assignment; also reverts role if they have no other assignments
router.delete('/:assignmentId', requireAuth, async (req, res) => {
  const [[assignment]] = await pool.query(
    'SELECT sla.*, p.school_domain FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id WHERE sla.id = ?',
    [req.params.assignmentId]
  );
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  await pool.query('UPDATE school_license_admins SET is_active = 0 WHERE id = ?', [assignment.id]);
  await syncRoleToAssignments(assignment.site_user_id);

  res.json({ ok: true });
});

// PUT /api/admin/school-admins/:assignmentId — update permission level
router.put('/:assignmentId', requireAuth, async (req, res) => {
  const { permissionLevel, isActive, notes } = req.body || {};
  if (permissionLevel && !['primary', 'secondary', 'read_only'].includes(permissionLevel)) {
    return res.status(400).json({ error: 'Invalid permission level' });
  }

  const [[existing]] = await pool.query('SELECT site_user_id FROM school_license_admins WHERE id = ?', [req.params.assignmentId]);
  if (!existing) return res.status(404).json({ error: 'Assignment not found' });

  const updates = [];
  const params = [];
  if (permissionLevel) { updates.push('permission_level = ?'); params.push(permissionLevel); }
  if (isActive !== undefined) { updates.push('is_active = ?'); params.push(isActive ? 1 : 0); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.assignmentId);
  const [result] = await pool.query(`UPDATE school_license_admins SET ${updates.join(', ')} WHERE id = ?`, params);
  if (!result.affectedRows) return res.status(404).json({ error: 'Assignment not found' });

  if (isActive !== undefined) await syncRoleToAssignments(existing.site_user_id);

  res.json({ ok: true });
});

module.exports = router;
