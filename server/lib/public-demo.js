// The shared demo environment (docs/reference/shared-demo-environment-requirements.md).
//
// A prospect signs in with one published set of logins (demo-district, demo-school, demo-teacher, demo-parent, and a demo-student PIN). Because
// those logins are published, the server, not the front end, decides when they work:
//
//   - the demo is OPEN only while the switch is on AND the end time is in the future (isPublicDemoOpen). A switch left on past its date is off;
//   - while it is closed the demo logins are refused and every demo session stops working, whatever the cookie says (sharedDemoGate below);
//   - while it is open, a demo session cannot send email to anyone but FNE staff, cannot download files, cannot upload files, and cannot change
//     the shared password or PIN (the mailer and the routes ask isSharedDemoRequest()).
//
// A demo session is recognised by a `demo: true` claim that is signed into its cookie at sign-in (routes/site-auth.js, routes/classroom-auth.js),
// so the gate needs no database lookup to tell a demo session from any other. Accounts are flagged by site_users.is_shared_demo; a student is a demo
// student when their classroom's teacher is a flagged account.

const { AsyncLocalStorage } = require('node:async_hooks');
const { getSetting } = require('./settings');
const { verifySession } = require('./session-tokens');
const { SITE_COOKIE_NAME, STUDENT_COOKIE_NAME, COOKIE_NAME: ADMIN_COOKIE_NAME } = require('./session');

const DEMO_EMAIL_DOMAIN = 'public-demo.example.com';
const DEMO_STUDENT_USERNAME = 'demo-student';
const DEMO_SESSION_LENGTH = '8h';
const DEMO_SESSION_MS = 8 * 60 * 60 * 1000;
const DEMO_MAIL_NOTICE = 'This is a demo, so no email was sent.';

// ---- Is the demo open? ------------------------------------------------------------------------------------------------------------------------

// Pure, so the rule can be tested without a database. `enabled` is the setting's text, `endsAt` its ISO string (or empty).
function evaluateDemoWindow({ enabled, endsAt }, now = new Date()) {
  if (String(enabled).trim().toLowerCase() !== 'true') return { open: false, reason: 'off' };
  const end = endsAt ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return { open: false, reason: 'no_end_date' };
  if (end.getTime() <= now.getTime()) return { open: false, reason: 'expired', endsAt: end };
  return { open: true, reason: 'open', endsAt: end };
}

async function getPublicDemoStatus(now = new Date()) {
  const [enabled, endsAt] = await Promise.all([getSetting('public_demo_enabled'), getSetting('public_demo_ends_at')]);
  return evaluateDemoWindow({ enabled, endsAt }, now);
}

async function isPublicDemoOpen(now = new Date()) {
  return (await getPublicDemoStatus(now)).open;
}

// ---- Which accounts are demo accounts ---------------------------------------------------------------------------------------------------------

// A site_users row (or a login query result) counts as a shared demo account when is_shared_demo is set.
function isSharedDemoUser(user) {
  return !!(user && user.is_shared_demo);
}

// True when the classroom belongs to a shared demo teacher (so its students are demo students). Before the column exists no classroom can be one.
async function isSharedDemoClassroom(classroomId) {
  if (!classroomId) return false;
  const pool = require('../db/pool');
  try {
    const [[row]] = await pool.query(
      'SELECT su.is_shared_demo FROM classrooms c JOIN site_users su ON su.id = c.teacher_site_user_id WHERE c.id = ?', [classroomId]);
    return !!(row && row.is_shared_demo);
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR' || /no such column/i.test(String(err.message))) return false;
    throw err;
  }
}

// ---- The demo request context -----------------------------------------------------------------------------------------------------------------

const als = new AsyncLocalStorage();

function isSharedDemoRequest() {
  return !!als.getStore();
}

// Called by the mailer when it holds back an email, so the response can say so.
function noteSuppressedMail() {
  const ctx = als.getStore();
  if (ctx) ctx.mailSuppressed += 1;
}

// A route that must never run for a demo session (changing the shared password, resetting a PIN) calls this and returns when it is true.
function refuseSharedDemo(req, res, message) {
  if (!isSharedDemoRequest() && !isSharedDemoUser(req && req.siteUser)) return false;
  res.status(403).json({ error: message || 'This is turned off in the demo.', demo: true });
  return true;
}

// ---- The gate -----------------------------------------------------------------------------------------------------------------------------------

// Mounted once in app.js, after cookie-parser and before every route. For each site or student cookie that carries the demo claim:
//   - demo closed: the cookie is cleared and removed from this request, so every later check sees "not signed in" without each one having to know;
//   - demo open: the request runs inside the demo context (mail, downloads, uploads and password changes consult it).
// If the status cannot be read the gate fails closed (the demo cookie is dropped).
async function sharedDemoGate(req, res, next) {
  try {
    let demo = false;
    for (const [name, kind] of [[SITE_COOKIE_NAME, 'site'], [STUDENT_COOKIE_NAME, 'student']]) {
      const token = req.cookies && req.cookies[name];
      if (!token) continue;
      let payload;
      try { payload = verifySession(kind, token); } catch { continue; }
      if (!payload.demo) continue;
      let open = false;
      try { open = await isPublicDemoOpen(); } catch { open = false; }
      if (!open) {
        res.clearCookie(name);
        delete req.cookies[name];
        continue;
      }
      demo = true;
    }
    if (!demo) return next();

    // An FNE admin who is testing the demo in their own browser holds the admin cookie too. Their requests are the admin's own, so they are not
    // restricted (their invoice and support emails must still go out). A demo visitor can never hold a valid admin cookie.
    const adminToken = req.cookies && req.cookies[ADMIN_COOKIE_NAME];
    if (adminToken) {
      try { verifySession('admin', adminToken); return next(); } catch { /* not a valid admin session: stay restricted */ }
    }

    // No file may be uploaded by a demo session (logos, avatars, attachments).
    if (req.is && req.is('multipart/form-data')) {
      return res.status(403).json({ error: 'File uploads are turned off in the demo.', demo: true });
    }

    // If an email was held back during this request, say so in the JSON answer and a header.
    const origJson = res.json.bind(res);
    res.json = (body) => {
      const ctx = als.getStore();
      if (ctx && ctx.mailSuppressed && body && typeof body === 'object' && !Array.isArray(body)) {
        res.set('X-Demo-Email-Suppressed', '1');
        body = { ...body, demoNotice: DEMO_MAIL_NOTICE };
      }
      return origJson(body);
    };
    als.run({ mailSuppressed: 0 }, () => next());
  } catch (err) {
    next(err);
  }
}

module.exports = {
  DEMO_EMAIL_DOMAIN, DEMO_STUDENT_USERNAME, DEMO_SESSION_LENGTH, DEMO_SESSION_MS, DEMO_MAIL_NOTICE,
  evaluateDemoWindow, getPublicDemoStatus, isPublicDemoOpen,
  isSharedDemoUser, isSharedDemoClassroom,
  isSharedDemoRequest, noteSuppressedMail, refuseSharedDemo, sharedDemoGate,
};
