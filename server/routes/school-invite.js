// Public invitation acceptance routes — no school-admin auth required.
// Teachers click links that land here to claim their invitation.
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME, SITE_COOKIE_MAX_AGE_MS } = require('../lib/session');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Helper: get the logged-in site_user from the session cookie, or null.
async function getLoggedInUser(req) {
  const cookieToken = req.cookies && req.cookies[SITE_COOKIE_NAME];
  if (!cookieToken) return null;
  try {
    const payload = jwt.verify(cookieToken, process.env.SESSION_SECRET);
    const [[user]] = await pool.query('SELECT id, email, first_name, last_name FROM site_users WHERE id = ?', [payload.userId]);
    return user || null;
  } catch {
    return null;
  }
}

// GET /api/school-invite/validate?token=xxx
// Returns invitation details for the acceptance landing page — safe to call
// without authentication. Also detects if the visitor is already logged in
// so the page can branch between "claim" and "register" flows.
router.get('/validate', async (req, res) => {
  const token = (req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const [[inv]] = await pool.query(
    `SELECT si.id, si.status, si.invited_email, si.first_name, si.last_name,
            si.expires_at, si.personal_message, si.grade_level, si.department,
            p.school_domain, p.payment_status,
            lp.name AS plan_name,
            su.first_name AS admin_first, su.last_name AS admin_last
     FROM school_invitations si
     JOIN purchases p ON p.id = si.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     LEFT JOIN school_license_admins sla ON sla.purchase_id = p.id AND sla.is_active = 1
     LEFT JOIN site_users su ON su.id = sla.site_user_id
     WHERE si.token = ?
     LIMIT 1`,
    [token]
  );

  if (!inv) return res.status(404).json({ error: 'Invitation not found or has already been used' });

  // Mark expired
  if (inv.status === 'pending' && new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE school_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    inv.status = 'expired';
  }

  if (inv.status === 'revoked') {
    return res.status(410).json({ error: 'This invitation has been revoked. Contact your school administrator.' });
  }
  if (inv.status === 'expired') {
    return res.status(410).json({ error: 'This invitation has expired. Contact your school administrator to request a new one.' });
  }
  if (inv.status === 'registered') {
    return res.status(409).json({ error: 'This invitation has already been used.', alreadyRegistered: true });
  }
  if (inv.payment_status !== 'paid') {
    return res.status(422).json({ error: "Your school's group licensing is not yet active. Please contact your administrator.", paymentPending: true });
  }

  // Mark as opened (first time)
  if (inv.status === 'pending') {
    await pool.query("UPDATE school_invitations SET status = 'opened' WHERE id = ? AND status = 'pending'", [inv.id]);
  }

  // Check if the visitor is already logged in
  const loggedInUser = await getLoggedInUser(req);
  const loggedIn = !!loggedInUser;
  const emailMatches = loggedIn ? loggedInUser.email.toLowerCase() === inv.invited_email.toLowerCase() : null;
  const adminName = [inv.admin_first, inv.admin_last].filter(Boolean).join(' ') || null;

  res.json({
    valid: true,
    invitationId: inv.id,
    invitedEmail: inv.invited_email,
    firstName: inv.first_name,
    lastName: inv.last_name,
    schoolDomain: inv.school_domain,
    planName: inv.plan_name || 'Group License',
    personalMessage: inv.personal_message,
    expiresAt: inv.expires_at,
    adminName,
    loggedIn,
    emailMatches,
    userEmail: loggedIn ? loggedInUser.email : null,
  });
});

// POST /api/school-invite/claim
// Called by an already-logged-in site_user to claim an invitation
// (handles the case where a teacher already has an account and clicks the link).
router.post('/claim', async (req, res) => {
  const loggedInUser = await getLoggedInUser(req);
  if (!loggedInUser) return res.status(401).json({ error: 'You must be logged in to claim this invitation' });

  const invToken = ((req.body && req.body.token) || '').trim();
  if (!invToken) return res.status(400).json({ error: 'Invitation token is required' });

  const [[inv]] = await pool.query(
    `SELECT si.*, p.payment_status, p.school_domain
     FROM school_invitations si
     JOIN purchases p ON p.id = si.purchase_id
     WHERE si.token = ?`,
    [invToken]
  );

  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (inv.status === 'registered') return res.status(409).json({ error: 'This invitation has already been claimed' });
  if (new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE school_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    return res.status(410).json({ error: 'This invitation has expired' });
  }
  if (inv.payment_status !== 'paid') {
    return res.status(422).json({ error: "Your school's group licensing is not yet active." });
  }
  if (inv.invited_email.toLowerCase() !== loggedInUser.email.toLowerCase()) {
    return res.status(403).json({ error: 'This invitation was sent to a different email address.' });
  }

  // Mark the linked seat as registered
  if (inv.seat_id) {
    await pool.query(
      "UPDATE license_seats SET status = 'registered', registered_site_user_id = ?, registered_at = NOW() WHERE id = ? AND status IN ('pending','inactive')",
      [loggedInUser.id, inv.seat_id]
    );
  }

  await pool.query("UPDATE school_invitations SET status = 'registered' WHERE id = ?", [inv.id]);

  try {
    const { addTeacherToSocialGroups } = require('../lib/social-groups');
    await addTeacherToSocialGroups(loggedInUser.id);
  } catch (e) {
    console.error('addTeacherToSocialGroups failed:', e.message);
  }

  res.json({ ok: true, schoolDomain: inv.school_domain });
});

// POST /api/school-invite/register
// New-user flow: creates a site_user account and claims the invitation seat.
// Called from school-invite-accept.html when the visitor has no account.
router.post('/register', async (req, res) => {
  const { token, firstName, lastName, password } = req.body || {};
  if (!token || !firstName || !lastName || !password) {
    return res.status(400).json({ error: 'token, firstName, lastName, and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const [[inv]] = await pool.query(
    `SELECT si.*, p.payment_status, p.school_domain
     FROM school_invitations si
     JOIN purchases p ON p.id = si.purchase_id
     WHERE si.token = ?`,
    [token.trim()]
  );

  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (inv.status === 'registered') return res.status(409).json({ error: 'This invitation has already been used' });
  if (new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE school_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    return res.status(410).json({ error: 'This invitation has expired' });
  }
  if (inv.payment_status !== 'paid') {
    return res.status(422).json({ error: "Your school's group licensing is not yet active." });
  }

  const email = inv.invited_email.toLowerCase();

  // Check for existing account
  const [[existing]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email]);
  if (existing) {
    return res.status(409).json({ error: 'An account already exists for this email address. Please sign in to claim the invitation.' });
  }

  const bcrypt = require('bcrypt');
  const hashedPassword = await bcrypt.hash(password, 12);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [insertResult] = await conn.query(
      `INSERT INTO site_users (email, first_name, last_name, password_hash, email_verified, role, created_at)
       VALUES (?, ?, ?, ?, 1, 'teacher', NOW())`,
      [email, firstName.trim(), lastName.trim(), hashedPassword]
    );
    const newUserId = insertResult.insertId;

    // Claim the seat
    if (inv.seat_id) {
      await conn.query(
        "UPDATE license_seats SET status = 'registered', registered_site_user_id = ?, registered_at = NOW() WHERE id = ? AND status IN ('pending','inactive')",
        [newUserId, inv.seat_id]
      );
    }

    await conn.query("UPDATE school_invitations SET status = 'registered' WHERE id = ?", [inv.id]);

    // Optionally add to newsletter (non-blocking, best-effort)
    conn.query(
      `INSERT IGNORE INTO newsletter_contacts (email, first_name, last_name, created_at) VALUES (?, ?, ?, NOW())`,
      [email, firstName.trim(), lastName.trim()]
    ).catch(() => {});

    await conn.commit();

    // Issue a session cookie so the user lands already logged in
    try {
      const sessionToken = jwt.sign(
        { userId: newUserId, firstName: firstName.trim(), role: 'teacher' },
        process.env.SESSION_SECRET,
        { expiresIn: '30d' }
      );
      res.cookie(SITE_COOKIE_NAME, sessionToken, {
        httpOnly: true, sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SITE_COOKIE_MAX_AGE_MS,
      });
    } catch (e) {
      console.error('session cookie failed after invite register:', e.message);
    }

    try {
      const { addTeacherToSocialGroups } = require('../lib/social-groups');
      await addTeacherToSocialGroups(newUserId);
    } catch (e) {
      console.error('addTeacherToSocialGroups failed:', e.message);
    }

    res.json({ ok: true, schoolDomain: inv.school_domain });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account already exists for this email address.' });
    }
    throw e;
  } finally {
    conn.release();
  }
});

module.exports = router;
