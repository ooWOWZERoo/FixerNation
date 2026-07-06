const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');

const router = express.Router();

const MEMBER_TYPES = ['consumer', 'service_provider', 'brand_ambassador'];
const BILLING_INTERVALS = ['one_time', 'monthly', 'annual'];

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    memberType: row.member_type,
    price: Number(row.price_cents) / 100,
    regularPrice: row.regular_price_cents === null ? null : Number(row.regular_price_cents) / 100,
    billingInterval: row.billing_interval,
    trialDays: row.trial_days,
    durationDays: row.duration_days,
    description: row.description || '',
    benefits: row.benefits ? row.benefits.split('\n') : [],
    stripeConnected: !!row.stripe_price_id,
    sortOrder: row.sort_order,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

function validatePlan(b) {
  if (!b.name) return 'Name is required';
  if (!MEMBER_TYPES.includes(b.memberType)) return 'memberType must be consumer, service_provider, or brand_ambassador';
  if (!(Number(b.price) >= 0)) return 'A valid price is required';
  if (!BILLING_INTERVALS.includes(b.billingInterval)) return 'billingInterval must be one_time, monthly, or annual';
  return null;
}

// Keeps a real Stripe Product+Price in sync with a saved plan, so checkout
// always references a live Stripe object — but only when Stripe is actually
// configured. Without it, plans are still fully usable for admin tracking
// and manually-granted memberships; they just can't be checked out with a
// card until Stripe keys exist (same deferred state as license checkout).
// Stripe Prices are immutable, so a real price/interval change creates a new
// Price and retires the old one rather than editing it in place.
async function syncStripePrice(plan) {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const recurring = plan.billing_interval === 'monthly' ? 'month' : plan.billing_interval === 'annual' ? 'year' : null;

  let productId;
  if (plan.stripe_price_id) {
    const oldPrice = await stripe.prices.retrieve(plan.stripe_price_id);
    productId = oldPrice.product;
    await stripe.products.update(productId, { name: plan.name, description: plan.description || '' });
    const unchanged = oldPrice.unit_amount === plan.price_cents && (oldPrice.recurring ? oldPrice.recurring.interval : null) === recurring;
    if (unchanged) return plan.stripe_price_id;
    await stripe.prices.update(plan.stripe_price_id, { active: false });
  } else {
    const product = await stripe.products.create({ name: plan.name, description: plan.description || '' });
    productId = product.id;
  }

  const priceParams = { product: productId, unit_amount: plan.price_cents, currency: 'usd' };
  if (recurring) priceParams.recurring = { interval: recurring };
  const price = await stripe.prices.create(priceParams);
  return price.id;
}

async function saveStripeSync(plan) {
  try {
    const stripePriceId = await syncStripePrice(plan);
    if (stripePriceId && stripePriceId !== plan.stripe_price_id) {
      await pool.query('UPDATE membership_plans SET stripe_price_id = ? WHERE id = ?', [stripePriceId, plan.id]);
      plan.stripe_price_id = stripePriceId;
    }
  } catch (err) {
    // Don't fail the save — the plan is already in the DB either way, and
    // re-saving later (once Stripe is configured/fixed) will retry the sync.
    console.error('Stripe sync failed for membership plan', plan.id, err.message);
  }
  return plan;
}

// Public: active plans only, ordered for display, optionally filtered by
// member type for the three public pricing pages. Admin (authenticated):
// everything including inactive/draft plans, via ?all=true.
router.get('/', async (req, res) => {
  const wantsAll = req.query.all === 'true' && !!getAuthUser(req);
  const memberType = req.query.memberType;

  let sql = wantsAll ? 'SELECT * FROM membership_plans' : 'SELECT * FROM membership_plans WHERE active = 1';
  const params = [];
  if (memberType && MEMBER_TYPES.includes(memberType)) {
    sql += wantsAll ? ' WHERE member_type = ?' : ' AND member_type = ?';
    params.push(memberType);
  }
  sql += ' ORDER BY sort_order, id';

  const [rows] = await pool.query(sql, params);
  res.json({ membershipPlans: rows.map(serialize) });
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM membership_plans WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Membership plan not found' });
  res.json({ membershipPlan: serialize(rows[0]) });
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const validationError = validatePlan(b);
  if (validationError) return res.status(400).json({ error: validationError });

  const [result] = await pool.query(
    `INSERT INTO membership_plans (name, member_type, price_cents, regular_price_cents, billing_interval, trial_days, duration_days, description, benefits, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.name, b.memberType, Math.round(Number(b.price) * 100),
      b.regularPrice ? Math.round(Number(b.regularPrice) * 100) : null,
      b.billingInterval, Number(b.trialDays) || 0, b.durationDays ? Number(b.durationDays) : null, b.description || '',
      Array.isArray(b.benefits) ? b.benefits.filter(Boolean).join('\n') : (b.benefits || ''),
      Number(b.sortOrder) || 0, b.active === false ? 0 : 1,
    ]
  );

  const [rows] = await pool.query('SELECT * FROM membership_plans WHERE id = ?', [result.insertId]);
  const plan = await saveStripeSync(rows[0]);
  res.status(201).json({ membershipPlan: serialize(plan) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body || {};
  const validationError = validatePlan(b);
  if (validationError) return res.status(400).json({ error: validationError });

  const [existing] = await pool.query('SELECT id FROM membership_plans WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Membership plan not found' });

  await pool.query(
    `UPDATE membership_plans SET name=?, member_type=?, price_cents=?, regular_price_cents=?, billing_interval=?, trial_days=?, duration_days=?, description=?, benefits=?, sort_order=?, active=? WHERE id=?`,
    [
      b.name, b.memberType, Math.round(Number(b.price) * 100),
      b.regularPrice ? Math.round(Number(b.regularPrice) * 100) : null,
      b.billingInterval, Number(b.trialDays) || 0, b.durationDays ? Number(b.durationDays) : null, b.description || '',
      Array.isArray(b.benefits) ? b.benefits.filter(Boolean).join('\n') : (b.benefits || ''),
      Number(b.sortOrder) || 0, b.active === false ? 0 : 1, req.params.id,
    ]
  );

  const [rows] = await pool.query('SELECT * FROM membership_plans WHERE id = ?', [req.params.id]);
  const plan = await saveStripeSync(rows[0]);
  res.json({ membershipPlan: serialize(plan) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM contact_memberships WHERE membership_plan_id = ?', [req.params.id]);
  if (count > 0) {
    return res.status(409).json({ error: `${count} contact(s) currently hold this plan — deactivate it instead of deleting so their history stays intact` });
  }
  const [result] = await pool.query('DELETE FROM membership_plans WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Membership plan not found' });
  res.json({ ok: true });
});

module.exports = router;
