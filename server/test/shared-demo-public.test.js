// Shared demo environment, phase 4: the public side (docs/reference/shared-demo-environment-requirements.md, R2, R3, R8, R9): the access-code gate, the
// credentials only behind it, tickets and quote requests tagged as coming from the demo, and the counts. Plus the unlisted page itself (static checks).
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
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-public';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, role TEXT DEFAULT 'teacher', password_hash TEXT, email_verified INTEGER DEFAULT 1,
  is_sales_demo INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0, session_invalidated_at TEXT, closed_at TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, license_status TEXT, expiration_date TEXT, school_domain TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER, student_id INTEGER);
CREATE TABLE support_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT UNIQUE, status TEXT DEFAULT 'new', category TEXT DEFAULT 'other', subject TEXT, requester_name TEXT, requester_email TEXT, site_user_id INTEGER, roles TEXT, school_domain TEXT, district_id INTEGER, page_url TEXT, user_agent TEXT, client_session_id TEXT, assigned_admin_id INTEGER, requester_seen_message_id INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, demo_window INTEGER NOT NULL DEFAULT 0);
CREATE TABLE support_request_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER, author_type TEXT, author_admin_id INTEGER, visibility TEXT DEFAULT 'public', body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_number TEXT UNIQUE, first_name TEXT, last_name TEXT, email TEXT, school TEXT, phone TEXT, message TEXT, content_profile_id INTEGER, origin TEXT, demo_window INTEGER NOT NULL DEFAULT 0);
CREATE TABLE quote_content_profiles (id INTEGER PRIMARY KEY, is_default INTEGER);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, company TEXT, source TEXT, status TEXT);
CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO quote_content_profiles (id, is_default) VALUES (1, 1);
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  let s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP');
  if (/ON DUPLICATE KEY UPDATE/i.test(s)) s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, '').replace(/^INSERT INTO/i, 'INSERT OR IGNORE INTO');
  s = s.replace(/\?/g, () => { const p = rawParams[i++]; params.push(p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p); return '?'; });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const mail = { staff: [], form: [], person: [] };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({
    sendSalesAlertEmail: async (m) => { mail.staff.push(m); },
    sendSupportEmail: async (m) => { mail.person.push(m); },
    sendContactFormEmail: async (m) => { mail.form.push(m); },
  }, { get: (t, name) => t[name] || (async () => {}) }),
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signSession, verifySession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const demo = require(path.join(SERVER, 'lib/public-demo.js'));
const A = require(path.join(SERVER, 'lib/public-demo-admin.js'));
const F = require(path.join(SERVER, 'lib/public-demo-fixtures.js'));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', demo.sharedDemoGate);
app.use('/api/demo', require(path.join(SERVER, 'routes/public-demo.js')));
app.use('/api/support', require(path.join(SERVER, 'routes/support.js')));
app.use('/api/contact', require(path.join(SERVER, 'routes/contact.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { cookie = null, body = null, ip = '203.0.113.10' } = {}) {
  return new Promise((resolve, reject) => {
    const data = method === 'GET' ? null : JSON.stringify(body || {});
    const headers = { 'X-Forwarded-For': ip }; // the throttles are keyed by address, and ignore requests that have none (as in production behind our proxy)
    if (cookie) headers.Cookie = cookie;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const setSetting = (k, v) => db.prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value').run(k, v);
const setting = (k) => (db.prepare('SELECT setting_value AS v FROM settings WHERE setting_key = ?').get(k) || {}).v;
const CODE = 'K7MQ4XPD';
const openDemo = (msFromNow = 3 * 3600 * 1000) => {
  setSetting('public_demo_enabled', 'true');
  setSetting('public_demo_ends_at', new Date(Date.now() + msFromNow).toISOString());
  setSetting('public_demo_access_code', CODE);
  setSetting('public_demo_code_version', '3');
  setSetting('public_demo_window_id', '2');
  setSetting('public_demo_password', 'demo-thorn-hill-poppy-pine');
  setSetting('public_demo_pin', '482915');
};
const closeDemo = () => { setSetting('public_demo_enabled', 'false'); setSetting('public_demo_ends_at', ''); };
const gateCookie = (cookies) => 'fn_demo_gate=' + (cookies || []).find(c => c.startsWith('fn_demo_gate=')).split(';')[0].slice('fn_demo_gate='.length);

test('STATE: closed shows nothing at all, so the page can look like one that does not exist', async () => {
  closeDemo();
  const r = await call('GET', '/api/demo/state');
  assert.deepEqual(r.json, { open: false });
});

test('STATE: open says when it ends and whether this browser has already entered the code', async () => {
  openDemo();
  const r = await call('GET', '/api/demo/state');
  assert.equal(r.json.open, true);
  assert.match(r.json.endsAtEastern, /E[SD]T$/);
  assert.equal(r.json.unlocked, false);
  assert.equal(JSON.stringify(r.json).includes('password'), false);
});

test('ENTER: a wrong code and a closed demo get exactly the same answer, and no cookie', async () => {
  openDemo();
  const wrong = await call('POST', '/api/demo/enter', { body: { code: 'AAAAAAAA' } });
  closeDemo();
  const closed = await call('POST', '/api/demo/enter', { body: { code: CODE } });
  assert.equal(wrong.status, 401);
  assert.equal(closed.status, 401);
  assert.deepEqual(wrong.json, closed.json);
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.equal(closed.headers['set-cookie'], undefined);
  openDemo();
  for (const bad of [undefined, null, 12345, ['K7MQ4XPD'], { code: CODE }, 'x'.repeat(500)]) {
    assert.equal((await call('POST', '/api/demo/enter', { body: { code: bad } })).status, 401, JSON.stringify(bad));
  }
});

test('ENTER: the right code (any case, with or without the hyphen) sets a gate cookie that carries the code version and ends with the demo', async () => {
  openDemo(2 * 3600 * 1000);
  const r = await call('POST', '/api/demo/enter', { body: { code: ' k7mq-4xpd ' } });
  assert.equal(r.status, 200);
  const token = gateCookie(r.headers['set-cookie']).slice('fn_demo_gate='.length);
  const payload = verifySession('demoGate', token);
  assert.equal(payload.v, '3');
  assert.ok(payload.exp - payload.iat <= 2 * 3600, 'never outlasts the demo');
  assert.ok(payload.exp - payload.iat > 3600);
  assert.match(r.headers['set-cookie'].join(';'), /HttpOnly/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM public_demo_events WHERE kind = 'gate_entry' AND window_id = 2").get().n, 1);

  openDemo(30 * 3600 * 1000);
  const long = await call('POST', '/api/demo/enter', { body: { code: CODE } });
  const longPayload = verifySession('demoGate', gateCookie(long.headers['set-cookie']).slice('fn_demo_gate='.length));
  assert.equal(longPayload.exp - longPayload.iat, 8 * 3600, 'capped at eight hours');
  assert.notEqual(longPayload.aud, undefined);
});

test('CREDENTIALS: only behind a valid gate cookie while the demo is open, and never with the join code', async () => {
  openDemo();
  assert.equal((await call('GET', '/api/demo/credentials')).status, 401);
  const none = await call('GET', '/api/demo/credentials');
  assert.equal(JSON.stringify(none.json).includes('demo-thorn'), false);

  const entered = await call('POST', '/api/demo/enter', { body: { code: CODE } });
  const cookie = gateCookie(entered.headers['set-cookie']);
  assert.equal((await call('GET', '/api/demo/state', { cookie })).json.unlocked, true);
  const r = await call('GET', '/api/demo/credentials', { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.password, 'demo-thorn-hill-poppy-pine');
  assert.equal(r.json.pin, '482915');
  assert.deepEqual(r.json.logins.map(l => l.key), ['district', 'school', 'teacher', 'parent', 'student']);
  assert.deepEqual(r.json.logins.map(l => l.userId), [...Object.values(F.ACCOUNTS).map(a => a.email), 'demo-student']);
  assert.equal(r.json.logins[4].secretKind, 'pin');
  assert.ok(r.json.logins.every(l => /^[a-z0-9-]+\.html$/.test(l.signIn) && l.what && l.role));
  assert.equal(JSON.stringify(r.json).toLowerCase().includes('join'), false, 'the join code is not shown to visitors');

  closeDemo();
  assert.equal((await call('GET', '/api/demo/credentials', { cookie })).status, 401, 'the moment the demo closes the cookie stops working');
  assert.equal((await call('GET', '/api/demo/state', { cookie })).json.open, false);
});

test('CREDENTIALS: a new access code shuts out every earlier visit; forged and wrong-audience tokens are refused', async () => {
  openDemo();
  const cookie = gateCookie((await call('POST', '/api/demo/enter', { body: { code: CODE } })).headers['set-cookie']);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie })).status, 200);
  setSetting('public_demo_code_version', '4'); // what "New code" does
  assert.equal((await call('GET', '/api/demo/credentials', { cookie })).status, 401);
  assert.equal((await call('GET', '/api/demo/state', { cookie })).json.unlocked, false);

  const wrongAudience = 'fn_demo_gate=' + signSession('site', { v: '4', userId: 1 }, '1h');
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: wrongAudience })).status, 401, 'a site-user token is not a gate token');
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: 'fn_demo_gate=not.a.token' })).status, 401);
  setSetting('public_demo_code_version', '3');
});

// ---- tickets and quote requests tagged as coming from the demo --------------------------------------------------------------------------------

const ticket = (cookie, email, extra = {}) => call('POST', '/api/support', { cookie, body: { name: 'Pat Visitor', email, subject: 'A question', message: 'How does reporting work?', category: 'other', ...extra } });
const lastTicket = () => db.prepare('SELECT * FROM support_requests ORDER BY id DESC LIMIT 1').get();

test('TICKET: from someone who entered the access code, it is tagged with the demo window and the staff notice says so', async () => {
  openDemo(); mail.staff.length = 0;
  const cookie = gateCookie((await call('POST', '/api/demo/enter', { body: { code: CODE } })).headers['set-cookie']);
  const r = await ticket(cookie, 'pat1@district.test');
  assert.equal(r.status, 200);
  assert.equal(lastTicket().demo_window, 2, 'the window the visit happened in');
  assert.equal(lastTicket().requester_email, 'pat1@district.test');
  assert.equal(mail.staff.at(-1).fields.Source, 'Shared demo');
  assert.equal(mail.staff.at(-1).demoAllowed, true);
});

test('TICKET: an ordinary request is not tagged, and a body field cannot tag one', async () => {
  openDemo(); mail.staff.length = 0;
  const r = await ticket(null, 'pat2@district.test', { demo_window: 2, fromDemo: true, from_demo: 1, source: 'Shared demo' });
  assert.equal(r.status, 200);
  assert.equal(lastTicket().demo_window, 0);
  assert.equal(mail.staff.at(-1).fields.Source, undefined);
  // a gate cookie after the demo closed counts for nothing either
  const cookie = gateCookie((await call('POST', '/api/demo/enter', { body: { code: CODE } })).headers['set-cookie']);
  closeDemo();
  await ticket(cookie, 'pat3@district.test');
  assert.equal(lastTicket().demo_window, 0);
  openDemo();
});

test('TICKET: a demo LOGIN is treated as nobody signed in (it has no real email), so the visitor types a name and address; a salesperson demo account is still refused', async () => {
  openDemo();
  const demoUser = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, is_sales_demo, is_shared_demo) VALUES ('demo-teacher@public-demo.example.com', 'Demo', 'Teacher', 1, 1)").run().lastInsertRowid);
  const salesUser = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, is_sales_demo, is_shared_demo) VALUES ('rep+demo@fullsteam.test', 'Rep', 'Demo', 1, 0)").run().lastInsertRowid);
  const demoCookie = 'fn_user_session=' + signSession('site', { userId: demoUser, demo: true }, '1h');

  const ctx = await call('GET', '/api/support/context', { cookie: demoCookie });
  assert.equal(ctx.json.signedIn, false, 'the Get help page shows the normal name and email form');
  const r = await ticket(demoCookie, 'visitor-from-demo@district.test');
  assert.equal(r.status, 200);
  const row = lastTicket();
  assert.equal(row.requester_email, 'visitor-from-demo@district.test', 'the typed address, never the demo login\'s');
  assert.equal(row.site_user_id, null);
  assert.equal(row.demo_window, 2);
  assert.equal((await call('GET', '/api/support/mine', { cookie: demoCookie })).status, 401);

  const salesCookie = 'fn_user_session=' + signSession('site', { userId: salesUser }, '1h');
  assert.equal((await ticket(salesCookie, 'rep@fullsteam.test')).status, 403, 'salesperson demo accounts still cannot send support requests');
});

const quote = (cookie, email) => call('POST', '/api/contact/quote', { cookie, body: { firstName: 'Pat', lastName: 'Visitor', email, school: 'Riverbend', phone: '(555) 867-5309', message: 'Please quote 40 seats.' } });
const lastQuote = () => db.prepare('SELECT * FROM quote_requests ORDER BY id DESC LIMIT 1').get();

test('QUOTE: from the demo it is tagged with the window and the staff email says so; an ordinary one is not', async () => {
  openDemo(); mail.form.length = 0;
  const cookie = gateCookie((await call('POST', '/api/demo/enter', { body: { code: CODE } })).headers['set-cookie']);
  assert.equal((await quote(cookie, 'buyer1@district.test')).status, 200);
  assert.equal(lastQuote().demo_window, 2);
  assert.equal(lastQuote().origin, 'inbound');
  assert.equal(mail.form.at(-1).fields.Source, 'Shared demo');
  assert.equal((await quote(null, 'buyer2@district.test')).status, 200);
  assert.equal(lastQuote().demo_window, 0);
  assert.equal(mail.form.at(-1).fields.Source, undefined);
});

test('COUNTS: this window only, by role, and a fresh window starts at zero', async () => {
  openDemo();
  const before = await A.demoCounts({ query: run });
  assert.equal(before.windowId, 2);
  assert.ok(before.gateEntries >= 3);
  assert.equal(before.tickets, 2, 'the two demo tickets above (not the ordinary ones)');
  assert.equal(before.quotes, 1);
  for (const role of ['teacher', 'teacher', 'student', 'district']) await A.recordDemoEvent('sign_in', role);
  const c = await A.demoCounts({ query: run });
  assert.deepEqual(c.signIns, { district: 1, school: 0, teacher: 2, parent: 0, student: 1 });
  assert.equal(await A.startNewWindow({ query: run }), 3);
  const fresh = await A.demoCounts({ query: run });
  assert.equal(fresh.windowId, 3);
  assert.deepEqual([fresh.gateEntries, fresh.tickets, fresh.quotes, ...Object.values(fresh.signIns)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(setting('public_demo_window_id'), '3');
});

test('SIGN-IN ROLES: a demo login email maps to its role key, and anything else to nothing', () => {
  assert.equal(A.demoRoleKeyForEmail('Demo-District@public-demo.example.com'), 'district');
  assert.equal(A.demoRoleKeyForEmail('demo-parent@public-demo.example.com'), 'parent');
  assert.equal(A.demoRoleKeyForEmail('someone@school.org'), null);
});

// ---- the unlisted page ------------------------------------------------------------------------------------------------------------------------

const page = fs.readFileSync(path.join(ROOT, 'demo-welcome.html'), 'utf8');

test('PAGE: unlisted and not indexable, and nothing in the HTML itself gives a login away', () => {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!/demo-(district|school|teacher|parent)@/.test(page), 'no demo user ID in the HTML');
  assert.ok(!/demo-student\b/.test(page), 'no demo username in the HTML');
  assert.ok(!/demo-[a-z]+-[a-z]+-[a-z]+/.test(page), 'no password in the HTML');
  assert.ok(!/public_demo|access_code|1A2B3C4D/i.test(page));
  assert.ok(!/(?:^|\s)(?:password|pin)\s*[:=]\s*['"][^'"]+['"]/i.test(page));
  assert.equal(fs.existsSync(path.join(ROOT, 'sitemap.xml')), false);
});

test('PAGE: no other page, menu or script links to it', () => {
  const offenders = [];
  for (const f of fs.readdirSync(ROOT).filter(n => /\.(html|js|xml|txt)$/.test(n) && n !== 'demo-welcome.html' && !/^admin-/.test(n))) {
    if (fs.readFileSync(path.join(ROOT, f), 'utf8').includes('demo-welcome')) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
  assert.equal(F.PUBLIC_DEMO_PAGE_PATH, '/demo-welcome.html');
});

test('PAGE: it talks only to the demo API, writes server text with textContent, and loads nothing from outside', () => {
  const calls = [...page.matchAll(/api\('(\/[a-z]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual([...new Set(calls)], ['/credentials', '/enter', '/state']);
  assert.match(page, /fetch\('\/api\/demo' \+ path/);
  assert.match(page, /init\.headers = \{ 'Content-Type': 'application\/json' \}; init\.body = JSON\.stringify/);
  assert.ok(!/innerHTML\s*=|insertAdjacentHTML|document\.write/.test(page), 'nothing from the server is turned into HTML');
  assert.ok(!/https?:\/\/(?!example)/.test(page.replace(/<link rel="icon"[^>]*>/g, '')), 'no external URLs');
  assert.ok(!/cdn|googleapis|unpkg/i.test(page));
  assert.match(page, /error-capture\.js\?v=1/);
  assert.match(page, /\^\[a-z0-9-\]\+\\\.html\$/, 'the sign-in link is only ever a plain page on this site');
});

test('PAGE: the closed state looks like a page that does not exist, and the three ways to reach FNE are there', () => {
  assert.match(page, /This page isn't available/);
  assert.match(page, /document\.title = 'Page not found'/);
  assert.match(page, /href="support\.html">Ask a question or submit a ticket</);
  assert.match(page, /href="school-licensing\.html#inquiry-form">Request a quote</);
  assert.ok(/id="inquiry-form"/.test(fs.readFileSync(path.join(ROOT, 'school-licensing.html'), 'utf8')), 'the quote form anchor exists');
  assert.ok(fs.existsSync(path.join(ROOT, 'privacy-policy.html')) && fs.existsSync(path.join(ROOT, 'terms.html')));
  for (const line of [
    'Enter the access code from your invitation to open the demo.',
    'Everything in it is made up, so click around as much as you like.',
    'Everyone using the demo shares the same sample data, and we reset it every night.',
    'Please don\'t enter real student information.',
    'This page remembers you for about eight hours.',
  ]) assert.ok(page.includes(line), line);
  assert.ok(!/[—–]/.test(page), 'no dashes in the copy');
});

test('ALTER SCRIPT and SCHEMA: both new request columns and the events table are in the fresh-install schema and the idempotent alter script', () => {
  const alter = fs.readFileSync(path.join(SERVER, 'scripts/alter-add-public-demo-phase4.js'), 'utf8');
  const schema = fs.readFileSync(path.join(SERVER, 'db/schema.sql'), 'utf8');
  for (const t of ['support_requests', 'quote_requests']) {
    assert.ok(alter.includes(`'${t}'`));
    const body = schema.slice(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${t} (`));
    assert.match(body.slice(0, body.indexOf(') ENGINE')), /demo_window INT UNSIGNED NOT NULL DEFAULT 0/, t);
  }
  assert.match(alter, /information_schema\.COLUMNS/);
  assert.match(alter, /information_schema\.TABLES/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public_demo_events/);
  assert.ok(!/DROP |DELETE |TRUNCATE /i.test(alter), 'the alter script only adds');
});

// Keep this one LAST: it uses up the throttle for this address.
test('THROTTLE: ten wrong codes from one address block that address (even for the right code), and a right code never counts against it', async () => {
  openDemo();
  const ip = '203.0.113.99';
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/demo/enter', { body: { code: CODE }, ip })).status, 200, 'right codes never use tries up');
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/demo/enter', { body: { code: 'WRONGONE' }, ip })).status, 401);
  const blocked = await call('POST', '/api/demo/enter', { body: { code: CODE }, ip });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['set-cookie'], undefined);
  assert.equal((await call('POST', '/api/demo/enter', { body: { code: CODE }, ip: '203.0.113.50' })).status, 200, 'another address is not affected');
});
