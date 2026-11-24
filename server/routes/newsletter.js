const express = require('express');
const pool = require('../db/pool');
const { cleanParty } = require('../lib/invoice-parties');
const { requireAuth, getAuthUser } = require('../middleware/auth');
const { requireCrmRole } = require('../lib/crm-permissions'); // the routes only the retired CRM page used follow the CRM role matrix (works with the Hub off; a Read-only admin can look, nothing more)
const { unsubscribeToken, sendVerificationEmail, esc } = require('../lib/mailer');
const crypto = require('crypto');
const { limiter, clientIp } = require('../lib/rate-limit');
const { RENEWED_STATUSES, restoreExpiredSeats } = require('../lib/seat-renewal');
const { loadCrmRole, can } = require('../lib/crm-permissions');
const { audit } = require('../lib/audit');
const { recordAttributionForEmail } = require('../lib/attribution'); // Sales CRM phase 6: first and latest touch from the fn_attr cookie, advisory only
const { updateContact: updateContactLib } = require('../lib/contact-edit');
const { rolesForContact: rolesForContactLib } = require('../lib/contact-roles');
const { deleteContact: deleteContactAction, resendVerification: resendVerificationAction } = require('../lib/contact-actions'); // shared with routes/contact-screens.js
const P = require('../lib/purchases'); // purchases and seats: one copy, shared with routes/contact-screens.js (merge phase 4)
const { PRODUCT_TYPES, normalizeDomain, findOrCreateSchoolId, toSqlLike, attachPurchaseDetails, createPurchase } = P;
const crmHooks = require('../lib/crm-hooks'); // Sales CRM: re-derive Suspect / Prospect / Customer after a purchase changes (never throws; off unless crm_v2_enabled)

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const { attachGroups, attachSiteUserInfo, setContactGroups, serialize } = require('../lib/contact-records'); // shared with routes/contact-screens.js

// Anonymous callers only (an admin adding contacts in bulk must never be throttled).
const newsletterSignupLimit = limiter({ name: 'newsletter-signup', windowMs: 60 * 60 * 1000, max: 20, key: (req) => (getAuthUser(req) ? null : clientIp(req)) });

// Used by both the public homepage signup form and the admin's "Add Contact"
// button, so it has two modes:
//
//  - Anonymous caller: name + email only. Source, status, notes, phone,
//    address and group membership are set by the server, never the caller --
//    otherwise anyone on the internet could write arbitrary text into CRM
//    fields the admin renders, drop themselves into any contact group, or
//    flag themselves Unsubscribed/whatever. The response is identical whether
//    or not the address already existed, so this can't be used to probe who is
//    on the list.
//  - Admin caller: the full contact payload, as before.
router.post('/contacts', newsletterSignupLimit, async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ ok: false, reason: 'invalid' });
  }

  if (!getAuthUser(req)) {
    try {
      await pool.query(
        "INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'Homepage', 'Subscribed')",
        [String(b.name || '').trim().slice(0, 120), email]
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
    // Phase 6: where this visit came from (first and latest touch), read from the fn_attr cookie on this request. Never blocks or changes the response.
    await recordAttributionForEmail(req, email);
    return res.status(201).json({ ok: true });
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
    if (b.shipTo !== undefined) {
      const sh = cleanParty(b.shipTo, 'ship');
      await pool.query(
        'UPDATE newsletter_contacts SET ship_to_name=?, ship_to_company=?, ship_to_street=?, ship_to_city=?, ship_to_state=?, ship_to_zip=? WHERE id=?',
        [sh.name || null, sh.company || null, sh.street || null, sh.city || null, sh.state || null, sh.zip || null, result.insertId]
      );
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

// Lightweight typeahead search — returns id/name/email/phone/company only
router.get('/contacts/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ contacts: [] });
  const like = `%${q}%`;
  const [rows] = await pool.query(
    'SELECT id, name, email, phone, company FROM newsletter_contacts WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 20',
    [like, like]
  );
  res.json({ contacts: rows });
});

// Full contact edit — name/email/address/source/status/group membership.
// Only fields present in the body are changed.
// Full contact edit (name, email, phone, company, address, ship-to, source, status, notes, groups). The rules, including moving the sign-in account's email with the contact's, are in
// lib/contact-edit.js, shared with the merged Contacts screen (routes/contact-screens.js).
router.put('/contacts/:id', requireAuth, requireCrmRole('write'), async (req, res) => {
  const r = await updateContactLib(req.params.id, req.body);
  res.status(r.status).json(r.body);
});

// The rules for deleting a contact (a buyer is refused, a person on a deal is refused, CRM items need a CRM Admin to confirm, a sign-in account is closed) live in
// lib/contact-actions.js, shared with the merged Contacts screen (routes/contact-screens.js).
router.delete('/contacts/:id', requireAuth, requireCrmRole('erase'), async (req, res) => {
  const r = await deleteContactAction(req.params.id, req.body, req.user);
  res.status(r.status).json(r.body);
});

// Ad-hoc admin-triggered resend of the sign-in account's verification email (lib/contact-actions.js, shared with the merged Contacts screen).
router.post('/contacts/:id/resend-verification', requireAuth, requireCrmRole('write'), async (req, res) => {
  const r = await resendVerificationAction(req.params.id);
  res.status(r.status).json(r.body);
});

// GET /api/newsletter/contacts/:id/roles — everything role-specific about
// this contact that the generic CRM card otherwise has no visibility into:
// their site account role, their curriculum-level audience preference
// (ES/MS/HS/Higher Ed), every School License Administrator assignment
// (which purchase/school, permission level), every District Administrator
// assignment (which district), and every teacher seat they hold or have
// been invited to (grade/title/department/subject, registered vs pending).
// All three admin tables are keyed by site_users.id, not by this contact's
// own id — newsletter_contacts and site_users are only ever linked by
// matching email, never a direct FK — so this is a contact-id entry point
// that resolves to a site_user first, then fans out from there.
router.get('/contacts/:id/roles', requireAuth, requireCrmRole('view'), async (req, res) => {
  const r = await rolesForContactLib(req.params.id);
  res.status(r.status).json(r.body);
});

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

router.post('/groups', requireAuth, requireCrmRole('write'), async (req, res) => {
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

router.delete('/groups/:id', requireAuth, requireCrmRole('write'), async (req, res) => {
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

  // Constant-time compare: the token is an HMAC, so a plain !== leaks how many leading characters matched.
  const expected = Buffer.from(unsubscribeToken(email || ''));
  const given = Buffer.from(String(token));
  if (!email || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(400).send('<p style="font-family:sans-serif; padding:40px; text-align:center;">This unsubscribe link is invalid.</p>');
  }
  await pool.query('UPDATE newsletter_contacts SET status = ? WHERE email = ?', ['Unsubscribed', email]);
  if (sendToken) {
    await pool.query('UPDATE campaign_sends SET unsubscribed_at = NOW() WHERE token = ?', [sendToken]);
  }
  res.send(`<p style="font-family:sans-serif; padding:40px; text-align:center;">${esc(email)} has been unsubscribed from Fixer Nation emails.</p>`);
});

// --- Purchases (books, single teacher licenses, group/school licenses) ---

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// All orders across every contact, newest first — backs the Orders dashboard
// and the Financial Insights "N orders" links. Optional start/end filters to
// a date range (both must be valid dates or the filter is ignored entirely).
router.get('/purchases', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  let sql = 'SELECT p.*, qr.quote_number FROM purchases p LEFT JOIN quote_requests qr ON qr.id = p.quote_id';
  const params = [];
  if (DATE_PATTERN.test(start) && DATE_PATTERN.test(end)) {
    sql += ' WHERE DATE(p.purchased_at) BETWEEN ? AND ?';
    params.push(start, end);
  }
  sql += ' ORDER BY p.purchased_at DESC';

  const [rows] = await pool.query(sql, params);
  const purchases = await attachPurchaseDetails(rows, { excludeAdminSeats: true });

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

router.get('/contacts/:id/purchases', requireAuth, requireCrmRole('view'), async (req, res) => {
  res.json({ purchases: await P.purchasesForContact(req.params.id) });
});

router.post('/contacts/:id/purchases', requireAuth, requireCrmRole('manage_purchases'), async (req, res) => {
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

  const purchases = (await attachPurchaseDetails(rows, { excludeAdminSeats: true })).map(p => ({
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

  // hasActiveLicense() is re-checked fresh on every request, so license-
  // gated content is cut off the instant the seats cascade-delete below —
  // but every affected teacher's existing fn_user_session cookie (up to 30
  // days) would otherwise stay valid for anything that isn't license-gated.
  const [registeredTeachers] = await pool.query(
    "SELECT DISTINCT registered_site_user_id FROM license_seats WHERE purchase_id IN (?) AND registered_site_user_id IS NOT NULL",
    [ids]
  );

  await pool.query('DELETE FROM purchases WHERE id IN (?)', [ids]);

  if (registeredTeachers.length) {
    await pool.query(
      'UPDATE site_users SET session_invalidated_at = NOW() WHERE id IN (?)',
      [registeredTeachers.map(r => r.registered_site_user_id)]
    );
  }

  res.json({ ok: true, deleted: ids.length });
});

// Lets the admin correct notes/source on any purchase, and grow or shrink a
// group license's seat count after the fact. Shrinking only ever removes
// still-open ('pending') seats — a seat a teacher has already claimed is
// never touched here (use the unregister endpoint below to free one first).
router.put('/purchases/:id', requireAuth, async (req, res) => {
  const r = await P.updatePurchase(req.params.id, req.body);
  res.status(r.status).json(r.body);
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

  // Same reasoning as the seat-unregister and delete-by-domain routes above:
  // hasActiveLicense() denies access immediately either way, but a
  // suspended/cancelled license can span every registered seat on a group
  // purchase at once — the widest-blast-radius case of the same gap if
  // sessions aren't invalidated too.
  if (licenseStatus === 'suspended' || licenseStatus === 'cancelled') {
    const [registeredTeachers] = await pool.query(
      "SELECT DISTINCT registered_site_user_id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id IS NOT NULL",
      [rows[0].id]
    );
    if (registeredTeachers.length) {
      await pool.query(
        'UPDATE site_users SET session_invalidated_at = NOW() WHERE id IN (?)',
        [registeredTeachers.map(r => r.registered_site_user_id)]
      );
    }
  }

  // Renewing an expired license: the nightly expiry job switched every seat off, so switch back on the ones it
  // turned off. Seats a school admin deactivated by hand carry no expiry tag and stay off.
  let seatsRestored = 0;
  if (RENEWED_STATUSES.includes(licenseStatus)) {
    seatsRestored = await restoreExpiredSeats(pool, rows[0].id);
  }

  const adminId = req.session && req.session.userId ? req.session.userId : null;
  pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, action, entity_type, entity_id)
     VALUES ('admin', ?, 'license_dates_updated', 'purchase', ?)`,
    [adminId, rows[0].id]
  ).catch(e => console.error('audit log error:', e.message));
  if (seatsRestored) {
    pool.query(
      `INSERT INTO school_audit_log (actor_type, actor_id, action, entity_type, entity_id)
       VALUES ('admin', ?, 'seats_restored_on_renewal', 'purchase', ?)`,
      [adminId, rows[0].id]
    ).catch(e => console.error('audit log error:', e.message));
  }

  res.json({ ok: true, licenseStatus, seatsRestored });
});

router.delete('/purchases/:id', requireAuth, requireCrmRole('manage_purchases'), async (req, res) => {
  const r = await P.deletePurchase(req.params.id);
  res.status(r.status).json(r.body);
});

// The three seat actions (assign an email, register directly, free a seat) live in lib/purchases.js, shared with the merged Contacts screen.
router.put('/purchases/:purchaseId/seats/:seatId', requireAuth, requireCrmRole('manage_purchases'), async (req, res) => {
  const r = await P.assignSeatEmail(req.params.purchaseId, req.params.seatId, req.body && req.body.invitedEmail);
  res.status(r.status).json(r.body);
});
router.post('/purchases/:purchaseId/seats/:seatId/register', requireAuth, requireCrmRole('manage_purchases'), async (req, res) => {
  const r = await P.registerSeat(req.params.purchaseId, req.params.seatId, req.body && req.body.email);
  res.status(r.status).json(r.body);
});
router.post('/purchases/:purchaseId/seats/:seatId/unregister', requireAuth, requireCrmRole('manage_purchases'), async (req, res) => {
  const r = await P.unregisterSeat(req.params.purchaseId, req.params.seatId);
  res.status(r.status).json(r.body);
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

// Bulk import — rows already parsed client-side from CSV. Upserts by email
// (matching the same convention as the one-off server/scripts/import-contacts-csv.js):
// an existing contact's blank fields get filled in from the CSV, but a
// value it already has is never overwritten, and status/source/signup_date
// are never touched — a contact may have unsubscribed through our own
// site, and a bulk import shouldn't silently resubscribe or relabel them.
// Group membership (row.groups, an array of group names) is always additive
// for both new and existing contacts — an import never removes a contact
// from a group it wasn't mentioned for.
router.post('/contacts/import', requireAuth, requireCrmRole('write'), async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  const defaultSource = (req.body && req.body.defaultSource) || 'Bulk Import';
  const createMissingGroups = !!(req.body && req.body.createMissingGroups);

  const [existingRows] = await pool.query('SELECT id, email FROM newsletter_contacts');
  const existingIdByEmail = new Map(existingRows.map(r => [r.email.toLowerCase(), r.id]));

  // Resolve every group name referenced across all rows up front, so the
  // per-row loop below is just a lookup, not a create-on-the-fly.
  const [groupRows] = await pool.query('SELECT id, name FROM contact_groups');
  const groupIdByName = new Map(groupRows.map(g => [g.name.toLowerCase(), g.id]));
  const allGroupNames = new Set(rows.flatMap(r => Array.isArray(r.groups) ? r.groups : []));
  const missingGroupNames = Array.from(allGroupNames).filter(n => !groupIdByName.has(n.toLowerCase()));

  const groupsCreated = [];
  const groupsSkipped = [];
  if (missingGroupNames.length) {
    if (createMissingGroups) {
      for (const name of missingGroupNames) {
        try {
          const [result] = await pool.query('INSERT INTO contact_groups (name) VALUES (?)', [name]);
          groupIdByName.set(name.toLowerCase(), result.insertId);
          groupsCreated.push(name);
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') throw err;
          const [[existingGroup]] = await pool.query('SELECT id FROM contact_groups WHERE name = ?', [name]);
          if (existingGroup) groupIdByName.set(name.toLowerCase(), existingGroup.id);
        }
      }
    } else {
      groupsSkipped.push(...missingGroupNames);
    }
  }

  let imported = 0, updated = 0, skippedInvalid = 0;
  for (const row of rows) {
    const email = (row.email || '').trim();
    if (!email || !EMAIL_PATTERN.test(email)) { skippedInvalid++; continue; }

    const groupIds = (Array.isArray(row.groups) ? row.groups : [])
      .map(name => groupIdByName.get(name.toLowerCase()))
      .filter(Boolean);

    const existingId = existingIdByEmail.get(email.toLowerCase());
    if (existingId) {
      await pool.query(
        `UPDATE newsletter_contacts SET
           name = COALESCE(NULLIF(name, ''), ?),
           phone = COALESCE(NULLIF(phone, ''), ?),
           company = COALESCE(NULLIF(company, ''), ?),
           street = COALESCE(NULLIF(street, ''), ?),
           city = COALESCE(NULLIF(city, ''), ?),
           state = COALESCE(NULLIF(state, ''), ?),
           zip = COALESCE(NULLIF(zip, ''), ?),
           notes = COALESCE(NULLIF(notes, ''), ?)
         WHERE id = ?`,
        [row.name || '', row.phone || '', row.company || '', row.street || '', row.city || '', row.state || '', row.zip || '', row.notes || '', existingId]
      );
      if (groupIds.length) {
        await pool.query(
          'INSERT IGNORE INTO contact_group_members (contact_id, group_id) VALUES ?',
          [groupIds.map(gid => [existingId, gid])]
        );
      }
      updated++;
      continue;
    }

    const parsedSignupDate = row.signupDate ? new Date(row.signupDate) : null;
    const signupDate = parsedSignupDate && !isNaN(parsedSignupDate.getTime()) ? parsedSignupDate : new Date();

    const [result] = await pool.query(
      'INSERT INTO newsletter_contacts (name, email, phone, company, street, city, state, zip, signup_date, source, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [row.name || '', email, row.phone || '', row.company || '', row.street || '', row.city || '', row.state || '', row.zip || '', signupDate, row.source || defaultSource, 'Subscribed', row.notes || '']
    );
    existingIdByEmail.set(email.toLowerCase(), result.insertId);
    if (groupIds.length) {
      await pool.query(
        'INSERT IGNORE INTO contact_group_members (contact_id, group_id) VALUES ?',
        [groupIds.map(gid => [result.insertId, gid])]
      );
    }
    imported++;
  }

  res.json({ imported, updated, skippedInvalid, groupsCreated, groupsSkipped });
});

module.exports = { router };
