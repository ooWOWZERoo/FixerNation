// Sales CRM: who I am, staff roles, pipeline stages and loss reasons (mounted at /api/crm).
// Every route is behind the admin session (requireAuth) AND the CRM gate (lib/crm-permissions.js): off switch -> 404, then role and action.
// See docs/reference/sales-crm-update-requirements.md, section 4 (access matrix).
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm, ALLOWED, ROLES, can } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { text, posInt, oneOf } = require('../lib/crm-common');
const { setSetting } = require('../lib/settings');
const EL = require('../lib/crm-engagement-limits'); // the numbers behind the engagement card's alerts

const router = express.Router();

router.get('/me', requireAuth, requireCrm('view'), (req, res) => {
  const permissions = {};
  for (const action of Object.keys(ALLOWED)) permissions[action] = can(req.crm.role, action);
  res.json({ adminId: req.crm.adminId, role: req.crm.role, permissions });
});

// ---- Staff (owner pickers, role assignment) ----------------------------------------------------------------------------------------

router.get('/staff', requireAuth, requireCrm('view'), async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, email, email_verified, crm_role FROM admin_users ORDER BY username');
  res.json({
    staff: rows.map(r => ({ id: r.id, username: r.username, crmRole: r.crm_role, active: !!r.email_verified, hasEmail: !!r.email })),
  });
});

// Assign a role. Only a CRM Admin; the last CRM Admin can never be lowered (the matrix would have nobody who can edit settings or roles).
router.put('/staff/:id/role', requireAuth, requireCrm('assign_roles'), async (req, res) => {
  const adminId = posInt(req.params.id);
  const role = oneOf((req.body || {}).role, ROLES);
  if (!adminId || !role) return res.status(400).json({ error: 'A staff id and a role (admin, sales or readonly) are required.' });
  const [[target]] = await pool.query('SELECT id, crm_role FROM admin_users WHERE id = ?', [adminId]);
  if (!target) return res.status(404).json({ error: 'Staff member not found' });
  if (target.crm_role === 'admin' && role !== 'admin') {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM admin_users WHERE crm_role = 'admin' AND email_verified = 1");
    if (Number(n) <= 1) return res.status(409).json({ code: 'last_crm_admin', error: 'At least one CRM Admin must remain.' });
  }
  await pool.query('UPDATE admin_users SET crm_role = ? WHERE id = ?', [role, adminId]);
  await crmAudit(req, { action: 'crm_role_changed', entityType: 'crm_staff', entityId: adminId, prev: { role: target.crm_role }, next: { role } });
  res.json({ ok: true, id: adminId, crmRole: role });
});

// ---- Pipeline stages --------------------------------------------------------------------------------------------------------------

// G19: how Suspect, Prospect and Customer are decided, in plain words, with today's counts. Read only; the rules live in lib/crm-classification.js.
router.get('/classification-rules', requireAuth, requireCrm('view'), async (req, res) => {
  const today = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  res.json(await require('../lib/crm-classification-rules').overview(pool, today));
});

// Customer Hub follow-up to G18: the numbers behind the "Worth a look" alerts on the engagement card. Anyone with a CRM role can read them; only a CRM Admin (edit_settings) changes them.
// Same all-or-nothing rule as the Needs Attention thresholds: an unknown key, a value that is not a whole number or one outside its limits refuses the whole change, and each change is
// written to the audit log with the old and new values.
router.get('/engagement-alerts', requireAuth, requireCrm('view'), async (req, res) => {
  res.json({ limits: EL.limitView(await EL.loadLimits(pool)) });
});
router.put('/engagement-alerts', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const body = (req.body && typeof req.body === 'object' && req.body.values && typeof req.body.values === 'object' && !Array.isArray(req.body.values)) ? req.body.values : null;
  if (!body) return res.status(400).json({ error: 'Send the values to change.' });
  const next = {};
  for (const [key, v] of Object.entries(body)) {
    const d = Object.prototype.hasOwnProperty.call(EL.LIMITS, key) ? EL.LIMITS[key] : null;
    if (!d) return res.status(400).json({ error: `"${key}" is not a setting.` });
    if (typeof v !== 'number' || !Number.isInteger(v) || v < d.min || v > d.max) return res.status(400).json({ error: `${d.label}: use a whole number from ${d.min} to ${d.max}.` });
    next[key] = v;
  }
  if (!Object.keys(next).length) return res.status(400).json({ error: 'Nothing to change.' });
  const before = await EL.loadLimits(pool);
  const changed = Object.keys(next).filter(k => before[k] !== next[k]);
  for (const k of changed) await setSetting(EL.LIMITS[k].setting, String(next[k]));
  if (changed.length) await crmAudit(req, { action: 'crm_engagement_alerts_changed', entityType: 'crm_attention', entityId: null, prev: Object.fromEntries(changed.map(k => [k, before[k]])), next: Object.fromEntries(changed.map(k => [k, next[k]])) });
  res.json({ ok: true, changed, limits: EL.limitView(await EL.loadLimits(pool)) });
});

router.get('/stages', requireAuth, requireCrm('view'), async (req, res) => {
  const [rows] = await pool.query('SELECT id, stage_key, label, sort_order, default_probability, is_active FROM crm_pipeline_stages ORDER BY sort_order, id');
  res.json({ stages: rows.map(r => ({ id: r.id, key: r.stage_key, label: r.label, sortOrder: r.sort_order, defaultProbability: r.default_probability, isActive: !!r.is_active })) });
});

// Global probabilities and labels: CRM Admin only. The key is a stable code and never changes. The stage "won" and the first stage stay on.
router.put('/stages/:id', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[stage]] = id ? await pool.query('SELECT * FROM crm_pipeline_stages WHERE id = ?', [id]) : [[null]];
  if (!stage) return res.status(404).json({ error: 'Stage not found' });
  const b = req.body || {};
  const label = b.label === undefined ? stage.label : text(b.label, 64);
  let prob = stage.default_probability;
  if (b.defaultProbability !== undefined) {
    prob = typeof b.defaultProbability === 'number' && Number.isInteger(b.defaultProbability) ? b.defaultProbability : NaN;
    if (!(prob >= 0 && prob <= 100)) return res.status(400).json({ error: 'The probability must be a whole number from 0 to 100.' });
  }
  const sortOrder = b.sortOrder === undefined ? stage.sort_order : posInt(b.sortOrder);
  const isActive = b.isActive === undefined ? !!stage.is_active : b.isActive === true;
  if (!label || !sortOrder) return res.status(400).json({ error: 'A label and a sort order are required.' });
  if (!isActive && (stage.stage_key === 'won' || stage.stage_key === 'new_inquiry')) return res.status(400).json({ error: 'This stage cannot be turned off.' });
  if (!isActive && stage.is_active) {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM crm_opportunities WHERE stage_id = ? AND state = 'open'", [id]);
    if (Number(n)) return res.status(409).json({ code: 'stage_in_use', error: `${n} open deal(s) are in this stage. Move them first.` });
  }
  await pool.query('UPDATE crm_pipeline_stages SET label = ?, default_probability = ?, sort_order = ?, is_active = ? WHERE id = ?', [label, prob, sortOrder, isActive ? 1 : 0, id]);
  await crmAudit(req, {
    action: 'crm_stage_updated', entityType: 'crm_opportunity', entityId: null,
    prev: { stage: stage.stage_key, label: stage.label, probability: stage.default_probability, sortOrder: stage.sort_order, isActive: !!stage.is_active },
    next: { stage: stage.stage_key, label, probability: prob, sortOrder, isActive },
  });
  res.json({ ok: true });
});

// ---- Loss reasons -----------------------------------------------------------------------------------------------------------------

router.get('/loss-reasons', requireAuth, requireCrm('view'), async (req, res) => {
  const [rows] = await pool.query('SELECT id, reason_key, label, sort_order, is_active FROM crm_loss_reasons ORDER BY sort_order, id');
  res.json({ lossReasons: rows.map(r => ({ id: r.id, key: r.reason_key, label: r.label, sortOrder: r.sort_order, isActive: !!r.is_active })) });
});

router.post('/loss-reasons', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const b = req.body || {};
  const label = text(b.label, 96);
  const key = typeof b.key === 'string' && /^[a-z][a-z0-9_]{1,31}$/.test(b.key) ? b.key : null;
  if (!label || !key) return res.status(400).json({ error: 'A label and a short key (lowercase letters, digits and underscores) are required.' });
  const [dup] = await pool.query('SELECT id FROM crm_loss_reasons WHERE reason_key = ?', [key]);
  if (dup[0]) return res.status(409).json({ error: 'That key is already used.' });
  const [r] = await pool.query('INSERT INTO crm_loss_reasons (reason_key, label, sort_order) VALUES (?, ?, ?)', [key, label, posInt(b.sortOrder) || 50]);
  await crmAudit(req, { action: 'crm_loss_reason_created', entityType: 'crm_opportunity', entityId: null, next: { key, label } });
  res.status(201).json({ ok: true, id: r.insertId });
});

router.put('/loss-reasons/:id', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[row]] = id ? await pool.query('SELECT * FROM crm_loss_reasons WHERE id = ?', [id]) : [[null]];
  if (!row) return res.status(404).json({ error: 'Loss reason not found' });
  const b = req.body || {};
  const label = b.label === undefined ? row.label : text(b.label, 96);
  const isActive = b.isActive === undefined ? !!row.is_active : b.isActive === true;
  if (!label) return res.status(400).json({ error: 'A label is required.' });
  await pool.query('UPDATE crm_loss_reasons SET label = ?, is_active = ? WHERE id = ?', [label, isActive ? 1 : 0, id]);
  await crmAudit(req, { action: 'crm_loss_reason_updated', entityType: 'crm_opportunity', entityId: null, prev: { label: row.label, isActive: !!row.is_active }, next: { label, isActive } });
  res.json({ ok: true });
});

module.exports = router;
