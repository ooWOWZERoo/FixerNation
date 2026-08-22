// Seeds every account the Playwright e2e suite (tests/e2e/) needs to sign in
// as: a licensed teacher, an unlicensed teacher, a Morning Boost member, a
// school license admin, a plain teacher with a classroom, a student in that
// classroom, and a parent linked to that classroom. Safe to re-run — every
// insert is idempotent (checks for an existing row by email/username first,
// or uses INSERT IGNORE on a unique key).
//
// All accounts use the password/PIN below unless already seeded with a
// different one on a prior run. Run once, then copy the printed values into
// tests/.env.test.
//
// Usage (from server/, with nodevenv activated in production):
//   node scripts/seed-qa-test-accounts.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const QA_PASSWORD = 'QaTest!2026';
const QA_PIN = '135790';

async function findOrCreateSiteUser(conn, { email, firstName, lastName, role }) {
  const [[existing]] = await conn.query('SELECT id, role FROM site_users WHERE email = ?', [email]);
  if (existing) {
    if (role && existing.role !== role) {
      await conn.query('UPDATE site_users SET role = ? WHERE id = ?', [role, existing.id]);
    }
    return existing.id;
  }
  const passwordHash = await bcrypt.hash(QA_PASSWORD, 10);
  const [result] = await conn.query(
    `INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [firstName, lastName, email, passwordHash, role || 'teacher']
  );
  return result.insertId;
}

async function findOrCreateContact(conn, { email, name }) {
  const [[existing]] = await conn.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (existing) return existing.id;
  const [result] = await conn.query(
    `INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'QA Seed', 'Subscribed')`,
    [name, email]
  );
  return result.insertId;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const out = { password: QA_PASSWORD, pin: QA_PIN };

  // --- Licensed site user -----------------------------------------------
  const licensedEmail = 'qa-licensed@example.com';
  const licensedContactId = await findOrCreateContact(conn, { email: licensedEmail, name: 'QA Licensed' });
  const licensedUserId = await findOrCreateSiteUser(conn, {
    email: licensedEmail, firstName: 'QA', lastName: 'Licensed', role: 'teacher',
  });
  const [[licenseProduct]] = await conn.query(
    "SELECT id FROM license_products WHERE active = 1 ORDER BY id LIMIT 1"
  );

  // --- Dedicated QA test license product ----------------------------------
  // A stable, purpose-built product for checkout/PO/quote e2e tests, instead
  // of "whatever's currently active" — the real catalog's call_for_quote
  // flags change over time (every group tier is quote-only as of this
  // writing), which broke cart.spec.ts once already. active=0 hides it from
  // the public catalog (GET /api/license-products for anonymous filters on
  // active=1) but doesn't block checkout — resolveCartItems() in
  // checkout.js never filters by active, only the public listing does.
  const QA_LICENSE_PRODUCT_NAME = '[QA] Test License';
  const [[existingQaProduct]] = await conn.query('SELECT id FROM license_products WHERE name = ?', [QA_LICENSE_PRODUCT_NAME]);
  let qaLicenseProductId;
  if (existingQaProduct) {
    qaLicenseProductId = existingQaProduct.id;
    await conn.query(
      "UPDATE license_products SET seat_count = 5, price_cents = 10000, call_for_quote = 0, variable_seats = 0, active = 0 WHERE id = ?",
      [qaLicenseProductId]
    );
  } else {
    const [r] = await conn.query(
      `INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, variable_seats, active, sort_order)
       VALUES (?, 'Internal QA fixture — not a real product. Do not display or sell.', 5, 10000, 0, 0, 0, 999)`,
      [QA_LICENSE_PRODUCT_NAME]
    );
    qaLicenseProductId = r.insertId;
  }
  out.qaLicenseProductId = qaLicenseProductId;

  if (!licenseProduct) {
    console.warn('No active license_products row found — skipping license seat setup. Run scripts/seed-license-products.js first.');
  } else {
    let [[purchase]] = await conn.query(
      "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND license_product_id = ?",
      [licensedContactId, licenseProduct.id]
    );
    let purchaseId = purchase && purchase.id;
    if (!purchaseId) {
      const [result] = await conn.query(
        `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status)
         VALUES (?, 'group_license', ?, 1, 'QA Seed', 'manual', 'paid')`,
        [licensedContactId, licenseProduct.id]
      );
      purchaseId = result.insertId;
    }
    const [[seat]] = await conn.query(
      "SELECT id FROM license_seats WHERE registered_site_user_id = ?",
      [licensedUserId]
    );
    if (!seat) {
      await conn.query(
        `INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at)
         VALUES (?, ?, 'registered', ?, NOW())`,
        [purchaseId, licensedEmail, licensedUserId]
      );
    }
  }
  out.siteUserLicensed = licensedEmail;

  // --- Unlicensed site user ----------------------------------------------
  const unlicensedEmail = 'qa-unlicensed@example.com';
  await findOrCreateSiteUser(conn, {
    email: unlicensedEmail, firstName: 'QA', lastName: 'Unlicensed', role: 'teacher',
  });
  out.siteUserUnlicensed = unlicensedEmail;

  // --- Morning Boost member ----------------------------------------------
  const memberEmail = 'qa-member@example.com';
  const memberContactId = await findOrCreateContact(conn, { email: memberEmail, name: 'QA Member' });
  await findOrCreateSiteUser(conn, {
    email: memberEmail, firstName: 'QA', lastName: 'Member', role: 'teacher',
  });
  const [[membershipPlan]] = await conn.query(
    "SELECT id FROM membership_plans WHERE active = 1 ORDER BY id LIMIT 1"
  );
  if (!membershipPlan) {
    console.warn('No active membership_plans row found — skipping membership setup. Run scripts/seed-membership-plans.js first.');
  } else {
    const [[existingMembership]] = await conn.query(
      "SELECT id FROM contact_memberships WHERE contact_id = ? AND status IN ('trialing','active')",
      [memberContactId]
    );
    if (!existingMembership) {
      await conn.query(
        `INSERT INTO contact_memberships (contact_id, membership_plan_id, status) VALUES (?, ?, 'active')`,
        [memberContactId, membershipPlan.id]
      );
    }
  }
  out.member = memberEmail;

  // --- School license admin ----------------------------------------------
  const schoolAdminEmail = 'qa-school-admin@example.com';
  const schoolAdminContactId = await findOrCreateContact(conn, { email: schoolAdminEmail, name: 'QA School Admin' });
  const schoolAdminUserId = await findOrCreateSiteUser(conn, {
    email: schoolAdminEmail, firstName: 'QA', lastName: 'SchoolAdmin', role: 'school_license_admin',
  });
  let saPurchaseId;
  if (licenseProduct) {
    let [[saPurchase]] = await conn.query(
      "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND license_product_id = ?",
      [schoolAdminContactId, licenseProduct.id]
    );
    saPurchaseId = saPurchase && saPurchase.id;
    if (!saPurchaseId) {
      const [result] = await conn.query(
        `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain)
         VALUES (?, 'group_license', ?, 10, 'QA Seed', 'manual', 'paid', 'qa-school.example.com')`,
        [schoolAdminContactId, licenseProduct.id]
      );
      saPurchaseId = result.insertId;
    }
    await conn.query(
      `INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
       VALUES (?, ?, 'primary', 1)`,
      [schoolAdminUserId, saPurchaseId]
    );
  } else {
    console.warn('Skipping school_license_admins row — no license_products available for the backing purchase.');
  }
  out.schoolAdmin = schoolAdminEmail;

  // --- Removable teacher, registered under the school admin's own purchase
  // (qa-teacher above has its own unrelated classroom, not this purchase) —
  // used only by the "remove teacher" e2e test. Re-seedable: if a prior test
  // run already revoked this seat, flip it back to registered so the test
  // stays repeatable without needing a fresh account each time.
  if (licenseProduct && typeof saPurchaseId !== 'undefined') {
    const removableEmail = 'qa-removable-teacher@example.com';
    const removableUserId = await findOrCreateSiteUser(conn, {
      email: removableEmail, firstName: 'QA', lastName: 'RemovableTeacher', role: 'teacher',
    });
    const [[removableSeat]] = await conn.query(
      'SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?',
      [saPurchaseId, removableUserId]
    );
    if (removableSeat) {
      await conn.query(
        "UPDATE license_seats SET status = 'registered', revoked_at = NULL, revoked_by = NULL, revocation_reason = NULL WHERE id = ?",
        [removableSeat.id]
      );
    } else {
      await conn.query(
        `INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at)
         VALUES (?, ?, 'registered', ?, NOW())`,
        [saPurchaseId, removableEmail, removableUserId]
      );
    }
    out.removableTeacher = removableEmail;
  }

  // --- Teacher invite acceptance flow, fixed token -------------------------
  // school-invite.spec.ts can't read a real inbox to get the emailed
  // acceptance link, so this pre-seeds a 'pending' invitation with a known,
  // stable token (same reasoning as TEST_QUOTE_VALID_TOKEN below) — the test
  // still drives the real school-invite-accept.html registration UI end to
  // end, only the email-delivery step itself is bridged. Re-seedable: if the
  // account from a prior run wasn't cleaned up (e.g. a failed test), tear it
  // down and reset the seat/invitation back to 'pending' first.
  if (licenseProduct && typeof saPurchaseId !== 'undefined') {
    const inviteEmail = 'qa-invite-teacher@example.com';
    const inviteToken = 'qa-fixed-invite-test-token-0000000000000000000000000000000000000000000000';

    const [[existingInviteUser]] = await conn.query('SELECT id FROM site_users WHERE email = ?', [inviteEmail]);
    if (existingInviteUser) {
      await conn.query('DELETE FROM site_users WHERE id = ?', [existingInviteUser.id]);
    }

    let [[inviteSeat]] = await conn.query(
      'SELECT id FROM license_seats WHERE purchase_id = ? AND invited_email = ?',
      [saPurchaseId, inviteEmail]
    );
    let inviteSeatId;
    if (inviteSeat) {
      inviteSeatId = inviteSeat.id;
      await conn.query(
        "UPDATE license_seats SET status = 'pending', registered_site_user_id = NULL, registered_at = NULL WHERE id = ?",
        [inviteSeatId]
      );
    } else {
      const [r] = await conn.query(
        "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
        [saPurchaseId, inviteEmail]
      );
      inviteSeatId = r.insertId;
    }

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [[existingInv]] = await conn.query('SELECT id FROM school_invitations WHERE token = ?', [inviteToken]);
    if (existingInv) {
      await conn.query(
        "UPDATE school_invitations SET status = 'pending', seat_id = ?, expires_at = ? WHERE id = ?",
        [inviteSeatId, expiresAt, existingInv.id]
      );
    } else {
      await conn.query(
        `INSERT INTO school_invitations (purchase_id, seat_id, invited_email, first_name, last_name, token, status, expires_at)
         VALUES (?, ?, ?, 'QA', 'InviteTest', ?, 'pending', ?)`,
        [saPurchaseId, inviteSeatId, inviteEmail, inviteToken, expiresAt]
      );
    }
    out.inviteToken = inviteToken;
    out.inviteEmail = inviteEmail;
  }

  // --- Accepted quote, fixed token — for quote-accept.spec.ts's regression
  // test of the /api/quotes/accept/invite security fix (single-use + 7-day
  // window). Re-seedable: resets accepted_at to "just now" and clears
  // admin_invited_at every run so the single-use check always starts fresh.
  {
    // quote_requests.accept_token is VARCHAR(64) — a longer literal here gets
    // silently truncated on insert (non-strict SQL mode), causing every
    // lookup by the full string to find nothing. Keep this at exactly 64 chars.
    const quoteAcceptToken = 'qa-fixed-quote-accept-token-0000000000000000000000000000000000';
    const quoteEmail = 'qa-quote-accept@example.com';
    const quoteContactId = await findOrCreateContact(conn, { email: quoteEmail, name: 'QA QuoteAccept' });

    const [[existingQuote]] = await conn.query('SELECT id FROM quote_requests WHERE accept_token = ?', [quoteAcceptToken]);
    let quoteId;
    if (existingQuote) {
      quoteId = existingQuote.id;
      await conn.query(
        "UPDATE quote_requests SET accepted_at = NOW(), admin_invited_at = NULL, status = 'converted' WHERE id = ?",
        [quoteId]
      );
    } else {
      const [r] = await conn.query(
        `INSERT INTO quote_requests (first_name, last_name, email, school, accept_token, accepted_at, accepted_payment_method, status)
         VALUES ('QA', 'QuoteAccept', ?, 'QA Quote School', ?, NOW(), 'po', 'converted')`,
        [quoteEmail, quoteAcceptToken]
      );
      quoteId = r.insertId;
    }

    const [[existingQuotePurchase]] = await conn.query('SELECT id FROM purchases WHERE quote_id = ?', [quoteId]);
    if (!existingQuotePurchase) {
      await conn.query(
        `INSERT INTO purchases (contact_id, product_type, payment_method, payment_status, quote_id)
         VALUES (?, 'group_license', 'po', 'pending', ?)`,
        [quoteContactId, quoteId]
      );
    }
    out.quoteAcceptToken = quoteAcceptToken;
  }

  // --- Fresh, never-quoted quote request — for quote-builder-seat-count
  // .spec.ts's regression test that getQuotePayload() reads seat count from
  // whichever tab (Annual/Pilot/Addon) actually built the quote. Re-seedable:
  // resets any previously-saved quote fields to NULL every run so the
  // builder modal always opens in its pristine, never-quoted state.
  {
    const builderEmail = 'qa-quote-builder@example.com';
    const [[existingBuilderQuote]] = await conn.query('SELECT id FROM quote_requests WHERE email = ?', [builderEmail]);
    let builderQuoteId;
    if (existingBuilderQuote) {
      builderQuoteId = existingBuilderQuote.id;
      await conn.query(
        `UPDATE quote_requests SET status = 'new', quoted_product_id = NULL, quoted_product_name = NULL,
         quoted_tier_name = NULL, quoted_seat_count = NULL, quoted_amount_cents = NULL, quoted_addon_seats = NULL,
         quoted_term_years = NULL, accepted_at = NULL WHERE id = ?`,
        [builderQuoteId]
      );
    } else {
      const [r] = await conn.query(
        `INSERT INTO quote_requests (first_name, last_name, email, school, status)
         VALUES ('QA', 'QuoteBuilder', ?, 'QA Builder School', 'new')`,
        [builderEmail]
      );
      builderQuoteId = r.insertId;
    }
    out.quoteBuilderId = builderQuoteId;
  }

  // --- Unaccepted quote, fixed token — for quote-accept-po-payment-gate
  // .spec.ts's regression test that quote-accepted POs get a real invoice
  // and a pending license, matching the cart PO flow. Re-seedable: wipes any
  // purchase/invoice created by a previous test run and resets the quote
  // back to a fresh 'valid'/unaccepted state every run, since the test
  // itself calls POST /api/quotes/accept.
  if (licenseProduct) {
    const poGateToken = 'qa-fixed-quote-po-gate-token-00000000000000000000000000000000';
    const poGateEmail = 'qa-quote-po-gate@example.com';

    const [[existingPoGateQuote]] = await conn.query('SELECT id FROM quote_requests WHERE accept_token = ?', [poGateToken]);
    let poGateQuoteId;
    if (existingPoGateQuote) {
      poGateQuoteId = existingPoGateQuote.id;
      const [oldPurchases] = await conn.query('SELECT id, invoice_id FROM purchases WHERE quote_id = ?', [poGateQuoteId]);
      const oldInvoiceIds = oldPurchases.map(p => p.invoice_id).filter(Boolean);
      await conn.query('DELETE FROM purchases WHERE quote_id = ?', [poGateQuoteId]);
      if (oldInvoiceIds.length) {
        await conn.query('DELETE FROM invoices WHERE id IN (?)', [oldInvoiceIds]);
      }
      await conn.query(
        `UPDATE quote_requests SET accepted_at = NULL, accepted_payment_method = NULL, admin_invited_at = NULL,
         status = 'sent', quote_valid_until = NULL, quoted_product_id = ?, quoted_product_name = 'QA Gate Product',
         quoted_seat_count = 10, quoted_amount_cents = 5000 WHERE id = ?`,
        [licenseProduct.id, poGateQuoteId]
      );
    } else {
      const [r] = await conn.query(
        `INSERT INTO quote_requests (first_name, last_name, email, school, accept_token, status, quoted_product_id, quoted_product_name, quoted_seat_count, quoted_amount_cents)
         VALUES ('QA', 'PoGate', ?, 'QA Gate School', ?, 'sent', ?, 'QA Gate Product', 10, 5000)`,
        [poGateEmail, poGateToken, licenseProduct.id]
      );
      poGateQuoteId = r.insertId;
    }
    out.quotePoGateToken = poGateToken;
  }

  // --- Session-revocation fixture ------------------------------------------
  // A school_license_admin account dedicated to session-invalidation tests
  // (change-password / reset-password bumping session_invalidated_at, and
  // requireSchoolAdmin now enforcing it too) — never shared with other specs
  // since the test itself changes this account's password. Re-seedable:
  // password_hash and session_invalidated_at are reset every run so the
  // fixture always starts from a known-good, non-revoked state.
  if (licenseProduct) {
    const revokeEmail = 'qa-session-revoke-admin@example.com';
    const revokeContactId = await findOrCreateContact(conn, { email: revokeEmail, name: 'QA SessionRevoke' });
    const revokeUserId = await findOrCreateSiteUser(conn, {
      email: revokeEmail, firstName: 'QA', lastName: 'SessionRevoke', role: 'school_license_admin',
    });
    const revokePasswordHash = await bcrypt.hash(QA_PASSWORD, 10);
    await conn.query('UPDATE site_users SET password_hash = ?, session_invalidated_at = NULL WHERE id = ?', [revokePasswordHash, revokeUserId]);

    const [[existingRevokePurchase]] = await conn.query(
      "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license'",
      [revokeContactId]
    );
    const revokePurchaseId = existingRevokePurchase ? existingRevokePurchase.id : (await conn.query(
      `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain)
       VALUES (?, 'group_license', ?, 5, 'QA Seed', 'manual', 'paid', 'qa-session-revoke.example.com')`,
      [revokeContactId, licenseProduct.id]
    ))[0].insertId;

    await conn.query(
      `INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
       VALUES (?, ?, 'primary', 1)
       ON DUPLICATE KEY UPDATE is_active = 1, permission_level = 'primary'`,
      [revokeUserId, revokePurchaseId]
    );
    out.sessionRevokeEmail = revokeEmail;
  }

  // --- Cross-purchase permission-leak fixture -----------------------------
  // One admin, two purchases: 'read_only' on the OLDER purchase, 'primary' on
  // a NEWER one. requireSchoolAdmin's assignment list is ORDER BY
  // purchased_at DESC, so a fixed bug used assignments[0] (the newer,
  // primary one) as this admin's permission level everywhere, regardless of
  // which purchase a request actually targeted — letting a write against the
  // read_only-on-paper older purchase silently succeed. Re-seedable: resets
  // both permission levels every run in case a previous test run (or a
  // regression) changed them.
  if (licenseProduct) {
    const permLeakEmail = 'qa-permleak-admin@example.com';
    const permLeakContactId = await findOrCreateContact(conn, { email: permLeakEmail, name: 'QA PermLeak' });
    const permLeakUserId = await findOrCreateSiteUser(conn, {
      email: permLeakEmail, firstName: 'QA', lastName: 'PermLeak', role: 'school_license_admin',
    });

    async function findOrCreatePurchase(schoolDomain, purchasedAtSql) {
      const [[existing]] = await conn.query(
        "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND school_domain = ?",
        [permLeakContactId, schoolDomain]
      );
      if (existing) return existing.id;
      const [r] = await conn.query(
        `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain, purchased_at)
         VALUES (?, 'group_license', ?, 10, 'QA Seed', 'manual', 'paid', ?, ${purchasedAtSql})`,
        [permLeakContactId, licenseProduct.id, schoolDomain]
      );
      return r.insertId;
    }

    const olderPurchaseId = await findOrCreatePurchase('qa-permleak-older.example.com', 'NOW() - INTERVAL 30 DAY');
    const newerPurchaseId = await findOrCreatePurchase('qa-permleak-newer.example.com', 'NOW()');

    await conn.query(
      `INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
       VALUES (?, ?, 'read_only', 1)
       ON DUPLICATE KEY UPDATE permission_level = 'read_only', is_active = 1`,
      [permLeakUserId, olderPurchaseId]
    );
    await conn.query(
      `INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
       VALUES (?, ?, 'primary', 1)
       ON DUPLICATE KEY UPDATE permission_level = 'primary', is_active = 1`,
      [permLeakUserId, newerPurchaseId]
    );

    out.permLeakEmail = permLeakEmail;
    out.permLeakOlderPurchaseId = olderPurchaseId;
    out.permLeakNewerPurchaseId = newerPurchaseId;
  }

  // --- Secondary-permission-level fixture (blockIfCannotRevoke regression) -
  // A 'secondary' admin, per admin-school-admins.html's own UI copy, should
  // be able to invite teachers but NOT revoke a seat/invitation. Provides
  // one fixed pending invitation to attempt revoking (should 403) and lets
  // the test send a fresh invite of its own (should succeed). Any
  // invitation/seat a prior test run created on this purchase besides the
  // fixed revoke-target row is wiped on every re-seed, so this stays clean
  // without needing in-test cleanup (a 'secondary' admin can't revoke its
  // own test debris, and no other fixture has write access to this purchase).
  if (licenseProduct) {
    const secondaryEmail = 'qa-secondary-admin@example.com';
    const secondaryContactId = await findOrCreateContact(conn, { email: secondaryEmail, name: 'QA Secondary' });
    const secondaryUserId = await findOrCreateSiteUser(conn, {
      email: secondaryEmail, firstName: 'QA', lastName: 'Secondary', role: 'school_license_admin',
    });

    const [[secExisting]] = await conn.query(
      "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND school_domain = ?",
      [secondaryContactId, 'qa-secondary.example.com']
    );
    let secPurchaseId;
    if (secExisting) {
      secPurchaseId = secExisting.id;
    } else {
      const [r] = await conn.query(
        `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain)
         VALUES (?, 'group_license', ?, 10, 'QA Seed', 'manual', 'paid', 'qa-secondary.example.com')`,
        [secondaryContactId, licenseProduct.id]
      );
      secPurchaseId = r.insertId;
    }

    await conn.query(
      `INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
       VALUES (?, ?, 'secondary', 1)
       ON DUPLICATE KEY UPDATE permission_level = 'secondary', is_active = 1`,
      [secondaryUserId, secPurchaseId]
    );

    const revokeTargetEmail = 'qa-secondary-revoke-target@example.com';
    // Wipe test debris from any prior "secondary can still invite" runs.
    await conn.query('DELETE FROM school_invitations WHERE purchase_id = ? AND invited_email != ?', [secPurchaseId, revokeTargetEmail]);
    await conn.query("DELETE FROM license_seats WHERE purchase_id = ? AND invited_email != ? AND status != 'registered'", [secPurchaseId, revokeTargetEmail]);

    const [[revokeSeat]] = await conn.query(
      'SELECT id FROM license_seats WHERE purchase_id = ? AND invited_email = ?',
      [secPurchaseId, revokeTargetEmail]
    );
    let revokeSeatId;
    if (revokeSeat) {
      revokeSeatId = revokeSeat.id;
      await conn.query("UPDATE license_seats SET status = 'pending' WHERE id = ?", [revokeSeatId]);
    } else {
      const [r] = await conn.query(
        "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
        [secPurchaseId, revokeTargetEmail]
      );
      revokeSeatId = r.insertId;
    }

    const revokeExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [[revokeInv]] = await conn.query(
      'SELECT id FROM school_invitations WHERE purchase_id = ? AND invited_email = ?',
      [secPurchaseId, revokeTargetEmail]
    );
    let revokeInvitationId;
    if (revokeInv) {
      revokeInvitationId = revokeInv.id;
      await conn.query(
        "UPDATE school_invitations SET status = 'pending', seat_id = ?, expires_at = ? WHERE id = ?",
        [revokeSeatId, revokeExpiresAt, revokeInvitationId]
      );
    } else {
      const [r] = await conn.query(
        `INSERT INTO school_invitations (purchase_id, seat_id, invited_email, first_name, last_name, token, status, expires_at)
         VALUES (?, ?, ?, 'QA', 'SecondaryRevokeTarget', ?, 'pending', ?)`,
        [secPurchaseId, revokeSeatId, revokeTargetEmail, crypto.randomBytes(32).toString('hex'), revokeExpiresAt]
      );
      revokeInvitationId = r.insertId;
    }

    out.secondaryAdminEmail = secondaryEmail;
    out.secondaryPurchaseId = secPurchaseId;
    out.secondaryRevokeInvitationId = revokeInvitationId;
  }

  // --- Teacher with a classroom -------------------------------------------
  const teacherEmail = 'qa-teacher@example.com';
  const teacherUserId = await findOrCreateSiteUser(conn, {
    email: teacherEmail, firstName: 'QA', lastName: 'Teacher', role: 'teacher',
  });
  let [[classroom]] = await conn.query(
    "SELECT id, join_code, parent_code FROM classrooms WHERE teacher_site_user_id = ? AND archived_at IS NULL LIMIT 1",
    [teacherUserId]
  );
  if (!classroom) {
    const joinCode = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    const parentCode = `${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [result] = await conn.query(
      `INSERT INTO classrooms (name, teacher_site_user_id, join_code, parent_code, grade_level, subject, academic_year)
       VALUES ('QA Test Classroom', ?, ?, ?, '5th Grade', 'Homeroom', '2025-2026')`,
      [teacherUserId, joinCode, parentCode]
    );
    classroom = { id: result.insertId, join_code: joinCode, parent_code: parentCode };
  }
  out.teacher = teacherEmail;
  out.classroomId = classroom.id;
  out.classroomJoinCode = classroom.join_code;
  out.classroomParentCode = classroom.parent_code;

  // Assign a published curriculum to the classroom so teacher/parent/student
  // lesson-card flows have something real to render, not just an empty
  // "No lessons" state.
  const [[curriculum]] = await conn.query(
    "SELECT id FROM curricula WHERE published = 1 ORDER BY id LIMIT 1"
  );
  if (curriculum) {
    await conn.query(
      `INSERT IGNORE INTO classroom_assignments (classroom_id, curriculum_id, assigned_by_id)
       VALUES (?, ?, ?)`,
      [classroom.id, curriculum.id, teacherUserId]
    );
  } else {
    console.warn('No published curriculum found — classroom has no lesson assigned. Publish one via admin-curriculum.html, then re-run this script.');
  }

  // --- Student in that classroom ------------------------------------------
  const studentUsername = 'qa-student-1';
  let [[student]] = await conn.query(
    'SELECT id FROM classroom_students WHERE username = ?',
    [studentUsername]
  );
  if (!student) {
    const pinHash = await bcrypt.hash(QA_PIN, 10);
    const [result] = await conn.query(
      `INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, is_active)
       VALUES (?, 'QA Student', ?, ?, 1)`,
      [classroom.id, studentUsername, pinHash]
    );
    student = { id: result.insertId };
  }
  out.studentUsername = studentUsername;
  out.studentId = student.id;

  // A second child in the same classroom, used to test sibling
  // differentiation (two children, two separate progress views) and to
  // exercise the parent-invite-accept flow via a seeded pending token.
  const siblingUsername = 'qa-student-2';
  let [[sibling]] = await conn.query(
    'SELECT id FROM classroom_students WHERE username = ?',
    [siblingUsername]
  );
  if (!sibling) {
    const pinHash = await bcrypt.hash(QA_PIN, 10);
    const [result] = await conn.query(
      `INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, is_active)
       VALUES (?, 'QA Sibling', ?, ?, 1)`,
      [classroom.id, siblingUsername, pinHash]
    );
    sibling = { id: result.insertId };
  }
  out.siblingUsername = siblingUsername;
  out.siblingId = sibling.id;

  // Give the first child real lesson-completion progress so the parent
  // progress view has a non-empty case to render, not just "not started".
  if (curriculum) {
    await conn.query(
      `INSERT INTO student_lesson_progress (student_id, curriculum_id, started_at, completed_at)
       VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE completed_at = NOW()`,
      [student.id, curriculum.id]
    );
  }

  // --- Parent linked to that specific child --------------------------------
  const parentEmail = 'qa-parent@example.com';
  const parentUserId = await findOrCreateSiteUser(conn, {
    email: parentEmail, firstName: 'QA', lastName: 'Parent', role: 'parent',
  });
  await conn.query(
    `INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE student_id = VALUES(student_id)`,
    [parentUserId, classroom.id, student.id]
  );
  out.parent = parentEmail;

  // Pending parent-invite token for the sibling, addressed to the same
  // parent email — accepting it (already-logged-in claim flow) should add
  // the sibling as a second child without disturbing the first link.
  const siblingInviteToken = crypto.randomBytes(48).toString('hex');
  const [[existingSiblingInvite]] = await conn.query(
    "SELECT id, token FROM parent_student_invitations WHERE student_id = ? AND invited_email = ? AND status = 'pending'",
    [sibling.id, parentEmail]
  );
  if (existingSiblingInvite) {
    out.parentInviteToken = existingSiblingInvite.token;
  } else {
    await conn.query(
      `INSERT INTO parent_student_invitations
         (classroom_id, student_id, invited_email, token, status, invited_by_site_user_id, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 14 DAY))`,
      [classroom.id, sibling.id, parentEmail, siblingInviteToken, teacherUserId]
    );
    out.parentInviteToken = siblingInviteToken;
  }

  await conn.end();

  console.log('\nQA test accounts ready. Paste these into tests/.env.test:\n');
  console.log(`TEST_SITE_USER_EMAIL=${out.siteUserLicensed}`);
  console.log(`TEST_SITE_USER_PASSWORD=${out.password}`);
  console.log(`TEST_SITE_USER_UNLICENSED_EMAIL=${out.siteUserUnlicensed}`);
  console.log(`TEST_SITE_USER_UNLICENSED_PASSWORD=${out.password}`);
  console.log(`TEST_MEMBER_EMAIL=${out.member}`);
  console.log(`TEST_MEMBER_PASSWORD=${out.password}`);
  console.log(`TEST_SCHOOL_ADMIN_EMAIL=${out.schoolAdmin}`);
  console.log(`TEST_SCHOOL_ADMIN_PASSWORD=${out.password}`);
  console.log(`TEST_TEACHER_EMAIL=${out.teacher}`);
  console.log(`TEST_TEACHER_PASSWORD=${out.password}`);
  console.log(`TEST_STUDENT_USERNAME=${out.studentUsername}`);
  console.log(`TEST_STUDENT_PIN=${out.pin}`);
  console.log(`TEST_PARENT_EMAIL=${out.parent}`);
  console.log(`TEST_PARENT_PASSWORD=${out.password}`);
  console.log(`TEST_STUDENT_ID=${out.studentId}`);
  console.log(`TEST_SIBLING_STUDENT_USERNAME=${out.siblingUsername}`);
  console.log(`TEST_SIBLING_STUDENT_ID=${out.siblingId}`);
  console.log(`TEST_PARENT_INVITE_TOKEN=${out.parentInviteToken}`);
  if (out.removableTeacher) console.log(`TEST_REMOVABLE_TEACHER_EMAIL=${out.removableTeacher}`);
  if (out.inviteToken) console.log(`TEST_TEACHER_INVITE_TOKEN=${out.inviteToken}`);
  if (out.inviteEmail) console.log(`TEST_TEACHER_INVITE_EMAIL=${out.inviteEmail}`);
  if (out.quoteAcceptToken) console.log(`TEST_QUOTE_ACCEPT_TOKEN=${out.quoteAcceptToken}`);
  if (out.quotePoGateToken) console.log(`TEST_QUOTE_PO_GATE_TOKEN=${out.quotePoGateToken}`);
  if (out.quoteBuilderId) console.log(`TEST_QUOTE_BUILDER_ID=${out.quoteBuilderId}`);
  if (out.qaLicenseProductId) console.log(`TEST_LICENSE_PRODUCT_ID=${out.qaLicenseProductId}`);
  if (out.sessionRevokeEmail) {
    console.log(`TEST_SESSION_REVOKE_EMAIL=${out.sessionRevokeEmail}`);
    console.log(`TEST_SESSION_REVOKE_PASSWORD=${out.password}`);
  }
  if (out.permLeakEmail) {
    console.log(`TEST_PERMLEAK_ADMIN_EMAIL=${out.permLeakEmail}`);
    console.log(`TEST_PERMLEAK_OLDER_PURCHASE_ID=${out.permLeakOlderPurchaseId}`);
    console.log(`TEST_PERMLEAK_NEWER_PURCHASE_ID=${out.permLeakNewerPurchaseId}`);
  }
  if (out.secondaryAdminEmail) {
    console.log(`TEST_SECONDARY_ADMIN_EMAIL=${out.secondaryAdminEmail}`);
    console.log(`TEST_SECONDARY_REVOKE_INVITATION_ID=${out.secondaryRevokeInvitationId}`);
  }
  console.log(`TEST_CLASSROOM_JOIN_CODE=${out.classroomJoinCode}`);
  console.log(`\n(Classroom #${out.classroomId} — join code ${out.classroomJoinCode}, parent code ${out.classroomParentCode})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
