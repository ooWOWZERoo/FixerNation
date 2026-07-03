const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { createPurchase } = require('./newsletter');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CART_ITEMS = 10;

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function findOrCreateContact(email, source) {
  const [existing] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (existing[0]) return existing[0].id;
  const [result] = await pool.query(
    'INSERT INTO newsletter_contacts (email, source, status) VALUES (?, ?, ?)',
    [email, source, 'Subscribed']
  );
  return result.insertId;
}

// Prices for the flexible single/group license flow (licenses.html) live here
// as plain constants — not worth building pricing UI for these two until they
// actually need to change often. Fixed-tier school plans are a separate,
// admin-editable catalog (server/routes/license-products.js) sold via the cart.
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

// Looks up real prices/seat counts server-side for every cart line — never
// trusts a price the client might send. Throws { status, message } on any
// invalid item so callers can turn it into a clean 400 response.
async function resolveCartItems(items) {
  const bookIds = items.filter(i => i.type === 'book').map(i => i.id);
  const licenseProductIds = items.filter(i => i.type === 'license_product').map(i => i.id);

  const [bookRows] = bookIds.length ? await pool.query('SELECT id, title, price FROM books WHERE id IN (?)', [bookIds]) : [[]];
  const [lpRows] = licenseProductIds.length ? await pool.query('SELECT id, name, seat_count, price_cents FROM license_products WHERE id IN (?)', [licenseProductIds]) : [[]];
  const bookById = Object.fromEntries(bookRows.map(b => [b.id, b]));
  const lpById = Object.fromEntries(lpRows.map(lp => [lp.id, lp]));

  const lineItems = [];
  const resolved = [];

  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    if (item.type === 'book') {
      const book = bookById[item.id];
      if (!book) throw { status: 400, message: `Book ${item.id} not found` };
      lineItems.push({
        price_data: { currency: 'usd', product_data: { name: book.title }, unit_amount: Math.round(Number(book.price) * 100) },
        quantity,
      });
      resolved.push({ type: 'book', id: book.id });
    } else if (item.type === 'license_product') {
      const lp = lpById[item.id];
      if (!lp) throw { status: 400, message: `License product ${item.id} not found` };
      const domain = (item.schoolDomain || '').trim();
      if (!domain) throw { status: 400, message: `A school domain is required for ${lp.name}` };
      lineItems.push({
        price_data: { currency: 'usd', product_data: { name: lp.name }, unit_amount: lp.price_cents },
        quantity,
      });
      // A quantity > 1 on a license product multiplies the seat count within
      // one license block for that school, rather than creating separate
      // blocks — simplest mapping of "add another one of these" to one domain.
      resolved.push({ type: 'license_product', id: lp.id, seatCount: lp.seat_count * quantity, domain });
    } else {
      throw { status: 400, message: 'Invalid cart item type' };
    }
  }
  return { lineItems, resolved };
}

async function fulfillResolvedItems(contactId, resolved, fulfillmentFields) {
  for (const item of resolved) {
    await createPurchase(contactId, {
      productType: item.type === 'book' ? 'book' : 'group_license',
      bookId: item.type === 'book' ? item.id : undefined,
      licenseProductId: item.type === 'license_product' ? item.id : undefined,
      seatCount: item.type === 'license_product' ? item.seatCount : undefined,
      schoolDomain: item.type === 'license_product' ? item.domain : undefined,
      ...fulfillmentFields,
    });
  }
}

// Cart checkout — multiple books and/or license products in one Stripe
// Checkout session. Actual purchases are only created by the webhook once
// payment is confirmed (see webhookHandler below), never from this response.
router.post('/create-cart-session', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  const items = Array.isArray(b.items) ? b.items : [];

  if (!email || !EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
  if (items.length > MAX_CART_ITEMS) {
    return res.status(400).json({ error: `Carts are limited to ${MAX_CART_ITEMS} items — split into multiple orders or use a Purchase Order` });
  }

  let lineItems, resolved;
  try {
    ({ lineItems, resolved } = await resolveCartItems(items));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  // Stripe metadata values are capped at 500 characters — keep the encoded
  // cart comfortably under that instead of risking a truncated, unparseable
  // payload landing in the webhook.
  const cartJson = JSON.stringify(resolved);
  if (cartJson.length > 480) {
    return res.status(400).json({ error: 'Cart is too large for checkout — split into multiple orders or use a Purchase Order' });
  }

  const siteUrl = process.env.SITE_URL || '';
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: lineItems,
    metadata: { cart: cartJson, email },
    success_url: `${siteUrl}/cart.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/cart.html?checkout=cancelled`,
  });

  res.json({ url: session.url });
});

// Purchase Order checkout — no card payment at all. Creates the purchases
// (and grants license seats) immediately so the school isn't blocked waiting
// on their business office, but flags payment_status='pending' so an admin
// can track who still owes money and mark it paid once received.
router.post('/create-po-order', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  const poNumber = (b.poNumber || '').trim();
  const items = Array.isArray(b.items) ? b.items : [];

  if (!email || !EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!poNumber) return res.status(400).json({ error: 'A Purchase Order number is required' });
  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
  if (items.length > MAX_CART_ITEMS) return res.status(400).json({ error: `Orders are limited to ${MAX_CART_ITEMS} items` });

  let resolved;
  try {
    ({ resolved } = await resolveCartItems(items));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const contactId = await findOrCreateContact(email, 'Purchase Order');
  await fulfillResolvedItems(contactId, resolved, {
    source: 'Purchase Order',
    paymentMethod: 'po',
    paymentStatus: 'pending',
    poNumber,
  });

  res.status(201).json({ ok: true });
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
    const metadata = session.metadata || {};

    // Stripe retries webhook delivery — guard against creating purchases twice.
    // (stripe_session_id is intentionally not a DB-unique constraint since a
    // single cart session now produces multiple purchase rows.)
    const [existing] = await pool.query('SELECT id FROM purchases WHERE stripe_session_id = ? LIMIT 1', [session.id]);
    if (!existing.length && metadata.email) {
      const contactId = await findOrCreateContact(metadata.email, 'License Purchase');

      if (metadata.cart) {
        const resolved = JSON.parse(metadata.cart);
        await fulfillResolvedItems(contactId, resolved, {
          source: 'Stripe',
          stripeSessionId: session.id,
          paymentMethod: 'stripe',
          paymentStatus: 'paid',
        });
      } else if (metadata.productType) {
        // Legacy single-item flow from licenses.html.
        await createPurchase(contactId, {
          productType: metadata.productType,
          seatCount: Number(metadata.seatCount),
          source: 'Stripe',
          stripeSessionId: session.id,
          paymentMethod: 'stripe',
          paymentStatus: 'paid',
        });
      }
    }
  }

  res.json({ received: true });
}

module.exports = { router, webhookHandler };
