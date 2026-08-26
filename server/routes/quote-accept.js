const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { createPurchase } = require('./newsletter');
const { fireAutomation } = require('../lib/automations');
const { createSetPasswordUrl } = require('./checkout');
const { sendAutomationEmail, sendSalesAlertEmail } = require('../lib/mailer');
const { generateInvoiceNumber } = require('../lib/invoice-numbering');
const { getSetting } = require('../lib/settings');

const router = express.Router();

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function quoteStatus(quote) {
  if (!quote) return 'not_found';
  if (quote.accepted_at) return 'already_accepted';
  if (quote.quote_valid_until) {
    const expiry = new Date(quote.quote_valid_until);
    expiry.setHours(23, 59, 59, 999);
    if (expiry < new Date()) return 'expired';
  }
  return 'valid';
}

router.get('/accept', async (req, res) => {
  const token = (req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE accept_token = ?', [token]);
  const status = quoteStatus(quote);
  if (status !== 'valid') return res.status(400).json({ error: status });

  res.json({
    quoteNumber: quote.quote_number || null,
    school: quote.school || '',
    firstName: quote.first_name || '',
    lastName: quote.last_name || '',
    email: quote.email || '',
    productName: quote.quoted_product_name || '',
    seatCount: quote.quoted_seat_count || null,
    amountDollars: quote.quoted_amount_cents != null ? quote.quoted_amount_cents / 100 : null,
    quoteValidUntil: quote.quote_valid_until ? String(quote.quote_valid_until).slice(0, 10) : null,
  });
});

router.post('/accept', async (req, res) => {
  const { token, paymentMethod } = req.body || {};
  const poNumber = (req.body?.poNumber || '').trim();
  if (!token) return res.status(400).json({ error: 'Token is required' });
  if (!['card', 'po'].includes(paymentMethod)) return res.status(400).json({ error: 'paymentMethod must be card or po' });
  if (paymentMethod === 'po' && !poNumber) return res.status(400).json({ error: 'A Purchase Order number is required' });

  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE accept_token = ?', [token]);
  const status = quoteStatus(quote);
  if (status !== 'valid') return res.status(400).json({ error: status });

  // Claim the quote atomically BEFORE creating anything, for the PO path —
  // the read-then-write above has no lock between them, so two near-
  // simultaneous requests (a double-click, a client retry after a slow
  // response) could both pass the check above and each go on to create
  // their own purchase, invoice, and quote_accepted email. The card path
  // doesn't need this: it only ever creates a 'pending' purchase and a
  // Stripe Checkout session here, and the webhook that actually grants
  // access already re-checks `!qt.accepted_at` before doing anything
  // (server/routes/checkout.js) — a duplicate request here just creates an
  // extra abandoned session, not a duplicate real invoice.
  if (paymentMethod === 'po') {
    const [claimResult] = await pool.query(
      "UPDATE quote_requests SET accepted_at = NOW(), accepted_payment_method = 'po', status = 'converted' WHERE id = ? AND accepted_at IS NULL",
      [quote.id]
    );
    if (claimResult.affectedRows === 0) return res.status(400).json({ error: 'already_accepted' });
  }

  // Find or create the contact
  const [existingContact] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [quote.email]);
  let contactId;
  if (existingContact[0]) {
    contactId = existingContact[0].id;
  } else {
    const [r] = await pool.query(
      "INSERT INTO newsletter_contacts (name, email, company, source, status) VALUES (?, ?, ?, 'Quote Request', 'Subscribed')",
      [`${quote.first_name || ''} ${quote.last_name || ''}`.trim() || quote.email, quote.email, quote.school || null]
    );
    contactId = r.insertId;
  }

  // A quoted product (e.g. the 90-Day Classroom Pilot) can itself be a trial
  // tier — carry that over so an accepted trial quote actually expires like
  // any other trial purchase, instead of silently becoming a permanent license.
  // Every real trial product is single-seat by design (mark-pilot-product-
  // as-trial.js: "Pilot purchases are meant to be full ... access" for the
  // buyer themselves) — checkout.js's self-service trial signup already
  // forces productType:'single_license', seatCount:1 for exactly this reason:
  // a group_license purchase only ever creates unassigned 'available' seats
  // (no invited_email), and the account-registration auto-claim in
  // createSetPasswordUrl only matches a 'pending' seat with a specific
  // invited_email — an 'available' seat can never be claimed that way, so a
  // trial quoted and accepted as a group_license left the buyer with an
  // active purchase and zero actual content access. Also carries over
  // conversionCreditCents (checkout.js's trial signup sets this to the
  // trial product's own price so a later paid conversion isn't charged full
  // price on top of what was already paid) — quote-accept never set this.
  let trialFields = {};
  let isTrial = false;
  let licenseDurationDaysOverride = null;
  if (quote.quoted_product_id) {
    const [[lp]] = await pool.query(
      'SELECT is_trial, trial_days, trial_lesson_limit, trial_library_limit, price_cents, duration_days FROM license_products WHERE id = ?',
      [quote.quoted_product_id]
    );
    if (lp && lp.is_trial) {
      isTrial = true;
      const trialExpirationDate = new Date();
      trialExpirationDate.setDate(trialExpirationDate.getDate() + (lp.trial_days || 90));
      trialFields = {
        trialExpirationDate,
        trialLessonLimit: lp.trial_lesson_limit || null,
        trialLibraryLimit: lp.trial_library_limit || Math.max(1, parseInt(await getSetting('teacher_lesson_plan_limit_trial') || '10', 10)),
        conversionCreditCents: lp.price_cents || null,
      };
    } else if (lp && lp.duration_days) {
      // A quoted multi-year term (quoted_term_years) scales the product's
      // base license length — e.g. a 365-day product quoted at a 3-year
      // term grants 1095 days, not just the catalog default.
      licenseDurationDaysOverride = lp.duration_days * (quote.quoted_term_years || 1);
    }
  }

  const purchaseId = await createPurchase(contactId, {
    productType: isTrial ? 'single_license' : 'group_license',
    licenseProductId: quote.quoted_product_id || null,
    seatCount: isTrial ? 1 : (quote.quoted_seat_count || 1),
    amountCents: quote.quoted_amount_cents != null ? quote.quoted_amount_cents : null,
    paymentMethod,
    paymentStatus: 'pending',
    source: 'quote',
    // quote.school is a free-text display name ("Lincoln Elementary"), not a
    // real domain — using it here used to break self-service teacher
    // registration outright (school-registration.js does an exact match on
    // the registering teacher's real email domain). quoted_school_domain is
    // the real domain the admin verifies with the buyer on the quote builder.
    schoolDomain: quote.quoted_school_domain || null,
    quoteId: quote.id,
    licenseDurationDaysOverride,
    ...trialFields,
  });

  if (paymentMethod === 'po') {
    // accepted_at was already claimed above, before any of this ran.
    const connection = await pool.getConnection();
    let invoiceId;
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        'INSERT INTO invoices (contact_id, po_number, total_cents, status) VALUES (?, ?, ?, ?)',
        [contactId, poNumber, quote.quoted_amount_cents || 0, 'unpaid']
      );
      invoiceId = result.insertId;
      await generateInvoiceNumber(connection, invoiceId);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    // Quote-accepted PO purchases go through the same gate as the cart PO
    // flow: license stays pending until an admin marks the PO received
    // (POST /api/invoices/:id/po-received).
    await pool.query(
      "UPDATE purchases SET invoice_id = ?, po_number = ?, license_status = 'pending' WHERE id = ?",
      [invoiceId, poNumber, purchaseId]
    );

    const siteUrl = process.env.SITE_URL || '';
    let setupUrl = '';
    try { setupUrl = await createSetPasswordUrl(quote.email, quote.first_name, quote.last_name, '/school-admin-roster.html'); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }

    // Register the buyer as a school license admin for this purchase
    try {
      const [[siteUser]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [quote.email.toLowerCase()]);
      if (siteUser) {
        await pool.query("UPDATE site_users SET role = 'school_license_admin' WHERE id = ? AND role NOT IN ('admin','school_license_admin')", [siteUser.id]);
        await pool.query(
          "INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)",
          [siteUser.id, purchaseId]
        );
      }
    } catch (e) { console.error('school_license_admins insert failed:', e.message); }

    try {
      await fireAutomation('quote_accepted', {
        to: quote.email,
        mergeFields: {
          firstName: quote.first_name || 'there',
          school: quote.school || '',
          productName: quote.quoted_product_name || '',
          setupUrl,
        },
      });
    } catch (e) { console.error('quote_accepted automation failed:', e.message); }

    try {
      await sendSalesAlertEmail({
        to: await getSetting('contact_email_sales_alerts'),
        subject: `Quote accepted (PO) — ${quote.school || quote.email}`,
        fields: {
          Quote: quote.quote_number || null,
          School: quote.school || null,
          Buyer: quote.email,
          Product: quote.quoted_product_name || null,
          'PO Number': poNumber,
          Amount: quote.quoted_amount_cents != null ? `$${(quote.quoted_amount_cents / 100).toFixed(2)}` : null,
          Note: invoiceId ? 'Mark this invoice "Received" once the actual PO payment arrives.' : null,
        },
        linkUrl: `${process.env.SITE_URL || ''}/admin-quotes.html`,
        linkLabel: 'View Quote',
      });
    } catch (e) { console.error('sales alert (quote accepted, PO) failed:', e.message); }

    return res.json({ ok: true, purchaseId, invoiceId, setupUrl });
  }

  // Card: create Stripe Checkout session
  const siteUrl = process.env.SITE_URL || '';
  const amountCents = quote.quoted_amount_cents || 0;
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: quote.email,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: quote.quoted_product_name || 'School License' },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    metadata: {
      type: 'quote_acceptance',
      quoteToken: token,
      purchaseId: String(purchaseId),
    },
    success_url: `${siteUrl}/accept-quote.html?token=${token}&checkout=success`,
    cancel_url: `${siteUrl}/accept-quote.html?token=${token}`,
  });

  res.json({ ok: true, stripeUrl: session.url });
});

// Deliberately unauthenticated — the buyer isn't logged in yet at this point
// in the flow (PO/Stripe acceptance never issues a session cookie). Two
// safeguards stand in for that: single-use (an accept_token is emailed to
// the buyer and can leak via a forwarded email, shared inbox, or browser
// history — without this it could mint unlimited co-admins indefinitely)
// and a 7-day window matching the setup link's own stated expiry.
const INVITE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

router.post('/accept/invite', async (req, res) => {
  const { token, inviteEmail } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token is required' });
  if (!inviteEmail) return res.status(400).json({ error: 'inviteEmail is required' });

  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE accept_token = ?', [token]);
  if (!quote || !quote.accepted_at) return res.status(400).json({ error: 'Quote not found or not yet accepted' });
  if (quote.admin_invited_at) {
    return res.status(409).json({ error: 'An administrator invite has already been sent for this quote.' });
  }
  if (Date.now() - new Date(quote.accepted_at).getTime() > INVITE_WINDOW_MS) {
    return res.status(410).json({ error: 'This quote was accepted more than 7 days ago — the invite window has expired.' });
  }

  let setupUrl = '';
  try { setupUrl = await createSetPasswordUrl(inviteEmail, '', '', '/school-admin-roster.html'); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }

  // Register the invitee as a school license admin for this purchase
  try {
    const [[latestPurchase]] = await pool.query('SELECT id FROM purchases WHERE quote_id = ? ORDER BY id DESC LIMIT 1', [quote.id]);
    if (latestPurchase) {
      const [[siteUser]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [inviteEmail.toLowerCase()]);
      if (siteUser) {
        await pool.query("UPDATE site_users SET role = 'school_license_admin' WHERE id = ? AND role NOT IN ('admin','school_license_admin')", [siteUser.id]);
        await pool.query(
          "INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)",
          [siteUser.id, latestPurchase.id]
        );
      }
    }
  } catch (e) { console.error('school_license_admins invite insert failed:', e.message); }

  try {
    await sendAutomationEmail({
      to: inviteEmail,
      subject: `You've been invited to set up ${quote.school || 'your school'}'s Fixer Nation Education account`,
      body: `Hi,\n\n${quote.first_name || 'Someone'} at ${quote.school || 'your school'} purchased a Fixer Nation Education license and invited you to manage it.\n\nCreate your School License Administrator account here:\n${setupUrl}\n\nThis link expires in 7 days.\n\nFixer Nation Education`,
    });
  } catch (e) {
    console.error('invite email failed:', e.message);
    return res.status(500).json({ error: 'Failed to send invite email' });
  }

  await pool.query('UPDATE quote_requests SET admin_invited_at = NOW() WHERE id = ?', [quote.id]);
  res.json({ ok: true });
});

module.exports = router;
