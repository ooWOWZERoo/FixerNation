const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sendContactFormEmail, sendQuoteEmail } = require('../lib/mailer');
const { getSetting } = require('../lib/settings');
const { requireAuth } = require('../middleware/auth');
const { limiter } = require('../lib/rate-limit');
const { recordAttributionForEmail } = require('../lib/attribution'); // Sales CRM phase 6: first and latest touch, advisory only
const crmHooks = require('../lib/crm-hooks'); // Sales CRM: a quote request makes the person a Prospect (never throws; off unless crm_v2_enabled)
const { demoOrigin } = require('../lib/public-demo');
const { invitationLabels } = require('../lib/public-demo-admin');
const { cleanParty, billFromQuote, shipFromQuote } = require('../lib/invoice-parties');
const { setQuoteLinks, dealForQuote } = require('../lib/crm-quotes');
const { loadCrmRole, canEditDeal, isCrmEnabled, can, requireCrmRole } = require('../lib/crm-permissions');
const { audit } = require('../lib/audit');

// Punch list S3/S4. The accept link (accept_token) alone accepts a quote by PO, so it never goes back to the browser: staff send it through the Send button.
function publicQuote(row) {
  if (!row) return row;
  const { accept_token, ...rest } = row;
  return { ...rest, has_accept_link: !!accept_token };
}

// The pricing columns of a quote, by the request field that sets each. Changing one after the quote was sent is a CRM Admin action, and after it was accepted it is refused.
const PRICE_FIELDS = {
  quotedProductId: 'quoted_product_id', quotedProductName: 'quoted_product_name', quotedSeatCount: 'quoted_seat_count', quotedAmountCents: 'quoted_amount_cents',
  quotedTierName: 'quoted_tier_name', quotedAddonSeats: 'quoted_addon_seats', quotedProrationFactor: 'quoted_proration_factor', quotedTermYears: 'quoted_term_years',
};
function priceChanges(quote, body) {
  // Numbers compare as numbers ("1.00" from a DECIMAL column equals 1 from the form); everything else as text.
  const norm = (v) => {
    if (v === undefined || v === null || v === '') return '';
    const n = Number(v);
    return String(v).trim() !== '' && Number.isFinite(n) ? String(n) : String(v);
  };
  const out = [];
  for (const [field, col] of Object.entries(PRICE_FIELDS)) {
    if (body[field] === undefined) continue;
    if (norm(body[field]) !== norm(quote[col])) out.push({ column: col, from: quote[col] === undefined ? null : quote[col], to: body[field] === undefined ? null : body[field] });
  }
  return out;
}
// null if the change is allowed; otherwise the response to send.
function priceChangeRefusal(quote, changes, role) {
  if (!changes.length) return null;
  if (quote.accepted_at) return { status: 409, body: { code: 'already_accepted', error: 'This quote was already accepted, so its price cannot be changed. Revise it only if it has not been accepted.' } };
  if (quote.quote_sent_at && !can(role, 'edit_quote_price')) return { status: 403, body: { code: 'price_locked', error: 'This quote was already sent. Only a CRM Admin can change its price; or use Revise Quote to send a new version.' } };
  return null;
}
async function auditPriceChange(req, quote, changes) {
  if (!changes.length || !quote.quote_sent_at) return;
  await audit(pool, {
    actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username, action: 'quote_price_changed', entityType: 'quote_request', entityId: Number(quote.id),
    prevValue: Object.fromEntries(changes.map(c => [c.column, c.from])), newValue: Object.fromEntries(changes.map(c => [c.column, c.to])), ipAddress: req.ip,
  });
}

const router = express.Router();

router.post('/general-inquiry', limiter({ name: 'contact-general', windowMs: 3600000, max: 10 }), async (req, res) => {
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

router.post('/ask-the-fixer', limiter({ name: 'contact-fixer', windowMs: 3600000, max: 10 }), async (req, res) => {
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
  return String(crypto.randomInt(100000, 1000000));
}

async function getDefaultContentProfileId() {
  const [[row]] = await pool.query('SELECT id FROM quote_content_profiles WHERE is_default = 1 LIMIT 1');
  return row ? row.id : null;
}

router.post('/quote', limiter({ name: 'contact-quote', windowMs: 3600000, max: 10 }), async (req, res) => {
  const { firstName, lastName, email, school, phone, message } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const defaultProfileId = await getDefaultContentProfileId();

  let inserted = false;
  let quoteNumber = null;
  let quoteId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      quoteNumber = generateQuoteNumber();
      const [ins] = await pool.query(
        'INSERT INTO quote_requests (quote_number, first_name, last_name, email, school, phone, message, content_profile_id, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [quoteNumber, firstName || '', lastName || '', email, school || '', phone || '', message || '', defaultProfileId, 'inbound']
      );
      quoteId = ins.insertId;
      inserted = true;
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && attempt < 4) continue;
      throw err;
    }
  }
  if (!inserted) throw new Error('Could not generate unique quote number');

  // A request from someone using a demo is tagged so staff can see where it came from (docs/reference/shared-demo-environment-requirements.md, R8; for a group's
  // own invitation, docs/reference/shared-demo-workspaces-requirements.md, R8). The tag comes from the server's own cookies, never from the form. Tolerates a
  // column that does not exist yet.
  const origin = await demoOrigin(req);
  let demoSource;
  if (origin) {
    demoSource = 'Shared demo';
    try {
      if (origin.invitationId) {
        await pool.query('UPDATE quote_requests SET demo_invitation_id = ? WHERE quote_number = ?', [origin.invitationId, quoteNumber]);
        const label = (await invitationLabels(pool, [origin.invitationId]))[origin.invitationId];
        if (label) demoSource = `Shared demo (${label})`;
      }
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR' && !/no such column|no column named/i.test(String(err.message))) throw err;
    }
  }

  // Punch list S8: asking for a quote is not consent to the newsletter, and anyone can type another person's address into the form, so a NEW contact starts Unsubscribed;
  // an existing contact's subscription is never changed here (the ON DUPLICATE KEY clause leaves status alone).
  await pool.query(
    `INSERT INTO newsletter_contacts (name, email, company, source, status)
     VALUES (?, ?, ?, 'Quote Request', 'Unsubscribed')
     ON DUPLICATE KEY UPDATE
       name    = IF(name    = '' OR name    IS NULL, VALUES(name),    name),
       company = IF(company = '' OR company IS NULL, VALUES(company), company)`,
    [`${firstName || ''} ${lastName || ''}`.trim() || email, email, school || null]
  );
  await crmHooks.contactChangedByEmail(email);
  // Phase 6: where this visit came from, read off the fn_attr cookie on this request (never blocks the form, never a form field).
  await recordAttributionForEmail(req, email);
  // Phase 4b: link the quote to its contact (only when exactly one contact has that email). Never a deal or an account: a public form writes only what it has,
  // and staff make the deal from "Quotes without a deal" in the Customer Hub.
  await setQuoteLinks(pool, quoteId, { contactEmail: email });
  await crmHooks.quoteEvent(quoteId, 'created', { detail: 'public request form' });

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
      Source: demoSource,
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

router.post('/privacy-request', limiter({ name: 'contact-privacy', windowMs: 3600000, max: 10 }), async (req, res) => {
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
router.post('/quotes', requireAuth, requireCrmRole('write'), async (req, res) => {
  const { firstName, lastName, email, school, phone, message, contentProfileId, opportunityId } = req.body || {};
  const trimmedEmail = (email || '').trim();
  if (!trimmedEmail) return res.status(400).json({ error: 'Email is required' });

  // Phase 4b: a quote may be made for a deal. Needs the Hub on and a CRM role that can edit that deal.
  let dealId = null;
  if (opportunityId !== undefined && opportunityId !== null && opportunityId !== '') {
    dealId = Number(opportunityId);
    if (!Number.isInteger(dealId) || dealId < 1) return res.status(400).json({ error: 'opportunityId must be a deal id.' });
    const chk = await dealForQuote(req, dealId);
    if (chk.error) return res.status(chk.status).json({ error: chk.error });
  }

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
     VALUES (?, ?, ?, 'Sales Outreach', 'Unsubscribed')
     ON DUPLICATE KEY UPDATE
       name    = IF(name    = '' OR name    IS NULL, VALUES(name),    name),
       company = IF(company = '' OR company IS NULL, VALUES(company), company)`,
    [`${firstName || ''} ${lastName || ''}`.trim() || trimmedEmail, trimmedEmail, school || null]
  );
  await crmHooks.contactChangedByEmail(trimmedEmail, { actorAdminId: req.user.userId, reason: 'A staff member made a quote for this contact' });
  await setQuoteLinks(pool, newId, { contactEmail: trimmedEmail, opportunityId: dealId, adminId: req.user.userId });
  await crmHooks.quoteEvent(newId, 'created', { detail: 'made by staff', actorAdminId: req.user.userId });

  const [[created]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [newId]);
  res.status(201).json({ ok: true, quote: publicQuote(created) });
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

  // Only the quote requests from one group's demo (the Demo page links here): ?demo=<invitation id>
  const demoId = /^\d{1,9}$/.test(String(req.query.demo || '')) ? Number(req.query.demo) : 0;
  if (demoId) { sql += ' AND demo_invitation_id = ?'; params.push(demoId); }

  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.query(sql, params);
  // The group behind each request that came from a group's demo (staff only), for the "Demo: <name>" tag.
  const labels = await invitationLabels(pool, rows.map(r => r.demo_invitation_id));
  res.json({
    quotes: rows.map(r => ({ ...publicQuote(r), demo_label: r.demo_invitation_id > 0 ? (labels[Number(r.demo_invitation_id)] || null) : null })),
    demoFilter: demoId ? { id: demoId, label: (await invitationLabels(pool, [demoId]))[demoId] || null } : null,
  });
});

router.put('/quotes/:id', requireAuth, requireCrmRole('write'), async (req, res) => {
  const { status, notes, firstName, lastName, email, school, phone, quotedProductId, quotedProductName,
          quotedSeatCount, quotedAmountCents, quotedTierName, quotedAddonSeats, quotedProrationFactor,
          quotedTermYears, quotedValidUntil, quotedSchoolDomain, contentProfileId, billTo, shipTo } = req.body || {};
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (email !== undefined && !String(email).trim()) {
    return res.status(400).json({ error: 'Email cannot be blank' });
  }
  const [existing] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Not found' });
  const changes = priceChanges(existing[0], req.body || {});
  const refusal = priceChangeRefusal(existing[0], changes, req.crm.role);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  // Bill To address (the quote's own name, school and email are the rest of Bill To) and Ship To: lib/invoice-parties.js
  let partyColumns = [];
  try {
    if (billTo !== undefined) {
      const b = cleanParty(billTo, 'bill');
      partyColumns.push(...['street', 'city', 'state', 'zip'].map((k) => [`bill_to_${k}`, b[k] || null]));
    }
    if (shipTo !== undefined) {
      const sh = cleanParty(shipTo, 'ship');
      partyColumns.push(...['name', 'company', 'street', 'city', 'state', 'zip'].map((k) => [`ship_to_${k}`, sh[k] || null]));
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

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
  if (quotedAmountCents     !== undefined) { updates.push('quoted_amount_cents = ?');     params.push(quotedAmountCents != null ? quotedAmountCents : null); }
  if (quotedTierName        !== undefined) { updates.push('quoted_tier_name = ?');        params.push(quotedTierName || null); }
  if (quotedAddonSeats      !== undefined) { updates.push('quoted_addon_seats = ?');      params.push(quotedAddonSeats != null ? Number(quotedAddonSeats) : null); }
  if (quotedProrationFactor !== undefined) { updates.push('quoted_proration_factor = ?'); params.push(quotedProrationFactor != null ? Number(quotedProrationFactor) : null); }
  if (quotedTermYears       !== undefined) { updates.push('quoted_term_years = ?');       params.push(quotedTermYears != null ? Number(quotedTermYears) : null); }
  if (quotedSchoolDomain    !== undefined) { updates.push('quoted_school_domain = ?');    params.push(quotedSchoolDomain ? quotedSchoolDomain.trim().replace(/^@/, '').toLowerCase() : null); }
  if (contentProfileId      !== undefined) { updates.push('content_profile_id = ?');      params.push(contentProfileId || null); }

  if (quotedValidUntil !== undefined) { updates.push('quote_valid_until = ?'); params.push(quotedValidUntil || null); }
  for (const [col, val] of partyColumns) { updates.push(`${col} = ?`); params.push(val); }

  if (quotedAmountCents !== undefined && !updates.includes('quoted_at = ?')) {
    updates.push('quoted_at = NOW()');
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  await pool.query(`UPDATE quote_requests SET ${updates.join(', ')} WHERE id = ?`, params);
  // The buyer's email changed: point the quote at the contact with the new address (or at nobody, if there is not exactly one), so it never keeps a stale link.
  if (email !== undefined && String(email).trim().toLowerCase() !== String(existing[0].email || '').trim().toLowerCase()) {
    try {
      await pool.query('UPDATE quote_requests SET contact_id = NULL WHERE id = ?', [req.params.id]);
      await setQuoteLinks(pool, Number(req.params.id), { contactEmail: String(email).trim() });
    } catch (err) { if (!/no such column|ER_BAD_FIELD_ERROR/i.test(String(err.code || err.message))) console.error('relinking a quote after an email change failed:', err.message); }
  }
  if (quotedAmountCents !== undefined) await crmHooks.quotePriceChanged(Number(req.params.id), existing[0].quoted_amount_cents, { actorAdminId: req.user.userId });
  await auditPriceChange(req, existing[0], changes);
  const [[row]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  res.json({ ok: true, quote: publicQuote(row) });
});

router.post('/quotes/:id/send', requireAuth, requireCrmRole('write'), async (req, res) => {
  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!quote) return res.status(404).json({ error: 'Not found' });
  if (quote.version_status === 'superseded') return res.status(409).json({ code: 'superseded', error: 'A newer revision of this quote was sent, so this one cannot be sent again.' });
  if (quote.accepted_at) return res.status(409).json({ code: 'already_accepted', error: 'This quote was already accepted, so it cannot be sent again.' });
  const priceDiff = priceChanges(quote, req.body || {});
  const priceRefusal = priceChangeRefusal(quote, priceDiff, req.crm.role);
  if (priceRefusal) return res.status(priceRefusal.status).json(priceRefusal.body);

  const { quotedProductId, quotedProductName, quotedSeatCount, quotedAmountCents,
          quotedTierName, quotedAddonSeats, quotedTermYears, quotedDiscountPct, quotedValidUntil,
          quotedSchoolDomain, contentProfileId, noEmail } = req.body || {};
  // quotedAmountCents can legitimately be 0 (a free trial) — only reject a
  // missing amount, not a falsy-but-valid zero.
  if (quotedAmountCents == null || !quotedProductName) {
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

  // Phase 4b: a revision replaces an earlier quote only when it is SENT. If the earlier one was accepted meanwhile there is nothing left to replace.
  let replaced = null;
  if (quote.supersedes_quote_id) {
    const [[old]] = await pool.query('SELECT id, quote_number, accepted_at, version_status, quoted_amount_cents FROM quote_requests WHERE id = ?', [quote.supersedes_quote_id]);
    if (old && old.accepted_at) return res.status(409).json({ code: 'earlier_version_accepted', error: `Quote ${old.quote_number || old.id} was already accepted, so this revision cannot be sent.` });
    replaced = old || null;
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

  // noEmail: the deal was agreed by phone and already finalized verbally --
  // skip the actual email, but still record everything else "Send Quote"
  // normally does (pricing snapshot, quote_sent_at, new->contacted status),
  // so the quote is just as usable from Concierge/accept-quote.html as a
  // genuinely emailed one. quote_sent_via distinguishes the two so the list
  // page doesn't falsely claim an email went out.
  if (!noEmail) {
    // Bill To and Ship To as the quote has them saved (falling back to the CRM contact's address), the same way the invoice will copy them.
    const [[quoteContact]] = await pool.query('SELECT * FROM newsletter_contacts WHERE email = ?', [quote.email]);
    const emailBillTo = billFromQuote(quote, quoteContact);
    const emailShipTo = shipFromQuote(quote, quoteContact);
    await sendQuoteEmail({
      to: quote.email,
      firstName: quote.first_name,
      lastName: quote.last_name,
      school: quote.school,
      quoteNumber: quote.quote_number || null,
      billTo: emailBillTo, shipTo: emailShipTo,
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
  }

  await pool.query(
    `UPDATE quote_requests
     SET quoted_product_id = ?, quoted_product_name = ?, quoted_seat_count = ?,
         quoted_amount_cents = ?, quoted_at = NOW(), quote_sent_at = NOW(), quote_sent_via = ?,
         status = IF(status = 'new', 'contacted', status),
         quoted_tier_name = ?, quoted_addon_seats = ?,
         quoted_term_years = ?, quoted_school_domain = ?,
         quote_valid_until = COALESCE(?, quote_valid_until),
         content_profile_id = ?
     WHERE id = ?`,
    [quotedProductId || null, quotedProductName, quotedSeatCount || null, quotedAmountCents,
     noEmail ? 'phone' : 'email',
     quotedTierName || null,
     quotedAddonSeats != null ? Number(quotedAddonSeats) : null,
     quotedTermYears != null ? Number(quotedTermYears) : null,
     schoolDomain,
     validUntil || null,
     profile ? profile.id : null,
     quote.id]
  );

  // The revision is out: the quote it replaces stops accepting (its link shows the "replaced" page), unless it was accepted in the meantime.
  if (replaced && replaced.version_status !== 'superseded') {
    const [sup] = await pool.query("UPDATE quote_requests SET version_status = 'superseded' WHERE id = ? AND accepted_at IS NULL", [replaced.id]);
    if (sup.affectedRows) await crmHooks.quoteEvent(replaced.id, 'superseded', { detail: `replaced by ${quote.quote_number || quote.id}`, actorAdminId: req.user.userId });
    if (sup.affectedRows) await crmHooks.quotePriceChanged(quote.id, replaced.quoted_amount_cents, { actorAdminId: req.user.userId });
  }
  await crmHooks.quoteEvent(quote.id, 'sent', { detail: noEmail ? 'by phone' : 'by email', actorAdminId: req.user.userId });

  await auditPriceChange(req, quote, priceDiff);
  const [[updated]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [quote.id]);
  res.json({ ok: true, quote: publicQuote(updated) });
});

// POST /api/contact/quotes/:id/copy — duplicate a quote as a fresh draft
// Body may include { firstName, lastName, email, phone, school } to override the contact
router.post('/quotes/:id/copy', requireAuth, requireCrmRole('write'), async (req, res) => {
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
            quoted_term_years, quoted_school_domain, quote_valid_until, content_profile_id,
            bill_to_street, bill_to_city, bill_to_state, bill_to_zip,
            ship_to_name, ship_to_company, ship_to_street, ship_to_city, ship_to_state, ship_to_zip, origin, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'new')`,
        [
          generateQuoteNumber(),
          firstName, lastName, email, school, phone,
          src.message || null,
          src.quoted_product_id || null, src.quoted_product_name || null,
          src.quoted_tier_name || null, src.quoted_seat_count || null,
          src.quoted_amount_cents || null, src.quoted_addon_seats || null,
          src.quoted_term_years || null, src.quoted_school_domain || null, src.quote_valid_until || null,
          src.content_profile_id || null,
          src.bill_to_street || null, src.bill_to_city || null, src.bill_to_state || null, src.bill_to_zip || null,
          src.ship_to_name || null, src.ship_to_company || null, src.ship_to_street || null,
          src.ship_to_city || null, src.ship_to_state || null, src.ship_to_zip || null,
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

  // Phase 4b: the copy belongs to the same buyer's contact, and to the same deal only when the buyer is the same person and this admin may edit that deal.
  let inheritDeal = null;
  if (src.opportunity_id && email.trim().toLowerCase() === String(src.email || '').trim().toLowerCase() && (await isCrmEnabled())) {
    const role = await loadCrmRole(req.user.userId);
    const [[deal]] = role ? await pool.query('SELECT id, owner_admin_id FROM crm_opportunities WHERE id = ?', [src.opportunity_id]) : [[null]];
    if (deal && canEditDeal(role, req.user.userId, deal)) inheritDeal = deal.id;
  }
  await setQuoteLinks(pool, newId, { contactEmail: email, opportunityId: inheritDeal, adminId: req.user.userId });
  await crmHooks.quoteEvent(newId, 'created', { detail: `copy of ${src.quote_number || src.id}`, actorAdminId: req.user.userId });

  const [[created]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [newId]);
  res.status(201).json({ ok: true, quote: publicQuote(created) });
});

// POST /api/contact/quotes/:id/revise — start a new version of a quote that was SENT and not yet accepted (Sales CRM phase 4b). The revision is a new quote (new number,
// revision + 1, same deal and contact, same pricing to start from). The old one keeps working until the revision is SENT; sending it replaces the old one.
router.post('/quotes/:id/revise', requireAuth, requireCrmRole('write'), async (req, res) => {
  const [[src]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!src) return res.status(404).json({ error: 'Not found' });
  if (src.accepted_at) return res.status(409).json({ code: 'already_accepted', error: 'This quote was already accepted, so it cannot be revised.' });
  if (src.version_status === 'superseded') return res.status(409).json({ code: 'superseded', error: 'A newer revision of this quote was already sent. Revise that one instead.' });
  if (!src.quote_sent_at) return res.status(409).json({ code: 'not_sent', error: 'This quote has not been sent yet. Edit it instead of revising it.' });
  const [open] = await pool.query("SELECT id, quote_number FROM quote_requests WHERE supersedes_quote_id = ? AND version_status = 'current' LIMIT 1", [src.id]);
  if (open.length) return res.status(409).json({ code: 'revision_open', existingQuoteId: open[0].id, error: `Revision ${open[0].quote_number || open[0].id} is already open for this quote. Finish that one.` });

  // The deal is kept only if this admin may still edit it.
  let dealId = null;
  if (src.opportunity_id && (await isCrmEnabled())) {
    const role = await loadCrmRole(req.user.userId);
    const [[deal]] = role ? await pool.query('SELECT id, owner_admin_id FROM crm_opportunities WHERE id = ?', [src.opportunity_id]) : [[null]];
    if (deal && !canEditDeal(role, req.user.userId, deal)) return res.status(403).json({ code: 'not_your_deal', error: 'This quote is on a deal that belongs to someone else. Ask the owner or a CRM Admin.' });
    if (deal) dealId = deal.id;
  }

  let newId = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [result] = await pool.query(
        `INSERT INTO quote_requests
           (quote_number, first_name, last_name, email, school, phone, message,
            quoted_product_id, quoted_product_name, quoted_tier_name, quoted_seat_count, quoted_amount_cents, quoted_addon_seats,
            quoted_term_years, quoted_school_domain, quote_valid_until, content_profile_id,
            bill_to_street, bill_to_city, bill_to_state, bill_to_zip,
            ship_to_name, ship_to_company, ship_to_street, ship_to_city, ship_to_state, ship_to_zip,
            revision_number, supersedes_quote_id, version_status, origin, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', 'admin', 'new')`,
        [
          generateQuoteNumber(), src.first_name, src.last_name, src.email, src.school || null, src.phone || null, src.message || null,
          src.quoted_product_id || null, src.quoted_product_name || null, src.quoted_tier_name || null, src.quoted_seat_count || null,
          src.quoted_amount_cents === undefined ? null : src.quoted_amount_cents, src.quoted_addon_seats || null,
          src.quoted_term_years || null, src.quoted_school_domain || null, src.quote_valid_until || null, src.content_profile_id || null,
          src.bill_to_street || null, src.bill_to_city || null, src.bill_to_state || null, src.bill_to_zip || null,
          src.ship_to_name || null, src.ship_to_company || null, src.ship_to_street || null, src.ship_to_city || null, src.ship_to_state || null, src.ship_to_zip || null,
          Number(src.revision_number || 1) + 1, src.id,
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
  await setQuoteLinks(pool, newId, { contactEmail: src.email, opportunityId: dealId, adminId: req.user.userId });
  await crmHooks.quoteEvent(newId, 'created', { detail: `revision ${Number(src.revision_number || 1) + 1} of ${src.quote_number || src.id}`, actorAdminId: req.user.userId });

  const [[created]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [newId]);
  res.status(201).json({ ok: true, quote: publicQuote(created) });
});

module.exports = router;
