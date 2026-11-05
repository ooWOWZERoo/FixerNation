// Support console, the staff side of "help this person" (Release 121). Requirements and access matrix:
// docs/reference/support-console-requirements.md. Every route is requireAuth (the admin login) and everything that changes
// something, or shows student names, is written to the audit log by id (never a PIN, a link or a message).
//
//   GET  /timeline?email=                         the person's history, newest first
//   POST /accounts/:id/reset-link                 a one-time password reset link, shown on screen (not emailed)
//   POST /accounts/:id/sign-out                   end every session this account has
//   POST /accounts/:id/resend-verification        email a new verification link (unverified accounts)
//   GET  /classrooms?q=                           classroom(s) by teacher email, join code or student username; students and lockouts
//   POST /students/:id/reset-pin                  new random PIN, shown once
//   POST /students/:id/clear-lock                 clear a student's PIN lockout
//   GET  /parents?email=                          a parent's children and invitations
//   PUT  /parent-invitations/:id/extend|revoke
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const { createToken } = require('../lib/site-tokens');
const { sendVerificationEmail } = require('../lib/mailer');
const { generatePin } = require('../lib/pin');
const { clearLock } = require('../lib/pin-lockout');
const { buildTimeline, findClassrooms, parentView } = require('../lib/support-console');

const router = express.Router();
const PARENT_INVITE_EXTENSION_DAYS = 14;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const log = (req, action, entityType, entityId, extra = {}) =>
  audit(pool, { actorType: 'admin', actorId: req.user && req.user.userId, action, entityType, entityId, ipAddress: clientIp(req), ...extra });

function idParam(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(404).json({ error: 'Not found' }); return null; }
  return id;
}
function emailQuery(req, res) {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email)) { res.status(400).json({ error: 'Enter a valid email address' }); return null; }
  return email;
}

// GET /timeline?email=
router.get('/timeline', requireAuth, async (req, res) => {
  const email = emailQuery(req, res);
  if (!email) return;
  res.json(await buildTimeline(pool, email));
});

async function siteUser(req, res) {
  const id = idParam(req, res);
  if (!id) return null;
  const [[user]] = await pool.query(
    'SELECT id, first_name, email, role, email_verified, is_fne_staff, closed_at FROM site_users WHERE id = ?', [id]);
  if (!user) { res.status(404).json({ error: 'No account with that id' }); return null; }
  return user;
}

// POST /accounts/:id/reset-link -- the link is shown to staff, who pass it to the person. Finishing it also marks the email verified.
router.post('/accounts/:id/reset-link', requireAuth, async (req, res) => {
  const user = await siteUser(req, res);
  if (!user) return;
  if (user.is_fne_staff || user.role === 'admin') return res.status(409).json({ code: 'staff_account', error: 'This is a Fixer Nation staff account. Use the normal password reset email for it.' });
  if (user.closed_at) return res.status(409).json({ code: 'closed', error: 'This account is closed. Reopen it first.' });
  const token = await createToken(user.id, 'reset', 60 * 60 * 1000);
  await log(req, 'support_reset_link_shown', 'site_user', user.id);
  res.json({ url: `${process.env.SITE_URL || ''}/reset-password.html?token=${token}`, expiresInMinutes: 60 });
});

// POST /accounts/:id/sign-out
router.post('/accounts/:id/sign-out', requireAuth, async (req, res) => {
  const user = await siteUser(req, res);
  if (!user) return;
  await pool.query('UPDATE site_users SET session_invalidated_at = NOW() WHERE id = ?', [user.id]);
  await log(req, 'support_signed_out_everywhere', 'site_user', user.id);
  res.json({ ok: true });
});

// POST /accounts/:id/resend-verification
router.post('/accounts/:id/resend-verification', requireAuth, async (req, res) => {
  const user = await siteUser(req, res);
  if (!user) return;
  if (user.email_verified) return res.status(400).json({ error: 'This account is already verified' });
  const token = await createToken(user.id, 'verify', 24 * 60 * 60 * 1000);
  try {
    await sendVerificationEmail({ to: user.email, firstName: user.first_name, verifyUrl: `${process.env.SITE_URL || ''}/api/site-auth/verify?token=${token}` });
  } catch (err) {
    console.error('support-console: verification email failed:', err.message);
    return res.status(502).json({ error: 'The email could not be sent. Use "Show reset link" instead and give it to them.' });
  }
  await log(req, 'support_verification_resent', 'site_user', user.id);
  res.json({ ok: true });
});

// GET /classrooms?q=
router.get('/classrooms', requireAuth, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 255) : '';
  if (!q) return res.status(400).json({ error: 'Enter a teacher email, a classroom code or a student username' });
  const classrooms = await findClassrooms(pool, q);
  for (const c of classrooms) await log(req, 'support_viewed_classroom', 'classroom', c.id);
  res.json({ classrooms });
});

async function student(req, res) {
  const id = idParam(req, res);
  if (!id) return null;
  const [[row]] = await pool.query('SELECT id, username, classroom_id, is_active FROM classroom_students WHERE id = ?', [id]);
  if (!row) { res.status(404).json({ error: 'Student not found' }); return null; }
  return row;
}

// POST /students/:id/reset-pin -- the new PIN is in this response only: stored scrambled, never logged
router.post('/students/:id/reset-pin', requireAuth, async (req, res) => {
  const s = await student(req, res);
  if (!s) return;
  const pin = generatePin();
  await pool.query('UPDATE classroom_students SET password_hash = ? WHERE id = ?', [await bcrypt.hash(pin, 10), s.id]);
  clearLock(s.username);
  await log(req, 'support_student_pin_reset', 'student', s.id);
  res.json({ pin, username: s.username, active: !!s.is_active });
});

// POST /students/:id/clear-lock
router.post('/students/:id/clear-lock', requireAuth, async (req, res) => {
  const s = await student(req, res);
  if (!s) return;
  clearLock(s.username);
  await log(req, 'support_student_lock_cleared', 'student', s.id);
  res.json({ ok: true });
});

// GET /parents?email=
router.get('/parents', requireAuth, async (req, res) => {
  const email = emailQuery(req, res);
  if (!email) return;
  const view = await parentView(pool, email);
  if (view.account) await log(req, 'support_viewed_parent', 'site_user', view.account.id);
  res.json(view);
});

async function pendingInvitation(req, res) {
  const id = idParam(req, res);
  if (!id) return null;
  const [[inv]] = await pool.query('SELECT id, status FROM parent_student_invitations WHERE id = ?', [id]);
  if (!inv) { res.status(404).json({ error: 'Invitation not found' }); return null; }
  if (inv.status !== 'pending') { res.status(409).json({ error: 'Only a pending invitation can be changed' }); return null; }
  return inv;
}

// PUT /parent-invitations/:id/extend -- another 14 days from now; the parent re-opens the link they were already sent
router.put('/parent-invitations/:id/extend', requireAuth, async (req, res) => {
  const inv = await pendingInvitation(req, res);
  if (!inv) return;
  await pool.query('UPDATE parent_student_invitations SET expires_at = ? WHERE id = ?',
    [new Date(Date.now() + PARENT_INVITE_EXTENSION_DAYS * 24 * 60 * 60 * 1000), inv.id]);
  await log(req, 'support_parent_invitation_extended', 'parent_invitation', inv.id);
  res.json({ ok: true, days: PARENT_INVITE_EXTENSION_DAYS });
});

// PUT /parent-invitations/:id/revoke
router.put('/parent-invitations/:id/revoke', requireAuth, async (req, res) => {
  const inv = await pendingInvitation(req, res);
  if (!inv) return;
  await pool.query("UPDATE parent_student_invitations SET status = 'revoked', revoked_at = NOW() WHERE id = ?", [inv.id]);
  await log(req, 'support_parent_invitation_revoked', 'parent_invitation', inv.id);
  res.json({ ok: true });
});

module.exports = router;
