// Sales CRM "Needs Attention": the rules in lib/crm-attention.js, shown as a list (mounted at /api/crm/attention).
// Everyone with a CRM role can read it. Snoozing or dismissing an item is a write: Read-only never; Sales on items about deals they can edit, tasks assigned to them
// and anything that is not about someone else's deal; CRM Admin on everything. The rules only read; nothing here changes a deal, quote, purchase or contact.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm, canEditDeal } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { setSetting } = require('../lib/settings');
const { text, posInt, dateOnly, oneOf, paging } = require('../lib/crm-common');
const A = require('../lib/crm-attention');
const S = require('../lib/crm-subjects');

const router = express.Router();
const ORDER = ['next_step_overdue', 'task_overdue', 'checklist_overdue', 'close_date_passed', 'quote_expiring', 'po_not_received', 'won_no_purchase', 'refund_review', 'quote_unanswered', 'trial_ending', 'trial_stalled', 'trial_high_use', 'stale_deal', 'no_next_step', 'no_owner'];
const STATUSES = ['active', 'snoozed', 'dismissed'];

async function currentItems(today, caps) {
  const items = await A.evaluate(pool, { today, caps });
  items.sort((a, b) => ORDER.indexOf(a.ruleKey) - ORDER.indexOf(b.ruleKey));
  return A.withStates(pool, items, { now: sqlNow() });
}

const view = (it) => ({
  ruleKey: it.ruleKey, ruleLabel: it.ruleLabel, subjectType: it.subjectType, subjectId: it.subjectId, title: it.title, context: it.context || null, why: it.why, link: it.link,
  ownerAdminId: it.ownerAdminId, ownerName: it.ownerName, status: it.status, snoozeUntil: it.snoozeUntil, stateBy: it.stateBy, stateReason: it.stateReason,
});

// What each rule means, so the page can explain itself.
router.get('/rules', requireAuth, requireCrm('view'), async (req, res) => {
  const t = await A.loadThresholds(pool);
  res.json({ rules: ORDER.map(k => ({ key: k, label: A.RULES[k].label, help: A.helpFor(k, t) })) });
});

// G2: the numbers the rules use. Anyone with a CRM role can read them (the rules' wording already says them); only a CRM Admin (edit_settings) changes them. A value outside its
// limits or not a whole number is refused, never stored, and each change is written to the audit log with the old and new values.
const thresholdView = (t) => Object.entries(A.THRESHOLDS).map(([key, d]) => ({ key, label: d.label, help: d.help, unit: d.unit, value: t[key], default: d.def, min: d.min, max: d.max }));
router.get('/thresholds', requireAuth, requireCrm('view'), async (req, res) => {
  res.json({ thresholds: thresholdView(await A.loadThresholds(pool)) });
});
router.put('/thresholds', requireAuth, requireCrm('edit_settings'), async (req, res) => {
  const body = (req.body && typeof req.body === 'object' && req.body.values && typeof req.body.values === 'object') ? req.body.values : null;
  if (!body) return res.status(400).json({ error: 'Send the values to change.' });
  const next = {};
  for (const [key, v] of Object.entries(body)) {
    const d = A.THRESHOLDS[key];
    if (!d) return res.status(400).json({ error: `"${key}" is not a setting.` });
    if (typeof v !== 'number' || !Number.isInteger(v) || v < d.min || v > d.max) return res.status(400).json({ error: `${d.label}: use a whole number from ${d.min} to ${d.max}.` });
    next[key] = v;
  }
  if (!Object.keys(next).length) return res.status(400).json({ error: 'Nothing to change.' });
  const before = await A.loadThresholds(pool);
  const changed = Object.keys(next).filter(k => before[k] !== next[k]);
  for (const k of changed) await setSetting(A.THRESHOLDS[k].setting, String(next[k]));
  if (changed.length) await crmAudit(req, { action: 'crm_attention_thresholds_changed', entityType: 'crm_attention', entityId: null, prev: Object.fromEntries(changed.map(k => [k, before[k]])), next: Object.fromEntries(changed.map(k => [k, next[k]])) });
  res.json({ ok: true, changed, thresholds: thresholdView(await A.loadThresholds(pool)) });
});

// ?owner=me|none|me_or_none|<id>  ?rule=<key>  ?status=active|snoozed|dismissed|all (default active)  ?today=YYYY-MM-DD  ?page= &pageSize=
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const today = S.todayFrom(req.query.today);
  const { page, size, offset } = paging(req.query, { defaultSize: 25, maxSize: 100 });
  const caps = {};
  let items = await currentItems(today, caps);
  const forStatus = req.query.status === 'all' ? null : (oneOf(req.query.status, STATUSES) || 'active');
  // Counts per rule describe what is active for the chosen owner, whatever rule or status is picked.
  if (req.query.owner === 'me') items = items.filter(i => Number(i.ownerAdminId) === Number(req.crm.adminId));
  else if (req.query.owner === 'none') items = items.filter(i => !i.ownerAdminId);
  else if (req.query.owner === 'me_or_none') items = items.filter(i => !i.ownerAdminId || Number(i.ownerAdminId) === Number(req.crm.adminId)); // punch list B10: the Overview's box
  else if (posInt(req.query.owner)) items = items.filter(i => Number(i.ownerAdminId) === posInt(req.query.owner));
  const counts = A.countsByRule(items.filter(i => i.status === 'active'));
  const snoozed = items.filter(i => i.status === 'snoozed').length;
  const dismissed = items.filter(i => i.status === 'dismissed').length;
  if (forStatus) items = items.filter(i => i.status === forStatus);
  if (typeof req.query.rule === 'string' && A.RULES[req.query.rule]) items = items.filter(i => i.ruleKey === req.query.rule);
  res.json({
    items: items.slice(offset, offset + size).map(view), total: items.length, page, pageSize: size, today,
    // A rule that has more items than the list holds: { ruleKey: how many exist }. The list shows the oldest first.
    cappedRules: caps, cap: A.PER_RULE_LIMIT,
    counts, activeTotal: Object.values(counts).reduce((a, b) => a + b, 0), snoozedTotal: snoozed, dismissedTotal: dismissed,
  });
});

// ---- Snooze, dismiss, bring back ---------------------------------------------------------------------------------------------------

// The client names the item; the server finds it among what the rules raise right now (so the fingerprint is the server's, never the client's) and checks the role.
async function findItem(req, res) {
  const b = req.body || {};
  const ruleKey = typeof b.ruleKey === 'string' && A.RULES[b.ruleKey] ? b.ruleKey : null;
  const subjectType = oneOf(b.subjectType, A.SUBJECT_TYPES);
  const subjectId = posInt(b.subjectId);
  if (!ruleKey || !subjectType || !subjectId) { res.status(400).json({ error: 'Say which item you mean.' }); return null; }
  const found = (await currentItems(S.todayFrom(b.today))).find(i => i.ruleKey === ruleKey && i.subjectType === subjectType && i.subjectId === subjectId);
  if (!found) { res.status(404).json({ code: 'not_listed', error: 'That item is not on the list any more. Reload the page.' }); return null; }
  if (req.crm.role !== 'admin') {
    let allowed = true;
    if (found.dealId) {
      const [[o]] = await pool.query('SELECT owner_admin_id FROM crm_opportunities WHERE id = ?', [found.dealId]);
      allowed = !!o && canEditDeal(req.crm.role, req.crm.adminId, o);
    }
    if (found.ruleKey === 'task_overdue' && Number(found.ownerAdminId) === Number(req.crm.adminId)) allowed = true;
    if (!allowed) { res.status(403).json({ code: 'not_your_deal', error: 'This item is about a deal that belongs to someone else. Ask the owner or a CRM Admin.' }); return null; }
  }
  return found;
}

router.post('/snooze', requireAuth, requireCrm('write'), async (req, res) => {
  const it = await findItem(req, res);
  if (!it) return;
  const until = dateOnly((req.body || {}).until);
  const today = S.todayFrom((req.body || {}).today);
  if (!until || until <= today) return res.status(400).json({ error: 'Pick a day after today to come back to this.' });
  if (until > A.addDays(today, 365)) return res.status(400).json({ error: 'Snooze for a year at most. To hide it for good, dismiss it.' });
  await A.setState(pool, it, { state: 'snoozed', until: `${until} 00:00:00`, adminId: req.crm.adminId, reason: text((req.body || {}).reason, 255), now: sqlNow() });
  await crmAudit(req, { action: 'crm_attention_snoozed', entityType: 'crm_attention', entityId: it.subjectId, next: { rule: it.ruleKey, subjectType: it.subjectType, until } });
  res.json({ ok: true, until });
});

router.post('/dismiss', requireAuth, requireCrm('write'), async (req, res) => {
  const it = await findItem(req, res);
  if (!it) return;
  await A.setState(pool, it, { state: 'dismissed', adminId: req.crm.adminId, reason: text((req.body || {}).reason, 255), now: sqlNow() });
  await crmAudit(req, { action: 'crm_attention_dismissed', entityType: 'crm_attention', entityId: it.subjectId, next: { rule: it.ruleKey, subjectType: it.subjectType } });
  res.json({ ok: true });
});

router.post('/restore', requireAuth, requireCrm('write'), async (req, res) => {
  const it = await findItem(req, res);
  if (!it) return;
  await A.clearState(pool, it);
  await crmAudit(req, { action: 'crm_attention_restored', entityType: 'crm_attention', entityId: it.subjectId, next: { rule: it.ruleKey, subjectType: it.subjectType } });
  res.json({ ok: true });
});

module.exports = router;
