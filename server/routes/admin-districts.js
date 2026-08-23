// Internal Fixer Nation admin routes for managing districts and district-
// level branding. FNE-staff-managed only — no self-service district-admin
// role exists (per user decision, 2026-08-23): districts sit above schools
// and give an optional default logo/colors that a school inherits only if
// it hasn't published its own branding (see server/lib/branding.js's
// getPublishedBranding() for the fallback logic).
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getPublishedDistrictBranding, processLogoUpload, LogoValidationError } = require('../lib/branding');

const router = express.Router();

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const logoUploadsDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), 'district-logos');
fs.mkdirSync(logoUploadsDir, { recursive: true });

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype)) {
      return cb(new Error('Logos must be a PNG, JPG, WebP, or SVG image.'));
    }
    cb(null, true);
  },
});

const BRANDING_COLOR_FIELDS = ['primary_color', 'secondary_color', 'accent_color'];
const BRANDING_LOGO_FIELDS = ['logo_original_url', 'logo_display_url'];

function pickBranding(row, prefix) {
  const out = {};
  [...BRANDING_LOGO_FIELDS, ...BRANDING_COLOR_FIELDS].forEach((f) => {
    out[f] = row ? row[`${prefix}_${f}`] : null;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------

// GET /api/admin/districts — list all districts with school + branding status
router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.created_at,
            (SELECT COUNT(*) FROM schools s WHERE s.district_id = d.id) AS school_count,
            db.branding_status
     FROM districts d
     LEFT JOIN district_branding db ON db.district_id = d.id
     ORDER BY d.name`
  );
  res.json({ districts: rows });
});

// POST /api/admin/districts — create a new district
router.post('/', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'District name is required.' });
  const [result] = await pool.query('INSERT INTO districts (name) VALUES (?)', [name]);
  res.status(201).json({ id: result.insertId, name });
});

// PUT /api/admin/districts/:id — rename a district
router.put('/:id', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'District name is required.' });
  const [result] = await pool.query('UPDATE districts SET name = ? WHERE id = ?', [name, req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'District not found' });
  res.json({ ok: true });
});

// DELETE /api/admin/districts/:id — schools FK is ON DELETE SET NULL, so
// member schools simply become unassigned rather than blocking the delete.
router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM districts WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'District not found' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// District ↔ school membership
// ---------------------------------------------------------------------------

// GET /api/admin/districts/:id/schools — every school, flagged whether it's
// currently assigned to THIS district (the picker UI needs the full list,
// not just the assigned subset, to let staff add/remove members).
router.get('/:id/schools', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.domain, s.display_name, s.district_id,
            (s.district_id = ?) AS is_assigned
     FROM schools s
     ORDER BY (s.district_id = ?) DESC, s.domain`,
    [req.params.id, req.params.id]
  );
  res.json({ schools: rows.map(r => ({ ...r, is_assigned: !!r.is_assigned })) });
});

// PUT /api/admin/districts/:id/schools — replace the full membership list
// { schoolIds: [1,2,3] }. Schools removed from the list revert to
// district_id = NULL (unassigned, not deleted).
router.put('/:id/schools', requireAuth, async (req, res) => {
  const schoolIds = Array.isArray(req.body && req.body.schoolIds) ? req.body.schoolIds.map(Number).filter(Number.isInteger) : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE schools SET district_id = NULL WHERE district_id = ?', [req.params.id]);
    if (schoolIds.length) {
      await conn.query('UPDATE schools SET district_id = ? WHERE id IN (?)', [req.params.id, schoolIds]);
    }
    await conn.commit();
    res.json({ ok: true, assignedCount: schoolIds.length });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------------------
// District branding — same draft/published snapshot pattern as
// school-admin.js's school branding routes, keyed by district_id instead.
// ---------------------------------------------------------------------------

// GET /api/admin/districts/:id/branding
router.get('/:id/branding', requireAuth, async (req, res) => {
  const [[district]] = await pool.query('SELECT name FROM districts WHERE id = ?', [req.params.id]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  const [[row]] = await pool.query('SELECT * FROM district_branding WHERE district_id = ?', [req.params.id]);
  const published = pickBranding(row, 'published');
  const draft = pickBranding(row, 'draft');
  const draftForEditing = { ...published, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null)) };
  const hasUnpublishedChanges = row
    ? [...BRANDING_LOGO_FIELDS, ...BRANDING_COLOR_FIELDS].some(f => row[`draft_${f}`] != null && row[`draft_${f}`] !== row[`published_${f}`])
    : false;

  res.json({
    districtName: district.name,
    status: row ? row.branding_status : 'DEFAULT',
    published,
    draft: draftForEditing,
    hasUnpublishedChanges,
  });
});

// PUT /api/admin/districts/:id/branding — save draft colors
router.put('/:id/branding', requireAuth, async (req, res) => {
  const [[district]] = await pool.query('SELECT id FROM districts WHERE id = ?', [req.params.id]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  const { primaryColor, secondaryColor, accentColor } = req.body || {};
  const hexOrNull = (v) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
  if (primaryColor && !hexOrNull(primaryColor)) return res.status(400).json({ error: 'Primary color must be a valid hex value, e.g. #003B71' });
  if (secondaryColor && !hexOrNull(secondaryColor)) return res.status(400).json({ error: 'Secondary color must be a valid hex value.' });
  if (accentColor && !hexOrNull(accentColor)) return res.status(400).json({ error: 'Accent color must be a valid hex value.' });

  await pool.query(
    `INSERT INTO district_branding (district_id, draft_primary_color, draft_secondary_color, draft_accent_color, branding_status, updated_by)
     VALUES (?, ?, ?, ?, 'DRAFT', ?)
     ON DUPLICATE KEY UPDATE
       draft_primary_color = COALESCE(?, draft_primary_color),
       draft_secondary_color = COALESCE(?, draft_secondary_color),
       draft_accent_color = COALESCE(?, draft_accent_color),
       branding_status = IF(branding_status = 'DEFAULT', 'DRAFT', branding_status),
       updated_by = ?`,
    [req.params.id, hexOrNull(primaryColor), hexOrNull(secondaryColor), hexOrNull(accentColor), req.user.userId,
     hexOrNull(primaryColor), hexOrNull(secondaryColor), hexOrNull(accentColor), req.user.userId]
  );
  res.json({ ok: true });
});

// POST /api/admin/districts/:id/branding/logo
router.post('/:id/branding/logo', requireAuth, (req, res, next) => {
  logoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  const [[district]] = await pool.query('SELECT id FROM districts WHERE id = ?', [req.params.id]);
  if (!district) return res.status(404).json({ error: 'District not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let originalUrl, displayUrl;
  try {
    ({ logoOriginalUrl: originalUrl, logoDisplayUrl: displayUrl } = await processLogoUpload(req.file.buffer, logoUploadsDir, `district-${req.params.id}`));
  } catch (e) {
    if (e instanceof LogoValidationError) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: 'Could not process this image. Please try again.' });
  }

  await pool.query(
    `INSERT INTO district_branding (district_id, draft_logo_original_url, draft_logo_display_url, branding_status, updated_by)
     VALUES (?, ?, ?, 'DRAFT', ?)
     ON DUPLICATE KEY UPDATE
       draft_logo_original_url = ?,
       draft_logo_display_url = ?,
       branding_status = IF(branding_status = 'DEFAULT', 'DRAFT', branding_status),
       updated_by = ?`,
    [req.params.id, originalUrl, displayUrl, req.user.userId, originalUrl, displayUrl, req.user.userId]
  );

  res.status(201).json({ logoOriginalUrl: originalUrl, logoDisplayUrl: displayUrl });
});

// POST /api/admin/districts/:id/branding/publish
router.post('/:id/branding/publish', requireAuth, async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM district_branding WHERE district_id = ?', [req.params.id]);
  if (!row) return res.status(400).json({ error: 'There is no draft branding to publish yet.' });

  await pool.query(
    `UPDATE district_branding SET
       published_logo_original_url = COALESCE(draft_logo_original_url, published_logo_original_url),
       published_logo_display_url = COALESCE(draft_logo_display_url, published_logo_display_url),
       published_primary_color = COALESCE(draft_primary_color, published_primary_color),
       published_secondary_color = COALESCE(draft_secondary_color, published_secondary_color),
       published_accent_color = COALESCE(draft_accent_color, published_accent_color),
       branding_status = 'PUBLISHED',
       published_at = NOW(),
       updated_by = ?
     WHERE district_id = ?`,
    [req.user.userId, req.params.id]
  );
  res.json({ ok: true });
});

// POST /api/admin/districts/:id/branding/reset
router.post('/:id/branding/reset', requireAuth, async (req, res) => {
  await pool.query(
    `UPDATE district_branding SET
       draft_logo_original_url = NULL, draft_logo_display_url = NULL,
       draft_primary_color = NULL, draft_secondary_color = NULL, draft_accent_color = NULL,
       published_logo_original_url = NULL, published_logo_display_url = NULL,
       published_primary_color = NULL, published_secondary_color = NULL, published_accent_color = NULL,
       branding_status = 'DEFAULT', published_at = NULL, updated_by = ?
     WHERE district_id = ?`,
    [req.user.userId, req.params.id]
  );
  res.json({ ok: true });
});

// GET /api/admin/districts/:id/branding/resolved — derived-shape branding
// (same as teacher/student/parent get), for the editor's own live-preview
// bootstrap when it needs the CURRENTLY LIVE version rather than the draft.
router.get('/:id/branding/resolved', requireAuth, async (req, res) => {
  const branding = await getPublishedDistrictBranding(Number(req.params.id));
  res.json({ branding });
});

module.exports = router;
