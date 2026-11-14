// The unlisted demo page and what stays true of the public side (docs/reference/shared-demo-environment-requirements.md, R2, R3, R8): the page itself (static
// checks), the alter script and schema, a demo login treated as nobody signed in on the Get help page, and the role of a workspace login's email. The access-code
// gate, credentials, tickets, quotes and counts for private workspaces are tested in shared-demo-invitations.test.js and shared-demo-group-tags.test.js.
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
const ticket = (cookie, email, extra = {}) => call('POST', '/api/support', { cookie, body: { name: 'Pat Visitor', email, subject: 'A question', message: 'How does reporting work?', category: 'other', ...extra } });

test('TICKET: a salesperson demo account is still refused; a ticket from nobody signed in is not tagged as a demo ticket', async () => {
  const salesUser = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, is_sales_demo, is_shared_demo) VALUES ('rep+demo@fullsteam.test', 'Rep', 'Demo', 1, 0)").run().lastInsertRowid);
  const salesCookie = 'fn_user_session=' + signSession('site', { userId: salesUser }, '1h');
  assert.equal((await ticket(salesCookie, 'rep@fullsteam.test')).status, 403, 'salesperson demo accounts cannot send support requests');
  const r = await ticket(null, 'pat2@district.test', { demo_window: 2, fromDemo: true, from_demo: 1, source: 'Shared demo' });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT * FROM support_requests ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.demo_window, 0, 'a body field cannot tag a request');
  assert.equal(mail.staff.at(-1).fields.Source, undefined);
});

test('SIGN-IN ROLES: a workspace login email maps to its role key, and anything else (including the retired original logins) to nothing', () => {
  assert.equal(A.demoRoleKeyForEmail('Demo-District-07@public-demo.example.com'), 'district');
  assert.equal(A.demoRoleKeyForEmail('demo-parent-12@public-demo.example.com'), 'parent');
  assert.equal(A.demoRoleKeyForEmail('demo-parent@public-demo.example.com'), null, 'the original demo is retired');
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
    'This demo is yours alone. Other groups work in their own copies and can\'t see what you do here, and we clear yours when your demo ends.',
    'Please don\'t enter real student information.',
    'This page remembers you for about eight hours.',
  ]) assert.ok(page.includes(line), line);
  assert.ok(!/[—–]/.test(page), 'no dashes in the copy');
});

test('ALTER SCRIPT and SCHEMA: the request columns and the events table are in the fresh-install schema and the idempotent alter script', () => {
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
