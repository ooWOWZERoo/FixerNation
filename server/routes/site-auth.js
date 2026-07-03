const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME, SITE_COOKIE_MAX_AGE_MS } = require('../lib/session');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');
const { attachPurchaseDetails } = require('./newsletter');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Site-user session check for the self-service "My License" endpoints below —
// mirrors /me's cookie/JWT verification but rejects with 401 instead of a
// { loggedIn: false } body, and resolves the full user row.
async function requireSiteAuth(req, res, next) {
  const token = req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [payload.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'Not logged in' });
    req.siteUser = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Not logged in' });
  }
}

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

  // If a license seat (single or group) was invited to this exact email,
  // signing up claims it — this is what actually grants that teacher access.
  await pool.query(
    "UPDATE license_seats SET status = 'registered', registered_site_user_id = ?, registered_at = NOW() WHERE invited_email = ? AND status = 'pending'",
    [result.insertId, email]
  );

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

// --- Self-service license view for logged-in site users (teachers / school admins) ---

router.get('/my-purchases', requireSiteAuth, async (req, res) => {
  const [contactRows] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [req.siteUser.email]);
  if (!contactRows[0]) return res.json({ purchases: [] });

  const [rows] = await pool.query('SELECT * FROM purchases WHERE contact_id = ? ORDER BY purchased_at DESC', [contactRows[0].id]);
  res.json({ purchases: await attachPurchaseDetails(rows) });
});

// Lets the buyer (e.g. a school administrator) hand out an open group-license
// seat to a teacher by email, without needing a Fixer Nation admin involved.
router.put('/my-purchases/:purchaseId/seats/:seatId', requireSiteAuth, async (req, res) => {
  const [contactRows] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [req.siteUser.email]);
  const contactId = contactRows[0] && contactRows[0].id;

  const [purchaseRows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [req.params.purchaseId]);
  const purchase = purchaseRows[0];
  if (!purchase || purchase.contact_id !== contactId) {
    return res.status(404).json({ error: 'Purchase not found' });
  }

  const [seatRows] = await pool.query('SELECT * FROM license_seats WHERE id = ? AND purchase_id = ?', [req.params.seatId, purchase.id]);
  const seat = seatRows[0];
  if (!seat) return res.status(404).json({ error: 'Seat not found' });
  if (seat.status !== 'pending') return res.status(409).json({ error: 'This seat has already been registered' });

  const invitedEmail = (req.body && req.body.invitedEmail || '').trim();
  if (invitedEmail && !EMAIL_PATTERN.test(invitedEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  await pool.query('UPDATE license_seats SET invited_email = ? WHERE id = ?', [invitedEmail || null, seat.id]);
  res.json({ ok: true });
});

// --- Admin management of site-user accounts ---

router.get('/site-users', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, first_name, last_name, email, email_verified, created_at FROM site_users ORDER BY created_at DESC');
  res.json({
    siteUsers: rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      emailVerified: !!r.email_verified,
      createdAt: r.created_at,
    })),
  });
});

router.put('/site-users/:id', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [req.params.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Site user not found' });

  const b = req.body || {};
  const firstName = b.firstName !== undefined ? b.firstName.trim() : user.first_name;
  const lastName = b.lastName !== undefined ? b.lastName.trim() : user.last_name;
  const email = b.email !== undefined ? b.email.trim() : user.email;

  if (!firstName || !lastName || !email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'First name, last name, and a valid email are required' });
  }

  if (email !== user.email) {
    const [existing] = await pool.query('SELECT id FROM site_users WHERE email = ? AND id != ?', [email, user.id]);
    if (existing[0]) return res.status(409).json({ error: 'Another account already uses that email' });
  }

  await pool.query('UPDATE site_users SET first_name = ?, last_name = ?, email = ? WHERE id = ?', [firstName, lastName, email, user.id]);
  res.json({ ok: true });
});

// Sends the customer the same password-reset email they'd get from
// self-service "Forgot Password", just initiated by the admin instead.
router.post('/site-users/:id/send-password-reset', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, first_name, email FROM site_users WHERE id = ?', [req.params.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Site user not found' });

  const resetToken = await createToken(user.id, 'reset', 60 * 60 * 1000);
  const resetUrl = `${process.env.SITE_URL || ''}/reset-password.html?token=${resetToken}`;
  await sendPasswordResetEmail({ to: user.email, firstName: user.first_name, resetUrl });
  res.json({ ok: true });
});

router.delete('/site-users/:id', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Free up any license seats this account had claimed so they can be
    // handed to someone else, rather than leaving an orphaned "registered"
    // seat with no linked account.
    await connection.query(
      "UPDATE license_seats SET status = 'pending', registered_site_user_id = NULL, registered_at = NULL WHERE registered_site_user_id = ?",
      [req.params.id]
    );
    const [result] = await connection.query('DELETE FROM site_users WHERE id = ?', [req.params.id]);
    await connection.commit();
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Site user not found' });
    res.json({ ok: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

module.exports = { router };
