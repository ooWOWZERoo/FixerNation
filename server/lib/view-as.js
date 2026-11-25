// Read-only "view as" for staff (phase C of docs/reference/help-support-tools-requirements.md; read section C before changing anything here).
//
// A CRM Admin presses View as on a teacher, school administrator or district administrator in Account Lookup, types a reason, and a new browser tab
// shows that person's screens with the student data left out. The view is NOT a cookie (one browser shares cookies across tabs, so a cookie would
// change what the staff member's other tabs do). It is a signed token kept in that one tab's sessionStorage and sent as the X-View-As header by
// view-as.js. This file is the gate that every request carrying that header goes through, before any route:
//
//   1. the token is valid, not expired, and of its own session kind (never usable as a site, student or admin session);
//   2. the same admin's live fn_session cookie is present, the admin still exists and the session was not invalidated;
//   3. the admin still holds the CRM role that may start a view;
//   4. the session row is not ended, and the viewed account is still there, open, not staff, not a demo, and its password was not reset since;
//   5. the request is a GET or HEAD (the one exception is ending the view), and the route is on the allowlist (lib/view-as-routes.js);
//   6. only then is the person's identity supplied, the staff member's own cookies are removed from the request, no cookie can be written back to the
//      browser, and the JSON is scrubbed of student-looking and credential-looking keys.
// Every failure answers without running a route. Nothing here ever writes to a person's data.
const crypto = require('node:crypto');
const pool = require('../db/pool');
const { signSession, verifySession } = require('./session-tokens');
const { COOKIE_NAME: ADMIN_COOKIE, SITE_COOKIE_NAME, STUDENT_COOKIE_NAME, DEMO_GATE_COOKIE_NAME } = require('./session');
const { isAllowed, scrub } = require('./view-as-routes');

const HEADER = 'x-view-as';
const SESSION_MINUTES = 20;
const REASON_MIN = 5;
const REASON_MAX = 200;
const ACTION = 'view_as'; // the CRM permission (lib/crm-permissions.js): CRM Admin only
const LANDING = { teacher: 'teacher-classrooms.html', school: 'school-admin-dashboard.html', district: 'district-admin-dashboard.html' };

function cleanReason(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
}

// What kind of account this is, and whether staff may view it. Returns { ok, why, roles, landing }.
async function describeTarget(user, adminEmail, deps = {}) {
  const access = deps.access || require('./access');
  if (!user) return { ok: false, why: 'That account does not exist.' };
  if (user.closed_at) return { ok: false, why: 'That account is closed.' };
  if (user.is_fne_staff || user.role === 'admin') return { ok: false, why: 'Staff accounts cannot be viewed.' };
  if (user.is_shared_demo || user.is_sales_demo) return { ok: false, why: 'Demo accounts cannot be viewed.' };
  if (adminEmail && user.email && String(user.email).toLowerCase() === String(adminEmail).toLowerCase()) return { ok: false, why: 'You cannot view your own account.' };
  const [licensed, school, district] = await Promise.all([
    access.hasActiveLicense(user.id), access.hasActiveSchoolAdminAssignment(user.id), access.hasActiveDistrictAdminAssignment(user.id),
  ]);
  const teacher = !!licensed || user.role === 'teacher' || user.role === 'inactive_teacher';
  const roles = [];
  if (district) roles.push('district administrator');
  if (school) roles.push('school administrator');
  if (teacher) roles.push('teacher');
  if (!roles.length) return { ok: false, why: 'Only teachers, school administrators and district administrators can be viewed.' };
  const landing = district ? LANDING.district : school ? LANDING.school : LANDING.teacher;
  return { ok: true, roles, landing };
}

function expiryFrom(now) { return new Date(now.getTime() + SESSION_MINUTES * 60 * 1000); }

// Ends every open view this admin has. `by` is stop | replaced | signed_out | expired.
async function endSessionsFor(adminId, by, now = new Date()) {
  const [r] = await pool.query('UPDATE view_as_sessions SET ended_at = ?, ended_by = ? WHERE admin_id = ? AND ended_at IS NULL', [now, by, adminId]);
  return r.affectedRows || 0;
}

// Starts a view: ends the admin's earlier one, saves the row, returns the signed token. The caller has already checked the CRM role and the target.
async function startSession({ adminId, user, reason, now = new Date() }) {
  await endSessionsFor(adminId, 'replaced', now);
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = expiryFrom(now);
  await pool.query(
    'INSERT INTO view_as_sessions (admin_id, target_site_user_id, reason, jti, started_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [adminId, user.id, reason, jti, now, expiresAt]);
  const token = signSession('viewAs', { staffId: adminId, targetId: user.id, jti }, `${SESSION_MINUTES}m`);
  return { token, expiresAt };
}

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, viewAs: true, ...extra });
}

// The middleware: app.use('/api', viewAsGate), before every route (and before the demo gate).
// `deps` lets a test supply the admin check and the CRM role check without a real database.
function viewAsGate(deps = {}) {
  const can = deps.can || require('./crm-permissions').can;
  const loadCrmRole = deps.loadCrmRole || require('./crm-permissions').loadCrmRole;
  return async function viewAsMiddleware(req, res, next) {
    const header = req.headers[HEADER];
    if (header === undefined) return next();
    try {
      // 1. the token
      let claim;
      try { claim = verifySession('viewAs', String(header)); } catch { return fail(res, 401, 'This view has ended.', { ended: true }); }
      // 2. the same admin, still signed in
      const adminToken = req.cookies && req.cookies[ADMIN_COOKIE];
      let admin = null;
      if (adminToken) { try { admin = verifySession('admin', adminToken); } catch { admin = null; } }
      if (!admin || admin.userId !== claim.staffId) return fail(res, 401, 'This view has ended.', { ended: true });
      const [[adminRow]] = await pool.query('SELECT id, email, session_invalidated_at FROM admin_users WHERE id = ? AND email_verified = 1', [claim.staffId]);
      if (!adminRow) return fail(res, 401, 'This view has ended.', { ended: true });
      if (adminRow.session_invalidated_at && admin.iat * 1000 < new Date(adminRow.session_invalidated_at).getTime()) return fail(res, 401, 'This view has ended.', { ended: true });
      // 3. the role
      const role = await loadCrmRole(claim.staffId);
      if (role !== null && !can(role, ACTION)) return fail(res, 403, 'Your Sales CRM role does not allow this.', { ended: true });
      // 4. the session and the person
      const now = new Date();
      const [[row]] = await pool.query(
        'SELECT id, target_site_user_id, started_at, expires_at FROM view_as_sessions WHERE jti = ? AND admin_id = ? AND ended_at IS NULL AND expires_at > ?',
        [claim.jti, claim.staffId, now]);
      if (!row || row.target_site_user_id !== claim.targetId) return fail(res, 401, 'This view has ended.', { ended: true });
      const [[user]] = await pool.query('SELECT * FROM site_users WHERE id = ?', [claim.targetId]);
      const target = await describeTarget(user, adminRow.email, deps);
      if (!target.ok) { await endSessionsFor(claim.staffId, 'expired', now); return fail(res, 401, 'This view has ended.', { ended: true }); }
      // a password reset or "sign out everywhere" for the person since the view began ends it (the same stamp that ends their own sessions)
      const [[reset]] = await pool.query('SELECT COUNT(*) AS n FROM site_users WHERE id = ? AND session_invalidated_at IS NOT NULL AND session_invalidated_at > ?', [claim.targetId, row.started_at]);
      if (Number(reset.n) > 0) { await endSessionsFor(claim.staffId, 'expired', now); return fail(res, 401, 'This view has ended.', { ended: true }); }
      // 5. read only, and only the listed routes
      if (!isAllowed(req.method, req.path)) {
        const readOnly = req.method !== 'GET' && req.method !== 'HEAD';
        return fail(res, 403, readOnly ? 'This is a read-only view. Nothing can be changed here.' : 'That screen is not available in a staff view.');
      }
      // 6. the person's identity, nobody else's
      req.viewAs = { sessionId: row.id, adminId: claim.staffId, siteUserId: user.id, firstName: user.first_name, roles: target.roles, expiresAt: row.expires_at };
      req.cookies = { ...req.cookies };
      for (const name of [ADMIN_COOKIE, STUDENT_COOKIE_NAME, DEMO_GATE_COOKIE_NAME, SITE_COOKIE_NAME]) delete req.cookies[name];
      req.cookies[SITE_COOKIE_NAME] = signSession('site', { userId: user.id, firstName: user.first_name, role: user.role || 'teacher' }, '2m');
      const setHeader = res.setHeader;
      res.setHeader = function viewAsSetHeader(name, value) {
        if (String(name).toLowerCase() === 'set-cookie') return this; // a view can never write a cookie into the staff member's browser
        return setHeader.apply(this, arguments);
      };
      const json = res.json;
      res.json = function viewAsJson(body) { return json.call(this, scrub(body)); };
      res.set('X-Robots-Tag', 'noindex');
      return next();
    } catch (err) {
      console.error('view-as gate error:', err.message);
      return fail(res, 503, 'The staff view is not available right now.', { ended: true });
    }
  };
}

module.exports = { HEADER, SESSION_MINUTES, REASON_MIN, REASON_MAX, ACTION, LANDING, cleanReason, describeTarget, endSessionsFor, startSession, viewAsGate };
