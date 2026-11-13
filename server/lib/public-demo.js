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
const { evaluateDemoWindow } = require('./public-demo-window');
const invitations = require('./public-demo-invitations');
const { verifySession } = require('./session-tokens');
const { SITE_COOKIE_NAME, STUDENT_COOKIE_NAME, COOKIE_NAME: ADMIN_COOKIE_NAME, DEMO_GATE_COOKIE_NAME } = require('./session');

const DEMO_EMAIL_DOMAIN = 'public-demo.example.com';
const DEMO_STUDENT_USERNAME = 'demo-student';
const DEMO_SESSION_LENGTH = '8h';
const DEMO_SESSION_MS = 8 * 60 * 60 * 1000;
const DEMO_MAIL_NOTICE = 'This is a demo, so no email was sent.';

// ---- Is the demo open? ------------------------------------------------------------------------------------------------------------------------

// The rule itself is pure and lives in lib/public-demo-window.js, so the command-line scripts apply exactly the same one.

async function getPublicDemoStatus(now = new Date()) {
  const [enabled, endsAt] = await Promise.all([getSetting('public_demo_enabled'), getSetting('public_demo_ends_at')]);
  return evaluateDemoWindow({ enabled, endsAt }, now);
}

async function isPublicDemoOpen(now = new Date()) {
  return (await getPublicDemoStatus(now)).open;
}

// Is the demo open for THIS account or session? A login that belongs to a private workspace (demo_workspace_id) works only while that workspace's invitation
// is open (and demos are not paused); a login of the original single demo (no workspace) works while the original switch is on. Fails closed.
async function isDemoOpenFor(workspaceId, now = new Date()) {
  if (workspaceId === null || workspaceId === undefined || workspaceId === '') return isPublicDemoOpen(now);
  return (await invitations.getOpenInvitationForWorkspace(workspaceId, now)) !== null;
}

// ---- Which accounts are demo accounts ---------------------------------------------------------------------------------------------------------

// A site_users row (or a login query result) counts as a shared demo account when is_shared_demo is set.
function isSharedDemoUser(user) {
  return !!(user && user.is_shared_demo);
}

// What a classroom is to the demo: null when it is an ordinary classroom, otherwise { workspace } (the teacher's workspace number, or null for the
// original single demo). Before the columns exist no classroom can be a demo classroom.
async function sharedDemoClassroomInfo(classroomId) {
  if (!classroomId) return null;
  const pool = require('../db/pool');
  let row;
  try {
    [[row]] = await pool.query('SELECT su.is_shared_demo, su.demo_workspace_id FROM classrooms c JOIN site_users su ON su.id = c.teacher_site_user_id WHERE c.id = ?', [classroomId]);
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR' && !/no such column/i.test(String(err.message))) throw err;
    try { [[row]] = await pool.query('SELECT su.is_shared_demo FROM classrooms c JOIN site_users su ON su.id = c.teacher_site_user_id WHERE c.id = ?', [classroomId]); }
    catch (err2) { if (err2.code === 'ER_BAD_FIELD_ERROR' || /no such column/i.test(String(err2.message))) return null; throw err2; }
  }
  if (!row || !row.is_shared_demo) return null;
  const ws = row.demo_workspace_id === null || row.demo_workspace_id === undefined ? null : Number(row.demo_workspace_id);
  return { workspace: ws };
}

// True when the classroom belongs to a shared demo teacher (so its students are demo students).
async function isSharedDemoClassroom(classroomId) {
  return (await sharedDemoClassroomInfo(classroomId)) !== null;
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

// The demo never emails anyone, but an invitation still writes a row that names the invitee. So in a demo session only a fake address may be named:
// anything under example.com (which can never receive mail), for example teacher2@example.com. Throws a 403 for the caller's error handler.
function demoRecipientAllowed(email) {
  const at = String(email || '').trim().toLowerCase().lastIndexOf('@');
  const domain = at === -1 ? '' : String(email).trim().toLowerCase().slice(at + 1);
  return domain === 'example.com' || domain.endsWith('.example.com');
}

function assertDemoRecipient(email) {
  if (isSharedDemoRequest() && !demoRecipientAllowed(email)) {
    throw Object.assign(new Error('In the demo, use an example.com address (for example teacher2@example.com). The demo never sends email.'), { status: 403, demo: true });
  }
}

// For actions that only make sense with a real person at the other end (resend a welcome, send a password reset).
function assertNotSharedDemoRequest(message) {
  if (isSharedDemoRequest()) throw Object.assign(new Error(message || 'This is turned off in the demo, because the demo never sends email.'), { status: 403, demo: true });
}

// A route that must never run for a demo session (changing the shared password, resetting a PIN) calls this and returns when it is true.
function refuseSharedDemo(req, res, message) {
  if (!isSharedDemoRequest() && !isSharedDemoUser(req && req.siteUser)) return false;
  res.status(403).json({ error: message || 'This is turned off in the demo.', demo: true });
  return true;
}

// ---- The access-code gate ---------------------------------------------------------------------------------------------------------------------

// The visit this request's demo gate cookie stands for, or null. Signed by us, and still good:
//   - { legacy: true }             the original single demo: issued for the CURRENT access code (the code's version is in the cookie, so a new code ends
//                                  every visit at once) and the demo is open;
//   - { invitation, workspace }    a group's own invitation: it is open, and the cookie carries the invitation's CURRENT code version.
// Never throws; any doubt means null.
async function getDemoGate(req) {
  const token = req && req.cookies && req.cookies[DEMO_GATE_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = verifySession('demoGate', token);
    if (payload.inv !== undefined && payload.inv !== null) {
      const inv = await invitations.getOpenInvitationById(payload.inv);
      if (!inv || String(inv.code_version) !== String(payload.v)) return null;
      return { invitation: inv, workspace: Number(inv.workspace_id) };
    }
    if (!(await isPublicDemoOpen())) return null;
    return String(payload.v) === String(await getSetting('public_demo_code_version')) ? { legacy: true } : null;
  } catch {
    return null;
  }
}

// True for a valid gate cookie of the ORIGINAL single demo only (an invitation's cookie is read with getDemoGate).
async function hasValidDemoGate(req) {
  const gate = await getDemoGate(req);
  return !!(gate && gate.legacy);
}

// Someone who is using a demo: a valid access-code visit (either kind), or a demo login's session. Used to tag support and quote requests as coming from
// the demo. The answer comes from the server's own cookies and never from anything the visitor typed.
async function isDemoVisitor(req) {
  return isSharedDemoRequest() || (await getDemoGate(req)) !== null;
}

// WHERE a demo request came from, decided from the server's own cookies and never from anything the visitor typed:
//   { invitationId }   someone in a group's own demo (a demo login's session in its workspace, or that group's access-code visit);
//   { original: true } someone in the original single demo;
//   null               anyone else.
async function demoOrigin(req) {
  const ctx = als.getStore();
  if (ctx) {
    if (ctx.workspace === null || ctx.workspace === undefined) return { original: true };
    const inv = await invitations.getOpenInvitationForWorkspace(ctx.workspace);
    return inv ? { invitationId: Number(inv.id) } : null; // (a closed group's sessions never get this far: the gate drops them)
  }
  const gate = await getDemoGate(req);
  if (!gate) return null;
  return gate.invitation ? { invitationId: Number(gate.invitation.id) } : { original: true };
}

// ---- The gate -----------------------------------------------------------------------------------------------------------------------------------

// Mounted once in app.js, after cookie-parser and before every route. For each site or student cookie that carries the demo claim:
//   - demo closed: the cookie is cleared and removed from this request, so every later check sees "not signed in" without each one having to know;
//   - demo open: the request runs inside the demo context (mail, downloads, uploads and password changes consult it).
// If the status cannot be read the gate fails closed (the demo cookie is dropped).
async function sharedDemoGate(req, res, next) {
  try {
    let demo = false;
    let workspace = null; // the private workspace this demo session belongs to (none for the original demo)
    for (const [name, kind] of [[SITE_COOKIE_NAME, 'site'], [STUDENT_COOKIE_NAME, 'student']]) {
      const token = req.cookies && req.cookies[name];
      if (!token) continue;
      let payload;
      try { payload = verifySession(kind, token); } catch { continue; }
      if (!payload.demo) continue;
      let open = false;
      try { open = await isDemoOpenFor(payload.ws); } catch { open = false; } // payload.ws: the workspace a private-workspace login belongs to (none = the original demo)
      if (!open) {
        res.clearCookie(name);
        delete req.cookies[name];
        continue;
      }
      demo = true;
      if (workspace === null && payload.ws !== undefined && payload.ws !== null) workspace = Number(payload.ws);
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
    als.run({ mailSuppressed: 0, workspace }, () => next());
  } catch (err) {
    next(err);
  }
}

module.exports = {
  DEMO_EMAIL_DOMAIN, DEMO_STUDENT_USERNAME, DEMO_SESSION_LENGTH, DEMO_SESSION_MS, DEMO_MAIL_NOTICE,
  evaluateDemoWindow, getPublicDemoStatus, isPublicDemoOpen,
  isSharedDemoUser, isSharedDemoClassroom, sharedDemoClassroomInfo, isDemoOpenFor, getDemoGate,
  isSharedDemoRequest, noteSuppressedMail, refuseSharedDemo, sharedDemoGate,
  demoRecipientAllowed, assertDemoRecipient, assertNotSharedDemoRequest,
  hasValidDemoGate, isDemoVisitor, demoOrigin,
};
