// The admin API behind the Demo page: every route is the admin's, and the routes of the retired original single demo (on/off, one code, one password) are gone.
// The invitation routes themselves are tested in shared-demo-admin-invitations.test.js.
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
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return b ? JSON.parse(b) : {}; } catch { return { html: b }; } })() }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

test('AUTH: every route needs the admin, and the file gates itself once for all of them', async () => {
  for (const [m, p] of [['GET', '/invitations'], ['POST', '/invitations'], ['GET', '/invitations/1'], ['POST', '/invitations/1/end'], ['POST', '/pause'], ['POST', '/workspaces']]) {
    assert.equal((await call(m, p, { admin: false, body: { days: 1 } })).status, 401, `${m} ${p}`);
  }
  const src = fs.readFileSync(path.join(SERVER, 'routes/admin-public-demo.js'), 'utf8');
  assert.match(src, /router\.use\(requireAuth\)/);
  assert.ok(src.indexOf('router.use(requireAuth)') < src.indexOf("router.get('/invitations'"), 'the gate comes before the first route');
  assert.match(fs.readFileSync(path.join(SERVER, 'app.js'), 'utf8'), /app\.use\('\/api\/admin\/public-demo', adminPublicDemoRoutes\)/);
});

test('RETIRED: the original single demo\'s admin routes are gone (a signed-in admin gets "not found"), so nothing can switch it on again', async () => {
  for (const [m, p] of [['GET', ''], ['POST', '/setup'], ['POST', '/on'], ['POST', '/off'], ['POST', '/regenerate-code'], ['POST', '/regenerate-password'], ['POST', '/reset'], ['POST', '/unlock']]) {
    assert.equal((await call(m, p, { body: { days: 1 } })).status, 404, `${m} ${p}`);
  }
  const src = fs.readFileSync(path.join(SERVER, 'routes/admin-public-demo.js'), 'utf8');
  assert.ok(!/public_demo_(enabled|ends_at|access_code|password|pin|code_version|window_id)/.test(src), 'the file no longer touches the original demo\'s settings');
});

test('ACCESS CODE: eight characters from an alphabet with no look-alikes; read back ignoring case and the hyphen', () => {
  for (let i = 0; i < 200; i++) assert.match(A.generateAccessCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(A.formatAccessCode('ABCD2345'), 'ABCD-2345');
  assert.equal(A.normalizeAccessCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(new Set(Array.from({ length: 50 }, () => A.generateAccessCode())).size, 50);
});
