// Purchases and license seats: reading them, creating one, changing one, deleting one, and the three seat actions (assign an email, register directly, free a seat).
// One copy, shared by the older CRM routes (routes/newsletter.js, which also exports createPurchase and attachPurchaseDetails for checkout, quote acceptance, sign-up and invoices)
// and the merged Contacts screen (routes/contact-screens.js), so the rules cannot drift apart (docs/reference/contact-pages-merge-requirements.md, phase 4).
// The route-shaped functions at the bottom return { status, body } and touch no req or res.
const pool = require('../db/pool');
const { fireAutomation } = require('./automations');
const { attributePurchase } = require('./affiliate-attribution');
const { notAdminSeatClause } = require('./seat-counts');
const { claimForAccountByEmail } = require('./own-seat-claim');
const crmHooks = require('./crm-hooks'); // Sales CRM: re-derive Suspect / Prospect / Customer after a purchase changes (never throws; off unless crm_v2_enabled)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Auto-assigns a contact to the correct system group(s) based on what they
// just purchased. Safe to call repeatedly — INSERT IGNORE prevents duplicates.
async function assignContactToGroups(contactId, { productType, licenseProductId }) {
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
  } else if (productType === 'book') {
    const [[cg]] = await pool.query("SELECT id FROM contact_groups WHERE system_key = 'consumer'");
    if (cg) groupIds.add(cg.id);
  }

  for (const id of groupIds) {
    await pool.query('INSERT IGNORE INTO contact_group_members (contact_id, group_id) VALUES (?, ?)', [contactId, id]);
  }
}


const PRODUCT_TYPES = ['book', 'single_license', 'group_license'];

// Strips a leading "@" and stray whitespace/casing so "@Lincoln.edu" and
// "lincoln.edu " both save and search as the same domain.
function normalizeDomain(domain) {
  return (domain || '').trim().replace(/^@/, '').toLowerCase();
}

// Every group-license purchase's school_domain must have a matching schools
// row + purchases.school_id, or branding (server/lib/branding.js) can't
// resolve a school for it. schools.domain is UNIQUE, so INSERT IGNORE is
// safe under concurrent callers racing on the same new domain.
async function findOrCreateSchoolId(domain, conn = pool) {
  if (!domain) return null;
  await conn.query('INSERT IGNORE INTO schools (domain) VALUES (?)', [domain]);
  const [[row]] = await conn.query('SELECT id FROM schools WHERE domain = ?', [domain]);
  return row ? row.id : null;
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

// excludeAdminSeats drops any seat registered to someone who's also an
// active school_license_admins/district_license_admins row — admins don't
// consume a license and shouldn't appear in admin-facing seat counts/rosters.
// Left off by default (e.g. a buyer's own self-service my-purchases view
// should still show their own seat even if they're also an admin).
async function attachPurchaseDetails(purchases, { excludeAdminSeats } = {}) {
  if (purchases.length === 0) return purchases;
  const ids = purchases.map(p => p.id);
  const bookIds = purchases.map(p => p.book_id).filter(Boolean);
  const licenseProductIds = purchases.map(p => p.license_product_id).filter(Boolean);

  const [seatRows] = await pool.query(
    `SELECT s.*, u.first_name, u.last_name FROM license_seats s
     LEFT JOIN site_users u ON u.id = s.registered_site_user_id
     WHERE s.purchase_id IN (?)
     ${excludeAdminSeats ? `AND ${notAdminSeatClause('s')}` : ''}
     ORDER BY s.id`,
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

  // Each purchase's invoice, with its Ship To in one line, so the Licenses page can show it and link to the Bill To / Ship To editor.
  const invoiceIds = [...new Set(purchases.map(p => p.invoice_id).filter(Boolean))];
  const [invoiceRows] = invoiceIds.length
    ? await pool.query('SELECT id, invoice_number, ship_to_name, ship_to_company, ship_to_street, ship_to_city, ship_to_state, ship_to_zip FROM invoices WHERE id IN (?)', [invoiceIds])
    : [[]];
  const invoiceById = {};
  invoiceRows.forEach(i => {
    const cityLine = [[i.ship_to_city, i.ship_to_state].filter(Boolean).join(', '), i.ship_to_zip].filter(Boolean).join(' ');
    invoiceById[i.id] = { number: i.invoice_number, shipTo: [i.ship_to_company || i.ship_to_name, i.ship_to_street, cityLine].filter(Boolean).join(', ') };
  });

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
    seatCount: p.seat_count,
    purchasedAt: p.purchased_at,
    source: p.source,
    notes: p.notes,
    schoolDomain: p.school_domain,
    paymentMethod: p.payment_method,
    paymentStatus: p.payment_status,
    poNumber: p.po_number,
    invoiceId: p.invoice_id,
    invoiceNumber: p.invoice_id && invoiceById[p.invoice_id] ? invoiceById[p.invoice_id].number : null,
    shipToSummary: p.invoice_id && invoiceById[p.invoice_id] ? invoiceById[p.invoice_id].shipTo : '',
    amount: p.amount_cents === null ? null : Number(p.amount_cents) / 100,
    licenseStatus: p.license_status || 'active',
    effectiveDate: p.effective_date ? new Date(p.effective_date).toISOString().slice(0, 10) : null,
    expirationDate: p.expiration_date ? new Date(p.expiration_date).toISOString().slice(0, 10) : null,
    licenseDurationDays: p.license_duration_days || null,
    isTrial: !!(p.trial_lesson_limit),
    trialExpirationDate: p.trial_expiration_date ? new Date(p.trial_expiration_date).toISOString() : null,
    trialLessonLimit: p.trial_lesson_limit || null,
    trialLibraryLimit: p.trial_library_limit || null,
    conversionCreditCents: p.conversion_credit_cents || null,
    conversionCreditRedeemedAt: p.conversion_credit_redeemed_at ? new Date(p.conversion_credit_redeemed_at).toISOString() : null,
    convertedToPurchaseId: p.converted_to_purchase_id || null,
    quoteId: p.quote_id || null,
    quoteNumber: p.quote_number || null,
    seats: seatsByPurchase[p.id] || [],
  }));
}

// Shared by the admin's manual "add a purchase" endpoint below and the real
// Stripe/PO checkout flows (server/routes/checkout.js) — all need the exact
// same purchase + seat-creation behavior, just from different sources.
async function createPurchase(contactId, { productType, bookId, licenseProductId, seatCount, source, notes, stripeSessionId, stripeInvoiceId, schoolDomain, paymentMethod, paymentStatus, poNumber, invoiceId, amountCents, trialExpirationDate, trialLessonLimit, trialLibraryLimit, conversionCreditCents, quoteId, licenseDurationDaysOverride, skipThankYouAutomation, affiliateRefCode, autoClaimEmail, connection: outerConnection, afterCommit }) {
  const finalSeatCount = productType === 'single_license' ? 1 : productType === 'group_license' ? Number(seatCount) : null;

  const normalizedDomain = productType === 'group_license' ? normalizeDomain(schoolDomain) || null : null;
  const finalLicenseProductId = (productType === 'group_license' || productType === 'single_license') ? licenseProductId || null : null;

  // A caller that needs the purchase to be part of a bigger all-or-nothing step (quote acceptance by PO, routes/quote-accept.js) passes its own open
  // transaction as `connection`, and an `afterCommit` array. Then this function neither begins, commits, rolls back nor releases (the caller does),
  // and the work that must only happen once the purchase is really saved (claiming the buyer's seat, the CRM hook, the group assignment) is pushed
  // onto `afterCommit` for the caller to run after its own commit. Without them nothing changes: it owns its transaction, as before.
  const ownsTransaction = !outerConnection;
  const connection = outerConnection || await pool.getConnection();
  try {
    if (ownsTransaction) await connection.beginTransaction();
    const schoolId = await findOrCreateSchoolId(normalizedDomain, connection);

    // Snapshot the intended license length at purchase time (never affected
    // by a later catalog change) — skipped entirely for trial purchases,
    // which use their own separate trial_expiration_date/trial_days concept.
    let licenseDurationDays = null;
    if (!trialExpirationDate && finalLicenseProductId) {
      if (licenseDurationDaysOverride != null) {
        licenseDurationDays = Number(licenseDurationDaysOverride) || null;
      } else {
        const [[lp]] = await connection.query('SELECT duration_days FROM license_products WHERE id = ?', [finalLicenseProductId]);
        licenseDurationDays = lp && lp.duration_days ? Number(lp.duration_days) : null;
      }
    }

    // A PO purchase stays 'pending' until an admin marks it received (see
    // server/routes/invoices.js po-received) — effective/expiration dates
    // are computed there instead, anchored to the real activation date, not
    // the order-submission date. Every other path (card, manual) is active
    // immediately, so the license term starts today.
    let effectiveDate = null, expirationDate = null;
    if (licenseDurationDays && paymentMethod !== 'po') {
      effectiveDate = new Date();
      expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + licenseDurationDays);
    }

    const [result] = await connection.query(
      `INSERT INTO purchases (contact_id, product_type, book_id, license_product_id, seat_count, source, notes, stripe_session_id, stripe_invoice_id, school_domain, school_id, payment_method, payment_status, po_number, invoice_id, amount_cents, trial_expiration_date, trial_lesson_limit, trial_library_limit, conversion_credit_cents, quote_id, license_duration_days, effective_date, expiration_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contactId, productType, productType === 'book' ? bookId : null,
        finalLicenseProductId,
        finalSeatCount, source || 'Manual Entry', notes || '', stripeSessionId || null, stripeInvoiceId || null,
        normalizedDomain, schoolId,
        paymentMethod || 'manual', paymentStatus || 'paid', poNumber || null,
        invoiceId || null, amountCents === undefined ? null : amountCents,
        trialExpirationDate || null, trialLessonLimit || null, trialLibraryLimit || null, conversionCreditCents || null,
        quoteId || null, licenseDurationDays, effectiveDate, expirationDate,
      ]
    );
    const purchaseId = result.insertId;

    // Affiliate attribution, inside the same transaction as the purchase it
    // belongs to. Only the buyer-facing paths pass a code (card checkout, PO
    // checkout, quote acceptance); the admin's manual "add a purchase" form
    // deliberately doesn't, since the cookie in that request is a staff
    // member's browsing history, not a referral. An unknown or suspended
    // code is a silent no-op — the sale simply goes unattributed.
    // paymentStatus decides whether the ledger entry opens approved (card —
    // already paid) or pending (PO — awaiting the school's business office).
    if (affiliateRefCode) {
      await attributePurchase(connection, purchaseId, affiliateRefCode, amountCents, paymentStatus || 'paid');
    }

    let ownSeatEmail = null; // the buyer's own seat, held 'pending' for them; claimed for an existing account after the commit
    if (productType === 'single_license') {
      const [contactRows] = await connection.query('SELECT email FROM newsletter_contacts WHERE id = ?', [contactId]);
      ownSeatEmail = contactRows[0].email;
      await connection.query(
        'INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, ?)',
        [purchaseId, contactRows[0].email, 'pending']
      );
    } else if (productType === 'group_license') {
      // A multi-seat TRIAL still auto-claims one seat for the buyer
      // themselves, same as a single_license trial always has -- otherwise
      // the buyer ends up with an active purchase and zero actual access
      // until someone manually invites them into their own seat. The rest
      // of the seats (if any) start 'available', same as any group license.
      if (autoClaimEmail) {
        ownSeatEmail = autoClaimEmail;
        const availableCount = finalSeatCount - 1;
        const values = [purchaseId, autoClaimEmail, 'pending'];
        let sql = 'INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, ?)';
        if (availableCount > 0) {
          sql += ', ' + Array(availableCount).fill('(?, NULL, ?)').join(', ');
          for (let i = 0; i < availableCount; i++) values.push(purchaseId, 'available');
        }
        await connection.query(sql, values);
      } else {
        await connection.query(
          'INSERT INTO license_seats (purchase_id, invited_email, status) VALUES ' + Array(finalSeatCount).fill('(?, NULL, ?)').join(', '),
          Array.from({ length: finalSeatCount }).flatMap(() => [purchaseId, 'available'])
        );
      }
    }
    if (ownsTransaction) await connection.commit();

    // Everything below runs only once the purchase is really saved: now when this function owns the transaction, or after the caller's commit.
    const afterSave = async () => {
      // A buyer who already has an account (signed up earlier, or signed in before paying) never goes through the sign-up that
      // claims a pending seat, so claim it here (lib/own-seat-claim.js). A new account claims it when it is created.
      if (ownSeatEmail) await claimForAccountByEmail(pool, ownSeatEmail);
      await crmHooks.contactChanged(contactId);

      // Automated thank-you email — best-effort (fireAutomation swallows its
      // own errors), so a template/lookup issue here never fails the purchase
      // itself. Only book purchases get one; license purchases are covered by
      // the invoice-paid and seat-invite automations instead, since a
      // single PO order can create several license purchase rows and would otherwise
      // flood the buyer with one thank-you per line item.
      if (!skipThankYouAutomation && productType === 'book') {
        try {
          const [[contact]] = await pool.query('SELECT email, name FROM newsletter_contacts WHERE id = ?', [contactId]);
          const firstName = (contact.name || '').split(' ')[0] || 'there';
          const [[book]] = await pool.query('SELECT title FROM books WHERE id = ?', [bookId]);
          await fireAutomation('book_purchase_thank_you', {
            to: contact.email,
            mergeFields: { firstName, bookTitle: book ? book.title : 'your book' },
          });
        } catch (err) {
          console.error('Thank-you automation lookup failed:', err.message);
        }
      }

      // Auto-assign contact to system user groups based on what they bought.
      // Best-effort — a missing system_key row never blocks the purchase.
      try {
        await assignContactToGroups(contactId, { productType, licenseProductId: licenseProductId || null });
      } catch (e) { console.error('assignContactToGroups failed:', e.message); }
    };
    if (ownsTransaction) await afterSave();
    else if (Array.isArray(afterCommit)) afterCommit.push(afterSave);
    else throw new Error('createPurchase: a caller-supplied connection needs an afterCommit array');

    return purchaseId;
  } catch (err) {
    if (ownsTransaction) await connection.rollback();
    throw err;
  } finally {
    if (ownsTransaction) connection.release();
  }
}

// ---- Route-shaped actions -----------------------------------------------------------------------------------------------------------------------------------------------

async function purchasesForContact(contactId) {
  const [rows] = await pool.query('SELECT * FROM purchases WHERE contact_id = ? ORDER BY purchased_at DESC', [contactId]);
  return attachPurchaseDetails(rows, { excludeAdminSeats: true });
}

// Change a purchase: notes, source, payment status, PO number, and for a group license the school domain and the seat count (seats a teacher has claimed are never touched;
// the count cannot go below them). Seats are added as 'available' or the open ones removed to match.
async function updatePurchase(id, b) {
  b = b || {};
  const [rows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [id]);
  const purchase = rows[0];
  if (!purchase) return { status: 404, body: { error: 'Purchase not found' } };

  const notes = b.notes !== undefined ? b.notes : purchase.notes;
  const source = b.source !== undefined ? b.source : purchase.source;
  const paymentStatus = b.paymentStatus !== undefined ? b.paymentStatus : purchase.payment_status;
  const poNumber = b.poNumber !== undefined ? b.poNumber : purchase.po_number;
  const schoolDomain = purchase.product_type === 'group_license'
    ? (b.schoolDomain !== undefined ? normalizeDomain(b.schoolDomain) || null : purchase.school_domain)
    : purchase.school_domain;
  const schoolId = purchase.product_type === 'group_license'
    ? await findOrCreateSchoolId(schoolDomain)
    : purchase.school_id;

  if (purchase.product_type === 'group_license' && b.seatCount !== undefined) {
    const newCount = Number(b.seatCount);
    if (!(newCount > 0)) return { status: 400, body: { error: 'seatCount must be a positive number' } };

    const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE purchase_id = ?', [purchase.id]);
    const registeredCount = seatRows.filter(s => s.status === 'registered').length;
    if (newCount < registeredCount) {
      return { status: 400, body: { error: `Cannot reduce below ${registeredCount} seats already in use — free some up first` } };
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'UPDATE purchases SET seat_count = ?, notes = ?, source = ?, school_domain = ?, school_id = ?, payment_status = ?, po_number = ? WHERE id = ?',
        [newCount, notes, source, schoolDomain, schoolId, paymentStatus, poNumber, purchase.id]
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
      'UPDATE purchases SET notes = ?, source = ?, school_domain = ?, school_id = ?, payment_status = ?, po_number = ? WHERE id = ?',
      [notes, source, schoolDomain, schoolId, paymentStatus, poNumber, purchase.id]
    );
  }

  await crmHooks.purchaseChanged(purchase.id);
  const [updatedRows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [purchase.id]);
  const [purchase2] = await attachPurchaseDetails(updatedRows, { excludeAdminSeats: true });
  return { status: 200, body: { purchase: purchase2 } };
}

// Delete a purchase (its license seats go with it). The person's Customer label is re-derived afterwards, because it may no longer have a qualifying purchase.
async function deletePurchase(id) {
  const [[p]] = await pool.query('SELECT contact_id FROM purchases WHERE id = ?', [id]);
  const [result] = await pool.query('DELETE FROM purchases WHERE id = ?', [id]);
  if (result.affectedRows === 0) return { status: 404, body: { error: 'Purchase not found' } };
  if (p) await crmHooks.contactChanged(p.contact_id);
  return { status: 200, body: { ok: true } };
}

// Assign (or clear) the invited email for one seat of a group license. Only open ('pending') seats can be reassigned: once a teacher has registered, the seat is theirs.
async function assignSeatEmail(purchaseId, seatId, rawEmail) {
  const [rows] = await pool.query('SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?', [seatId, purchaseId]);
  const seat = rows[0];
  if (!seat) return { status: 404, body: { error: 'Seat not found' } };
  if (seat.status !== 'pending') return { status: 409, body: { error: 'This seat has already been registered and cannot be reassigned' } };

  const invitedEmail = (rawEmail || '').trim();
  if (invitedEmail && !EMAIL_PATTERN.test(invitedEmail)) return { status: 400, body: { error: 'Invalid email address' } };
  await pool.query('UPDATE license_seats SET invited_email = ? WHERE id = ?', [invitedEmail || null, seat.id]);

  // Only fire on an actual change to a new email: re-saving the same invited address shouldn't re-send the invite every time.
  if (invitedEmail && invitedEmail !== seat.invited_email) {
    try {
      const [[purchase]] = await pool.query('SELECT license_product_id, school_domain FROM purchases WHERE id = ?', [purchaseId]);
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
  return { status: 200, body: { ok: true } };
}

// Directly links a seat to an existing site_user account by email, bypassing the normal "sign up with the invited email" flow: for handing a seat to someone who already has an
// account under a different invited address, or fixing a signup that didn't get auto-claimed correctly.
async function registerSeat(purchaseId, seatId, rawEmail) {
  const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?', [seatId, purchaseId]);
  const seat = seatRows[0];
  if (!seat) return { status: 404, body: { error: 'Seat not found' } };

  const email = (rawEmail || '').trim();
  if (!email) return { status: 400, body: { error: 'Email is required' } };

  const [userRows] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email]);
  if (!userRows[0]) {
    return { status: 404, body: { error: 'No account exists with that email yet — ask them to sign up first, or save it as the invited email instead.' } };
  }

  await pool.query(
    "UPDATE license_seats SET status = 'registered', invited_email = ?, registered_site_user_id = ?, registered_at = NOW() WHERE id = ?",
    [email, userRows[0].id, seat.id]
  );
  return { status: 200, body: { ok: true } };
}

// Frees a claimed seat back to 'pending' without touching the customer's account: use this instead of deleting the whole site_user when you just need to reassign one seat.
async function unregisterSeat(purchaseId, seatId) {
  const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?', [seatId, purchaseId]);
  const seat = seatRows[0];
  if (!seat) return { status: 404, body: { error: 'Seat not found' } };

  await pool.query(
    "UPDATE license_seats SET status = 'pending', registered_site_user_id = NULL, registered_at = NULL WHERE id = ?",
    [seat.id]
  );
  // hasActiveLicense() is re-checked fresh on every request, so license-gated content is already cut off immediately, but without this the teacher's existing
  // fn_user_session cookie (up to 30 days) stays valid for anything that ISN'T license-gated (classroom/roster management, brain games).
  if (seat.registered_site_user_id) {
    await pool.query('UPDATE site_users SET session_invalidated_at = NOW() WHERE id = ?', [seat.registered_site_user_id]);
  }
  return { status: 200, body: { ok: true } };
}

module.exports = {
  PRODUCT_TYPES, normalizeDomain, findOrCreateSchoolId, toSqlLike, attachPurchaseDetails, createPurchase, assignContactToGroups,
  purchasesForContact, updatePurchase, deletePurchase, assignSeatEmail, registerSeat, unregisterSeat,
};
