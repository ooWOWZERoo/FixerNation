const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { COOKIE_NAME, COOKIE_MAX_AGE_MS } = require('../lib/session');
const { sendAdminInviteEmail } = require('../lib/mailer');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSessionCookie(res, user) {
  const token = jwt.sign({ userId: user.id, username: user.username }, process.env.SESSION_SECRET, {
    expiresIn: '24h',
  });
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

  const [rows] = await pool.query('SELECT id, username, password_hash, email_verified FROM admin_users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please activate your admin account using the link emailed to you first.' });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

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
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
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
  await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
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

router.post('/admins', requireAuth, async (req, res) => {
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
  const [result] = await pool.query(
    'INSERT INTO admin_users (username, password_hash, email, email_verified) VALUES (?, ?, ?, 0)',
    [username, placeholderHash, email]
  );

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
  await pool.query('UPDATE admin_users SET password_hash = ?, email_verified = 1 WHERE id = ?', [passwordHash, record.admin_id]);
  await pool.query('DELETE FROM admin_invite_tokens WHERE id = ?', [record.id]);

  res.json({ ok: true });
});

module.exports = { router };
