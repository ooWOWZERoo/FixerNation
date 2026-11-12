// Shared teacher-invitation logic, extracted from server/routes/school-admin.js's
// POST /invitations so a school's own License Administrator and an FNE admin
// acting on that school's behalf (server/routes/admin-concierge.js) can both
// invite a teacher to a seat through the exact same code path — same
// validation, same seat-capacity transaction, same email. The two existing
// school-admin.js routes (single + bulk) were refactored to call this too,
// so there is now exactly one place this logic lives, not three.
const crypto = require('crypto');
const pool = require('../db/pool');
const { audit } = require('./audit');
const { getSeatCounts } = require('./seat-counts');
const { licenseAccess, NOT_OPEN_MESSAGES } = require('./license-access');
const { sendTeacherInvitationEmail } = require('./mailer');
const { isDemoSchoolDomain, demoInviteAllowed } = require('./sales-demo');
const { parseGradeLevels, summarize, toStored } = require('./grade-levels');

const INVITATION_EXPIRY_DAYS = 14;

function makeToken() {
  return crypto.randomBytes(48).toString('hex');
}

// Invites one teacher to one purchase's license. Throws a typed
// { status, message } error on any validation/capacity failure — the
// caller decides whether to respond immediately (a single invite) or
// collect it into a results array and continue (a bulk loop).
//
// `invitedBy` identifies who's sending this, for the audit trail and the
// "invited by" line in the email: { siteUserId, email, name, actorType }.
// actorType is 'site_user' for a school admin's own session, 'admin' for
// an FNE admin acting on the school's behalf — the audit action name
// differs accordingly so the two are distinguishable in school_audit_log.
async function inviteTeacherToSeat({
  purchaseId, email, firstName, lastName, gradeLevels, roleName, department,
  subjectArea, personalMessage, invitedBy, ipAddress,
}) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('A valid email is required'), { status: 400 });
  }
  // Guardrail: a real name is required for every invitation -- an invite
  // sent without one used to leave a permanent NULL/NULL gap on the
  // resulting school_invitations row, with no way to backfill it later.
  if (!firstName || !String(firstName).trim() || !lastName || !String(lastName).trim()) {
    throw Object.assign(new Error('First and last name are required'), { status: 400 });
  }
  // Every teacher is registered for at least one grade level (ES, MS, HS, HE): the library's level-mismatch warning
  // compares a lesson against these. Throws a 400 with a plain message for an empty or unrecognised list.
  const levels = parseGradeLevels(gradeLevels);
  const normalEmail = email.trim().toLowerCase();

  // License gate (lib/license-access.js): paid, or a purchase order that has been received
  const [[purchase]] = await pool.query(
    'SELECT id, seat_count, payment_status, payment_method, license_status, school_domain FROM purchases WHERE id = ?',
    [purchaseId]
  );
  const access = licenseAccess(purchase);
  if (!access.open) {
    throw Object.assign(new Error(NOT_OPEN_MESSAGES[access.reason]), { status: 422 });
  }

  // The demo school is fake. Inviting a REAL teacher into it would email them about a
  // school that doesn't exist and put them in a roster a salesperson can see, so demo
  // invitations are limited to example.com addresses and the inviter's own colleagues.
  if (isDemoSchoolDomain(purchase.school_domain) && !demoInviteAllowed(normalEmail, invitedBy && invitedBy.email)) {
    throw Object.assign(new Error('This is a demo school -- you can only invite example.com addresses or colleagues who share your own email domain.'), { status: 422 });
  }

  // Duplicate invitation check
  const [[existing]] = await pool.query(
    "SELECT id, status FROM school_invitations WHERE purchase_id = ? AND invited_email = ? AND status NOT IN ('revoked', 'expired', 'registered')",
    [purchaseId, normalEmail]
  );
  if (existing) {
    throw Object.assign(new Error('An active invitation already exists for this email.'), { status: 409, invitationId: existing.id });
  }

  // Existing teacher already registered?
  const [[alreadySeated]] = await pool.query(
    "SELECT ls.id FROM license_seats ls WHERE ls.purchase_id = ? AND ls.invited_email = ? AND ls.status = 'registered'",
    [purchaseId, normalEmail]
  );
  if (alreadySeated) {
    throw Object.assign(new Error('This teacher is already registered under this license.'), { status: 409 });
  }

  // Available seat check (atomic), seat + invitation creation
  const conn = await pool.getConnection();
  let seatId, invitationId, token, expiresAt;
  try {
    await conn.beginTransaction();

    await conn.query('SELECT seat_count FROM purchases WHERE id = ? FOR UPDATE', [purchaseId]);
    // Same count the admin pages show (lib/seat-counts.js): admins don't use a seat, released and unclaimed ones don't count.
    const counts = await getSeatCounts(purchaseId, conn);
    if (counts.available <= 0) {
      await conn.rollback();
      throw Object.assign(new Error('No available licenses. All seats are assigned or invited.'), { status: 422 });
    }

    const [seatResult] = await conn.query(
      "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
      [purchaseId, normalEmail]
    );
    seatId = seatResult.insertId;

    token = makeToken();
    expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const [invResult] = await conn.query(
      `INSERT INTO school_invitations
         (purchase_id, seat_id, invited_email, first_name, last_name, token, status,
          grade_level, audiences, role_title, department, subject_area, personal_message,
          invited_by_site_user_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [purchaseId, seatId, normalEmail, firstName || null, lastName || null, token,
       summarize(levels), toStored(levels), roleName || null, department || null, subjectArea || null,
       personalMessage || null, (invitedBy && invitedBy.siteUserId) || null, expiresAt]
    );
    invitationId = invResult.insertId;

    await conn.commit();

    await audit(conn, {
      actorType: (invitedBy && invitedBy.actorType) || 'site_user',
      actorId: invitedBy && invitedBy.siteUserId,
      actorEmail: invitedBy && invitedBy.email,
      action: invitedBy && invitedBy.actorType === 'admin' ? 'invitation_sent_by_admin' : 'invitation_sent',
      entityType: 'invitation',
      entityId: invitationId,
      purchaseId,
      schoolDomain: purchase.school_domain,
      newValue: { email: normalEmail, firstName, lastName },
      ipAddress: ipAddress || null,
    });

    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }

  // Send email (non-blocking)
  const siteUrl = process.env.SITE_URL || '';
  const inviteUrl = `${siteUrl}/school-invite-accept.html?token=${token}`;
  sendTeacherInvitationEmail({
    to: normalEmail,
    firstName: firstName || 'Teacher',
    inviteUrl,
    schoolDomain: purchase.school_domain,
    adminName: (invitedBy && invitedBy.name) || 'Fixer Nation Education',
    personalMessage: personalMessage || null,
    expiresAt,
  }).catch(e => console.error('sendTeacherInvitationEmail failed:', e.message));

  return { invitationId, seatId };
}

module.exports = { inviteTeacherToSeat };
