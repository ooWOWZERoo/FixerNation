const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { signSession, verifySession } = require('../lib/session-tokens');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { COOKIE_NAME, COOKIE_MAX_AGE_MS } = require('../lib/session');
const { sendAdminInviteEmail, sendAdminPasswordResetEmail } = require('../lib/mailer');
const { FailureTracker, rejectIfBlocked, clientIp } = require('../lib/rate-limit');
const { ownedRecordCounts, reassignOwned } = require('../lib/crm-ownership');
const { requireCrmRole, ROLES: CRM_ROLES } = require('../lib/crm-permissions');
const { audit } = require('../lib/audit');

// Punch list S1: managing admin accounts (invite, edit, reset, delete) is a CRM Admin action. A new admin starts as Read-only until a CRM Admin picks a role.
const manageAdmins = requireCrmRole('assign_roles');
async function auditAdmin(req, action, entityId, extra) {
  await audit(pool, { actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username, action, entityType: 'admin_user', entityId: entityId || null, newValue: extra || null, ipAddress: req.ip });
}

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Failed-login throttles. Per account (so a botnet can't hammer one admin from
// many IPs) and per IP (so one host can't spray many usernames). Only failures
// count, and a success clears the account's counter.
const loginFailsByAccount = new FailureTracker({ name: 'admin-login-acct', windowMs: 15 * 60 * 1000, max: 8 });
const loginFailsByIp = new FailureTracker({ name: 'admin-login-ip', windowMs: 15 * 60 * 1000, max: 30 });
// Compared against when no such account exists, so "unknown username" takes as
// long as "wrong password" and response timing can't enumerate admin accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// Sets an admin's new password and revokes every session issued before now.
// Falls back to the plain update if scripts/alter-add-admin-session-invalidated.js
// hasn't been run yet, so a password change/invite can never 500 on deploy order.
async function setAdminPassword(adminId, passwordHash, { markVerified = false } = {}) {
  const verified = markVerified ? ', email_verified = 1' : '';
  try {
    await pool.query(`UPDATE admin_users SET password_hash = ?${verified}, session_invalidated_at = NOW() WHERE id = ?`, [passwordHash, adminId]);
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    await pool.query(`UPDATE admin_users SET password_hash = ?${verified} WHERE id = ?`, [passwordHash, adminId]);
  }
}

function setSessionCookie(res, user) {
  const token = signSession('admin', { userId: user.id, username: user.username }, '24h');
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1000) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }

  const acctKey = username.trim().toLowerCase();
  const ip = clientIp(req);
  if (rejectIfBlocked(res, [[loginFailsByAccount, acctKey], [loginFailsByIp, ip]])) return;

  // Accepts either the literal username or the account's email — usernames
  // like "AJP-VSSUS" aren't something an admin reliably remembers.
  const [rows] = await pool.query('SELECT id, username, password_hash, email_verified FROM admin_users WHERE username = ? OR email = ?', [username, username]);
  const user = rows[0];

  // Always run a bcrypt compare, and check the password BEFORE telling anyone
  // anything about the account's state. This used to answer "please activate
  // your account" (403) before looking at the password, which confirmed to an
  // anonymous caller that a username/email belongs to a real, not-yet-active
  // admin. A pending admin has no usable password yet, so they can't get past
  // the compare -- they follow their emailed invite link instead.
  const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !matches) {
    loginFailsByAccount.fail(acctKey);
    loginFailsByIp.fail(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please activate your admin account using the link emailed to you first.' });
  }

  loginFailsByAccount.clear(acctKey);
  setSessionCookie(res, user);
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.json({ loggedIn: false });
  }
  try {
    const payload = verifySession('admin', token);
    res.json({ loggedIn: true, username: payload.username });
  } catch {
    res.json({ loggedIn: false });
  }
});

router.put('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const [rows] = await pool.query('SELECT id, password_hash FROM admin_users WHERE id = ?', [req.user.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  // Revoke every other browser's session for this admin (a stolen cookie must
  // not survive a password change), then reissue one for THIS browser: its new
  // iat lands at-or-after session_invalidated_at, so it survives requireAuth.
  await setAdminPassword(user.id, newHash);
  const [[fresh]] = await pool.query('SELECT id, username FROM admin_users WHERE id = ?', [user.id]);
  if (fresh) setSessionCookie(res, fresh);
  res.json({ ok: true });
});

// --- Admin invites (lets an existing admin add another) ---

router.get('/admins', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, email, email_verified, created_at FROM admin_users ORDER BY created_at');
  res.json({
    admins: rows.map(r => ({
      id: r.id,
      username: r.username,
      email: r.email,
      emailVerified: !!r.email_verified,
      createdAt: r.created_at,
    })),
  });
});

router.post('/admins', requireAuth, manageAdmins, async (req, res) => {
  const b = req.body || {};
  const username = (b.username || '').trim();
  const email = (b.email || '').trim();

  if (!username || !email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Username and a valid email are required' });
  }

  const [existingUsername] = await pool.query('SELECT id FROM admin_users WHERE username = ?', [username]);
  if (existingUsername[0]) return res.status(409).json({ error: 'That username is already taken' });
  const [existingEmail] = await pool.query('SELECT id FROM admin_users WHERE email = ?', [email]);
  if (existingEmail[0]) return res.status(409).json({ error: 'That email is already registered to an admin' });

  // Unusable random password — the invited admin can't log in until they
  // follow the invite link below and set their own.
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  // Least privilege: a new admin is Read-only unless the CRM Admin inviting them names a role. (Before the CRM alter script has run there is no column to set.)
  const crmRole = b.crmRole === undefined || b.crmRole === null || b.crmRole === '' ? 'readonly' : String(b.crmRole);
  if (!CRM_ROLES.includes(crmRole)) return res.status(400).json({ error: 'Role must be admin, sales or readonly' });
  let result;
  try {
    [result] = await pool.query(
      'INSERT INTO admin_users (username, password_hash, email, email_verified, crm_role) VALUES (?, ?, ?, 0, ?)',
      [username, placeholderHash, email, crmRole]
    );
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    [result] = await pool.query(
      'INSERT INTO admin_users (username, password_hash, email, email_verified) VALUES (?, ?, ?, 0)',
      [username, placeholderHash, email]
    );
  }
  await auditAdmin(req, 'admin_invited', result.insertId, { username, email, crmRole });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO admin_invite_tokens (admin_id, token, expires_at) VALUES (?, ?, ?)',
    [result.insertId, token, expiresAt]
  );

  const inviteUrl = `${process.env.SITE_URL || ''}/admin-accept-invite.html?token=${token}`;
  await sendAdminInviteEmail({ to: email, username, inviteUrl });

  res.status(201).json({ ok: true, admin: { id: result.insertId, username, email, emailVerified: false } });
});

// Resend the invite email to a still-pending admin, in case the original
// link expired or was never received — replaces the old token with a fresh one.
router.post('/admins/:id/resend-invite', requireAuth, manageAdmins, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, email, email_verified FROM admin_users WHERE id = ?', [req.params.id]);
  const admin = rows[0];
  if (!admin) return res.status(404).json({ error: 'Admin not found' });
  if (admin.email_verified) {
    return res.status(400).json({ error: 'This admin has already activated their account — use Send Password Reset instead.' });
  }

  await pool.query('DELETE FROM admin_invite_tokens WHERE admin_id = ?', [admin.id]);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query('INSERT INTO admin_invite_tokens (admin_id, token, expires_at) VALUES (?, ?, ?)', [admin.id, token, expiresAt]);

  const inviteUrl = `${process.env.SITE_URL || ''}/admin-accept-invite.html?token=${token}`;
  await sendAdminInviteEmail({ to: admin.email, username: admin.username, inviteUrl });
  res.json({ ok: true });
});

// Sends an already-active admin a link to set a new password — same
// token/landing-page mechanism as the invite flow, distinct email copy,
// triggered by another admin rather than self-service (there's no admin
// "forgot password" flow on the login page).
router.post('/admins/:id/send-password-reset', requireAuth, manageAdmins, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, email, email_verified FROM admin_users WHERE id = ?', [req.params.id]);
  const admin = rows[0];
  if (!admin) return res.status(404).json({ error: 'Admin not found' });
  if (!admin.email_verified) {
    return res.status(400).json({ error: 'This admin has not activated their account yet — use Resend Invite instead.' });
  }
  if (!admin.email) return res.status(400).json({ error: 'This admin has no email on file' });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query('INSERT INTO admin_invite_tokens (admin_id, token, expires_at) VALUES (?, ?, ?)', [admin.id, token, expiresAt]);

  const resetUrl = `${process.env.SITE_URL || ''}/admin-accept-invite.html?token=${token}`;
  await sendAdminPasswordResetEmail({ to: admin.email, username: admin.username, resetUrl });
  await auditAdmin(req, 'admin_password_reset_sent', admin.id, { username: admin.username });
  res.json({ ok: true });
});

router.put('/admins/:id', requireAuth, manageAdmins, async (req, res) => {
  const b = req.body || {};
  const username = (b.username || '').trim();
  const email = (b.email || '').trim();
  if (!username || !email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Username and a valid email are required' });
  }

  const [rows] = await pool.query('SELECT id FROM admin_users WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });

  const [existingUsername] = await pool.query('SELECT id FROM admin_users WHERE username = ? AND id != ?', [username, req.params.id]);
  if (existingUsername[0]) return res.status(409).json({ error: 'That username is already taken' });
  const [existingEmail] = await pool.query('SELECT id FROM admin_users WHERE email = ? AND id != ?', [email, req.params.id]);
  if (existingEmail[0]) return res.status(409).json({ error: 'That email is already registered to another admin' });

  await pool.query('UPDATE admin_users SET username = ?, email = ? WHERE id = ?', [username, email, req.params.id]);
  await auditAdmin(req, 'admin_edited', Number(req.params.id), { username, email });
  res.json({ ok: true });
});

// Guards: an admin can't delete their own account (avoids accidental
// self-lockout), and the last remaining admin can never be deleted (the
// site would otherwise have no way to log in and add another).
router.delete('/admins/:id', requireAuth, manageAdmins, async (req, res) => {
  if (Number(req.params.id) === req.user.userId) {
    return res.status(400).json({ error: "You can't delete your own admin account." });
  }
  const [countRows] = await pool.query('SELECT COUNT(*) AS count FROM admin_users');
  if (countRows[0].count <= 1) {
    return res.status(400).json({ error: 'At least one admin must remain.' });
  }

  // Sales CRM (decision D13): an admin who owns contacts, accounts or deals must say who takes them over (or choose to leave them unassigned).
  // Without an answer nothing is deleted. A database without the CRM tables owns nothing, so this is a no-op there.
  const adminId = Number(req.params.id);
  const owned = await ownedRecordCounts(pool, adminId);
  const b = req.body || {};
  let reassignedTo = null;
  if (owned.total > 0) {
    const to = Number(b.reassignTo);
    if (!Number.isInteger(to) && b.unassign !== true) {
      return res.status(409).json({
        code: 'owns_crm_records', owned,
        error: `This admin owns ${owned.total} CRM record${owned.total === 1 ? '' : 's'} (${owned.contacts} contact${owned.contacts === 1 ? '' : 's'}, ${owned.accounts} account${owned.accounts === 1 ? '' : 's'}, ${owned.opportunities} deal${owned.opportunities === 1 ? '' : 's'}). Choose who takes them over, or leave them unassigned.`,
      });
    }
    if (Number.isInteger(to)) {
      if (to === adminId) return res.status(400).json({ error: 'Choose a different admin to take them over.' });
      const [[target]] = await pool.query('SELECT id FROM admin_users WHERE id = ? AND email_verified = 1', [to]);
      if (!target) return res.status(400).json({ error: 'That admin does not exist or has not activated their account.' });
      reassignedTo = to;
    }
  }
  // The last CRM Admin cannot be deleted either, or nobody could edit CRM settings or roles. (Skipped where the role column does not exist yet.)
  try {
    const [[me]] = await pool.query('SELECT crm_role FROM admin_users WHERE id = ?', [adminId]);
    if (me && me.crm_role === 'admin') {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM admin_users WHERE crm_role = 'admin' AND email_verified = 1 AND id <> ?", [adminId]);
      if (Number(n) === 0) return res.status(400).json({ error: 'This is the last Sales CRM admin. Give another admin the CRM Admin role first.' });
    }
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
  }
  if (owned.total > 0) await reassignOwned(pool, adminId, reassignedTo);

  const [result] = await pool.query('DELETE FROM admin_users WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Admin not found' });
  await auditAdmin(req, 'admin_deleted', adminId, { reassigned: owned.total, reassignedTo });
  res.json({ ok: true, reassigned: owned.total, reassignedTo });
});

router.post('/accept-invite', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const [rows] = await pool.query(
    'SELECT * FROM admin_invite_tokens WHERE token = ? AND expires_at > NOW()',
    [token]
  );
  const record = rows[0];
  if (!record) return res.status(400).json({ error: 'This invite link is invalid or has expired.' });

  const passwordHash = await bcrypt.hash(password, 12);
  // An invite or reset link sets a brand-new password, so any session that
  // existed under the old one is revoked too.
  await setAdminPassword(record.admin_id, passwordHash, { markVerified: true });
  await pool.query('DELETE FROM admin_invite_tokens WHERE id = ?', [record.id]);

  res.json({ ok: true });
});

module.exports = { router };
