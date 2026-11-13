// Prospect demo invitations, phase 4 (docs/reference/shared-demo-workspaces-requirements.md, R8): a ticket or quote request from a group's demo is tagged with that group
// by the server (from its own cookies), staff see "Demo: <group>" and can filter to one group, the staff email names the group, and each group has its own counts.
// The real public, sign-in, support, quote and admin routes run on a real SQL engine (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-group-tags';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
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
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, company TEXT, source TEXT, status TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, product_type TEXT, license_product_id INTEGER, seat_count INTEGER, source TEXT, payment_method TEXT, payment_status TEXT, school_domain TEXT, school_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, status TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY AUTOINCREMENT, published INTEGER, title TEXT, series TEXT);
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
CREATE TABLE affiliates (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, status TEXT, referral_code TEXT, commission_rate REAL);
CREATE TABLE public_demo_workspaces (id INTEGER PRIMARY KEY, district_id INTEGER, school_id INTEGER, purchase_id INTEGER, status TEXT DEFAULT 'free', last_reset_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public_demo_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, workspace_id INTEGER NOT NULL, access_code TEXT NOT NULL UNIQUE, code_version INTEGER NOT NULL DEFAULT 1,
  password TEXT NOT NULL DEFAULT '', pin TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT, invitation_id INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE support_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE, status TEXT DEFAULT 'new', category TEXT DEFAULT 'other', subject TEXT, requester_name TEXT, requester_email TEXT, site_user_id INTEGER, roles TEXT, school_domain TEXT, district_id INTEGER, page_url TEXT, user_agent TEXT, client_session_id TEXT, assigned_admin_id INTEGER, requester_seen_message_id INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, demo_window INTEGER NOT NULL DEFAULT 0, demo_invitation_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE support_request_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER, author_type TEXT, author_admin_id INTEGER, visibility TEXT DEFAULT 'public', body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
INSERT INTO admin_users (username) VALUES ('admin');
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_number TEXT UNIQUE, first_name TEXT, last_name TEXT, email TEXT, school TEXT, phone TEXT, message TEXT, content_profile_id INTEGER, origin TEXT, status TEXT DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP, demo_window INTEGER NOT NULL DEFAULT 0, demo_invitation_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE quote_content_profiles (id INTEGER PRIMARY KEY, is_default INTEGER);
INSERT INTO quote_content_profiles (id, is_default) VALUES (1, 1);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT,
  prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
for (let i = 0; i < 5; i++) db.prepare('INSERT INTO curricula (published) VALUES (1)').run();
const run = async (sql, rawParams = []) => {
  const params = [];
  let i = 0;
  let s = sql.trim().replace(/\bNOW\(\)/g, "datetime('now','localtime')").replace(/\bCURDATE\(\)/g, "date('now','localtime')");
  if (/ON DUPLICATE KEY UPDATE/i.test(s)) s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, '').replace(/^INSERT INTO/i, 'INSERT OR IGNORE INTO');
  s = s.replace(/\?/g, () => {
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
const mail = { staff: [], form: [], person: [] };
const locks = new Map();
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: poolStub,
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({
    sendSalesAlertEmail: async (m) => { mail.staff.push(m); },
    sendSupportEmail: async (m) => { mail.person.push(m); },
    sendContactFormEmail: async (m) => { mail.form.push(m); },
  }, { get: (t, name) => t[name] || (async () => {}) }),
  [path.join(SERVER, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (req.get('x-admin')) { req.user = { userId: 7, username: 'admin' }; return next(); } res.status(401).json({ error: 'Not logged in' }); },
    getAuthUser: () => null,
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const demo = require(path.join(SERVER, 'lib/public-demo.js'));
const inv = require(path.join(SERVER, 'lib/public-demo-invitations.js'));
const A = require(path.join(SERVER, 'lib/public-demo-admin.js'));
const { seedWorkspaces } = require(path.join(SERVER, 'scripts/seed-demo-workspaces.js'));
const cli = require(path.join(SERVER, 'scripts/demo-invitations.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', demo.sharedDemoGate);
app.use('/api/demo', require(path.join(SERVER, 'routes/public-demo.js')));
app.use('/api/site-auth', require(path.join(SERVER, 'routes/site-auth.js')).router);
app.use('/api/classroom-auth', require(path.join(SERVER, 'routes/classroom-auth.js')).router);
app.use('/api/support', require(path.join(SERVER, 'routes/support.js')));
app.use('/api/contact', require(path.join(SERVER, 'routes/contact.js')));
app.use('/api/admin/support', require(path.join(SERVER, 'routes/admin-support.js')));
app.use('/api/admin/public-demo', require(path.join(SERVER, 'routes/admin-public-demo.js')));
app.use((err, req, res, next) => { if (process.env.DEBUG_DEMO_TEST) console.error(err); res.status(500).json({ error: String(err.message) }); });
let server, port;

test.before(async () => {
  server = app.listen(0); port = server.address().port;
  inv.setCacheTtl(0);
  await seedWorkspaces(poolStub, 3, { rounds: 4 });
});
test.after(() => server.close());

let nextIp = 10;
const freshIp = () => `198.51.100.${nextIp++}`;
function call(method, p, { cookie = null, body = null, admin = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'X-Forwarded-For': freshIp() };
    if (cookie) headers.Cookie = cookie;
    if (admin) headers['x-admin'] = '1';
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = {}; try { json = b ? JSON.parse(b) : {}; } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, json, text: b }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const cookieOf = (res, name) => { const c = (res.headers['set-cookie'] || []).find(x => x.startsWith(name + '=')); return c ? c.split(';')[0] : null; };
const make = (label) => inv.createInvitation(poolStub, { label, days: 7, rounds: 4, createdBy: 'test' });
async function endAll() { for (const i of await inv.listInvitations(poolStub, { includeEnded: false })) await inv.endInvitation(poolStub, i.id, { rounds: 4 }); }
const enter = async (code) => cookieOf(await call('POST', '/api/demo/enter', { body: { code } }), 'fn_demo_gate');
const login = async (email, password) => cookieOf(await call('POST', '/api/site-auth/login', { body: { email, password } }), 'fn_user_session');
const ticket = (cookie, email) => call('POST', '/api/support', { cookie, body: { name: 'Pat Visitor', email, subject: 'A question', message: 'How does reporting work?', category: 'other' } });
const quote = (cookie, email) => call('POST', '/api/contact/quote', { cookie, body: { firstName: 'Pat', lastName: 'Visitor', email, school: 'Riverbend', phone: '(555) 867-5309', message: 'Please quote 40 seats.' } });
const lastTicket = () => db.prepare('SELECT * FROM support_requests ORDER BY id DESC LIMIT 1').get();
const lastQuote = () => db.prepare('SELECT * FROM quote_requests ORDER BY id DESC LIMIT 1').get();
const admin = (method, p, body) => call(method, p, { admin: true, body });

// ============================================================================================================================================

test('TICKETS: a ticket from a group\'s demo is tagged with that group, from the gate cookie and from a demo login alike, and the staff email names the group', async () => {
  await endAll();
  const a = await make('Springfield USD'), b = await make('Shelbyville Schools');
  mail.staff.length = 0;

  const gateA = await enter(a.accessCode);
  const r1 = await ticket(gateA, 'pat@example.org');
  assert.equal(r1.status, 200);
  assert.equal(lastTicket().demo_invitation_id, a.id); assert.equal(lastTicket().demo_window, 0, 'the original demo\'s window number is left alone');
  assert.equal(mail.staff.at(-1).fields.Source, 'Shared demo (Springfield USD)');

  const teacherB = await login('demo-teacher-02@public-demo.example.com', b.password);
  assert.ok(teacherB);
  const r2 = await ticket(teacherB, 'lee@example.org');
  assert.equal(r2.status, 200);
  assert.equal(lastTicket().demo_invitation_id, b.id, 'a demo login counts as signed out for the form, and its group is known from its workspace');
  assert.equal(mail.staff.at(-1).fields.Source, 'Shared demo (Shelbyville Schools)');

  // someone who is not in any demo is not tagged
  const plain = await ticket(null, 'someone@example.org');
  assert.equal(plain.status, 200);
  assert.equal(lastTicket().demo_invitation_id, 0); assert.equal(lastTicket().demo_window, 0);
  assert.equal(mail.staff.at(-1).fields.Source, undefined);

  // the tag cannot be set from the form
  const spoof = await call('POST', '/api/support', { body: { name: 'Sneaky', email: 'sneaky@example.org', message: 'Hi', demo_invitation_id: a.id, demoInvitationId: a.id, demo_window: 3, invitation: a.id } });
  assert.equal(spoof.status, 200);
  assert.equal(lastTicket().demo_invitation_id, 0); assert.equal(lastTicket().demo_window, 0);

  // the visitor never sees any group name
  for (const r of [r1, r2]) assert.ok(!r.text.includes('Springfield') && !r.text.includes('Shelbyville'), 'the group\'s name is for staff only');
  assert.ok(!JSON.stringify(mail.person).includes('Springfield') && !JSON.stringify(mail.person).includes('Shelbyville'), 'and not in the email to the person');
  await endAll();
});

test('QUOTES: a quote request from a group\'s demo is tagged the same way, and the staff email names the group', async () => {
  await endAll();
  const a = await make('Springfield USD'), b = await make('Shelbyville Schools');
  mail.form.length = 0;
  const qa = await quote(await enter(a.accessCode), 'pat@example.org');
  assert.equal(qa.status, 200);
  assert.equal(lastQuote().demo_invitation_id, a.id); assert.equal(lastQuote().demo_window, 0);
  assert.equal(mail.form.at(-1).fields.Source, 'Shared demo (Springfield USD)');
  const qb = await quote(await login('demo-parent-02@public-demo.example.com', b.password), 'lee@example.org');
  assert.equal(qb.status, 200);
  assert.equal(lastQuote().demo_invitation_id, b.id);
  assert.equal(mail.form.at(-1).fields.Source, 'Shared demo (Shelbyville Schools)');
  await quote(null, 'someone@example.org');
  assert.equal(lastQuote().demo_invitation_id, 0);
  assert.equal(mail.form.at(-1).fields.Source, undefined);
  await call('POST', '/api/contact/quote', { body: { firstName: 'S', lastName: 'S', email: 'sneaky@example.org', school: 'X', phone: '(555) 867-5309', message: 'Hi', demo_invitation_id: a.id, demoInvitationId: a.id } });
  assert.equal(lastQuote().demo_invitation_id, 0, 'the tag cannot be set from the form');
  assert.ok(!qa.text.includes('Springfield') && !qb.text.includes('Shelbyville'));
  await endAll();
});

test('INBOX AND QUOTES: staff see the group on each request, can show one group\'s requests only, and a rename shows on old requests too', async () => {
  await endAll();
  db.exec('DELETE FROM support_requests; DELETE FROM quote_requests;');
  const a = await make('Springfield USD'), b = await make('Shelbyville Schools');
  await ticket(await enter(a.accessCode), 'a1@example.org'); await ticket(await enter(a.accessCode), 'a2@example.org');
  await ticket(await enter(b.accessCode), 'b1@example.org'); await ticket(null, 'plain@example.org');
  await quote(await enter(a.accessCode), 'qa@example.org'); await quote(await enter(b.accessCode), 'qb@example.org'); await quote(null, 'qplain@example.org');

  const all = await admin('GET', '/api/admin/support?status=all');
  const byEmail = Object.fromEntries(all.json.requests.map(r => [r.requester_email, r]));
  assert.equal(byEmail['a1@example.org'].demo_label, 'Springfield USD');
  assert.equal(byEmail['b1@example.org'].demo_label, 'Shelbyville Schools');
  assert.equal(byEmail['plain@example.org'].demo_label, null);
  assert.equal(all.json.demoFilter, null);

  const onlyA = await admin('GET', `/api/admin/support?status=all&demo=${a.id}`);
  assert.deepEqual(onlyA.json.requests.map(r => r.requester_email).sort(), ['a1@example.org', 'a2@example.org']);
  assert.deepEqual(onlyA.json.demoFilter, { id: a.id, label: 'Springfield USD' });
  assert.equal(onlyA.json.counts.new, 2, 'the status counts follow the one-group view');
  assert.equal(all.json.counts.new, 4, 'and are everyone\'s without it');
  for (const bad of ['abc', '-1', '1; DROP TABLE support_requests', '', '99999999999']) assert.equal((await admin('GET', `/api/admin/support?status=all&demo=${encodeURIComponent(bad)}`)).json.requests.length, 4, `a bad filter (${bad}) is ignored, not trusted`);
  assert.equal((await admin('GET', '/api/admin/support?status=all&demo=999999')).json.requests.length, 0);

  const detail = await admin('GET', `/api/admin/support/${byEmail['a1@example.org'].id}`);
  assert.equal(detail.json.request.demo_label, 'Springfield USD');
  assert.equal((await admin('GET', `/api/admin/support/${byEmail['plain@example.org'].id}`)).json.request.demo_label, null);

  const quotes = await admin('GET', '/api/contact/quotes');
  assert.equal(quotes.status, 200);
  const qBy = Object.fromEntries(quotes.json.quotes.map(q => [q.email, q]));
  assert.equal(qBy['qa@example.org'].demo_label, 'Springfield USD'); assert.equal(qBy['qb@example.org'].demo_label, 'Shelbyville Schools'); assert.equal(qBy['qplain@example.org'].demo_label, null);
  const qOnlyB = await admin('GET', `/api/contact/quotes?demo=${b.id}`);
  assert.deepEqual(qOnlyB.json.quotes.map(q => q.email), ['qb@example.org']);
  assert.deepEqual(qOnlyB.json.demoFilter, { id: b.id, label: 'Shelbyville Schools' });
  assert.equal((await admin('GET', '/api/contact/quotes?demo=abc')).json.quotes.length, 3);

  // rename: old tickets show the new name; ending the invitation keeps the tag
  await inv.renameInvitation(poolStub, a.id, 'Springfield Unified');
  assert.equal((await admin('GET', `/api/admin/support?status=all&demo=${a.id}`)).json.requests[0].demo_label, 'Springfield Unified');
  await inv.endInvitation(poolStub, a.id, { rounds: 4 });
  assert.equal((await admin('GET', `/api/admin/support?status=all&demo=${a.id}`)).json.requests.length, 2, 'the requests stay after the group\'s demo has ended');
  // a request whose group row is gone still shows as a demo request, with no name
  db.prepare('DELETE FROM public_demo_invitations WHERE id = ?').run(b.id);
  assert.equal((await admin('GET', '/api/admin/support?status=all')).json.requests.find(r => r.requester_email === 'b1@example.org').demo_label, null);

  // both lists are the admin's only
  assert.equal((await call('GET', '/api/admin/support?demo=1')).status, 401);
  assert.equal((await call('GET', '/api/contact/quotes?demo=1')).status, 401);
  await endAll();
});

test('THE ORIGINAL DEMO: its tickets and quotes are tagged and worded exactly as before', async () => {
  await endAll();
  await A.putSettingRaw(poolStub, 'public_demo_enabled', 'true');
  await A.putSettingRaw(poolStub, 'public_demo_ends_at', new Date(Date.now() + 3600000).toISOString());
  await A.putSettingRaw(poolStub, 'public_demo_access_code', 'ORIGINAL');
  await A.putSettingRaw(poolStub, 'public_demo_code_version', '2');
  await A.putSettingRaw(poolStub, 'public_demo_window_id', '4');
  const gate = await enter('ORIGINAL');
  assert.ok(gate);
  mail.staff.length = 0; mail.form.length = 0;
  await ticket(gate, 'orig@example.org');
  assert.equal(lastTicket().demo_window, 4); assert.equal(lastTicket().demo_invitation_id, 0);
  assert.equal(mail.staff.at(-1).fields.Source, 'Shared demo');
  await quote(gate, 'origq@example.org');
  assert.equal(lastQuote().demo_window, 4); assert.equal(lastQuote().demo_invitation_id, 0);
  assert.equal(mail.form.at(-1).fields.Source, 'Shared demo');
  assert.equal((await admin('GET', '/api/admin/support?status=all')).json.requests.find(r => r.requester_email === 'orig@example.org').demo_label, null);
  await A.putSettingRaw(poolStub, 'public_demo_enabled', 'false');
});

test('COUNTS: each group has its own, never another group\'s and never the original demo\'s; wrong tries and failed sign-ins are not counted', async () => {
  await endAll();
  db.exec('DELETE FROM public_demo_events; DELETE FROM support_requests; DELETE FROM quote_requests;');
  const a = await make('Springfield USD'), b = await make('Shelbyville Schools');

  await call('POST', '/api/demo/enter', { body: { code: 'WRONG-CODE' } });
  await enter(a.accessCode); await enter(a.accessCode); await enter(b.accessCode);
  await login('demo-teacher-01@public-demo.example.com', a.password);
  await login('demo-parent-01@public-demo.example.com', a.password);
  await call('POST', '/api/site-auth/login', { body: { email: 'demo-district-01@public-demo.example.com', password: 'not-the-password-1' } });
  await call('POST', '/api/classroom-auth/login', { body: { username: 'demo-student-01', pin: a.pin } });
  await login('demo-school-02@public-demo.example.com', b.password);
  await ticket(await enter(a.accessCode), 'a@example.org');
  await quote(await enter(b.accessCode), 'b@example.org');

  const counts = await A.invitationCounts(poolStub);
  assert.deepEqual(counts[a.id].signIns, { district: 0, school: 0, teacher: 1, parent: 1, student: 1 });
  assert.equal(counts[a.id].signInTotal, 3);
  assert.equal(counts[a.id].gateEntries, 3, 'two visits, and the one that came with the ticket');
  assert.equal(counts[a.id].tickets, 1); assert.equal(counts[a.id].quotes, 0);
  assert.equal(counts[b.id].gateEntries, 2); assert.equal(counts[b.id].signInTotal, 1); assert.equal(counts[b.id].signIns.school, 1);
  assert.equal(counts[b.id].tickets, 0); assert.equal(counts[b.id].quotes, 1);
  // the original demo's own window is untouched: a group's events carry window 0
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_demo_events WHERE window_id > 0').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_demo_events WHERE invitation_id = 0').get().n, 0);
  assert.deepEqual((await A.demoCounts(poolStub)).signIns, { district: 0, school: 0, teacher: 0, parent: 0, student: 0 });
  // nothing identifying is kept
  const cols = db.prepare('PRAGMA table_info(public_demo_events)').all().map(c => c.name);
  assert.deepEqual(cols, ['id', 'window_id', 'kind', 'detail', 'invitation_id', 'created_at']);
  assert.deepEqual(db.prepare('SELECT DISTINCT detail FROM public_demo_events WHERE kind = ? ORDER BY detail').all('sign_in').map(r => r.detail), ['parent', 'school', 'student', 'teacher']);

  // the admin API
  const list = (await admin('GET', '/api/admin/public-demo/invitations')).json.invitations;
  const rowA = list.find(i => i.id === a.id), rowB = list.find(i => i.id === b.id);
  assert.deepEqual([rowA.counts.gateEntries, rowA.counts.signInTotal, rowA.counts.tickets, rowA.counts.quotes], [3, 3, 1, 0]);
  assert.deepEqual([rowB.counts.gateEntries, rowB.counts.signInTotal, rowB.counts.tickets, rowB.counts.quotes], [2, 1, 0, 1]);
  const details = (await admin('GET', `/api/admin/public-demo/invitations/${a.id}`)).json;
  assert.equal(details.counts.signIns.teacher, 1);
  // a brand-new invitation starts at zero, and a workspace's second group does not inherit the first group's counts
  await inv.endInvitation(poolStub, a.id, { rounds: 4 });
  const c = await make('Third group');
  assert.equal(c.workspaceId, a.workspaceId, 'the freed workspace comes round again');
  const fresh = (await admin('GET', '/api/admin/public-demo/invitations')).json.invitations.find(i => i.id === c.id);
  assert.deepEqual([fresh.counts.gateEntries, fresh.counts.signInTotal, fresh.counts.tickets, fresh.counts.quotes], [0, 0, 0, 0]);
  const old = (await admin('GET', '/api/admin/public-demo/invitations')).json.invitations.find(i => i.id === a.id);
  assert.equal(old.counts.signInTotal, 3, 'the ended group keeps its final counts');
  await endAll();
});

test('MESSAGE: a group\'s message says its copy is private; the original demo\'s does not', async () => {
  await endAll();
  const a = await make('Springfield USD');
  const d = (await admin('GET', `/api/admin/public-demo/invitations/${a.id}`)).json;
  assert.match(d.message, /none of it is real student information\. This copy of the demo is just for your group\. Nothing you do in it is visible to anyone else\./);
  assert.ok(d.message.includes(d.accessCode));
  assert.ok(!d.message.includes('Springfield'), 'the group\'s name is not in the message');
  const original = A.buildInviteMessage({ siteUrl: 'https://example.test', code: 'ABCD2345', endsAt: new Date('2026-12-01T17:00:00Z') });
  assert.ok(!/just for your group/.test(original), 'the original shared demo is shared, so it does not say this');
  const shown = await cli.run(poolStub, cli.parseArgs(['show', String(a.id)]), { siteUrl: 'https://example.test' });
  assert.match(shown, /This copy of the demo is just for your group/);
  await endAll();
});

test('BEFORE THE ALTER SCRIPT: a missing column or table never stops a visit, a ticket or a quote (it just goes untagged and uncounted)', async () => {
  await endAll();
  const a = await make('Springfield USD');
  const gate = await enter(a.accessCode);
  const real = poolStub.query;
  const broken = async (sql, params) => {
    if (/demo_invitation_id|invitation_id/.test(sql) && /^(UPDATE|INSERT)/i.test(sql.trim())) { const e = new Error('no such column: demo_invitation_id'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    return real(sql, params);
  };
  stubs[path.join(SERVER, 'db/pool.js')].query = broken;
  const log = console.error; console.error = () => {};
  try {
    assert.equal((await ticket(gate, 'x@example.org')).status, 200, 'the ticket is still saved');
    assert.equal((await quote(gate, 'y@example.org')).status, 200, 'the quote request is still saved');
    assert.equal((await enter(a.accessCode)) !== null, true, 'the visit still works');
    assert.equal(lastTicket().demo_invitation_id, 0);
  } finally { console.error = log; stubs[path.join(SERVER, 'db/pool.js')].query = real; }
  assert.deepEqual(await A.invitationLabels(poolStub, []), {});
  assert.deepEqual(await A.invitationLabels(poolStub, ['x', -1, 0]), {});
  await endAll();
});

// ---- the pages ------------------------------------------------------------------------------------------------------------------------------

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('PAGES: the inbox and quotes page show "Demo: <group>" escaped, read the one-group link safely, and say which group they are showing', () => {
  const support = read('admin-support.html'), quotes = read('admin-quotes.html'), demoPage = read('admin-demo.html');
  assert.match(support, /\(r\.demo_label \? 'Demo: ' \+ esc\(r\.demo_label\) : 'Demo'\)/);
  assert.match(quotes, /\(q\.demo_label \? 'Demo: ' \+ fnEscape\(q\.demo_label\) : 'Demo'\)/);
  for (const [name, src] of [['support', support], ['quotes', quotes]]) {
    assert.match(src, /\/\^\\d\{1,9\}\$\/\.test\(new URLSearchParams\(location\.search\)\.get\('demo'\) \|\| ''\)/, `${name}: only digits are taken from the link`);
    assert.match(src, /el\.textContent = 'Showing only (quote )?requests from ' \+ \(f\.label \|\| 'this group'\)/, `${name}: the banner is plain text, never HTML`);
    assert.match(src, /a\.textContent = 'Show all'/);
  }
  assert.match(support, /' · From the demo \(group: ' \+ r\.demo_label \+ '\)'/, 'the detail heading is set with textContent');
  assert.match(support, /document\.getElementById\('dSubject'\)\.textContent = /);
  // the Demo page: counts in the table and an Activity block with links to the filtered lists
  for (const col of ['Visits', 'Sign-ins', 'Tickets', 'Quotes']) assert.ok(demoPage.includes(`<th>${col}</th>`), col);
  for (const line of ['Activity', 'People who entered the access code', 'Sign-ins with a demo login', 'Questions and tickets', 'Quote requests', 'See them in the Support Inbox', 'See them in Quotes', 'No names or email addresses are kept.']) assert.ok(demoPage.includes(line), line);
  assert.match(demoPage, /admin-support\.html\?demo=' \+ encodeURIComponent\(d\.id\)/);
  assert.match(demoPage, /admin-quotes\.html\?demo=' \+ encodeURIComponent\(d\.id\)/);
  assert.ok(!/[—]/.test(demoPage + support + quotes.slice(0, 0)), 'no em dashes');
});

test('ROUTES: the one-group filter takes digits only and every tag and label goes through the admin\'s own routes', () => {
  const adminSupport = read('server/routes/admin-support.js'), contact = read('server/routes/contact.js');
  assert.match(adminSupport, /\/\^\\d\{1,9\}\$\/\.test\(String\(req\.query\.demo \|\| ''\)\)/);
  assert.match(contact, /\/\^\\d\{1,9\}\$\/\.test\(String\(req\.query\.demo \|\| ''\)\)/);
  assert.ok(!/demo_invitation_id = \$\{|demo_invitation_id = ' \+/.test(adminSupport + contact), 'the id is always a ? parameter');
  // nothing the visitor types can reach a tag: the tag functions read only the request's cookies
  const support = read('server/routes/support.js');
  assert.match(support, /const origin = await demoOrigin\(req\);/);
  assert.ok(!/body\.demo|req\.body\.invitation/.test(support + contact));
});
