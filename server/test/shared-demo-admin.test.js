// Shared demo environment, phase 3: the admin API behind the Demo page (docs/reference/shared-demo-environment-requirements.md, section 5).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
require('express-async-errors');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, first_name TEXT, last_name TEXT, role TEXT, password_hash TEXT, email_verified INTEGER DEFAULT 0,
  is_sales_demo INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0, session_invalidated_at TEXT, closed_at TEXT, closed_reason TEXT);
CREATE TABLE site_user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT, type TEXT, expires_at TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE license_products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, seat_count INTEGER, price_cents INTEGER, call_for_quote INTEGER, variable_seats INTEGER, active INTEGER, sort_order INTEGER);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, source TEXT, status TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, product_type TEXT, license_product_id INTEGER, seat_count INTEGER, source TEXT, payment_method TEXT, payment_status TEXT, school_domain TEXT, school_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, status TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY AUTOINCREMENT, published INTEGER);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, teacher_site_user_id INTEGER, join_code TEXT, parent_code TEXT, grade_level TEXT, subject TEXT, academic_year TEXT, archived_at TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, display_name TEXT, username TEXT UNIQUE, password_hash TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, curriculum_id INTEGER, assigned_by_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE student_reflections (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, body TEXT);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, student_id INTEGER);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER,
  purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT);
`);
for (let i = 0; i < 4; i++) db.prepare('INSERT INTO curricula (published) VALUES (1)').run();

const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => { params.push(rawParams[i++]); return '?'; });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const conn = () => ({ query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
const unlocked = [];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run, getConnection: async () => conn() },
  // requireAuth: an admin is whoever sends the x-admin header (the real middleware needs the admin_users table and a signed cookie)
  [path.join(SERVER, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (req.get('x-admin')) { req.user = { userId: 7, username: 'admin' }; return next(); } res.status(401).json({ error: 'Not logged in' }); },
    getAuthUser: () => null,
  },
  // the lockout trackers live in routes/site-auth.js (tested against the real file in shared-demo-routes.test.js)
  [path.join(SERVER, 'routes/site-auth.js')]: { siteLoginBlockedFor: (e) => (e === 'demo-teacher@public-demo.example.com' ? 540 : 0), unlockSiteLogin: (e) => unlocked.push(e) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const F = require(path.join(SERVER, 'lib/public-demo-fixtures.js'));
const A = require(path.join(SERVER, 'lib/public-demo-admin.js'));
const { lockStatus } = require(path.join(SERVER, 'lib/pin-lockout.js'));
const app = express();
app.use(express.json());
app.use('/api/admin/public-demo', require(path.join(SERVER, 'routes/admin-public-demo.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { admin = true, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = method === 'GET' ? null : JSON.stringify(body || {});
    const headers = {};
    if (admin) headers['x-admin'] = '1';
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: '/api/admin/public-demo' + p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const get = (k) => (db.prepare('SELECT setting_value AS v FROM settings WHERE setting_key = ?').get(k) || {}).v;
const audits = () => db.prepare("SELECT * FROM school_audit_log WHERE entity_type = 'public_demo' ORDER BY id").all();
const teacher = () => db.prepare('SELECT id FROM site_users WHERE email = ?').get(F.ACCOUNTS.teacher.email).id;

test('AUTH: every route needs the admin, and the file gates itself once for all of them', async () => {
  for (const [m, p] of [['GET', ''], ['POST', '/setup'], ['POST', '/on'], ['POST', '/off'], ['POST', '/regenerate-code'], ['POST', '/regenerate-password'], ['POST', '/reset'], ['POST', '/unlock']]) {
    assert.equal((await call(m, p, { admin: false, body: { days: 1 } })).status, 401, `${m} ${p}`);
  }
  const src = fs.readFileSync(path.join(SERVER, 'routes/admin-public-demo.js'), 'utf8');
  assert.match(src, /router\.use\(requireAuth\)/);
  assert.ok(src.indexOf('router.use(requireAuth)') < src.indexOf("router.get('/'"), 'the gate comes before the first route');
  assert.match(fs.readFileSync(path.join(SERVER, 'app.js'), 'utf8'), /app\.use\('\/api\/admin\/public-demo', adminPublicDemoRoutes\)/);
});

test('BEFORE SETUP: closed, nothing seeded, and no secrets in the answer', async () => {
  const r = await call('GET', '');
  assert.equal(r.status, 200);
  assert.equal(r.json.open, false);
  assert.equal(r.json.seeded, false);
  assert.equal(r.json.password, undefined);
  assert.equal(r.json.accessCode, undefined);
  assert.equal(r.json.maxDays, 30);
  assert.equal(r.json.pageUrl, 'https://example.test/demo-welcome.html');
  assert.equal((await call('POST', '/regenerate-password', { body: { what: 'both' } })).status, 409);
  assert.equal((await call('POST', '/reset')).status, 409);
  assert.equal((await call('POST', '/on', { body: { days: 7 } })).status, 409, 'cannot turn on a demo that does not exist');
});

test('SETUP: creates the demo, generates a shared password and PIN once, never turns it on', async () => {
  const r = await call('POST', '/setup');
  assert.equal(r.status, 200);
  assert.equal(r.json.seeded, true);
  assert.equal(r.json.open, false);
  assert.match(r.json.password, /^demo(-[a-z]+){4}$/);
  assert.match(r.json.pin, /^\d{6}$/);
  assert.match(r.json.joinCode, /^[0-9A-F]{8}$/);
  assert.equal(r.json.logins.length, 5, 'four site logins and the student');
  assert.deepEqual(r.json.logins.map(l => l.signIn), ['district-admin-login.html', 'school-admin-login.html', 'teacher-classrooms.html', 'parent-portal.html', 'student-login.html']);
  assert.equal(r.json.logins[2].lockedSeconds, 540, 'a locked login is reported');
  assert.equal(r.json.lockedCount, 1);
  assert.equal(get('public_demo_enabled'), undefined, 'setup never touches the switch');
  const again = await call('POST', '/setup');
  assert.equal(again.json.password, r.json.password, 'a second setup keeps the same password');
  assert.equal(again.json.pin, r.json.pin);
  const hash = db.prepare('SELECT password_hash FROM site_users WHERE email = ?').get(F.ACCOUNTS.district.email).password_hash;
  assert.ok(await bcrypt.compare(r.json.password, hash));
});

test('ON: needs an end time, inside the window and in the future; refusals change nothing', async () => {
  const bad = async (body, re) => { const r = await call('POST', '/on', { body }); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, re); };
  await bad({}, /Choose how long/);
  await bad({ days: '7' }, /must be a number/);
  await bad({ days: 0 }, /above 0/);
  await bad({ days: 31 }, /longest demo window is 30 days/);
  await bad({ until: 12345 }, /must be text/);
  await bad({ until: '2030-01-01T10:00:00' }, /needs a time zone/);
  await bad({ until: '2020-01-01T10:00:00Z' }, /already in the past/);
  assert.equal(get('public_demo_enabled'), undefined);
  assert.equal((await call('GET', '')).json.open, false);
});

test('ON, then extend, then off: reset on a fresh start only, a code is made, every change is audited without secrets', async () => {
  const kid = Number(db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES ((SELECT id FROM classrooms LIMIT 1), 'Visitor', 'visitor-1', 'x')").run().lastInsertRowid);
  db.prepare("INSERT INTO student_reflections (student_id, body) VALUES (?, 'left by the last visitor')").run(kid);

  const on = await call('POST', '/on', { body: { days: 7 } });
  assert.equal(on.status, 200);
  assert.equal(on.json.open, true);
  assert.match(on.json.endsAtEastern, /E[SD]T$/);
  assert.match(on.json.accessCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_reflections').get().n, 0, 'turning it on from closed clears the last visitors\' work');
  const end7 = new Date(on.json.endsAt).getTime();
  assert.ok(Math.abs(end7 - (Date.now() + 7 * 86400000)) < 60000);

  const code = on.json.accessCode;
  const room = db.prepare('SELECT id FROM classrooms LIMIT 1').get().id;
  const kid2 = Number(db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Mid-visit', 'visitor-2', 'x')").run(room).lastInsertRowid);
  db.prepare("INSERT INTO student_reflections (student_id, body) VALUES (?, 'in progress')").run(kid2);
  const ext = await call('POST', '/on', { body: { days: 14 } });
  assert.equal(ext.status, 200);
  assert.ok(new Date(ext.json.endsAt).getTime() > end7 + 6 * 86400000, 'the end date moved');
  assert.equal(ext.json.accessCode, code, 'extending keeps the same code');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_reflections').get().n, 1, 'extending clears nothing: people inside keep their place');

  const off = await call('POST', '/off');
  assert.equal(off.json.open, false);
  assert.equal(get('public_demo_enabled'), 'false');
  assert.equal(get('public_demo_ends_at'), '');

  assert.deepEqual(audits().map(a => a.action), ['public_demo.setup', 'public_demo.setup', 'public_demo.on', 'public_demo.extended', 'public_demo.off']);
  assert.ok(audits().every(a => a.actor_type === 'admin' && a.actor_id === 7 && a.actor_email === 'admin'));
  const everything = JSON.stringify(audits());
  for (const secret of [get('public_demo_password'), get('public_demo_pin'), get('public_demo_access_code')]) assert.ok(secret && !everything.includes(secret), 'no secret reaches the audit log');
});

test('SWITCH LEFT ON PAST ITS DATE: reported as closed with the reason', async () => {
  db.prepare("UPDATE settings SET setting_value = 'true' WHERE setting_key = 'public_demo_enabled'").run();
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('public_demo_ends_at', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value").run(new Date(Date.now() - 3600000).toISOString());
  const r = await call('GET', '');
  assert.equal(r.json.open, false);
  assert.equal(r.json.reason, 'expired');
  assert.equal(r.json.switchOn, true);
  assert.ok(r.json.endsAtEastern);
});

test('NEW CODE: changes the code, raises the version, and is audited', async () => {
  const before = { code: get('public_demo_access_code'), version: Number(get('public_demo_code_version')) };
  const r = await call('POST', '/regenerate-code');
  assert.notEqual(get('public_demo_access_code'), before.code);
  assert.equal(Number(get('public_demo_code_version')), before.version + 1);
  assert.equal(r.json.accessCode, A.formatAccessCode(get('public_demo_access_code')));
  assert.equal(audits().at(-1).action, 'public_demo.code_regenerated');
});

test('NEW PASSWORD or PIN: re-hashes the logins, signs everyone out, and keeps the one not changed', async () => {
  const before = { password: get('public_demo_password'), pin: get('public_demo_pin') };
  assert.equal((await call('POST', '/regenerate-password', { body: { what: 'everything' } })).status, 400);
  const p = await call('POST', '/regenerate-password', { body: { what: 'password' } });
  assert.notEqual(p.json.password, before.password);
  assert.equal(p.json.pin, before.pin, 'only the password changed');
  for (const u of db.prepare('SELECT * FROM site_users WHERE is_shared_demo = 1').all()) {
    assert.ok(await bcrypt.compare(p.json.password, u.password_hash));
    assert.ok(u.session_invalidated_at, 'every demo browser is signed out');
  }
  const q = await call('POST', '/regenerate-password', { body: { what: 'pin' } });
  assert.equal(q.json.password, p.json.password, 'only the PIN changed');
  assert.notEqual(q.json.pin, before.pin);
  assert.ok(await bcrypt.compare(q.json.pin, db.prepare("SELECT password_hash FROM classroom_students WHERE username = 'demo-student'").get().password_hash));
  const both = await call('POST', '/regenerate-password', { body: { what: 'both' } });
  assert.notEqual(both.json.password, p.json.password);
  assert.notEqual(both.json.pin, q.json.pin);
});

test('RESET NOW: clears visitors\' work whether or not the demo is open', async () => {
  const room = db.prepare('SELECT id FROM classrooms WHERE teacher_site_user_id = ?').get(teacher()).id;
  const kid = Number(db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Late visitor', 'visitor-3', 'x')").run(room).lastInsertRowid);
  db.prepare("INSERT INTO student_reflections (student_id, body) VALUES (?, 'x')").run(kid);
  const r = await call('POST', '/reset');
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_reflections').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM classroom_students').get().n, 3);
  assert.equal(audits().at(-1).action, 'public_demo.reset');
});

test('UNLOCK: clears the lockout on all five logins', async () => {
  unlocked.length = 0;
  const r = await call('POST', '/unlock');
  assert.equal(r.status, 200);
  assert.deepEqual(unlocked.sort(), Object.values(F.ACCOUNTS).map(a => a.email).sort());
  assert.equal(lockStatus('demo-student').locked, false);
  assert.equal(audits().at(-1).action, 'public_demo.unlocked');
});

test('MESSAGE: the district note is held back until the demo page is published, then carries the link, code and end date', async () => {
  await call('POST', '/on', { body: { days: 3 } });
  assert.equal((await call('GET', '')).json.message, undefined, 'page not published yet');
  F.PUBLIC_DEMO_PAGE_READY = true;
  try {
    const r = await call('GET', '');
    assert.match(r.json.message, /https:\/\/example\.test\/demo-welcome\.html/);
    assert.ok(r.json.message.includes(r.json.accessCode));
    assert.ok(r.json.message.includes(r.json.endsAtEastern));
    assert.ok(!/[—–]/.test(r.json.message), 'no dashes');
    await call('POST', '/off');
    assert.equal((await call('GET', '')).json.message, undefined, 'no message while the demo is closed');
  } finally { F.PUBLIC_DEMO_PAGE_READY = false; }
});

test('ACCESS CODE: eight characters from an alphabet with no look-alikes; read back ignoring case and the hyphen', () => {
  for (let i = 0; i < 200; i++) assert.match(A.generateAccessCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(A.formatAccessCode('ABCD2345'), 'ABCD-2345');
  assert.equal(A.normalizeAccessCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(new Set(Array.from({ length: 50 }, () => A.generateAccessCode())).size, 50);
});
