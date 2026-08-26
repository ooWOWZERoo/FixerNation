// Self-service portal for district administrators — branding is the ONLY
// capability in scope (per the District-Level Branding Hierarchy plan).
// Mirrors school-admin.js's branding section structurally, but every
// operation is keyed by district_id instead of school_id/purchase_id, and
// all of the actual draft/publish/reset/upload/crop logic is shared with
// school-admin.js via server/lib/branding-editor.js rather than duplicated.
const express = require('express');
const pool = require('../db/pool');
const { requireDistrictAdmin } = require('../middleware/districtAdminAuth');
const {
  logoUpload,
  upsertDraftColors,
  processLogoUpload,
  applyLogoCrop,
  publishBranding,
  resetBranding,
} = require('../lib/branding-editor');
const {
  assignSchoolLicenseAdmin,
  resendSchoolAdminWelcome,
  sendSchoolAdminPasswordReset,
  revokeSchoolAdminAssignment,
  updateSchoolAdminAssignment,
} = require('../lib/school-admin-assignment');

const router = express.Router();

function resolveDistrictId(req) {
  const districtId = req.query.districtId
    ? Number(req.query.districtId)
    : req.districtAdmin.districtIds[0];
  if (!req.districtAdmin.districtIds.includes(districtId)) return null;
  return districtId;
}

const BRANDING_COLOR_FIELDS = ['primary_color', 'secondary_color', 'accent_color'];
const BRANDING_LOGO_FIELDS = ['logo_original_url', 'logo_display_url'];
const BRANDING_LOGO_EXTRA_FIELDS = ['logo_crop'];

function pickBranding(row, prefix) {
  const out = {};
  [...BRANDING_LOGO_FIELDS, ...BRANDING_LOGO_EXTRA_FIELDS, ...BRANDING_COLOR_FIELDS].forEach((f) => {
    out[f] = row ? row[`${prefix}_${f}`] : null;
  });
  return out;
}

// GET /api/district-admin/me
router.get('/me', requireDistrictAdmin, (req, res) => {
  const { siteUserId, email, firstName, lastName, districts } = req.districtAdmin;
  res.json({
    loggedIn: true,
    siteUserId,
    email,
    firstName,
    lastName,
    districts: districts.map(d => ({ districtId: d.district_id, districtName: d.district_name })),
  });
});

// GET /api/district-admin/branding?districtId=
router.get('/branding', requireDistrictAdmin, async (req, res) => {
  const districtId = resolveDistrictId(req);
  if (districtId === null) return res.status(403).json({ error: 'Access denied to this district' });

  const [[district]] = await pool.query('SELECT name FROM districts WHERE id = ?', [districtId]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  const [[row]] = await pool.query('SELECT * FROM district_branding WHERE district_id = ?', [districtId]);

  const published = pickBranding(row, 'published');
  const draft = pickBranding(row, 'draft');
  const draftForEditing = { ...published, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null)) };

  const hasUnpublishedChanges = row
    ? [...BRANDING_LOGO_FIELDS, ...BRANDING_COLOR_FIELDS].some(f => row[`draft_${f}`] != null && row[`draft_${f}`] !== row[`published_${f}`])
    : false;

  res.json({
    districtId,
    districtName: district.name,
    status: row ? row.branding_status : 'DEFAULT',
    published,
    draft: draftForEditing,
    hasUnpublishedChanges,
  });
});

// PUT /api/district-admin/branding — save draft colors
router.put('/branding', requireDistrictAdmin, async (req, res) => {
  const districtId = resolveDistrictId(req);
  if (districtId === null) return res.status(403).json({ error: 'Access denied to this district' });

  const { primaryColor, secondaryColor, accentColor } = req.body || {};
  const hexOk = (v) => !v || /^#[0-9a-fA-F]{6}$/.test(v);
  if (!hexOk(primaryColor)) return res.status(400).json({ error: 'Primary color must be a valid hex value, e.g. #003B71' });
  if (!hexOk(secondaryColor)) return res.status(400).json({ error: 'Secondary color must be a valid hex value.' });
  if (!hexOk(accentColor)) return res.status(400).json({ error: 'Accent color must be a valid hex value.' });

  await upsertDraftColors({
    table: 'district_branding', idColumn: 'district_id', id: districtId,
    primaryColor, secondaryColor, accentColor, updatedBy: req.districtAdmin.siteUserId,
  });

  res.json({ ok: true });
});

// POST /api/district-admin/branding/logo
router.post('/branding/logo', requireDistrictAdmin, (req, res, next) => {
  logoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  const districtId = resolveDistrictId(req);
  if (districtId === null) return res.status(403).json({ error: 'Access denied to this district' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const result = await processLogoUpload({
      table: 'district_branding', idColumn: 'district_id', id: districtId,
      fileBuffer: req.file.buffer, mimetype: req.file.mimetype, updatedBy: req.districtAdmin.siteUserId,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// PUT /api/district-admin/branding/logo/crop
router.put('/branding/logo/crop', requireDistrictAdmin, async (req, res) => {
  const districtId = resolveDistrictId(req);
  if (districtId === null) return res.status(403).json({ error: 'Access denied to this district' });

  try {
    const result = await applyLogoCrop({
      table: 'district_branding', idColumn: 'district_id', id: districtId,
      cropRect: (req.body || {}).cropRect, updatedBy: req.districtAdmin.siteUserId,
    });
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST /api/district-admin/branding/publish
router.post('/branding/publish', requireDistrictAdmin, async (req, res) => {
  const { districtId: rawDistrictId } = req.body || {};
  const districtId = rawDistrictId ? Number(rawDistrictId) : resolveDistrictId(req);
  if (districtId === null || !req.districtAdmin.districtIds.includes(districtId)) {
    return res.status(403).json({ error: 'Access denied to this district' });
  }

  try {
    await publishBranding({ table: 'district_branding', idColumn: 'district_id', id: districtId, updatedBy: req.districtAdmin.siteUserId });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }

  await pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, ip_address)
     VALUES ('site_user', ?, ?, 'district_branding_published', 'district_branding', ?, ?)`,
    [req.districtAdmin.siteUserId, req.districtAdmin.email, districtId, req.ip]
  );

  res.json({ ok: true });
});

// POST /api/district-admin/branding/reset
router.post('/branding/reset', requireDistrictAdmin, async (req, res) => {
  const { districtId: rawDistrictId } = req.body || {};
  const districtId = rawDistrictId ? Number(rawDistrictId) : resolveDistrictId(req);
  if (districtId === null || !req.districtAdmin.districtIds.includes(districtId)) {
    return res.status(403).json({ error: 'Access denied to this district' });
  }

  await resetBranding({ table: 'district_branding', idColumn: 'district_id', id: districtId, updatedBy: req.districtAdmin.siteUserId });

  await pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, ip_address)
     VALUES ('site_user', ?, ?, 'district_branding_reset', 'district_branding', ?, ?)`,
    [req.districtAdmin.siteUserId, req.districtAdmin.email, districtId, req.ip]
  );

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// School License Administrator invitations — the second real capability
// beyond branding, per explicit product decision: this is ADDITIVE to FNE
// staff's existing admin-school-admins.html flow (which keeps working
// unchanged, including for schools with no district), not a replacement.
// A district admin can only see/act on group_license purchases whose school
// belongs to one of their own districts (schools.district_id).
// ---------------------------------------------------------------------------

// GET /api/district-admin/check-email?email= — same purpose/scoping as
// school-admin.js's identical endpoint: warn before sending, boolean only.
router.get('/check-email', requireDistrictAdmin, async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.json({ exists: false });
  const [[row]] = await pool.query('SELECT 1 FROM site_users WHERE email = ?', [email]);
  res.json({ exists: !!row });
});

// GET /api/district-admin/schools — every group_license purchase for a
// school in this district admin's district(s), with its current active
// license admins, for the "invite a school license admin" flow.
router.get('/schools', requireDistrictAdmin, async (req, res) => {
  const districtIds = req.districtAdmin.districtIds;

  const [purchases] = await pool.query(
    `SELECT p.id AS purchase_id, p.school_domain, p.seat_count, p.payment_status,
            p.license_status, p.expiration_date,
            s.id AS school_id, s.display_name AS school_display_name, s.district_id,
            lp.name AS plan_name
     FROM purchases p
     JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.product_type = 'group_license' AND s.district_id IN (?)
     ORDER BY s.domain, p.purchased_at DESC`,
    [districtIds]
  );

  const purchaseIds = purchases.map(p => p.purchase_id);
  let admins = [];
  if (purchaseIds.length) {
    // Excludes anyone who's also an active district admin -- seeing
    // yourself (the district admin viewing this page) listed as "the
    // school's admin" is exactly the confusing case the multi-role QA
    // fixture surfaced; this is a different tier of authority, not a
    // school-level assignment worth reporting here even if it technically
    // exists.
    [admins] = await pool.query(
      `SELECT sla.id AS assignment_id, sla.purchase_id, su.first_name, su.last_name, su.email, su.email_verified, su.role, sla.permission_level
       FROM school_license_admins sla
       JOIN site_users su ON su.id = sla.site_user_id
       WHERE sla.purchase_id IN (?) AND sla.is_active = 1
         AND NOT EXISTS (SELECT 1 FROM district_license_admins dla WHERE dla.site_user_id = sla.site_user_id AND dla.is_active = 1)`,
      [purchaseIds]
    );
  }
  const adminsByPurchase = {};
  admins.forEach(a => { (adminsByPurchase[a.purchase_id] = adminsByPurchase[a.purchase_id] || []).push(a); });

  res.json({
    schools: purchases.map(p => ({ ...p, admins: adminsByPurchase[p.purchase_id] || [] })),
  });
});

// POST /api/district-admin/schools/:purchaseId/assign-admin
// { email, permissionLevel, notes, firstName, lastName }
router.post('/schools/:purchaseId/assign-admin', requireDistrictAdmin, async (req, res) => {
  const purchaseId = Number(req.params.purchaseId);
  const { email, permissionLevel, notes, firstName, lastName } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Server-side scope check — this purchase's school must actually belong to
  // one of this district admin's districts, never trust the client on this.
  const [[row]] = await pool.query(
    `SELECT p.id FROM purchases p
     JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
     WHERE p.id = ? AND p.product_type = 'group_license' AND s.district_id IN (?)`,
    [purchaseId, req.districtAdmin.districtIds]
  );
  if (!row) return res.status(403).json({ error: 'Access denied to this school' });

  let result;
  try {
    result = await assignSchoolLicenseAdmin({
      email, purchaseId, permissionLevel: permissionLevel || 'primary',
      notes: [notes, `Invited by district admin ${req.districtAdmin.email}`].filter(Boolean).join(' — '),
      createdByAdminId: null, // not an admin_users id — see lib/school-admin-assignment.js comment
      firstName, lastName,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  await pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, purchase_id, school_domain, ip_address)
     VALUES ('site_user', ?, ?, 'school_admin_assigned_by_district_admin', 'school_license_admins', ?, ?, ?, ?)`,
    [req.districtAdmin.siteUserId, req.districtAdmin.email, result.user.id, purchaseId, result.purchase.school_domain, req.ip]
  );

  res.status(201).json({
    ok: true,
    siteUserId: result.user.id,
    isNewUser: result.isNewUser,
    purchaseId,
    schoolDomain: result.purchase.school_domain,
  });
});

// Every management action below acts on a school_license_admins.id
// (assignment), not a purchaseId directly — this helper is the one server-
// side gate all four share, resolving the assignment's purchase's school and
// confirming it belongs to one of the caller's own districts. Never trust
// the assignmentId alone; a district admin could otherwise probe/act on any
// assignment ID system-wide just by guessing numbers.
async function assertAssignmentInOwnDistrict(assignmentId, districtIds) {
  const [[row]] = await pool.query(
    `SELECT sla.id FROM school_license_admins sla
     JOIN purchases p ON p.id = sla.purchase_id
     JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
     WHERE sla.id = ? AND s.district_id IN (?)`,
    [assignmentId, districtIds]
  );
  return !!row;
}

// POST /api/district-admin/schools/admin-assignments/:assignmentId/resend-welcome
router.post('/schools/admin-assignments/:assignmentId/resend-welcome', requireDistrictAdmin, async (req, res) => {
  if (!(await assertAssignmentInOwnDistrict(req.params.assignmentId, req.districtAdmin.districtIds))) {
    return res.status(403).json({ error: 'Access denied to this assignment' });
  }
  try {
    await resendSchoolAdminWelcome(req.params.assignmentId);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// POST /api/district-admin/schools/admin-assignments/:assignmentId/send-password-reset
router.post('/schools/admin-assignments/:assignmentId/send-password-reset', requireDistrictAdmin, async (req, res) => {
  if (!(await assertAssignmentInOwnDistrict(req.params.assignmentId, req.districtAdmin.districtIds))) {
    return res.status(403).json({ error: 'Access denied to this assignment' });
  }
  const [[assignment]] = await pool.query('SELECT site_user_id FROM school_license_admins WHERE id = ?', [req.params.assignmentId]);
  try {
    await sendSchoolAdminPasswordReset(assignment.site_user_id);
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// PUT /api/district-admin/schools/admin-assignments/:assignmentId — { permissionLevel, notes }
// Deliberately does NOT accept isActive here — revoking goes through the
// dedicated DELETE below, which also logs to school_audit_log; editing
// permission level/notes doesn't need the same audit weight.
router.put('/schools/admin-assignments/:assignmentId', requireDistrictAdmin, async (req, res) => {
  if (!(await assertAssignmentInOwnDistrict(req.params.assignmentId, req.districtAdmin.districtIds))) {
    return res.status(403).json({ error: 'Access denied to this assignment' });
  }
  const { permissionLevel, notes } = req.body || {};
  try {
    await updateSchoolAdminAssignment(req.params.assignmentId, { permissionLevel, notes });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// DELETE /api/district-admin/schools/admin-assignments/:assignmentId — revoke
router.delete('/schools/admin-assignments/:assignmentId', requireDistrictAdmin, async (req, res) => {
  if (!(await assertAssignmentInOwnDistrict(req.params.assignmentId, req.districtAdmin.districtIds))) {
    return res.status(403).json({ error: 'Access denied to this assignment' });
  }
  let assignment;
  try {
    assignment = await revokeSchoolAdminAssignment(req.params.assignmentId);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  await pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, purchase_id, ip_address)
     VALUES ('site_user', ?, ?, 'school_admin_revoked_by_district_admin', 'school_license_admins', ?, ?, ?)`,
    [req.districtAdmin.siteUserId, req.districtAdmin.email, assignment.id, assignment.purchase_id, req.ip]
  );

  res.json({ ok: true });
});

module.exports = router;
