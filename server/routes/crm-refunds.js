// Sales CRM refund and dispute flags (punch list G21, mounted at /api/crm/refunds). A flag says "this purchase may have been refunded or disputed"; it changes nothing by itself.
// Who may do what (matrix in docs/reference/sales-crm-punch-list.md, G21): everyone with a CRM role sees the list; Sales and CRM Admin RAISE a flag by hand; only a CRM Admin CONFIRMS or DISMISSES one.
// Confirming a FULL refund makes the purchase stop counting as a paid purchase in the CRM. It never touches the purchase, its license, or the contact's label (lib/crm-refunds.js has the rules).
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm, can } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { text, posInt, cents, oneOf, paging, likeTerm } = require('../lib/crm-common');
const crmHooks = require('../lib/crm-hooks');

const router = express.Router();
const FLAG_STATES = ['needs_review', 'confirmed', 'dismissed'];

function view(r, role) {
  return {
    id: Number(r.id), kind: r.kind, source: r.source, state: r.state, amountCents: r.amount_cents === null || r.amount_cents === undefined ? null : Number(r.amount_cents),
    isFull: r.is_full === null || r.is_full === undefined ? null : Number(r.is_full) === 1, note: r.note || null, createdAt: r.created_at, decidedAt: r.decided_at || null,
    raisedByName: r.raised_by_name || null, decidedByName: r.decided_by_name || null,
    canDecide: r.state === 'needs_review' && can(role, 'decide_refund'),
    purchase: {
      id: Number(r.purchase_id), school: r.school_domain || null, amountCents: r.purchase_amount === null || r.purchase_amount === undefined ? null : Number(r.purchase_amount),
      purchasedAt: r.purchased_at || null, paymentStatus: r.payment_status || null, buyerName: r.contact_name || null, contactId: r.contact_id ? Number(r.contact_id) : null,
      dealId: r.deal_id ? Number(r.deal_id) : null,
    },
  };
}

const SELECT = `SELECT f.*, p.school_domain, p.amount_cents AS purchase_amount, p.purchased_at, p.payment_status, p.contact_id, c.name AS contact_name,
    (SELECT MIN(q.opportunity_id) FROM quote_requests q WHERE q.id = p.quote_id) AS deal_id, ru.username AS raised_by_name, du.username AS decided_by_name
  FROM crm_purchase_refunds f JOIN purchases p ON p.id = f.purchase_id LEFT JOIN newsletter_contacts c ON c.id = p.contact_id
  LEFT JOIN admin_users ru ON ru.id = f.raised_by_admin_id LEFT JOIN admin_users du ON du.id = f.decided_by_admin_id`;

// ?state=needs_review (default)|confirmed|dismissed|all   ?purchaseId=N
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  const state = req.query.state === 'all' ? null : (oneOf(req.query.state, FLAG_STATES) || 'needs_review');
  if (state) { where.push('f.state = ?'); params.push(state); }
  if (req.query.purchaseId !== undefined) { const id = posInt(req.query.purchaseId); if (!id) return res.status(400).json({ error: 'purchaseId must be a number.' }); where.push('f.purchase_id = ?'); params.push(id); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM crm_purchase_refunds f ${w}`, params);
  const [rows] = await pool.query(`${SELECT} ${w} ORDER BY f.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  const [[open]] = await pool.query("SELECT COUNT(*) AS n FROM crm_purchase_refunds WHERE state = 'needs_review'");
  res.json({ flags: rows.map(r => view(r, req.crm.role)), total: Number(total), page, pageSize: size, open: Number(open.n), canRaise: can(req.crm.role, 'raise_refund'), canDecide: can(req.crm.role, 'decide_refund') });
});

// Find a purchase to flag: by buyer email, buyer name, school or PO number (at least 3 characters, ten results). Staff-only data; no card details exist here.
router.get('/purchases', requireAuth, requireCrm('raise_refund'), async (req, res) => {
  const t = likeTerm(req.query.q);
  if (!t || String(req.query.q).trim().length < 3) return res.status(400).json({ error: 'Type at least 3 characters of the buyer, school or PO number.' });
  const [rows] = await pool.query(
    `SELECT p.id, p.school_domain, p.amount_cents, p.purchased_at, p.payment_status, p.po_number, c.name AS contact_name
     FROM purchases p LEFT JOIN newsletter_contacts c ON c.id = p.contact_id
     WHERE LOWER(c.email) LIKE LOWER(?) ESCAPE '!' OR LOWER(c.name) LIKE LOWER(?) ESCAPE '!' OR LOWER(p.school_domain) LIKE LOWER(?) ESCAPE '!' OR LOWER(p.po_number) LIKE LOWER(?) ESCAPE '!'
     ORDER BY p.id DESC LIMIT 10`, [t, t, t, t]);
  res.json({ purchases: rows.map(r => ({ id: Number(r.id), school: r.school_domain || null, amountCents: r.amount_cents === null ? null : Number(r.amount_cents), purchasedAt: r.purchased_at, paymentStatus: r.payment_status, po: r.po_number || null, buyerName: r.contact_name || null })) });
});

// Raise a flag by hand. { purchaseId, kind: 'refund' | 'dispute' (default refund), amountCents?, isFull? (true | false), note? }
router.post('/', requireAuth, requireCrm('raise_refund'), async (req, res) => {
  const b = req.body || {};
  const purchaseId = posInt(b.purchaseId);
  const [[p]] = purchaseId ? await pool.query('SELECT id, amount_cents FROM purchases WHERE id = ?', [purchaseId]) : [[null]];
  if (!p) return res.status(404).json({ error: 'Purchase not found.' });
  const kind = b.kind === undefined ? 'refund' : oneOf(b.kind, ['refund', 'dispute']);
  if (!kind) return res.status(400).json({ error: 'The kind must be refund or dispute.' });
  let amount = null;
  if (b.amountCents !== undefined && b.amountCents !== null && b.amountCents !== '') { amount = cents(b.amountCents); if (amount === null) return res.status(400).json({ error: 'The amount must be whole cents, 0 or more.' }); }
  const isFull = b.isFull === true ? 1 : b.isFull === false ? 0 : null;
  const [[open]] = await pool.query("SELECT id FROM crm_purchase_refunds WHERE purchase_id = ? AND state = 'needs_review' AND source = 'staff' AND kind = ?", [p.id, kind]);
  if (open) return res.status(409).json({ error: 'This purchase already has a flag waiting for review.' });
  const [ins] = await pool.query(
    `INSERT INTO crm_purchase_refunds (purchase_id, kind, source, amount_cents, is_full, state, note, raised_by_admin_id, created_at) VALUES (?, ?, 'staff', ?, ?, 'needs_review', ?, ?, ?)`,
    [p.id, kind, amount, isFull, text(b.note, 500), req.crm.adminId, sqlNow()]);
  await crmAudit(req, { action: 'crm_refund_flagged', entityType: 'crm_refund', entityId: ins.insertId, next: { source: 'staff', kind, purchaseId: p.id, amountCents: amount, isFull } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

// Confirm or dismiss (CRM Admin). Confirm needs to know if it was a FULL refund (a Stripe dispute and a hand-raised flag may not say): send isFull true or false.
async function decide(req, res, to) {
  const id = posInt(req.params.id);
  const [[f]] = id ? await pool.query('SELECT * FROM crm_purchase_refunds WHERE id = ?', [id]) : [[null]];
  if (!f) return res.status(404).json({ error: 'Flag not found.' });
  const b = req.body || {};
  let isFull = f.is_full === null ? null : Number(f.is_full);
  if (to === 'confirmed') {
    if (b.isFull === true) isFull = 1; else if (b.isFull === false) isFull = 0;
    if (isFull === null) return res.status(400).json({ error: 'Say whether it was a full refund.' });
  }
  const note = text(b.note, 500);
  // Compare-and-set, so a double click or two admins is one decision and one audit row.
  const [u] = await pool.query(
    'UPDATE crm_purchase_refunds SET state = ?, is_full = ?, note = COALESCE(?, note), decided_by_admin_id = ?, decided_at = ? WHERE id = ? AND state = ?',
    [to, isFull, note, req.crm.adminId, sqlNow(), f.id, 'needs_review']);
  if (!u.affectedRows) return res.status(409).json({ error: 'Someone already decided this flag.' });
  await crmAudit(req, { action: to === 'confirmed' ? 'crm_refund_confirmed' : 'crm_refund_dismissed', entityType: 'crm_refund', entityId: f.id, prev: { state: f.state, isFull: f.is_full }, next: { state: to, isFull, purchaseId: f.purchase_id } });
  await crmHooks.purchaseChanged(f.purchase_id); // re-checks the buyer: a Customer with no paid purchase left gets the existing "needs review" note, never a new label
  res.json({ ok: true });
}
router.post('/:id/confirm', requireAuth, requireCrm('decide_refund'), (req, res) => decide(req, res, 'confirmed'));
router.post('/:id/dismiss', requireAuth, requireCrm('decide_refund'), (req, res) => decide(req, res, 'dismissed'));

module.exports = router;
