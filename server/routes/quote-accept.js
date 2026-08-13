const express = require('express');
const Stripe = require('stripe');
const pool = require('../db/pool');
const { createPurchase } = require('./newsletter');
const { fireAutomation } = require('../lib/automations');
const { createSetPasswordUrl } = require('./checkout');
const { sendAutomationEmail } = require('../lib/mailer');

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
    amountDollars: quote.quoted_amount_cents ? quote.quoted_amount_cents / 100 : null,
    quoteValidUntil: quote.quote_valid_until ? String(quote.quote_valid_until).slice(0, 10) : null,
  });
});

router.post('/accept', async (req, res) => {
  const { token, paymentMethod, poNumber } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token is required' });
  if (!['card', 'po'].includes(paymentMethod)) return res.status(400).json({ error: 'paymentMethod must be card or po' });

  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE accept_token = ?', [token]);
  const status = quoteStatus(quote);
  if (status !== 'valid') return res.status(400).json({ error: status });

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

  const purchaseId = await createPurchase(contactId, {
    productType: 'group_license',
    licenseProductId: quote.quoted_product_id || null,
    seatCount: quote.quoted_seat_count || 1,
    amountCents: quote.quoted_amount_cents || null,
    paymentMethod,
    paymentStatus: 'pending',
    source: 'quote',
    quoteId: quote.id,
  });

  if (paymentMethod === 'po') {
    await pool.query(
      "UPDATE quote_requests SET accepted_at = NOW(), accepted_payment_method = 'po', status = 'converted' WHERE id = ?",
      [quote.id]
    );
    if (poNumber) {
      await pool.query('UPDATE purchases SET po_number = ? WHERE id = ?', [poNumber, purchaseId]);
    }

    const siteUrl = process.env.SITE_URL || '';
    let setupUrl = '';
    try { setupUrl = await createSetPasswordUrl(quote.email, quote.first_name, quote.last_name); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }
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

    return res.json({ ok: true, purchaseId, setupUrl });
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

router.post('/accept/invite', async (req, res) => {
  const { token, inviteEmail } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token is required' });
  if (!inviteEmail) return res.status(400).json({ error: 'inviteEmail is required' });

  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE accept_token = ?', [token]);
  if (!quote || !quote.accepted_at) return res.status(400).json({ error: 'Quote not found or not yet accepted' });

  let setupUrl = '';
  try { setupUrl = await createSetPasswordUrl(inviteEmail, '', ''); } catch (e) { console.error('createSetPasswordUrl failed:', e.message); }

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

  res.json({ ok: true });
});

module.exports = router;
