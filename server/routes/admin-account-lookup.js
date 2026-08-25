// FNE-staff-only account reconciliation tool. Built after the
// service@vssus.com incident: one real site_users account can be invited
// under different names, to different schools, for different roles, over
// time -- with no single place to see all of it or clean it up. Every
// action here reuses the exact same underlying update logic
// school-admin.js's own routes use (revoke a seat, revoke an invitation),
// just without the requireSchoolAdmin purchaseIds scoping, since FNE staff
// are allowed to act system-wide. School/district admin assignment actions
// aren't duplicated here -- they're already unscoped for FNE at
// admin-school-admins.js/admin-districts.js, so this route just reuses
// those directly from the frontend rather than re-implementing them.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/account-lookup?email=
router.get('/', requireAuth, async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const [[account]] = await pool.query(
    'SELECT id, first_name, last_name, email, role, email_verified, session_invalidated_at, created_at FROM site_users WHERE email = ?',
    [email]
  );

  const [invitations] = await pool.query(
    `SELECT si.id, si.first_name, si.last_name, si.status, si.created_at, si.expires_at, si.seat_id, p.school_domain
     FROM school_invitations si
     JOIN purchases p ON p.id = si.purchase_id
     WHERE si.invited_email = ?
     ORDER BY si.created_at DESC`,
    [email]
  );

  const [seats] = await pool.query(
    `SELECT ls.id, ls.status, ls.registered_at, ls.invited_email, p.school_domain
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     WHERE ls.invited_email = ? OR ls.registered_site_user_id = ?
     ORDER BY ls.id DESC`,
    [email, account ? account.id : 0]
  );

  let schoolAdminAssignments = [];
  let districtAdminAssignments = [];
  if (account) {
    [schoolAdminAssignments] = await pool.query(
      `SELECT sla.id, sla.permission_level, sla.is_active, sla.created_at, p.school_domain
       FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id
       WHERE sla.site_user_id = ? ORDER BY sla.created_at DESC`,
      [account.id]
    );
    [districtAdminAssignments] = await pool.query(
      `SELECT dla.id, dla.is_active, dla.created_at, d.name AS district_name
       FROM district_license_admins dla JOIN districts d ON d.id = dla.district_id
       WHERE dla.site_user_id = ? ORDER BY dla.created_at DESC`,
      [account.id]
    );
  }

  res.json({ account: account || null, invitations, seats, schoolAdminAssignments, districtAdminAssignments });
});

// PUT /api/admin/account-lookup/invitations/:id/cancel
router.put('/invitations/:id/cancel', requireAuth, async (req, res) => {
  const [[inv]] = await pool.query('SELECT * FROM school_invitations WHERE id = ?', [req.params.id]);
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (['revoked', 'registered'].includes(inv.status)) {
    return res.status(409).json({ error: `Cannot cancel a ${inv.status} invitation` });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE school_invitations SET status = 'revoked', revoked_at = NOW(), revocation_reason = ? WHERE id = ?",
      ['Cancelled by FNE staff', inv.id]
    );
    if (inv.seat_id) {
      await conn.query(
        "UPDATE license_seats SET status = 'revoked', revoked_at = NOW(), revocation_reason = ? WHERE id = ? AND status = 'pending'",
        ['Invitation cancelled by FNE staff', inv.seat_id]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, purchase_id, ip_address)
     VALUES ('admin_user', ?, ?, 'invitation_cancelled_by_fne', 'invitation', ?, ?, ?)`,
    [req.user.userId, req.user.username, inv.id, inv.purchase_id, req.ip]
  );

  res.json({ ok: true });
});

// PUT /api/admin/account-lookup/seats/:id/revoke
router.put('/seats/:id/revoke', requireAuth, async (req, res) => {
  const [[seat]] = await pool.query('SELECT * FROM license_seats WHERE id = ?', [req.params.id]);
  if (!seat) return res.status(404).json({ error: 'Seat not found' });
  if (seat.status === 'revoked') return res.status(409).json({ error: 'Seat is already revoked' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE license_seats SET status = 'revoked', revoked_at = NOW(), revocation_reason = ? WHERE id = ?",
      ['Revoked by FNE staff', seat.id]
    );
    await conn.query(
      "UPDATE school_invitations SET status = 'revoked', revoked_at = NOW(), revocation_reason = ? WHERE seat_id = ? AND status NOT IN ('revoked','registered')",
      ['Seat revoked by FNE staff', seat.id]
    );
    if (seat.registered_site_user_id) {
      await conn.query('UPDATE site_users SET session_invalidated_at = NOW() WHERE id = ?', [seat.registered_site_user_id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, purchase_id, ip_address)
     VALUES ('admin_user', ?, ?, 'seat_revoked_by_fne', 'license_seat', ?, ?, ?)`,
    [req.user.userId, req.user.username, seat.id, seat.purchase_id, req.ip]
  );

  res.json({ ok: true });
});

module.exports = router;
