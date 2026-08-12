const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { unsubscribeToken, sendVerificationEmail } = require('../lib/mailer');
const { createToken } = require('../lib/site-tokens');
const { fireAutomation } = require('../lib/automations');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function attachGroups(contacts) {
  if (contacts.length === 0) return contacts;
  const [rows] = await pool.query(
    `SELECT m.contact_id, g.id, g.name FROM contact_group_members m
     JOIN contact_groups g ON g.id = m.group_id
     WHERE m.contact_id IN (?)`,
    [contacts.map(c => c.id)]
  );
  const groupsByContact = {};
  rows.forEach(r => {
    (groupsByContact[r.contact_id] = groupsByContact[r.contact_id] || []).push({ id: r.id, name: r.name });
  });
  return contacts.map(c => ({ ...c, groups: groupsByContact[c.id] || [] }));
}

// Site users (public-site accounts) aren't a separate CRM entity — they're
// linked to a contact purely by matching email, so this surfaces account
// status as a value on the contact rather than a standalone admin dashboard.
async function attachSiteUserInfo(contacts) {
  if (contacts.length === 0) return contacts;
  const emails = contacts.map(c => c.email);
  const [rows] = await pool.query('SELECT id, email, email_verified FROM site_users WHERE email IN (?)', [emails]);
  const byEmail = {};
  rows.forEach(r => { byEmail[r.email.toLowerCase()] = r; });
  return contacts.map(c => ({ ...c, siteUser: byEmail[c.email.toLowerCase()] || null }));
}

async function setContactGroups(connection, contactId, groupIds) {
  await connection.query('DELETE FROM contact_group_members WHERE contact_id = ?', [contactId]);
  if (Array.isArray(groupIds) && groupIds.length) {
    await connection.query(
      'INSERT INTO contact_group_members (contact_id, group_id) VALUES ' + groupIds.map(() => '(?, ?)').join(', '),
      groupIds.flatMap(gid => [contactId, gid])
    );
  }
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    company: row.company || '',
    address: { street: row.street || '', city: row.city || '', state: row.state || '', zip: row.zip || '' },
    signupDate: row.signup_date,
    source: row.source,
    status: row.status,
    notes: row.notes || '',
    groups: row.groups || [],
    siteUserId: row.siteUser ? row.siteUser.id : null,
    hasAccount: !!row.siteUser,
    accountVerified: row.siteUser ? !!row.siteUser.email_verified : false,
  };
}

// Public — used by both the homepage signup form and the admin's "Add Contact" button.
router.post('/contacts', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ ok: false, reason: 'invalid' });
  }

  const address = b.address || {};
  const status = b.status === 'Unsubscribed' ? 'Unsubscribed' : 'Subscribed';
  try {
    const [result] = await pool.query(
      'INSERT INTO newsletter_contacts (name, email, phone, company, street, city, state, zip, source, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [b.name || '', email, b.phone || '', b.company || '', address.street || '', address.city || '', address.state || '', address.zip || '', b.source || 'Homepage', status, b.notes || '']
    );
    if (Array.isArray(b.groupIds) && b.groupIds.length) {
      await setContactGroups(pool, result.insertId, b.groupIds);
    }
    const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [result.insertId]);
    const [contact] = await attachSiteUserInfo(await attachGroups(rows));
    res.status(201).json({ ok: true, contact: serialize(contact) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ ok: false, reason: 'duplicate' });
    }
    throw err;
  }
});

router.get('/contacts', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM newsletter_contacts ORDER BY signup_date DESC');
  const contacts = (await attachSiteUserInfo(await attachGroups(rows))).map(serialize);
  res.json({ contacts });
});

// Full contact edit — name/email/address/source/status/group membership.
// Only fields present in the body are changed.
router.put('/contacts/:id', requireAuth, async (req, res) => {
  const [existingRows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  const b = req.body || {};
  const address = b.address || {};
  const merged = {
    name: b.name !== undefined ? b.name : existing.name,
    email: b.email !== undefined ? b.email.trim() : existing.email,
    phone: b.phone !== undefined ? b.phone : existing.phone,
    company: b.company !== undefined ? b.company : existing.company,
    street: b.address !== undefined ? address.street || '' : existing.street,
    city: b.address !== undefined ? address.city || '' : existing.city,
    state: b.address !== undefined ? address.state || '' : existing.state,
    zip: b.address !== undefined ? address.zip || '' : existing.zip,
    source: b.source !== undefined ? b.source : existing.source,
    status: b.status !== undefined ? b.status : existing.status,
    notes: b.notes !== undefined ? b.notes : existing.notes,
  };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE newsletter_contacts SET name=?, email=?, phone=?, company=?, street=?, city=?, state=?, zip=?, source=?, status=?, notes=? WHERE id=?',
      [merged.name, merged.email, merged.phone, merged.company, merged.street, merged.city, merged.state, merged.zip, merged.source, merged.status, merged.notes, req.params.id]
    );
    if (b.groupIds !== undefined) {
      await setContactGroups(connection, req.params.id, b.groupIds);
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  const [contact] = await attachSiteUserInfo(await attachGroups(rows));
  res.json({ contact: serialize(contact) });
});

router.delete('/contacts/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true });
});

// Ad-hoc admin-triggered resend of the site-account verification email,
// looked up by the contact's email — unlike the public self-service
// /api/site-auth/resend-verification, this is authenticated and gives the
// admin a specific reason when it can't send (no account / already verified).
router.post('/contacts/:id/resend-verification', requireAuth, async (req, res) => {
  const [contactRows] = await pool.query('SELECT email FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  const contact = contactRows[0];
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const [userRows] = await pool.query('SELECT id, first_name, email_verified FROM site_users WHERE email = ?', [contact.email]);
  const user = userRows[0];
  if (!user) return res.status(404).json({ error: 'No account is registered for this email' });
  if (user.email_verified) return res.status(400).json({ error: 'This account is already verified' });

  const verifyToken = await createToken(user.id, 'verify', 24 * 60 * 60 * 1000);
  const verifyUrl = `${process.env.SITE_URL || ''}/api/site-auth/verify?token=${verifyToken}`;
  await sendVerificationEmail({ to: contact.email, firstName: user.first_name, verifyUrl });
  res.json({ ok: true });
});

// Auto-assigns a contact to the correct system group(s) based on what they
// just purchased. Safe to call repeatedly — INSERT IGNORE prevents duplicates.
async function assignContactToGroups(contactId, { productType, memberType, licenseProductId }) {
  const groupIds = new Set();

  if (productType === 'single_license' || productType === 'group_license') {
    if (licenseProductId) {
      // Use the group configured on the specific license product if set;
      // fall back to the Teachers system group if none is configured.
      const [[prod]] = await pool.query('SELECT auto_assign_group_id FROM license_products WHERE id = ?', [licenseProductId]);
      if (prod && prod.auto_assign_group_id) {
        groupIds.add(prod.auto_assign_group_id);
      } else {
        const [[tg]] = await pool.query("SELECT id FROM contact_groups WHERE system_key = 'teachers'");
        if (tg) groupIds.add(tg.id);
      }
    } else {
      const [[tg]] = await pool.query("SELECT id FROM contact_groups WHERE system_key = 'teachers'");
      if (tg) groupIds.add(tg.id);
    }
  } else {
    const keys = [];
    if (productType === 'book' || memberType === 'consumer') keys.push('consumer');
    if (memberType === 'service_provider') keys.push('service_provider');
    if (memberType === 'brand_ambassador') keys.push('brand_ambassador');
    if (keys.length) {
      const [groups] = await pool.query('SELECT id FROM contact_groups WHERE system_key IN (?)', [keys]);
      groups.forEach(g => groupIds.add(g.id));
    }
  }

  for (const id of groupIds) {
    await pool.query('INSERT IGNORE INTO contact_group_members (contact_id, group_id) VALUES (?, ?)', [contactId, id]);
  }
}

// --- Contact groups ---

router.get('/groups', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.id, g.name, COUNT(cgm.contact_id) AS memberCount
     FROM contact_groups g
     LEFT JOIN contact_group_members cgm ON cgm.group_id = g.id
     GROUP BY g.id, g.name
     ORDER BY g.name`
  );
  res.json({ groups: rows });
});

router.post('/groups', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  try {
    const [result] = await pool.query('INSERT INTO contact_groups (name) VALUES (?)', [name]);
    res.status(201).json({ group: { id: result.insertId, name } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A group with this name already exists' });
    }
    throw err;
  }
});

router.delete('/groups/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM contact_groups WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

// Public link clicked from inside a sent campaign email — no auth, verified by
// an HMAC token instead so a link can't be used to unsubscribe someone else.
// The optional `send` param attributes this unsubscribe back to the specific
// campaign_sends row it came from, for per-campaign unsubscribe stats.
router.get('/unsubscribe', async (req, res) => {
  const email = (req.query.email || '').trim();
  const token = req.query.token || '';
  const sendToken = req.query.send || '';
  res.set('Content-Type', 'text/html');

  if (!email || token !== unsubscribeToken(email)) {
    return res.status(400).send('<p style="font-family:sans-serif; padding:40px; text-align:center;">This unsubscribe link is invalid.</p>');
  }
  await pool.query('UPDATE newsletter_contacts SET status = ? WHERE email = ?', ['Unsubscribed', email]);
  if (sendToken) {
    await pool.query('UPDATE campaign_sends SET unsubscribed_at = NOW() WHERE token = ?', [sendToken]);
  }
  res.send(`<p style="font-family:sans-serif; padding:40px; text-align:center;">${email} has been unsubscribed from Fixer Nation emails.</p>`);
});

// --- Purchases (books, single teacher licenses, group/school licenses) ---

const PRODUCT_TYPES = ['book', 'single_license', 'group_license'];

// Strips a leading "@" and stray whitespace/casing so "@Lincoln.edu" and
// "lincoln.edu " both save and search as the same domain.
function normalizeDomain(domain) {
  return (domain || '').trim().replace(/^@/, '').toLowerCase();
}

// Translates a user search term into a SQL LIKE pattern.
// * → %, ? → _, literal % and _ are escaped. No wildcards → %term% (contains).
function toSqlLike(term) {
  const escaped = term.replace(/%/g, '\\%').replace(/_/g, '\\_');
  if (escaped.includes('*') || escaped.includes('?')) {
    return escaped.replace(/\*/g, '%').replace(/\?/g, '_');
  }
  return `%${escaped}%`;
}

async function attachPurchaseDetails(purchases) {
  if (purchases.length === 0) return purchases;
  const ids = purchases.map(p => p.id);
  const bookIds = purchases.map(p => p.book_id).filter(Boolean);
  const licenseProductIds = purchases.map(p => p.license_product_id).filter(Boolean);
  const membershipPlanIds = purchases.map(p => p.membership_plan_id).filter(Boolean);

  const [seatRows] = await pool.query(
    `SELECT s.*, u.first_name, u.last_name FROM license_seats s
     LEFT JOIN site_users u ON u.id = s.registered_site_user_id
     WHERE s.purchase_id IN (?) ORDER BY s.id`,
    [ids]
  );
  const [bookRows] = bookIds.length ? await pool.query('SELECT id, title FROM books WHERE id IN (?)', [bookIds]) : [[]];
  const bookTitleById = {};
  bookRows.forEach(b => { bookTitleById[b.id] = b.title; });

  const [licenseProductRows] = licenseProductIds.length
    ? await pool.query('SELECT id, name FROM license_products WHERE id IN (?)', [licenseProductIds])
    : [[]];
  const licenseProductNameById = {};
  licenseProductRows.forEach(lp => { licenseProductNameById[lp.id] = lp.name; });

  const [membershipPlanRows] = membershipPlanIds.length
    ? await pool.query('SELECT id, name, member_type FROM membership_plans WHERE id IN (?)', [membershipPlanIds])
    : [[]];
  const membershipPlanById = {};
  membershipPlanRows.forEach(mp => { membershipPlanById[mp.id] = mp; });

  const registeredUserIds = seatRows.map(s => s.registered_site_user_id).filter(Boolean);
  const [audRows] = registeredUserIds.length
    ? await pool.query('SELECT site_user_id, audience FROM site_user_audiences WHERE site_user_id IN (?)', [registeredUserIds])
    : [[]];
  const audiencesByUser = {};
  audRows.forEach(r => { (audiencesByUser[r.site_user_id] = audiencesByUser[r.site_user_id] || []).push(r.audience); });

  const seatsByPurchase = {};
  seatRows.forEach(s => {
    (seatsByPurchase[s.purchase_id] = seatsByPurchase[s.purchase_id] || []).push({
      id: s.id,
      invitedEmail: s.invited_email,
      status: s.status,
      registeredSiteUserId: s.registered_site_user_id || null,
      registeredName: s.registered_site_user_id ? `${s.first_name} ${s.last_name}` : null,
      registeredAt: s.registered_at,
      audiences: s.registered_site_user_id ? (audiencesByUser[s.registered_site_user_id] || []) : [],
    });
  });

  return purchases.map(p => ({
    id: p.id,
    contactId: p.contact_id,
    productType: p.product_type,
    bookId: p.book_id,
    bookTitle: p.book_id ? bookTitleById[p.book_id] || null : null,
    licenseProductId: p.license_product_id,
    licenseProductName: p.license_product_id ? licenseProductNameById[p.license_product_id] || null : null,
    membershipPlanId: p.membership_plan_id,
    membershipPlanName: p.membership_plan_id ? (membershipPlanById[p.membership_plan_id] || {}).name || null : null,
    memberType: p.membership_plan_id ? (membershipPlanById[p.membership_plan_id] || {}).member_type || null : null,
    seatCount: p.seat_count,
    purchasedAt: p.purchased_at,
    source: p.source,
    notes: p.notes,
    schoolDomain: p.school_domain,
    paymentMethod: p.payment_method,
    paymentStatus: p.payment_status,
    poNumber: p.po_number,
    invoiceId: p.invoice_id,
    amount: p.amount_cents === null ? null : Number(p.amount_cents) / 100,
    licenseStatus: p.license_status || 'active',
    effectiveDate: p.effective_date ? new Date(p.effective_date).toISOString().slice(0, 10) : null,
    expirationDate: p.expiration_date ? new Date(p.expiration_date).toISOString().slice(0, 10) : null,
    isTrial: !!(p.trial_lesson_limit),
    trialExpirationDate: p.trial_expiration_date ? new Date(p.trial_expiration_date).toISOString() : null,
    trialLessonLimit: p.trial_lesson_limit || null,
    conversionCreditCents: p.conversion_credit_cents || null,
    conversionCreditRedeemedAt: p.conversion_credit_redeemed_at ? new Date(p.conversion_credit_redeemed_at).toISOString() : null,
    convertedToPurchaseId: p.converted_to_purchase_id || null,
    seats: seatsByPurchase[p.id] || [],
  }));
}

// Shared by the admin's manual "add a purchase" endpoint below and the real
// Stripe/PO checkout flows (server/routes/checkout.js) — all need the exact
// same purchase + seat-creation behavior, just from different sources.
async function createPurchase(contactId, { productType, bookId, licenseProductId, membershipPlanId, seatCount, source, notes, stripeSessionId, stripeInvoiceId, schoolDomain, paymentMethod, paymentStatus, poNumber, invoiceId, amountCents, trialExpirationDate, trialLessonLimit, conversionCreditCents }) {
  const finalSeatCount = productType === 'single_license' ? 1 : productType === 'group_license' ? Number(seatCount) : null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO purchases (contact_id, product_type, book_id, license_product_id, membership_plan_id, seat_count, source, notes, stripe_session_id, stripe_invoice_id, school_domain, payment_method, payment_status, po_number, invoice_id, amount_cents, trial_expiration_date, trial_lesson_limit, conversion_credit_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contactId, productType, productType === 'book' ? bookId : null,
        (productType === 'group_license' || productType === 'single_license') ? licenseProductId || null : null,
        productType === 'membership' ? membershipPlanId || null : null,
        finalSeatCount, source || 'Manual Entry', notes || '', stripeSessionId || null, stripeInvoiceId || null,
        productType === 'group_license' ? normalizeDomain(schoolDomain) || null : null,
        paymentMethod || 'manual', paymentStatus || 'paid', poNumber || null,
        invoiceId || null, amountCents === undefined ? null : amountCents,
        trialExpirationDate || null, trialLessonLimit || null, conversionCreditCents || null,
      ]
    );
    const purchaseId = result.insertId;

    if (productType === 'single_license') {
      const [contactRows] = await connection.query('SELECT email FROM newsletter_contacts WHERE id = ?', [contactId]);
      await connection.query(
        'INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, ?)',
        [purchaseId, contactRows[0].email, 'pending']
      );
    } else if (productType === 'group_license') {
      await connection.query(
        'INSERT INTO license_seats (purchase_id, invited_email, status) VALUES ' + Array(finalSeatCount).fill('(?, NULL, ?)').join(', '),
        Array.from({ length: finalSeatCount }).flatMap(() => [purchaseId, 'available'])
      );
    }
    await connection.commit();

    // Automated thank-you email — best-effort (fireAutomation swallows its
    // own errors), so a template/lookup issue here never fails the purchase
    // itself. Only book/membership purchases get one; license purchases are
    // covered by the invoice-paid and seat-invite automations instead, since
    // a single PO order can create several license purchase rows and would
    // otherwise flood the buyer with one thank-you per line item.
    if (productType === 'book' || productType === 'membership') {
      try {
        const [[contact]] = await pool.query('SELECT email, name FROM newsletter_contacts WHERE id = ?', [contactId]);
        const firstName = (contact.name || '').split(' ')[0] || 'there';
        if (productType === 'book') {
          const [[book]] = await pool.query('SELECT title FROM books WHERE id = ?', [bookId]);
          await fireAutomation('book_purchase_thank_you', {
            to: contact.email,
            mergeFields: { firstName, bookTitle: book ? book.title : 'your book' },
          });
        } else {
          const [[plan]] = await pool.query('SELECT name FROM membership_plans WHERE id = ?', [membershipPlanId]);
          await fireAutomation('membership_purchase_thank_you', {
            to: contact.email,
            mergeFields: {
              firstName,
              planName: plan ? plan.name : 'your membership',
              amount: amountCents === null || amountCents === undefined ? '' : '$' + (amountCents / 100).toFixed(2),
            },
          });
        }
      } catch (err) {
        console.error('Thank-you automation lookup failed:', err.message);
      }
    }

    // Auto-assign contact to system user groups based on what they bought.
    // Best-effort — a missing system_key row never blocks the purchase.
    try {
      let memberType = null;
      if (productType === 'membership' && membershipPlanId) {
        const [[plan]] = await pool.query('SELECT member_type FROM membership_plans WHERE id = ?', [membershipPlanId]);
        memberType = plan && plan.member_type;
      }
      await assignContactToGroups(contactId, { productType, memberType, licenseProductId: licenseProductId || null });
    } catch (e) { console.error('assignContactToGroups failed:', e.message); }

    return purchaseId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// All orders across every contact, newest first — backs the Orders dashboard
// and the Financial Insights "N orders" links. Optional start/end filters to
// a date range (both must be valid dates or the filter is ignored entirely).
router.get('/purchases', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  let sql = 'SELECT * FROM purchases';
  const params = [];
  if (DATE_PATTERN.test(start) && DATE_PATTERN.test(end)) {
    sql += ' WHERE DATE(purchased_at) BETWEEN ? AND ?';
    params.push(start, end);
  }
  sql += ' ORDER BY purchased_at DESC';

  const [rows] = await pool.query(sql, params);
  const purchases = await attachPurchaseDetails(rows);

  const contactIds = [...new Set(purchases.map(p => p.contactId))];
  const [contactRows] = contactIds.length
    ? await pool.query('SELECT id, name, email, company FROM newsletter_contacts WHERE id IN (?)', [contactIds])
    : [[]];
  const contactById = Object.fromEntries(contactRows.map(c => [c.id, c]));

  res.json({
    purchases: purchases.map(p => ({
      ...p,
      buyer: contactById[p.contactId] || null,
    })),
  });
});

router.get('/contacts/:id/purchases', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM purchases WHERE contact_id = ? ORDER BY purchased_at DESC', [req.params.id]);
  res.json({ purchases: await attachPurchaseDetails(rows) });
});

router.post('/contacts/:id/purchases', requireAuth, async (req, res) => {
  const [contactRows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  const contact = contactRows[0];
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const b = req.body || {};
  if (!PRODUCT_TYPES.includes(b.productType)) {
    return res.status(400).json({ error: 'productType must be one of: ' + PRODUCT_TYPES.join(', ') });
  }
  if (b.productType === 'book' && !b.bookId) {
    return res.status(400).json({ error: 'bookId is required for a book purchase' });
  }
  if (b.productType === 'group_license' && !(Number(b.seatCount) > 0)) {
    return res.status(400).json({ error: 'seatCount must be a positive number for a group license' });
  }

  const purchaseId = await createPurchase(contact.id, {
    productType: b.productType,
    bookId: b.bookId,
    seatCount: b.seatCount,
    source: b.source || 'Manual Entry',
    notes: b.notes,
    schoolDomain: b.schoolDomain,
  });

  const [rows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
  const [purchase] = await attachPurchaseDetails(rows);
  res.status(201).json({ purchase });
});

// Looks up group licenses by the school's email domain — lets an admin find
// "how many seats does lincolnhigh.edu have left" without first having to
// know which CRM contact bought them. Group licenses created before this
// feature won't show up until their schoolDomain is set via the edit UI.
router.get('/purchases/by-domain', requireAuth, async (req, res) => {
  const domain = normalizeDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const [rows] = await pool.query(
    "SELECT * FROM purchases WHERE product_type = 'group_license' AND school_domain LIKE ? ORDER BY purchased_at DESC",
    [toSqlLike(domain)]
  );
  if (!rows.length) return res.json({ purchases: [] });

  const contactIds = [...new Set(rows.map(p => p.contact_id))];
  const [contactRows] = await pool.query('SELECT id, name, email FROM newsletter_contacts WHERE id IN (?)', [contactIds]);
  const contactById = {};
  contactRows.forEach(c => { contactById[c.id] = { name: c.name, email: c.email }; });

  const purchases = (await attachPurchaseDetails(rows)).map(p => ({
    ...p,
    buyer: contactById[p.contactId] || null,
  }));
  res.json({ purchases });
});

// Deletes a school's license entirely (e.g. they cancelled their account) —
// every group_license purchase for that EXACT domain, cascading to their
// license_seats. Uses an exact match on purpose, unlike the forgiving LIKE
// search above: a fuzzy delete could wipe out an unrelated school that just
// happened to share a substring in its domain. Registered teachers' site_user
// accounts are not touched, only their access via this school's seats.
router.delete('/purchases/by-domain', requireAuth, async (req, res) => {
  const domain = normalizeDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const [rows] = await pool.query(
    "SELECT id FROM purchases WHERE product_type = 'group_license' AND school_domain = ?",
    [domain]
  );
  if (!rows.length) return res.status(404).json({ error: 'No group licenses found for that domain' });

  const ids = rows.map(r => r.id);
  await pool.query('DELETE FROM purchases WHERE id IN (?)', [ids]);
  res.json({ ok: true, deleted: ids.length });
});

// Lets the admin correct notes/source on any purchase, and grow or shrink a
// group license's seat count after the fact. Shrinking only ever removes
// still-open ('pending') seats — a seat a teacher has already claimed is
// never touched here (use the unregister endpoint below to free one first).
router.put('/purchases/:id', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
  const purchase = rows[0];
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

  const b = req.body || {};
  const notes = b.notes !== undefined ? b.notes : purchase.notes;
  const source = b.source !== undefined ? b.source : purchase.source;
  const paymentStatus = b.paymentStatus !== undefined ? b.paymentStatus : purchase.payment_status;
  const poNumber = b.poNumber !== undefined ? b.poNumber : purchase.po_number;
  const schoolDomain = purchase.product_type === 'group_license'
    ? (b.schoolDomain !== undefined ? normalizeDomain(b.schoolDomain) || null : purchase.school_domain)
    : purchase.school_domain;

  if (purchase.product_type === 'group_license' && b.seatCount !== undefined) {
    const newCount = Number(b.seatCount);
    if (!(newCount > 0)) return res.status(400).json({ error: 'seatCount must be a positive number' });

    const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE purchase_id = ?', [purchase.id]);
    const registeredCount = seatRows.filter(s => s.status === 'registered').length;
    if (newCount < registeredCount) {
      return res.status(400).json({ error: `Cannot reduce below ${registeredCount} seats already in use — free some up first` });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'UPDATE purchases SET seat_count = ?, notes = ?, source = ?, school_domain = ?, payment_status = ?, po_number = ? WHERE id = ?',
        [newCount, notes, source, schoolDomain, paymentStatus, poNumber, purchase.id]
      );

      const currentTotal = seatRows.length;
      if (newCount > currentTotal) {
        const toAdd = newCount - currentTotal;
        await connection.query(
          'INSERT INTO license_seats (purchase_id, invited_email, status) VALUES ' + Array(toAdd).fill('(?, NULL, ?)').join(', '),
          Array.from({ length: toAdd }).flatMap(() => [purchase.id, 'available'])
        );
      } else if (newCount < currentTotal) {
        const toRemove = currentTotal - newCount;
        const removableIds = seatRows.filter(s => s.status === 'available' || s.status === 'pending').slice(0, toRemove).map(s => s.id);
        if (removableIds.length) {
          await connection.query('DELETE FROM license_seats WHERE id IN (?)', [removableIds]);
        }
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } else {
    await pool.query(
      'UPDATE purchases SET notes = ?, source = ?, school_domain = ?, payment_status = ?, po_number = ? WHERE id = ?',
      [notes, source, schoolDomain, paymentStatus, poNumber, purchase.id]
    );
  }

  const [updatedRows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [purchase.id]);
  const [purchase2] = await attachPurchaseDetails(updatedRows);
  res.json({ purchase: purchase2 });
});

// Updates license lifecycle dates and status for a school license purchase.
// Auto-promotes to 'scheduled' when an admin sets an active status but the
// effective_date hasn't arrived yet — avoids access being granted too early.
router.put('/purchases/:id/license-dates', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, product_type FROM purchases WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Purchase not found' });

  const b = req.body || {};
  const effectiveDate = b.effectiveDate || null;
  const expirationDate = b.expirationDate || null;
  let licenseStatus = b.licenseStatus || null;

  if (effectiveDate && expirationDate && effectiveDate >= expirationDate) {
    return res.status(400).json({ error: 'Effective date must be before expiration date' });
  }

  // If admin marks it active but effective_date is still in the future, schedule it instead
  const today = new Date().toISOString().slice(0, 10);
  if (licenseStatus === 'active' && effectiveDate && effectiveDate > today) {
    licenseStatus = 'scheduled';
  }

  await pool.query(
    'UPDATE purchases SET effective_date = ?, expiration_date = ?, license_status = ? WHERE id = ?',
    [effectiveDate || null, expirationDate || null, licenseStatus, rows[0].id]
  );

  pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, action, entity_type, entity_id)
     VALUES ('admin', ?, 'license_dates_updated', 'purchase', ?)`,
    [req.session && req.session.userId ? req.session.userId : null, rows[0].id]
  ).catch(e => console.error('audit log error:', e.message));

  res.json({ ok: true, licenseStatus });
});

router.delete('/purchases/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM purchases WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Purchase not found' });
  res.json({ ok: true });
});

// Assign (or clear) the invited email for one seat of a group license. Only
// open ('pending') seats can be reassigned — once a teacher has registered,
// the seat is theirs.
router.put('/purchases/:purchaseId/seats/:seatId', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?',
    [req.params.seatId, req.params.purchaseId]
  );
  const seat = rows[0];
  if (!seat) return res.status(404).json({ error: 'Seat not found' });
  if (seat.status !== 'pending') return res.status(409).json({ error: 'This seat has already been registered and cannot be reassigned' });

  const invitedEmail = (req.body && req.body.invitedEmail || '').trim();
  if (invitedEmail && !EMAIL_PATTERN.test(invitedEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  await pool.query('UPDATE license_seats SET invited_email = ? WHERE id = ?', [invitedEmail || null, seat.id]);

  // Only fire on an actual change to a new email — re-saving the same
  // invited address shouldn't re-send the invite every time.
  if (invitedEmail && invitedEmail !== seat.invited_email) {
    try {
      const [[purchase]] = await pool.query('SELECT license_product_id, school_domain FROM purchases WHERE id = ?', [req.params.purchaseId]);
      let licenseProductName = 'Fixer Nation Education';
      if (purchase && purchase.license_product_id) {
        const [[lp]] = await pool.query('SELECT name FROM license_products WHERE id = ?', [purchase.license_product_id]);
        if (lp) licenseProductName = lp.name;
      }
      const schoolLabel = purchase && purchase.school_domain ? ` (${purchase.school_domain})` : '';
      await fireAutomation('license_seat_invite', { to: invitedEmail, mergeFields: { licenseProductName, schoolLabel } });
    } catch (err) {
      console.error('License seat invite automation failed:', err.message);
    }
  }
  res.json({ ok: true });
});

// Directly links a seat to an existing site_user account by email, bypassing
// the normal "sign up with the invited email" flow — for when an admin needs
// to hand a seat to someone who already has an account under a different
// invited address, or fix a signup that didn't get auto-claimed correctly.
router.post('/purchases/:purchaseId/seats/:seatId/register', requireAuth, async (req, res) => {
  const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?', [req.params.seatId, req.params.purchaseId]);
  const seat = seatRows[0];
  if (!seat) return res.status(404).json({ error: 'Seat not found' });

  const email = (req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const [userRows] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email]);
  if (!userRows[0]) {
    return res.status(404).json({ error: 'No account exists with that email yet — ask them to sign up first, or save it as the invited email instead.' });
  }

  await pool.query(
    "UPDATE license_seats SET status = 'registered', invited_email = ?, registered_site_user_id = ?, registered_at = NOW() WHERE id = ?",
    [email, userRows[0].id, seat.id]
  );
  res.json({ ok: true });
});

// Frees a claimed seat back to 'pending' without touching the customer's
// account — use this instead of deleting the whole site_user when you just
// need to reassign one seat to someone else.
router.post('/purchases/:purchaseId/seats/:seatId/unregister', requireAuth, async (req, res) => {
  const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?', [req.params.seatId, req.params.purchaseId]);
  const seat = seatRows[0];
  if (!seat) return res.status(404).json({ error: 'Seat not found' });

  await pool.query(
    "UPDATE license_seats SET status = 'pending', registered_site_user_id = NULL, registered_at = NULL WHERE id = ?",
    [seat.id]
  );
  res.json({ ok: true });
});

const VALID_AUDIENCES = ['Elementary School', 'Middle School', 'High School', 'Higher Education'];

// Update the grade-level audience selections for a specific registered seat (super-admin).
router.put('/seats/:seatId/audiences', requireAuth, async (req, res) => {
  const [[seat]] = await pool.query(
    'SELECT id, registered_site_user_id FROM license_seats WHERE id = ?',
    [req.params.seatId]
  );
  if (!seat) return res.status(404).json({ error: 'Seat not found' });
  if (!seat.registered_site_user_id) return res.status(422).json({ error: 'Seat has no registered teacher yet' });

  const audiences = Array.isArray(req.body && req.body.audiences) ? req.body.audiences : [];
  const invalid = audiences.find(a => !VALID_AUDIENCES.includes(a));
  if (invalid) return res.status(400).json({ error: `Invalid audience value: ${invalid}` });

  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM site_user_audiences WHERE site_user_id = ?', [seat.registered_site_user_id]);
    if (audiences.length > 0) {
      await conn.query(
        'INSERT INTO site_user_audiences (site_user_id, audience) VALUES ' + audiences.map(() => '(?, ?)').join(', '),
        audiences.flatMap(a => [seat.registered_site_user_id, a])
      );
    }
  } finally {
    conn.release();
  }
  res.json({ ok: true, audiences });
});

// Bulk import — rows already parsed client-side from CSV.
router.post('/contacts/import', requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  const defaultSource = (req.body && req.body.defaultSource) || 'Bulk Import';

  const [existingRows] = await pool.query('SELECT email FROM newsletter_contacts');
  const existingEmails = new Set(existingRows.map(r => r.email.toLowerCase()));

  let imported = 0, skippedInvalid = 0, skippedDuplicate = 0;
  for (const row of rows) {
    const email = (row.email || '').trim();
    if (!email || !EMAIL_PATTERN.test(email)) { skippedInvalid++; continue; }
    if (existingEmails.has(email.toLowerCase())) { skippedDuplicate++; continue; }
    await pool.query(
      'INSERT INTO newsletter_contacts (name, email, street, city, state, zip, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.name || '', email, row.street || '', row.city || '', row.state || '', row.zip || '', row.source || defaultSource, 'Subscribed']
    );
    existingEmails.add(email.toLowerCase());
    imported++;
  }

  res.json({ imported, skippedInvalid, skippedDuplicate });
});

module.exports = { router, attachPurchaseDetails, createPurchase, assignContactToGroups };
