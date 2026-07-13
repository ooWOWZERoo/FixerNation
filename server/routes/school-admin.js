const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireSchoolAdmin, requireWritePermission } = require('../middleware/schoolAdminAuth');
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
     FROM school_invitations WHERE purchase_id = ? AND status NOT IN ('revoked')`,
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
  const assigned = Number(counts.registered || 0) + Number(counts.pending || 0);
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
            p.purchased_at, p.invoice_id, p.notes,
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

  // Co-admins on this purchase
  const [admins] = await pool.query(
    `SELECT sla.id, sla.permission_level, sla.is_active, sla.created_at,
            su.first_name, su.last_name, su.email
     FROM school_license_admins sla
     JOIN site_users su ON su.id = sla.site_user_id
     WHERE sla.purchase_id = ?
     ORDER BY sla.created_at`,
    [purchaseId]
  );

  res.json({
    purchaseId: row.id,
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
    notes: row.notes,
    admins,
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
            si.grade_level, si.department, si.expires_at, si.resend_count,
            si.last_resent_at, si.revoked_at, si.revocation_reason, si.created_at,
            ls.status AS seat_status, ls.registered_at, ls.registered_site_user_id,
            su.first_name AS teacher_first_name, su.last_name AS teacher_last_name,
            su.email AS teacher_email
     FROM school_invitations si
     LEFT JOIN license_seats ls ON ls.id = si.seat_id
     LEFT JOIN site_users su ON su.id = ls.registered_site_user_id
     ${where}
     ORDER BY si.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  // Auto-mark expired invitations
  await pool.query(
    "UPDATE school_invitations SET status = 'expired' WHERE purchase_id = ? AND status = 'pending' AND expires_at < NOW()",
    [purchaseId]
  );

  res.json({ invitations: rows, total: Number(total), page, limit });
});

// POST /api/school-admin/invitations — send a single invitation
router.post('/invitations', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const { purchaseId: rawPurchaseId, email, firstName, lastName, gradeLevel, roleName, department, subjectArea, personalMessage } = req.body || {};
  const purchaseId = rawPurchaseId ? Number(rawPurchaseId) : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
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
      "SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ? AND status NOT IN ('revoked')",
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
router.post('/invitations/bulk', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const { purchaseId: rawPurchaseId, invitations } = req.body || {};
  const purchaseId = rawPurchaseId ? Number(rawPurchaseId) : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
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
      "SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ? AND status NOT IN ('revoked')",
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
        "SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ? AND status NOT IN ('revoked')",
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
router.put('/invitations/:id/resend', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
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
router.put('/invitations/:id/revoke', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const { reason } = req.body || {};
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
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
router.put('/invitations/:id/extend', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const [[inv]] = await pool.query(
    'SELECT * FROM school_invitations WHERE id = ? AND purchase_id IN (?)',
    [req.params.id, req.schoolAdmin.purchaseIds]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
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

  if (q) {
    where += ' AND (su.email LIKE ? OR su.first_name LIKE ? OR su.last_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (statusFilter === 'inactive') {
    where = 'WHERE ls.purchase_id = ? AND su.role = ?';
    params.splice(0, params.length, purchaseId, 'inactive_teacher');
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

  res.json({ teachers: rows, total: Number(total), page, limit });
});

// PUT /api/school-admin/teachers/:siteUserId/deactivate
router.put('/teachers/:siteUserId/deactivate', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Verify teacher belongs to this school
  const [[seat]] = await pool.query(
    "SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ? AND status = 'registered'",
    [purchaseId, siteUserId]
  );
  if (!seat) return res.status(404).json({ error: 'Teacher not found under this school' });

  await pool.query("UPDATE license_seats SET status = 'inactive' WHERE id = ?", [seat.id]);
  await pool.query("UPDATE site_users SET role = 'inactive_teacher' WHERE id = ?", [siteUserId]);

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'teacher_deactivated',
    entityType: 'site_user', entityId: siteUserId, purchaseId,
    reason: req.body && req.body.reason, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// PUT /api/school-admin/teachers/:siteUserId/reactivate
router.put('/teachers/:siteUserId/reactivate', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const [[seat]] = await pool.query(
    "SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ? AND status = 'inactive'",
    [purchaseId, siteUserId]
  );
  if (!seat) return res.status(404).json({ error: 'Inactive teacher not found under this school' });

  await pool.query("UPDATE license_seats SET status = 'registered' WHERE id = ?", [seat.id]);
  await pool.query("UPDATE site_users SET role = 'teacher' WHERE id = ?", [siteUserId]);

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'teacher_reactivated',
    entityType: 'site_user', entityId: siteUserId, purchaseId, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// DELETE /api/school-admin/teachers/:siteUserId — remove from school (keeps site_user account)
router.delete('/teachers/:siteUserId', requireSchoolAdmin, requireWritePermission, async (req, res) => {
  const siteUserId = Number(req.params.siteUserId);
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const [[seat]] = await pool.query(
    "SELECT id, invited_email FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?",
    [purchaseId, siteUserId]
  );
  if (!seat) return res.status(404).json({ error: 'Teacher not found under this school' });

  const reason = (req.body && req.body.reason) || 'Removed by administrator';

  await pool.query(
    "UPDATE license_seats SET status = 'revoked', revoked_at = NOW(), revoked_by = ?, revocation_reason = ? WHERE id = ?",
    [req.schoolAdmin.siteUserId, reason, seat.id]
  );

  // If they were a school_license_admin under this purchase, remove that too
  await pool.query(
    'DELETE FROM school_license_admins WHERE site_user_id = ? AND purchase_id = ?',
    [siteUserId, purchaseId]
  );

  await audit(pool, {
    actorType: 'site_user', actorId: req.schoolAdmin.siteUserId,
    actorEmail: req.schoolAdmin.email, action: 'teacher_removed',
    entityType: 'site_user', entityId: siteUserId, purchaseId, reason, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

// GET /api/school-admin/licenses?purchaseId=
router.get('/licenses', requireSchoolAdmin, async (req, res) => {
  const purchaseId = req.query.purchaseId
    ? Number(req.query.purchaseId)
    : req.schoolAdmin.purchaseIds[0];

  if (!req.schoolAdmin.purchaseIds.includes(purchaseId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const [[purchase]] = await pool.query(
    'SELECT id, seat_count, payment_status, school_domain FROM purchases WHERE id = ?',
    [purchaseId]
  );

  const [seats] = await pool.query(
    `SELECT ls.id, ls.invited_email, ls.status, ls.registered_at, ls.revoked_at,
            ls.revocation_reason, ls.invitation_id,
            su.id AS site_user_id, su.first_name, su.last_name, su.email,
            si.created_at AS invited_at, si.resend_count
     FROM license_seats ls
     LEFT JOIN site_users su ON su.id = ls.registered_site_user_id
     LEFT JOIN school_invitations si ON si.seat_id = ls.id
     WHERE ls.purchase_id = ?
     ORDER BY ls.registered_at DESC, ls.id DESC`,
    [purchaseId]
  );

  const total = purchase ? purchase.seat_count : 0;
  const active = seats.filter(s => s.status === 'registered').length;
  const pending = seats.filter(s => s.status === 'pending').length;
  const revoked = seats.filter(s => s.status === 'revoked').length;
  const available = Math.max(0, total - active - pending);

  res.json({
    total,
    active,
    pending,
    revoked,
    available,
    paymentStatus: purchase ? purchase.payment_status : null,
    seats,
  });
});

// PUT /api/school-admin/seats/:seatId/revoke
router.put('/seats/:seatId/revoke', requireSchoolAdmin, requireWritePermission, async (req, res) => {
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
      "SELECT COUNT(*) AS total, SUM(status='registered') AS active, SUM(status='pending') AS pending, SUM(status='revoked') AS revoked FROM license_seats WHERE purchase_id = ?",
      [purchaseId]
    );
    return res.json({ purchase, counts });
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
              si.resend_count, si.revoked_at, si.revocation_reason
       FROM school_invitations si
       WHERE si.purchase_id = ?
       ORDER BY si.created_at DESC`,
      [purchaseId]
    );
    return res.json({ invitations: rows });
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
    `SELECT action, entity_type, entity_id, actor_type, actor_email,
            reason, prev_value, new_value, created_at
     FROM school_audit_log
     WHERE purchase_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [purchaseId, limit, offset]
  );

  res.json({ entries: rows, total: Number(total), page, limit });
});

module.exports = router;
