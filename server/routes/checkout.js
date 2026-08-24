const express = require('express');
const Stripe = require('stripe');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { createPurchase } = require('./newsletter');
const { fireAutomation } = require('../lib/automations');
const { getSiteUser } = require('../lib/access');
const { createToken } = require('../lib/site-tokens');
const { generateInvoiceNumber } = require('../lib/invoice-numbering');
const { getSetting } = require('../lib/settings');

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
async function createSetPasswordUrl(email, firstName, lastName, next = '') {
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
    // Auto-claim any pending license seat invited to this email — only for active
    // purchases; domain must match for group licenses (NULL school_domain = no constraint).
    await pool.query(
      `UPDATE license_seats ls
       JOIN purchases p ON p.id = ls.purchase_id
       SET ls.status = 'registered', ls.registered_site_user_id = ?, ls.registered_at = NOW()
       WHERE ls.invited_email = ?
         AND ls.status = 'pending'
         AND p.license_status NOT IN ('pending', 'expired', 'cancelled', 'suspended')
         AND (p.expiration_date IS NULL OR p.expiration_date >= CURDATE())
         AND (p.school_domain IS NULL OR LOWER(SUBSTRING_INDEX(?, '@', -1)) = LOWER(p.school_domain))`,
      [userId, email, email]
    );
  }
  const token = await createToken(userId, 'reset', 7 * 24 * 60 * 60 * 1000);
  const nextSuffix = next ? `&next=${encodeURIComponent(next)}` : '';
  return `${siteUrl}/reset-password.html?token=${token}${nextSuffix}`;
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
  const email = (b.email || '').trim();

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const siteUrl = process.env.SITE_URL || '';

  // New path: productId from license_products (variable-seat, admin-controlled price)
  if (b.productId) {
    const productId = Number(b.productId);
    const seatCount = Number(b.seatCount);
    if (!productId) return res.status(400).json({ error: 'Invalid productId' });
    if (!(seatCount > 0)) return res.status(400).json({ error: 'seatCount must be a positive number' });

    const [rows] = await pool.query(
      'SELECT id, name, price_cents, variable_seats, is_trial, trial_days, trial_lesson_limit, active FROM license_products WHERE id = ?',
      [productId]
    );
    const lp = rows[0];
    if (!lp || !lp.active || (!lp.variable_seats && !lp.is_trial)) {
      return res.status(400).json({ error: 'License product not found or not available' });
    }

    const resolvedSeatCount = lp.is_trial ? 1 : Number(b.seatCount);
    if (!lp.is_trial && !(resolvedSeatCount > 0)) {
      return res.status(400).json({ error: 'seatCount must be a positive number' });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: lp.name },
          unit_amount: lp.price_cents,
        },
        quantity: resolvedSeatCount,
      }],
      metadata: { productId: String(productId), seatCount: String(resolvedSeatCount), email },
      success_url: `${siteUrl}/licenses.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/licenses.html?checkout=cancelled`,
    });
    return res.json({ url: session.url });
  }

  // Legacy path: hardcoded productType (single_license / group_license)
  const productType = b.productType;
  if (!PRICING[productType]) {
    return res.status(400).json({ error: 'productType must be single_license or group_license' });
  }

  const quantity = productType === 'group_license' ? Number(b.seatCount) : 1;
  if (productType === 'group_license' && !(quantity > 0)) {
    return res.status(400).json({ error: 'seatCount must be a positive number' });
  }

  const product = PRICING[productType];

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

// Returns the purchaseIds created for license_product items specifically
// (not books) — callers that need to grant school-admin setup access
// (setupSchoolAdmin) only ever want the license purchases, never a book.
async function fulfillResolvedItems(contactId, resolved, fulfillmentFields) {
  const licensePurchaseIds = [];
  for (const item of resolved) {
    const purchaseId = await createPurchase(contactId, {
      productType: item.type === 'book' ? 'book' : 'group_license',
      bookId: item.type === 'book' ? item.id : undefined,
      licenseProductId: item.type === 'license_product' ? item.id : undefined,
      seatCount: item.type === 'license_product' ? item.seatCount : undefined,
      schoolDomain: item.type === 'license_product' ? item.domain : undefined,
      amountCents: item.amountCents,
      ...fulfillmentFields,
    });
    if (item.type === 'license_product') licensePurchaseIds.push(purchaseId);
  }
  return licensePurchaseIds;
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

  const licensePurchaseIds = await fulfillResolvedItems(contactId, resolved, {
    source: 'Purchase Order',
    paymentMethod: 'po',
    paymentStatus: 'pending',
    poNumber,
    invoiceId,
  });

  // PO orders do not grant immediate CONTENT access — license activates
  // only after an admin marks the hard-copy PO received
  // (POST /api/invoices/:id/po-received). But the buyer still needs a way
  // to log in and manage the roster/invite teachers in the meantime — the
  // quote-accepted PO path and the Stripe cart path both call
  // setupSchoolAdmin() for exactly this reason; this direct-cart PO path
  // never did, leaving a school that pays in full via PO with no way to
  // log in at all until this fix.
  await pool.query(
    "UPDATE purchases SET license_status = 'pending' WHERE invoice_id = ?",
    [invoiceId]
  );
  if (licensePurchaseIds.length) {
    await setupSchoolAdmin(email, licensePurchaseIds);
  }

  res.status(201).json({ ok: true, invoiceId, invoiceNumber });
});

async function handleTrialConversionCompleted(session, metadata) {
  const trialPurchaseId = Number(metadata.trialPurchaseId);
  const targetProductId = Number(metadata.targetProductId);
  const seatCount = Number(metadata.seatCount) || 1;

  const [trialRows] = await pool.query(
    `SELECT p.*, nc.email, nc.name AS contact_name
     FROM purchases p
     LEFT JOIN newsletter_contacts nc ON nc.id = p.contact_id
     WHERE p.id = ?`,
    [trialPurchaseId]
  );
  const trial = trialRows[0];
  if (!trial) return;

  const [existing] = await pool.query('SELECT id FROM purchases WHERE stripe_session_id = ? LIMIT 1', [session.id]);
  if (existing.length) return;

  const newPurchaseId = await createPurchase(trial.contact_id, {
    productType: 'group_license',
    licenseProductId: targetProductId,
    seatCount,
    source: 'Stripe',
    stripeSessionId: session.id,
    paymentMethod: 'stripe',
    paymentStatus: 'paid',
    amountCents: session.amount_total,
  });

  await pool.query(
    "UPDATE purchases SET license_status = 'converted', conversion_credit_redeemed_at = NOW(), converted_to_purchase_id = ? WHERE id = ?",
    [newPurchaseId, trialPurchaseId]
  );
  await pool.query(
    "UPDATE license_seats SET status = 'inactive' WHERE purchase_id = ? AND status IN ('registered', 'pending', 'available')",
    [trialPurchaseId]
  );

  const firstName = (trial.contact_name || '').split(' ')[0] || 'there';
  await fireAutomation('trial_converted', {
    to: trial.email,
    mergeFields: { firstName },
  });
}

router.post('/convert-trial', async (req, res) => {
  const siteUser = await getSiteUser(req);
  if (!siteUser) return res.status(401).json({ error: 'Not authenticated' });

  const b = req.body || {};
  const targetProductId = Number(b.targetProductId);
  const seatCount = Math.max(1, Number(b.seatCount) || 1);
  if (!targetProductId) return res.status(400).json({ error: 'targetProductId is required' });

  const [contactRows] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [siteUser.email]);
  if (!contactRows[0]) return res.status(404).json({ error: 'No account found' });
  const contactId = contactRows[0].id;

  const [trialRows] = await pool.query(
    `SELECT p.* FROM purchases p
     WHERE p.contact_id = ?
       AND p.license_status = 'active'
       AND p.trial_expiration_date IS NOT NULL
       AND p.trial_expiration_date > NOW()
       AND p.conversion_credit_redeemed_at IS NULL
     ORDER BY p.created_at DESC LIMIT 1`,
    [contactId]
  );
  const trial = trialRows[0];
  if (!trial) return res.status(404).json({ error: 'No active trial found' });

  const [lpRows] = await pool.query('SELECT id, name, price_cents FROM license_products WHERE id = ? AND active = 1', [targetProductId]);
  const lp = lpRows[0];
  if (!lp) return res.status(404).json({ error: 'Target product not found' });

  const conversionCredit = trial.conversion_credit_cents || 0;
  const totalCents = Math.max(0, (lp.price_cents * seatCount) - conversionCredit);

  const siteUrl = process.env.SITE_URL || '';
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: siteUser.email,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: lp.name },
        unit_amount: totalCents,
      },
      quantity: 1,
    }],
    metadata: {
      type: 'trial_conversion',
      trialPurchaseId: String(trial.id),
      targetProductId: String(targetProductId),
      seatCount: String(seatCount),
      email: siteUser.email,
    },
    success_url: `${siteUrl}/my-license.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/my-license.html?checkout=cancelled`,
  });

  res.json({ url: session.url });
});

// Fires the onboarding email and wires up the school_license_admins record for a
// group license purchase that came in via Stripe (cart or licenses.html). Mirrors
// the same steps the quote acceptance path runs.
async function setupSchoolAdmin(email, purchaseIds) {
  const firstName = email.split('@')[0].split('.')[0] || 'there';
  let setupUrl = '';
  try { setupUrl = await createSetPasswordUrl(email, firstName, '', '/school-admin-roster.html'); }
  catch (e) { console.error('createSetPasswordUrl failed:', e.message); }
  let school = 'your school';
  try {
    const [[p]] = await pool.query('SELECT school_domain FROM purchases WHERE id IN (?) AND school_domain IS NOT NULL LIMIT 1', [purchaseIds]);
    if (p) school = p.school_domain;
  } catch (e) { console.error('setupSchoolAdmin school_domain lookup failed:', e.message); }
  let siteUserId = null;
  try {
    const [[u]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email.toLowerCase()]);
    siteUserId = u ? u.id : null;
  } catch (e) { console.error('setupSchoolAdmin user lookup failed:', e.message); }
  for (const purchaseId of purchaseIds) {
    try {
      if (siteUserId) {
        await pool.query(
          "UPDATE site_users SET role = 'school_license_admin' WHERE id = ? AND role NOT IN ('admin','school_license_admin')",
          [siteUserId]
        );
        await pool.query(
          "INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)",
          [siteUserId, purchaseId]
        );
      }
    } catch (e) { console.error('school_license_admins insert failed:', e.message); }
  }
  try {
    await fireAutomation('quote_accepted', {
      to: email,
      mergeFields: { firstName, school, productName: 'Fixer Nation Education License', setupUrl },
    });
  } catch (e) { console.error('group license onboarding automation failed:', e.message); }
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

    if (metadata.type === 'trial_conversion') {
      await handleTrialConversionCompleted(session, metadata);
      return res.json({ received: true });
    }

    if (metadata.type === 'quote_acceptance') {
      const [[qt]] = await pool.query('SELECT * FROM quote_requests WHERE accept_token = ?', [metadata.quoteToken]);
      if (qt && !qt.accepted_at) {
        await pool.query(
          "UPDATE quote_requests SET accepted_at = NOW(), accepted_payment_method = 'card', status = 'converted' WHERE id = ?",
          [qt.id]
        );
        if (metadata.purchaseId) {
          await pool.query("UPDATE purchases SET payment_status = 'paid' WHERE id = ?", [Number(metadata.purchaseId)]);
        }
        const siteUrl = process.env.SITE_URL || '';
        let setupUrl = '';
        try { setupUrl = await createSetPasswordUrl(qt.email, qt.first_name, qt.last_name, '/school-admin-roster.html'); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }

        // Register buyer as school license admin
        try {
          const [[siteUser]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [qt.email.toLowerCase()]);
          if (siteUser && metadata.purchaseId) {
            await pool.query("UPDATE site_users SET role = 'school_license_admin' WHERE id = ? AND role NOT IN ('admin','school_license_admin')", [siteUser.id]);
            await pool.query(
              "INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)",
              [siteUser.id, Number(metadata.purchaseId)]
            );
          }
        } catch (e) { console.error('school_license_admins webhook insert failed:', e.message); }

        try {
          await fireAutomation('quote_accepted', {
            to: qt.email,
            mergeFields: {
              firstName: qt.first_name || 'there',
              school: qt.school || '',
              productName: qt.quoted_product_name || '',
              setupUrl,
            },
          });
        } catch (e) { console.error('quote_accepted automation failed:', e.message); }
      }
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
        const licenseItems = resolved.filter(r => r.type === 'license_product');
        if (licenseItems.length) {
          const [newPurchases] = await pool.query(
            "SELECT id FROM purchases WHERE stripe_session_id = ? AND product_type = 'group_license'",
            [session.id]
          );
          await setupSchoolAdmin(metadata.email, newPurchases.map(p => p.id));
        }
      } else if (metadata.productId) {
        // Variable-seat or trial flow from licenses.html — look up the product
        // to decide whether this is a trial (single seat) or group license.
        const [lpRows] = await pool.query(
          'SELECT id, name, price_cents, is_trial, trial_days, trial_lesson_limit, trial_library_limit FROM license_products WHERE id = ?',
          [Number(metadata.productId)]
        );
        const lp = lpRows[0];
        if (lp && lp.is_trial) {
          const trialLibraryLimit = lp.trial_library_limit || Math.max(1, parseInt(await getSetting('teacher_lesson_plan_limit_trial') || '10', 10));
          await createPurchase(contactId, {
            productType: 'single_license',
            licenseProductId: lp.id,
            seatCount: 1,
            source: 'Stripe',
            stripeSessionId: session.id,
            paymentMethod: 'stripe',
            paymentStatus: 'paid',
            amountCents: session.amount_total,
            trialExpirationDate: daysFromNow(lp.trial_days || 30),
            trialLessonLimit: lp.trial_lesson_limit || 4,
            trialLibraryLimit,
            conversionCreditCents: lp.price_cents,
          });
          const firstName = (metadata.email || '').split('@')[0].split('.')[0] || 'there';
          let setPasswordUrl = '';
          try { setPasswordUrl = await createSetPasswordUrl(metadata.email, firstName, ''); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }
          await fireAutomation('trial_purchase_thank_you', {
            to: metadata.email,
            mergeFields: { firstName, setPasswordUrl, trialDays: String(lp.trial_days || 30), lessonLimit: String(lp.trial_lesson_limit || 4) },
          });
        } else {
          const purchaseId = await createPurchase(contactId, {
            productType: 'group_license',
            licenseProductId: Number(metadata.productId),
            seatCount: Number(metadata.seatCount),
            source: 'Stripe',
            stripeSessionId: session.id,
            paymentMethod: 'stripe',
            paymentStatus: 'paid',
            amountCents: session.amount_total,
          });
          await setupSchoolAdmin(metadata.email, [purchaseId]);
        }
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

module.exports = { router, webhookHandler, createSetPasswordUrl };
