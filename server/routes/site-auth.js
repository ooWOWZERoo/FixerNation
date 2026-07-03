const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME, SITE_COOKIE_MAX_AGE_MS } = require('../lib/session');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSiteSessionCookie(res, user) {
  const token = jwt.sign({ userId: user.id, firstName: user.first_name }, process.env.SESSION_SECRET, {
    expiresIn: '30d',
  });
  res.cookie(SITE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SITE_COOKIE_MAX_AGE_MS,
  });
}

async function createToken(userId, type, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query('INSERT INTO site_user_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)', [userId, token, type, expiresAt]);
  return token;
}

async function consumeToken(token, type) {
  const [rows] = await pool.query(
    'SELECT * FROM site_user_tokens WHERE token = ? AND type = ? AND expires_at > NOW()',
    [token, type]
  );
  if (!rows[0]) return null;
  await pool.query('DELETE FROM site_user_tokens WHERE id = ?', [rows[0].id]);
  return rows[0];
}

router.post('/signup', async (req, res) => {
  const b = req.body || {};
  const firstName = (b.firstName || '').trim();
  const lastName = (b.lastName || '').trim();
  const email = (b.email || '').trim();
  const password = b.password || '';

  if (!firstName || !lastName || !email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'First name, last name, and a valid email are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const [existing] = await pool.query('SELECT id FROM site_users WHERE email = ?', [email]);
  if (existing[0]) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    'INSERT INTO site_users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)',
    [firstName, lastName, email, passwordHash]
  );

  // Add to the CRM contact list, per the site's newsletter policy — but don't
  // clobber an existing contact's data if this email is already there.
  const [existingContact] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (!existingContact[0]) {
    await pool.query(
      'INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, ?, ?)',
      [`${firstName} ${lastName}`, email, 'Homepage', 'Subscribed']
    );
  }

  const verifyToken = await createToken(result.insertId, 'verify', 24 * 60 * 60 * 1000);
  const verifyUrl = `${process.env.SITE_URL || ''}/api/site-auth/verify?token=${verifyToken}`;
  await sendVerificationEmail({ to: email, firstName, verifyUrl });

  res.status(201).json({ ok: true, message: 'Check your email to verify your account before logging in.' });
});

router.get('/verify', async (req, res) => {
  res.set('Content-Type', 'text/html');
  const token = req.query.token || '';
  const record = await consumeToken(token, 'verify');
  if (!record) {
    return res.status(400).send('<p style="font-family:sans-serif; padding:40px; text-align:center;">This verification link is invalid or has expired. <a href="/fixernation-redesign.html">Return to the homepage</a> to request a new one.</p>');
  }
  await pool.query('UPDATE site_users SET email_verified = 1 WHERE id = ?', [record.user_id]);
  res.send('<p style="font-family:sans-serif; padding:40px; text-align:center;">Your email is verified! You can now log in. <a href="/fixernation-redesign.html">Return to the homepage</a>.</p>');
});

router.post('/resend-verification', async (req, res) => {
  const email = (req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const [rows] = await pool.query('SELECT id, first_name, email_verified FROM site_users WHERE email = ?', [email]);
  const user = rows[0];
  // Always respond ok to avoid revealing whether an email exists.
  if (user && !user.email_verified) {
    const verifyToken = await createToken(user.id, 'verify', 24 * 60 * 60 * 1000);
    const verifyUrl = `${process.env.SITE_URL || ''}/api/site-auth/verify?token=${verifyToken}`;
    await sendVerificationEmail({ to: email, firstName: user.first_name, verifyUrl });
  }
  res.json({ ok: true });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const [rows] = await pool.query('SELECT * FROM site_users WHERE email = ?', [email.trim()]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email before logging in.', reason: 'unverified' });
  }

  setSiteSessionCookie(res, user);
  res.json({ ok: true, firstName: user.first_name });
});

router.post('/logout', (req, res) => {
  res.clearCookie(SITE_COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.json({ loggedIn: false });
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    res.json({ loggedIn: true, firstName: payload.firstName });
  } catch {
    res.json({ loggedIn: false });
  }
});

router.post('/forgot-password', async (req, res) => {
  const email = (req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const [rows] = await pool.query('SELECT id, first_name FROM site_users WHERE email = ?', [email]);
  const user = rows[0];
  // Always respond ok, regardless of whether the email is registered.
  if (user) {
    const resetToken = await createToken(user.id, 'reset', 60 * 60 * 1000);
    const resetUrl = `${process.env.SITE_URL || ''}/reset-password.html?token=${resetToken}`;
    await sendPasswordResetEmail({ to: email, firstName: user.first_name, resetUrl });
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const record = await consumeToken(token, 'reset');
  if (!record) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE site_users SET password_hash = ? WHERE id = ?', [passwordHash, record.user_id]);
  res.json({ ok: true });
});

module.exports = { router };
