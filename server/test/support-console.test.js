// Release 121: support console (docs/reference/support-console-requirements.md). Staff look up a person's timeline, show a one-time reset
// link, sign someone out, find a classroom's students and their lockouts, reset a PIN, clear a lockout, and extend or revoke a parent
// invitation; teachers can clear their own students' lockouts; the idle-lock minutes are a setting. Every student-data lookup and change
// is audited by id, and no PIN, link or token is ever logged.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const realRateLimit = require(path.join(SERVER, 'lib/rate-limit.js')); // the real lockout tracker, loaded before the stubs go in
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, role TEXT DEFAULT 'teacher', password_hash TEXT, email_verified INTEGER DEFAULT 1, is_fne_staff INTEGER DEFAULT 0, is_sales_demo INTEGER DEFAULT 0, session_invalidated_at TEXT, closed_at TEXT, closed_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE site_user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT, type TEXT, expires_at TEXT);
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, school_domain TEXT);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE support_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, status TEXT, subject TEXT, requester_email TEXT, site_user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, teacher_site_user_id INTEGER, join_code TEXT, archived_at TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, display_name TEXT, username TEXT UNIQUE, password_hash TEXT, student_number TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER, student_id INTEGER);
CREATE TABLE parent_student_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, student_id INTEGER, invited_email TEXT, status TEXT, expires_at TEXT, revoked_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
// node:sqlite cannot bind a Date; MariaDB's driver can. Turn Dates into the text form the database uses.
const sqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/ON DUPLICATE KEY UPDATE setting_value = \?/, 'ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p instanceof Date ? sqlDate(p) : p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};

const sent = [];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { req.user = { userId: 7 }; next(); }, getAuthUser: () => null },
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: (kind, token) => ({ userId: Number(token), iat: Math.floor(Date.now() / 1000) }), signSession: () => 'x' },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({ sendVerificationEmail: async (m) => { sent.push(m); } }, { get: (t, k) => t[k] || (async () => ({})) }),
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1', FailureTracker: realRateLimit.FailureTracker, rejectIfBlocked: realRateLimit.rejectIfBlocked },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const lockout = require(path.join(SERVER, 'lib/pin-lockout.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/admin/support-console', require(path.join(SERVER, 'routes/admin-support-console.js')));
app.use('/api/settings', require(path.join(SERVER, 'routes/settings.js')));
let teacherRoutes = true;
try { app.use('/api/classrooms', require(path.join(SERVER, 'routes/classrooms.js'))); } catch (e) { teacherRoutes = String(e.message); }
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { as = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (as) headers.Cookie = `fn_user_session=${as}`;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

let n = 0;
const reset = () => {
  for (const t of ['site_users', 'site_user_tokens', 'settings', 'districts', 'purchases', 'school_invitations', 'license_seats', 'school_license_admins', 'district_license_admins', 'support_requests', 'school_audit_log', 'classrooms', 'classroom_students', 'parent_classroom_links', 'parent_student_invitations']) db.exec(`DELETE FROM ${t}`);
  sent.length = 0;
};
const user = (first, o = {}) => {
  n += 1;
  const email = `${first.toLowerCase()}${n}@school.test`;
  const id = Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, role, email_verified, is_fne_staff, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(email, first, 'Tester', o.role || 'teacher', o.verified === false ? 0 : 1, o.staff ? 1 : 0, o.closed ? '2026-01-01 00:00:00' : null).lastInsertRowid);
  return { id, email };
};
// a teacher with a classroom holding the given students (display names); returns their ids and usernames
async function classroom(teacher, names, code = 'ABCD2345') {
  const cid = Number(db.prepare('INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES (?, ?, ?)').run('Room 12', teacher.id, code).lastInsertRowid);
  const kids = [];
  for (const name of names) {
    const username = name.toLowerCase().replace(/[^a-z]/g, '') + (++n);
    const hash = await bcrypt.hash('123456', 4);
    const id = Number(db.prepare('INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, ?, ?, ?)').run(cid, name, username, hash).lastInsertRowid);
    kids.push({ id, name, username });
  }
  return { cid, kids };
}
const auditRows = (action) => db.prepare('SELECT * FROM school_audit_log WHERE action = ?').all(action);
const lockUp = (username) => { for (let i = 0; i < 5; i++) lockout.pinFailsByStudent.fail(lockout.studentKey(username)); };

test('RESET LINK: staff get a one-time link on screen (not emailed); it is audited without the token', async () => {
  reset();
  const u = user('Dana', { verified: false });
  const r = await call('POST', `/api/admin/support-console/accounts/${u.id}/reset-link`);
  assert.equal(r.status, 200); assert.equal(r.json.expiresInMinutes, 60);
  assert.match(r.json.url, /\/reset-password\.html\?token=[0-9a-f]{64}$/);
  const token = r.json.url.split('token=')[1];
  const row = db.prepare('SELECT * FROM site_user_tokens WHERE user_id = ?').get(u.id);
  assert.equal(row.token, token); assert.equal(row.type, 'reset');
  assert.equal(sent.length, 0, 'nothing is emailed');
  const log = auditRows('support_reset_link_shown');
  assert.equal(log.length, 1); assert.equal(log[0].entity_id, u.id); assert.ok(!JSON.stringify(log).includes(token), 'the token is never logged');
});

test('RESET LINK: refused for staff accounts, the admin role, closed accounts and unknown ids', async () => {
  reset();
  const staff = user('Staffy', { staff: true });
  const admin = user('Boss', { role: 'admin' });
  const closed = user('Gone', { closed: true });
  assert.equal((await call('POST', `/api/admin/support-console/accounts/${staff.id}/reset-link`)).json.code, 'staff_account');
  assert.equal((await call('POST', `/api/admin/support-console/accounts/${admin.id}/reset-link`)).status, 409);
  assert.equal((await call('POST', `/api/admin/support-console/accounts/${closed.id}/reset-link`)).json.code, 'closed');
  assert.equal((await call('POST', '/api/admin/support-console/accounts/99999/reset-link')).status, 404);
  assert.equal((await call('POST', '/api/admin/support-console/accounts/abc/reset-link')).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_user_tokens').get().n, 0);
});

test('SIGN OUT EVERYWHERE and RESEND VERIFICATION: audited; verification only for unverified accounts', async () => {
  reset();
  const u = user('Una', { verified: false });
  const v = user('Vic');
  assert.equal((await call('POST', `/api/admin/support-console/accounts/${u.id}/sign-out`)).status, 200);
  assert.ok(db.prepare('SELECT session_invalidated_at FROM site_users WHERE id = ?').get(u.id).session_invalidated_at);
  assert.equal(auditRows('support_signed_out_everywhere').length, 1);
  assert.equal((await call('POST', `/api/admin/support-console/accounts/${u.id}/resend-verification`)).status, 200);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, u.email); assert.match(sent[0].verifyUrl, /\/api\/site-auth\/verify\?token=/);
  assert.equal((await call('POST', `/api/admin/support-console/accounts/${v.id}/resend-verification`)).status, 400, 'already verified');
});

test('TIMELINE: one person, newest first, no free text from anyone', async () => {
  reset();
  const u = user('Tim');
  db.prepare("UPDATE site_users SET created_at = '2026-09-01 09:00:00' WHERE id = ?").run(u.id);
  db.prepare("INSERT INTO purchases (id, school_domain) VALUES (1, 'riverbend.test')").run();
  db.prepare("INSERT INTO school_invitations (purchase_id, invited_email, status, created_at) VALUES (1, ?, 'pending', '2026-10-01 09:00:00')").run(u.email);
  db.prepare("INSERT INTO license_seats (purchase_id, registered_site_user_id, registered_at) VALUES (1, ?, '2026-10-02 09:00:00')").run(u.id);
  db.prepare("INSERT INTO support_requests (ref, status, subject, requester_email, site_user_id, created_at) VALUES ('SR-AAAAA', 'new', 'Please fix Jamie Smith', ?, ?, '2026-10-03 09:00:00')").run(u.email, u.id);
  db.prepare("INSERT INTO school_audit_log (actor_type, action, entity_type, entity_id, created_at) VALUES ('admin', 'support_signed_out_everywhere', 'site_user', ?, '2026-10-04 09:00:00')").run(u.id);
  const r = await call('GET', `/api/admin/support-console/timeline?email=${encodeURIComponent(u.email)}`);
  assert.equal(r.status, 200);
  const texts = r.json.events.map(e => e.text);
  assert.match(texts[0], /support signed out everywhere/);
  assert.ok(texts.some(t => /Invited to riverbend\.test \(pending\)/.test(t)));
  assert.ok(texts.some(t => /Claimed a license seat at riverbend\.test/.test(t)));
  assert.ok(texts.includes('Support request SR-AAAAA (new)'), 'reference and status only');
  assert.ok(!JSON.stringify(r.json).includes('Jamie'), 'a support subject (typed by a person) can hold a student name, so it is never shown here');
  const times = r.json.events.map(e => e.at); assert.deepEqual(times, [...times].sort().reverse());
  assert.equal((await call('GET', '/api/admin/support-console/timeline?email=nope')).status, 400);
  assert.equal((await call('GET', '/api/admin/support-console/timeline?email=x%40y.test')).json.account, null, 'a stranger gets an empty timeline, not an error');
});

test('CLASSROOM LOOKUP: by teacher email, join code or student username; lists students and lockouts; each lookup is audited', async () => {
  reset();
  lockout.pinFailsByStudent.clear('x');
  const t = user('Tess');
  const { cid, kids } = await classroom(t, ['Ana Lopez', 'Ben Cho']);
  lockUp(kids[0].username);
  for (const q of [t.email, 'abcd2345', kids[1].username]) {
    const r = await call('GET', `/api/admin/support-console/classrooms?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, q); assert.equal(r.json.classrooms.length, 1, q);
    const c = r.json.classrooms[0];
    assert.equal(c.id, cid); assert.equal(c.teacher.email, t.email);
    assert.deepEqual(c.students.map(s => s.displayName), ['Ana Lopez', 'Ben Cho']);
    assert.equal(c.students[0].locked, true); assert.ok(c.students[0].lockedMinutes >= 1); assert.equal(c.students[1].locked, false);
    assert.ok(!JSON.stringify(r.json).includes('password'), 'no hash or PIN in the response');
  }
  assert.equal(auditRows('support_viewed_classroom').length, 3);
  assert.ok(auditRows('support_viewed_classroom').every(l => l.entity_type === 'classroom' && l.entity_id === cid && l.purchase_id === null), 'not shown to any school admin');
  assert.equal((await call('GET', '/api/admin/support-console/classrooms?q=nobodyhere')).json.classrooms.length, 0);
  assert.equal((await call('GET', '/api/admin/support-console/classrooms')).status, 400);
  assert.equal((await call('GET', '/api/admin/support-console/classrooms?q[]=a')).status, 400, 'an array is not a search');
});

test('RESET PIN: a new 6-digit PIN is shown once and works; the old one stops; the lockout clears; the PIN is never logged', async () => {
  reset();
  const t = user('Tess');
  const { kids } = await classroom(t, ['Ana Lopez']);
  lockUp(kids[0].username);
  const r = await call('POST', `/api/admin/support-console/students/${kids[0].id}/reset-pin`);
  assert.equal(r.status, 200); assert.match(r.json.pin, /^\d{6}$/); assert.equal(r.json.username, kids[0].username);
  const hash = db.prepare('SELECT password_hash FROM classroom_students WHERE id = ?').get(kids[0].id).password_hash;
  assert.equal(await bcrypt.compare(r.json.pin, hash), true); assert.equal(await bcrypt.compare('123456', hash), false);
  assert.equal(lockout.lockStatus(kids[0].username).locked, false);
  assert.ok(!JSON.stringify(auditRows('support_student_pin_reset')).includes(r.json.pin));
  assert.equal(auditRows('support_student_pin_reset')[0].entity_id, kids[0].id);
  assert.equal((await call('POST', '/api/admin/support-console/students/99999/reset-pin')).status, 404);
});

test('CLEAR LOCK: staff can unlock a student; audited', async () => {
  reset();
  const t = user('Tess');
  const { kids } = await classroom(t, ['Ana Lopez']);
  lockUp(kids[0].username);
  assert.equal(lockout.lockStatus(kids[0].username).locked, true);
  assert.equal((await call('POST', `/api/admin/support-console/students/${kids[0].id}/clear-lock`)).status, 200);
  assert.equal(lockout.lockStatus(kids[0].username).locked, false);
  assert.equal(auditRows('support_student_lock_cleared').length, 1);
});

test('PARENT VIEW: linked children and invitations; extend adds 14 days; revoke ends it; only pending ones can change', async () => {
  reset();
  const t = user('Tess');
  const { cid, kids } = await classroom(t, ['Ana Lopez']);
  const p = user('Pat', { role: 'parent' });
  db.prepare('INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (?, ?, ?)').run(p.id, cid, kids[0].id);
  db.prepare("INSERT INTO parent_student_invitations (classroom_id, student_id, invited_email, status, expires_at) VALUES (?, ?, ?, 'pending', '2020-01-01 00:00:00')").run(cid, kids[0].id, p.email);
  db.prepare("INSERT INTO parent_student_invitations (classroom_id, student_id, invited_email, status, expires_at) VALUES (?, ?, ?, 'accepted', '2020-01-01 00:00:00')").run(cid, kids[0].id, p.email);
  const r = await call('GET', `/api/admin/support-console/parents?email=${encodeURIComponent(p.email)}`);
  assert.equal(r.status, 200); assert.equal(r.json.account.email, p.email);
  assert.deepEqual(r.json.children.map(c => [c.student, c.className, c.teacher]), [['Ana Lopez', 'Room 12', 'Tess Tester']]);
  assert.equal(r.json.invitations.length, 2);
  const pending = r.json.invitations.find(i => i.status === 'pending'); const accepted = r.json.invitations.find(i => i.status === 'accepted');
  assert.equal(pending.expired, true); assert.equal(accepted.expired, false);
  assert.equal(auditRows('support_viewed_parent').length, 1);

  assert.equal((await call('PUT', `/api/admin/support-console/parent-invitations/${pending.id}/extend`)).status, 200);
  const exp = new Date(db.prepare('SELECT expires_at FROM parent_student_invitations WHERE id = ?').get(pending.id).expires_at.replace(' ', 'T') + 'Z').getTime();
  const days = (exp - Date.now()) / 86400000;
  assert.ok(days > 13.9 && days < 14.1, `extended about 14 days from now (${days})`);
  assert.equal((await call('PUT', `/api/admin/support-console/parent-invitations/${accepted.id}/extend`)).status, 409);
  assert.equal((await call('PUT', `/api/admin/support-console/parent-invitations/${pending.id}/revoke`)).status, 200);
  assert.equal(db.prepare('SELECT status FROM parent_student_invitations WHERE id = ?').get(pending.id).status, 'revoked');
  assert.equal((await call('PUT', `/api/admin/support-console/parent-invitations/${pending.id}/revoke`)).status, 409, 'already revoked');
  assert.equal((await call('PUT', '/api/admin/support-console/parent-invitations/99999/extend')).status, 404);
  assert.equal(auditRows('support_parent_invitation_extended').length, 1); assert.equal(auditRows('support_parent_invitation_revoked').length, 1);
});

test('IDLE LOCK SETTING: default 5 minutes; a whole number from 1 to 120 can be saved; anything else is refused', async () => {
  reset();
  assert.equal((await call('GET', '/api/settings/privacy-lock')).json.minutes, 5);
  assert.equal((await call('PUT', '/api/settings/privacy-lock', { body: { minutes: 12 } })).status, 200);
  assert.equal((await call('GET', '/api/settings/privacy-lock')).json.minutes, 12);
  for (const bad of [0, 121, 2.5, 'abc', null, [5], {}]) assert.equal((await call('PUT', '/api/settings/privacy-lock', { body: { minutes: bad } })).status, 400, JSON.stringify(bad));
  db.prepare("UPDATE settings SET setting_value = 'garbage' WHERE setting_key = 'admin_privacy_lock_minutes'").run();
  assert.equal((await call('GET', '/api/settings/privacy-lock')).json.minutes, 5, 'a damaged value falls back to 5');
});

test('TEACHER: sees which of their own students are locked and can unlock them; nobody else\'s', { skip: teacherRoutes !== true && `classroom routes not loadable here: ${teacherRoutes}` }, async () => {
  reset();
  const mine = user('Mia'); const other = user('Otto');
  const a = await classroom(mine, ['Ana Lopez'], 'AAAA1111');
  const b = await classroom(other, ['Bo Diaz'], 'BBBB2222');
  lockUp(a.kids[0].username); lockUp(b.kids[0].username);
  const list = await call('GET', `/api/classrooms/${a.cid}/students`, { as: mine.id });
  assert.equal(list.status, 200); assert.equal(list.json[0].locked, true); assert.ok(list.json[0].lockedMinutes >= 1);
  assert.equal((await call('POST', `/api/classrooms/${a.cid}/students/${b.kids[0].id}/unlock`, { as: mine.id })).status, 404, 'a student from another classroom');
  assert.equal((await call('POST', `/api/classrooms/${b.cid}/students/${b.kids[0].id}/unlock`, { as: mine.id })).status, 404, 'another teacher\'s classroom');
  assert.equal(lockout.lockStatus(b.kids[0].username).locked, true, 'still locked');
  assert.equal((await call('POST', `/api/classrooms/${a.cid}/students/${a.kids[0].id}/unlock`, { as: mine.id })).status, 200);
  assert.equal(lockout.lockStatus(a.kids[0].username).locked, false);
  assert.equal((await call('POST', `/api/classrooms/${a.cid}/students/${a.kids[0].id}/unlock`)).status, 401);
});

test('LOGIN LOCKOUT is shared: the student login route and the support console use the same tracker and key', () => {
  const src = fs.readFileSync(path.join(SERVER, 'routes/classroom-auth.js'), 'utf8');
  assert.match(src, /require\('\.\.\/lib\/pin-lockout'\)/);
  assert.ok(!/new FailureTracker\(\{ name: 'pin-student'/.test(src), 'the tracker is defined once, in lib/pin-lockout.js');
  assert.equal(lockout.studentKey('  Ana2 '), 'username:ana2');
});

test('WIRING: idle lock script, Account Lookup, settings page and no data in inline handlers', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lockJs = read('admin-privacy-lock.js');
  for (const ev of ['mousemove', 'click']) assert.match(lockJs, new RegExp(ev));
  assert.match(lockJs, /DEFAULT_MINUTES = 5/);
  assert.match(lockJs, /api\/settings\/privacy-lock/);
  const page = read('admin-account-lookup.html');
  assert.match(page, /admin-privacy-lock\.js\?v=1/);
  assert.match(page, /fnPrivacyLock\(/);
  assert.match(page, /lock\.arm\(\)/);
  assert.ok(!/onclick="[^"]*\+ *(s|c|i|a)\.(displayName|student|name|username)/.test(page), 'no student name goes into an inline handler');
  assert.match(read('admin-settings.html'), /api\/settings\/privacy-lock/);
  assert.match(read('server/app.js'), /\/api\/admin\/support-console/);
  assert.match(read('teacher-classroom.html'), /unlockStudent/);
});
