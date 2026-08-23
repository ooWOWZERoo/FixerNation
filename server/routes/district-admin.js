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

module.exports = router;
