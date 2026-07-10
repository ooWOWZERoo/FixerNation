const express = require('express');
const Stripe = require('stripe');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { createPurchase, assignContactToGroups } = require('./newsletter');
const { fireAutomation } = require('../lib/automations');
const { createToken } = require('../lib/site-tokens');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CART_ITEMS = 10;

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// Creates a shell site_users account (email pre-verified via Stripe payment)
// and returns a 7-day set-password URL. Safe to call repeatedly — if the
// account already exists it just issues a new token (equivalent to a password
// reset, which is harmless). Errors are caught by the caller so a failure
// here never blocks the thank-you email from going out.
async function createSetPasswordUrl(email, firstName, lastName) {
  const siteUrl = process.env.SITE_URL || '';
  const [existing] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email]);
  let userId;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    // Placeholder hash satisfies NOT NULL — user sets their real password via the token link.
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const [result] = await pool.query(
      'INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified) VALUES (?, ?, ?, ?, 1)',
      [firstName || '', lastName || '', email, placeholderHash]
    );
    userId = result.insertId;
    // Auto-claim any pending license seat invited to this email, same as normal signup.
    await pool.query(
      "UPDATE license_seats SET status = 'registered', registered_site_user_id = ?, registered_at = NOW() WHERE invited_email = ? AND status = 'pending'",
      [userId, email]
    );
  }
  const token = await createToken(userId, 'reset', 7 * 24 * 60 * 60 * 1000);
  return `${siteUrl}/reset-password.html?token=${token}`;
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days));
  return d;
}

async function findOrCreateContact(email, source, name) {
  const [existing] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (existing[0]) return existing[0].id;
  const [result] = await pool.query(
    'INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, ?, ?)',
    [name || '', email, source, 'Subscribed']
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
  const [lpRows] = licenseProductIds.length ? await pool.query('SELECT id, name, seat_count, price_cents, call_for_quote FROM license_products WHERE id IN (?)', [licenseProductIds]) : [[]];
  const bookById = Object.fromEntries(bookRows.map(b => [b.id, b]));
  const lpById = Object.fromEntries(lpRows.map(lp => [lp.id, lp]));

  const lineItems = [];
  const resolved = [];

  for (const item of items) {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    if (item.type === 'book') {
      const book = bookById[item.id];
      if (!book) throw { status: 400, message: `Book ${item.id} not found` };
      const unitAmountCents = Math.round(Number(book.price) * 100);
      lineItems.push({
        price_data: { currency: 'usd', product_data: { name: book.title }, unit_amount: unitAmountCents },
        quantity,
      });
      resolved.push({ type: 'book', id: book.id, name: book.title, amountCents: unitAmountCents * quantity });
    } else if (item.type === 'license_product') {
      const lp = lpById[item.id];
      if (!lp) throw { status: 400, message: `License product ${item.id} not found` };
      if (lp.call_for_quote) throw { status: 400, message: `${lp.name} requires a custom quote and can't be checked out online — contact us directly` };
      const domain = (item.schoolDomain || '').trim();
      if (!domain) throw { status: 400, message: `A school domain is required for ${lp.name}` };
      lineItems.push({
        price_data: { currency: 'usd', product_data: { name: lp.name }, unit_amount: lp.price_cents },
        quantity,
      });
      // A quantity > 1 on a license product multiplies the seat count within
      // one license block for that school, rather than creating separate
      // blocks — simplest mapping of "add another one of these" to one domain.
      resolved.push({ type: 'license_product', id: lp.id, name: lp.name, seatCount: lp.seat_count * quantity, domain, amountCents: lp.price_cents * quantity });
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
      amountCents: item.amountCents,
      ...fulfillmentFields,
    });
  }
}

// "INV-00001" style, generated after the row exists so it can incorporate the
// real auto-increment id — simplest scheme that's guaranteed unique.
async function generateInvoiceNumber(connection, invoiceId) {
  const invoiceNumber = `INV-${String(invoiceId).padStart(5, '0')}`;
  await connection.query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, invoiceId]);
  return invoiceNumber;
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
  const totalCents = resolved.reduce((sum, item) => sum + (item.amountCents || 0), 0);

  const connection = await pool.getConnection();
  let invoiceId, invoiceNumber;
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      'INSERT INTO invoices (contact_id, po_number, total_cents, status) VALUES (?, ?, ?, ?)',
      [contactId, poNumber, totalCents, 'unpaid']
    );
    invoiceId = result.insertId;
    invoiceNumber = await generateInvoiceNumber(connection, invoiceId);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await fulfillResolvedItems(contactId, resolved, {
    source: 'Purchase Order',
    paymentMethod: 'po',
    paymentStatus: 'pending',
    poNumber,
    invoiceId,
  });

  res.status(201).json({ ok: true, invoiceId, invoiceNumber });
});

// Where a paid membership plan's checkout should return to — derived from
// the plan's member type server-side, never from client input, so there's
// no open-redirect surface here.
const MEMBERSHIP_RETURN_PAGES = {
  consumer: 'join.html',
  service_provider: 'service-providers.html',
  brand_ambassador: 'brand-ambassador.html',
};

// Recurring plans (monthly/annual) check out in Stripe subscription mode;
// one_time plans (the free book-perk tier is granted directly, never through
// checkout — see below) use plain payment mode. Fulfillment for both only
// happens from the webhook once Stripe confirms it, same as every other
// checkout flow in this file.
router.post('/create-membership-session', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  const firstName = (b.firstName || '').trim();
  const lastName = (b.lastName || '').trim();
  const membershipPlanId = Number(b.membershipPlanId);

  if (!email || !EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!membershipPlanId) return res.status(400).json({ error: 'membershipPlanId is required' });

  const [planRows] = await pool.query('SELECT * FROM membership_plans WHERE id = ? AND active = 1', [membershipPlanId]);
  const plan = planRows[0];
  if (!plan) return res.status(404).json({ error: 'Membership plan not found' });
  if (!plan.stripe_price_id) return res.status(400).json({ error: "This plan isn't available for online checkout yet — contact us to sign up." });

  const returnPage = MEMBERSHIP_RETURN_PAGES[plan.member_type] || 'join.html';
  const siteUrl = process.env.SITE_URL || '';
  const isRecurring = plan.billing_interval === 'monthly' || plan.billing_interval === 'annual';

  const sessionParams = {
    mode: isRecurring ? 'subscription' : 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    metadata: { type: 'membership', membershipPlanId: String(plan.id), email, firstName, lastName },
    success_url: `${siteUrl}/${returnPage}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/${returnPage}?checkout=cancelled`,
  };
  if (isRecurring && plan.trial_days > 0) {
    sessionParams.subscription_data = { trial_period_days: plan.trial_days };
  }

  const session = await getStripe().checkout.sessions.create(sessionParams);
  res.json({ url: session.url });
});

// A subscription's very first real charge and every renewal after it all
// fire invoice.paid — routing every one of them through here (not through
// checkout.session.completed) means each actual charge becomes exactly one
// order, whether or not there was a trial in front of it. checkout.session.
// completed only establishes the subscription/membership record itself.
async function handleMembershipCheckoutCompleted(session, metadata) {
  const membershipPlanId = Number(metadata.membershipPlanId);
  const [planRows] = await pool.query('SELECT * FROM membership_plans WHERE id = ?', [membershipPlanId]);
  const plan = planRows[0];
  if (!plan) return;

  const contactId = await findOrCreateContact(metadata.email, 'Membership Signup', `${metadata.firstName || ''} ${metadata.lastName || ''}`.trim());
  const firstName = (metadata.firstName || '').trim() || 'there';

  if (session.mode === 'payment') {
    const [existing] = await pool.query('SELECT id FROM purchases WHERE stripe_session_id = ? LIMIT 1', [session.id]);
    if (existing.length) return;
    const purchaseId = await createPurchase(contactId, {
      productType: 'membership',
      membershipPlanId,
      amountCents: session.amount_total,
      source: 'Stripe',
      stripeSessionId: session.id,
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
    });
    const endsAt = plan.duration_days ? daysFromNow(plan.duration_days) : null;
    await pool.query(
      'INSERT INTO contact_memberships (contact_id, membership_plan_id, status, purchase_id, ends_at) VALUES (?, ?, ?, ?, ?)',
      [contactId, membershipPlanId, 'active', purchaseId, endsAt]
    );
    try { await assignContactToGroups(contactId, { productType: 'membership', memberType: plan.member_type }); } catch (e) { console.error('assignContactToGroups failed:', e.message); }
    let setPasswordUrl = '';
    try { setPasswordUrl = await createSetPasswordUrl(metadata.email, (metadata.firstName || '').trim(), (metadata.lastName || '').trim()); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }
    await fireAutomation('membership_purchase_thank_you', {
      to: metadata.email,
      mergeFields: { firstName, planName: plan.name, setPasswordUrl },
    });
  } else if (session.mode === 'subscription' && session.subscription) {
    const [existing] = await pool.query('SELECT id FROM contact_memberships WHERE stripe_subscription_id = ? LIMIT 1', [session.subscription]);
    if (existing.length) return;
    // While trialing, the date that matters is when the trial ends (the
    // first real charge); once a real charge happens, handleMembershipInvoicePaid
    // re-anchors ends_at to the plan's normal billing-cycle length instead.
    const daysUntilEnd = plan.trial_days > 0 ? plan.trial_days : plan.duration_days;
    const endsAt = daysUntilEnd ? daysFromNow(daysUntilEnd) : null;
    await pool.query(
      'INSERT INTO contact_memberships (contact_id, membership_plan_id, status, stripe_subscription_id, stripe_customer_id, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
      [contactId, membershipPlanId, plan.trial_days > 0 ? 'trialing' : 'active', session.subscription, session.customer, endsAt]
    );
    try { await assignContactToGroups(contactId, { productType: 'membership', memberType: plan.member_type }); } catch (e) { console.error('assignContactToGroups failed:', e.message); }
    let setPasswordUrl = '';
    try { setPasswordUrl = await createSetPasswordUrl(metadata.email, (metadata.firstName || '').trim(), (metadata.lastName || '').trim()); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }
    if (plan.trial_days > 0) {
      await fireAutomation('membership_trial_started', {
        to: metadata.email,
        mergeFields: { firstName, planName: plan.name, trialDays: String(plan.trial_days), setPasswordUrl },
      });
    } else {
      await fireAutomation('membership_purchase_thank_you', {
        to: metadata.email,
        mergeFields: { firstName, planName: plan.name, setPasswordUrl },
      });
    }
  }
}

async function handleMembershipInvoicePaid(invoice) {
  if (!invoice.subscription) return; // not a subscription invoice — not ours to handle here

  const [membershipRows] = await pool.query(
    `SELECT cm.*, mp.duration_days, mp.name AS plan_name, nc.email, nc.name AS contact_name
     FROM contact_memberships cm
     JOIN membership_plans mp ON mp.id = cm.membership_plan_id
     JOIN newsletter_contacts nc ON nc.id = cm.contact_id
     WHERE cm.stripe_subscription_id = ? LIMIT 1`,
    [invoice.subscription]
  );
  const membership = membershipRows[0];
  if (!membership) return;

  const [existing] = await pool.query('SELECT id FROM purchases WHERE stripe_invoice_id = ? LIMIT 1', [invoice.id]);
  if (existing.length) return; // Stripe retries webhook delivery — guard against double-counting a renewal

  const wasTrial = membership.status === 'trialing';

  const purchaseId = await createPurchase(membership.contact_id, {
    productType: 'membership',
    membershipPlanId: membership.membership_plan_id,
    amountCents: invoice.amount_paid,
    source: 'Stripe',
    stripeInvoiceId: invoice.id,
    paymentMethod: 'stripe',
    paymentStatus: 'paid',
  });

  // A real charge just succeeded, so the next period is a normal billing
  // cycle (not a trial) — re-anchor ends_at from here and clear
  // reminder_sent_at so the reminder can fire again ahead of the new date.
  const endsAt = membership.duration_days ? daysFromNow(membership.duration_days) : null;
  await pool.query(
    "UPDATE contact_memberships SET purchase_id = ?, status = IF(status IN ('past_due','trialing'), 'active', status), ends_at = ?, reminder_sent_at = NULL WHERE id = ?",
    [purchaseId, endsAt, membership.id]
  );

  // Send a receipt when a trial ends and the first real charge succeeds.
  // Regular renewals (status was already 'active') don't get this email.
  if (wasTrial) {
    await fireAutomation('membership_purchase_thank_you', {
      to: membership.email,
      mergeFields: {
        firstName: (membership.contact_name || '').split(' ')[0] || 'there',
        planName: membership.plan_name,
      },
    });
  }
}

async function handleMembershipPaymentFailed(invoice) {
  if (!invoice.subscription) return;
  const [rows] = await pool.query(
    `SELECT cm.*, mp.name AS plan_name, nc.email, nc.name AS contact_name
     FROM contact_memberships cm
     JOIN membership_plans mp ON mp.id = cm.membership_plan_id
     JOIN newsletter_contacts nc ON nc.id = cm.contact_id
     WHERE cm.stripe_subscription_id = ? LIMIT 1`,
    [invoice.subscription]
  );
  const membership = rows[0];
  if (!membership) return;

  await pool.query("UPDATE contact_memberships SET status = 'past_due' WHERE id = ?", [membership.id]);
  await fireAutomation('payment_failed', {
    to: membership.email,
    mergeFields: { firstName: (membership.contact_name || '').split(' ')[0] || 'there', planName: membership.plan_name },
  });
}

async function handleMembershipSubscriptionUpdated(subscription) {
  const statusMap = {
    trialing: 'trialing', active: 'active', past_due: 'past_due',
    canceled: 'cancelled', unpaid: 'past_due', incomplete: 'trialing', incomplete_expired: 'expired',
  };
  const status = statusMap[subscription.status] || 'active';
  const endsAt = subscription.status === 'canceled' && subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null;
  await pool.query('UPDATE contact_memberships SET status = ?, ends_at = ? WHERE stripe_subscription_id = ?', [status, endsAt, subscription.id]);
}

async function handleMembershipSubscriptionDeleted(subscription) {
  await pool.query("UPDATE contact_memberships SET status = 'cancelled', ends_at = NOW() WHERE stripe_subscription_id = ?", [subscription.id]);
}

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

    if (metadata.type === 'membership') {
      await handleMembershipCheckoutCompleted(session, metadata);
      return res.json({ received: true });
    }

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
  } else if (event.type === 'invoice.paid') {
    await handleMembershipInvoicePaid(event.data.object);
  } else if (event.type === 'invoice.payment_failed') {
    await handleMembershipPaymentFailed(event.data.object);
  } else if (event.type === 'customer.subscription.updated') {
    await handleMembershipSubscriptionUpdated(event.data.object);
  } else if (event.type === 'customer.subscription.deleted') {
    await handleMembershipSubscriptionDeleted(event.data.object);
  }

  res.json({ received: true });
}

module.exports = { router, webhookHandler };
