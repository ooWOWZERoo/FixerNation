// Shared draft/publish/reset/logo-upload/crop logic for the branding editor —
// used identically by the school-admin self-service portal (school_branding,
// keyed by school_id) and the district-admin self-service portal
// (district_branding, keyed by district_id). The two tables are structurally
// identical snapshot-pair tables (see alter-create-schools-and-branding.js's
// comment on why draft/published are separate columns, not separate rows),
// so every function here is parameterized by { table, idColumn } rather than
// duplicated per caller.
//
// table/idColumn are never user input — every call site passes one of the
// two literal constants below — but since they're interpolated directly into
// SQL as identifiers (can't be parameterized with `?`), they're validated
// against an allowlist regardless, as a hard backstop against a future call
// site accidentally passing something else through.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const multer = require('multer');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const pool = require('../db/pool');

const ALLOWED_TABLES = {
  school_branding: 'school_id',
  district_branding: 'district_id',
};

function assertTarget(table, idColumn) {
  if (ALLOWED_TABLES[table] !== idColumn) {
    throw new Error(`branding-editor: unrecognized target ${table}/${idColumn}`);
  }
}

const LOGO_MIN_WIDTH = 200;
const LOGO_MIN_HEIGHT = 100;
const LOGO_MAX_DIMENSION = 6000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
// SVGs are vector/resolution-independent (many omit explicit pixel
// dimensions, only a viewBox) — rather than special-case the min/max pixel
// gate below for vector input, every SVG upload is rasterized once here at a
// fixed large size and treated identically to a PNG/JPEG/WebP original for
// every downstream step (dimension checks, crop, display resize). The
// sanitized vector source itself is not retained.
const SVG_RASTER_MAX_DIMENSION = 2000;
const DISPLAY_WIDTH = 800;
const DISPLAY_HEIGHT = 400;
const CROP_MIN_SIZE = 20;

const logoUploadsDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), 'school-logos');
fs.mkdirSync(logoUploadsDir, { recursive: true });

const { window: purifyWindow } = new JSDOM('');
const DOMPurify = createDOMPurify(purifyWindow);

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

// The client-supplied mimetype is attacker-controlled — a file claiming
// image/svg+xml that doesn't actually sniff as SVG is rejected, and (more
// importantly) a file that DOES sniff as SVG regardless of its claimed
// mimetype is always routed through sanitization before anything touches it.
function looksLikeSvg(buffer) {
  const head = buffer.slice(0, 2048).toString('utf8').trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}

// DOMPurify's SVG profile is XSS-focused (strips <script>, on* handlers,
// foreignObject, etc.) but not SSRF-focused — it still allows an
// href/xlink:href pointing at an external URL. Strip any reference that
// isn't a local fragment (#id) or a data: URI as defense in depth.
function sanitizeSvg(raw) {
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
  return clean.replace(/((?:xlink:)?href)\s*=\s*(["'])(?!#|data:)[^"']*\2/gi, '$1=$2$2');
}

function originalPathFromUrl(url) {
  if (!url) return null;
  return path.join(logoUploadsDir, path.basename(url));
}

async function getRow(table, idColumn, id) {
  assertTarget(table, idColumn);
  const [[row]] = await pool.query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`, [id]);
  return row || null;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

async function upsertDraftColors({ table, idColumn, id, primaryColor, secondaryColor, accentColor, updatedBy }) {
  assertTarget(table, idColumn);
  const hexOrNull = (v) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
  const primary = hexOrNull(primaryColor);
  const secondary = hexOrNull(secondaryColor);
  const accent = hexOrNull(accentColor);

  await pool.query(
    `INSERT INTO ${table} (${idColumn}, draft_primary_color, draft_secondary_color, draft_accent_color, branding_status, updated_by)
     VALUES (?, ?, ?, ?, 'DRAFT', ?)
     ON DUPLICATE KEY UPDATE
       draft_primary_color = COALESCE(?, draft_primary_color),
       draft_secondary_color = COALESCE(?, draft_secondary_color),
       draft_accent_color = COALESCE(?, draft_accent_color),
       branding_status = IF(branding_status = 'DEFAULT', 'DRAFT', branding_status),
       updated_by = ?`,
    [id, primary, secondary, accent, updatedBy, primary, secondary, accent, updatedBy]
  );
}

// ---------------------------------------------------------------------------
// Logo upload (Part B: sanitize-then-rasterize for SVG, unchanged pipeline
// for PNG/JPEG/WebP)
// ---------------------------------------------------------------------------

async function processLogoUpload({ table, idColumn, id, fileBuffer, mimetype, updatedBy }) {
  assertTarget(table, idColumn);

  const isSvg = mimetype === 'image/svg+xml' || looksLikeSvg(fileBuffer);
  if (mimetype === 'image/svg+xml' && !isSvg) {
    throw Object.assign(new Error('This file does not look like a valid SVG image.'), { statusCode: 400 });
  }

  let sourceBuffer = fileBuffer;
  if (isSvg) {
    const sanitized = sanitizeSvg(fileBuffer.toString('utf8'));
    try {
      sourceBuffer = await sharp(Buffer.from(sanitized), { density: 300 })
        .resize({ width: SVG_RASTER_MAX_DIMENSION, withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      throw Object.assign(new Error('This SVG could not be read as a valid image. Please try a different file.'), { statusCode: 400 });
    }
  }

  let metadata;
  try {
    metadata = await sharp(sourceBuffer).metadata();
  } catch {
    throw Object.assign(new Error('This file could not be read as a valid image. Please try a different file.'), { statusCode: 400 });
  }

  const { width, height } = metadata;
  if (!width || !height) {
    throw Object.assign(new Error('This file could not be read as a valid image. Please try a different file.'), { statusCode: 400 });
  }
  // The pixel min/max gate only makes sense for raster input — an SVG has
  // already been rasterized above at a fixed large size, well clear of both
  // bounds by construction.
  if (!isSvg) {
    if (width < LOGO_MIN_WIDTH || height < LOGO_MIN_HEIGHT) {
      throw Object.assign(new Error(
        `This image is ${width} × ${height} pixels. Logos must be at least ${LOGO_MIN_WIDTH} × ${LOGO_MIN_HEIGHT} pixels. Please upload a larger image.`
      ), { statusCode: 400 });
    }
    if (width > LOGO_MAX_DIMENSION || height > LOGO_MAX_DIMENSION) {
      throw Object.assign(new Error(
        `This image is too large (${width} × ${height} pixels). Please upload an image no larger than ${LOGO_MAX_DIMENSION} × ${LOGO_MAX_DIMENSION} pixels.`
      ), { statusCode: 400 });
    }
  }

  const ext = isSvg ? 'png' : (metadata.format === 'jpeg' ? 'jpg' : metadata.format);
  const base = `${id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const originalFilename = `${base}-original.${ext}`;
  const displayFilename = `${base}-display.png`;

  try {
    fs.writeFileSync(path.join(logoUploadsDir, originalFilename), sourceBuffer);
    await sharp(sourceBuffer)
      .resize({ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(path.join(logoUploadsDir, displayFilename));
  } catch {
    throw Object.assign(new Error('Could not process this image. Please try again.'), { statusCode: 500 });
  }

  const urlPrefix = process.env.UPLOADS_URL_PREFIX || '/uploads/';
  const originalUrl = `${urlPrefix}school-logos/${originalFilename}`;
  const displayUrl = `${urlPrefix}school-logos/${displayFilename}`;

  await pool.query(
    `INSERT INTO ${table} (${idColumn}, draft_logo_original_url, draft_logo_display_url, draft_logo_crop, branding_status, updated_by)
     VALUES (?, ?, ?, NULL, 'DRAFT', ?)
     ON DUPLICATE KEY UPDATE
       draft_logo_original_url = ?,
       draft_logo_display_url = ?,
       draft_logo_crop = NULL,
       branding_status = IF(branding_status = 'DEFAULT', 'DRAFT', branding_status),
       updated_by = ?`,
    [id, originalUrl, displayUrl, updatedBy, originalUrl, displayUrl, updatedBy]
  );

  return { logoOriginalUrl: originalUrl, logoDisplayUrl: displayUrl };
}

// ---------------------------------------------------------------------------
// Logo crop (Part A: non-destructive — always re-derived from the stored
// original, never from a previously-cropped display copy)
// ---------------------------------------------------------------------------

async function applyLogoCrop({ table, idColumn, id, cropRect, updatedBy }) {
  assertTarget(table, idColumn);

  const row = await getRow(table, idColumn, id);
  const originalUrl = row && row.draft_logo_original_url;
  if (!originalUrl) {
    throw Object.assign(new Error('There is no logo to crop yet — upload one first.'), { statusCode: 400 });
  }
  const originalPath = originalPathFromUrl(originalUrl);

  let originalBuffer;
  try {
    originalBuffer = fs.readFileSync(originalPath);
  } catch {
    throw Object.assign(new Error('The original logo file could not be found. Please re-upload it.'), { statusCode: 404 });
  }

  const metadata = await sharp(originalBuffer).metadata();
  const rect = validateCropRect(cropRect, metadata);
  if (!rect) {
    throw Object.assign(new Error('Invalid crop selection.'), { statusCode: 400 });
  }

  const base = `${id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const displayFilename = `${base}-display.png`;

  try {
    await sharp(originalBuffer)
      .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
      .resize({ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(path.join(logoUploadsDir, displayFilename));
  } catch {
    throw Object.assign(new Error('Could not apply this crop. Please try again.'), { statusCode: 500 });
  }

  const urlPrefix = process.env.UPLOADS_URL_PREFIX || '/uploads/';
  const displayUrl = `${urlPrefix}school-logos/${displayFilename}`;

  await pool.query(
    `UPDATE ${table} SET draft_logo_display_url = ?, draft_logo_crop = ?, updated_by = ? WHERE ${idColumn} = ?`,
    [displayUrl, JSON.stringify(rect), updatedBy, id]
  );

  return { logoDisplayUrl: displayUrl, cropRect: rect };
}

// A crop rect is client-controlled input feeding an image-processing op —
// re-validated against the ORIGINAL file's real dimensions server-side,
// never trusted from the request alone.
function validateCropRect(rect, metadata) {
  if (!rect || typeof rect !== 'object') return null;
  const x = Math.round(Number(rect.x));
  const y = Math.round(Number(rect.y));
  const width = Math.round(Number(rect.width));
  const height = Math.round(Number(rect.height));
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < CROP_MIN_SIZE || height < CROP_MIN_SIZE) return null;
  if (x < 0 || y < 0 || x + width > metadata.width || y + height > metadata.height) return null;
  return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// Publish / reset
// ---------------------------------------------------------------------------

async function publishBranding({ table, idColumn, id, updatedBy }) {
  assertTarget(table, idColumn);
  const row = await getRow(table, idColumn, id);
  if (!row) {
    throw Object.assign(new Error('There is no draft branding to publish yet.'), { statusCode: 400 });
  }

  await pool.query(
    `UPDATE ${table} SET
       published_logo_original_url = COALESCE(draft_logo_original_url, published_logo_original_url),
       published_logo_display_url = COALESCE(draft_logo_display_url, published_logo_display_url),
       published_logo_crop = COALESCE(draft_logo_crop, published_logo_crop),
       published_primary_color = COALESCE(draft_primary_color, published_primary_color),
       published_secondary_color = COALESCE(draft_secondary_color, published_secondary_color),
       published_accent_color = COALESCE(draft_accent_color, published_accent_color),
       branding_status = 'PUBLISHED',
       published_at = NOW(),
       updated_by = ?
     WHERE ${idColumn} = ?`,
    [updatedBy, id]
  );
}

async function resetBranding({ table, idColumn, id, updatedBy }) {
  assertTarget(table, idColumn);
  await pool.query(
    `UPDATE ${table} SET
       draft_logo_original_url = NULL, draft_logo_display_url = NULL, draft_logo_crop = NULL,
       draft_primary_color = NULL, draft_secondary_color = NULL, draft_accent_color = NULL,
       published_logo_original_url = NULL, published_logo_display_url = NULL, published_logo_crop = NULL,
       published_primary_color = NULL, published_secondary_color = NULL, published_accent_color = NULL,
       branding_status = 'DEFAULT', published_at = NULL, updated_by = ?
     WHERE ${idColumn} = ?`,
    [updatedBy, id]
  );
}

module.exports = {
  logoUpload,
  getRow,
  upsertDraftColors,
  processLogoUpload,
  applyLogoCrop,
  publishBranding,
  resetBranding,
  LOGO_MIN_WIDTH,
  LOGO_MIN_HEIGHT,
  LOGO_MAX_DIMENSION,
  LOGO_MAX_BYTES,
};
