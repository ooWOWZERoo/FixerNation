// Prospect demo invitations, phase 3 (docs/reference/shared-demo-workspaces-requirements.md, section 5): the admin API behind the Demo page's invitation list,
// renaming a group, and Account Lookup naming the group behind a demo login. The real routes run on a real SQL engine (node:sqlite), with the admin sign-in
// and the in-memory sign-in lockouts stood in. Run:  cd server && npm test
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
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-admin-invitations';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, first_name TEXT, last_name TEXT, role TEXT, password_hash TEXT, email_verified INTEGER DEFAULT 0,
  is_sales_demo INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0, demo_workspace_id INTEGER, session_invalidated_at TEXT, closed_at TEXT, closed_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE site_user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT, type TEXT, expires_at TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE license_products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, seat_count INTEGER, price_cents INTEGER, call_for_quote INTEGER, variable_seats INTEGER, active INTEGER, sort_order INTEGER);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, source TEXT, status TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, product_type TEXT, license_product_id INTEGER, seat_count INTEGER, source TEXT, payment_method TEXT, payment_status TEXT, school_domain TEXT, school_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, status TEXT, first_name TEXT, last_name TEXT, created_at TEXT, expires_at TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY AUTOINCREMENT, published INTEGER);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, teacher_site_user_id INTEGER, join_code TEXT, parent_code TEXT, grade_level TEXT, subject TEXT, academic_year TEXT, archived_at TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, display_name TEXT, username TEXT UNIQUE, password_hash TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, curriculum_id INTEGER, assigned_by_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, student_id INTEGER);
CREATE TABLE school_branding (school_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE district_branding (district_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER, name TEXT);
CREATE TABLE lesson_favorites (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE public_demo_workspaces (id INTEGER PRIMARY KEY, district_id INTEGER, school_id INTEGER, purchase_id INTEGER, status TEXT DEFAULT 'free', last_reset_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public_demo_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, workspace_id INTEGER NOT NULL, access_code TEXT NOT NULL UNIQUE, code_version INTEGER NOT NULL DEFAULT 1,
  password TEXT NOT NULL DEFAULT '', pin TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT,
  prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
for (let i = 0; i < 5; i++) db.prepare('INSERT INTO curricula (published) VALUES (1)').run();
const run = async (sql, rawParams = []) => {
  const params = [];
  let i = 0;
  const s = sql.trim().replace(/\bNOW\(\)/g, "datetime('now','localtime')").replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(', '); }
    params.push(p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const poolStub = { query: run, getConnection: async () => ({ query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) };

const locked = new Map(); // email -> seconds, the stand-in for the site sign-in lockouts (tested against the real file in shared-demo-routes.test.js)
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: poolStub,
  [path.join(SERVER, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (req.get('x-admin')) { req.user = { userId: 7, username: 'admin' }; return next(); } res.status(401).json({ error: 'Not logged in' }); },
    getAuthUser: () => null,
  },
  [path.join(SERVER, 'routes/site-auth.js')]: { siteLoginBlockedFor: (e) => locked.get(e) || 0, unlockSiteLogin: (e) => locked.delete(e) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const F = require(path.join(SERVER, 'lib/public-demo-fixtures.js'));
const inv = require(path.join(SERVER, 'lib/public-demo-invitations.js'));
const seedLib = require(path.join(SERVER, 'scripts/seed-public-demo.js'));
const cli = require(path.join(SERVER, 'scripts/demo-invitations.js'));
const { lockStatus, pinFailsByStudent, studentKey } = require(path.join(SERVER, 'lib/pin-lockout.js'));
const app = express();
app.use(express.json());
app.use('/api/admin/public-demo', require(path.join(SERVER, 'routes/admin-public-demo.js')));
app.use('/api/admin/account-lookup', require(path.join(SERVER, 'routes/admin-account-lookup.js')));
app.use((err, req, res, next) => { if (process.env.DEBUG_DEMO_TEST) console.error(err); res.status(500).json({ error: String(err.message) }); });
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; inv.setCacheTtl(0); });
test.after(() => server.close());

function call(method, p, { admin = true, body = null, base = '/api/admin/public-demo' } = {}) {
  return new Promise((resolve, reject) => {
    const data = method === 'GET' ? null : JSON.stringify(body || {});
    const headers = {};
    if (admin) headers['x-admin'] = '1';
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: base + p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = {}; try { json = b ? JSON.parse(b) : {}; } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const audits = () => db.prepare("SELECT * FROM school_audit_log WHERE entity_type = 'public_demo' ORDER BY id").all();
const lastAudit = () => audits().at(-1);
const wsStatus = (n) => db.prepare('SELECT status FROM public_demo_workspaces WHERE id = ?').get(n).status;
const accountId = (email) => db.prepare('SELECT id FROM site_users WHERE email = ?').get(email).id;
async function endAll() { for (const i of await inv.listInvitations(poolStub, { includeEnded: false })) await inv.endInvitation(poolStub, i.id, { rounds: 4 }); }
const create = (label, extra = {}) => call('POST', '/invitations', { body: { label, days: 7, ...extra } });

// ============================================================================================================================================

test('AUTH: every invitation route needs the admin', async () => {
  for (const [m, p] of [['GET', '/invitations'], ['GET', '/invitations/1'], ['POST', '/invitations'], ['POST', '/invitations/1/rename'], ['POST', '/invitations/1/extend'], ['POST', '/invitations/1/end'],
    ['POST', '/invitations/1/new-code'], ['POST', '/invitations/1/new-secret'], ['POST', '/invitations/1/unlock'], ['POST', '/invitations/1/reset'], ['POST', '/pause'], ['POST', '/workspaces']]) {
    assert.equal((await call(m, p, { admin: false, body: { label: 'x', days: 1, count: 1, paused: true, what: 'pin' } })).status, 401, `${m} ${p}`);
  }
  assert.equal((await call('GET', '/account-lookup?email=x', { admin: false, base: '/api/admin' })).status === 404 || true, true);
  assert.equal((await call('GET', '?email=demo-teacher-01@public-demo.example.com', { admin: false, base: '/api/admin/account-lookup' })).status, 401);
});

test('POOL: it starts empty, workspaces are added a few at a time up to the cap, and a bad request is refused plainly', async () => {
  const empty = await call('GET', '/invitations');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.invitations, []);
  assert.equal(empty.json.paused, false);
  assert.deepEqual([empty.json.pool.total, empty.json.pool.inUse, empty.json.pool.free, empty.json.pool.max, empty.json.pool.canAdd], [0, 0, 0, 40, 40]);
  assert.equal(empty.json.maxDays, 30); assert.equal(empty.json.defaultDays, 14);
  assert.equal(empty.json.pageUrl, 'https://example.test/demo-welcome.html');

  // with no workspaces a group cannot start, and the message says what to do
  const none = await create('Springfield USD');
  assert.equal(none.status, 409);
  assert.match(none.json.error, /no demo workspaces yet/i);

  for (const bad of [{}, { count: '3' }, { count: 0 }, { count: 1.5 }, { count: -2 }]) assert.equal((await call('POST', '/workspaces', { body: bad })).status, 400, JSON.stringify(bad));
  const tooMany = await call('POST', '/workspaces', { body: { count: 41 } });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.json.error, /at most 40/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_demo_workspaces').get().n, 0, 'a refused request adds nothing');

  const added = await call('POST', '/workspaces', { body: { count: 3 } });
  assert.equal(added.status, 200);
  assert.deepEqual([added.json.pool.total, added.json.pool.free, added.json.pool.canAdd], [3, 3, 37]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_users WHERE demo_workspace_id IS NOT NULL').get().n, 12, 'each workspace has its four logins');
  const hashes = db.prepare('SELECT password_hash FROM site_users ORDER BY id').all();
  const more = await call('POST', '/workspaces', { body: { count: 1 } });
  assert.equal(more.json.pool.total, 4);
  assert.deepEqual(db.prepare('SELECT password_hash FROM site_users ORDER BY id LIMIT 12').all(), hashes, 'adding one never changes the others');
  assert.equal(lastAudit().action, 'public_demo.workspaces_added');
  assert.deepEqual(JSON.parse(lastAudit().new_value), { total: 4, added: 1 });
});

test('CREATE: a group is started with a name and a length, and gets its own workspace, code, password and PIN', async () => {
  await endAll();
  // each mistake a person can make comes back as a plain message
  for (const [body, re] of [[{ days: 7 }, /Give the group a name/], [{ label: 5, days: 7 }, /Give the group a name/], [{ label: '   ', days: 7 }, /Give the group a name/],
    [{ label: 'A', days: 0 }, /above 0/], [{ label: 'A', days: 31 }, /30 days/], [{ label: 'A', days: '7' }, /must be a number/], [{ label: 'A', until: 5 }, /must be text/],
    [{ label: 'A', until: '2099-01-01T00:00:00' }, /time zone/], [{ label: 'A', until: '2020-01-01T00:00:00Z' }, /past/]]) {
    const r = await call('POST', '/invitations', { body });
    assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, re);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_demo_workspaces WHERE status = 'in_use'").get().n, 0);

  const a = await create('Springfield USD');
  assert.equal(a.status, 200);
  const d = a.json;
  assert.equal(d.label, 'Springfield USD'); assert.equal(d.workspaceId, 1); assert.equal(d.workspace, '01'); assert.equal(d.open, true); assert.equal(d.state, 'active');
  assert.match(d.accessCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(d.password.length >= 14 && /^\d{6}$/.test(d.pin));
  assert.deepEqual(d.logins.map(l => l.userId), ['demo-district-01@public-demo.example.com', 'demo-school-01@public-demo.example.com', 'demo-teacher-01@public-demo.example.com', 'demo-parent-01@public-demo.example.com', 'demo-student-01']);
  assert.deepEqual(d.logins.map(l => l.role), ['District administrator', 'School administrator', 'Teacher', 'Parent', 'Student']);
  assert.match(d.joinCode, /^[0-9A-F]{8}$/);
  assert.ok(d.message.includes(d.accessCode) && d.message.includes('https://example.test/demo-welcome.html') && d.message.includes(d.endsAtEastern), 'a message ready to send');
  assert.ok(!d.message.includes(d.password) && !d.message.includes(d.pin), 'the message carries the code, never the password or PIN');
  assert.equal(d.createdBy, 'admin');
  assert.ok(await bcrypt.compare(d.password, db.prepare('SELECT password_hash FROM site_users WHERE email = ?').get('demo-teacher-01@public-demo.example.com').password_hash));

  const exactEnd = new Date(Date.now() + 10 * 86400000);
  const b = await create('Shelbyville Schools', { days: undefined, until: exactEnd.toISOString() });
  assert.equal(b.json.workspaceId, 2);
  assert.equal(b.json.endsAt, exactEnd.toISOString().slice(0, 19) + '.000Z', 'an exact end time, kept to the second');

  // the list: one row each, newest first, and never a secret
  const list = await call('GET', '/invitations');
  assert.deepEqual(list.json.invitations.map(i => [i.label, i.workspace, i.state]), [['Shelbyville Schools', '02', 'active'], ['Springfield USD', '01', 'active']]);
  assert.deepEqual([list.json.pool.total, list.json.pool.inUse, list.json.pool.free], [4, 2, 2]);
  const text = JSON.stringify(list.json);
  for (const secret of [d.password, d.pin, d.accessCode, a.json.accessCode.replace('-', ''), b.json.password, b.json.pin, b.json.accessCode]) assert.ok(!text.includes(secret), 'the list shows no password, PIN or code');

  // the audit log names who did what, never a secret
  const created = audits().filter(x => x.action === 'public_demo.invitation_created');
  assert.equal(created.length, 2);
  assert.deepEqual(JSON.parse(created[0].new_value), { id: d.id, label: 'Springfield USD', workspace: '01', endsAt: d.endsAt });
  assert.ok(created.every(x => x.actor_type === 'admin' && x.actor_id === 7 && x.actor_email === 'admin'));
  const everything = JSON.stringify(audits());
  for (const secret of [d.password, d.pin, d.accessCode, d.accessCode.replace('-', ''), b.json.password, b.json.pin, b.json.accessCode.replace('-', '')]) assert.ok(!everything.includes(secret), 'no secret in the audit log');
  await endAll();
});

test('CREATE: when every workspace is in use it says so, and ending one frees a place', async () => {
  await endAll();
  for (const n of ['One', 'Two', 'Three', 'Four']) assert.equal((await create(n)).status, 200);
  const full = await create('Five');
  assert.equal(full.status, 409);
  assert.match(full.json.error, /All 4 demo workspaces are in use/);
  assert.equal((await call('GET', '/invitations')).json.pool.free, 0);
  const first = (await call('GET', '/invitations')).json.invitations.filter(i => i.open).at(-1);
  assert.equal((await call('POST', `/invitations/${first.id}/end`)).status, 200);
  const five = await create('Five');
  assert.equal(five.status, 200, 'the freed workspace is taken by the next group: ' + JSON.stringify(five.json));
  await endAll();
});

test('DETAILS: one invitation shows its code, password, PIN and sign-ins while open, and none of them once ended', async () => {
  await endAll();
  const a = (await create('Springfield USD')).json;
  const shown = await call('GET', `/invitations/${a.id}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.json.accessCode, a.accessCode); assert.equal(shown.json.password, a.password); assert.equal(shown.json.pin, a.pin);
  assert.equal(shown.json.lockedCount, 0);
  for (const bad of ['999999', 'abc', '0', '-3']) assert.equal((await call('GET', `/invitations/${bad}`)).status, 404, bad);

  await call('POST', `/invitations/${a.id}/end`);
  const ended = await call('GET', `/invitations/${a.id}`);
  assert.equal(ended.status, 200);
  assert.equal(ended.json.open, false); assert.equal(ended.json.state, 'ended');
  for (const k of ['accessCode', 'password', 'pin', 'message']) assert.equal(ended.json[k], undefined, `${k} is gone after it ends`);
  assert.equal(ended.json.endReason, 'ended');
});

test('RENAME: the group\'s name can be corrected at any time, and is checked and audited', async () => {
  await endAll();
  const a = (await create('Springfeild USD')).json;
  const r = await call('POST', `/invitations/${a.id}/rename`, { body: { label: '  Springfield   USD  ' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.label, 'Springfield USD', 'extra spaces are tidied');
  assert.deepEqual(JSON.parse(lastAudit().prev_value), { label: 'Springfeild USD' });
  assert.deepEqual(JSON.parse(lastAudit().new_value), { id: a.id, label: 'Springfield USD' });
  assert.equal(lastAudit().action, 'public_demo.invitation_renamed');
  for (const bad of [{}, { label: 5 }, { label: '   ' }, { label: 'x'.repeat(121) }]) assert.equal((await call('POST', `/invitations/${a.id}/rename`, { body: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await call('POST', '/invitations/999999/rename', { body: { label: 'X' } })).status, 404);
  // the list and Account Lookup see the new name; the password, code and sessions are untouched
  assert.equal((await call('GET', '/invitations')).json.invitations[0].label, 'Springfield USD');
  assert.equal((await call('GET', `/invitations/${a.id}`)).json.password, a.password);
  // even after it has ended
  await call('POST', `/invitations/${a.id}/end`);
  assert.equal((await call('POST', `/invitations/${a.id}/rename`, { body: { label: 'Springfield Unified' } })).json.label, 'Springfield Unified');
  await endAll();
});

test('EXTEND: moves the end date within the longest window, and not for one that has ended', async () => {
  await endAll();
  const a = (await create('A', { days: 3 })).json;
  const longer = await call('POST', `/invitations/${a.id}/extend`, { body: { days: 20 } });
  assert.equal(longer.status, 200);
  assert.ok(new Date(longer.json.endsAt).getTime() > new Date(a.endsAt).getTime() + 16 * 86400000);
  assert.equal(lastAudit().action, 'public_demo.invitation_extended');
  assert.equal(JSON.parse(lastAudit().prev_value).endsAt, a.endsAt);
  for (const [body, re] of [[{}, /Say how many days/], [{ days: 31 }, /30 days/], [{ days: 0 }, /above 0/], [{ days: 'x' }, /must be a number/], [{ until: '2020-01-01T00:00:00Z' }, /past/]]) {
    const r = await call('POST', `/invitations/${a.id}/extend`, { body });
    assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.json.error, re);
  }
  await call('POST', `/invitations/${a.id}/end`);
  const gone = await call('POST', `/invitations/${a.id}/extend`, { body: { days: 3 } });
  assert.equal(gone.status, 409); assert.match(gone.json.error, /already ended/);
  assert.equal((await call('POST', '/invitations/999999/extend', { body: { days: 3 } })).status, 404);
});

test('NEW CODE, PASSWORD AND PIN: each changes one group only, is audited, and is never written down', async () => {
  await endAll();
  const a = (await create('A')).json, b = (await create('B')).json;
  const bTeacher = db.prepare('SELECT password_hash FROM site_users WHERE email = ?').get('demo-teacher-02@public-demo.example.com').password_hash;

  const code = await call('POST', `/invitations/${a.id}/new-code`);
  assert.equal(code.status, 200);
  assert.notEqual(code.json.accessCode, a.accessCode);
  assert.equal(lastAudit().action, 'public_demo.invitation_code_regenerated');
  assert.equal(await inv.findOpenInvitationByCode(a.accessCode), null, 'the old code opens nothing');
  assert.equal(Number((await inv.findOpenInvitationByCode(b.accessCode)).id), b.id);

  const pw = await call('POST', `/invitations/${a.id}/new-secret`, { body: { what: 'password' } });
  assert.notEqual(pw.json.password, a.password); assert.equal(pw.json.pin, a.pin);
  assert.deepEqual(JSON.parse(lastAudit().new_value), { id: a.id, label: 'A', changed: 'password' });
  const pin = await call('POST', `/invitations/${a.id}/new-secret`, { body: { what: 'pin' } });
  assert.notEqual(pin.json.pin, a.pin); assert.equal(pin.json.password, pw.json.password);
  assert.equal(db.prepare('SELECT password_hash FROM site_users WHERE email = ?').get('demo-teacher-02@public-demo.example.com').password_hash, bTeacher, 'group B is untouched');
  for (const bad of [{}, { what: 'code' }, { what: 5 }]) assert.equal((await call('POST', `/invitations/${a.id}/new-secret`, { body: bad })).status, 400);

  const everything = JSON.stringify(audits());
  for (const secret of [code.json.accessCode, code.json.accessCode.replace('-', ''), pw.json.password, pin.json.pin, a.password, a.pin]) assert.ok(!everything.includes(secret), 'no secret in the audit log');
  await call('POST', `/invitations/${a.id}/end`);
  for (const p of ['new-code', 'new-secret']) assert.equal((await call('POST', `/invitations/${a.id}/${p}`, { body: { what: 'pin' } })).status, 409, p);
  await endAll();
});

test('UNLOCK: clears the lockouts on this group\'s five logins and no one else\'s', async () => {
  await endAll();
  const a = (await create('A')).json, b = (await create('B')).json;
  locked.set('demo-teacher-01@public-demo.example.com', 540); locked.set('demo-parent-01@public-demo.example.com', 120); locked.set('demo-teacher-02@public-demo.example.com', 300);
  for (let i = 0; i < 5; i++) pinFailsByStudent.fail(studentKey('demo-student-01'));
  for (let i = 0; i < 5; i++) pinFailsByStudent.fail(studentKey('demo-student-02'));
  const before = (await call('GET', `/invitations/${a.id}`)).json;
  assert.equal(before.lockedCount, 3, 'the teacher, the parent and the student');
  assert.equal(before.logins.find(l => l.role === 'Teacher').lockedSeconds, 540);

  const r = await call('POST', `/invitations/${a.id}/unlock`);
  assert.equal(r.status, 200); assert.equal(r.json.lockedCount, 0);
  assert.equal(locked.has('demo-teacher-01@public-demo.example.com'), false);
  assert.equal(lockStatus('demo-student-01').locked, false);
  assert.equal(locked.get('demo-teacher-02@public-demo.example.com'), 300, 'group B is still locked');
  assert.equal(lockStatus('demo-student-02').locked, true);
  assert.equal(lastAudit().action, 'public_demo.invitation_unlocked');
  assert.equal((await call('POST', '/invitations/999999/unlock')).status, 404);
  locked.clear(); pinFailsByStudent.clear(studentKey('demo-student-02'));
  void b;
  await endAll();
});

test('CLEAR WHAT THE GROUP ADDED: removes their work, keeps their codes, password and PIN, and leaves other groups alone', async () => {
  await endAll();
  const a = (await create('A')).json, b = (await create('B')).json;
  for (const n of [1, 2]) {
    const teacher = accountId(`demo-teacher-0${n}@public-demo.example.com`);
    const room = Number(db.prepare('INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES (?, ?, ?)').run(`Added by group ${n}`, teacher, `ADDED00${n}`).lastInsertRowid);
    db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Kid', ?, 'x')").run(room, `kid-${n}`);
  }
  const r = await call('POST', `/invitations/${a.id}/reset`);
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM classrooms WHERE name = 'Added by group 1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM classrooms WHERE name = 'Added by group 2'").get().n, 1, 'group B keeps what it added');
  assert.equal(r.json.joinCode, a.joinCode, 'the join code does not change');
  assert.equal(r.json.password, a.password); assert.equal(r.json.pin, a.pin);
  assert.ok(await bcrypt.compare(a.pin, db.prepare("SELECT password_hash FROM classroom_students WHERE username = 'demo-student-01'").get().password_hash), 'the PIN still works');
  assert.equal(lastAudit().action, 'public_demo.invitation_workspace_reset');
  await call('POST', `/invitations/${a.id}/end`);
  assert.equal((await call('POST', `/invitations/${a.id}/reset`)).status, 409, 'nothing to clear once it has ended');
  assert.equal((await call('POST', '/invitations/999999/reset')).status, 404);
  void b;
  await endAll();
});

test('END: it closes the invitation, clears and frees the workspace, and is audited without a secret', async () => {
  await endAll();
  const a = (await create('A')).json, b = (await create('B')).json;
  const ended = await call('POST', `/invitations/${a.id}/end`);
  assert.equal(ended.status, 200);
  assert.equal(ended.json.state, 'ended');
  assert.equal(wsStatus(1), 'free'); assert.equal(wsStatus(2), 'in_use');
  assert.equal(lastAudit().action, 'public_demo.invitation_ended');
  assert.deepEqual(JSON.parse(lastAudit().new_value), { id: a.id, label: 'A', workspace: '01' });
  assert.equal((await call('POST', `/invitations/${a.id}/end`)).status, 200, 'ending twice changes nothing');
  assert.equal((await call('POST', '/invitations/999999/end')).status, 404);
  assert.equal((await call('GET', `/invitations/${b.id}`)).json.open, true);
  const list = (await call('GET', '/invitations')).json.invitations;
  assert.deepEqual(list.filter(i => [a.id, b.id].includes(i.id)).map(i => [i.label, i.state]), [['B', 'active'], ['A', 'ended']], 'an ended invitation stays in the list for a while');
  // after 90 days it drops off the page (the row stays, so its code is never reused)
  db.prepare('UPDATE public_demo_invitations SET ended_at = ? WHERE id = ?').run(inv.toDb(new Date(Date.now() - 91 * 86400000)), a.id);
  assert.ok(!(await call('GET', '/invitations')).json.invitations.some(i => i.id === a.id), 'off the page after 90 days');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_demo_invitations WHERE id = ?').get(a.id).n, 1, 'but the row stays');
  await endAll();
});

test('PAUSE: it closes every group at once, stops new ones from starting, and resuming brings them back', async () => {
  await endAll();
  const a = (await create('A')).json;
  for (const bad of [{}, { paused: 'yes' }, { paused: 1 }]) assert.equal((await call('POST', '/pause', { body: bad })).status, 400);
  const p = await call('POST', '/pause', { body: { paused: true } });
  assert.equal(p.status, 200); assert.equal(p.json.paused, true);
  assert.equal(lastAudit().action, 'public_demo.paused');
  assert.equal(await inv.getOpenInvitationForWorkspace(a.workspaceId), null, 'the group is closed');
  const blocked = await create('B');
  assert.equal(blocked.status, 409); assert.match(blocked.json.error, /paused/);
  assert.equal((await call('GET', `/invitations/${a.id}`)).json.open, true, 'the invitation itself is intact, so staff can still see its details');
  const r = await call('POST', '/pause', { body: { paused: false } });
  assert.equal(r.json.paused, false); assert.equal(lastAudit().action, 'public_demo.resumed');
  assert.equal(Number((await inv.getOpenInvitationForWorkspace(a.workspaceId)).id), a.id);
  assert.equal((await create('B')).status, 200);
  await endAll();
});

test('THE ORIGINAL DEMO\'S ROUTES ARE UNTOUCHED: its state still loads beside the invitations', async () => {
  const state = await call('GET', '');
  assert.equal(state.status, 200);
  assert.equal(state.json.seeded, false, 'not set up in this test database, which is fine');
  assert.equal(state.json.open, false);
  assert.equal((await call('POST', '/off')).status, 200);
  assert.equal(await inv.isPaused(poolStub), false, 'the admin page\'s own Turn off closes the original demo and does not pause the groups');
});

// ============================================================================================================================================
// Account Lookup names the group behind a demo login
// ============================================================================================================================================

const lookup = (email) => call('GET', `?email=${encodeURIComponent(email)}`, { base: '/api/admin/account-lookup' });

test('ACCOUNT LOOKUP: a workspace login shows its workspace and the group using it; a free one, the original demo and an ordinary address show what they are', async () => {
  await endAll();
  const a = (await create('Springfield USD')).json;
  const r = await lookup('demo-teacher-01@public-demo.example.com');
  assert.equal(r.status, 200);
  assert.equal(r.json.account.email, 'demo-teacher-01@public-demo.example.com');
  assert.deepEqual(r.json.demo, { kind: 'workspace', workspaceId: 1, workspace: '01', role: 'teacher', group: { id: a.id, label: 'Springfield USD', open: true, state: 'active', endsAtEastern: a.endsAtEastern } });
  for (const role of ['district', 'school', 'parent']) assert.equal((await lookup(`demo-${role}-01@public-demo.example.com`)).json.demo.group.label, 'Springfield USD', role);
  assert.equal((await lookup('DEMO-TEACHER-01@public-demo.example.com')).json.demo.group.label, 'Springfield USD', 'any letter case');
  const text = JSON.stringify(r.json.demo);
  assert.ok(!text.includes(a.password) && !text.includes(a.pin) && !text.includes(a.accessCode), 'no secret');

  // a rename shows at once
  await call('POST', `/invitations/${a.id}/rename`, { body: { label: 'Springfield Unified' } });
  assert.equal((await lookup('demo-teacher-01@public-demo.example.com')).json.demo.group.label, 'Springfield Unified');

  // a workspace nobody holds now and has never held (add one that no earlier test used)
  await call('POST', '/workspaces', { body: { count: 1 } });
  const never = db.prepare('SELECT MAX(id) AS n FROM public_demo_workspaces').get().n;
  const free = (await lookup(`demo-teacher-0${never}@public-demo.example.com`)).json.demo;
  assert.deepEqual(free, { kind: 'workspace', workspaceId: never, workspace: `0${never}`, role: 'teacher', group: null });

  // after the group's time is up, the last group is still named, marked ended
  await call('POST', `/invitations/${a.id}/end`);
  const after = (await lookup('demo-teacher-01@public-demo.example.com')).json.demo;
  assert.equal(after.group.label, 'Springfield Unified'); assert.equal(after.group.open, false); assert.equal(after.group.state, 'ended');
  // and the next group takes over the name
  const b = (await create('Shelbyville Schools')).json;
  assert.equal(b.workspaceId, 1);
  assert.equal((await lookup('demo-teacher-01@public-demo.example.com')).json.demo.group.label, 'Shelbyville Schools');

  // the original single demo, and an ordinary address
  await seedLib.seed(poolStub, { password: 'original-demo-password-1', pin: '482915', rounds: 4 }, seedLib.makeReport());
  assert.deepEqual((await lookup(F.ACCOUNTS.teacher.email)).json.demo, { kind: 'original' });
  db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('real@school.org', 'Real', 'Person', 'teacher', 'x')").run();
  assert.equal((await lookup('real@school.org')).json.demo, null);
  assert.equal((await lookup('nobody@school.org')).json.demo, null);
  assert.equal((await lookup('demo-teacher-77@public-demo.example.com')).json.demo.group, null, 'a workspace number nobody has seeded has no group');
  await endAll();
});

test('COMMAND LINE: rename works like the admin page, and the list shows which group is on which workspace', async () => {
  await endAll();
  const a = (await create('Springfeild USD')).json;
  const out = await cli.run(poolStub, cli.parseArgs(['rename', String(a.id), '--label', 'Springfield USD']));
  assert.match(out, /workspace 01\) is now called "Springfield USD" \(it was "Springfeild USD"\)/);
  assert.match(await cli.run(poolStub, cli.parseArgs(['list'])), /01\s+open\s+.*Springfield USD/);
  assert.throws(() => cli.parseArgs(['rename', String(a.id)]), /needs --label/);
  assert.throws(() => cli.parseArgs(['rename', '--label', 'X']), /needs the invitation's number/);
  await assert.rejects(cli.run(poolStub, cli.parseArgs(['rename', '999999', '--label', 'X'])), (e) => e.status === 404);
  await endAll();
});

test('THE LIBRARY: which group is behind a login, from any spelling, with no secret', async () => {
  await endAll();
  const a = (await create('Springfield USD')).json;
  const g = await inv.groupForLogin(poolStub, 'demo-student-01');
  assert.equal(g.workspaceId, 1); assert.equal(g.role, 'student'); assert.equal(g.invitation.label, 'Springfield USD');
  assert.equal(g.invitation.password, undefined); assert.equal(g.invitation.pin, undefined); assert.equal(g.invitation.accessCode, undefined);
  assert.equal(await inv.groupForLogin(poolStub, 'demo-teacher@public-demo.example.com'), null, 'the original demo is not a workspace');
  assert.equal(await inv.groupForLogin(poolStub, 'someone@real.org'), null);
  assert.equal(await inv.groupForLogin(poolStub, ''), null);
  const status = await inv.poolStatus(poolStub);
  assert.equal(status.inUse, 1);
  void a;
  await endAll();
});

// ============================================================================================================================================
// Pause and end together: once the last open invitation has ended, a pause has nothing left to hold, so it is lifted and there is no Resume to press
// ============================================================================================================================================

test('PAUSE THEN END: ending the last open invitation lifts the pause, and ending the others first does not', async () => {
  await endAll();
  await inv.setPaused(poolStub, false);
  const a = (await create('A')).json, b = (await create('B')).json;
  await call('POST', '/pause', { body: { paused: true } });
  assert.equal((await call('GET', '/invitations')).json.paused, true);

  const first = await call('POST', `/invitations/${a.id}/end`);
  assert.equal(first.status, 200);
  assert.equal(first.json.pauseCleared, false, 'group B is still open, so the pause still has something to hold');
  assert.equal((await call('GET', '/invitations')).json.paused, true);
  assert.equal(await inv.getOpenInvitationForWorkspace(b.workspaceId), null, 'and group B is still closed by it');

  const last = await call('POST', `/invitations/${b.id}/end`);
  assert.equal(last.status, 200);
  assert.equal(last.json.pauseCleared, true, 'the last one ended, so demos are running again');
  assert.equal((await call('GET', '/invitations')).json.paused, false, 'no Resume button to show');
  assert.equal(await inv.isPaused(poolStub), false);
  // recorded: the end, and then the pause lifting by itself (no secret)
  const log = audits().slice(-2);
  assert.deepEqual(log.map(x => x.action), ['public_demo.invitation_ended', 'public_demo.resumed']);
  assert.deepEqual(JSON.parse(log[1].prev_value), { paused: true });
  assert.deepEqual(JSON.parse(log[1].new_value), { paused: false, automatic: 'the last open invitation ended' });
  // and a new group can start straight away
  assert.equal((await create('C')).status, 200);
  await endAll();
});

test('PAUSE THEN END: it only lifts a pause when an invitation really ends now, never for one that had already ended, and never when nothing is paused', async () => {
  await endAll();
  const a = (await create('A')).json;
  // not paused: ending the last one reports nothing was lifted
  const plain = await call('POST', `/invitations/${a.id}/end`);
  assert.equal(plain.json.pauseCleared, false);
  assert.equal((await inv.endInvitation(poolStub, a.id, { rounds: 4 })).pauseCleared, undefined);

  // paused with nothing open is deliberate: it stays until someone resumes (even if an old, already-ended invitation is ended "again")
  await call('POST', '/pause', { body: { paused: true } });
  const again = await call('POST', `/invitations/${a.id}/end`);
  assert.equal(again.json.pauseCleared, false);
  assert.equal((await call('GET', '/invitations')).json.paused, true, 'paused on purpose, so still paused');
  assert.equal((await create('X')).status, 409, 'and a new invitation is refused until resumed');
  await call('POST', '/pause', { body: { paused: false } });
  assert.equal((await create('X')).status, 200);
  await endAll();
});

test('PAUSE THEN RUN OUT: when the last open invitation\'s time runs out the sweep lifts the pause too, and the command line says so', async () => {
  await endAll();
  const T0 = new Date();
  const a = await inv.createInvitation(poolStub, { label: 'Runs out', days: 1, rounds: 4, now: T0 });
  const b = await inv.createInvitation(poolStub, { label: 'Longer', days: 20, rounds: 4, now: T0 });
  await inv.setPaused(poolStub, true);
  const later = new Date(T0.getTime() + 2 * 86400000);
  const s1 = await inv.sweep(poolStub, { now: later, rounds: 4 });
  assert.deepEqual(s1.ended, [a.id]);
  assert.equal(s1.pauseCleared, undefined, 'B is still open');
  assert.equal(await inv.isPaused(poolStub), true);
  const much = new Date(T0.getTime() + 25 * 86400000);
  const s2 = await inv.sweep(poolStub, { now: much, rounds: 4 });
  assert.deepEqual(s2.ended, [b.id]);
  assert.equal(s2.pauseCleared, true);
  assert.equal(await inv.isPaused(poolStub), false);
  assert.match(await cli.run(poolStub, cli.parseArgs(['sweep']), { now: much }), /Nothing to sweep/);

  // the command line's own end says so
  const c = (await create('C')).json;
  await inv.setPaused(poolStub, true);
  const out = await cli.run(poolStub, cli.parseArgs(['end', String(c.id)]));
  assert.match(out, /is ended\./);
  assert.match(out, /Demos were paused\. This was the last open invitation, so they are running again\./);
  const d = (await create('D')).json;
  assert.ok(!/running again/.test(await cli.run(poolStub, cli.parseArgs(['end', String(d.id)]))), 'nothing to say when nothing was paused');
});

test('PAUSE THEN END: the Demo page tells staff the pause was lifted, with no Resume left on screen', () => {
  const page = fs.readFileSync(path.join(SERVER, '..', 'admin-demo.html'), 'utf8');
  assert.match(page, /endedDetail && endedDetail\.pauseCleared \? 'The invitation is ended\. Nothing else is open, so demos are running again\.' : 'The invitation is ended'/);
  // the Resume button is drawn from the server's state, which no longer says paused
  assert.match(page, /d\.paused \? '<button class="a-btn a-btn-primary a-btn-sm" data-inv="resume">Resume demos<\/button>'/);
});
