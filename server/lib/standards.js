const pool = require('../db/pool');

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
    ...reviewFields(r), ...(admin ? { reviewedBy: r.reviewed_by || null } : {}),
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

async function createFramework(input) {
  const f = frameworkInput(input);
  const [[dupe]] = await pool.query('SELECT id FROM standards_frameworks WHERE state_code = ? AND framework_type = ? AND name = ?', [f.state_code, f.framework_type, f.name]);
  if (dupe) throw bad('That state already has a framework of that type with that name', 409);
  const [r] = await pool.query(
    `INSERT INTO standards_frameworks (state_code, framework_type, name, issuing_body, official_url, adopted_year, grade_span, source_accessed_on, notes, review_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [f.state_code, f.framework_type, f.name, f.issuing_body, f.official_url, f.adopted_year, f.grade_span, f.source_accessed_on, f.notes, nowStr(), nowStr()]
  );
  return { id: r.insertId, changed: true };
}

async function updateFramework(id, input) {
  const [[existing]] = await pool.query('SELECT * FROM standards_frameworks WHERE id = ?', [id]);
  if (!existing) throw bad('Framework not found', 404);
  const f = frameworkInput({ ...input, stateCode: existing.state_code, type: existing.framework_type, name: input.name ?? existing.name });
  if (f.name === existing.name && FRAMEWORK_COLS.every(c => (existing[c] ?? null) === f[c])) return { id, changed: false };
  if (f.name !== existing.name) {
    const [[dupe]] = await pool.query('SELECT id FROM standards_frameworks WHERE state_code = ? AND framework_type = ? AND name = ? AND id <> ?', [f.state_code, f.framework_type, f.name, id]);
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
  if (!(await targetExists(a.target_type, a.target_id))) throw bad('The FNE content this points at no longer exists');
  await pool.query(`UPDATE standards_alignments SET review_status = 'verified', reviewed_by = ?, reviewed_at = ? WHERE id = ?`, [adminId, nowStr(), id]);
}
async function unverifyAlignment(id) {
  const [r] = await pool.query(`UPDATE standards_alignments SET review_status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?`, [id]);
  if (!r.affectedRows) throw bad('Alignment not found', 404);
}

// =====================================================================================
// Reads
// =====================================================================================

// ---- PUBLIC: verified rows only, enforced in the SQL itself ------------------------
async function getPublicOverview() {
  const [rows] = await pool.query(`SELECT * FROM standards_state_coverage WHERE review_status = 'verified' ORDER BY state_code`);
  const [counts] = await pool.query(
    `SELECT state_code, COUNT(*) AS n FROM standards_frameworks WHERE review_status = 'verified' GROUP BY state_code`);
  const byState = Object.fromEntries(counts.map(c => [c.state_code, Number(c.n)]));
  return {
    verifiedStates: rows.length,
    totalJurisdictions: Object.keys(STATES).length,
    states: rows.map(r => ({ ...forPublic(coverageOut(r)), verifiedFrameworks: byState[r.state_code] || 0 })),
  };
}

async function getPublicState(codeIn) {
  const code = stateCode(codeIn);
  const [[cov]] = await pool.query(`SELECT * FROM standards_state_coverage WHERE state_code = ? AND review_status = 'verified'`, [code]);
  const [fws] = await pool.query(
    `SELECT * FROM standards_frameworks WHERE state_code = ? AND review_status = 'verified' ORDER BY framework_type, name`, [code]);
  if (!cov && !fws.length) return null; // nothing verified for this state yet -- indistinguishable from "no data"

  const frameworks = [];
  for (const fw of fws) {
    const [items] = await pool.query('SELECT * FROM standards_items WHERE framework_id = ? ORDER BY sort_order, code', [fw.id]);
    const [aligns] = await pool.query(
      `SELECT a.item_id, a.target_type, a.target_id, a.strength, a.rationale, c.title AS curriculum_title, g.name AS game_name
       FROM standards_alignments a
       JOIN standards_items i ON i.id = a.item_id
       LEFT JOIN curricula c ON a.target_type = 'curriculum' AND c.id = a.target_id AND c.published = 1
       LEFT JOIN brain_games g ON a.target_type = 'brain_game' AND g.id = a.target_id
       WHERE i.framework_id = ? AND a.review_status = 'verified'`, [fw.id]);
    const visible = aligns.filter(a => a.target_type === 'program'
      || (a.target_type === 'curriculum' && a.curriculum_title)   // unpublished or deleted lessons never show
      || (a.target_type === 'brain_game' && a.game_name));
    const byItem = {};
    for (const a of visible) {
      (byItem[a.item_id] = byItem[a.item_id] || []).push({
        targetType: a.target_type, targetId: a.target_id || null,
        targetTitle: a.target_type === 'program' ? 'Fixer Nation Education program' : (a.curriculum_title || a.game_name),
        strength: a.strength, rationale: a.rationale,
      });
    }
    frameworks.push({ ...forPublic(frameworkOut(fw)), items: items.map(it => ({ ...itemOut(it), alignments: byItem[it.id] || [] })) });
  }
  return { state: { code, name: STATES[code] }, coverage: cov ? forPublic(coverageOut(cov)) : null, frameworks };
}

// ---- ADMIN: everything, with review status ------------------------------------------
async function getAdminOverview() {
  const [cov] = await pool.query('SELECT * FROM standards_state_coverage');
  const [fws] = await pool.query('SELECT state_code, review_status, COUNT(*) AS n FROM standards_frameworks GROUP BY state_code, review_status');
  const [als] = await pool.query(
    `SELECT f.state_code, a.review_status, COUNT(*) AS n FROM standards_alignments a
     JOIN standards_items i ON i.id = a.item_id JOIN standards_frameworks f ON f.id = i.framework_id GROUP BY f.state_code, a.review_status`);
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
  const [fws] = await pool.query('SELECT * FROM standards_frameworks WHERE state_code = ? ORDER BY framework_type, name', [code]);
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
      ...reviewFields(a), reviewedBy: a.reviewed_by || null,
    });
  }
  return { ...frameworkOut(fw, { admin: true }), items: items.map(it => ({ ...itemOut(it), alignments: byItem[it.id] || [] })) };
}

module.exports = {
  STATES, SEL_STATUSES, POG_STATUSES, FRAMEWORK_TYPES, CASEL, TARGET_TYPES, STRENGTHS,
  upsertCoverage, verifyCoverage, unverifyCoverage,
  createFramework, updateFramework, deleteFramework, upsertItems, deleteItem, verifyFramework, unverifyFramework,
  upsertAlignment, deleteAlignment, verifyAlignment, unverifyAlignment,
  getPublicOverview, getPublicState, getAdminOverview, getAdminState, getAdminFramework,
};
