const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { createPurchase } = require('./newsletter');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// Prices live here as plain constants rather than an admin-editable table —
// not worth building pricing UI until these actually need to change often.
const PRICING = {
  single_license: { name: 'Fixer Nation Single Teacher License', unitAmountCents: 4900 },
  group_license: { name: 'Fixer Nation Group License Seat', unitAmountCents: 3900 },
};

router.post('/create-session', async (req, res) => {
  const b = req.body || {};
  const productType = b.productType;
  const email = (b.email || '').trim();

  if (!PRICING[productType]) {
    return res.status(400).json({ error: 'productType must be single_license or group_license' });
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const quantity = productType === 'group_license' ? Number(b.seatCount) : 1;
  if (productType === 'group_license' && !(quantity > 0)) {
    return res.status(400).json({ error: 'seatCount must be a positive number' });
  }

  const product = PRICING[productType];
  const siteUrl = process.env.SITE_URL || '';

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: product.name },
        unit_amount: product.unitAmountCents,
      },
      quantity,
    }],
    metadata: { productType, seatCount: String(quantity), email },
    success_url: `${siteUrl}/licenses.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/licenses.html?checkout=cancelled`,
  });

  res.json({ url: session.url });
});

// Registered in server/app.js with express.raw() ahead of the global JSON
// body parser — Stripe's signature check needs the exact raw request body,
// which a JSON-parsed-and-reserialized body would not reproduce byte-for-byte.
async function webhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { productType, seatCount, email } = session.metadata || {};

    // Stripe retries webhook delivery — guard against creating the purchase twice.
    const [existing] = await pool.query('SELECT id FROM purchases WHERE stripe_session_id = ?', [session.id]);
    if (!existing.length && email) {
      const [existingContact] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
      let contactId = existingContact[0] && existingContact[0].id;
      if (!contactId) {
        const [result] = await pool.query(
          'INSERT INTO newsletter_contacts (email, source, status) VALUES (?, ?, ?)',
          [email, 'License Purchase', 'Subscribed']
        );
        contactId = result.insertId;
      }
      await createPurchase(contactId, {
        productType,
        seatCount: Number(seatCount),
        source: 'Stripe',
        stripeSessionId: session.id,
      });
    }
  }

  res.json({ received: true });
}

module.exports = { router, webhookHandler };
