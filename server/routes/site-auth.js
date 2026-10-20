const express = require('express');
const bcrypt = require('bcryptjs');
const { signSession, verifySession } = require('../lib/session-tokens');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME, SITE_COOKIE_MAX_AGE_MS } = require('../lib/session');
const { sendVerificationEmail, sendPasswordResetEmail, sendMicrosoftLinkEmail } = require('../lib/mailer');
const { safeLocalPath } = require('../lib/safe-redirect');
const { limiter, FailureTracker, rejectIfBlocked, clientIp } = require('../lib/rate-limit');
const { reencodeImageToWebp } = require('../lib/upload-safety');
const { createToken, consumeToken } = require('../lib/site-tokens');
const { attachPurchaseDetails } = require('./newsletter');
const { requireAuth } = require('../middleware/auth');
const { hasActiveLicense, hasActiveSchoolAdminAssignment, hasActiveDistrictAdminAssignment, hasActiveAffiliateAccount, getParentClassrooms } = require('../lib/access');
const { addTeacherToSocialGroups } = require('../lib/social-groups');
const gateway = require('../lib/safety/gateway');
const { resolveSchoolDomainForTeacher } = require('../lib/safety/school-context');
const { getSiteUser: resolveSiteUser } = require('../lib/site-user');
const msOAuth = require('../lib/microsoft-oauth');

const avatarsDir = path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });
// Avatars from ordinary signed-in users are the lowest-trust upload on the site,
// so the raw upload never lands in a web-served folder: it's written to the OS
// temp dir under a random name, decoded and re-encoded to WebP (which a disguised
// HTML/SVG/script file cannot survive), and only the re-encoded image is saved
// into the avatars folder, always as .webp -- the client controls neither the
// extension nor the content type that gets served.
const avatarTmpDir = path.join(os.tmpdir(), 'fn-avatar-uploads');
fs.mkdirSync(avatarTmpDir, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarTmpDir),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + '.part'),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Images only (JPG, PNG, WebP, GIF)'), ok);
  },
});

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same cost factor as real password hashes, so a "no such account" login takes
// as long as a genuine wrong-password one.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// Throttles. Failed logins are counted per account and per IP; the email-
// sending endpoints are limited per IP AND per target address so nobody can
// use them to flood a victim's inbox (the per-address limit is what stops that
// when IPs are rotated).
const HOUR = 60 * 60 * 1000;
const bodyEmail = (r) => String((r.body && r.body.email) || '').trim().toLowerCase().slice(0, 254) || null;
const loginFailsByAccount = new FailureTracker({ name: 'site-login-acct', windowMs: 15 * 60 * 1000, max: 8 });
const loginFailsByIp = new FailureTracker({ name: 'site-login-ip', windowMs: 15 * 60 * 1000, max: 30 });
const signupLimit = limiter({ name: 'site-signup', windowMs: HOUR, max: 10 });
const resendLimitIp = limiter({ name: 'site-resend-ip', windowMs: HOUR, max: 10 });
const resendLimitAcct = limiter({ name: 'site-resend-acct', windowMs: HOUR, max: 3, key: bodyEmail });
const forgotLimitIp = limiter({ name: 'site-forgot-ip', windowMs: HOUR, max: 10 });
const forgotLimitAcct = limiter({ name: 'site-forgot-acct', windowMs: HOUR, max: 3, key: bodyEmail });

// Site-user session check for the self-service "My License" endpoints below —
// mirrors /me's cookie/JWT verification but rejects with 401 instead of a
// { loggedIn: false } body, and resolves the full user row. Delegates to
// lib/site-user.js so this exact check (including the session-revocation
// look-up) has one implementation, reusable by dual-identity routes too.
async function requireSiteAuth(req, res, next) {
  const user = await resolveSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.siteUser = user;
  next();
}

function setSiteSessionCookie(res, user) {
  const token = signSession('site', { userId: user.id, firstName: user.first_name, role: user.role || 'teacher' }, '30d');
  res.cookie(SITE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SITE_COOKIE_MAX_AGE_MS,
  });
}

// If a license seat (single or group) was invited to this exact email,
// claims it on the new account's behalf — only for paid purchases, and
// domain must match for group licenses (school_domain NULL means
// single/book with no domain constraint). Shared by password signup and
// Microsoft sign-in so a brand-new Microsoft account isn't treated worse
// than a password one — both create the same kind of account afterward.
async function claimPendingSeatsAndSubscribe(userId, email, firstName, lastName, source) {
  const [existingContact] = await pool.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (!existingContact[0]) {
    await pool.query(
      'INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, ?, ?)',
      [`${firstName} ${lastName}`.trim(), email, source, 'Subscribed']
    );
  }

  const [seatResult] = await pool.query(
    `UPDATE license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     SET ls.status = 'registered', ls.registered_site_user_id = ?, ls.registered_at = NOW()
     WHERE ls.invited_email = ?
       AND ls.status = 'pending'
       AND p.payment_status = 'paid'
       AND (p.school_domain IS NULL OR LOWER(SUBSTRING_INDEX(?, '@', -1)) = LOWER(p.school_domain))`,
    [userId, email, email]
  );
  if (seatResult.affectedRows > 0) {
    try { await addTeacherToSocialGroups(userId); } catch (e) { console.error('addTeacherToSocialGroups failed:', e.message); }
    pool.query(
      "UPDATE school_invitations SET status = 'registered' WHERE invited_email = ? AND status NOT IN ('revoked','registered','expired')",
      [email.toLowerCase()]
    ).catch(e => console.error('invitation status update failed:', e.message));
  }
}

router.post('/signup', signupLimit, async (req, res) => {
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

  await claimPendingSeatsAndSubscribe(result.insertId, email, firstName, lastName, 'Homepage');

  const verifyToken = await createToken(result.insertId, 'verify', 24 * 60 * 60 * 1000);
  const verifyUrl = `${process.env.SITE_URL || ''}/api/site-auth/verify?token=${verifyToken}`;
  await sendVerificationEmail({ to: email, firstName, verifyUrl });

  res.status(201).json({ ok: true, message: 'Check your email to verify your account before logging in.' });
});

// --- Microsoft sign-in (Entra ID / Azure AD) ---
// "Continue with Microsoft" in the shared auth modal. Covers teachers,
// parents, and school/district admins alike — they're all site_users rows,
// so there's nothing audience-specific about this flow.
//
// Account linking: a returning user is matched by microsoft_oid ONLY -- the
// tenant-scoped, Microsoft-issued identifier. The email Microsoft reports is
// NOT trusted on its own: for work/school accounts the `mail` attribute is set
// by that tenant's admin and Microsoft doesn't verify it, so anyone who spins
// up a free Entra tenant can claim to be principal@anyschool.org. Trusting it
// would let them log into (and auto-verify) the real principal's account, or
// pre-claim license seats invited to that address. So a first-time Microsoft
// sign-in never links or creates anything directly -- it emails the address
// a confirmation link, and the link/account is only completed once someone
// with access to that mailbox clicks it (see /microsoft/confirm below).
// Linking never removes the password path -- both work afterward.
const MS_STATE_COOKIE = 'fn_ms_oauth_state';

function appendQueryError(path, code) {
  return path + (path.includes('?') ? '&' : '?') + 'msError=' + code;
}

router.get('/microsoft/start', async (req, res) => {
  const returnTo = safeLocalPath(req.query.next);
  if (!msOAuth.isConfigured()) {
    return res.redirect(appendQueryError(returnTo, 'not_configured'));
  }

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(MS_STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000, // just long enough for the Microsoft round trip
  });

  const authUrl = await msOAuth.getMsalClient().getAuthCodeUrl({
    scopes: msOAuth.SCOPES,
    redirectUri: process.env.MS_OAUTH_REDIRECT_URI,
    state,
  });
  res.redirect(authUrl);
});

router.get('/microsoft/callback', async (req, res) => {
  let stateCookie = null;
  try { stateCookie = JSON.parse(req.cookies[MS_STATE_COOKIE] || ''); } catch { /* malformed/missing — treated as absent below */ }
  res.clearCookie(MS_STATE_COOKIE);
  // The state cookie is unsigned, so re-validate its returnTo rather than
  // trusting that /microsoft/start was the only thing that ever wrote it.
  const returnTo = safeLocalPath(stateCookie && stateCookie.returnTo);

  if (req.query.error) {
    return res.redirect(appendQueryError(returnTo, 'denied'));
  }
  if (!stateCookie || !req.query.state || req.query.state !== stateCookie.state) {
    return res.redirect(appendQueryError('/index.html', 'state'));
  }

  let tokenResult;
  try {
    tokenResult = await msOAuth.getMsalClient().acquireTokenByCode({
      code: req.query.code,
      scopes: msOAuth.SCOPES,
      redirectUri: process.env.MS_OAUTH_REDIRECT_URI,
    });
  } catch (err) {
    console.error('Microsoft OAuth token exchange failed:', err.message);
    return res.redirect(appendQueryError(returnTo, 'token'));
  }

  const profile = await msOAuth.fetchGraphProfile(tokenResult.accessToken);
  if (!profile) {
    return res.redirect(appendQueryError(returnTo, 'profile'));
  }
  const email = (profile.mail || profile.userPrincipalName || '').trim().toLowerCase();
  const firstName = (profile.givenName || profile.displayName || 'there').trim();
  const lastName = (profile.surname || '').trim();
  // Microsoft's documented stable identifier for "this person, in this
  // tenant, across sessions" when using the multi-tenant /common authority —
  // more reliable than the ID token's bare oid claim alone for personal
  // Microsoft accounts mixed with work/school ones.
  const microsoftOid = tokenResult.account.homeAccountId;

  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.redirect(appendQueryError(returnTo, 'noemail'));
  }

  const [rows] = await pool.query('SELECT * FROM site_users WHERE microsoft_oid = ?', [microsoftOid]);
  if (rows[0]) {
    // Returning user, already proven linked to this exact Microsoft identity.
    setSiteSessionCookie(res, rows[0]);
    return res.redirect(returnTo);
  }

  // First time this Microsoft identity has been seen. Nothing is created or
  // linked yet and no session is issued -- the pending sign-in rides in a
  // short-lived signed token that only gets acted on once the mailbox owner
  // confirms (stateless on purpose: no half-created, unverified accounts left
  // behind for every address anyone types into a throwaway tenant).
  const linkToken = signSession('msLink', { oid: microsoftOid, email, firstName, lastName, returnTo }, '1h');
  const confirmUrl = `${process.env.SITE_URL || ''}/microsoft-confirm.html?token=${encodeURIComponent(linkToken)}`;
  try {
    await sendMicrosoftLinkEmail({ to: email, firstName, confirmUrl });
  } catch (err) {
    console.error('Microsoft link confirmation email failed:', err.message);
    return res.redirect(appendQueryError(returnTo, 'email_failed'));
  }
  res.redirect(appendQueryError(returnTo, 'confirm_email'));
});

// POST (not GET) on purpose: mail scanners and link-preview bots routinely
// GET every URL in an email. If the link itself completed the account link, a
// bot on the *victim's* mailbox could finish an attacker-initiated sign-in for
// them. A button that POSTs is something automated prefetching doesn't do.
router.post('/microsoft/confirm', async (req, res) => {
  const token = req.body && req.body.token;
  let pending;
  try { pending = verifySession('msLink', String(token || '')); } catch { pending = null; }
  if (!pending || !pending.oid || !pending.email) {
    return res.status(400).json({ error: 'This confirmation link is invalid or has expired. Please start Microsoft sign-in again.' });
  }

  const [byOid] = await pool.query('SELECT * FROM site_users WHERE microsoft_oid = ?', [pending.oid]);
  let user = byOid[0];

  if (!user) {
    const [byEmail] = await pool.query('SELECT * FROM site_users WHERE email = ?', [pending.email]);
    user = byEmail[0];
    if (user) {
      if (user.microsoft_oid && user.microsoft_oid !== pending.oid) {
        return res.status(409).json({ error: 'This email is already linked to a different Microsoft account. Sign in with that one, or use your password.' });
      }
      // The mailbox owner just proved control of this address, so linking and
      // marking it verified is now legitimate.
      await pool.query('UPDATE site_users SET microsoft_oid = ?, email_verified = 1 WHERE id = ?', [pending.oid, user.id]);
      user.microsoft_oid = pending.oid;
      user.email_verified = 1;
    } else {
      const [result] = await pool.query(
        'INSERT INTO site_users (first_name, last_name, email, password_hash, microsoft_oid, email_verified) VALUES (?, ?, ?, NULL, ?, 1)',
        [pending.firstName || 'there', pending.lastName || '', pending.email, pending.oid]
      );
      await claimPendingSeatsAndSubscribe(result.insertId, pending.email, pending.firstName || 'there', pending.lastName || '', 'Microsoft Sign-In');
      const [created] = await pool.query('SELECT * FROM site_users WHERE id = ?', [result.insertId]);
      user = created[0];
    }
  }

  setSiteSessionCookie(res, user);
  res.json({ ok: true, returnTo: safeLocalPath(pending.returnTo) });
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

router.post('/resend-verification', resendLimitIp, resendLimitAcct, async (req, res) => {
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
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > 1000) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  const acctKey = email.trim().toLowerCase();
  const ip = clientIp(req);
  if (rejectIfBlocked(res, [[loginFailsByAccount, acctKey], [loginFailsByIp, ip]])) return;

  const [rows] = await pool.query('SELECT * FROM site_users WHERE email = ?', [email.trim()]);
  const user = rows[0];
  // No such account, or a Microsoft-only account with no password set (its
  // password_hash is NULL, and bcrypt.compare throws on a non-string hash --
  // that was a 500). Compare against a dummy hash either way so the response
  // takes the same time as a real wrong-password attempt and doesn't reveal
  // which emails have accounts.
  if (!user || !user.password_hash) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    loginFailsByAccount.fail(acctKey);
    loginFailsByIp.fail(ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    loginFailsByAccount.fail(acctKey);
    loginFailsByIp.fail(ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  loginFailsByAccount.clear(acctKey);
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email before logging in.', reason: 'unverified' });
  }

  setSiteSessionCookie(res, user);
  // isSchoolAdmin/isDistrictAdmin/isAffiliate are real entitlement checks (an
  // active school_license_admins/district_license_admins/affiliates row),
  // independent of the single site_users.role string — school-admin-login.html
  // and district-admin-login.html gate on these instead of role so an account
  // holding one role doesn't get locked out of a different one it also
  // legitimately holds. A district admin covering a territory as an
  // affiliate on the side is exactly this case.
  const [isSchoolAdmin, isDistrictAdmin, isAffiliate] = await Promise.all([
    hasActiveSchoolAdminAssignment(user.id),
    hasActiveDistrictAdminAssignment(user.id),
    hasActiveAffiliateAccount(user.id),
  ]);
  res.json({ ok: true, firstName: user.first_name, role: user.role || 'teacher', isSchoolAdmin, isDistrictAdmin, isAffiliate });
});

router.post('/logout', (req, res) => {
  res.clearCookie(SITE_COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.json({ loggedIn: false });
  try {
    const payload = verifySession('site', token);
    const [rows] = await pool.query('SELECT email FROM site_users WHERE id = ?', [payload.userId]);
    if (!rows[0]) return res.json({ loggedIn: false });
    // hasLicense/isParent/isSchoolAdmin/isDistrictAdmin/isAffiliate are real
    // entitlement checks, independent of site_users.role — an account can
    // hold any combination of these (e.g. a parent later invited and
    // registered as a teacher, a district admin who is also a school admin
    // under the same email, or a district admin who's also an affiliate
    // covering a different territory), and role alone can't represent that.
    // The nav uses these to show every applicable section rather than one
    // exclusive role-based branch.
    const [hasLicense, parentClassrooms, isSchoolAdmin, isDistrictAdmin, isAffiliate] = await Promise.all([
      hasActiveLicense(payload.userId),
      getParentClassrooms(payload.userId),
      hasActiveSchoolAdminAssignment(payload.userId),
      hasActiveDistrictAdminAssignment(payload.userId),
      hasActiveAffiliateAccount(payload.userId),
    ]);
    res.json({
      loggedIn: true,
      firstName: payload.firstName,
      role: payload.role || 'teacher',
      email: rows[0].email,
      hasLicense,
      isParent: parentClassrooms.length > 0,
      isSchoolAdmin,
      isDistrictAdmin,
      isAffiliate,
    });
  } catch {
    res.json({ loggedIn: false });
  }
});

router.post('/forgot-password', forgotLimitIp, forgotLimitAcct, async (req, res) => {
  const email = (req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  // Only accept a same-site path (e.g. from the school-invite-accept flow,
  // so resetting a password can drop the user right back into claiming
  // their invitation) — never an absolute/external URL, to avoid turning
  // this into an open redirect via an emailed link.
  const nextPath = safeLocalPath(req.body && req.body.next, '');

  const [rows] = await pool.query('SELECT id, first_name FROM site_users WHERE email = ?', [email]);
  const user = rows[0];
  // Always respond ok, regardless of whether the email is registered.
  if (user) {
    const resetToken = await createToken(user.id, 'reset', 60 * 60 * 1000);
    const resetUrl = `${process.env.SITE_URL || ''}/reset-password.html?token=${resetToken}` + (nextPath ? `&next=${encodeURIComponent(nextPath)}` : '');
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

  let webp;
  try {
    webp = await reencodeImageToWebp(req.file.path, { maxDimension: 512 });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'That file doesn\'t look like a valid image.' });
  }
  fs.unlink(req.file.path, () => {});

  // Content Safety Gateway (PROFILE_IMAGE) -- screens the exact bytes that will be published.
  const schoolDomain = await resolveSchoolDomainForTeacher(req.siteUser.id);
  const screen = await gateway.screenContent({
    contentContext: 'PROFILE_IMAGE',
    images: [{ buffer: webp, mimetype: 'image/webp' }],
    authorSiteUserId: req.siteUser.id,
    schoolDomain,
  });
  if (!gateway.isPublishable(screen.decision)) {
    return res.status(422).json({ error: screen.message });
  }

  const avatarFilename = 'avatar-' + req.siteUser.id + '-' + Date.now() + '.webp';
  fs.writeFileSync(path.join(avatarsDir, avatarFilename), webp);

  const prefix = (process.env.UPLOADS_URL_PREFIX || '/uploads/') + 'avatars/';
  const avatarUrl = prefix + avatarFilename;
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
  // A Microsoft-only account has no password_hash yet — bcrypt.compare
  // requires a real hash string, so this needs its own message rather than
  // a confusing 500. (Use "Forgot Password" instead: it sets a password
  // hash too, so the account then has both sign-in methods available.)
  if (!req.siteUser.password_hash) {
    return res.status(400).json({ error: 'This account doesn\'t have a password set. Use "Forgot password?" on the login screen to create one.' });
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
  if (!contactRows[0]) return res.json({ purchases: [] });
  const contactId = contactRows[0].id;

  const [rows] = await pool.query('SELECT * FROM purchases WHERE contact_id = ? ORDER BY purchased_at DESC', [contactId]);
  const purchases = await attachPurchaseDetails(rows);

  res.json({ purchases });
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
