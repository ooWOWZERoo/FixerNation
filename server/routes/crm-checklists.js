// Sales CRM procurement checklists: the steps between "yes" and "paid" for a deal (mounted at /api/crm/checklists).
// A template is a named list of steps the CRM Admin keeps under Hub Settings. Applying one to a deal copies its steps onto the deal (applying it twice adds
// nothing new); after that the deal's own list is edited freely. Anyone can read a deal's list; changing it needs the right to edit THAT deal.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm, canEditDeal, can } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { text, posInt, dateOnly, oneOf, paging } = require('../lib/crm-common');
const S = require('../lib/crm-subjects');
const OWN = require('../lib/crm-checklist-owners'); // "who is responsible for a step" and one person's list of them
const STD = require('../lib/crm-checklist-standard'); // G15: the standard steps a saved checklist may be missing
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));

const router = express.Router();
const STATUSES = ['open', 'done', 'not_needed'];
const MAX_STEPS = 30;

// ---- Templates (CRM Admin edits; everyone with a role reads) ---------------------------------------------------------------------

function stepsOf(row) {
  try { const j = JSON.parse(row.items_json || '[]'); return Array.isArray(j) ? j.map(x => String(x && x.label || '').trim()).filter(Boolean) : []; } catch { return []; }
}
const templateView = (t) => ({ id: t.id, name: t.name, description: t.description || null, steps: stepsOf(t), isActive: !!t.is_active, missingStandardSteps: STD.missingFor(t.name, stepsOf(t)) });

// "Steps" arrive as an array of strings; each is trimmed, blanks and repeats are dropped.
function cleanSteps(v) {
  if (!Array.isArray(v)) return { error: 'Send the steps as a list.' };
  const out = [];
  for (const raw of v) {
    const label = text(raw, 255);
    if (label && !out.some(x => x.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  if (!out.length) return { error: 'A checklist needs at least one step.' };
  if (out.length > MAX_STEPS) return { error: `A checklist can have at most ${MAX_STEPS} steps.` };
  return { steps: out };
}

router.get('/templates', requireAuth, requireCrm('view'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM crm_procurement_templates ORDER BY name');
  res.json({ templates: rows.map(templateView) });
});

router.post('/templates', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 120);
  const s = cleanSteps(b.steps);
  if (!name) return res.status(400).json({ error: 'Give the checklist a name.' });
  if (s.error) return res.status(400).json({ error: s.error });
  const [dup] = await pool.query('SELECT id FROM crm_procurement_templates WHERE name = ?', [name]);
  if (dup[0]) return res.status(409).json({ error: 'A checklist with that name already exists.' });
  const [ins] = await pool.query('INSERT INTO crm_procurement_templates (name, description, items_json, created_by_admin_id) VALUES (?, ?, ?, ?)',
    [name, text(b.description, 500), JSON.stringify(s.steps.map(label => ({ label }))), req.crm.adminId]);
  await crmAudit(req, { action: 'crm_checklist_template_created', entityType: 'crm_checklist', entityId: ins.insertId, next: { name, steps: s.steps.length } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

router.put('/templates/:id', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[t]] = id ? await pool.query('SELECT * FROM crm_procurement_templates WHERE id = ?', [id]) : [[null]];
  if (!t) return res.status(404).json({ error: 'Checklist not found' });
  const b = req.body || {};
  const f = {};
  if (b.name !== undefined) {
    f.name = text(b.name, 120);
    if (!f.name) return res.status(400).json({ error: 'Give the checklist a name.' });
    const [dup] = await pool.query('SELECT id FROM crm_procurement_templates WHERE name = ? AND id <> ?', [f.name, id]);
    if (dup[0]) return res.status(409).json({ error: 'A checklist with that name already exists.' });
  }
  if (b.description !== undefined) f.description = text(b.description, 500);
  if (b.steps !== undefined) { const s = cleanSteps(b.steps); if (s.error) return res.status(400).json({ error: s.error }); f.items_json = JSON.stringify(s.steps.map(label => ({ label }))); }
  if (b.isActive !== undefined) f.is_active = b.isActive === true ? 1 : 0;
  const cols = Object.keys(f);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  await pool.query(`UPDATE crm_procurement_templates SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map(k => f[k]), id]);
  await crmAudit(req, { action: 'crm_checklist_template_updated', entityType: 'crm_checklist', entityId: id, next: { fields: cols } });
  res.json({ ok: true });
});

// G15: one click adds the standard steps this checklist lacks (COI, board approval, contract), after its own steps. Nothing is removed or reordered, deals that already copied this
// checklist are not touched, and a second click adds nothing.
router.post('/templates/:id/add-standard', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[t]] = id ? await pool.query('SELECT * FROM crm_procurement_templates WHERE id = ?', [id]) : [[null]];
  if (!t) return res.status(404).json({ error: 'Checklist not found' });
  const steps = stepsOf(t);
  const add = STD.missingFor(t.name, steps).slice(0, Math.max(0, STD.MAX_STEPS - steps.length));
  if (!add.length) return res.json({ ok: true, added: 0 });
  await pool.query('UPDATE crm_procurement_templates SET items_json = ? WHERE id = ?', [JSON.stringify([...steps, ...add].map(label => ({ label }))), t.id]);
  await crmAudit(req, { action: 'crm_checklist_template_updated', entityType: 'crm_checklist', entityId: t.id, next: { addedStandardSteps: add.length } });
  res.json({ ok: true, added: add.length });
});

// ---- A deal's checklist -----------------------------------------------------------------------------------------------------------

// G15: ownerAdminId / ownerName say who is responsible for a step (blank: the deal's owner is). `files` is filled in by the list route for those who may see files.
const itemView = (i, owners) => ({
  id: i.id, label: i.label, status: i.status, dueOn: i.due_on || null, note: i.note || null, templateId: i.template_id || null,
  completedAt: i.completed_at || null, completedBy: i.completed_by || null,
  ownerAdminId: i.owner_admin_id ? Number(i.owner_admin_id) : null, ownerName: i.owner_admin_id && owners ? (owners.get(Number(i.owner_admin_id)) || null) : null,
});

async function loadDeal(id) {
  const n = posInt(id);
  const [[o]] = n ? await pool.query('SELECT id, owner_admin_id, state FROM crm_opportunities WHERE id = ?', [n]) : [[null]];
  return o || null;
}

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const o = await loadDeal(req.query.opportunityId);
  if (!o) return res.status(404).json({ error: 'Deal not found' });
  const [rows] = await pool.query(
    `SELECT i.*, u.username AS completed_by FROM crm_opportunity_checklist_items i LEFT JOIN admin_users u ON u.id = i.completed_by_admin_id
     WHERE i.opportunity_id = ? ORDER BY i.sort_order, i.id`, [o.id]);
  const done = rows.filter(r => r.status === 'done').length;
  const needed = rows.filter(r => r.status !== 'not_needed').length;
  // G15: who owns each step (one lookup, never a join: the column may not exist yet), and the deal's files for a person who may see files (Read-only never does; Sales only on a deal
  // they can edit, the same as the Files panel). A file is shown by its name and size here; the bytes still come only from the authenticated download route.
  const ownerIds = [...new Set(rows.map(r => Number(r.owner_admin_id)).filter(Boolean))];
  const owners = new Map();
  if (ownerIds.length) { const [u] = await pool.query('SELECT id, username FROM admin_users WHERE id IN (?)', [ownerIds]); u.forEach(x => owners.set(Number(x.id), x.username)); }
  const canEdit = canEditDeal(req.crm.role, req.crm.adminId, o) && req.crm.role !== 'readonly';
  let files = null;
  if (can(req.crm.role, 'files') && (req.crm.role === 'admin' || canEditDeal(req.crm.role, req.crm.adminId, o))) {
    files = [];
    try {
      const [f] = await pool.query('SELECT id, original_name, kind, size_bytes, checklist_item_id FROM crm_attachments WHERE opportunity_id = ? ORDER BY id DESC LIMIT 100', [o.id]);
      files = f.map(x => ({ id: Number(x.id), name: x.original_name, kind: x.kind, sizeBytes: Number(x.size_bytes), itemId: x.checklist_item_id ? Number(x.checklist_item_id) : null }));
    } catch (err) { if (!isMissing(err)) throw err; }
  }
  res.json({ items: rows.map(r => itemView(r, owners)), progress: { done, needed, total: rows.length }, canEdit, files, staffOwners: canEdit });
});

// "My checklist steps": every open step I am responsible for, across all deals (a step that names me, else a step on a deal I own). Own steps only, for every role (a Read-only login
// owns nothing, so its list is empty, not an error). Ticking one goes through PUT /:id below, which applies the same rule that decides canComplete here.
// ?view=overdue | today | week narrows it; ?page and ?pageSize page it. Declared before the routes that take an id.
router.get('/mine', requireAuth, requireCrm('view'), async (req, res) => {
  const today = S.todayFrom(req.query.today);
  const { steps, truncated } = await OWN.stepsFor(pool, { adminId: req.crm.adminId, role: req.crm.role, today });
  const view = oneOf(req.query.view, ['overdue', 'today', 'week']);
  const keep = (s) => !view || (view === 'overdue' ? s.overdue : view === 'today' ? !!s.dueOn && s.dueOn <= today : !!s.dueOn && s.dueOn <= OWN.dueByDay(today, 7));
  const shown = steps.filter(keep);
  const { page, size, offset } = paging(req.query);
  res.json({
    steps: shown.slice(offset, offset + size), total: shown.length, page, pageSize: size, today, truncated,
    summary: { open: steps.length, overdue: steps.filter(s => s.overdue).length, dueToday: steps.filter(s => s.dueOn === today).length },
  });
});

// Everything below changes a deal, so it needs the edit_deal action AND the right to edit this particular deal.
async function guardedDeal(req, res, id) {
  const o = await loadDeal(id);
  if (!o) { res.status(404).json({ error: 'Deal not found' }); return null; }
  if (!canEditDeal(req.crm.role, req.crm.adminId, o)) { res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' }); return null; }
  return o;
}

async function nextSort(oppId) {
  const [[r]] = await pool.query('SELECT MAX(sort_order) AS m FROM crm_opportunity_checklist_items WHERE opportunity_id = ?', [oppId]);
  return Number(r.m || 0) + 10;
}

router.post('/', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const b = req.body || {};
  const o = await guardedDeal(req, res, b.opportunityId);
  if (!o) return;
  const label = text(b.label, 255);
  if (!label) return res.status(400).json({ error: 'Say what the step is.' });
  let dueOn = null;
  if (b.dueOn !== undefined && b.dueOn !== null && b.dueOn !== '') { dueOn = dateOnly(b.dueOn); if (!dueOn) return res.status(400).json({ error: 'The due date must be a real date (YYYY-MM-DD).' }); }
  let ownerId = null;
  if (b.ownerAdminId !== undefined && b.ownerAdminId !== null && b.ownerAdminId !== '') {
    ownerId = posInt(b.ownerAdminId);
    const [[a]] = ownerId ? await pool.query('SELECT id FROM admin_users WHERE id = ?', [ownerId]) : [[null]];
    if (!a) return res.status(400).json({ error: 'Pick a staff member from the list.' });
  }
  const [ins] = await pool.query(`INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, due_on, sort_order, created_by_admin_id, created_at${ownerId ? ', owner_admin_id' : ''}) VALUES (?, ?, ?, ?, ?, ?${ownerId ? ', ?' : ''})`,
    [o.id, label, dueOn, await nextSort(o.id), req.crm.adminId, sqlNow(), ...(ownerId ? [ownerId] : [])]);
  await crmAudit(req, { action: 'crm_checklist_item_added', entityType: 'crm_checklist', entityId: ins.insertId, next: { opportunityId: o.id } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

// Copies a template's steps onto the deal. A step the deal already has (same words, any capitals) is skipped, so applying twice, or applying two templates
// that share a step, never doubles anything.
router.post('/apply', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const b = req.body || {};
  const o = await guardedDeal(req, res, b.opportunityId);
  if (!o) return;
  const tid = posInt(b.templateId);
  const [[t]] = tid ? await pool.query('SELECT * FROM crm_procurement_templates WHERE id = ? AND is_active = 1', [tid]) : [[null]];
  if (!t) return res.status(404).json({ error: 'Checklist not found' });
  const [have] = await pool.query('SELECT label FROM crm_opportunity_checklist_items WHERE opportunity_id = ?', [o.id]);
  const seen = new Set(have.map(r => String(r.label).trim().toLowerCase()));
  let sort = await nextSort(o.id);
  let added = 0;
  for (const label of stepsOf(t)) {
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    await pool.query('INSERT INTO crm_opportunity_checklist_items (opportunity_id, template_id, label, sort_order, created_by_admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [o.id, t.id, label, sort, req.crm.adminId, sqlNow()]);
    sort += 10; added++;
  }
  await crmAudit(req, { action: 'crm_checklist_applied', entityType: 'crm_checklist', entityId: o.id, next: { templateId: t.id, added } });
  res.json({ ok: true, added });
});

// G15: the person named as a step's owner may tick their own step (and only that: a change of status and nothing else) even on someone else's deal. Read-only never.
async function loadItem(req, res, { ownerMayTick = false } = {}) {
  const id = posInt(req.params.id);
  const [[i]] = id ? await pool.query('SELECT * FROM crm_opportunity_checklist_items WHERE id = ?', [id]) : [[null]];
  if (!i) { res.status(404).json({ error: 'Step not found' }); return null; }
  if (ownerMayTick && req.crm.role !== 'readonly' && i.owner_admin_id && Number(i.owner_admin_id) === Number(req.crm.adminId)) return i;
  const o = await guardedDeal(req, res, i.opportunity_id);
  return o ? i : null;
}

router.put('/:id', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const b = req.body || {};
  const onlyStatus = Object.keys(b).length > 0 && Object.keys(b).every(k => k === 'status');
  const i = await loadItem(req, res, { ownerMayTick: onlyStatus });
  if (!i) return;
  const f = {};
  if (b.ownerAdminId !== undefined) {
    if (b.ownerAdminId === null || b.ownerAdminId === '') f.owner_admin_id = null;
    else {
      f.owner_admin_id = posInt(b.ownerAdminId);
      const [[a]] = f.owner_admin_id ? await pool.query('SELECT id FROM admin_users WHERE id = ?', [f.owner_admin_id]) : [[null]];
      if (!a) return res.status(400).json({ error: 'Pick a staff member from the list.' });
    }
  }
  if (b.label !== undefined) { f.label = text(b.label, 255); if (!f.label) return res.status(400).json({ error: 'Say what the step is.' }); }
  if (b.note !== undefined) f.note = text(b.note, 255);
  if (b.dueOn !== undefined) {
    f.due_on = b.dueOn === null || b.dueOn === '' ? null : dateOnly(b.dueOn);
    if (b.dueOn !== null && b.dueOn !== '' && !f.due_on) return res.status(400).json({ error: 'The due date must be a real date (YYYY-MM-DD).' });
  }
  if (b.status !== undefined) {
    f.status = oneOf(b.status, STATUSES);
    if (!f.status) return res.status(400).json({ error: `The status must be one of: ${STATUSES.join(', ')}.` });
    if (f.status !== i.status) { f.completed_at = f.status === 'done' ? sqlNow() : null; f.completed_by_admin_id = f.status === 'done' ? req.crm.adminId : null; }
  }
  const cols = Object.keys(f);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  await pool.query(`UPDATE crm_opportunity_checklist_items SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map(k => f[k]), i.id]);
  await crmAudit(req, { action: 'crm_checklist_item_updated', entityType: 'crm_checklist', entityId: i.id, prev: { status: i.status, ownerAdminId: i.owner_admin_id || null }, next: { status: f.status || i.status, ownerAdminId: f.owner_admin_id !== undefined ? f.owner_admin_id : (i.owner_admin_id || null) } });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const i = await loadItem(req, res);
  if (!i) return;
  try { await pool.query('UPDATE crm_attachments SET checklist_item_id = NULL WHERE checklist_item_id = ?', [i.id]); } catch (err) { if (!isMissing(err)) throw err; } // its files stay on the deal
  await pool.query('DELETE FROM crm_opportunity_checklist_items WHERE id = ?', [i.id]);
  await crmAudit(req, { action: 'crm_checklist_item_removed', entityType: 'crm_checklist', entityId: i.id });
  res.json({ ok: true });
});

module.exports = router;
