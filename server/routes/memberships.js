const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createPurchase } = require('./newsletter');

const router = express.Router();
const STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

function serialize(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    membershipPlanId: row.membership_plan_id,
    planName: row.plan_name,
    memberType: row.member_type,
    status: row.status,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    purchaseId: row.purchase_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

const SELECT_WITH_PLAN = `
  SELECT cm.*, mp.name AS plan_name, mp.member_type
  FROM contact_memberships cm
  JOIN membership_plans mp ON mp.id = cm.membership_plan_id
`;

// Admin: browse/search every contact's memberships — backs the Members tab
// on admin-memberships.html. Optional filters keep it usable once this list
// gets long.
router.get('/', requireAuth, async (req, res) => {
  const { memberType, status, membershipPlanId } = req.query;
  let sql = SELECT_WITH_PLAN + ' WHERE 1=1';
  const params = [];
  if (memberType) { sql += ' AND mp.member_type = ?'; params.push(memberType); }
  if (status) { sql += ' AND cm.status = ?'; params.push(status); }
  if (membershipPlanId) { sql += ' AND cm.membership_plan_id = ?'; params.push(membershipPlanId); }
  sql += ' ORDER BY cm.started_at DESC LIMIT 500';

  const [rows] = await pool.query(sql, params);
  if (!rows.length) return res.json({ memberships: [] });

  const contactIds = [...new Set(rows.map(r => r.contact_id))];
  const [contactRows] = await pool.query('SELECT id, name, email, company FROM newsletter_contacts WHERE id IN (?)', [contactIds]);
  const contactById = Object.fromEntries(contactRows.map(c => [c.id, c]));

  res.json({
    memberships: rows.map(r => ({
      ...serialize(r),
      contact: contactById[r.contact_id] ? { name: contactById[r.contact_id].name, email: contactById[r.contact_id].email, company: contactById[r.contact_id].company } : null,
    })),
  });
});

// A contact's memberships, for display on their CRM record.
router.get('/contacts/:contactId', requireAuth, async (req, res) => {
  const [rows] = await pool.query(SELECT_WITH_PLAN + ' WHERE cm.contact_id = ? ORDER BY cm.started_at DESC', [req.params.contactId]);
  res.json({ memberships: rows.map(serialize) });
});

// Admin manually grants a membership — e.g. a comped membership, or logging
// a payment that happened outside Stripe. Creates both the order record
// (purchases, so it shows up in Orders/Financial Insights per the "a
// subscription purchase counts as an order" requirement) and the membership
// itself. No Stripe involvement at all — this path always works even before
// Stripe is configured.
router.post('/contacts/:contactId', requireAuth, async (req, res) => {
  const b = req.body || {};
  const contactId = Number(req.params.contactId);
  const membershipPlanId = Number(b.membershipPlanId);
  if (!membershipPlanId) return res.status(400).json({ error: 'membershipPlanId is required' });

  const [contactRows] = await pool.query('SELECT id FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!contactRows[0]) return res.status(404).json({ error: 'Contact not found' });
  const [planRows] = await pool.query('SELECT * FROM membership_plans WHERE id = ?', [membershipPlanId]);
  const plan = planRows[0];
  if (!plan) return res.status(404).json({ error: 'Membership plan not found' });

  const purchaseId = await createPurchase(contactId, {
    productType: 'membership',
    membershipPlanId,
    amountCents: plan.price_cents,
    source: b.source || 'Manual Entry',
    notes: b.notes || '',
    paymentMethod: b.paymentMethod || 'manual',
    paymentStatus: b.paymentStatus || 'paid',
  });

  const status = plan.trial_days > 0 ? 'trialing' : 'active';
  const [result] = await pool.query(
    'INSERT INTO contact_memberships (contact_id, membership_plan_id, status, purchase_id) VALUES (?, ?, ?, ?)',
    [contactId, membershipPlanId, status, purchaseId]
  );

  const [rows] = await pool.query(SELECT_WITH_PLAN + ' WHERE cm.id = ?', [result.insertId]);
  res.status(201).json({ membership: serialize(rows[0]) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (b.status && !STATUSES.includes(b.status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  const [existing] = await pool.query('SELECT * FROM contact_memberships WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Membership not found' });

  const status = b.status || existing[0].status;
  const endsAt = ['cancelled', 'expired'].includes(status) ? (existing[0].ends_at || new Date()) : null;
  await pool.query('UPDATE contact_memberships SET status = ?, ends_at = ? WHERE id = ?', [status, endsAt, req.params.id]);

  const [rows] = await pool.query(SELECT_WITH_PLAN + ' WHERE cm.id = ?', [req.params.id]);
  res.json({ membership: serialize(rows[0]) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM contact_memberships WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Membership not found' });
  res.json({ ok: true });
});

module.exports = router;
