const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireSchoolAdmin, blockIfReadOnly, blockIfCannotRevoke } = require('../middleware/schoolAdminAuth');
const { syncRoleToAssignments } = require('../lib/school-admin-roles');
const { resolveSchoolIdForPurchase, getPublishedBranding } = require('../lib/branding');
const {
  logoUpload,
  upsertDraftColors,
  processLogoUpload,
  applyLogoCrop,
  publishBranding,
  resetBranding,
} = require('../lib/branding-editor');
const {
  sendTeacherInvitationEmail,
  sendInvitationReminderEmail,
} = require('../lib/mailer');

const router = express.Router();

const INVITATION_EXPIRY_DAYS = 14;
const RESEND_LIMIT = 5;

// Helper: generate a secure invitation token
function makeToken() {
  return crypto.randomBytes(48).toString('hex');
}

// Helper: insert audit log entry (fire-and-forget, never throws)
async function audit(conn, { actorType, actorId, actorEmail, action, entityType, entityId, purchaseId, schoolDomain, prevValue, newValue, reason, ipAddress }) {
  try {
    await conn.query(
      `INSERT INTO school_audit_log
         (actor_type, actor_id, actor_email, action, entity_type, entity_id,
          purchase_id, school_domain, prev_value, new_value, reason, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorType, actorId || null, actorEmail || null,
        action, entityType || null, entityId || null,
        purchaseId || null, schoolDomain || null,
        prevValue ? JSON.stringify(prevValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        reason || null,
        ipAddress || null,
      ]
    );
  } catch (e) {
    console.error('audit log error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Session / Me
// ---------------------------------------------------------------------------

// GET /api/school-admin/me
// Returns current session info + school context for portal bootstrap
router.get('/me', requireSchoolAdmin, (req, res) => {
  const { siteUserId, email, firstName, lastName, permissionLevel, purchases } = req.schoolAdmin;
  res.json({
    loggedIn: true,
    siteUserId,
    email,
    firstName,
    lastName,
    permissionLevel,
    schools: purchases.map(p => ({
      purchaseId: p.purchase_id,
      schoolDomain: p.school_domain,
      planName: p.plan_name || 'Group License',
      seatCount: p.seat_count,
      paymentStatus: p.payment_status,
    })),
  });
});

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------

// GET /api/school-admin/dashboard?purchaseId=
router.get('/dashboard', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied to this school' });
  }

  const [[purchase]] = await pool.query(
    `SELECT p.id, p.school_domain, p.seat_count, p.payment_status, p.payment_method,
            p.purchased_at, p.invoice_id, inv.status AS invoice_status, inv.paid_at,
            lp.name AS plan_name, lp.footer_note AS plan_term
     FROM purchases p
     LEFT JOIN invoices inv ON inv.id = p.invoice_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.id = ?`,
    [purchaseId]
  );

  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

  // Seat counts
  const [[counts]] = await pool.query(
    `SELECT
       COUNT(*) AS total_seats_created,
       SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS registered,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
       SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked
     FROM license_seats WHERE purchase_id = ?`,
    [purchaseId]
  );

  // Invitation counts
  const [[invCounts]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
       SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked,
       SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS registered
     FROM school_invitations WHERE purchase_id = ?`,
    [purchaseId]
  );

  // Recent registrations (last 7 days)
  const [recentTeachers] = await pool.query(
    `SELECT su.first_name, su.last_name, su.email, ls.registered_at
     FROM license_seats ls
     JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.purchase_id = ? AND ls.status = 'registered'
       AND ls.registered_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY ls.registered_at DESC
     LIMIT 5`,
    [purchaseId]
  );

  // Recent audit activity
  const [recentActivity] = await pool.query(
    `SELECT action, entity_type, actor_email, created_at, reason
     FROM school_audit_log
     WHERE purchase_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [purchaseId]
  );

  const totalSeats = purchase.seat_count;
  const assigned = Number(counts.registered || 0) + Number(counts.pending || 0) + Number(counts.inactive || 0);
  const available = Math.max(0, totalSeats - assigned);
  const pctUsed = totalSeats > 0 ? Math.round((assigned / totalSeats) * 100) : 0;

  res.json({
    purchase: {
      id: purchase.id,
      schoolDomain: purchase.school_domain,
      planName: purchase.plan_name || 'Group License',
      planTerm: purchase.plan_term,
      paymentStatus: purchase.payment_status,
      invoiceStatus: purchase.invoice_status,
      paidAt: purchase.paid_at,
      purchasedAt: purchase.purchased_at,
    },
    licenses: {
      total: totalSeats,
      assigned,
      available,
      registered: Number(counts.registered || 0),
      pending: Number(counts.pending || 0),
      revoked: Number(counts.revoked || 0),
      pctUsed,
    },
    invitations: {
      pending: Number(invCounts.pending || 0),
      expired: Number(invCounts.expired || 0),
      revoked: Number(invCounts.revoked || 0),
      registered: Number(invCounts.registered || 0),
    },
    recentTeachers,
    recentActivity,
  });
});

// ---------------------------------------------------------------------------
// Organization info
// ---------------------------------------------------------------------------

// GET /api/school-admin/org?purchaseId=
router.get('/org', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const [[row]] = await pool.query(
    `SELECT p.id, p.school_domain, p.seat_count, p.payment_status, p.payment_method,
            p.purchased_at, p.effective_date, p.expiration_date, p.license_status,
            p.invoice_id, p.notes,
            lp.name AS plan_name, lp.footer_note AS plan_term,
            nc.name AS buyer_name, nc.email AS buyer_email, nc.phone,
            nc.company, nc.street, nc.city, nc.state, nc.zip,
            inv.invoice_number, inv.status AS invoice_status, inv.paid_at, inv.total_cents
     FROM purchases p
     LEFT JOIN newsletter_contacts nc ON nc.id = p.contact_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     LEFT JOIN invoices inv ON inv.id = p.invoice_id
     WHERE p.id = ?`,
    [purchaseId]
  );

  if (!row) return res.status(404).json({ error: 'Not found' });

  // Seat utilization — same "assigned" definition (registered + pending +
  // inactive seats) as the dashboard endpoint above, for a consistent number
  // across both pages.
  const [[counts]] = await pool.query(
    `SELECT
       SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS registered,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive
     FROM license_seats WHERE purchase_id = ?`,
    [purchaseId]
  );
  const total = row.seat_count || 0;
  const assigned = Number(counts.registered || 0) + Number(counts.pending || 0) + Number(counts.inactive || 0);
  const pctUsed = total > 0 ? Math.round((assigned / total) * 100) : 0;

  // Co-admins on this purchase -- excludes anyone who's also an active
  // district admin, same reasoning as district-admin.js's /schools list:
  // that's a different tier of authority, not a school-level co-admin
  // worth reporting here even if they technically also hold the assignment.
  const [coAdmins] = await pool.query(
    `SELECT sla.id, sla.permission_level, sla.is_active, sla.created_at,
            su.first_name, su.last_name, su.email
     FROM school_license_admins sla
     JOIN site_users su ON su.id = sla.site_user_id
     WHERE sla.purchase_id = ?
       AND NOT EXISTS (SELECT 1 FROM district_license_admins dla WHERE dla.site_user_id = sla.site_user_id AND dla.is_active = 1)
     ORDER BY sla.created_at`,
    [purchaseId]
  );

  res.json({
    purchase: {
      id: row.id,
      schoolDomain: row.school_domain,
      company: row.company,
      buyerName: row.buyer_name,
      buyerEmail: row.buyer_email,
      phone: row.phone,
      address: [row.street, row.city, row.state, row.zip].filter(Boolean).join(', '),
      planName: row.plan_name || 'Group License',
      planTerm: row.plan_term,
      seatCount: row.seat_count,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      invoiceNumber: row.invoice_number,
      invoiceStatus: row.invoice_status,
      paidAt: row.paid_at,
      totalCents: row.total_cents,
      purchasedAt: row.purchased_at,
      effectiveDate: row.effective_date,
      expirationDate: row.expiration_date,
      licenseStatus: row.license_status,
      notes: row.notes,
    },
    utilization: { total, assigned, pctUsed },
    coAdmins,
  });
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

// GET /api/school-admin/invitations?purchaseId=&status=&q=&page=&limit=
router.get('/invitations', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const q = (req.query.q || '').trim();

  let where = 'WHERE si.purchase_id = ?';
  const params = [purchaseId];

  if (status) { where += ' AND si.status = ?'; params.push(status); }
  if (q) {
    where += ' AND (si.invited_email LIKE ? OR si.first_name LIKE ? OR si.last_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM school_invitations si ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT si.id, si.invited_email, si.first_name, si.last_name, si.status,
            si.grade_level, si.role_title, si.department, si.subject_area,
            si.expires_at, si.resend_count,
            si.last_resent_at, si.revoked_at, si.revocation_reason, si.created_at,
            si.invited_by_site_user_id,
            inviter.first_name AS inviter_first, inviter.last_name AS inviter_last,
            ls.status AS seat_status, ls.registered_at, ls.registered_site_user_id,
            su.first_name AS teacher_first_name, su.last_name AS teacher_last_name,
            su.email AS teacher_email
     FROM school_invitations si
     LEFT JOIN license_seats ls ON ls.id = si.seat_id
     LEFT JOIN site_users su ON su.id = ls.registered_site_user_id
     LEFT JOIN site_users inviter ON inviter.id = si.invited_by_site_user_id
     ${where}
     ORDER BY si.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  // Auto-mark expired invitations and free their reserved seats
  await pool.query(
    "UPDATE school_invitations SET status = 'expired' WHERE purchase_id = ? AND status = 'pending' AND expires_at < NOW()",
    [purchaseId]
  );
  await pool.query(
    `UPDATE license_seats ls
     JOIN school_invitations si ON si.seat_id = ls.id
     SET ls.status = 'revoked', ls.revoked_at = NOW()
     WHERE si.purchase_id = ? AND si.status = 'expired' AND ls.status = 'pending'`,
    [purchaseId]
  );

  res.json({ invitations: rows, total: Number(total), page, limit });
});

// POST /api/school-admin/invitations — send a single invitation
router.post('/invitations', requireSchoolAdmin, async (req, res) => {
  const { purchaseId: rawPurchaseId, email, firstName, lastName, gradeLevel, roleName, department, subjectArea, personalMessage } = req.body || {};
  const purchaseId = rawPurchaseId ? Number(rawPurchaseId) : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const normalEmail = email.trim().toLowerCase();

  // Payment gate — license allocation must be active (invoice paid)
  const [[purchase]] = await pool.query(
    'SELECT id, seat_count, payment_status, school_domain FROM purchases WHERE id = ?',
    [purchaseId]
  );
  if (!purchase || purchase.payment_status !== 'paid') {
    return res.status(422).json({ error: 'School license is not yet active. The associated invoice must be marked as paid before invitations can be sent.' });
  }

  // Duplicate invitation check
  const [[existing]] = await pool.query(
    "SELECT id, status FROM school_invitations WHERE purchase_id = ? AND invited_email = ? AND status NOT IN ('revoked', 'expired', 'registered')",
    [purchaseId, normalEmail]
  );
  if (existing) {
    return res.status(409).json({ error: 'An active invitation already exists for this email.', invitationId: existing.id });
  }

  // Existing teacher already registered?
  const [[alreadySeated]] = await pool.query(
    "SELECT ls.id FROM license_seats ls WHERE ls.purchase_id = ? AND ls.invited_email = ? AND ls.status = 'registered'",
    [purchaseId, normalEmail]
  );
  if (alreadySeated) {
    return res.status(409).json({ error: 'This teacher is already registered under this license.' });
  }

  // Available seat check (atomic)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[locked]] = await conn.query(
      'SELECT seat_count FROM purchases WHERE id = ? FOR UPDATE',
      [purchaseId]
    );
    const [[{ used }]] = await conn.query(
      "SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ? AND status NOT IN ('revoked', 'available')",
      [purchaseId]
    );

    if (used >= locked.seat_count) {
      await conn.rollback();
      return res.status(422).json({ error: 'No available licenses. All seats are assigned or invited.' });
    }

    // Create license seat (reserved for this invitation)
    const [seatResult] = await conn.query(
      "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
      [purchaseId, normalEmail]
    );
    const seatId = seatResult.insertId;

    // Create invitation
    const token = makeToken();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const [invResult] = await conn.query(
      `INSERT INTO school_invitations
         (purchase_id, seat_id, invited_email, first_name, last_name, token, status,
          grade_level, role_title, department, subject_area, personal_message,
          invited_by_site_user_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      [purchaseId, seatId, normalEmail, firstName || null, lastName || null, token,
       gradeLevel || null, roleName || null, department || null, subjectArea || null,
       personalMessage || null, req.schoolAdmin.siteUserId, expiresAt]
    );

    await conn.commit();

    await audit(conn, {
      actorType: 'site_user',
      actorId: req.schoolAdmin.siteUserId,
      actorEmail: req.schoolAdmin.email,
      action: 'invitation_sent',
      entityType: 'invitation',
      entityId: invResult.insertId,
      purchaseId,
      schoolDomain: purchase.school_domain,
      newValue: { email: normalEmail, firstName, lastName },
      ipAddress: req.ip,
    });

    conn.release();

    // Send email (non-blocking)
    const siteUrl = process.env.SITE_URL || '';
    const inviteUrl = `${siteUrl}/school-invite-accept.html?token=${token}`;
    sendTeacherInvitationEmail({
      to: normalEmail,
      firstName: firstName || 'Teacher',
      inviteUrl,
      schoolDomain: purchase.school_domain,
      adminName: `${req.schoolAdmin.firstName} ${req.schoolAdmin.lastName}`.trim(),
      personalMessage: personalMessage || null,
      expiresAt,
    }).catch(e => console.error('sendTeacherInvitationEmail failed:', e.message));

    res.status(201).json({ ok: true, invitationId: invResult.insertId, seatId });
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
});

// POST /api/school-admin/invitations/bulk — send multiple invitations
router.post('/invitations/bulk', requireSchoolAdmin, async (req, res) => {
  const { purchaseId: rawPurchaseId, invitations } = req.body || {};
  const purchaseId = rawPurchaseId ? Number(rawPurchaseId) : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;
  if (!Array.isArray(invitations) || !invitations.length) {
    return res.status(400).json({ error: 'invitations array is required' });
  }
  if (invitations.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 invitations per batch' });
  }

  const [[purchase]] = await pool.query(
    'SELECT id, seat_count, payment_status, school_domain FROM purchases WHERE id = ?',
    [purchaseId]
  );
  if (!purchase || purchase.payment_status !== 'paid') {
    return res.status(422).json({ error: 'School license is not yet active.' });
  }

  const results = { sent: [], skipped: [], errors: [] };
  const siteUrl = process.env.SITE_URL || '';

  for (const inv of invitations) {
    const email = (inv.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.errors.push({ email: inv.email, reason: 'Invalid email' });
      continue;
    }

    // Check for existing active invitation or registered seat
    const [[dup]] = await pool.query(
      "SELECT id FROM school_invitations WHERE purchase_id = ? AND invited_email = ? AND status NOT IN ('revoked','expired','registered')",
      [purchaseId, email]
    );
    if (dup) { results.skipped.push({ email, reason: 'Already invited' }); continue; }

    const [[seated]] = await pool.query(
      "SELECT id FROM license_seats WHERE purchase_id = ? AND invited_email = ? AND status = 'registered'",
      [purchaseId, email]
    );
    if (seated) { results.skipped.push({ email, reason: 'Already registered' }); continue; }

    // Seat availability check
    const [[{ used }]] = await pool.query(
      "SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ? AND status NOT IN ('revoked', 'available')",
      [purchaseId]
    );
    if (used >= purchase.seat_count) {
      results.errors.push({ email, reason: 'No available seats' });
      continue;
    }

    try {
      const conn = await pool.getConnection();
      await conn.beginTransaction();

      const [[locked]] = await conn.query('SELECT seat_count FROM purchases WHERE id = ? FOR UPDATE', [purchaseId]);
      const [[{ used: usedNow }]] = await conn.query(
        "SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ? AND status NOT IN ('revoked', 'available')",
        [purchaseId]
      );

      if (usedNow >= locked.seat_count) {
        await conn.rollback();
        conn.release();
        results.errors.push({ email, reason: 'No available seats' });
        continue;
      }

      const [seatResult] = await conn.query(
        "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
        [purchaseId, email]
      );
      const token = makeToken();
      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const [invResult] = await conn.query(
        `INSERT INTO school_invitations
           (purchase_id, seat_id, invited_email, first_name, last_name, token, status,
            grade_level, role_title, department, subject_area, invited_by_site_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        [purchaseId, seatResult.insertId, email, inv.firstName || null, inv.lastName || null,
         token, inv.gradeLevel || null, inv.role || null, inv.department || null,
         inv.subjectArea || null, req.schoolAdmin.siteUserId, expiresAt]
      );

      await conn.commit();
      conn.release();

      const inviteUrl = `${siteUrl}/school-invite-accept.html?token=${token}`;
      sendTeacherInvitationEmail({
        to: email,
        firstName: inv.firstName || 'Teacher',
        inviteUrl,
        schoolDomain: purchase.school_domain,
        adminName: `${req.schoolAdmin.firstName} ${req.schoolAdmin.lastName}`.trim(),
        personalMessage: null,
        expiresAt,
      }).catch(e => console.error('bulk invite email failed:', e.message));

      results.sent.push({ email, invitationId: invResult.insertId });
    } catch (e) {
      results.errors.push({ email, reason: 'Server error: ' + e.message });
    }
  }

  res.json(results);
});

// GET /api/school-admin/invitations/csv-template
router.get('/invitations/csv-template', requireSchoolAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="teacher-invite-template.csv"');
  res.send('Email,FirstName,LastName,GradeLevel,Role,Department,SubjectArea\n');
});

// PUT /api/school-admin/invitations/:id/resend
router.put('/invitations/:id/resend', requireSchoolAdmin, async (req, res) => {
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (blockIfReadOnly(req, res, inv.purchase_id)) return;
  if (['revoked', 'registered'].includes(inv.status)) {
    return res.status(409).json({ error: `Cannot resend a ${inv.status} invitation` });
  }
  if (inv.resend_count >= RESEND_LIMIT) {
    return res.status(429).json({ error: `Resend limit (${RESEND_LIMIT}) reached for this invitation` });
  }

  // Refresh token and extend expiry
  const newToken = makeToken();
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "UPDATE school_invitations SET token = ?, expires_at = ?, resend_count = resend_count + 1, last_resent_at = NOW(), status = 'pending' WHERE id = ?",
    [newToken, expiresAt, inv.id]
  );

  const [[purchase]] = await pool.query('SELECT school_domain FROM purchases WHERE id = ?', [inv.purchase_id]);
  const siteUrl = process.env.SITE_URL || '';
  const inviteUrl = `${siteUrl}/school-invite-accept.html?token=${newToken}`;

  sendInvitationReminderEmail({
    to: inv.invited_email,
    firstName: inv.first_name || 'Teacher',
    inviteUrl,
    schoolDomain: purchase && purchase.school_domain,
    expiresAt,
  }).catch(e => console.error('resend email failed:', e.message));

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'invitation_resent',
    entityType: 'invitation', entityId: inv.id, purchaseId: inv.purchase_id,
    schoolDomain: purchase && purchase.school_domain, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// PUT /api/school-admin/invitations/:id/revoke
router.put('/invitations/:id/revoke', requireSchoolAdmin, async (req, res) => {
  const { reason } = req.body || {};
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (blockIfCannotRevoke(req, res, inv.purchase_id)) return;
  if (['revoked', 'registered'].includes(inv.status)) {
    return res.status(409).json({ error: `Cannot revoke a ${inv.status} invitation` });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "UPDATE school_invitations SET status = 'revoked', revoked_at = NOW(), revoked_by_site_user_id = ?, revocation_reason = ? WHERE id = ?",
      [req.schoolAdmin.siteUserId, reason || null, inv.id]
    );

    // Release the reserved seat so it becomes available again
    if (inv.seat_id) {
      await conn.query(
        "UPDATE license_seats SET status = 'revoked', revoked_at = NOW(), revoked_by = ?, revocation_reason = ? WHERE id = ? AND status = 'pending'",
        [req.schoolAdmin.siteUserId, reason || 'Invitation revoked', inv.seat_id]
      );
    }

    await conn.commit();
    conn.release();

    await audit(pool, {
      actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
      actorEmail: req.schoolAdmin.email, action: 'invitation_revoked',
      entityType: 'invitation', entityId: inv.id, purchaseId: inv.purchase_id,
      reason, ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
});

// PUT /api/school-admin/invitations/:id/extend
router.put('/invitations/:id/extend', requireSchoolAdmin, async (req, res) => {
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (blockIfReadOnly(req, res, inv.purchase_id)) return;
  if (['revoked', 'registered'].includes(inv.status)) {
    return res.status(409).json({ error: `Cannot extend a ${inv.status} invitation` });
  }

  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "UPDATE school_invitations SET expires_at = ?, status = 'pending' WHERE id = ?",
    [expiresAt, inv.id]
  );

  res.json({ ok: true, expiresAt });
});

// DELETE /api/school-admin/invitations/:id — remove a revoked or expired invitation
// and release its reserved seat so capacity is freed.
router.delete('/invitations/:id', requireSchoolAdmin, async (req, res) => {
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (blockIfReadOnly(req, res, inv.purchase_id)) return;
  if (!['revoked', 'expired'].includes(inv.status)) {
    return res.status(409).json({ error: `Only revoked or expired invitations can be deleted (this one is ${inv.status})` });
  }

  if (inv.seat_id) {
    await pool.query(
      "DELETE FROM license_seats WHERE id = ? AND status IN ('pending','revoked','expired')",
      [inv.seat_id]
    );
  }
  await pool.query('DELETE FROM school_invitations WHERE id = ?', [inv.id]);

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'invitation_deleted',
    entityType: 'invitation', entityId: inv.id, purchaseId: inv.purchase_id,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

// GET /api/school-admin/teachers?purchaseId=&q=&status=&page=&limit=
router.get('/teachers', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;
  const q = (req.query.q || '').trim();
  const statusFilter = req.query.status || '';

  let where = 'WHERE ls.purchase_id = ? AND ls.status = ?';
  const params = [purchaseId, 'registered'];

  if (statusFilter === 'inactive') {
    // license_seats.status is per-purchase — a teacher deactivated here can
    // simultaneously hold a perfectly active seat at a different school.
    // The old site_users.role = 'inactive_teacher' check this used to use
    // was a GLOBAL column, so a teacher deactivated at School A would
    // wrongly show as inactive here too, and reactivating them anywhere
    // would wrongly make them disappear from a genuinely-inactive listing
    // elsewhere. See the /deactivate and /reactivate routes below, which no
    // longer touch that column at all for the same reason.
    where = 'WHERE ls.purchase_id = ? AND ls.status = ?';
    params.splice(0, params.length, purchaseId, 'inactive');
  }
  if (q) {
    where += ' AND (su.email LIKE ? OR su.first_name LIKE ? OR su.last_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM license_seats ls
     JOIN site_users su ON su.id = ls.registered_site_user_id
     ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT su.id AS site_user_id, su.first_name, su.last_name, su.email, su.role,
            ls.id AS seat_id, ls.status AS seat_status, ls.registered_at, ls.invited_email,
            si.grade_level, si.department, si.role_title
     FROM license_seats ls
     JOIN site_users su ON su.id = ls.registered_site_user_id
     LEFT JOIN school_invitations si ON si.seat_id = ls.id
     ${where}
     ORDER BY ls.registered_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const siteUserIds = rows.map(r => r.site_user_id).filter(Boolean);
  const [audRows] = siteUserIds.length
    ? await pool.query('SELECT site_user_id, audience FROM site_user_audiences WHERE site_user_id IN (?)', [siteUserIds])
    : [[]];
  const audByUser = {};
  audRows.forEach(r => { (audByUser[r.site_user_id] = audByUser[r.site_user_id] || []).push(r.audience); });
  const teachers = rows.map(r => ({ ...r, audiences: audByUser[r.site_user_id] || [] }));

  const [[purchaseRow]] = await pool.query('SELECT payment_status FROM purchases WHERE id = ?', [purchaseId]);
  res.json({ teachers, total: Number(total), page, limit, paymentStatus: purchaseRow ? purchaseRow.payment_status : null });
});

// PUT /api/school-admin/teachers/:siteUserId/audiences
const SA_VALID_AUDIENCES = ['Elementary School', 'Middle School', 'High School', 'Higher Education'];

router.put('/teachers/:siteUserId/audiences', requireSchoolAdmin, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;

  const [[seat]] = await pool.query(
    "SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ? AND status IN ('registered','inactive')",
    [purchaseId, siteUserId]
  );
  if (!seat) return res.status(404).json({ error: 'Teacher not found under this school' });

  const audiences = Array.isArray(req.body && req.body.audiences) ? req.body.audiences : [];
  const invalid = audiences.find(a => !SA_VALID_AUDIENCES.includes(a));
  if (invalid) return res.status(400).json({ error: `Invalid audience value: ${invalid}` });

  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM site_user_audiences WHERE site_user_id = ?', [siteUserId]);
    if (audiences.length > 0) {
      await conn.query(
        'INSERT INTO site_user_audiences (site_user_id, audience) VALUES ' + audiences.map(() => '(?, ?)').join(', '),
        audiences.flatMap(a => [siteUserId, a])
      );
    }
  } finally {
    conn.release();
  }
  res.json({ ok: true, audiences });
});

// PUT /api/school-admin/teachers/:siteUserId/deactivate
router.put('/teachers/:siteUserId/deactivate', requireSchoolAdmin, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;

  // Verify teacher belongs to this school
  const [[seat]] = await pool.query(
    "SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ? AND status = 'registered'",
    [purchaseId, siteUserId]
  );
  if (!seat) return res.status(404).json({ error: 'Teacher not found under this school' });

  // license_seats.status is per-purchase, which is already the right scope
  // for this action — deliberately NOT touching site_users.role (a global
  // column) here anymore. It used to be set to 'inactive_teacher', which
  // conflated a single school's deactivation with the person's entire
  // account: a teacher deactivated at School A showed as deactivated at
  // every other school they teach at too, since role has no per-purchase
  // concept at all.
  await pool.query("UPDATE license_seats SET status = 'inactive' WHERE id = ?", [seat.id]);

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'teacher_deactivated',
    entityType: 'site_user', entityId: siteUserId, purchaseId,
    reason: req.body && req.body.reason, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// PUT /api/school-admin/teachers/:siteUserId/reactivate
router.put('/teachers/:siteUserId/reactivate', requireSchoolAdmin, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;

  const [[seat]] = await pool.query(
    "SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ? AND status = 'inactive'",
    [purchaseId, siteUserId]
  );
  if (!seat) return res.status(404).json({ error: 'Inactive teacher not found under this school' });

  // Same reasoning as /deactivate above — this only ever touches the
  // per-purchase seat status, never the global site_users.role.
  await pool.query("UPDATE license_seats SET status = 'registered' WHERE id = ?", [seat.id]);

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'teacher_reactivated',
    entityType: 'site_user', entityId: siteUserId, purchaseId, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// DELETE /api/school-admin/teachers/:siteUserId — remove from school (keeps site_user account)
router.delete('/teachers/:siteUserId', requireSchoolAdmin, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const bodyPurchaseId = req.body && req.body.purchaseId ? Number(req.body.purchaseId) : null;
  const purchaseId = bodyPurchaseId || (req.query.purchaseId ? Number(req.query.purchaseId) : req.schoolAdmin.purchaseIds[0]);

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (blockIfCannotRevoke(req, res, purchaseId)) return;

  try {
    const [[seat]] = await pool.query(
      "SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?",
      [purchaseId, siteUserId]
    );
    if (!seat) return res.status(404).json({ error: 'Teacher not found under this school' });

    const reason = (req.body && req.body.reason) || 'Removed by administrator';

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "UPDATE license_seats SET status = 'revoked', revoked_at = NOW(), revoked_by = ?, revocation_reason = ? WHERE id = ?",
        [req.schoolAdmin.siteUserId, reason, seat.id]
      );
      await conn.query(
        'UPDATE site_users SET session_invalidated_at = NOW() WHERE id = ?',
        [siteUserId]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // A "teacher" being removed here can ALSO independently hold a
    // school_license_admins co-admin assignment on this same purchase
    // (nothing stops one person holding both roles) — this used to hard-
    // delete that assignment as a silent side effect, with none of the
    // safeguards a real admin-rights removal gets elsewhere in this app: no
    // remaining-assignment count check, no site_users.role revert, no audit
    // entry for the rights loss specifically, and a hard delete instead of
    // the soft is_active=0 pattern used everywhere else (unrecoverable via
    // the existing reactivate tooling without recreating the row). A
    // *primary* school admin could effectively strip a peer co-admin's
    // rights this way — an action otherwise reserved for FNE super-admins
    // (admin-school-admins.js). Now mirrors that same soft-delete + role-
    // sync + explicit-audit pattern instead.
    const [[coAdminAssignment]] = await pool.query(
      'SELECT id FROM school_license_admins WHERE site_user_id = ? AND purchase_id = ? AND is_active = 1',
      [siteUserId, purchaseId]
    );
    if (coAdminAssignment) {
      await pool.query('UPDATE school_license_admins SET is_active = 0 WHERE id = ?', [coAdminAssignment.id]);
      await syncRoleToAssignments(siteUserId);
      await audit(pool, {
        actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
        actorEmail: req.schoolAdmin.email, action: 'co_admin_removed_via_teacher_removal',
        entityType: 'school_license_admins', entityId: coAdminAssignment.id, purchaseId, reason, ipAddress: req.ip,
      });
    }

    await audit(pool, {
      actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
      actorEmail: req.schoolAdmin.email, action: 'teacher_removed',
      entityType: 'site_user', entityId: siteUserId, purchaseId, reason, ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('remove teacher error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

// GET /api/school-admin/licenses?purchaseId=&q=&status=
router.get('/licenses', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const q = (req.query.q || '').trim();
  const statusParam = (req.query.status || '').trim();
  const statusValues = statusParam ? statusParam.split(',').map(s => s.trim()).filter(Boolean) : [];

  const [[purchase]] = await pool.query(
    'SELECT id, seat_count, payment_status, school_domain FROM purchases WHERE id = ?',
    [purchaseId]
  );

  // Unfiltered counts — always reflect the full pool regardless of search/filter
  const [allSeats] = await pool.query(
    'SELECT status FROM license_seats WHERE purchase_id = ?',
    [purchaseId]
  );
  const total = purchase ? purchase.seat_count : 0;
  const active   = allSeats.filter(s => s.status === 'registered').length;
  const inactive = allSeats.filter(s => s.status === 'inactive').length;
  const pending  = allSeats.filter(s => s.status === 'pending').length;
  const revoked  = allSeats.filter(s => s.status === 'revoked').length;
  const available = Math.max(0, total - active - inactive - pending);

  // Filtered seat rows for display
  let where = 'WHERE ls.purchase_id = ?';
  const params = [purchaseId];
  if (statusValues.length === 1) {
    where += ' AND ls.status = ?';
    params.push(statusValues[0]);
  } else if (statusValues.length > 1) {
    where += ' AND ls.status IN (' + statusValues.map(() => '?').join(',') + ')';
    params.push(...statusValues);
  }
  if (q) {
    where += ' AND (su.email LIKE ? OR su.first_name LIKE ? OR su.last_name LIKE ? OR ls.invited_email LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const [seats] = await pool.query(
    `SELECT ls.id, ls.invited_email, ls.status, ls.registered_at, ls.revoked_at,
            ls.revocation_reason, ls.invitation_id,
            su.id AS site_user_id, su.first_name, su.last_name, su.email,
            si.created_at AS invited_at, si.resend_count
     FROM license_seats ls
     LEFT JOIN site_users su ON su.id = ls.registered_site_user_id
     LEFT JOIN school_invitations si ON si.seat_id = ls.id
     ${where}
     ORDER BY ls.registered_at DESC, ls.id DESC`,
    params
  );

  const registeredUserIds = seats.map(s => s.site_user_id).filter(Boolean);
  const [audRows] = registeredUserIds.length
    ? await pool.query('SELECT site_user_id, audience FROM site_user_audiences WHERE site_user_id IN (?)', [registeredUserIds])
    : [[]];
  const audByUser = {};
  audRows.forEach(r => { (audByUser[r.site_user_id] = audByUser[r.site_user_id] || []).push(r.audience); });
  const seatsWithAudiences = seats.map(s => ({ ...s, audiences: s.site_user_id ? (audByUser[s.site_user_id] || []) : [] }));

  res.json({
    total,
    active,
    inactive,
    pending,
    revoked,
    available,
    paymentStatus: purchase ? purchase.payment_status : null,
    seats: seatsWithAudiences,
  });
});

// PUT /api/school-admin/seats/:seatId/revoke
router.put('/seats/:seatId/revoke', requireSchoolAdmin, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'A revocation reason is required' });

  const [[seat]] = await pool.query(
    `SELECT ls.id, ls.status, ls.purchase_id, ls.registered_site_user_id, ls.invited_email,
            su.first_name, su.last_name, su.email
     FROM license_seats ls
     LEFT JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.id = ? AND ls.purchase_id IN (?)`,
    [req.params.seatId, req.schoolAdmin.purchaseIds]
  );
  if (!seat) return res.status(404).json({ error: 'Seat not found' });
  if (blockIfCannotRevoke(req, res, seat.purchase_id)) return;
  if (seat.status === 'revoked') return res.status(409).json({ error: 'Seat is already revoked' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "UPDATE license_seats SET status = 'revoked', revoked_at = NOW(), revoked_by = ?, revocation_reason = ? WHERE id = ?",
      [req.schoolAdmin.siteUserId, reason, seat.id]
    );

    // If linked to an invitation, update it too
    await conn.query(
      "UPDATE school_invitations SET status = 'revoked', revoked_at = NOW(), revoked_by_site_user_id = ?, revocation_reason = ? WHERE seat_id = ? AND status NOT IN ('revoked','registered')",
      [req.schoolAdmin.siteUserId, reason, seat.id]
    );

    // Invalidate the teacher's active sessions so they're force-logged-out immediately.
    if (seat.registered_site_user_id) {
      await conn.query(
        'UPDATE site_users SET session_invalidated_at = NOW() WHERE id = ?',
        [seat.registered_site_user_id]
      );
    }

    await conn.commit();
    conn.release();

    await audit(pool, {
      actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
      actorEmail: req.schoolAdmin.email, action: 'license_revoked',
      entityType: 'license_seat', entityId: seat.id, purchaseId: seat.purchase_id,
      prevValue: { email: seat.email || seat.invited_email, status: seat.status },
      reason, ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

// GET /api/school-admin/reports?purchaseId=&type=utilization|teachers|invitations|activity
router.get('/reports', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const type = req.query.type || 'teachers';

  if (type === 'utilization') {
    const [[purchase]] = await pool.query('SELECT seat_count, payment_status FROM purchases WHERE id = ?', [purchaseId]);
    const [[counts]] = await pool.query(
      `SELECT SUM(status='registered') AS active, SUM(status='pending') AS pending,
              SUM(status='inactive') AS inactive, SUM(status='revoked') AS revoked
       FROM license_seats WHERE purchase_id = ?`,
      [purchaseId]
    );
    const registered = Number(counts.active   || 0);
    const pending    = Number(counts.pending  || 0);
    const inactive   = Number(counts.inactive || 0);
    const revoked    = Number(counts.revoked  || 0);
    const total      = purchase ? purchase.seat_count : 0;
    const assigned   = registered + pending + inactive;
    const available  = Math.max(0, total - assigned);
    return res.json({
      utilization: { total, assigned, available, registered, pending, inactive, revoked },
      paymentStatus: purchase ? purchase.payment_status : null,
    });
  }

  if (type === 'teachers') {
    const [rows] = await pool.query(
      `SELECT su.first_name, su.last_name, su.email, su.role,
              ls.registered_at, ls.status AS seat_status,
              si.grade_level, si.department, si.role_title
       FROM license_seats ls
       JOIN site_users su ON su.id = ls.registered_site_user_id
       LEFT JOIN school_invitations si ON si.seat_id = ls.id
       WHERE ls.purchase_id = ?
       ORDER BY ls.registered_at`,
      [purchaseId]
    );
    return res.json({ teachers: rows });
  }

  if (type === 'invitations') {
    const [rows] = await pool.query(
      `SELECT si.invited_email, si.first_name, si.last_name, si.status,
              si.grade_level, si.department, si.created_at, si.expires_at,
              si.resend_count, si.revoked_at, si.revocation_reason,
              su.email AS invited_by_email
       FROM school_invitations si
       LEFT JOIN site_users su ON su.id = si.invited_by_site_user_id
       WHERE si.purchase_id = ?
       ORDER BY si.created_at DESC`,
      [purchaseId]
    );
    // Seats created by self-registration (no invitation row)
    const [selfRows] = await pool.query(
      `SELECT ls.id AS seat_id, ls.invited_email, ls.status
       FROM license_seats ls
       LEFT JOIN school_invitations si ON si.seat_id = ls.id
       WHERE ls.purchase_id = ? AND si.id IS NULL
       ORDER BY ls.id DESC`,
      [purchaseId]
    );
    return res.json({ invitations: rows, selfRegistered: selfRows });
  }

  if (type === 'activity') {
    const [rows] = await pool.query(
      `SELECT action, entity_type, entity_id, actor_email, reason, created_at, new_value
       FROM school_audit_log
       WHERE purchase_id = ?
       ORDER BY created_at DESC
       LIMIT 500`,
      [purchaseId]
    );
    return res.json({ activity: rows });
  }

  res.status(400).json({ error: 'Unknown report type' });
});

// GET /api/school-admin/reports/export?purchaseId=&type=teachers|invitations
router.get('/reports/export', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const type = req.query.type || 'teachers';

  if (type === 'teachers') {
    const [rows] = await pool.query(
      `SELECT su.first_name, su.last_name, su.email,
              ls.status AS seat_status, ls.registered_at,
              si.grade_level, si.department, si.role_title
       FROM license_seats ls
       JOIN site_users su ON su.id = ls.registered_site_user_id
       LEFT JOIN school_invitations si ON si.seat_id = ls.id
       WHERE ls.purchase_id = ?
       ORDER BY ls.registered_at`,
      [purchaseId]
    );

    const header = 'FirstName,LastName,Email,SeatStatus,RegisteredAt,GradeLevel,Department,Role\n';
    const csv = rows.map(r =>
      [r.first_name, r.last_name, r.email, r.seat_status,
       r.registered_at ? new Date(r.registered_at).toISOString().slice(0, 10) : '',
       r.grade_level || '', r.department || '', r.role_title || '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="teachers.csv"');
    return res.send(header + csv);
  }

  if (type === 'invitations') {
    const [rows] = await pool.query(
      'SELECT invited_email, first_name, last_name, status, grade_level, department, created_at, expires_at, resend_count FROM school_invitations WHERE purchase_id = ? ORDER BY created_at DESC',
      [purchaseId]
    );

    const header = 'Email,FirstName,LastName,Status,GradeLevel,Department,SentAt,ExpiresAt,ResendCount\n';
    const csv = rows.map(r =>
      [r.invited_email, r.first_name || '', r.last_name || '', r.status,
       r.grade_level || '', r.department || '',
       r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
       r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : '',
       r.resend_count]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invitations.csv"');
    return res.send(header + csv);
  }

  res.status(400).json({ error: 'Unknown export type' });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

// GET /api/school-admin/audit?purchaseId=&page=&limit=
router.get('/audit', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;

  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM school_audit_log WHERE purchase_id = ?',
    [purchaseId]
  );

  const [rows] = await pool.query(
    `SELECT sal.action, sal.entity_type, sal.entity_id, sal.actor_type, sal.actor_email,
            sal.reason, sal.prev_value, sal.new_value, sal.created_at,
            COALESCE(su.email, ls.invited_email) AS target_email
     FROM school_audit_log sal
     LEFT JOIN site_users su ON su.id = sal.entity_id AND sal.entity_type = 'site_user'
     LEFT JOIN license_seats ls ON ls.id = sal.entity_id AND sal.entity_type = 'seat'
     WHERE sal.purchase_id = ?
     ORDER BY sal.created_at DESC
     LIMIT ? OFFSET ?`,
    [purchaseId, limit, offset]
  );

  res.json({ entries: rows, total: Number(total), page, limit });
});

// ---------------------------------------------------------------------------
// Classroom monitoring (read-only; no student names or reflection content)
// ---------------------------------------------------------------------------

// GET /api/school-admin/classrooms
// Returns aggregate classroom stats for all licensed teachers in this school.
router.get('/classrooms', requireSchoolAdmin, async (req, res) => {
  const purchaseIds = req.schoolAdmin.purchaseIds;
  if (!purchaseIds.length) return res.json([]);

  // All registered seat holders for this school's purchases
  const [seats] = await pool.query(
    `SELECT DISTINCT ls.registered_site_user_id AS teacher_id, su.first_name, su.last_name
     FROM license_seats ls
     JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.purchase_id IN (?) AND ls.status = 'registered'`,
    [purchaseIds]
  );
  if (!seats.length) return res.json([]);

  const teacherIds = seats.map(s => s.teacher_id);
  const [classrooms] = await pool.query(
    `SELECT c.id, c.name AS classroom_name, c.teacher_site_user_id,
            c.grade_level, c.subject, c.academic_year, c.archived_at,
            (SELECT COUNT(*) FROM classroom_students cs WHERE cs.classroom_id = c.id AND cs.is_active = 1) AS student_count,
            (SELECT COUNT(*) FROM classroom_assignments ca WHERE ca.classroom_id = c.id) AS assignment_count,
            (SELECT COUNT(*) FROM student_lesson_progress slp WHERE slp.student_id IN (SELECT id FROM classroom_students WHERE classroom_id = c.id) AND slp.completed_at IS NOT NULL) AS completions,
            (SELECT COUNT(*) FROM student_lesson_progress slp WHERE slp.student_id IN (SELECT id FROM classroom_students WHERE classroom_id = c.id)) AS starts
     FROM classrooms c
     WHERE c.teacher_site_user_id IN (?)
     ORDER BY c.archived_at IS NOT NULL, c.created_at DESC`,
    [teacherIds]
  );

  const teacherMap = {};
  seats.forEach(s => { teacherMap[s.teacher_id] = `${s.first_name} ${s.last_name}`; });

  const result = classrooms.map(c => ({
    id: c.id,
    classroomName: c.classroom_name,
    teacherName: teacherMap[c.teacher_site_user_id] || 'Unknown',
    gradeLevel: c.grade_level,
    subject: c.subject,
    academicYear: c.academic_year,
    archived: !!c.archived_at,
    studentCount: Number(c.student_count),
    assignmentCount: Number(c.assignment_count),
    completionRate: c.starts > 0 ? Math.round((c.completions / c.starts) * 100) : 0,
  }));

  res.json(result);
});

// ---------------------------------------------------------------------------
// School Branding
// ---------------------------------------------------------------------------

function resolvePurchaseId(req) {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];
  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) return null;
  return purchaseId;
}

const BRANDING_COLOR_FIELDS = ['primary_color', 'secondary_color', 'accent_color'];
const BRANDING_LOGO_FIELDS = ['logo_original_url', 'logo_display_url'];
// Included in the editor payload but deliberately NOT part of the
// hasUnpublishedChanges diff below — logo_display_url already changes
// whenever a crop is applied, so diffing that is sufficient signal; diffing
// logo_crop too would compare JSON object references, not content.
const BRANDING_LOGO_EXTRA_FIELDS = ['logo_crop'];

function pickBranding(row, prefix) {
  const out = {};
  [...BRANDING_LOGO_FIELDS, ...BRANDING_LOGO_EXTRA_FIELDS, ...BRANDING_COLOR_FIELDS].forEach((f) => {
    out[f] = row ? row[`${prefix}_${f}`] : null;
  });
  return out;
}

// GET /api/school-admin/branding/resolved?purchaseId= — the school's
// published branding with derived shades/contrast colors already computed,
// same shape teacher/student/parent get. Used to theme the admin's OWN
// dashboard pages, as distinct from the editor payload below (which needs
// the raw draft/published columns, not the derived display values).
router.get('/branding/resolved', requireSchoolAdmin, async (req, res) => {
  const purchaseId = resolvePurchaseId(req);
  if (purchaseId === null) return res.status(403).json({ error: 'Access denied to this school' });
  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  const branding = await getPublishedBranding(schoolId);
  res.json({ branding });
});

// GET /api/school-admin/branding?purchaseId=
router.get('/branding', requireSchoolAdmin, async (req, res) => {
  const purchaseId = resolvePurchaseId(req);
  if (purchaseId === null) return res.status(403).json({ error: 'Access denied to this school' });

  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  if (!schoolId) return res.status(404).json({ error: 'This school has no school record yet — contact support.' });

  const [[school]] = await pool.query('SELECT display_name, domain FROM schools WHERE id = ?', [schoolId]);
  const [[row]] = await pool.query('SELECT * FROM school_branding WHERE school_id = ?', [schoolId]);

  const published = pickBranding(row, 'published');
  const draft = pickBranding(row, 'draft');
  // The edit form always starts from whatever is currently live if no
  // in-progress draft exists yet — never persisted, just how the form seeds.
  const draftForEditing = { ...published, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null)) };

  const hasUnpublishedChanges = row
    ? [...BRANDING_LOGO_FIELDS, ...BRANDING_COLOR_FIELDS].some(f => row[`draft_${f}`] != null && row[`draft_${f}`] !== row[`published_${f}`])
    : false;

  res.json({
    schoolId,
    schoolDisplayName: school.display_name || school.domain,
    status: row ? row.branding_status : 'DEFAULT',
    published,
    draft: draftForEditing,
    hasUnpublishedChanges,
  });
});

// PUT /api/school-admin/branding — save draft colors
router.put('/branding', requireSchoolAdmin, async (req, res) => {
  const purchaseId = resolvePurchaseId(req);
  if (purchaseId === null) return res.status(403).json({ error: 'Access denied to this school' });
  if (blockIfReadOnly(req, res, purchaseId)) return;

  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  if (!schoolId) return res.status(404).json({ error: 'This school has no school record yet — contact support.' });

  const { primaryColor, secondaryColor, accentColor } = req.body || {};
  const hexOk = (v) => !v || /^#[0-9a-fA-F]{6}$/.test(v);
  if (!hexOk(primaryColor)) return res.status(400).json({ error: 'Primary color must be a valid hex value, e.g. #003B71' });
  if (!hexOk(secondaryColor)) return res.status(400).json({ error: 'Secondary color must be a valid hex value.' });
  if (!hexOk(accentColor)) return res.status(400).json({ error: 'Accent color must be a valid hex value.' });

  await upsertDraftColors({
    table: 'school_branding', idColumn: 'school_id', id: schoolId,
    primaryColor, secondaryColor, accentColor, updatedBy: req.schoolAdmin.siteUserId,
  });

  res.json({ ok: true });
});

// POST /api/school-admin/branding/logo — upload + validate + resize a logo
router.post('/branding/logo', requireSchoolAdmin, (req, res, next) => {
  logoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  const purchaseId = resolvePurchaseId(req);
  if (purchaseId === null) return res.status(403).json({ error: 'Access denied to this school' });
  if (blockIfReadOnly(req, res, purchaseId)) return;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  if (!schoolId) return res.status(404).json({ error: 'This school has no school record yet — contact support.' });

  try {
    const result = await processLogoUpload({
      table: 'school_branding', idColumn: 'school_id', id: schoolId,
      fileBuffer: req.file.buffer, mimetype: req.file.mimetype, updatedBy: req.schoolAdmin.siteUserId,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// PUT /api/school-admin/branding/logo/crop — non-destructive crop/reposition,
// always re-derived from the stored original (never a previously-cropped copy)
router.put('/branding/logo/crop', requireSchoolAdmin, async (req, res) => {
  const purchaseId = resolvePurchaseId(req);
  if (purchaseId === null) return res.status(403).json({ error: 'Access denied to this school' });
  if (blockIfReadOnly(req, res, purchaseId)) return;

  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  if (!schoolId) return res.status(404).json({ error: 'This school has no school record yet — contact support.' });

  try {
    const result = await applyLogoCrop({
      table: 'school_branding', idColumn: 'school_id', id: schoolId,
      cropRect: (req.body || {}).cropRect, updatedBy: req.schoolAdmin.siteUserId,
    });
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST /api/school-admin/branding/publish
router.post('/branding/publish', requireSchoolAdmin, async (req, res) => {
  const { purchaseId: rawPurchaseId } = req.body || {};
  const purchaseId = rawPurchaseId ? Number(rawPurchaseId) : resolvePurchaseId(req);
  if (purchaseId === null || !req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied to this school' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;

  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  if (!schoolId) return res.status(404).json({ error: 'This school has no school record yet — contact support.' });

  try {
    await publishBranding({ table: 'school_branding', idColumn: 'school_id', id: schoolId, updatedBy: req.schoolAdmin.siteUserId });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'branding_published',
    entityType: 'school_branding', entityId: schoolId, purchaseId, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// POST /api/school-admin/branding/reset — restore FNE default look
router.post('/branding/reset', requireSchoolAdmin, async (req, res) => {
  const { purchaseId: rawPurchaseId } = req.body || {};
  const purchaseId = rawPurchaseId ? Number(rawPurchaseId) : resolvePurchaseId(req);
  if (purchaseId === null || !req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied to this school' });
  }
  if (blockIfReadOnly(req, res, purchaseId)) return;

  const schoolId = await resolveSchoolIdForPurchase(purchaseId);
  if (!schoolId) return res.status(404).json({ error: 'This school has no school record yet — contact support.' });

  await resetBranding({ table: 'school_branding', idColumn: 'school_id', id: schoolId, updatedBy: req.schoolAdmin.siteUserId });

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'branding_reset',
    entityType: 'school_branding', entityId: schoolId, purchaseId, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Content Safety — alert recipient configuration
// (CONTENT_SAFETY_IMPLEMENTATION_PLAN.md §4 — this IS the entire "who gets
// notified" configuration; there is no separate safety-admin role/portal.)
// ---------------------------------------------------------------------------

const SAFETY_CATEGORY_OPTIONS = [
  'profanity', 'bullying', 'hostility', 'hate_bias', 'sexual_safety',
  'self_harm', 'threat_violence', 'unsafe_conduct', 'privacy_pii', 'image_nudity',
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function resolveSchoolDomainForPurchase(req, res, purchaseId) {
  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  const [[row]] = await pool.query('SELECT school_domain FROM purchases WHERE id = ?', [purchaseId]);
  if (!row || !row.school_domain) {
    res.status(400).json({ error: 'This school has no domain set yet — contact support before configuring safety alerts.' });
    return null;
  }
  return row.school_domain;
}

// GET /api/school-admin/safety-alert-recipients?purchaseId=
router.get('/safety-alert-recipients', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId ? Number(req.query.purchaseId) : req.schoolAdmin.purchaseIds[0];
  const schoolDomain = await resolveSchoolDomainForPurchase(req, res, purchaseId);
  if (!schoolDomain) return;

  const [rows] = await pool.query(
    'SELECT id, category, email, label, is_active, created_at FROM safety_alert_recipients WHERE school_domain = ? ORDER BY category IS NULL, category, id',
    [schoolDomain]
  );
  res.json({ recipients: rows, categoryOptions: SAFETY_CATEGORY_OPTIONS });
});

// POST /api/school-admin/safety-alert-recipients { purchaseId, category, email, label }
router.post('/safety-alert-recipients', requireSchoolAdmin, async (req, res) => {
  const purchaseId = Number(req.body && req.body.purchaseId);
  if (blockIfReadOnly(req, res, purchaseId)) return;
  const schoolDomain = await resolveSchoolDomainForPurchase(req, res, purchaseId);
  if (!schoolDomain) return;

  const email = (req.body.email || '').trim();
  const category = req.body.category || null; // null = catch-all
  const label = (req.body.label || '').trim() || null;
  if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'A valid email address is required' });
  if (category && !SAFETY_CATEGORY_OPTIONS.includes(category)) return res.status(400).json({ error: 'Unknown category' });

  const [result] = await pool.query(
    'INSERT INTO safety_alert_recipients (school_domain, category, email, label) VALUES (?, ?, ?, ?)',
    [schoolDomain, category, email, label]
  );
  res.status(201).json({ id: result.insertId });
});

// PUT /api/school-admin/safety-alert-recipients/:id { purchaseId, isActive }
router.put('/safety-alert-recipients/:id', requireSchoolAdmin, async (req, res) => {
  const purchaseId = Number(req.body && req.body.purchaseId);
  if (blockIfReadOnly(req, res, purchaseId)) return;
  const schoolDomain = await resolveSchoolDomainForPurchase(req, res, purchaseId);
  if (!schoolDomain) return;

  const isActive = req.body.isActive === true || req.body.isActive === 1 ? 1 : 0;
  const [result] = await pool.query(
    'UPDATE safety_alert_recipients SET is_active = ? WHERE id = ? AND school_domain = ?',
    [isActive, req.params.id, schoolDomain]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// DELETE /api/school-admin/safety-alert-recipients/:id?purchaseId=
router.delete('/safety-alert-recipients/:id', requireSchoolAdmin, async (req, res) => {
  const purchaseId = Number(req.query.purchaseId);
  if (blockIfReadOnly(req, res, purchaseId)) return;
  const schoolDomain = await resolveSchoolDomainForPurchase(req, res, purchaseId);
  if (!schoolDomain) return;

  const [result] = await pool.query(
    'DELETE FROM safety_alert_recipients WHERE id = ? AND school_domain = ?',
    [req.params.id, schoolDomain]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// GET /api/school-admin/check-email?email= — lets the invite UI warn BEFORE
// sending that this email already has an account, so the admin isn't
// surprised later when the invitee lands on a sign-in screen instead of
// "create a password" (see the service@vssus.com incident this was built
// for). Deliberately returns only a boolean — a school admin has no
// business seeing what OTHER school/role that account is tied to; that
// full picture is FNE-staff-only (admin-account-lookup.html).
router.get('/check-email', requireSchoolAdmin, async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.json({ exists: false });
  const [[row]] = await pool.query('SELECT 1 FROM site_users WHERE email = ?', [email]);
  res.json({ exists: !!row });
});

module.exports = router;
