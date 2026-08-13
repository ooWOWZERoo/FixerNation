const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sendContactFormEmail, sendQuoteEmail } = require('../lib/mailer');
const { getSetting } = require('../lib/settings');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/general-inquiry', async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });

  await sendContactFormEmail({
    to: await getSetting('contact_email_general'),
    formName: 'Contact Us',
    fields: {
      Name: name,
      Email: email,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

router.post('/ask-the-fixer', async (req, res) => {
  const { firstName, lastName, email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });

  await sendContactFormEmail({
    to: await getSetting('contact_email_ask_the_fixer'),
    formName: 'Ask The Fixer',
    fields: {
      'First Name': firstName,
      'Last Name': lastName,
      Email: email,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

function generateQuoteNumber() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post('/quote', async (req, res) => {
  const { firstName, lastName, email, school, phone, message } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  let inserted = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pool.query(
        'INSERT INTO quote_requests (quote_number, first_name, last_name, email, school, phone, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [generateQuoteNumber(), firstName || '', lastName || '', email, school || '', phone || '', message || '']
      );
      inserted = true;
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw err;
    }
  }
  if (!inserted) throw new Error('Could not generate unique quote number');

  await pool.query(
    `INSERT INTO newsletter_contacts (name, email, company, source, status)
     VALUES (?, ?, ?, 'Quote Request', 'Subscribed')
     ON DUPLICATE KEY UPDATE
       name    = IF(name    = '' OR name    IS NULL, VALUES(name),    name),
       company = IF(company = '' OR company IS NULL, VALUES(company), company)`,
    [`${firstName || ''} ${lastName || ''}`.trim() || email, email, school || null]
  );

  await sendContactFormEmail({
    to: await getSetting('contact_email_quote'),
    formName: 'Request a Formal Quotation',
    fields: {
      'First Name': firstName,
      'Last Name': lastName,
      Email: email,
      School: school,
      Phone: phone,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

const REQUEST_TYPE_LABELS = {
  access: 'Access — what personal information do you have about me?',
  delete: 'Delete my personal information',
  opt_out: 'Opt out of any sale/sharing of my personal information',
  other: 'Other',
};

router.post('/privacy-request', async (req, res) => {
  const { name, email, requestType, message } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  await sendContactFormEmail({
    to: await getSetting('contact_email_privacy'),
    formName: 'Privacy Request',
    fields: {
      Name: name,
      Email: email,
      'Request Type': REQUEST_TYPE_LABELS[requestType] || requestType,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

const VALID_STATUSES = ['new', 'contacted', 'converted', 'closed'];

router.get('/quotes', requireAuth, async (req, res) => {
  const { status, search } = req.query;
  let sql = 'SELECT * FROM quote_requests WHERE 1=1';
  const params = [];

  if (status && VALID_STATUSES.includes(status)) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR school LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ quotes: rows });
});

router.put('/quotes/:id', requireAuth, async (req, res) => {
  const { status, notes, quotedProductId, quotedProductName, quotedSeatCount, quotedAmountCents,
          quotedTierName, quotedAddonSeats, quotedProrationFactor, quotedTermYears, quotedValidUntil } = req.body || {};
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const [existing] = await pool.query('SELECT id FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Not found' });

  const updates = [];
  const params = [];
  if (status                !== undefined) { updates.push('status = ?');                  params.push(status); }
  if (notes                 !== undefined) { updates.push('notes = ?');                   params.push(notes); }
  if (quotedProductId       !== undefined) { updates.push('quoted_product_id = ?');       params.push(quotedProductId || null); }
  if (quotedProductName     !== undefined) { updates.push('quoted_product_name = ?');     params.push(quotedProductName || null); }
  if (quotedSeatCount       !== undefined) { updates.push('quoted_seat_count = ?');       params.push(quotedSeatCount || null); }
  if (quotedAmountCents     !== undefined) { updates.push('quoted_amount_cents = ?');     params.push(quotedAmountCents || null); }
  if (quotedTierName        !== undefined) { updates.push('quoted_tier_name = ?');        params.push(quotedTierName || null); }
  if (quotedAddonSeats      !== undefined) { updates.push('quoted_addon_seats = ?');      params.push(quotedAddonSeats != null ? Number(quotedAddonSeats) : null); }
  if (quotedProrationFactor !== undefined) { updates.push('quoted_proration_factor = ?'); params.push(quotedProrationFactor != null ? Number(quotedProrationFactor) : null); }
  if (quotedTermYears       !== undefined) { updates.push('quoted_term_years = ?');       params.push(quotedTermYears != null ? Number(quotedTermYears) : null); }

  if (quotedValidUntil !== undefined) { updates.push('quote_valid_until = ?'); params.push(quotedValidUntil || null); }

  if (quotedAmountCents !== undefined && !updates.includes('quoted_at = ?')) {
    updates.push('quoted_at = NOW()');
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  await pool.query(`UPDATE quote_requests SET ${updates.join(', ')} WHERE id = ?`, params);
  const [[row]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  res.json({ ok: true, quote: row });
});

router.post('/quotes/:id/send', requireAuth, async (req, res) => {
  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!quote) return res.status(404).json({ error: 'Not found' });

  const { quotedProductId, quotedProductName, quotedSeatCount, quotedAmountCents,
          quotedTierName, quotedAddonSeats, quotedTermYears, quotedDiscountPct, quotedValidUntil } = req.body || {};
  if (!quotedAmountCents || !quotedProductName) {
    return res.status(400).json({ error: 'Product name and amount are required to send a quote' });
  }

  // Reuse existing token on re-send so existing links stay valid
  let acceptToken = quote.accept_token;
  if (!acceptToken) {
    acceptToken = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE quote_requests SET accept_token = ? WHERE id = ?', [acceptToken, quote.id]);
  }

  const siteUrl = process.env.SITE_URL || '';
  const acceptUrl = `${siteUrl}/accept-quote.html?token=${acceptToken}`;

  const [replyTo, fromEmail, s1, s2, s3, s4] = await Promise.all([
    getSetting('contact_email_quote'),
    getSetting('quote_from_email'),
    getSetting('quote_section_annual_includes'),
    getSetting('quote_section_lesson_package'),
    getSetting('quote_section_video_access'),
    getSetting('quote_section_license_terms'),
  ]);

  const validUntil = quotedValidUntil || (quote.quote_valid_until ? String(quote.quote_valid_until).slice(0, 10) : null);

  await sendQuoteEmail({
    to: quote.email,
    firstName: quote.first_name,
    lastName: quote.last_name,
    school: quote.school,
    quoteNumber: quote.quote_number || null,
    productName: quotedProductName,
    seatCount: quotedSeatCount || null,
    amountDollars: quotedAmountCents / 100,
    replyTo,
    fromEmail: fromEmail || null,
    addonSeats: quotedAddonSeats != null ? Number(quotedAddonSeats) : null,
    termYears: quotedTermYears != null ? Number(quotedTermYears) : null,
    discountPct: quotedDiscountPct != null ? Number(quotedDiscountPct) : null,
    quoteValidUntil: validUntil,
    acceptUrl,
    contentSections: {
      annualIncludes: s1 || '',
      lessonPackage:  s2 || '',
      videoAccess:    s3 || '',
      licenseTerms:   s4 || '',
    },
  });

  await pool.query(
    `UPDATE quote_requests
     SET quoted_product_id = ?, quoted_product_name = ?, quoted_seat_count = ?,
         quoted_amount_cents = ?, quoted_at = NOW(), quote_sent_at = NOW(),
         status = IF(status = 'new', 'contacted', status),
         quoted_tier_name = ?, quoted_addon_seats = ?,
         quoted_term_years = ?,
         quote_valid_until = COALESCE(?, quote_valid_until)
     WHERE id = ?`,
    [quotedProductId || null, quotedProductName, quotedSeatCount || null, quotedAmountCents,
     quotedTierName || null,
     quotedAddonSeats != null ? Number(quotedAddonSeats) : null,
     quotedTermYears != null ? Number(quotedTermYears) : null,
     validUntil || null,
     quote.id]
  );

  const [[updated]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [quote.id]);
  res.json({ ok: true, quote: updated });
});

// POST /api/contact/quotes/:id/copy — duplicate a quote as a fresh draft
router.post('/quotes/:id/copy', requireAuth, async (req, res) => {
  const [[src]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!src) return res.status(404).json({ error: 'Not found' });

  let newId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [result] = await pool.query(
        `INSERT INTO quote_requests
           (quote_number, first_name, last_name, email, school, phone, message,
            quoted_product_id, quoted_product_name, quoted_tier_name,
            quoted_seat_count, quoted_amount_cents, quoted_addon_seats,
            quoted_term_years, quote_valid_until, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
        [
          generateQuoteNumber(),
          src.first_name, src.last_name, src.email,
          src.school || null, src.phone || null, src.message || null,
          src.quoted_product_id || null, src.quoted_product_name || null,
          src.quoted_tier_name || null, src.quoted_seat_count || null,
          src.quoted_amount_cents || null, src.quoted_addon_seats || null,
          src.quoted_term_years || null, src.quote_valid_until || null,
        ]
      );
      newId = result.insertId;
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw err;
    }
  }
  if (!newId) throw new Error('Could not generate unique quote number');

  const [[created]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [newId]);
  res.status(201).json({ ok: true, quote: created });
});

module.exports = router;
