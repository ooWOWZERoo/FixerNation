// Release 115: support requests (docs/reference/support-requests-requirements.md). Anyone can open one; the person sees only their own;
// staff answer from the inbox; internal notes never reach the person; role and school come from the account, never the form.
// Run:  cd server && npm test
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

const SERVER = path.join(__dirname, '..');
const realRateLimit = require(path.join(SERVER, 'lib/rate-limit.js')); // loaded before the stubs go in: the lookup throttle should be the real one
const ROOT = path.join(SERVER, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, role TEXT DEFAULT 'teacher', is_sales_demo INTEGER DEFAULT 0, session_invalidated_at TEXT, closed_at TEXT);
CREATE TABLE admin_users (id INTEGER PRIMARY KEY, username TEXT, email TEXT);
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, license_status TEXT, expiration_date TEXT, school_domain TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER, student_id INTEGER);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE support_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE, status TEXT DEFAULT 'new', category TEXT DEFAULT 'other', subject TEXT, requester_name TEXT, requester_email TEXT, site_user_id INTEGER, roles TEXT, school_domain TEXT, district_id INTEGER, page_url TEXT, user_agent TEXT, client_session_id TEXT, assigned_admin_id INTEGER, requester_seen_message_id INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT);
CREATE TABLE support_request_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER, author_type TEXT, author_admin_id INTEGER, visibility TEXT DEFAULT 'public', body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO admin_users (id, username, email) VALUES (7, 'staffer', 'staff@fne.test'), (8, 'second', 'second@fne.test');
INSERT INTO districts (id, name) VALUES (5, 'Riverbend');
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p); // node:sqlite cannot bind a Date
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};

const sent = { staff: [], person: [] };
let failPersonMail = false;
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { req.user = { userId: 7 }; next(); }, getAuthUser: () => null },
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: (kind, token) => ({ userId: Number(token), iat: Math.floor(Date.now() / 1000) }) },
  [path.join(SERVER, 'lib/mailer.js')]: {
    sendSalesAlertEmail: async (m) => { sent.staff.push(m); },
    sendSupportEmail: async (m) => { if (failPersonMail) throw new Error('smtp down'); sent.person.push(m); },
  },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1', FailureTracker: realRateLimit.FailureTracker, rejectIfBlocked: realRateLimit.rejectIfBlocked },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/support', require(path.join(SERVER, 'routes/support.js')));
app.use('/api/admin/support', require(path.join(SERVER, 'routes/admin-support.js')));
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

const reset = () => {
  for (const t of ['site_users', 'purchases', 'license_seats', 'school_license_admins', 'district_license_admins', 'parent_classroom_links', 'school_audit_log', 'support_requests', 'support_request_messages', 'settings']) db.exec(`DELETE FROM ${t}`);
  sent.staff.length = 0; sent.person.length = 0; failPersonMail = false;
};
let n = 0;
function account(name, o = {}) {
  n += 1;
  const email = `${name.toLowerCase()}${n}@school.test`;
  const uid = Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, is_sales_demo, closed_at) VALUES (?, ?, ?, ?, ?)').run(email, name, 'Tester', o.demo ? 1 : 0, o.closed ? '2026-01-01' : null).lastInsertRowid);
  const pid = Number(db.prepare("INSERT INTO purchases (license_status, expiration_date, school_domain) VALUES ('active', '2999-01-01', ?)").run(`s${n}.test`).lastInsertRowid);
  if (o.teacher) db.prepare("INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, 'registered', ?)").run(pid, uid);
  if (o.schoolAdmin) db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id) VALUES (?, ?)').run(uid, pid);
  if (o.districtAdmin) db.prepare('INSERT INTO district_license_admins (site_user_id, district_id) VALUES (?, 5)').run(uid);
  if (o.parent) db.prepare('INSERT INTO parent_classroom_links (site_user_id, classroom_id) VALUES (?, 1)').run(uid);
  return { uid, email, domain: `s${n}.test` };
}
const form = (o = {}) => ({ name: 'Visitor V', email: 'visitor@home.test', category: 'cant_sign_in', subject: 'Cannot get in', message: 'I reset my password but it fails.', ...o });
const rowOf = (id) => db.prepare('SELECT * FROM support_requests WHERE id = ?').get(id);

test('VISITOR: opens a request without signing in; staff are told; the person gets a copy with the reference', async () => {
  reset();
  const r = await call('POST', '/api/support', { body: form() });
  assert.equal(r.status, 200);
  assert.match(r.json.ref, /^SR-[A-Z2-9]{5}$/);
  const row = db.prepare('SELECT * FROM support_requests').get();
  assert.equal(row.status, 'new'); assert.equal(row.site_user_id, null); assert.equal(row.roles, null);
  assert.equal(row.requester_email, 'visitor@home.test'); assert.equal(row.category, 'cant_sign_in');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_request_messages').get().n, 1);
  assert.equal(sent.staff.length, 1); assert.match(sent.staff[0].subject, /New support request SR-/);
  assert.equal(sent.staff[0].to, 'admin@fixernationeducation.com', 'default support address until the setting is changed');
  assert.equal(sent.person.length, 1); assert.equal(sent.person[0].to, 'visitor@home.test'); assert.equal(sent.person[0].ref, r.json.ref);
  assert.match(sent.person[0].intro, /Get help page/); assert.match(sent.person[0].linkUrl, /support\.html$/);
});

test('VALIDATION: an email and a message are needed; odd input is not coerced; the hidden field catches bots', async () => {
  reset();
  assert.equal((await call('POST', '/api/support', { body: form({ email: 'not-an-email' }) })).status, 400);
  assert.equal((await call('POST', '/api/support', { body: form({ email: ['a@b.test'] }) })).status, 400, 'an array is not an email');
  assert.equal((await call('POST', '/api/support', { body: form({ message: { toString: 'x' } }) })).status, 400, 'an object is not a message');
  assert.equal((await call('POST', '/api/support', { body: form({ message: '   ' }) })).status, 400);
  assert.equal((await call('POST', '/api/support', { body: form({ name: '' }) })).status, 400);
  const odd = await call('POST', '/api/support', { body: form({ category: 'hack_the_planet', subject: '' }) });
  assert.equal(odd.status, 200);
  const row = db.prepare('SELECT * FROM support_requests').get();
  assert.equal(row.category, 'other'); assert.equal(row.subject, 'Something else', 'blank subject falls back to the topic');
  const before = db.prepare('SELECT COUNT(*) AS n FROM support_requests').get().n;
  const bot = await call('POST', '/api/support', { body: form({ website: 'http://spam.test' }) });
  assert.equal(bot.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_requests').get().n, before, 'nothing saved for a bot');
});

test('SIGNED IN: role, school and district come from the account; whatever the form claims is ignored', async () => {
  reset();
  const a = account('Dana', { teacher: true, schoolAdmin: true, districtAdmin: true });
  const r = await call('POST', '/api/support', { as: a.uid, body: form({ name: 'Somebody Else', email: 'forged@evil.test', roles: 'District administrator', schoolDomain: 'evil.test', siteUserId: 999, districtId: 1 }) });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT * FROM support_requests').get();
  assert.equal(row.site_user_id, a.uid); assert.equal(row.requester_email, a.email); assert.equal(row.requester_name, 'Dana Tester');
  assert.match(row.roles, /District administrator/); assert.match(row.roles, /School license administrator/); assert.match(row.roles, /Teacher/);
  assert.equal(row.school_domain, a.domain); assert.equal(row.district_id, 5);
  assert.equal(sent.person[0].to, a.email, 'the copy goes to the account email, not the form');
  const p = account('Pat', { parent: true });
  await call('POST', '/api/support', { as: p.uid, body: form() });
  assert.equal(db.prepare('SELECT roles FROM support_requests WHERE site_user_id = ?').get(p.uid).roles, 'Parent');
});

test('CONTEXT: the signed-in answer lists which Help center audiences the account belongs to (Release 145)', async () => {
  reset();
  const a = account('Dana', { teacher: true, schoolAdmin: true });
  const r = await call('GET', '/api/support/context', { as: a.uid });
  assert.deepEqual(r.json.audiences.slice().sort(), ['school', 'teacher']);
  const p = account('Pat', { parent: true });
  assert.deepEqual((await call('GET', '/api/support/context', { as: p.uid })).json.audiences, ['parent']);
  const none = account('Nina', {});
  assert.deepEqual((await call('GET', '/api/support/context', { as: none.uid })).json.audiences, []);
});

test('REFUSED: a sales demo account cannot send; a closed account is treated as signed out', async () => {
  reset();
  const demo = account('Demo', { demo: true });
  assert.equal((await call('POST', '/api/support', { as: demo.uid, body: form() })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_requests').get().n, 0);
  const ctx = await call('GET', '/api/support/context', { as: demo.uid });
  assert.equal(ctx.json.demo, true);
  const closed = account('Gone', { closed: true });
  assert.equal((await call('POST', '/api/support', { as: closed.uid, body: { message: 'help' } })).status, 400, 'no name or email given, and the closed session does not fill them in');
  assert.equal((await call('GET', '/api/support/mine', { as: closed.uid })).status, 401);
});

test('MINE: a person sees only their own requests, never staff internal notes; anyone else gets 404', async () => {
  reset();
  const a = account('Ann', { teacher: true });
  const b = account('Bo', { teacher: true });
  const mine = (await call('POST', '/api/support', { as: a.uid, body: form({ subject: 'Ann subject' }) })).json;
  await call('POST', '/api/support', { as: b.uid, body: form({ subject: 'Bo subject' }) });
  const idA = db.prepare('SELECT id FROM support_requests WHERE site_user_id = ?').get(a.uid).id;
  await call('POST', `/api/admin/support/${idA}/messages`, { body: { body: 'SECRET staff note', visibility: 'internal' } });
  await call('POST', `/api/admin/support/${idA}/messages`, { body: { body: 'Try resetting again.', visibility: 'public' } });

  const list = await call('GET', '/api/support/mine', { as: a.uid });
  assert.equal(list.json.requests.length, 1); assert.equal(list.json.requests[0].ref, mine.ref);
  const detail = await call('GET', `/api/support/mine/${idA}`, { as: a.uid });
  assert.equal(detail.status, 200);
  const bodies = detail.json.messages.map(m => m.body);
  assert.ok(bodies.includes('Try resetting again.')); assert.ok(!JSON.stringify(detail.json).includes('SECRET'), 'internal notes never leave the admin side');
  const idB = db.prepare('SELECT id FROM support_requests WHERE site_user_id = ?').get(b.uid).id;
  assert.equal((await call('GET', `/api/support/mine/${idB}`, { as: a.uid })).status, 404);
  assert.equal((await call('POST', `/api/support/mine/${idB}/messages`, { as: a.uid, body: { message: 'hi' } })).status, 404);
  assert.equal((await call('GET', '/api/support/mine/abc', { as: a.uid })).status, 404);
  assert.equal((await call('GET', '/api/support/mine')).status, 401);
});

test('FOLLOW-UP: an answer reopens a resolved or waiting request and tells staff', async () => {
  reset();
  const a = account('Ann', { teacher: true });
  await call('POST', '/api/support', { as: a.uid, body: form() });
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  await call('PUT', `/api/admin/support/${id}`, { body: { status: 'resolved' } });
  assert.ok(rowOf(id).resolved_at);
  sent.staff.length = 0;
  const r = await call('POST', `/api/support/mine/${id}/messages`, { as: a.uid, body: { message: 'Still broken.' } });
  assert.equal(r.status, 200);
  assert.equal(rowOf(id).status, 'open'); assert.equal(rowOf(id).resolved_at, null);
  assert.equal(sent.staff.length, 1);
  assert.equal((await call('POST', `/api/support/mine/${id}/messages`, { as: a.uid, body: { message: '' } })).status, 400);
  const demo = account('Demo', { demo: true });
  assert.equal((await call('POST', `/api/support/mine/${id}/messages`, { as: demo.uid, body: { message: 'x' } })).status, 403);
});

test('INBOX: list with counts, filters and search; detail shows every message', async () => {
  reset();
  const a = account('Ann', { teacher: true });
  await call('POST', '/api/support', { as: a.uid, body: form({ subject: 'Alpha problem', category: 'parents' }) });
  await call('POST', '/api/support', { body: form({ subject: 'Beta problem', name: 'Zed Zebra' }) });
  const id2 = db.prepare("SELECT id FROM support_requests WHERE subject = 'Beta problem'").get().id;
  await call('PUT', `/api/admin/support/${id2}`, { body: { status: 'resolved' } });

  const active = await call('GET', '/api/admin/support');
  assert.equal(active.json.requests.length, 1); assert.equal(active.json.requests[0].subject, 'Alpha problem');
  assert.deepEqual(active.json.counts, { new: 1, open: 0, waiting_on_user: 0, resolved: 1 });
  assert.equal((await call('GET', '/api/admin/support?status=all')).json.requests.length, 2);
  assert.equal((await call('GET', '/api/admin/support?status=resolved')).json.requests.length, 1);
  assert.equal((await call('GET', '/api/admin/support?status=all&category=parents')).json.requests.length, 1);
  assert.equal((await call('GET', '/api/admin/support?status=all&q=zebra')).json.requests.length, 1);
  assert.equal((await call('GET', `/api/admin/support?status=all&q=${a.domain}`)).json.requests.length, 1, 'search finds the school');

  const idA = db.prepare("SELECT id FROM support_requests WHERE subject = 'Alpha problem'").get().id;
  const d = await call('GET', `/api/admin/support/${idA}`);
  assert.equal(d.json.request.school_domain, a.domain); assert.equal(d.json.messages.length, 1);
  assert.equal((await call('GET', '/api/admin/support/99999')).status, 404);
  assert.equal((await call('GET', '/api/admin/support/admins')).json.admins.length, 2, '/admins is not read as an id');
});

test('STAFF REPLY: a public reply is NOT emailed; it waits on the person and is audited without its text', async () => {
  reset();
  await call('POST', '/api/support', { body: form() });
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  sent.person.length = 0;
  const r = await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'Please try the reset link again.', visibility: 'public' } });
  assert.equal(r.status, 200); assert.equal(r.json.status, 'waiting_on_user');
  assert.equal(rowOf(id).status, 'waiting_on_user');
  assert.equal(sent.person.length, 0, 'the person reads replies on the page; nothing is emailed');
  const log = db.prepare("SELECT * FROM school_audit_log WHERE action = 'support_reply_sent'").get();
  assert.equal(log.entity_type, 'support_request'); assert.equal(log.entity_id, id); assert.equal(log.purchase_id, null);
  assert.ok(!JSON.stringify(log).includes('reset link'), 'the audit log holds ids, not message text');
});

test('NEW REPLY TAG: a signed-in person sees how many staff replies they have not opened; opening clears it', async () => {
  reset();
  const a = account('Ann', { teacher: true });
  await call('POST', '/api/support', { as: a.uid, body: form() });
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  assert.equal((await call('GET', '/api/support/mine', { as: a.uid })).json.requests[0].newReplies, 0);
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'Note for us only', visibility: 'internal' } });
  assert.equal((await call('GET', '/api/support/mine', { as: a.uid })).json.requests[0].newReplies, 0, 'an internal note is never a new reply');
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'First answer', visibility: 'public' } });
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'Second answer', visibility: 'public' } });
  assert.equal((await call('GET', '/api/support/mine', { as: a.uid })).json.requests[0].newReplies, 2);
  await call('GET', `/api/support/mine/${id}`, { as: a.uid });
  assert.equal((await call('GET', '/api/support/mine', { as: a.uid })).json.requests[0].newReplies, 0);
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'Third answer', visibility: 'public' } });
  assert.equal((await call('GET', '/api/support/mine', { as: a.uid })).json.requests[0].newReplies, 1, 'only replies after the last opening count');
});

test('LOOKUP: a visitor reads their request with reference + email (any letter case), public messages only', async () => {
  reset();
  const made = (await call('POST', '/api/support', { body: form({ email: 'Visitor@Home.test' }) })).json;
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'SECRET staff note', visibility: 'internal' } });
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'We reset it for you.', visibility: 'public' } });
  const r = await call('POST', '/api/support/lookup', { body: { ref: made.ref.toLowerCase(), email: ' VISITOR@home.test ' } });
  assert.equal(r.status, 200); assert.equal(r.json.request.ref, made.ref); assert.equal(r.json.request.status, 'waiting_on_user');
  assert.deepEqual(r.json.messages.map(m => m.body), ['I reset my password but it fails.', 'We reset it for you.']);
  assert.ok(!JSON.stringify(r.json).includes('SECRET'), 'internal notes never reach a visitor');
  assert.ok(!JSON.stringify(r.json).includes('visitor@home.test'), 'the response does not repeat the email back');
});

test('LOOKUP MISS: a wrong email, wrong reference or odd input all get the same 404 words', async () => {
  reset();
  const made = (await call('POST', '/api/support', { body: form() })).json;
  const wrongEmail = await call('POST', '/api/support/lookup', { body: { ref: made.ref, email: 'someone@else.test' } });
  const wrongRef = await call('POST', '/api/support/lookup', { body: { ref: 'SR-ZZZZZ', email: 'visitor@home.test' } });
  assert.equal(wrongEmail.status, 404); assert.equal(wrongRef.status, 404);
  assert.deepEqual(wrongEmail.json, wrongRef.json, 'a miss never says which half was wrong');
  assert.equal((await call('POST', '/api/support/lookup', { body: { ref: ['SR-1'], email: { a: 1 } } })).status, 404);
});

test('LOOKUP FOLLOW-UP: a visitor can add to their request; a resolved one reopens and staff are told', async () => {
  reset();
  const made = (await call('POST', '/api/support', { body: form() })).json;
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  await call('PUT', `/api/admin/support/${id}`, { body: { status: 'resolved' } });
  sent.staff.length = 0;
  const ok = await call('POST', '/api/support/lookup/messages', { body: { ref: made.ref, email: 'visitor@home.test', message: 'It happened again.' } });
  assert.equal(ok.status, 200); assert.equal(rowOf(id).status, 'open'); assert.equal(sent.staff.length, 1);
  assert.equal(db.prepare("SELECT body FROM support_request_messages WHERE author_type = 'requester' ORDER BY id DESC").get().body, 'It happened again.');
  assert.equal((await call('POST', '/api/support/lookup/messages', { body: { ref: made.ref, email: 'visitor@home.test', message: '  ' } })).status, 400);
  const before = db.prepare('SELECT COUNT(*) AS n FROM support_request_messages').get().n;
  assert.equal((await call('POST', '/api/support/lookup/messages', { body: { ref: made.ref, email: 'wrong@home.test', message: 'hi' } })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_request_messages').get().n, before, 'a wrong email adds nothing');
});

test('SUMMARY: the menu badge count reads the status totals', async () => {
  reset();
  await call('POST', '/api/support', { body: form() });
  await call('POST', '/api/support', { body: form({ email: 'two@home.test' }) });
  const id = db.prepare('SELECT id FROM support_requests ORDER BY id').get().id;
  await call('PUT', `/api/admin/support/${id}`, { body: { status: 'open' } });
  assert.deepEqual((await call('GET', '/api/admin/support/summary')).json, { new: 1, open: 1, waiting_on_user: 0, resolved: 0 });
});

test('STAFF NOTE: an internal note sends no email and only moves a new request to open', async () => {
  reset();
  await call('POST', '/api/support', { body: form() });
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  sent.person.length = 0;
  const r = await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'Checked: account is fine.', visibility: 'internal' } });
  assert.equal(r.status, 200); assert.equal(sent.person.length, 0);
  assert.equal(rowOf(id).status, 'open');
  await call('PUT', `/api/admin/support/${id}`, { body: { status: 'waiting_on_user' } });
  await call('POST', `/api/admin/support/${id}/messages`, { body: { body: 'Another note', visibility: 'internal' } });
  assert.equal(rowOf(id).status, 'waiting_on_user', 'a later note does not change the status');
});

test('STAFF CHANGES: status and assignment are validated and audited; bad input is refused', async () => {
  reset();
  await call('POST', '/api/support', { body: form() });
  const id = db.prepare('SELECT id FROM support_requests').get().id;
  assert.equal((await call('PUT', `/api/admin/support/${id}`, { body: { status: 'banana' } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/support/${id}`, { body: { status: ['open'] } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/support/${id}`, { body: { assignedAdminId: 999 } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/support/${id}`, { body: { assignedAdminId: 'x' } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/support/${id}`, { body: { assignedAdminId: 8, status: 'open' } })).status, 200);
  assert.equal(rowOf(id).assigned_admin_id, 8); assert.equal(rowOf(id).status, 'open');
  assert.equal((await call('PUT', `/api/admin/support/${id}`, { body: { assignedAdminId: null } })).status, 200);
  assert.equal(rowOf(id).assigned_admin_id, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM school_audit_log WHERE action IN ('support_status_changed', 'support_assigned')").get().n, 3);
  assert.equal((await call('PUT', '/api/admin/support/99999', { body: { status: 'open' } })).status, 404);
  assert.equal((await call('POST', `/api/admin/support/${id}/messages`, { body: { body: '  ', visibility: 'public' } })).status, 400);
});

test('SUPPORT ADDRESS: the staff notice goes to the configured setting', async () => {
  reset();
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('contact_email_support', 'help@fne.test')").run();
  await call('POST', '/api/support', { body: form() });
  assert.equal(sent.staff[0].to, 'help@fne.test');
});

test('LOOKUP THROTTLE: repeated wrong guesses are stopped, per reference and per address', async () => {
  reset();
  const made = (await call('POST', '/api/support', { body: form() })).json;
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/support/lookup', { body: { ref: made.ref, email: `guess${i}@home.test` } });
  assert.equal(last.status, 429, 'five misses on one reference block that reference');
  const right = await call('POST', '/api/support/lookup', { body: { ref: made.ref, email: 'visitor@home.test' } });
  assert.equal(right.status, 429, 'even the right email waits, so the block cannot be used to probe');
});

test('BROWSER SESSION: the Get help form can send the anonymous browser session id (so staff can see that browser\'s errors); a junk one is dropped', async () => {
  reset();
  assert.equal((await call('POST', '/api/support', { body: form({ sessionId: 'sess-aaaaaaaa' }) })).status, 200);
  assert.equal((await call('POST', '/api/support', { body: form({ email: 'two@home.test', sessionId: 'bad id; DROP TABLE' }) })).status, 200);
  assert.equal((await call('POST', '/api/support', { body: form({ email: 'three@home.test', sessionId: { a: 1 } }) })).status, 200);
  const ids = db.prepare('SELECT client_session_id FROM support_requests ORDER BY id').all().map(r => r.client_session_id);
  assert.deepEqual(ids, ['sess-aaaaaaaa', null, null]);
});

test('RETENTION: requests older than 2 years are deleted with their messages when a new one arrives; one audit row, no text', async () => {
  reset();
  const lib = require(path.join(SERVER, 'lib/support.js'));
  lib._resetPurgeClock();
  const old = Number(db.prepare("INSERT INTO support_requests (ref, status, subject, requester_name, requester_email, created_at) VALUES ('SR-OLDOO', 'resolved', 'old one', 'Old', 'old@home.test', '2020-01-01 00:00:00')").run().lastInsertRowid);
  db.prepare("INSERT INTO support_request_messages (request_id, author_type, visibility, body) VALUES (?, 'requester', 'public', 'SECRET old text')").run(old);
  const recent = Number(db.prepare("INSERT INTO support_requests (ref, status, subject, requester_name, requester_email, created_at) VALUES ('SR-NEWWW', 'open', 'recent', 'New', 'new@home.test', datetime('now', '-300 days'))").run().lastInsertRowid);
  db.prepare("INSERT INTO support_request_messages (request_id, author_type, visibility, body) VALUES (?, 'requester', 'public', 'recent text')").run(recent);
  assert.equal((await call('POST', '/api/support', { body: form({ email: 'fresh@home.test' }) })).status, 200);
  await new Promise(r => setTimeout(r, 100));
  const refs = db.prepare('SELECT ref FROM support_requests ORDER BY id').all().map(r => r.ref);
  assert.ok(!refs.includes('SR-OLDOO') && refs.includes('SR-NEWWW') && refs.length === 2, JSON.stringify(refs));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_request_messages WHERE request_id = ?').get(old).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_request_messages WHERE request_id = ?').get(recent).n, 1);
  const logs = db.prepare("SELECT * FROM school_audit_log WHERE action = 'support_retention_purge'").all();
  assert.equal(logs.length, 1); assert.deepEqual(JSON.parse(logs[0].new_value), { removed: 1 });
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
});

test('WIRING: pages are linked, cache versions match, and nothing from a person goes in as HTML', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.match(read('admin-nav.js'), /admin-support\.html/);
  assert.match(read('footer.js'), /support\.html/);
  assert.match(read('admin-shell.js'), /'support':/);
  const pub = read('support.html');
  assert.ok(!/innerHTML\s*=/.test(pub), 'support.html builds its list and messages with textContent only');
  const adm = read('admin-support.html');
  assert.ok(!/onclick="[^"]*(\+|\$\{)/.test(adm.replace(/onclick="clearErrorGroup\(' \+ i \+ '\)"/g, '')), 'no inline handler is built from data (only the fixed theme toggle has one)');
  assert.match(adm, /fnEscape/);
  assert.match(adm, /admin-nav\.js\?v=31/);
  assert.match(read('server/app.js'), /\/api\/admin\/support/);
  assert.match(read('server/db/schema.sql'), /CREATE TABLE IF NOT EXISTS support_requests/);
  assert.match(read('server/scripts/alter-create-support-requests.js'), /support_request_messages/);
  assert.match(read('server/scripts/alter-add-support-seen-marker.js'), /requester_seen_message_id/);
  assert.match(read('server/db/schema.sql'), /requester_seen_message_id/);
  assert.match(read('admin-nav.js'), /api\/admin\/support\/summary/);
});
