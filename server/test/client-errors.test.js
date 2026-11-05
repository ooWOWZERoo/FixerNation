// Release 122: error capture (docs/reference/error-capture-requirements.md). Browsers report script errors and failed calls; the server
// records its own crashes and failed emails; staff read them grouped. No IP, query string, body, cookie, full email address or student id
// is ever kept; who the reporter is comes from cookies, never from the body; a browser cannot write a server-side kind.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SMTP_HOST = 'smtp.test';

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, session_invalidated_at TEXT, closed_at TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE support_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, site_user_id INTEGER, client_session_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE client_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, page_path TEXT NOT NULL DEFAULT '', api_path TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '', http_status INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', user_kind TEXT NOT NULL DEFAULT 'visitor', site_user_id INTEGER, client_session_id TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', occurrences INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
const sqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p instanceof Date ? sqlDate(p) : p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};

// a fake mail server that always refuses, so the real mailer's failure path runs
let mailAttempts = 0;
const fakeNodemailer = { createTransport: () => ({ sendMail: async () => { mailAttempts++; throw new Error('550 5.1.1 mailbox unavailable for jo@school.edu'); } }) };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { req.user = { userId: 7 }; next(); },
    getAuthUser: (req) => (req.cookies && req.cookies.fn_session ? { userId: 7 } : null),
  },
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: (kind, token) => ({ userId: Number(token), iat: Math.floor(Date.now() / 1000) }) },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
  [require.resolve('nodemailer')]: fakeNodemailer,
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const lib = require(path.join(SERVER, 'lib/client-errors.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/client-errors', require(path.join(SERVER, 'routes/client-errors.js')));
app.use('/api/admin/client-errors', require(path.join(SERVER, 'routes/admin-client-errors.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { body = null, cookies = {}, agent = 'TestBrowser/1.0' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== null ? JSON.stringify(body) : null;
    const headers = { 'User-Agent': agent };
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const rows = () => db.prepare('SELECT * FROM client_errors ORDER BY id').all();
const reset = () => { for (const t of ['site_users', 'school_audit_log', 'support_requests', 'client_errors']) db.exec(`DELETE FROM ${t}`); mailAttempts = 0; lib._resetPurgeClock(); };
const report = (o = {}) => ({ kind: 'js_error', page: '/for-teachers.html', message: 'x is undefined', source: '/nav.js:12', sessionId: 'sess-aaaaaaaa', ...o });
const site = (id) => { db.prepare('INSERT INTO site_users (id, email, first_name, last_name) VALUES (?, ?, ?, ?)').run(id, `u${id}@school.test`, 'U', String(id)); return { 'fn_user_session': id }; };

test('REPORT: a visitor\'s error is saved with the path only; emails and tokens in the message are removed; no IP is kept', async () => {
  reset();
  const r = await call('POST', '/api/client-errors', { body: report({
    page: '/reset-password.html?token=abcdefabcdefabcdefabcdefabcdef#frag',
    message: 'Cannot read name of jo@school.edu with key abcdefghijklmnopqrstuvwxyz0123',
    source: 'https://fixernationeducation.com/nav.js?v=19:12',
  }) });
  assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true });
  const [row] = rows();
  assert.equal(row.kind, 'js_error'); assert.equal(row.page_path, '/reset-password.html');
  assert.equal(row.message, 'Cannot read name of [removed] with key [removed]');
  assert.equal(row.source, '/nav.js:12'); assert.equal(row.user_kind, 'visitor'); assert.equal(row.site_user_id, null);
  assert.equal(row.user_agent, 'TestBrowser/1.0'); assert.equal(row.occurrences, 1);
  assert.ok(!Object.keys(row).some(k => /ip|address/i.test(k)), 'there is no column that could hold an IP address');
  assert.ok(!JSON.stringify(row).includes('jo@school.edu') && !JSON.stringify(row).includes('abcdefabcdef'));
});

test('WHO: the reporter is worked out from cookies; the body cannot claim an identity; a student is saved with no id', async () => {
  reset();
  const adult = site(41);
  await call('POST', '/api/client-errors', { cookies: adult, body: report({ message: 'adult', userKind: 'admin', siteUserId: 999, user_kind: 'admin', site_user_id: 1 }) });
  await call('POST', '/api/client-errors', { cookies: { fn_student_session: 5 }, body: report({ message: 'student', siteUserId: 5, studentId: 5, name: 'Jamie' }) });
  await call('POST', '/api/client-errors', { cookies: { fn_session: 'x' }, body: report({ message: 'staff' }) });
  await call('POST', '/api/client-errors', { body: report({ message: 'visitor', userKind: 'signed_in', siteUserId: 41 }) });
  const by = Object.fromEntries(rows().map(r => [r.message, r]));
  assert.equal(by.adult.user_kind, 'signed_in'); assert.equal(by.adult.site_user_id, 41);
  assert.equal(by.student.user_kind, 'student'); assert.equal(by.student.site_user_id, null, 'a student is never tied to an id');
  assert.equal(by.staff.user_kind, 'admin'); assert.equal(by.staff.site_user_id, null);
  assert.equal(by.visitor.user_kind, 'visitor'); assert.equal(by.visitor.site_user_id, null);
  assert.ok(!JSON.stringify(rows()).includes('Jamie'), 'a name sent in the body is never read');
});

test('KINDS AND INPUT: a browser may only write its own three kinds; junk and oversize reports are refused', async () => {
  reset();
  for (const kind of ['server_error', 'email_failed', 'anything', null, ['js_error']]) assert.equal((await call('POST', '/api/client-errors', { body: report({ kind }) })).status, 400, JSON.stringify(kind));
  assert.equal((await call('POST', '/api/client-errors', { body: [report()] })).status, 400);
  assert.equal((await call('POST', '/api/client-errors', { body: report({ message: 'x'.repeat(5000) }) })).status, 400, 'over 4 KB');
  assert.equal(rows().length, 0);
  for (const kind of ['js_error', 'promise_rejection', 'failed_request']) assert.equal((await call('POST', '/api/client-errors', { body: report({ kind, message: kind, api: kind === 'failed_request' ? '/api/x' : '' }) })).status, 200);
  assert.equal(rows().length, 3);
  const odd = await call('POST', '/api/client-errors', { body: report({ message: { a: 1 }, api: 5, page: ['/x'], sessionId: 'bad session!!', status: 'abc' }) });
  assert.equal(odd.status, 200); assert.equal(rows().length, 3, 'nothing useful in it, so nothing saved');
});

test('API PATH: numbers and tokens become placeholders so the same failure groups together; the query string is dropped', async () => {
  reset();
  await call('POST', '/api/client-errors', { body: report({ kind: 'failed_request', api: '/api/classrooms/42/students/7?pin=1', method: 'post', status: 500, message: 'HTTP 500' }) });
  await call('POST', '/api/client-errors', { body: report({ kind: 'failed_request', api: '/api/classrooms/43/students/9', method: 'POST', status: 500, message: 'HTTP 500', sessionId: 'sess-bbbbbbbb' }) });
  const all = rows();
  assert.equal(all.length, 2, 'two browsers');
  assert.ok(all.every(r => r.api_path === '/api/classrooms/:id/students/:id' && r.method === 'POST' && r.http_status === 500));
});

test('DEDUPE: the same error in the same browser session adds to its count; another session is a new row', async () => {
  reset();
  for (let i = 0; i < 3; i++) await call('POST', '/api/client-errors', { body: report() });
  await call('POST', '/api/client-errors', { body: report({ sessionId: 'sess-bbbbbbbb' }) });
  const all = rows();
  assert.equal(all.length, 2); assert.equal(all[0].occurrences, 3); assert.equal(all[1].occurrences, 1);
});

test('SERVER ERROR: a crashed route is recorded with its text cleaned; the Express handler calls it', async () => {
  reset();
  assert.equal(await lib.recordServerError({ method: 'POST', originalUrl: '/api/site-auth/reset-password?token=zzzzzzzzzzzzzzzzzzzzzzzzzzzz' }, Object.assign(new Error("Duplicate entry 'jo@school.edu' for key 'email'"), { code: 'ER_DUP_ENTRY' })), true);
  const [row] = rows();
  assert.equal(row.kind, 'server_error'); assert.equal(row.user_kind, 'server'); assert.equal(row.method, 'POST');
  assert.equal(row.api_path, '/api/site-auth/reset-password');
  assert.equal(row.message, "ER_DUP_ENTRY: Duplicate entry '[removed]' for key 'email'");
  assert.match(fs.readFileSync(path.join(SERVER, 'app.js'), 'utf8'), /recordServerError\(req, err\)/);
});

test('EMAIL FAILED: a refused send is recorded with the subject and the recipient\'s domain only, and still thrown to the caller', async () => {
  reset();
  const mailer = require(path.join(SERVER, 'lib/mailer.js'));
  await assert.rejects(() => mailer.sendPasswordResetEmail({ to: 'jo@school.edu', firstName: 'Jo', resetUrl: 'https://x.test/r' }), /550/);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(mailAttempts, 1);
  const [row] = rows();
  assert.equal(row.kind, 'email_failed'); assert.equal(row.source, 'to @school.edu; subject: Reset your Fixer Nation password');
  assert.match(row.message, /^550 5\.1\.1 mailbox unavailable for \[removed\]$/);
  assert.ok(!JSON.stringify(row).includes('jo@school.edu'), 'the address itself is never stored');
});

test('RETENTION: reports older than 30 days are deleted when a new one arrives', async () => {
  reset();
  db.prepare("INSERT INTO client_errors (kind, message, last_seen, first_seen) VALUES ('js_error', 'old', '2020-01-01 00:00:00', '2020-01-01 00:00:00')").run();
  await call('POST', '/api/client-errors', { body: report({ message: 'fresh' }) });
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(rows().map(r => r.message), ['fresh']);
});

test('STAFF LIST: grouped with counts and browsers; filter by kind and period; the 24-hour total', async () => {
  reset();
  for (const s of ['sess-aaaaaaaa', 'sess-bbbbbbbb', 'sess-bbbbbbbb']) await call('POST', '/api/client-errors', { body: report({ sessionId: s }) });
  await call('POST', '/api/client-errors', { body: report({ kind: 'failed_request', api: '/api/x/1', status: 503, message: 'HTTP 503' }) });
  await lib.recordServerError({ method: 'GET', originalUrl: '/api/y' }, new Error('boom'));
  db.prepare("INSERT INTO client_errors (kind, message, last_seen) VALUES ('js_error', 'last month', datetime('now', '-10 days'))").run();
  const day = await call('GET', '/api/admin/client-errors');
  assert.equal(day.status, 200); assert.equal(day.json.last24Hours, 5);
  const script = day.json.groups.find(g => g.kind === 'js_error');
  assert.equal(script.total, 3); assert.equal(script.browsers, 2);
  assert.equal(day.json.groups.length, 3, 'the 10-day-old one is outside 24 hours');
  assert.equal((await call('GET', '/api/admin/client-errors?hours=720')).json.groups.length, 4);
  assert.equal((await call('GET', '/api/admin/client-errors?kind=server_error')).json.groups.length, 1);
  assert.equal((await call('GET', '/api/admin/client-errors?hours=5&kind=bogus')).json.groups.length, 3, 'unknown values fall back to the defaults');
});

test('CLEAR: deletes exactly one group and is audited; a bad kind is refused', async () => {
  reset();
  await call('POST', '/api/client-errors', { body: report({ message: 'keep me' }) });
  await call('POST', '/api/client-errors', { body: report({ message: 'clear me', sessionId: 'sess-aaaaaaaa' }) });
  await call('POST', '/api/client-errors', { body: report({ message: 'clear me', sessionId: 'sess-bbbbbbbb' }) });
  const g = (await call('GET', '/api/admin/client-errors')).json.groups.find(x => x.message === 'clear me');
  const r = await call('POST', '/api/admin/client-errors/clear', { body: { kind: g.kind, page_path: g.page_path, api_path: g.api_path, method: g.method, http_status: g.http_status, message: g.message, source: g.source } });
  assert.equal(r.status, 200); assert.equal(r.json.removed, 2);
  assert.deepEqual(rows().map(x => x.message), ['keep me']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM school_audit_log WHERE action = 'support_errors_cleared'").get().n, 1);
  assert.equal((await call('POST', '/api/admin/client-errors/clear', { body: { kind: 'nope' } })).status, 400);
  assert.equal(rows().length, 1);
});

test('FOR A REQUEST: errors from the same signed-in person or browser in the 7 days before; nobody else\'s', async () => {
  reset();
  const adult = site(41);
  db.prepare("INSERT INTO support_requests (id, ref, site_user_id, client_session_id) VALUES (1, 'SR-AAAAA', 41, NULL)").run();
  db.prepare("INSERT INTO support_requests (id, ref, site_user_id, client_session_id) VALUES (2, 'SR-BBBBB', NULL, 'sess-bbbbbbbb')").run();
  db.prepare("INSERT INTO support_requests (id, ref, site_user_id, client_session_id) VALUES (3, 'SR-CCCCC', NULL, NULL)").run();
  await call('POST', '/api/client-errors', { cookies: adult, body: report({ message: 'mine as adult', sessionId: 'sess-cccccccc' }) });
  await call('POST', '/api/client-errors', { body: report({ message: 'from that browser', sessionId: 'sess-bbbbbbbb' }) });
  await call('POST', '/api/client-errors', { body: report({ message: 'someone else', sessionId: 'sess-dddddddd' }) });
  db.prepare("INSERT INTO client_errors (kind, message, site_user_id, last_seen) VALUES ('js_error', 'too old', 41, '2020-01-01 00:00:00')").run();
  const one = await call('GET', '/api/admin/client-errors/for-request/1');
  assert.deepEqual(one.json.errors.map(e => e.message), ['mine as adult']); assert.equal(one.json.matchedBy.account, true);
  const two = await call('GET', '/api/admin/client-errors/for-request/2');
  assert.deepEqual(two.json.errors.map(e => e.message), ['from that browser']); assert.equal(two.json.matchedBy.browser, true);
  const three = await call('GET', '/api/admin/client-errors/for-request/3');
  assert.deepEqual(three.json.errors, []); assert.deepEqual(three.json.matchedBy, { account: false, browser: false });
  assert.equal((await call('GET', '/api/admin/client-errors/for-request/99')).status, 404);
  assert.equal((await call('GET', '/api/admin/client-errors/for-request/abc')).status, 404);
});

// ---- the browser script, run against a fake browser ----
function fakeBrowser({ fetchImpl } = {}) {
  const beacons = [];
  const listeners = {};
  const win = {
    addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); },
    fetch: fetchImpl || (async () => ({ status: 200 })),
  };
  const ctx = {
    window: win, location: { pathname: '/for-teachers.html', origin: 'https://fixernationeducation.com', href: 'https://fixernationeducation.com/for-teachers.html?token=SECRET#frag' },
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } },
    Blob: class { constructor(parts, opts) { this.text = parts.join(''); this.type = opts.type; } },
    sessionStorage: { getItem: (k) => (k === 'fnAnalyticsSession' ? 'sess-aaaaaaaa' : null) },
    URL,
  };
  win.window = win;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'error-capture.js'), 'utf8'), ctx);
  return { ctx, beacons, fire: (n, ev) => (listeners[n] || []).forEach(fn => fn(ev)), payloads: () => beacons.map(b => JSON.parse(b.blob.text)) };
}

test('BROWSER: a script error becomes one report with the page PATH and the anonymous session id; no identity, no query string', () => {
  const b = fakeBrowser();
  b.fire('error', { message: 'boom', filename: 'https://fixernationeducation.com/nav.js?v=19', lineno: 12 });
  const [p] = b.payloads();
  assert.equal(b.beacons[0].url, '/api/client-errors'); assert.equal(b.beacons[0].blob.type, 'application/json');
  assert.equal(p.kind, 'js_error'); assert.equal(p.page, '/for-teachers.html'); assert.equal(p.sessionId, 'sess-aaaaaaaa'); assert.equal(p.message, 'boom');
  assert.ok(!JSON.stringify(p).includes('SECRET') && !JSON.stringify(p).includes('token'), 'the page query string never leaves the browser');
  assert.deepEqual(Object.keys(p).sort(), ['kind', 'message', 'page', 'sessionId', 'source']);
});

test('BROWSER: a missing image or file is not an error report; a rejection is; the same report is never sent twice; at most 5 per page view', () => {
  const b = fakeBrowser();
  b.fire('error', { target: { tagName: 'IMG' }, message: '' });
  assert.equal(b.beacons.length, 0);
  b.fire('unhandledrejection', { reason: new Error('nope') });
  b.fire('unhandledrejection', { reason: new Error('nope') });
  assert.equal(b.beacons.length, 1); assert.equal(b.payloads()[0].kind, 'promise_rejection');
  for (let i = 0; i < 10; i++) b.fire('error', { message: 'distinct ' + i, filename: 'a.js', lineno: i });
  assert.equal(b.beacons.length, 5, 'capped at 5 per page view');
});

test('BROWSER: our own API calls that fail are reported (500+ or no answer); 4xx, other sites and the report endpoint are not; the page gets its real answer', async () => {
  const answers = { '/api/a?x=SECRET': { status: 500 }, '/api/b': { status: 404 }, '/api/c': { status: 401 }, '/api/client-errors': { status: 500 }, 'https://other.test/api/x': { status: 500 } };
  const b = fakeBrowser({ fetchImpl: async (url) => { if (url === '/api/down') throw new TypeError('Failed to fetch'); return answers[url] || { status: 200 }; } });
  const fetch = b.ctx.window.fetch;
  assert.equal((await fetch('/api/a?x=SECRET', { method: 'post' })).status, 500, 'the caller still gets the answer');
  await fetch('/api/b'); await fetch('/api/c'); await fetch('/api/client-errors'); await fetch('https://other.test/api/x');
  await assert.rejects(() => fetch('/api/down'), /Failed to fetch/);
  await new Promise(r => setTimeout(r, 10));
  const p = b.payloads();
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].kind, p[0].api, p[0].method, p[0].status], ['failed_request', '/api/a', 'POST', 500]);
  assert.deepEqual([p[1].api, p[1].status, p[1].message], ['/api/down', 0, 'No answer from the server']);
  assert.ok(!JSON.stringify(p).includes('SECRET'), 'no query string');
});

test('LOADING: the shared nav scripts load the reporter, the student pages carry it directly, and the support form sends the browser id', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['nav.js', 'admin-nav.js', 'school-admin-nav.js', 'district-admin-nav.js']) assert.match(read(f), /error-capture\.js\?v=1/, f);
  for (const f of ['student-achievements', 'student-game', 'student-home', 'student-lesson', 'student-login']) assert.match(read(f + '.html'), /<script src="error-capture\.js\?v=1" defer>/, f);
  assert.match(read('support.html'), /sessionId: \(typeof fnAnalyticsSessionId/);
  const adm = read('admin-support.html');
  assert.match(adm, /api\/admin\/client-errors/); assert.match(adm, /fnEscape/);
  assert.match(read('server/app.js'), /\/api\/client-errors/);
  assert.match(read('server/scripts/alter-create-client-errors.js'), /client_session_id/);
  assert.match(read('server/db/schema.sql'), /CREATE TABLE IF NOT EXISTS client_errors/);
});
