// Centralized school-branding resolution + theme derivation, per the
// School → Branding Configuration → FNE Theme Engine → UI model.
//
// getPublishedBranding() returns null (not a "default" object) when a
// school has no published branding — callers/pages treat null as "do
// nothing," which leaves each surface's own hardcoded FNE-default colors
// and logo untouched. This is deliberately simpler than trying to mirror
// every surface's own default palette here (school-admin pages default to
// orange/navy, marketing-style pages default to coral/teal — they're
// different design systems, not one shared default).
//
// Every resolver below is read-only and must never throw past this module —
// a broken/missing link in the school chain should fall back to "no
// branding," not block the user from loading their page.
const pool = require('../db/pool');

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) { h = 0; s = 0; }
  else {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = 60 * (((g - b) / d) % 6); break;
      case g: h = 60 * ((b - r) / d + 2); break;
      default: h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Lighten/darken by shifting HSL lightness — the "automatic lighter and
// darker variations" the branding spec asks for, so admins never manage
// these themselves.
function shiftLightness(hex, delta) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  hsl.l = Math.max(0, Math.min(1, hsl.l + delta));
  return rgbToHex(hslToRgb(hsl));
}

function relativeLuminance({ r, g, b }) {
  const chan = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexToRgb(hexA) || { r: 0, g: 0, b: 0 });
  const b = relativeLuminance(hexToRgb(hexB) || { r: 255, g: 255, b: 255 });
  const lighter = Math.max(a, b), darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG-safe text color for text sitting on `hex` as a background — picks
// whichever of black/white has the higher contrast ratio, so a school that
// picks bright yellow as a brand color never ends up with unreadable white
// text on it.
function pickAccessibleTextColor(hex) {
  const white = contrastRatio(hex, '#ffffff');
  const black = contrastRatio(hex, '#000000');
  return white >= black ? '#ffffff' : '#000000';
}

function deriveColorSet(hex) {
  if (!hex) return null;
  return {
    color: hex,
    dark: shiftLightness(hex, -0.14),
    light: shiftLightness(hex, 0.14),
    textColor: pickAccessibleTextColor(hex),
  };
}

// ---------------------------------------------------------------------------
// School resolution chain
// ---------------------------------------------------------------------------

async function resolveSchoolIdForPurchase(purchaseId) {
  try {
    const [[row]] = await pool.query('SELECT school_id FROM purchases WHERE id = ?', [purchaseId]);
    return row ? row.school_id : null;
  } catch {
    return null;
  }
}

// A teacher's school is resolved via their most-recently-registered active
// seat. A teacher with active seats at more than one school (uncommon, but
// not prevented elsewhere in this app) gets whichever seat they registered
// most recently — a documented simplification, not a full multi-school
// teacher experience.
async function resolveSchoolIdForTeacher(siteUserId) {
  try {
    const [[row]] = await pool.query(
      `SELECT p.school_id
       FROM license_seats ls
       JOIN purchases p ON p.id = ls.purchase_id
       WHERE ls.registered_site_user_id = ? AND ls.status = 'registered' AND p.school_id IS NOT NULL
       ORDER BY ls.registered_at DESC
       LIMIT 1`,
      [siteUserId]
    );
    return row ? row.school_id : null;
  } catch {
    return null;
  }
}

async function resolveSchoolIdForClassroom(classroomId) {
  try {
    const [[row]] = await pool.query('SELECT teacher_site_user_id FROM classrooms WHERE id = ?', [classroomId]);
    if (!row) return null;
    return resolveSchoolIdForTeacher(row.teacher_site_user_id);
  } catch {
    return null;
  }
}

async function resolveSchoolIdForStudent(studentId) {
  try {
    const [[row]] = await pool.query('SELECT classroom_id FROM classroom_students WHERE id = ?', [studentId]);
    if (!row) return null;
    return resolveSchoolIdForClassroom(row.classroom_id);
  } catch {
    return null;
  }
}

// A school optionally belongs to a district (schools.district_id, added by
// alter-create-districts.js) — used by getPublishedBranding's school →
// district → FNE-default fallback chain below.
async function resolveDistrictIdForSchool(schoolId) {
  if (!schoolId) return null;
  try {
    const [[row]] = await pool.query('SELECT district_id FROM schools WHERE id = ?', [schoolId]);
    return row ? row.district_id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Branding lookup
// ---------------------------------------------------------------------------

// Shared row->branding shape for both the school_branding and
// district_branding tables — same published_* columns, same derived
// shades/contrast colors, differing only in which display name column the
// caller's join provides.
function rowToBranding(row, displayName) {
  const primary = deriveColorSet(row.published_primary_color);
  const secondary = deriveColorSet(row.published_secondary_color);
  const accent = deriveColorSet(row.published_accent_color);

  return {
    schoolDisplayName: displayName,
    logoDisplayUrl: row.published_logo_display_url || null,
    primaryColor: primary && primary.color,
    primaryColorDark: primary && primary.dark,
    primaryColorLight: primary && primary.light,
    primaryTextColor: primary && primary.textColor,
    secondaryColor: secondary && secondary.color,
    secondaryColorDark: secondary && secondary.dark,
    secondaryColorLight: secondary && secondary.light,
    secondaryTextColor: secondary && secondary.textColor,
    accentColor: accent && accent.color,
    accentTextColor: accent && accent.textColor,
  };
}

// Returns null if there's no district, no branding row, or branding isn't
// published — mirrors getPublishedBranding's null-is-a-no-op contract below.
async function getPublishedDistrictBranding(districtId) {
  if (!districtId) return null;
  try {
    const [[row]] = await pool.query(
      `SELECT db.*, d.name
       FROM district_branding db
       JOIN districts d ON d.id = db.district_id
       WHERE db.district_id = ? AND db.branding_status = 'PUBLISHED'`,
      [districtId]
    );
    if (!row) return null;
    return rowToBranding(row, row.name);
  } catch {
    return null;
  }
}

// Returns null if there's no school, no branding anywhere in the chain, or
// nothing published — every caller treats null the same way: show FNE
// defaults. Resolution order: the school's own published branding first;
// if it has none, fall back to its district's published branding (if the
// school belongs to one); otherwise null. A school's own branding always
// wins over its district's — the district sets a default, not a mandate.
async function getPublishedBranding(schoolId) {
  if (!schoolId) return null;
  try {
    const [[row]] = await pool.query(
      `SELECT sb.*, s.display_name, s.domain
       FROM school_branding sb
       JOIN schools s ON s.id = sb.school_id
       WHERE sb.school_id = ? AND sb.branding_status = 'PUBLISHED'`,
      [schoolId]
    );
    if (row) return rowToBranding(row, row.display_name || row.domain);
  } catch {
    return null;
  }

  const districtId = await resolveDistrictIdForSchool(schoolId);
  return getPublishedDistrictBranding(districtId);
}

module.exports = {
  resolveSchoolIdForPurchase,
  resolveSchoolIdForTeacher,
  resolveSchoolIdForClassroom,
  resolveSchoolIdForStudent,
  resolveDistrictIdForSchool,
  getPublishedBranding,
  getPublishedDistrictBranding,
  pickAccessibleTextColor,
  shiftLightness,
};
