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

async function getDefaultContentProfileId() {
  const [[row]] = await pool.query('SELECT id FROM quote_content_profiles WHERE is_default = 1 LIMIT 1');
  return row ? row.id : null;
}

router.post('/quote', async (req, res) => {
  const { firstName, lastName, email, school, phone, message } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const defaultProfileId = await getDefaultContentProfileId();

  let inserted = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pool.query(
        'INSERT INTO quote_requests (quote_number, first_name, last_name, email, school, phone, message, content_profile_id, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [generateQuoteNumber(), firstName || '', lastName || '', email, school || '', phone || '', message || '', defaultProfileId, 'inbound']
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

// POST /api/contact/quotes — admin-initiated quote (proactive outreach), as
// opposed to /quote above, which only ever fires from the public inquiry
// form. Creates a bare quote_requests row from scratch (no pricing yet) so
// it can drop straight into the exact same build/price/send flow as any
// inbound quote.
router.post('/quotes', requireAuth, async (req, res) => {
  const { firstName, lastName, email, school, phone, message, contentProfileId } = req.body || {};
  const trimmedEmail = (email || '').trim();
  if (!trimmedEmail) return res.status(400).json({ error: 'Email is required' });

  let profileId = contentProfileId != null ? Number(contentProfileId) : null;
  if (profileId != null) {
    const [[profile]] = await pool.query('SELECT id FROM quote_content_profiles WHERE id = ?', [profileId]);
    if (!profile) return res.status(400).json({ error: 'Content profile not found' });
  } else {
    profileId = await getDefaultContentProfileId();
  }

  let newId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [result] = await pool.query(
        `INSERT INTO quote_requests
           (quote_number, first_name, last_name, email, school, phone, message, content_profile_id, origin, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'new')`,
        [generateQuoteNumber(), (firstName || '').trim(), (lastName || '').trim(), trimmedEmail,
         (school || '').trim() || null, (phone || '').trim() || null, (message || '').trim() || null, profileId]
      );
      newId = result.insertId;
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw err;
    }
  }
  if (!newId) throw new Error('Could not generate unique quote number');

  await pool.query(
    `INSERT INTO newsletter_contacts (name, email, company, source, status)
     VALUES (?, ?, ?, 'Sales Outreach', 'Subscribed')
     ON DUPLICATE KEY UPDATE
       name    = IF(name    = '' OR name    IS NULL, VALUES(name),    name),
       company = IF(company = '' OR company IS NULL, VALUES(company), company)`,
    [`${firstName || ''} ${lastName || ''}`.trim() || trimmedEmail, trimmedEmail, school || null]
  );

  const [[created]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [newId]);
  res.status(201).json({ ok: true, quote: created });
});

// --- Quote content profiles -------------------------------------------------
// Named, reusable sets of the 4 boilerplate sections appended to every quote
// email (e.g. "Standard" vs. "30 Days Free Trial") — see admin-quotes.html's
// "Quote Content Profiles" card. A quote always references one by id
// (content_profile_id); the email always renders whatever that profile's
// CURRENT content is (live reference, not a snapshot), matching how this
// content worked before profiles existed (a single global, always-live set).

router.get('/quote-profiles', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM quote_content_profiles ORDER BY is_default DESC, name ASC');
  res.json({ profiles: rows });
});

router.post('/quote-profiles', requireAuth, async (req, res) => {
  const { name, sectionAnnualIncludes, sectionLessonPackage, sectionVideoAccess, sectionLicenseTerms } = req.body || {};
  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'Name is required' });

  try {
    const [result] = await pool.query(
      `INSERT INTO quote_content_profiles
         (name, section_annual_includes, section_lesson_package, section_video_access, section_license_terms)
       VALUES (?, ?, ?, ?, ?)`,
      [trimmedName, sectionAnnualIncludes || '', sectionLessonPackage || '', sectionVideoAccess || '', sectionLicenseTerms || '']
    );
    const [[created]] = await pool.query('SELECT * FROM quote_content_profiles WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, profile: created });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A profile with that name already exists' });
    throw err;
  }
});

router.put('/quote-profiles/:id', requireAuth, async (req, res) => {
  const [[existing]] = await pool.query('SELECT id FROM quote_content_profiles WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, sectionAnnualIncludes, sectionLessonPackage, sectionVideoAccess, sectionLicenseTerms } = req.body || {};
  const updates = [];
  const params = [];
  if (name !== undefined) {
    const trimmedName = (name || '').trim();
    if (!trimmedName) return res.status(400).json({ error: 'Name is required' });
    updates.push('name = ?'); params.push(trimmedName);
  }
  if (sectionAnnualIncludes !== undefined) { updates.push('section_annual_includes = ?'); params.push(sectionAnnualIncludes || ''); }
  if (sectionLessonPackage  !== undefined) { updates.push('section_lesson_package = ?');  params.push(sectionLessonPackage  || ''); }
  if (sectionVideoAccess    !== undefined) { updates.push('section_video_access = ?');    params.push(sectionVideoAccess    || ''); }
  if (sectionLicenseTerms   !== undefined) { updates.push('section_license_terms = ?');   params.push(sectionLicenseTerms   || ''); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  try {
    await pool.query(`UPDATE quote_content_profiles SET ${updates.join(', ')} WHERE id = ?`, params);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A profile with that name already exists' });
    throw err;
  }
  const [[updated]] = await pool.query('SELECT * FROM quote_content_profiles WHERE id = ?', [req.params.id]);
  res.json({ ok: true, profile: updated });
});

router.post('/quote-profiles/:id/set-default', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [[existing]] = await conn.query('SELECT id FROM quote_content_profiles WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await conn.beginTransaction();
    await conn.query('UPDATE quote_content_profiles SET is_default = 0');
    await conn.query('UPDATE quote_content_profiles SET is_default = 1 WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.delete('/quote-profiles/:id', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [[target]] = await conn.query('SELECT id, is_default FROM quote_content_profiles WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.is_default) {
      return res.status(400).json({ error: 'Set another profile as default before deleting this one' });
    }
    const [[def]] = await conn.query('SELECT id FROM quote_content_profiles WHERE is_default = 1 LIMIT 1');
    if (!def) return res.status(400).json({ error: 'No default profile exists to reassign affected quotes to' });

    await conn.beginTransaction();
    const [reassigned] = await conn.query(
      'UPDATE quote_requests SET content_profile_id = ? WHERE content_profile_id = ?',
      [def.id, req.params.id]
    );
    await conn.query('DELETE FROM quote_content_profiles WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ ok: true, reassignedQuotes: reassigned.affectedRows });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

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
  const { status, notes, firstName, lastName, email, school, phone, quotedProductId, quotedProductName,
          quotedSeatCount, quotedAmountCents, quotedTierName, quotedAddonSeats, quotedProrationFactor,
          quotedTermYears, quotedValidUntil, quotedSchoolDomain, contentProfileId } = req.body || {};
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (email !== undefined && !String(email).trim()) {
    return res.status(400).json({ error: 'Email cannot be blank' });
  }
  const [existing] = await pool.query('SELECT id FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Not found' });

  if (contentProfileId !== undefined && contentProfileId !== null) {
    const [[profile]] = await pool.query('SELECT id FROM quote_content_profiles WHERE id = ?', [contentProfileId]);
    if (!profile) return res.status(400).json({ error: 'Content profile not found' });
  }

  const updates = [];
  const params = [];
  if (status                !== undefined) { updates.push('status = ?');                  params.push(status); }
  if (notes                 !== undefined) { updates.push('notes = ?');                   params.push(notes); }
  if (firstName             !== undefined) { updates.push('first_name = ?');              params.push((firstName || '').trim()); }
  if (lastName              !== undefined) { updates.push('last_name = ?');               params.push((lastName  || '').trim()); }
  if (email                 !== undefined) { updates.push('email = ?');                   params.push(email.trim()); }
  if (school                !== undefined) { updates.push('school = ?');                  params.push((school || '').trim() || null); }
  if (phone                 !== undefined) { updates.push('phone = ?');                    params.push((phone  || '').trim() || null); }
  if (quotedProductId       !== undefined) { updates.push('quoted_product_id = ?');       params.push(quotedProductId || null); }
  if (quotedProductName     !== undefined) { updates.push('quoted_product_name = ?');     params.push(quotedProductName || null); }
  if (quotedSeatCount       !== undefined) { updates.push('quoted_seat_count = ?');       params.push(quotedSeatCount || null); }
  if (quotedAmountCents     !== undefined) { updates.push('quoted_amount_cents = ?');     params.push(quotedAmountCents || null); }
  if (quotedTierName        !== undefined) { updates.push('quoted_tier_name = ?');        params.push(quotedTierName || null); }
  if (quotedAddonSeats      !== undefined) { updates.push('quoted_addon_seats = ?');      params.push(quotedAddonSeats != null ? Number(quotedAddonSeats) : null); }
  if (quotedProrationFactor !== undefined) { updates.push('quoted_proration_factor = ?'); params.push(quotedProrationFactor != null ? Number(quotedProrationFactor) : null); }
  if (quotedTermYears       !== undefined) { updates.push('quoted_term_years = ?');       params.push(quotedTermYears != null ? Number(quotedTermYears) : null); }
  if (quotedSchoolDomain    !== undefined) { updates.push('quoted_school_domain = ?');    params.push(quotedSchoolDomain ? quotedSchoolDomain.trim().replace(/^@/, '').toLowerCase() : null); }
  if (contentProfileId      !== undefined) { updates.push('content_profile_id = ?');      params.push(contentProfileId || null); }

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
          quotedTierName, quotedAddonSeats, quotedTermYears, quotedDiscountPct, quotedValidUntil,
          quotedSchoolDomain, contentProfileId } = req.body || {};
  if (!quotedAmountCents || !quotedProductName) {
    return res.status(400).json({ error: 'Product name and amount are required to send a quote' });
  }
  const schoolDomain = quotedSchoolDomain !== undefined
    ? (quotedSchoolDomain ? quotedSchoolDomain.trim().replace(/^@/, '').toLowerCase() : null)
    : (quote.quoted_school_domain || null);

  // Resolve which content profile to render — an explicit override in this
  // request, else whatever the quote already has, else the default. Always
  // rendered from the profile's CURRENT content (live reference), never a
  // snapshot, so editing a profile later updates every quote using it,
  // including on resend.
  let profileId = contentProfileId !== undefined ? contentProfileId : quote.content_profile_id;
  if (!profileId) profileId = await getDefaultContentProfileId();
  const [[profile]] = profileId
    ? await pool.query('SELECT * FROM quote_content_profiles WHERE id = ?', [profileId])
    : [[null]];
  if (contentProfileId !== undefined && contentProfileId && !profile) {
    return res.status(400).json({ error: 'Content profile not found' });
  }

  // Reuse existing token on re-send so existing links stay valid
  let acceptToken = quote.accept_token;
  if (!acceptToken) {
    acceptToken = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE quote_requests SET accept_token = ? WHERE id = ?', [acceptToken, quote.id]);
  }

  const siteUrl = process.env.SITE_URL || '';
  const acceptUrl = `${siteUrl}/accept-quote.html?token=${acceptToken}`;

  const [replyTo, fromEmail] = await Promise.all([
    getSetting('contact_email_quote'),
    getSetting('quote_from_email'),
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
      annualIncludes: (profile && profile.section_annual_includes) || '',
      lessonPackage:  (profile && profile.section_lesson_package)  || '',
      videoAccess:    (profile && profile.section_video_access)    || '',
      licenseTerms:   (profile && profile.section_license_terms)   || '',
    },
  });

  await pool.query(
    `UPDATE quote_requests
     SET quoted_product_id = ?, quoted_product_name = ?, quoted_seat_count = ?,
         quoted_amount_cents = ?, quoted_at = NOW(), quote_sent_at = NOW(),
         status = IF(status = 'new', 'contacted', status),
         quoted_tier_name = ?, quoted_addon_seats = ?,
         quoted_term_years = ?, quoted_school_domain = ?,
         quote_valid_until = COALESCE(?, quote_valid_until),
         content_profile_id = ?
     WHERE id = ?`,
    [quotedProductId || null, quotedProductName, quotedSeatCount || null, quotedAmountCents,
     quotedTierName || null,
     quotedAddonSeats != null ? Number(quotedAddonSeats) : null,
     quotedTermYears != null ? Number(quotedTermYears) : null,
     schoolDomain,
     validUntil || null,
     profile ? profile.id : null,
     quote.id]
  );

  const [[updated]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [quote.id]);
  res.json({ ok: true, quote: updated });
});

// POST /api/contact/quotes/:id/copy — duplicate a quote as a fresh draft
// Body may include { firstName, lastName, email, phone, school } to override the contact
router.post('/quotes/:id/copy', requireAuth, async (req, res) => {
  const [[src]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!src) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const firstName = b.firstName !== undefined ? (b.firstName || '').trim() : src.first_name;
  const lastName  = b.lastName  !== undefined ? (b.lastName  || '').trim() : src.last_name;
  const email     = b.email     !== undefined ? (b.email     || '').trim() : src.email;
  const phone     = b.phone     !== undefined ? (b.phone     || null)      : (src.phone || null);
  const school    = b.school    !== undefined ? (b.school    || null)      : (src.school || null);

  if (!email) return res.status(400).json({ error: 'Email is required' });

  let newId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [result] = await pool.query(
        `INSERT INTO quote_requests
           (quote_number, first_name, last_name, email, school, phone, message,
            quoted_product_id, quoted_product_name, quoted_tier_name,
            quoted_seat_count, quoted_amount_cents, quoted_addon_seats,
            quoted_term_years, quoted_school_domain, quote_valid_until, content_profile_id, origin, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'new')`,
        [
          generateQuoteNumber(),
          firstName, lastName, email, school, phone,
          src.message || null,
          src.quoted_product_id || null, src.quoted_product_name || null,
          src.quoted_tier_name || null, src.quoted_seat_count || null,
          src.quoted_amount_cents || null, src.quoted_addon_seats || null,
          src.quoted_term_years || null, src.quoted_school_domain || null, src.quote_valid_until || null,
          src.content_profile_id || null,
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
