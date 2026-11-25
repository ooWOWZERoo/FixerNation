// Staff "view as" (phase C of docs/reference/help-support-tools-requirements.md, section C). A CRM Admin starts a read-only view of a teacher's, school
// administrator's or district administrator's screens. The view is a token in one tab (X-View-As header), never a cookie; it works only with the same
// admin's live session; it is GET only, on a short list of routes that carry no student data; it answers as the person and as nobody else; it can write
// no cookie; and it ends by itself. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SESSION_SECRET = 'view-as-test-secret';

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE admin_users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, email_verified INTEGER DEFAULT 1, session_invalidated_at TEXT, crm_role TEXT DEFAULT 'admin');
CREATE TABLE site_users (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, role TEXT, closed_at TEXT, is_fne_staff INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0, is_sales_demo INTEGER DEFAULT 0, session_invalidated_at TEXT);
CREATE TABLE view_as_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, target_site_user_id INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', jti TEXT NOT NULL UNIQUE, started_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, ended_at TEXT, ended_by TEXT);
`);
const toSql = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const run = async (sql, rawParams = []) => {
  const params = [];
  let i = 0;
  const s = sql.trim().replace(/\?/g, () => { const v = rawParams[i++]; params.push(v instanceof Date ? toSql(v) : v); return '?'; });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};

// who holds what (the three checks the real lib/access.js makes against license, school-admin and district-admin tables)
const holds = { licensed: new Set(), school: new Set(), district: new Set() };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
  [path.join(SERVER, 'lib/access.js')]: {
    hasActiveLicense: async (id) => holds.licensed.has(id),
    hasActiveSchoolAdminAssignment: async (id) => holds.school.has(id),
    hasActiveDistrictAdminAssignment: async (id) => holds.district.has(id),
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signSession, verifySession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const { requireAuth } = require(path.join(SERVER, 'middleware/auth.js'));
const { viewAsGate } = require(path.join(SERVER, 'lib/view-as.js'));
const VR = require(path.join(SERVER, 'lib/view-as-routes.js'));

// Stand-ins for site routes, so the gate's behaviour can be checked without every real route's tables.
const site = express.Router();
site.get('/site-auth/me', (req, res) => {
  const t = req.cookies.fn_user_session;
  res.json({ asUser: t ? verifySession('site', t).userId : null, adminCookieSeen: !!req.cookies.fn_session, studentCookieSeen: !!req.cookies.fn_student_session });
});
site.get('/site-auth/profile', (req, res) => { res.cookie('fn_user_session', 'refreshed', { httpOnly: true }); res.json({ ok: true }); });
site.get('/classrooms', (req, res) => res.json([{ id: 1, name: 'Room 4', join_code: 'ABC123', parent_code: 'PARENT1', student_count: 22, students: [{ display_name: 'Kid' }], nested: { token: 'x', keep: 'yes' } }]));
site.get('/classrooms/:id', (req, res) => res.json({ id: 1, students: [{ display_name: 'Sam Student' }] })); // NOT on the list
site.post('/classrooms', (req, res) => res.status(201).json({ created: true }));
site.put('/classrooms/1', (req, res) => res.json({ changed: true }));
site.delete('/classrooms/1', (req, res) => res.json({ deleted: true }));
site.get('/admin/secret', requireAuth, (req, res) => res.json({ staff: true }));
site.get('/curricula/:id', (req, res) => res.json({ recordsUsage: true })); // NOT on the list
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', viewAsGate());
app.use('/api/admin/view-as', require(path.join(SERVER, 'routes/admin-view-as.js')));
app.use('/api/view-as', require(path.join(SERVER, 'routes/view-as.js')));
app.use('/api', site);
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { body = null, cookies = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== null ? JSON.stringify(body) : null;
    const h = { ...headers };
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.Cookie = cookie;
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers: h }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = {}; try { json = b ? JSON.parse(b) : {}; } catch { /* not json */ } resolve({ status: res.statusCode, json, headers: res.headers }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const adminCookie = (id = 7, expiresIn = '1h') => ({ fn_session: signSession('admin', { userId: id }, expiresIn) });
function reset() {
  for (const t of ['settings', 'school_audit_log', 'admin_users', 'site_users', 'view_as_sessions']) db.exec(`DELETE FROM ${t}`);
  holds.licensed.clear(); holds.school.clear(); holds.district.clear();
  db.prepare("INSERT INTO admin_users (id, username, email, crm_role) VALUES (7, 'ada', 'ada@fne.test', 'admin'), (8, 'bo', 'bo@fne.test', 'admin'), (9, 'sam', 'sam@fne.test', 'sales'), (10, 'ro', 'ro@fne.test', 'readonly')").run();
  const u = db.prepare('INSERT INTO site_users (id, email, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)');
  u.run(100, 'teacher@school.test', 'Tess', 'Teacher', 'teacher');
  u.run(101, 'principal@school.test', 'Pat', 'Principal', 'teacher'); holds.school.add(101);
  u.run(102, 'super@district.test', 'Dee', 'Super', 'teacher'); holds.district.add(102);
  u.run(103, 'parent@home.test', 'Pia', 'Parent', 'parent');
  u.run(104, 'staff@fne.test', 'Stu', 'Staff', 'teacher'); db.prepare('UPDATE site_users SET is_fne_staff = 1 WHERE id = 104').run();
  u.run(105, 'demo@public-demo.example.com', 'Dem', 'O', 'teacher'); db.prepare('UPDATE site_users SET is_shared_demo = 1 WHERE id = 105').run();
  u.run(106, 'closed@school.test', 'Cal', 'Closed', 'teacher'); db.prepare("UPDATE site_users SET closed_at = '2026-01-01 00:00:00' WHERE id = 106").run();
  u.run(107, 'sales@fne.test', 'Sal', 'Sales', 'teacher'); db.prepare('UPDATE site_users SET is_sales_demo = 1 WHERE id = 107').run();
  u.run(108, 'ada@fne.test', 'Ada', 'Self', 'teacher');
  holds.licensed.add(100);
}
const start = (id, reason = 'Support request FNE-1234', cookies = adminCookie()) => call('POST', '/api/admin/view-as/start', { body: { siteUserId: id, reason }, cookies });
const viewing = (token, extra = {}) => ({ headers: { 'X-View-As': token }, cookies: adminCookie(), ...extra });

test('START: a CRM Admin can start a view of a teacher, school administrator or district administrator, and is told where to land', async () => {
  reset();
  const t = await start(100); assert.equal(t.status, 200); assert.equal(t.json.landing, 'teacher-classrooms.html'); assert.deepEqual(t.json.person.roles, ['teacher']);
  const s = await start(101); assert.equal(s.json.landing, 'school-admin-dashboard.html');
  const d = await start(102); assert.equal(d.json.landing, 'district-admin-dashboard.html');
  assert.ok(t.json.token && t.json.expiresAt && t.json.minutes === 20);
  const row = db.prepare('SELECT reason, target_site_user_id FROM view_as_sessions ORDER BY id LIMIT 1').get();
  assert.equal(row.reason, 'Support request FNE-1234'); assert.equal(row.target_site_user_id, 100);
});

test('START: refused for a parent, staff, demo, closed or own account, a missing person, a short reason, and anyone who is not a CRM Admin', async () => {
  reset();
  for (const [id, why] of [[103, /Only teachers/], [104, /Staff accounts/], [105, /Demo accounts/], [107, /Demo accounts/], [106, /closed/], [108, /own account/], [999, /does not exist/]]) {
    const r = await start(id); assert.equal(r.status, 400, `id ${id}`); assert.match(r.json.error, why);
  }
  assert.equal((await start('abc')).status, 400);
  assert.equal((await start(100, 'no')).status, 400, 'a reason is required');
  assert.equal((await start(100, '   ')).status, 400);
  assert.equal((await start(100, 'Support request FNE-1234', adminCookie(9))).status, 403, 'a Sales login cannot');
  assert.equal((await start(100, 'Support request FNE-1234', adminCookie(10))).status, 403, 'a Read-only login cannot');
  assert.equal((await start(100, 'Support request FNE-1234', {})).status, 401, 'nobody signed in cannot');
  assert.equal((await start(100, 'Support request FNE-1234', { fn_session: signSession('site', { userId: 7 }, '1h') })).status, 401, 'a site-user token pasted as an admin cookie cannot');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM view_as_sessions').get().n, 0, 'nothing was saved by any refusal');
});

test('THE VIEW: GET on a listed route answers as the person, with the staff member\'s own cookies removed', async () => {
  reset();
  const { json: { token } } = await start(100);
  const r = await call('GET', '/api/site-auth/me', viewing(token, { cookies: { ...adminCookie(), fn_student_session: 'whatever', fn_user_session: signSession('site', { userId: 555 }, '1h') } }));
  assert.equal(r.status, 200);
  assert.equal(r.json.asUser, 100, 'the person, not whatever site session the staff browser holds');
  assert.equal(r.json.adminCookieSeen, false); assert.equal(r.json.studentCookieSeen, false);
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  const plain = await call('GET', '/api/site-auth/me', { cookies: adminCookie() });
  assert.equal(plain.json.adminCookieSeen, true, 'a request without the header (another tab) is untouched');
  assert.equal(plain.json.asUser, null);
});

test('READ ONLY: every write is refused in the view, and only the listed GET routes answer', async () => {
  reset();
  const { json: { token } } = await start(100);
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await call(m, '/api/classrooms' + (m === 'POST' ? '' : '/1'), viewing(token, { body: {} }));
    assert.equal(r.status, 403, m); assert.match(r.json.error, /read-only/); assert.equal(r.json.viewAs, true);
  }
  assert.equal((await call('PATCH', '/api/classrooms/1', viewing(token, { body: {} }))).status, 403);
  const nope = await call('GET', '/api/classrooms/1', viewing(token));
  assert.equal(nope.status, 403, 'a student roster is not on the list'); assert.match(nope.json.error, /not available/);
  assert.equal((await call('GET', '/api/curricula/5', viewing(token))).status, 403, 'a route that records usage is not on the list');
  assert.equal((await call('GET', '/api/admin/secret', viewing(token))).status, 403, 'staff routes are not reachable in a view');
  assert.equal((await call('GET', '/api/classrooms', viewing(token))).status, 200, 'a listed one is');
});

test('SCRUB and COOKIES: student-looking and credential-looking keys are removed from what a view receives, and no cookie can be written back', async () => {
  reset();
  const { json: { token } } = await start(100);
  const r = await call('GET', '/api/classrooms', viewing(token));
  assert.deepEqual(r.json, [{ id: 1, name: 'Room 4', student_count: 22, nested: { keep: 'yes' } }]);
  const c = await call('GET', '/api/site-auth/profile', viewing(token));
  assert.equal(c.status, 200); assert.equal(c.headers['set-cookie'], undefined, 'no Set-Cookie reaches the staff browser');
  const normal = await call('GET', '/api/site-auth/profile', { cookies: adminCookie() });
  assert.ok(normal.headers['set-cookie'], 'a normal request still gets its cookie (the suppression is only for views)');
});

test('BOUND TO THE ADMIN: the token needs the same admin\'s live session, and nothing else works as a token', async () => {
  reset();
  const { json: { token } } = await start(100);
  const check = async (extra, label) => { const r = await call('GET', '/api/site-auth/me', extra); assert.equal(r.status, 401, label); assert.equal(r.json.ended, true, label); };
  await check({ headers: { 'X-View-As': token } }, 'no admin cookie at all');
  await check({ headers: { 'X-View-As': token }, cookies: adminCookie(8) }, 'a different admin\'s cookie');
  await check({ headers: { 'X-View-As': token }, cookies: { fn_session: signSession('site', { userId: 7 }, '1h') } }, 'a site-user token in the admin cookie');
  await check({ headers: { 'X-View-As': 'not-a-token' }, cookies: adminCookie() }, 'garbage');
  await check({ headers: { 'X-View-As': signSession('admin', { staffId: 7, targetId: 100, jti: 'x' }, '1h') }, cookies: adminCookie() }, 'an admin-audience token');
  await check({ headers: { 'X-View-As': signSession('site', { staffId: 7, targetId: 100, jti: 'x' }, '1h') }, cookies: adminCookie() }, 'a site-audience token');
  await check({ headers: { 'X-View-As': signSession('viewAs', { staffId: 7, targetId: 100, jti: 'nosuchrow' }, '1h') }, cookies: adminCookie() }, 'a validly signed token with no saved session');
  await check({ headers: { 'X-View-As': signSession('viewAs', { staffId: 7, targetId: 100, jti: 'x' }, '-10s') }, cookies: adminCookie() }, 'an expired token');
  db.prepare('UPDATE admin_users SET session_invalidated_at = ? WHERE id = 7').run(toSql(new Date(Date.now() + 60000)));
  await check({ headers: { 'X-View-As': token }, cookies: adminCookie() }, 'admin signed out everywhere');
  db.prepare('UPDATE admin_users SET session_invalidated_at = NULL WHERE id = 7').run();
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 200, 'and the real token still works when all that is fine');
  db.prepare('DELETE FROM admin_users WHERE id = 7').run();
  await check(viewing(token), 'the admin no longer exists');
});

test('ROLE: lowering the admin\'s CRM role ends the view at once', async () => {
  reset();
  const { json: { token } } = await start(100);
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 200);
  db.prepare("UPDATE admin_users SET crm_role = 'sales' WHERE id = 7").run();
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 403);
});

test('ENDS: Stop, a newer view, the 20 minutes, the person\'s account closing, a password reset and the person becoming ineligible each end it', async () => {
  reset();
  let { json: { token } } = await start(100);
  const stop = await call('POST', '/api/view-as/end', viewing(token, { body: {} }));
  assert.equal(stop.status, 200, 'ending is the one write a view may make');
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 401);
  assert.equal(db.prepare('SELECT ended_by FROM view_as_sessions').get().ended_by, 'stop');
  assert.equal(db.prepare("SELECT action FROM school_audit_log WHERE action = 'view_as_ended'").all().length, 1);

  reset(); const first = (await start(100)).json.token; const second = (await start(101)).json.token;
  assert.equal((await call('GET', '/api/site-auth/me', viewing(first))).status, 401, 'one at a time: the newer view replaces the older');
  assert.equal((await call('GET', '/api/site-auth/me', viewing(second))).status, 200);
  assert.deepEqual(db.prepare('SELECT ended_by FROM view_as_sessions ORDER BY id').all().map(r => r.ended_by), ['replaced', null]);

  reset(); token = (await start(100)).json.token;
  db.prepare('UPDATE view_as_sessions SET expires_at = ?').run(toSql(new Date(Date.now() - 1000)));
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 401, 'past its 20 minutes');

  reset(); token = (await start(100)).json.token;
  db.prepare("UPDATE site_users SET closed_at = '2026-11-24 10:00:00' WHERE id = 100").run();
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 401, 'the account was closed');
  assert.ok(db.prepare('SELECT ended_at FROM view_as_sessions').get().ended_at, 'and the row is closed');

  reset(); token = (await start(100)).json.token;
  db.prepare('UPDATE site_users SET session_invalidated_at = ? WHERE id = 100').run(toSql(new Date(Date.now() + 5000)));
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 401, 'their password was reset or they were signed out everywhere');

  reset(); token = (await start(100)).json.token;
  holds.licensed.delete(100); db.prepare("UPDATE site_users SET role = 'parent' WHERE id = 100").run();
  assert.equal((await call('GET', '/api/site-auth/me', viewing(token))).status, 401, 'no longer a teacher or administrator');
});

test('HISTORY and AUDIT: the reason is kept with the view, the audit log gets ids only, and only a CRM Admin can read the history', async () => {
  reset();
  await start(100, 'Ticket FNE-5555: cannot see lessons');
  await call('POST', '/api/admin/view-as/end', { body: {}, cookies: adminCookie() });
  const h = await call('GET', '/api/admin/view-as/history/100', { cookies: adminCookie() });
  assert.equal(h.status, 200); assert.equal(h.json.views.length, 1);
  assert.equal(h.json.views[0].staff, 'ada'); assert.equal(h.json.views[0].reason, 'Ticket FNE-5555: cannot see lessons'); assert.equal(h.json.views[0].endedBy, 'stop');
  const log = db.prepare('SELECT action, entity_type, entity_id, reason FROM school_audit_log ORDER BY id').all();
  assert.deepEqual(log.map(l => l.action), ['view_as_started', 'view_as_ended']);
  assert.ok(log.every(l => l.entity_type === 'site_user'));
  assert.ok(!JSON.stringify(log).includes('FNE-5555'), 'the reason text is not in the audit log');
  assert.equal((await call('GET', '/api/admin/view-as/history/100', { cookies: adminCookie(9) })).status, 403);
  assert.equal((await call('GET', '/api/admin/view-as/history/100')).status, 401);
});

test('THE LIST: closed by default, GET only, no student-data words, and no listed handler writes', () => {
  assert.ok(VR.ALLOWED_GET.length >= 30 && VR.ALLOWED_GET.length <= 70, 'a reviewed list of a sensible size');
  for (const p of VR.ALLOWED_GET) {
    assert.ok(p.startsWith('/') && !p.includes('?'), p);
    assert.ok(!/(student|reflection|answer|goal|pin\b|portrait|progress|brain|parent|export|download|csv|invitation|check-email|completions)|(^|[/-])files?($|[/-])/i.test(p), `${p} looks like student data, a download or a write helper`);
  }
  assert.ok(!VR.isAllowed('GET', '/classrooms/5') && !VR.isAllowed('GET', '/classrooms/5/students') && !VR.isAllowed('GET', '/curricula/5') && !VR.isAllowed('GET', '/student/me'));
  assert.ok(!VR.isAllowed('POST', '/classrooms') && !VR.isAllowed('POST', '/view-as/status') && !VR.isAllowed('DELETE', '/view-as/end'));
  assert.ok(VR.isAllowed('POST', '/view-as/end') && VR.isAllowed('GET', '/classrooms/12/assignments') && VR.isAllowed('GET', '/standards/states/NY/'));
  // every listed route's own handler must contain no INSERT, UPDATE or DELETE (a helper it calls is checked by reading, see the file's header)
  const mounts = [
    ['/site-auth', 'site-auth'], ['/support', 'support'], ['/curricula', 'curriculum'], ['/teacher/lesson-plans', 'teacher-lesson-plans'], ['/classrooms', 'classrooms'],
    ['/school-admin', 'school-admin'], ['/district-admin/standards', 'district-admin-standards'], ['/district-admin/repeat', 'district-admin-repeat'], ['/district-admin', 'district-admin'],
    ['/program-report', 'program-report'], ['/graduate-evidence', 'pog-evidence'], ['/standards', 'standards'], ['/license-products', 'license-products'],
    ['/help-center', 'help-center'], ['/settings', 'settings'], ['/view-as', 'view-as'],
  ];
  for (const pattern of VR.ALLOWED_GET) {
    const m = mounts.find(([prefix]) => pattern === prefix || pattern.startsWith(prefix + '/'));
    assert.ok(m, `${pattern} has a route file in this test's table`);
    const sub = pattern.slice(m[0].length) || '/';
    const src = read(`server/routes/${m[1]}.js`);
    const parts = src.split(/\n(?=router\.(?:get|post|put|patch|delete)\()/);
    const block = parts.find(b => b.startsWith(`router.get('${sub}'`));
    assert.ok(block, `${pattern}: no router.get('${sub}') in ${m[1]}.js`);
    assert.ok(!/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(block), `${pattern}: the handler writes`);
  }
});

test('SCRUB list covers what names a student, holds a student\'s writing, or lets someone join or sign in', () => {
  for (const k of ['join_code', 'parent_code', 'pin', 'password_hash', 'token', 'accept_token', 'students', 'display_name', 'student_number', 'reflections', 'answers', 'goals']) assert.ok(VR.SCRUB_KEYS.has(k), k);
  assert.deepEqual(VR.scrub({ a: [{ students: [1], b: 2 }], c: { pin: 1, d: 3 } }), { a: [{ b: 2 }], c: { d: 3 } });
  assert.equal(VR.scrub('text'), 'text'); assert.equal(VR.scrub(null), null);
});

test('WIRING: the gate runs before the demo gate and every route; the permission is CRM Admin only; the token has its own audience; the page pieces exist', () => {
  const app = read('server/app.js');
  assert.ok(app.indexOf("app.use('/api', viewAsGate())") > app.indexOf('app.use(cookieParser())'), 'after the cookies are parsed');
  assert.ok(app.indexOf("app.use('/api', viewAsGate())") < app.indexOf("app.use('/api', sharedDemoGate)"), 'before the demo gate');
  assert.ok(app.indexOf("app.use('/api', viewAsGate())") < app.indexOf("app.use('/api/auth', authRoutes.router)"), 'before every route');
  assert.match(app, /app\.use\('\/api\/admin\/view-as', adminViewAsRoutes\)/); assert.match(app, /app\.use\('\/api\/view-as', viewAsRoutes\)/);
  const perms = require(path.join(SERVER, 'lib/crm-permissions.js'));
  assert.deepEqual(perms.ALLOWED.view_as, ['admin']);
  assert.match(read('server/lib/session-tokens.js'), /viewAs: 'fn:view-as'/);
  assert.ok(!/jwt\.(sign|verify)/.test(read('server/lib/view-as.js')), 'tokens only through session-tokens.js');
  const admin = read('server/routes/admin-view-as.js');
  const handlers = admin.match(/router\.(get|post)\(/g) || [];
  assert.equal((admin.match(/requireAuth, requireCrmRole\('view_as'\)/g) || []).length, handlers.length, 'every staff route needs the role');
  for (const f of ['nav.js', 'school-admin-nav.js', 'district-admin-nav.js']) assert.match(read(f), /fnViewAsToken[\s\S]{0,200}view-as\.js/, `${f} loads view-as.js in a view tab only`);
  const js = read('view-as.js');
  assert.match(js, /X-View-As/); assert.match(js, /sessionStorage/); assert.ok(!/document\.cookie|localStorage/.test(js), 'the token never goes in a cookie or shared storage');
  const start = read('view-as-start.html');
  assert.match(start, /history\.replaceState/); assert.match(start, /teacher-classrooms\.html/); assert.match(start, /noindex/);
  assert.ok(!/innerHTML/.test(js + start));
  const lookup = read('admin-account-lookup.html');
  assert.match(lookup, /startViewAs/); assert.match(lookup, /\/api\/admin\/view-as\/start/);
  assert.ok(fs.existsSync(path.join(SERVER, 'scripts/alter-create-view-as.js')));
  assert.match(read('server/db/schema.sql'), /CREATE TABLE IF NOT EXISTS view_as_sessions/);
});
