const pool = require('../db/pool');
const { DEMO_DISTRICT_NAME } = require('./sales-demo');

// State standards / Portrait-of-a-Graduate crosswalk -- data layer and review gate.
// Design, rules and access matrix: docs/standards-crosswalk/DESIGN.md.
//
// THE RULE EVERYTHING HERE SERVES: public readers only ever see rows a person has
// verified. That is enforced in the SQL of every getPublic* function (review_status =
// 'verified'), not in the route or the page, so there is no path by which a draft can
// leak. Editing a verified row sends it back to draft; an alignment can only be verified
// once the framework it hangs off is verified.
//
// SQL is deliberately plain (no NOW(), no ON DUPLICATE KEY, no array params) so the same
// statements run against MariaDB in production and SQLite in test/standards.test.js.

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const SEL_STATUSES = ['k12_standards', 'prek_only', 'guidance_only', 'none', 'unknown'];
const POG_STATUSES = ['statewide', 'state_led_in_progress', 'district_led_only', 'none', 'unknown'];
const FRAMEWORK_TYPES = ['sel_standards', 'portrait_of_graduate'];
const CASEL = ['self_awareness', 'self_management', 'social_awareness', 'relationship_skills', 'responsible_decision_making'];
const TARGET_TYPES = ['program', 'curriculum', 'brain_game'];
const STRENGTHS = ['direct', 'supporting'];

// ---- validation helpers -----------------------------------------------------------
function bad(message, status = 400) { return Object.assign(new Error(message), { status }); }
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const todayStr = () => new Date().toISOString().slice(0, 10);

function stateCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!STATES[c]) throw bad(`"${code}" is not a valid state code`);
  return c;
}
function oneOf(value, list, field) {
  if (!list.includes(value)) throw bad(`${field} must be one of: ${list.join(', ')}`);
  return value;
}
function text(value, max, field, { required = false } = {}) {
  const v = value == null ? '' : String(value).trim();
  if (!v) { if (required) throw bad(`${field} is required`); return null; }
  if (v.length > max) throw bad(`${field} must be ${max} characters or fewer`);
  return v;
}
function httpsUrl(value, field, { required = false } = {}) {
  const v = text(value, 500, field, { required });
  if (v == null) return null;
  let u; try { u = new URL(v); } catch { throw bad(`${field} must be a full https:// URL`); }
  if (u.protocol !== 'https:') throw bad(`${field} must be an https:// URL`);
  return v;
}
function dateOnly(value, field, { required = false } = {}) {
  const v = text(value, 10, field, { required });
  if (v == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${field} must be a date like 2026-10-26`);
  if (v > todayStr()) throw bad(`${field} can't be in the future`);
  return v;
}
function year(value, field) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1990 || n > 2100) throw bad(`${field} must be a year between 1990 and 2100`);
  return n;
}

// ---- row mappers (camelCase out; reviewer id is admin-only, never public) -----------
// Notes are written for the FNE reviewer ("confirm against the state's PDF", caveats about sources) and
// must never reach a public response, even for a verified record.
const forPublic = ({ notes, ...rest }) => rest;
const reviewFields = (r) => ({ reviewStatus: r.review_status, reviewedAt: r.reviewed_at || null });
function coverageOut(r, { admin = false } = {}) {
  return {
    stateCode: r.state_code, stateName: STATES[r.state_code],
    selStatus: r.sel_status, pogStatus: r.pog_status,
    selSourceUrl: r.sel_source_url || null, pogSourceUrl: r.pog_source_url || null,
    sourceAccessedOn: r.source_accessed_on || null, notes: r.notes || null,
    ...reviewFields(r), ...(admin ? { reviewedBy: r.reviewed_by || null } : {}),
  };
}
function frameworkOut(r, { admin = false } = {}) {
  return {
    id: r.id, stateCode: r.state_code, type: r.framework_type, name: r.name, issuingBody: r.issuing_body,
    officialUrl: r.official_url, adoptedYear: r.adopted_year || null, gradeSpan: r.grade_span || null,
    sourceAccessedOn: r.source_accessed_on, notes: r.notes || null,
    ...reviewFields(r),
    ...(admin ? { reviewedBy: r.reviewed_by || null, districtId: r.district_id || null, submittedAt: r.submitted_at || null, attestedAt: r.attested_at || null } : {}),
  };
}
const itemOut = (r) => ({
  id: r.id, frameworkId: r.framework_id, code: r.code, title: r.title, summary: r.summary || null,
  gradeBand: r.grade_band || null, caselCompetency: r.casel_competency || null, sortOrder: r.sort_order,
});

// =====================================================================================
// Coverage matrix (one row per jurisdiction)
// =====================================================================================
const COVERAGE_COLS = ['sel_status', 'pog_status', 'sel_source_url', 'pog_source_url', 'source_accessed_on', 'notes'];

async function upsertCoverage(codeIn, input) {
  const code = stateCode(codeIn);
  const next = {
    sel_status: oneOf(input.selStatus || 'unknown', SEL_STATUSES, 'selStatus'),
    pog_status: oneOf(input.pogStatus || 'unknown', POG_STATUSES, 'pogStatus'),
    sel_source_url: httpsUrl(input.selSourceUrl, 'selSourceUrl'),
    pog_source_url: httpsUrl(input.pogSourceUrl, 'pogSourceUrl'),
    source_accessed_on: dateOnly(input.sourceAccessedOn, 'sourceAccessedOn'),
    notes: text(input.notes, 1000, 'notes'),
  };
  const [[existing]] = await pool.query('SELECT * FROM standards_state_coverage WHERE state_code = ?', [code]);
  if (!existing) {
    await pool.query(
      `INSERT INTO standards_state_coverage (state_code, sel_status, pog_status, sel_source_url, pog_source_url, source_accessed_on, notes, review_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [code, next.sel_status, next.pog_status, next.sel_source_url, next.pog_source_url, next.source_accessed_on, next.notes, nowStr()]
    );
    return { changed: true };
  }
  if (COVERAGE_COLS.every(c => (existing[c] ?? null) === next[c])) return { changed: false };
  // Any edit to a reviewed row means the review no longer describes what's stored.
  await pool.query(
    `UPDATE standards_state_coverage SET sel_status = ?, pog_status = ?, sel_source_url = ?, pog_source_url = ?, source_accessed_on = ?, notes = ?,
       review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE state_code = ?`,
    [next.sel_status, next.pog_status, next.sel_source_url, next.pog_source_url, next.source_accessed_on, next.notes, nowStr(), code]
  );
  return { changed: true };
}

async function verifyCoverage(codeIn, adminId) {
  const code = stateCode(codeIn);
  const [[r]] = await pool.query('SELECT * FROM standards_state_coverage WHERE state_code = ?', [code]);
  if (!r) throw bad('No coverage record for that state yet', 404);
  // Both statuses must be an actual finding; "unknown" can't be a verified fact.
  if (r.sel_status === 'unknown' || r.pog_status === 'unknown') throw bad('Both the SEL and Portrait of a Graduate statuses must be determined (not "unknown") before this can be verified');
  if (!r.sel_source_url || !r.pog_source_url) throw bad('Both a SEL source URL and a Portrait of a Graduate source URL are required, including for a finding of "none" (cite where you looked)');
  if (!r.source_accessed_on) throw bad('Record the date the sources were checked');
  await pool.query(`UPDATE standards_state_coverage SET review_status = 'verified', reviewed_by = ?, reviewed_at = ? WHERE state_code = ?`, [adminId, nowStr(), code]);
}
async function unverifyCoverage(codeIn) {
  const code = stateCode(codeIn);
  await pool.query(`UPDATE standards_state_coverage SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE state_code = ?`, [code]);
}

// =====================================================================================
// Frameworks and their items
// =====================================================================================
function frameworkInput(input) {
  return {
    state_code: stateCode(input.stateCode),
    framework_type: oneOf(input.type, FRAMEWORK_TYPES, 'type'),
    name: text(input.name, 255, 'name', { required: true }),
    issuing_body: text(input.issuingBody, 255, 'issuingBody', { required: true }),
    official_url: httpsUrl(input.officialUrl, 'officialUrl', { required: true }),
    adopted_year: year(input.adoptedYear, 'adoptedYear'),
    grade_span: text(input.gradeSpan, 32, 'gradeSpan'),
    source_accessed_on: dateOnly(input.sourceAccessedOn, 'sourceAccessedOn', { required: true }),
    notes: text(input.notes, 1000, 'notes'),
  };
}
const FRAMEWORK_COLS = ['issuing_body', 'official_url', 'adopted_year', 'grade_span', 'source_accessed_on', 'notes'];

// An alignment was reviewed against specific standard text, so when a framework or its
// items change, every alignment under it goes back to draft.
async function draftAlignmentsForFramework(frameworkId) {
  await pool.query(
    `UPDATE standards_alignments SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL
     WHERE item_id IN (SELECT id FROM standards_items WHERE framework_id = ?)`, [frameworkId]);
}
async function draftFramework(frameworkId) {
  await pool.query(`UPDATE standards_frameworks SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?`, [nowStr(), frameworkId]);
  await draftAlignmentsForFramework(frameworkId);
}

// `input.districtId` (FNE admin acting on a district's behalf, or lib/district-standards.js) makes it a
// DISTRICT framework; without it this is a state framework. The two never share a name scope.
async function createFramework(input) {
  const f = frameworkInput(input);
  let districtId = null;
  if (input.districtId != null && input.districtId !== '') {
    districtId = Number(input.districtId);
    if (!Number.isInteger(districtId) || districtId <= 0) throw bad('districtId must be a district id');
    const [[d]] = await pool.query('SELECT id FROM districts WHERE id = ?', [districtId]);
    if (!d) throw bad('District not found', 404);
  }
  const ownerKey = districtId || 0;
  const [[dupe]] = await pool.query('SELECT id FROM standards_frameworks WHERE state_code = ? AND framework_type = ? AND name = ? AND owner_key = ?', [f.state_code, f.framework_type, f.name, ownerKey]);
  if (dupe) throw bad(districtId ? 'That district already has a framework of that type with that name' : 'That state already has a framework of that type with that name', 409);
  const [r] = await pool.query(
    `INSERT INTO standards_frameworks (state_code, framework_type, name, issuing_body, official_url, adopted_year, grade_span, source_accessed_on, notes, district_id, owner_key, review_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [f.state_code, f.framework_type, f.name, f.issuing_body, f.official_url, f.adopted_year, f.grade_span, f.source_accessed_on, f.notes, districtId, ownerKey, nowStr(), nowStr()]
  );
  return { id: r.insertId, changed: true };
}

async function updateFramework(id, input) {
  const [[existing]] = await pool.query('SELECT * FROM standards_frameworks WHERE id = ?', [id]);
  if (!existing) throw bad('Framework not found', 404);
  const f = frameworkInput({ ...input, stateCode: existing.state_code, type: existing.framework_type, name: input.name ?? existing.name });
  if (f.name === existing.name && FRAMEWORK_COLS.every(c => (existing[c] ?? null) === f[c])) return { id, changed: false };
  if (f.name !== existing.name) {
    const [[dupe]] = await pool.query('SELECT id FROM standards_frameworks WHERE state_code = ? AND framework_type = ? AND name = ? AND owner_key = ? AND id <> ?', [f.state_code, f.framework_type, f.name, existing.owner_key || 0, id]);
    if (dupe) throw bad('That state already has a framework of that type with that name', 409);
  }
  await pool.query(
    `UPDATE standards_frameworks SET name = ?, issuing_body = ?, official_url = ?, adopted_year = ?, grade_span = ?, source_accessed_on = ?, notes = ? WHERE id = ?`,
    [f.name, f.issuing_body, f.official_url, f.adopted_year, f.grade_span, f.source_accessed_on, f.notes, id]);
  await draftFramework(id);
  return { id, changed: true };
}

async function deleteFramework(id) {
  const [r] = await pool.query('DELETE FROM standards_frameworks WHERE id = ?', [id]);
  if (!r.affectedRows) throw bad('Framework not found', 404);
}

function itemInput(i, index) {
  return {
    code: text(i.code, 64, `items[${index}].code`, { required: true }),
    title: text(i.title, 255, `items[${index}].title`, { required: true }),
    summary: text(i.summary, 600, `items[${index}].summary`),
    grade_band: text(i.gradeBand, 32, `items[${index}].gradeBand`),
    casel_competency: i.caselCompetency ? oneOf(i.caselCompetency, CASEL, `items[${index}].caselCompetency`) : null,
    sort_order: Number.isInteger(i.sortOrder) ? i.sortOrder : index,
  };
}
const ITEM_COLS = ['title', 'summary', 'grade_band', 'casel_competency', 'sort_order'];

// Bulk add/update items by code. Re-sending identical data changes nothing (so a repeat
// import never disturbs an existing verification).
async function upsertItems(frameworkId, items) {
  if (!Array.isArray(items) || !items.length) throw bad('items must be a non-empty array');
  if (items.length > 500) throw bad('At most 500 items per request');
  const [[fw]] = await pool.query('SELECT id FROM standards_frameworks WHERE id = ?', [frameworkId]);
  if (!fw) throw bad('Framework not found', 404);
  const clean = items.map(itemInput);
  const seen = new Set();
  for (const c of clean) { if (seen.has(c.code)) throw bad(`Duplicate item code in request: ${c.code}`); seen.add(c.code); }

  let added = 0, updated = 0;
  for (const c of clean) {
    const [[existing]] = await pool.query('SELECT * FROM standards_items WHERE framework_id = ? AND code = ?', [frameworkId, c.code]);
    if (!existing) {
      await pool.query(
        `INSERT INTO standards_items (framework_id, code, title, summary, grade_band, casel_competency, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [frameworkId, c.code, c.title, c.summary, c.grade_band, c.casel_competency, c.sort_order]);
      added++;
    } else if (!ITEM_COLS.every(col => (existing[col] ?? null) === c[col])) {
      await pool.query(
        `UPDATE standards_items SET title = ?, summary = ?, grade_band = ?, casel_competency = ?, sort_order = ? WHERE id = ?`,
        [c.title, c.summary, c.grade_band, c.casel_competency, c.sort_order, existing.id]);
      await pool.query(
        `UPDATE standards_alignments SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE item_id = ?`, [existing.id]);
      updated++;
    }
  }
  // Any change to what the framework contains invalidates the review of the framework itself.
  if (added || updated) await pool.query(`UPDATE standards_frameworks SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?`, [nowStr(), frameworkId]);
  return { added, updated, unchanged: clean.length - added - updated };
}

async function deleteItem(itemId) {
  const [[item]] = await pool.query('SELECT framework_id FROM standards_items WHERE id = ?', [itemId]);
  if (!item) throw bad('Item not found', 404);
  await pool.query('DELETE FROM standards_items WHERE id = ?', [itemId]);
  await pool.query(`UPDATE standards_frameworks SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?`, [nowStr(), item.framework_id]);
}

async function verifyFramework(id, adminId) {
  const [[fw]] = await pool.query('SELECT * FROM standards_frameworks WHERE id = ?', [id]);
  if (!fw) throw bad('Framework not found', 404);
  if (!fw.official_url || !String(fw.official_url).startsWith('https://')) throw bad('An https:// official URL is required');
  if (!fw.source_accessed_on) throw bad('Record the date the source was checked');
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM standards_items WHERE framework_id = ?', [id]);
  if (!n.n) throw bad('A framework with no items can\'t be verified');
  await pool.query(`UPDATE standards_frameworks SET review_status = 'verified', reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [adminId, nowStr(), id]);
}
async function unverifyFramework(id) {
  const [[fw]] = await pool.query('SELECT id FROM standards_frameworks WHERE id = ?', [id]);
  if (!fw) throw bad('Framework not found', 404);
  // Alignments only count while their framework is verified, so pulling the framework pulls them too.
  await draftFramework(id);
}

// =====================================================================================
// Alignments (FNE content <-> standard)
// =====================================================================================
const hasRealRationale = (r) => String(r || '').trim().length >= 20;

async function targetExists(type, id) {
  if (type === 'program') return true;
  const table = type === 'curriculum' ? 'curricula' : 'brain_games';
  const [[r]] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  return !!r;
}

async function upsertAlignment(input) {
  const itemId = Number(input.itemId);
  if (!Number.isInteger(itemId)) throw bad('itemId is required');
  const [[item]] = await pool.query('SELECT id FROM standards_items WHERE id = ?', [itemId]);
  if (!item) throw bad('Item not found', 404);
  const targetType = oneOf(input.targetType, TARGET_TYPES, 'targetType');
  let targetId = 0;
  if (targetType !== 'program') {
    targetId = Number(input.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw bad('targetId is required for curriculum and brain_game targets');
    if (!(await targetExists(targetType, targetId))) throw bad(`No ${targetType} with id ${targetId}`, 404);
  }
  const strength = oneOf(input.strength, STRENGTHS, 'strength');
  const rationale = text(input.rationale, 1000, 'rationale', { required: true });
  if (rationale.length < 20) throw bad('rationale should explain the connection (at least 20 characters) -- a reviewer needs something to check');

  const [[existing]] = await pool.query('SELECT * FROM standards_alignments WHERE item_id = ? AND target_type = ? AND target_id = ?', [itemId, targetType, targetId]);
  if (!existing) {
    const [r] = await pool.query(
      `INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [itemId, targetType, targetId, strength, rationale, nowStr(), nowStr()]);
    return { id: r.insertId, changed: true };
  }
  if (existing.strength === strength && existing.rationale === rationale) return { id: existing.id, changed: false };
  await pool.query(
    `UPDATE standards_alignments SET strength = ?, rationale = ?, review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?`,
    [strength, rationale, nowStr(), existing.id]);
  return { id: existing.id, changed: true };
}

async function deleteAlignment(id) {
  const [r] = await pool.query('DELETE FROM standards_alignments WHERE id = ?', [id]);
  if (!r.affectedRows) throw bad('Alignment not found', 404);
}

async function verifyAlignment(id, adminId) {
  const [[a]] = await pool.query(
    `SELECT a.*, f.review_status AS fw_status FROM standards_alignments a
     JOIN standards_items i ON i.id = a.item_id JOIN standards_frameworks f ON f.id = i.framework_id WHERE a.id = ?`, [id]);
  if (!a) throw bad('Alignment not found', 404);
  if (a.fw_status !== 'verified') throw bad('Verify the framework first -- an alignment can only be verified against a framework that has itself been verified');
  if (!hasRealRationale(a.rationale)) throw bad('Write the rationale first -- a connection suggested by a district has none until FNE explains it');
  if (!(await targetExists(a.target_type, a.target_id))) throw bad('The FNE content this points at no longer exists');
  await pool.query(`UPDATE standards_alignments SET review_status = 'verified', reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [adminId, nowStr(), id]);
}

// Verify every DRAFT alignment under one standard in one step (the reviewer has read them
// all). Same rule as verifyAlignment: the framework must already be verified, and the FNE
// content each one points at must still exist -- those that don't are skipped and counted.
async function verifyAlignmentsForItem(itemId, adminId) {
  const [[it]] = await pool.query(
    `SELECT i.id, f.review_status AS fw_status FROM standards_items i JOIN standards_frameworks f ON f.id = i.framework_id WHERE i.id = ?`, [itemId]);
  if (!it) throw bad('Standard not found', 404);
  if (it.fw_status !== 'verified') throw bad('Verify the framework first -- alignments can only be verified against a framework that has itself been verified');
  const [drafts] = await pool.query(`SELECT id, target_type, target_id, rationale FROM standards_alignments WHERE item_id = ? AND review_status = 'draft'`, [itemId]);
  let verified = 0, skipped = 0;
  for (const a of drafts) {
    if (!hasRealRationale(a.rationale) || !(await targetExists(a.target_type, a.target_id))) { skipped++; continue; }
    await pool.query(`UPDATE standards_alignments SET review_status = 'verified', reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [adminId, nowStr(), a.id]);
    verified++;
  }
  return { verified, skipped };
}

async function unverifyAlignment(id) {
  const [r] = await pool.query(`UPDATE standards_alignments SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`, [id]);
  if (!r.affectedRows) throw bad('Alignment not found', 404);
}

// =====================================================================================
// Reads
// =====================================================================================

// ---- PUBLIC: verified rows only, enforced in the SQL itself ------------------------

// ---- lesson families ------------------------------------------------------------------
// FNE publishes each lesson in elementary, middle, high school and higher-education
// versions. Their objectives are identical, so an alignment is a claim about the LESSON
// and it applies to every version. The versions share a title stem ("Pause Before You
// Escalate"), which is everything before " - Lesson Plan". Higher education is outside
// K-12 standards, so it is never listed on a state page.
const LEVELS = {
  'Elementary School': { key: 'elementary', label: 'Elementary', grades: 'K-5', order: 1 },
  'Middle School':     { key: 'middle',     label: 'Middle',     grades: '6-8', order: 2 },
  'High School':       { key: 'high',       label: 'High school', grades: '9-12', order: 3 },
};
const lessonStem = (title) => String(title || '').split(/\s*-\s*Lesson Plan/i)[0].trim();
const likeEscape = (v) => String(v).replace(/[!%_]/g, '!$&');

async function lessonVersionsByStem(stems) {
  const out = new Map();
  for (const stem of new Set(stems.filter(Boolean))) {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, a.audience FROM curricula c
       LEFT JOIN curriculum_audiences a ON a.curriculum_id = c.id
       WHERE c.published = 1 AND c.title LIKE ? ESCAPE '!'`, [likeEscape(stem) + '%']);
    const seen = new Set(), versions = [];
    for (const r of rows) {
      const lvl = LEVELS[r.audience];
      if (!lvl || lessonStem(r.title) !== stem || seen.has(lvl.key)) continue;
      seen.add(lvl.key);
      versions.push({ id: r.id, level: lvl.key, label: lvl.label, grades: lvl.grades, order: lvl.order });
    }
    out.set(stem, versions.sort((a, b) => a.order - b.order).map(({ order, ...v }) => v));
  }
  return out;
}

async function getPublicOverview() {
  const [rows] = await pool.query(`SELECT * FROM standards_state_coverage WHERE review_status = 'verified' ORDER BY state_code`);
  const [counts] = await pool.query(
    `SELECT state_code, COUNT(*) AS n FROM standards_frameworks WHERE review_status = 'verified' AND district_id IS NULL GROUP BY state_code`);
  const byState = Object.fromEntries(counts.map(c => [c.state_code, Number(c.n)]));
  const [dcounts] = await pool.query(
    `SELECT f.state_code, COUNT(DISTINCT f.district_id) AS n FROM standards_frameworks f JOIN districts d ON d.id = f.district_id
     WHERE f.review_status = 'verified' AND d.name <> ? GROUP BY f.state_code`, [DEMO_DISTRICT_NAME]);
  const districtsBy = Object.fromEntries(dcounts.map(c => [c.state_code, Number(c.n)]));
  return {
    verifiedStates: rows.length,
    totalJurisdictions: Object.keys(STATES).length,
    states: rows.map(r => ({ ...forPublic(coverageOut(r)), verifiedFrameworks: byState[r.state_code] || 0, verifiedDistricts: districtsBy[r.state_code] || 0 })),
  };
}

// Turns framework rows into the page shape: items, and each item's FNE connections. Used for
// state pages and district pages alike, so the connection rules (published lessons only, grade
// versions, no blank rationale on the public path) live in exactly one place.
async function assembleFrameworks(fws, includeDrafts) {
  const AV = includeDrafts ? '' : " AND a.review_status = 'verified' AND a.rationale <> ''";
  const frameworks = [];
  for (const fw of fws) {
    const [items] = await pool.query('SELECT * FROM standards_items WHERE framework_id = ? ORDER BY sort_order, code', [fw.id]);
    const [aligns] = await pool.query(
      `SELECT a.item_id, a.review_status, a.target_type, a.target_id, a.strength, a.rationale, c.title AS curriculum_title, g.name AS game_name
       FROM standards_alignments a
       JOIN standards_items i ON i.id = a.item_id
       LEFT JOIN curricula c ON a.target_type = 'curriculum' AND c.id = a.target_id AND c.published = 1
       LEFT JOIN brain_games g ON a.target_type = 'brain_game' AND g.id = a.target_id
       WHERE i.framework_id = ?${AV}`, [fw.id]);
    const visible = aligns.filter(a => a.target_type === 'program'
      || (a.target_type === 'curriculum' && a.curriculum_title)   // unpublished or deleted lessons never show
      || (a.target_type === 'brain_game' && a.game_name));
    const versions = await lessonVersionsByStem(visible.filter(a => a.target_type === 'curriculum').map(a => lessonStem(a.curriculum_title)));
    const byItem = {};
    for (const a of visible) {
      const isLesson = a.target_type === 'curriculum';
      (byItem[a.item_id] = byItem[a.item_id] || []).push({
        targetType: a.target_type, targetId: a.target_id || null,
        targetTitle: a.target_type === 'program' ? 'Fixer Nation Education program' : (isLesson ? lessonStem(a.curriculum_title) : a.game_name),
        ...(isLesson ? { versions: versions.get(lessonStem(a.curriculum_title)) || [] } : {}),
        strength: a.strength, rationale: a.rationale,
        ...(includeDrafts ? { draft: a.review_status !== 'verified' } : {}),
      });
    }
    frameworks.push({ ...forPublic(frameworkOut(fw)), ...(includeDrafts ? { draft: fw.review_status !== 'verified' } : {}), items: items.map(it => ({ ...itemOut(it), alignments: byItem[it.id] || [] })) });
  }
  return frameworks;
}

// Districts that have a framework in this state. Public: verified frameworks only, and never the
// sales-demo district. Preview (admin only): everything, each row marked.
async function districtsForState(code, includeDrafts) {
  const V = includeDrafts ? '' : " AND f.review_status = 'verified' AND d.name <> ?";
  const [rows] = await pool.query(
    `SELECT f.district_id, d.name AS district_name, f.id AS framework_id, f.framework_type, f.name, f.review_status
     FROM standards_frameworks f JOIN districts d ON d.id = f.district_id
     WHERE f.state_code = ?${V} ORDER BY d.name, f.framework_type, f.name`,
    includeDrafts ? [code] : [code, DEMO_DISTRICT_NAME]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.district_id)) out.set(r.district_id, { id: r.district_id, name: r.district_name, frameworks: [] });
    out.get(r.district_id).frameworks.push({ type: r.framework_type, name: r.name, ...(includeDrafts ? { draft: r.review_status !== 'verified' } : {}) });
  }
  return [...out.values()];
}

async function buildState(codeIn, includeDrafts) {
  // `includeDrafts` is passed ONLY by the admin-only preview functions below. The public path
  // (getPublicState) always passes false, so the verified-only filter stays in the SQL.
  const V = includeDrafts ? '' : " AND review_status = 'verified'";
  const code = stateCode(codeIn);
  const [[cov]] = await pool.query(`SELECT * FROM standards_state_coverage WHERE state_code = ?${V}`, [code]);
  // district_id IS NULL: a district's framework is never part of its STATE's own list.
  const [fws] = await pool.query(
    `SELECT * FROM standards_frameworks WHERE state_code = ? AND district_id IS NULL${V} ORDER BY framework_type, name`, [code]);
  const districts = await districtsForState(code, includeDrafts);
  if (!cov && !fws.length && !districts.length) return null; // nothing verified for this state yet -- indistinguishable from "no data"
  const frameworks = await assembleFrameworks(fws, includeDrafts);
  return { state: { code, name: STATES[code] }, coverage: cov ? { ...forPublic(coverageOut(cov)), ...(includeDrafts ? { draft: cov.review_status !== 'verified' } : {}) } : null, frameworks, districts };
}

// ---- PUBLIC district page ----------------------------------------------------------------
// One district's VERIFIED frameworks. The sales-demo district is excluded in the SQL, so a demo
// framework is invisible here even if an FNE admin verifies it. Preview (admin) sees everything.
async function buildDistrict(districtIdIn, includeDrafts) {
  const districtId = Number(districtIdIn);
  if (!Number.isInteger(districtId) || districtId <= 0) return null;
  const [[d]] = await pool.query('SELECT id, name FROM districts WHERE id = ?', [districtId]);
  if (!d) return null;
  const isDemo = d.name === DEMO_DISTRICT_NAME;
  if (isDemo && !includeDrafts) return null;
  const V = includeDrafts ? '' : " AND review_status = 'verified'";
  const [fws] = await pool.query(`SELECT * FROM standards_frameworks WHERE district_id = ?${V} ORDER BY framework_type, name`, [districtId]);
  if (!fws.length) return null; // no verified framework -- indistinguishable from "no such district"
  const frameworks = await assembleFrameworks(fws, includeDrafts);
  const code = fws[0].state_code;
  return { district: { id: d.id, name: d.name, ...(includeDrafts ? { demo: isDemo } : {}) }, state: { code, name: STATES[code] }, frameworks };
}

async function getPublicState(codeIn) { return buildState(codeIn, false); }
async function getPublicDistrict(id) { return buildDistrict(id, false); }
async function getPreviewDistrict(id) { return buildDistrict(id, true); }
// Admin-only: the same page data INCLUDING drafts, each marked `draft: true`. Reachable only via
// the requireAuth router; the public routes never call it.
async function getPreviewState(codeIn) { return buildState(codeIn, true); }
async function getPreviewOverview() {
  const [rows] = await pool.query('SELECT * FROM standards_state_coverage ORDER BY state_code');
  const [counts] = await pool.query('SELECT state_code, COUNT(*) AS n FROM standards_frameworks WHERE district_id IS NULL GROUP BY state_code');
  const byState = Object.fromEntries(counts.map(c => [c.state_code, Number(c.n)]));
  const states = rows.map(r => ({ ...forPublic(coverageOut(r)), draft: r.review_status !== 'verified', verifiedFrameworks: byState[r.state_code] || 0 }))
    .concat(Object.keys(byState).filter(c => !rows.some(r => r.state_code === c)).map(c => ({ stateCode: c, stateName: STATES[c], draft: true, verifiedFrameworks: byState[c] })));
  return { verifiedStates: states.length, totalJurisdictions: Object.keys(STATES).length, preview: true, states: states.sort((x, y) => x.stateCode.localeCompare(y.stateCode)) };
}

// ---- ADMIN: everything, with review status ------------------------------------------
async function getAdminOverview() {
  const [cov] = await pool.query('SELECT * FROM standards_state_coverage');
  const [fws] = await pool.query('SELECT state_code, review_status, COUNT(*) AS n FROM standards_frameworks WHERE district_id IS NULL GROUP BY state_code, review_status');
  const [als] = await pool.query(
    `SELECT f.state_code, a.review_status, COUNT(*) AS n FROM standards_alignments a
     JOIN standards_items i ON i.id = a.item_id JOIN standards_frameworks f ON f.id = i.framework_id WHERE f.district_id IS NULL GROUP BY f.state_code, a.review_status`);
  const covBy = Object.fromEntries(cov.map(c => [c.state_code, c]));
  const tally = (rows, key) => rows.reduce((m, r) => { (m[r.state_code] = m[r.state_code] || { draft: 0, verified: 0 })[r.review_status] = Number(r.n); return m; }, {});
  const fwBy = tally(fws), alBy = tally(als);
  return Object.keys(STATES).sort().map(code => ({
    stateCode: code, stateName: STATES[code],
    coverage: covBy[code] ? coverageOut(covBy[code], { admin: true }) : null,
    frameworks: { draft: 0, verified: 0, ...(fwBy[code] || {}) },
    alignments: { draft: 0, verified: 0, ...(alBy[code] || {}) },
  }));
}

async function getAdminState(codeIn) {
  const code = stateCode(codeIn);
  const [[cov]] = await pool.query('SELECT * FROM standards_state_coverage WHERE state_code = ?', [code]);
  const [fws] = await pool.query('SELECT * FROM standards_frameworks WHERE state_code = ? AND district_id IS NULL ORDER BY framework_type, name', [code]);
  const frameworks = [];
  for (const fw of fws) frameworks.push(await getAdminFramework(fw.id));
  return { state: { code, name: STATES[code] }, coverage: cov ? coverageOut(cov, { admin: true }) : null, frameworks };
}

async function getAdminFramework(id) {
  const [[fw]] = await pool.query('SELECT * FROM standards_frameworks WHERE id = ?', [id]);
  if (!fw) throw bad('Framework not found', 404);
  const [items] = await pool.query('SELECT * FROM standards_items WHERE framework_id = ? ORDER BY sort_order, code', [id]);
  const [aligns] = await pool.query(
    `SELECT a.* FROM standards_alignments a JOIN standards_items i ON i.id = a.item_id WHERE i.framework_id = ? ORDER BY a.id`, [id]);
  const byItem = {};
  for (const a of aligns) {
    (byItem[a.item_id] = byItem[a.item_id] || []).push({
      id: a.id, targetType: a.target_type, targetId: a.target_id || null, strength: a.strength, rationale: a.rationale,
      suggestedByDistrict: !!a.suggested_by_site_user_id, districtNote: a.district_note || null,
      ...reviewFields(a), reviewedBy: a.reviewed_by || null,
    });
  }
  return { ...frameworkOut(fw, { admin: true }), items: items.map(it => ({ ...itemOut(it), alignments: byItem[it.id] || [] })) };
}

// Every district framework with its submission state, for the admin "District frameworks" tab.
// Awaiting-review rows (draft + submitted) come first.
async function getAdminDistrictQueue() {
  const [rows] = await pool.query(
    `SELECT f.id, f.district_id, d.name AS district_name, f.state_code, f.framework_type, f.name, f.review_status, f.submitted_at,
       (SELECT COUNT(*) FROM standards_items i WHERE i.framework_id = f.id) AS item_count,
       (SELECT COUNT(*) FROM standards_alignments a JOIN standards_items i ON i.id = a.item_id
         WHERE i.framework_id = f.id AND a.review_status = 'draft') AS draft_connections,
       (SELECT COUNT(*) FROM standards_alignments a JOIN standards_items i ON i.id = a.item_id
         WHERE i.framework_id = f.id AND a.suggested_by_site_user_id IS NOT NULL AND a.review_status = 'draft') AS suggested_connections
     FROM standards_frameworks f JOIN districts d ON d.id = f.district_id
     ORDER BY CASE WHEN f.review_status = 'draft' AND f.submitted_at IS NOT NULL THEN 0 WHEN f.review_status = 'draft' THEN 1 ELSE 2 END,
       f.submitted_at, d.name, f.name`);
  return rows.map(r => ({
    id: r.id, districtId: r.district_id, districtName: r.district_name, demo: r.district_name === DEMO_DISTRICT_NAME,
    stateCode: r.state_code, stateName: STATES[r.state_code], type: r.framework_type, name: r.name,
    reviewStatus: r.review_status, submittedAt: r.submitted_at || null, awaitingReview: r.review_status === 'draft' && !!r.submitted_at,
    itemCount: Number(r.item_count), draftConnections: Number(r.draft_connections), suggestedConnections: Number(r.suggested_connections),
  }));
}

// Shared with lib/district-standards.js (one set of validators, one set of row mappers).
const internals = {
  bad, text, httpsUrl, dateOnly, year, stateCode, oneOf, nowStr, frameworkInput, FRAMEWORK_COLS, frameworkOut, itemOut, forPublic,
  draftFramework, targetExists, lessonStem, lessonVersionsByStem, hasRealRationale,
};

module.exports = {
  internals, getAdminDistrictQueue,
  STATES, SEL_STATUSES, POG_STATUSES, FRAMEWORK_TYPES, CASEL, TARGET_TYPES, STRENGTHS,
  upsertCoverage, verifyCoverage, unverifyCoverage,
  createFramework, updateFramework, deleteFramework, upsertItems, deleteItem, verifyFramework, unverifyFramework,
  upsertAlignment, deleteAlignment, verifyAlignment, verifyAlignmentsForItem, unverifyAlignment,
  getPublicDistrict, getPreviewDistrict,
  getPublicOverview, getPublicState, getPreviewState, getPreviewOverview, getAdminOverview, getAdminState, getAdminFramework,
};
