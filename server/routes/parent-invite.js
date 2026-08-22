// Public invitation acceptance routes — no parent auth required. Parents
// click links (emailed from a teacher via POST /api/classrooms/:id/students/
// :sid/invite-parent) that land here to claim their invitation and link to
// their specific child. Mirrors server/routes/school-invite.js's structure
// closely (validate / claim / register), substituting classroom+student for
// purchase+seat and role 'parent' for 'teacher'.
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME, SITE_COOKIE_MAX_AGE_MS } = require('../lib/session');
const jwt = require('jsonwebtoken');

const router = express.Router();

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

async function linkParentToStudent(userId, inv) {
  await pool.query(
    `INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE student_id = VALUES(student_id)`,
    [userId, inv.classroom_id, inv.student_id]
  );
  await pool.query("UPDATE parent_student_invitations SET status = 'accepted' WHERE id = ?", [inv.id]);
}

// GET /api/parent-invite/validate?token=xxx
router.get('/validate', async (req, res) => {
  const token = (req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const [[inv]] = await pool.query(
    `SELECT psi.*, cs.display_name AS student_name, c.name AS class_name,
            su.first_name AS teacher_first, su.last_name AS teacher_last
     FROM parent_student_invitations psi
     JOIN classroom_students cs ON cs.id = psi.student_id
     JOIN classrooms c ON c.id = psi.classroom_id
     LEFT JOIN site_users su ON su.id = psi.invited_by_site_user_id
     WHERE psi.token = ?
     LIMIT 1`,
    [token]
  );
  if (!inv) return res.status(404).json({ error: 'Invitation not found or has already been used' });

  if (inv.status === 'pending' && new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE parent_student_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    inv.status = 'expired';
  }
  if (inv.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked. Contact the teacher who sent it.' });
  if (inv.status === 'expired') return res.status(410).json({ error: 'This invitation has expired. Contact the teacher to request a new one.' });
  if (inv.status === 'accepted') return res.status(409).json({ error: 'This invitation has already been used.', alreadyAccepted: true });

  const loggedInUser = await getLoggedInUser(req);
  const loggedIn = !!loggedInUser;
  const emailMatches = loggedIn ? loggedInUser.email.toLowerCase() === inv.invited_email.toLowerCase() : null;
  const [[existingUser]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [inv.invited_email.toLowerCase()]);

  res.json({
    valid: true,
    invitedEmail: inv.invited_email,
    studentName: inv.student_name,
    className: inv.class_name,
    teacherName: [inv.teacher_first, inv.teacher_last].filter(Boolean).join(' ') || null,
    personalMessage: inv.personal_message,
    expiresAt: inv.expires_at,
    loggedIn,
    emailMatches,
    emailHasAccount: !!existingUser,
    userEmail: loggedIn ? loggedInUser.email : null,
  });
});

// POST /api/parent-invite/claim — already-logged-in site_user claims the invite
router.post('/claim', async (req, res) => {
  const loggedInUser = await getLoggedInUser(req);
  if (!loggedInUser) return res.status(401).json({ error: 'You must be logged in to claim this invitation' });

  const invToken = ((req.body && req.body.token) || '').trim();
  if (!invToken) return res.status(400).json({ error: 'Invitation token is required' });

  const [[inv]] = await pool.query('SELECT * FROM parent_student_invitations WHERE token = ?', [invToken]);
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (inv.status === 'accepted') return res.status(409).json({ error: 'This invitation has already been claimed' });
  if (new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE parent_student_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    return res.status(410).json({ error: 'This invitation has expired' });
  }
  if (inv.invited_email.toLowerCase() !== loggedInUser.email.toLowerCase()) {
    return res.status(403).json({ error: 'This invitation was sent to a different email address.' });
  }

  if (loggedInUser.role !== 'parent') {
    await pool.query("UPDATE site_users SET role = 'parent' WHERE id = ? AND role NOT IN ('admin')", [loggedInUser.id]);
  }
  await linkParentToStudent(loggedInUser.id, inv);

  res.json({ ok: true, className: undefined });
});

// POST /api/parent-invite/register — new-user flow
router.post('/register', async (req, res) => {
  const { token, firstName, lastName, password } = req.body || {};
  if (!token || !firstName || !lastName || !password) {
    return res.status(400).json({ error: 'token, firstName, lastName, and password are all required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const [[inv]] = await pool.query('SELECT * FROM parent_student_invitations WHERE token = ?', [token.trim()]);
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (inv.status === 'accepted') return res.status(409).json({ error: 'This invitation has already been used' });
  if (new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE parent_student_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    return res.status(410).json({ error: 'This invitation has expired' });
  }

  const email = inv.invited_email.toLowerCase();
  const [[existing]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'An account already exists for this email address. Please sign in to claim the invitation.' });

  const hashedPassword = await bcrypt.hash(password, 12);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [insertResult] = await conn.query(
      `INSERT INTO site_users (email, first_name, last_name, password_hash, email_verified, role, created_at)
       VALUES (?, ?, ?, ?, 1, 'parent', NOW())`,
      [email, firstName.trim(), lastName.trim(), hashedPassword]
    );
    const newUserId = insertResult.insertId;

    await conn.query(
      `INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE student_id = VALUES(student_id)`,
      [newUserId, inv.classroom_id, inv.student_id]
    );
    await conn.query("UPDATE parent_student_invitations SET status = 'accepted' WHERE id = ?", [inv.id]);
    await conn.commit();

    const sessionToken = jwt.sign(
      { userId: newUserId, firstName: firstName.trim(), role: 'parent' },
      process.env.SESSION_SECRET,
      { expiresIn: '30d' }
    );
    res.cookie(SITE_COOKIE_NAME, sessionToken, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SITE_COOKIE_MAX_AGE_MS,
    });

    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account already exists for this email address.' });
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/parent-invite/accept-and-verify — existing but unverified account
router.post('/accept-and-verify', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });

  const [[inv]] = await pool.query('SELECT * FROM parent_student_invitations WHERE token = ?', [token.trim()]);
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (inv.status === 'accepted') return res.status(409).json({ error: 'This invitation has already been claimed' });
  if (new Date(inv.expires_at) < new Date()) {
    await pool.query("UPDATE parent_student_invitations SET status = 'expired' WHERE id = ?", [inv.id]);
    return res.status(410).json({ error: 'This invitation has expired' });
  }

  const email = inv.invited_email.toLowerCase();
  const [[user]] = await pool.query('SELECT id, first_name, role, password_hash FROM site_users WHERE email = ?', [email]);
  if (!user) return res.status(404).json({ error: 'No account found for this email. Please use the "Create Account" form.' });

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) return res.status(401).json({ error: 'Incorrect password.' });

  await pool.query('UPDATE site_users SET email_verified = 1 WHERE id = ?', [user.id]);
  if (user.role !== 'parent') {
    await pool.query("UPDATE site_users SET role = 'parent' WHERE id = ? AND role NOT IN ('admin')", [user.id]);
  }
  await linkParentToStudent(user.id, inv);

  const sessionToken = jwt.sign(
    { userId: user.id, firstName: user.first_name, role: 'parent' },
    process.env.SESSION_SECRET,
    { expiresIn: '30d' }
  );
  res.cookie(SITE_COOKIE_NAME, sessionToken, {
    httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SITE_COOKIE_MAX_AGE_MS,
  });

  res.json({ ok: true });
});

module.exports = router;
