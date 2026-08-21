const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME, SITE_COOKIE_MAX_AGE_MS } = require('../lib/session');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');
const { createToken, consumeToken } = require('../lib/site-tokens');
const { attachPurchaseDetails } = require('./newsletter');
const { requireAuth } = require('../middleware/auth');
const { addTeacherToSocialGroups } = require('../lib/social-groups');

const avatarsDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, 'avatar-' + req.siteUser.id + '-' + Date.now() + ext);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Images only (JPG, PNG, WebP, GIF)'), ok);
  },
});

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
    if (rows[0].session_invalidated_at) {
      const invalidatedMs = new Date(rows[0].session_invalidated_at).getTime();
      if (payload.iat * 1000 < invalidatedMs) {
        return res.status(401).json({ error: 'Not logged in', reason: 'revoked' });
      }
    }
    req.siteUser = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Not logged in' });
  }
}

function setSiteSessionCookie(res, user) {
  const token = jwt.sign(
    { userId: user.id, firstName: user.first_name, role: user.role || 'teacher' },
    process.env.SESSION_SECRET,
    { expiresIn: '30d' }
  );
  res.cookie(SITE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SITE_COOKIE_MAX_AGE_MS,
  });
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
  // signing up claims it — only for paid purchases, and domain must match for
  // group licenses (school_domain NULL means single/book with no domain constraint).
  const [seatResult] = await pool.query(
    `UPDATE license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     SET ls.status = 'registered', ls.registered_site_user_id = ?, ls.registered_at = NOW()
     WHERE ls.invited_email = ?
       AND ls.status = 'pending'
       AND p.payment_status = 'paid'
       AND (p.school_domain IS NULL OR LOWER(SUBSTRING_INDEX(?, '@', -1)) = LOWER(p.school_domain))`,
    [result.insertId, email, email]
  );
  if (seatResult.affectedRows > 0) {
    try { await addTeacherToSocialGroups(result.insertId); } catch (e) { console.error('addTeacherToSocialGroups failed:', e.message); }
    // Mark any school invitations for this email as registered
    pool.query(
      "UPDATE school_invitations SET status = 'registered' WHERE invited_email = ? AND status NOT IN ('revoked','registered','expired')",
      [email.toLowerCase()]
    ).catch(e => console.error('invitation status update failed:', e.message));
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
    return res.status(400).send('<p style="font-family:sans-serif; padding:40px; text-align:center;">This verification link is invalid or has expired. <a href="/index.html">Return to the homepage</a> to request a new one.</p>');
  }
  await pool.query('UPDATE site_users SET email_verified = 1 WHERE id = ?', [record.user_id]);
  res.send('<p style="font-family:sans-serif; padding:40px; text-align:center;">Your email is verified! You can now log in. <a href="/index.html">Return to the homepage</a>.</p>');
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
  res.json({ ok: true, firstName: user.first_name, role: user.role || 'teacher' });
});

router.post('/logout', (req, res) => {
  res.clearCookie(SITE_COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.json({ loggedIn: false });
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query('SELECT email FROM site_users WHERE id = ?', [payload.userId]);
    if (!rows[0]) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, firstName: payload.firstName, role: payload.role || 'teacher', email: rows[0].email });
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
  // Invalidate any other browser's session for this account — a stolen
  // cookie shouldn't keep working just because someone else reset the
  // password. The fresh cookie issued below (for THIS browser) is signed
  // after this UPDATE commits, so its iat lands at-or-after
  // session_invalidated_at and survives requireSiteAuth's revocation check.
  await pool.query(
    'UPDATE site_users SET password_hash = ?, email_verified = 1, session_invalidated_at = NOW() WHERE id = ?',
    [passwordHash, record.user_id]
  );

  const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [record.user_id]);
  if (rows[0]) setSiteSessionCookie(res, rows[0]);
  res.json({ ok: true });
});

// --- Self-service profile management ---

router.get('/profile', requireSiteAuth, async (req, res) => {
  const u = req.siteUser;
  const [[sp]] = await pool.query('SELECT avatar_url FROM social_profiles WHERE user_id = ?', [u.id]);
  res.json({ firstName: u.first_name, lastName: u.last_name, email: u.email, avatarUrl: sp ? sp.avatar_url : null });
});

router.post('/profile/avatar', requireSiteAuth, function(req, res, next) {
  avatarUpload.single('avatar')(req, res, function(err) {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const prefix = (process.env.UPLOADS_URL_PREFIX || '/uploads/') + 'avatars/';
  const avatarUrl = prefix + req.file.filename;
  await pool.query(
    'INSERT INTO social_profiles (user_id, avatar_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url)',
    [req.siteUser.id, avatarUrl]
  );
  res.json({ ok: true, avatarUrl });
});

router.put('/profile', requireSiteAuth, async (req, res) => {
  const b = req.body || {};
  const firstName = (b.firstName || '').trim();
  const lastName = (b.lastName || '').trim();
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required' });
  }
  await pool.query('UPDATE site_users SET first_name = ?, last_name = ? WHERE id = ?', [firstName, lastName, req.siteUser.id]);
  const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [req.siteUser.id]);
  if (rows[0]) setSiteSessionCookie(res, rows[0]);
  res.json({ ok: true, firstName });
});

router.put('/change-password', requireSiteAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const matches = await bcrypt.compare(currentPassword, req.siteUser.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Invalidate any other browser's session for this account, same as
  // reset-password. Reissue a fresh cookie for THIS browser right after —
  // otherwise this very request's own session would revoke itself, since
  // its cookie's iat predates the session_invalidated_at we just set.
  await pool.query('UPDATE site_users SET password_hash = ?, session_invalidated_at = NOW() WHERE id = ?', [passwordHash, req.siteUser.id]);
  const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [req.siteUser.id]);
  if (rows[0]) setSiteSessionCookie(res, rows[0]);
  res.json({ ok: true });
});

// --- Self-service license view for logged-in site users (teachers / school admins) ---

router.get('/my-purchases', requireSiteAuth, async (req, res) => {
  const [contactRows] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [req.siteUser.email]);
  if (!contactRows[0]) return res.json({ purchases: [], memberships: [] });
  const contactId = contactRows[0].id;

  const [rows] = await pool.query('SELECT * FROM purchases WHERE contact_id = ? ORDER BY purchased_at DESC', [contactId]);
  const purchases = await attachPurchaseDetails(rows);

  const [membershipRows] = await pool.query(
    `SELECT cm.id, cm.status, cm.ends_at, mp.name AS plan_name, mp.member_type
     FROM contact_memberships cm
     JOIN membership_plans mp ON mp.id = cm.membership_plan_id
     WHERE cm.contact_id = ?
     ORDER BY cm.id DESC`,
    [contactId]
  );
  const memberships = membershipRows.map(m => ({
    id: m.id,
    planName: m.plan_name,
    memberType: m.member_type,
    status: m.status,
    endsAt: m.ends_at,
  }));

  res.json({ purchases, memberships });
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

// --- Audience / grade-level preferences (teachers) ---

const VALID_AUDIENCES = ['Elementary School', 'Middle School', 'High School', 'Higher Education'];

router.get('/me/audiences', requireSiteAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT audience FROM site_user_audiences WHERE site_user_id = ?',
    [req.siteUser.id]
  );
  res.json({ audiences: rows.map(r => r.audience) });
});

router.put('/me/audiences', requireSiteAuth, async (req, res) => {
  const audiences = Array.isArray(req.body && req.body.audiences) ? req.body.audiences : [];
  const invalid = audiences.find(a => !VALID_AUDIENCES.includes(a));
  if (invalid) return res.status(400).json({ error: `Invalid audience value: ${invalid}` });

  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM site_user_audiences WHERE site_user_id = ?', [req.siteUser.id]);
    if (audiences.length > 0) {
      await conn.query(
        'INSERT INTO site_user_audiences (site_user_id, audience) VALUES ' + audiences.map(() => '(?, ?)').join(', '),
        audiences.flatMap(a => [req.siteUser.id, a])
      );
    }
  } finally {
    conn.release();
  }
  res.json({ ok: true, audiences });
});

// --- Admin management of site-user accounts ---
// Site users aren't browsed as their own list — they're surfaced as a value
// on the matching CRM contact (see server/routes/newsletter.js), so these
// two actions are triggered from there by site-user id.

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

module.exports = { router, requireSiteAuth };
