// Sales CRM: the contact list and Contact 360 with Suspect / Prospect / Customer (mounted at /api/crm/contacts).
// Reads newsletter_contacts (the canonical person) and adds only CRM fields. It never writes the subscription status, the email, or any purchase.
// The classification rules live in lib/crm-classification.js; this file only exposes them behind roles.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const cls = require('../lib/crm-classification');
const { text, posInt, oneOf, paging, likeTerm } = require('../lib/crm-common');

const router = express.Router();

const SORTS = {
  name: 'c.name',
  email: 'c.email',
  classification: 'c.crm_classification',
  changed: 'c.classification_updated_at',
  contacted: 'c.last_contacted_at',
  signup: 'c.signup_date',
};

function contactRow(c) {
  return {
    id: c.id, name: c.name, email: c.email, company: c.company, state: c.state,
    classification: c.crm_classification || 'suspect',
    classificationLocked: Number(c.classification_locked) === 1,
    classificationUpdatedAt: c.classification_updated_at || null,
    assignedAdminId: c.assigned_admin_id || null,
    lastContactedAt: c.last_contacted_at || null,
    // Shown for reference only. The CRM never changes it (it is an email-marketing preference, not a sales stage).
    subscriptionStatus: c.status,
    signupDate: c.signup_date,
  };
}

// Server-side paging and filtering (the older contacts page loads everything at once). Test addresses (@example.com) are left out unless asked for.
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  const classification = oneOf(req.query.classification, cls.CLASSIFICATIONS);
  if (classification) { where.push('c.crm_classification = ?'); params.push(classification); }
  if (req.query.assigned === 'none') where.push('c.assigned_admin_id IS NULL');
  else if (posInt(req.query.assigned)) { where.push('c.assigned_admin_id = ?'); params.push(posInt(req.query.assigned)); }
  const like = likeTerm(req.query.q);
  if (like) { where.push("(c.name LIKE ? ESCAPE '!' OR c.email LIKE ? ESCAPE '!' OR c.company LIKE ? ESCAPE '!')"); params.push(like, like, like); }
  if (req.query.includeTest !== 'true') where.push(`NOT (LOWER(TRIM(c.email)) LIKE '%@example.com')`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortKey = SORTS[req.query.sort] ? req.query.sort : 'changed';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM newsletter_contacts c ${w}`, params);
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.email, c.company, c.state, c.status, c.signup_date, c.crm_classification, c.classification_locked,
            c.classification_updated_at, c.assigned_admin_id, c.last_contacted_at
     FROM newsletter_contacts c ${w}
     ORDER BY ${SORTS[sortKey]} ${dir}, c.id ${dir} LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  res.json({ contacts: rows.map(contactRow), total: Number(total), page, pageSize: size });
});

// Overview counts: contacts only, test addresses left out. Account-level Customer is a separate figure, never added to these.
router.get('/counts', requireAuth, requireCrm('view'), async (req, res) => {
  res.json({ counts: await cls.classificationCounts(pool) });
});

// Paid, non-trial purchases whose amount is unknown or zero. They are never a Customer on their own; the owner confirms each by hand (decision D3).
router.get('/review/purchases', requireAuth, requireCrm('view'), async (req, res) => {
  res.json({ purchases: await cls.listPurchasesNeedingReview(pool) });
});

router.get('/:id', requireAuth, requireCrm('view'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[c]] = id ? await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]) : [[null]];
  if (!c) return res.status(404).json({ error: 'Contact not found' });

  const [events] = await pool.query(
    `SELECT e.id, e.from_classification, e.to_classification, e.event_type, e.source_ref, e.reason, e.created_at, a.username AS actor
     FROM crm_classification_events e LEFT JOIN admin_users a ON a.id = e.actor_admin_id
     WHERE e.contact_id = ? ORDER BY e.id DESC LIMIT 50`, [id]);
  const [accounts] = await pool.query(
    `SELECT ac.account_id, a.name, a.account_type, ac.title, ac.is_primary, ac.is_champion, ac.is_decision_maker, ac.is_procurement, ac.is_finance
     FROM crm_account_contacts ac JOIN crm_accounts a ON a.id = ac.account_id WHERE ac.contact_id = ? ORDER BY a.name`, [id]);
  const [opps] = await pool.query(
    `SELECT o.id, o.name, o.state, s.label AS stage, oc.role
     FROM crm_opportunity_contacts oc JOIN crm_opportunities o ON o.id = oc.opportunity_id JOIN crm_pipeline_stages s ON s.id = o.stage_id
     WHERE oc.contact_id = ? ORDER BY o.id DESC`, [id]);
  const [purchases] = await pool.query(
    `SELECT p.id, p.product_type, p.payment_status, p.payment_method, p.amount_cents, p.trial_lesson_limit, p.trial_expiration_date, lp.is_trial, p.purchased_at
     ${cls.PURCHASES_FROM} WHERE p.contact_id = ? ORDER BY p.id DESC`, [id]);

  res.json({
    contact: contactRow(c),
    events: events.map(e => ({ id: e.id, from: e.from_classification, to: e.to_classification, type: e.event_type, sourceRef: e.source_ref, reason: e.reason, at: e.created_at, actor: e.actor || null })),
    accounts: accounts.map(a => ({ accountId: a.account_id, name: a.name, accountType: a.account_type, title: a.title, isPrimary: !!a.is_primary, isChampion: !!a.is_champion, isDecisionMaker: !!a.is_decision_maker, isProcurement: !!a.is_procurement, isFinance: !!a.is_finance })),
    opportunities: opps.map(o => ({ id: o.id, name: o.name, state: o.state, stage: o.stage, role: o.role })),
    // "qualifies" is the Customer rule applied to each row, so staff can see exactly why a purchase does or does not make someone a Customer.
    purchases: purchases.map(p => ({
      id: p.id, productType: p.product_type, paymentStatus: p.payment_status, paymentMethod: p.payment_method,
      amountCents: p.amount_cents === null ? null : Number(p.amount_cents), purchasedAt: p.purchased_at,
      isTrial: cls.isTrialLike(p), qualifies: cls.isQualifyingPurchase(p),
    })),
  });
});

// Owner. A CRM Admin or Sales role may set it; the owner must be a real admin.
router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[c]] = id ? await pool.query('SELECT id, assigned_admin_id FROM newsletter_contacts WHERE id = ?', [id]) : [[null]];
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  const b = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(b, 'assignedAdminId')) return res.status(400).json({ error: 'Nothing to change.' });
  let owner = null;
  if (b.assignedAdminId !== null) {
    owner = posInt(b.assignedAdminId);
    const [[a]] = owner ? await pool.query('SELECT id FROM admin_users WHERE id = ?', [owner]) : [[null]];
    if (!a) return res.status(400).json({ error: 'That staff member does not exist.' });
  }
  await pool.query('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?', [owner, id]);
  await crmAudit(req, { action: 'crm_contact_owner_changed', entityType: 'crm_contact', entityId: id, prev: { assignedAdminId: c.assigned_admin_id }, next: { assignedAdminId: owner } });
  res.json({ ok: true });
});

router.post('/:id/promote', requireAuth, requireCrm('promote_prospect'), async (req, res) => {
  const id = posInt(req.params.id);
  const r = await cls.promoteToProspect(pool, id, { actorAdminId: req.crm.adminId, reason: (req.body || {}).reason });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : r.code === 'reason_required' ? 400 : 409).json({ code: r.code, error: r.error });
  await crmAudit(req, { action: 'crm_contact_promoted', entityType: 'crm_contact', entityId: id, prev: { classification: 'suspect' }, next: { classification: 'prospect' }, reason: text((req.body || {}).reason, 255) });
  res.json({ ok: true, classification: 'prospect' });
});

// CRM Admin only, with a reason AND evidence. The label is then locked against automatic changes.
router.post('/:id/customer-override', requireAuth, requireCrm('set_customer'), async (req, res) => {
  const id = posInt(req.params.id);
  const b = req.body || {};
  const r = await cls.setCustomerOverride(pool, id, { actorAdminId: req.crm.adminId, reason: b.reason, evidence: b.evidence });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : r.code === 'evidence_required' ? 400 : 409).json({ code: r.code, error: r.error });
  await crmAudit(req, { action: 'crm_customer_override', entityType: 'crm_contact', entityId: id, prev: { classification: r.from }, next: { classification: 'customer', locked: true }, reason: `${text(b.reason, 120)}; evidence: ${text(b.evidence, 120)}` });
  res.json({ ok: true, classification: 'customer', locked: true });
});

router.post('/:id/release-override', requireAuth, requireCrm('set_customer'), async (req, res) => {
  const id = posInt(req.params.id);
  const r = await cls.releaseOverride(pool, id, { actorAdminId: req.crm.adminId, reason: (req.body || {}).reason });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : r.code === 'reason_required' ? 400 : 409).json({ code: r.code, error: r.error });
  await crmAudit(req, { action: 'crm_override_released', entityType: 'crm_contact', entityId: id, reason: text((req.body || {}).reason, 255) });
  res.json({ ok: true });
});

// Re-derive one contact from the facts (safe to repeat).
router.post('/:id/reconcile', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const r = id ? await cls.reconcileContact(pool, id, { actorAdminId: req.crm.adminId }) : { found: false };
  if (!r.found) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true, changed: !!r.changed, from: r.from || null, to: r.to || null, needsReview: !!r.needsReview });
});

module.exports = router;
