// Shared demo environment, phase 1: the routes. Demo logins are refused while the demo is closed and get a short, marked session while it is open;
// a demo session cannot change the shared password or PIN, download a lesson file, or trigger a password-reset email.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-routes';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, first_name TEXT, last_name TEXT, role TEXT DEFAULT 'teacher', password_hash TEXT,
  email_verified INTEGER DEFAULT 1, closed_at TEXT, session_invalidated_at TEXT, is_sales_demo INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0);
CREATE TABLE site_user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT, type TEXT, expires_at TEXT);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, join_code TEXT, teacher_site_user_id INTEGER, archived_at TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, display_name TEXT, username TEXT UNIQUE, password_hash TEXT, is_active INTEGER DEFAULT 1);
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
    const p = rawParams[i++];
    params.push(p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const mailCalls = [];
const mailerStub = new Proxy({}, { get: (_, name) => async (args) => { mailCalls.push({ name, args }); } });
const noAccess = { getSiteUser: async () => null, hasActiveLicense: async () => false, hasActiveSchoolAdminAssignment: async () => false,
  hasActiveDistrictAdminAssignment: async () => false, hasActiveAffiliateAccount: async () => false, getParentClassrooms: async () => [],
  hasParentAccessToCurriculum: async () => false, isLinkedParent: async () => false };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run, getConnection: async () => ({ query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) },
  [path.join(SERVER, 'lib/mailer.js')]: mailerStub,
  [path.join(SERVER, 'lib/own-seat-claim.js')]: { claimForAccountByEmail: async () => 0, claimOwnPurchaseSeats: async () => 0 },
  [path.join(SERVER, 'lib/access.js')]: noAccess,
  [path.join(SERVER, 'lib/safety/gateway.js')]: { screenContent: async () => ({ decision: 'allow' }), isPublishable: () => true },
  [path.join(SERVER, 'lib/safety/school-context.js')]: { resolveSchoolDomainForSocialGroup: async () => null, resolveSchoolDomainForTeacher: async () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { signSession, verifySession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const { sharedDemoGate } = require(path.join(SERVER, 'lib/public-demo.js'));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', sharedDemoGate);
app.use('/api/site-auth', require(path.join(SERVER, 'routes/site-auth.js')).router);
app.use('/api/classroom-auth', require(path.join(SERVER, 'routes/classroom-auth.js')).router);
app.use('/api/classrooms', require(path.join(SERVER, 'routes/classrooms.js')));
app.use('/api/curricula', require(path.join(SERVER, 'routes/curriculum.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { cookie = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const setSetting = (k, v) => db.prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value').run(k, v);
const openDemo = () => { setSetting('public_demo_enabled', 'true'); setSetting('public_demo_ends_at', new Date(Date.now() + 3600 * 1000).toISOString()); };
const closeDemo = () => { setSetting('public_demo_enabled', 'false'); setSetting('public_demo_ends_at', ''); };

const PASSWORD = 'demo-shared-password-1';
const hash = bcrypt.hashSync(PASSWORD, 4);
const addUser = (email, shared) => Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, password_hash, is_shared_demo, is_sales_demo) VALUES (?, ?, ?, ?, ?, ?)')
  .run(email, 'Demo', 'User', hash, shared ? 1 : 0, shared ? 1 : 0).lastInsertRowid);
const demoTeacher = addUser('demo-teacher@public-demo.example.com', true);
const plainTeacher = addUser('real-teacher@school.test', false);
const demoRoom = Number(db.prepare("INSERT INTO classrooms (name, join_code, teacher_site_user_id) VALUES ('Demo class', 'DEMOJOIN', ?)").run(demoTeacher).lastInsertRowid);
const plainRoom = Number(db.prepare("INSERT INTO classrooms (name, join_code, teacher_site_user_id) VALUES ('Real class', 'REALJOIN', ?)").run(plainTeacher).lastInsertRowid);
const pinHash = bcrypt.hashSync('123456', 4);
db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Demo Student', 'demo-student', ?)").run(demoRoom, pinHash);
db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Real Student', 'real-student', ?)").run(plainRoom, pinHash);

const demoCookie = () => `fn_user_session=${signSession('site', { userId: demoTeacher, demo: true }, '1h')}`;
const plainCookie = () => `fn_user_session=${signSession('site', { userId: plainTeacher }, '1h')}`;
const cookieValue = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find(c => c.startsWith(name + '='));
  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

test('SITE LOGIN, demo closed: the correct shared password is refused exactly like a wrong one', async () => {
  closeDemo();
  const r = await call('POST', '/api/site-auth/login', { body: { email: 'demo-teacher@public-demo.example.com', password: PASSWORD } });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'Invalid email or password');
  assert.equal(cookieValue(r, 'fn_user_session'), null);
  const wrong = await call('POST', '/api/site-auth/login', { body: { email: 'demo-teacher@public-demo.example.com', password: 'nope-nope-nope' } });
  assert.deepEqual(wrong.json, r.json, 'no way to tell "demo is closed" from "wrong password"');
});

test('SITE LOGIN, demo open: signs in with an 8-hour session carrying the demo claim', async () => {
  openDemo();
  const r = await call('POST', '/api/site-auth/login', { body: { email: 'demo-teacher@public-demo.example.com', password: PASSWORD } });
  assert.equal(r.status, 200);
  const payload = verifySession('site', cookieValue(r, 'fn_user_session'));
  assert.equal(payload.demo, true);
  assert.equal(payload.exp - payload.iat, 8 * 3600);
});

test('SITE LOGIN: an ordinary account is unaffected by the demo switch (30-day session, no demo claim)', async () => {
  closeDemo();
  const r = await call('POST', '/api/site-auth/login', { body: { email: 'real-teacher@school.test', password: PASSWORD } });
  assert.equal(r.status, 200);
  const payload = verifySession('site', cookieValue(r, 'fn_user_session'));
  assert.equal(payload.demo, undefined);
  assert.equal(payload.exp - payload.iat, 30 * 24 * 3600);
});

test('SESSION: a demo session works while open and is signed out the moment the demo closes', async () => {
  openDemo();
  const open = await call('GET', '/api/site-auth/me', { cookie: demoCookie() });
  assert.equal(open.json.loggedIn, true);
  closeDemo();
  const closed = await call('GET', '/api/site-auth/me', { cookie: demoCookie() });
  assert.equal(closed.json.loggedIn, false);
});

test('PASSWORD: a demo session cannot change the shared password, or edit the profile', async () => {
  openDemo();
  const before = db.prepare('SELECT password_hash FROM site_users WHERE id = ?').get(demoTeacher).password_hash;
  const change = await call('PUT', '/api/site-auth/change-password', { cookie: demoCookie(), body: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password-9' } });
  assert.equal(change.status, 403);
  assert.equal(change.json.demo, true);
  assert.equal(db.prepare('SELECT password_hash FROM site_users WHERE id = ?').get(demoTeacher).password_hash, before);
  const profile = await call('PUT', '/api/site-auth/profile', { cookie: demoCookie(), body: { firstName: 'X', lastName: 'Y' } });
  assert.equal(profile.status, 403);
  // the same route still runs for an ordinary teacher (it gets as far as checking the current password)
  const plain = await call('PUT', '/api/site-auth/change-password', { cookie: plainCookie(), body: { currentPassword: 'wrong-current-password', newPassword: 'a-brand-new-password-9' } });
  assert.equal(plain.status, 401);
});

test('RESET: forgot-password sends nothing for a demo account, and a reset link for one is refused', async () => {
  closeDemo();
  mailCalls.length = 0;
  const demo = await call('POST', '/api/site-auth/forgot-password', { body: { email: 'demo-teacher@public-demo.example.com' } });
  assert.equal(demo.status, 200);
  assert.equal(mailCalls.length, 0, 'no reset email for a demo account');
  const plain = await call('POST', '/api/site-auth/forgot-password', { body: { email: 'real-teacher@school.test' } });
  assert.equal(plain.status, 200);
  assert.equal(mailCalls.filter(c => c.name === 'sendPasswordResetEmail').length, 1, 'an ordinary account still gets its reset email');
  db.prepare("INSERT INTO site_user_tokens (user_id, token, type, expires_at) VALUES (?, 'tok-demo', 'reset', '2999-01-01 00:00:00')").run(demoTeacher);
  const reset = await call('POST', '/api/site-auth/reset-password', { body: { token: 'tok-demo', newPassword: 'a-brand-new-password-9' } });
  assert.equal(reset.status, 400);
  assert.equal(db.prepare('SELECT password_hash FROM site_users WHERE id = ?').get(demoTeacher).password_hash, hash);
});

test('STUDENT LOGIN: a demo student is refused while the demo is closed, and gets a marked 8-hour session while open', async () => {
  closeDemo();
  const closed = await call('POST', '/api/classroom-auth/login', { body: { username: 'demo-student', pin: '123456' } });
  assert.equal(closed.status, 401);
  assert.equal(closed.json.error, 'Invalid username or PIN');
  openDemo();
  const open = await call('POST', '/api/classroom-auth/login', { body: { username: 'demo-student', pin: '123456' } });
  assert.equal(open.status, 200);
  const payload = verifySession('student', cookieValue(open, 'fn_student_session'));
  assert.equal(payload.demo, true);
  assert.equal(payload.exp - payload.iat, 8 * 3600);
  closeDemo();
  const real = await call('POST', '/api/classroom-auth/login', { body: { username: 'real-student', pin: '123456' } });
  assert.equal(real.status, 200, 'an ordinary student is unaffected');
  assert.equal(verifySession('student', cookieValue(real, 'fn_student_session')).demo, undefined);
});

test('JOIN CODE: a demo classroom answers its join code only while the demo is open', async () => {
  closeDemo();
  const closed = await call('POST', '/api/classroom-auth/join', { body: { joinCode: 'DEMOJOIN', displayName: 'Visitor One', pin: '654321' } });
  assert.equal(closed.status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM classroom_students WHERE display_name = 'Visitor One'").get().n, 0, 'no student row is made');
  openDemo();
  const open = await call('POST', '/api/classroom-auth/join', { body: { joinCode: 'DEMOJOIN', displayName: 'Visitor One', pin: '654321' } });
  assert.equal(open.status, 200);
  assert.equal(verifySession('student', cookieValue(open, 'fn_student_session')).demo, true);
  const real = await call('POST', '/api/classroom-auth/join', { body: { joinCode: 'REALJOIN', displayName: 'Real Kid', pin: '654321' } });
  assert.equal(real.status, 200);
  assert.equal(verifySession('student', cookieValue(real, 'fn_student_session')).demo, undefined);
});

test('STUDENT SESSION: a demo student cookie stops working when the demo closes', async () => {
  openDemo();
  const login = await call('POST', '/api/classroom-auth/login', { body: { username: 'demo-student', pin: '123456' } });
  const cookie = `fn_student_session=${cookieValue(login, 'fn_student_session')}`;
  closeDemo();
  // the gate drops the cookie, so a student-only route says "Not logged in"
  const r = await call('GET', '/api/classroom-auth/me', { cookie });
  assert.equal(r.status, 401);
});

test('PIN: a demo teacher cannot change a student PIN; an ordinary teacher still can reach that route', async () => {
  openDemo();
  const demo = await call('PUT', `/api/classrooms/${demoRoom}/students/1`, { cookie: demoCookie(), body: { pin: '999999' } });
  assert.equal(demo.status, 403);
  assert.equal(demo.json.demo, true);
  const plain = await call('PUT', `/api/classrooms/${plainRoom}/students/9999`, { cookie: plainCookie(), body: { pin: '999999' } });
  assert.equal(plain.status, 404, 'not blocked by the demo rule (this student simply does not exist)');
});

test('PARENT INVITE: a demo teacher may only name a fake address; an ordinary teacher is not restricted', async () => {
  openDemo();
  const real = await call('POST', `/api/classrooms/${demoRoom}/students/1/invite-parent`, { cookie: demoCookie(), body: { email: 'someones.mum@gmail.com' } });
  assert.equal(real.status, 403);
  assert.equal(real.json.demo, true);
  assert.match(real.json.error, /example\.com/);
  const fake = await call('POST', `/api/classrooms/${demoRoom}/students/9999/invite-parent`, { cookie: demoCookie(), body: { email: 'parent2@example.com' } });
  assert.equal(fake.status, 404, 'a fake address passes the demo rule (this student simply does not exist)');
  const plain = await call('POST', `/api/classrooms/${plainRoom}/students/9999/invite-parent`, { cookie: plainCookie(), body: { email: 'someones.mum@gmail.com' } });
  assert.equal(plain.status, 404, 'an ordinary teacher can name any address');
});

test('DOWNLOAD: a demo session may not download a lesson file; viewing and ordinary users are untouched', async () => {
  openDemo();
  const demo = await call('GET', '/api/curricula/1/file?resource=Teacher%20Copy&download=1', { cookie: demoCookie() });
  assert.equal(demo.status, 403);
  assert.equal(demo.json.demo, true);
  // without ?download=1 the demo session is not stopped by the demo rule (it falls through to the normal checks)
  const view = await call('GET', '/api/curricula/1/file', { cookie: demoCookie() });
  assert.equal(view.status, 400, 'the normal "resource or doc required" answer, not the demo refusal');
  const plain = await call('GET', '/api/curricula/1/file?download=1', { cookie: plainCookie() });
  assert.equal(plain.status, 400);
});
