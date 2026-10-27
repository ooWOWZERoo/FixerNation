const pool = require('../db/pool');
const standards = require('./standards');

// Per-district frameworks: what a DISTRICT ADMIN may do with their own district's Portrait of a
// Graduate / SEL framework. Requirements and access matrix:
// docs/standards-crosswalk/DISTRICT-FRAMEWORKS-REQUIREMENTS.md.
//
// SCOPE IS THE WHOLE POINT OF THIS FILE. Every function takes `districtIds` (the districts the
// logged-in admin holds an active assignment for, from req.districtAdmin.districtIds -- already
// narrowed to the demo district for a sales-demo account) and resolves every framework / item /
// alignment id THROUGH the framework's district_id before reading or writing anything. A record that
// exists but belongs to someone else answers exactly like one that doesn't exist (404), so ids can't
// be probed. Nothing here can verify: only lib/standards.js verify* (FNE admin routes) publishes.

const { bad, text, nowStr, frameworkInput, FRAMEWORK_COLS, frameworkOut, itemOut, draftFramework, targetExists, lessonStem } = standards.internals;

const MAX_FRAMEWORKS_PER_DISTRICT = 3;
const MAX_ITEMS_PER_FRAMEWORK = 60;
const NOT_FOUND = 'Not found';

function posInt(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${field} must be an id`);
  return n;
}
const ids = (districtIds) => (districtIds || []).map(Number);

// The district the request names, if (and only if) it is one of the admin's own.
function ownDistrict(districtIds, districtIdIn) {
  const id = Number(districtIdIn);
  if (!Number.isInteger(id) || !ids(districtIds).includes(id)) throw bad(NOT_FOUND, 404);
  return id;
}

async function ownFramework(districtIds, frameworkIdIn) {
  const id = Number(frameworkIdIn);
  if (!Number.isInteger(id) || id <= 0) throw bad(NOT_FOUND, 404);
  const [[fw]] = await pool.query('SELECT * FROM standards_frameworks WHERE id = ? AND district_id IS NOT NULL', [id]);
  if (!fw || !ids(districtIds).includes(Number(fw.district_id))) throw bad(NOT_FOUND, 404);
  return fw;
}

async function ownItem(districtIds, itemIdIn) {
  const id = Number(itemIdIn);
  if (!Number.isInteger(id) || id <= 0) throw bad(NOT_FOUND, 404);
  const [[row]] = await pool.query(
    `SELECT i.id, i.framework_id, f.district_id FROM standards_items i JOIN standards_frameworks f ON f.id = i.framework_id
     WHERE i.id = ? AND f.district_id IS NOT NULL`, [id]);
  if (!row || !ids(districtIds).includes(Number(row.district_id))) throw bad(NOT_FOUND, 404);
  return row;
}

async function ownAlignment(districtIds, alignmentIdIn) {
  const id = Number(alignmentIdIn);
  if (!Number.isInteger(id) || id <= 0) throw bad(NOT_FOUND, 404);
  const [[row]] = await pool.query(
    `SELECT a.*, f.district_id FROM standards_alignments a
     JOIN standards_items i ON i.id = a.item_id JOIN standards_frameworks f ON f.id = i.framework_id
     WHERE a.id = ? AND f.district_id IS NOT NULL`, [id]);
  if (!row || !ids(districtIds).includes(Number(row.district_id))) throw bad(NOT_FOUND, 404);
  return row;
}

// Any change by the district takes the framework off the review queue; they resubmit when ready.
const unsubmit = (frameworkId) => pool.query(
  'UPDATE standards_frameworks SET submitted_at = NULL, submitted_by_site_user_id = NULL WHERE id = ?', [frameworkId]);

// ---- reads (the district's OWN view: drafts included, scoped) ----------------------------
async function targetTitles(aligns) {
  const lessonIds = aligns.filter(a => a.target_type === 'curriculum').map(a => a.target_id);
  const gameIds = aligns.filter(a => a.target_type === 'brain_game').map(a => a.target_id);
  const titles = new Map();
  for (const id of new Set(lessonIds)) {
    const [[c]] = await pool.query('SELECT title FROM curricula WHERE id = ?', [id]);
    if (c) titles.set('curriculum:' + id, lessonStem(c.title));
  }
  for (const id of new Set(gameIds)) {
    const [[g]] = await pool.query('SELECT name FROM brain_games WHERE id = ?', [id]);
    if (g) titles.set('brain_game:' + id, g.name);
  }
  return titles;
}

async function frameworkView(fw) {
  const [items] = await pool.query('SELECT * FROM standards_items WHERE framework_id = ? ORDER BY sort_order, code', [fw.id]);
  const [aligns] = await pool.query(
    `SELECT a.* FROM standards_alignments a JOIN standards_items i ON i.id = a.item_id WHERE i.framework_id = ? ORDER BY a.id`, [fw.id]);
  const titles = await targetTitles(aligns);
  const byItem = {};
  for (const a of aligns) {
    const verified = a.review_status === 'verified';
    (byItem[a.item_id] = byItem[a.item_id] || []).push({
      id: a.id, targetType: a.target_type, targetId: a.target_id || null,
      targetTitle: a.target_type === 'program' ? 'Fixer Nation Education program' : (titles.get(a.target_type + ':' + a.target_id) || '(removed)'),
      status: verified ? 'verified' : (a.rationale ? 'in_review' : 'suggested'),
      // FNE's wording is shown to the district only once FNE has verified it.
      rationale: verified ? a.rationale : null, strength: verified ? a.strength : null,
      yourNote: a.district_note || null, removable: !verified && !!a.suggested_by_site_user_id,
    });
  }
  const { notes, reviewedAt, ...base } = frameworkOut(fw);
  return {
    ...base, reviewedAt: reviewedAt, districtId: fw.district_id,
    status: fw.review_status === 'verified' ? 'published' : (fw.submitted_at ? 'in_review' : 'draft'),
    submittedAt: fw.submitted_at || null,
    items: items.map(it => ({ ...itemOut(it), alignments: byItem[it.id] || [] })),
  };
}

async function listOwn(districtIds, districtIdIn) {
  const districtId = ownDistrict(districtIds, districtIdIn);
  const [fws] = await pool.query('SELECT * FROM standards_frameworks WHERE district_id = ? ORDER BY framework_type, name', [districtId]);
  const frameworks = [];
  for (const fw of fws) frameworks.push(await frameworkView(fw));
  return { districtId, limits: { frameworks: MAX_FRAMEWORKS_PER_DISTRICT, items: MAX_ITEMS_PER_FRAMEWORK }, frameworks };
}

// What a district may point a suggestion at: published lessons (one entry per lesson family),
// brain games, and the program as a whole. Titles only -- nothing a non-customer couldn't see.
async function listTargets() {
  const [lessons] = await pool.query(
    `SELECT c.id, c.title, a.audience FROM curricula c LEFT JOIN curriculum_audiences a ON a.curriculum_id = c.id WHERE c.published = 1 ORDER BY c.title`);
  const fam = new Map();
  for (const l of lessons) {
    const stem = lessonStem(l.title);
    const cur = fam.get(stem);
    // Prefer the middle-school copy as the stored representative (see DESIGN.md "Grade levels").
    if (!cur || (l.audience === 'Middle School' && cur.audience !== 'Middle School')) fam.set(stem, { id: l.id, title: stem, audience: l.audience });
  }
  const [games] = await pool.query('SELECT id, name FROM brain_games ORDER BY name');
  return {
    program: { targetType: 'program', targetId: null, title: 'Fixer Nation Education program' },
    lessons: [...fam.values()].map(f => ({ targetType: 'curriculum', targetId: f.id, title: f.title })),
    games: games.map(g => ({ targetType: 'brain_game', targetId: g.id, title: g.name })),
  };
}

// ---- writes ---------------------------------------------------------------------------------
async function createOwn(districtIds, districtIdIn, input, siteUserId) {
  const districtId = ownDistrict(districtIds, districtIdIn);
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM standards_frameworks WHERE district_id = ?', [districtId]);
  if (Number(n.n) >= MAX_FRAMEWORKS_PER_DISTRICT) throw bad(`A district can record up to ${MAX_FRAMEWORKS_PER_DISTRICT} frameworks. Delete one first, or contact Fixer Nation.`, 409);
  // `notes` is the FNE reviewer's field; a district never writes it.
  const created = await standards.createFramework({ ...input, notes: null, districtId });
  return { id: created.id };
}

async function updateOwn(districtIds, frameworkId, input) {
  const existing = await ownFramework(districtIds, frameworkId);
  // A district may correct its state, but not the framework's type or its district.
  const f = frameworkInput({ ...input, stateCode: input.stateCode ?? existing.state_code, type: existing.framework_type, name: input.name ?? existing.name, notes: existing.notes });
  const sameCols = FRAMEWORK_COLS.every(c => (existing[c] ?? null) === f[c]);
  if (sameCols && f.name === existing.name && f.state_code === existing.state_code) return { id: existing.id, changed: false };
  if (f.name !== existing.name || f.state_code !== existing.state_code) {
    const [[dupe]] = await pool.query(
      'SELECT id FROM standards_frameworks WHERE state_code = ? AND framework_type = ? AND name = ? AND owner_key = ? AND id <> ?',
      [f.state_code, f.framework_type, f.name, existing.owner_key, existing.id]);
    if (dupe) throw bad('This district already has a framework of that type with that name', 409);
  }
  await pool.query(
    `UPDATE standards_frameworks SET state_code = ?, name = ?, issuing_body = ?, official_url = ?, adopted_year = ?, grade_span = ?, source_accessed_on = ? WHERE id = ?`,
    [f.state_code, f.name, f.issuing_body, f.official_url, f.adopted_year, f.grade_span, f.source_accessed_on, existing.id]);
  await draftFramework(existing.id);
  await unsubmit(existing.id);
  return { id: existing.id, changed: true };
}

async function deleteOwn(districtIds, frameworkId) {
  const fw = await ownFramework(districtIds, frameworkId);
  await pool.query('DELETE FROM standards_frameworks WHERE id = ?', [fw.id]);
}

async function upsertItemsOwn(districtIds, frameworkId, items) {
  const fw = await ownFramework(districtIds, frameworkId);
  if (!Array.isArray(items) || !items.length) throw bad('items must be a non-empty array');
  if (items.length > MAX_ITEMS_PER_FRAMEWORK) throw bad(`At most ${MAX_ITEMS_PER_FRAMEWORK} standards per framework`);
  const [existing] = await pool.query('SELECT code FROM standards_items WHERE framework_id = ?', [fw.id]);
  const have = new Set(existing.map(r => r.code));
  const incoming = new Set(items.map(i => String((i && i.code) ?? '').trim()));
  const total = new Set([...have, ...incoming]).size;
  if (total > MAX_ITEMS_PER_FRAMEWORK) throw bad(`At most ${MAX_ITEMS_PER_FRAMEWORK} standards per framework`);
  const res = await standards.upsertItems(fw.id, items);
  if (res.added || res.updated) await unsubmit(fw.id);
  return res;
}

async function deleteItemOwn(districtIds, itemId) {
  const it = await ownItem(districtIds, itemId);
  await standards.deleteItem(it.id);
  await unsubmit(it.framework_id);
}

// A district SUGGESTS a connection; it never writes the rationale. FNE explains and verifies.
async function suggestConnection(districtIds, siteUserId, input) {
  const it = await ownItem(districtIds, input.itemId);
  const targetType = standards.TARGET_TYPES.includes(input.targetType) ? input.targetType : null;
  if (!targetType) throw bad(`targetType must be one of: ${standards.TARGET_TYPES.join(', ')}`);
  let targetId = 0;
  if (targetType !== 'program') {
    targetId = posInt(input.targetId, 'targetId');
    if (!(await targetExists(targetType, targetId))) throw bad('That FNE item does not exist', 404);
    if (targetType === 'curriculum') {
      const [[c]] = await pool.query('SELECT id FROM curricula WHERE id = ? AND published = 1', [targetId]);
      if (!c) throw bad('That lesson is not published', 404);
    }
  }
  const note = text(input.note, 500, 'note');
  const [[existing]] = await pool.query('SELECT * FROM standards_alignments WHERE item_id = ? AND target_type = ? AND target_id = ?', [it.id, targetType, targetId]);
  if (existing) {
    // FNE's own connection (or one already verified) is never touched by a district.
    if (existing.suggested_by_site_user_id && existing.review_status !== 'verified') {
      await pool.query('UPDATE standards_alignments SET district_note = ?, updated_at = ? WHERE id = ?', [note, nowStr(), existing.id]);
      return { id: existing.id, changed: true };
    }
    return { id: existing.id, changed: false, alreadyConnected: true };
  }
  const [r] = await pool.query(
    `INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status, suggested_by_site_user_id, district_note, created_at, updated_at)
     VALUES (?, ?, ?, 'supporting', '', 'draft', ?, ?, ?, ?)`,
    [it.id, targetType, targetId, siteUserId, note, nowStr(), nowStr()]);
  return { id: r.insertId, changed: true };
}

// A district can take back its own suggestion until FNE has verified it. Verified connections are FNE's.
async function removeSuggestion(districtIds, alignmentId) {
  const a = await ownAlignment(districtIds, alignmentId);
  if (!a.suggested_by_site_user_id || a.review_status === 'verified') throw bad(NOT_FOUND, 404);
  await pool.query('DELETE FROM standards_alignments WHERE id = ?', [a.id]);
}

async function submitOwn(districtIds, siteUserId, frameworkId, { attest } = {}) {
  const fw = await ownFramework(districtIds, frameworkId);
  if (attest !== true) throw bad('Please confirm this is your district\'s official framework and that you are authorized to submit it');
  if (fw.review_status === 'verified') throw bad('This framework is already published. Edit it first if you need to change it.', 409);
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM standards_items WHERE framework_id = ?', [fw.id]);
  if (!Number(n.n)) throw bad('Add at least one standard before submitting');
  await pool.query(
    'UPDATE standards_frameworks SET submitted_at = ?, submitted_by_site_user_id = ?, attested_at = ?, attested_by_site_user_id = ? WHERE id = ?',
    [nowStr(), siteUserId, nowStr(), siteUserId, fw.id]);
  const [[d]] = await pool.query('SELECT name FROM districts WHERE id = ?', [fw.district_id]);
  return { id: fw.id, districtId: fw.district_id, districtName: d ? d.name : '', name: fw.name, type: fw.framework_type, stateCode: fw.state_code, itemCount: Number(n.n) };
}

// Taking something OFF the public site is always allowed: back to draft, off the queue.
async function withdrawOwn(districtIds, frameworkId) {
  const fw = await ownFramework(districtIds, frameworkId);
  await draftFramework(fw.id);
  await unsubmit(fw.id);
}

module.exports = {
  MAX_FRAMEWORKS_PER_DISTRICT, MAX_ITEMS_PER_FRAMEWORK,
  listOwn, listTargets, createOwn, updateOwn, deleteOwn, upsertItemsOwn, deleteItemOwn,
  suggestConnection, removeSuggestion, submitOwn, withdrawOwn,
};
