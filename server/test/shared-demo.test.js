// Shared demo environment, phase 1 (docs/reference/shared-demo-environment-requirements.md): the open/closed rule, the gate that ends demo sessions,
// and the mailer guard that stops a demo session emailing anyone but FNE staff.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.SESSION_SECRET = 'test-secret-for-shared-demo';
process.env.SMTP_HOST = 'smtp.test';
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);');
let poolBroken = false;
const run = async (sql, rawParams = []) => {
  if (poolBroken) throw new Error('database is down');
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
const sent = [];
const stubs = { [path.join(SERVER, 'db/pool.js')]: { query: run } };
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return { ok: true }; } }) };
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signSession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const demo = require(path.join(SERVER, 'lib/public-demo.js'));
const mailer = require(path.join(SERVER, 'lib/mailer.js'));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', demo.sharedDemoGate);
app.get('/api/whoami', (req, res) => res.json({
  demo: demo.isSharedDemoRequest(), site: !!req.cookies.fn_user_session, student: !!req.cookies.fn_student_session,
}));
app.post('/api/mail-outsider', async (req, res) => { await mailer.sendPasswordResetEmail({ to: 'someone@school.test', firstName: 'S', resetUrl: 'https://x.test' }); res.json({ ok: true }); });
app.post('/api/mail-form', async (req, res) => { await mailer.sendContactFormEmail({ formName: 'Quote request', fields: { Name: 'A' }, replyTo: 'a@school.test' }); res.json({ ok: true }); });
app.post('/api/alert', async (req, res) => {
  await mailer.sendSalesAlertEmail({ to: req.body.to, subject: 'Alert', fields: { a: 'b' }, demoAllowed: !!req.body.demoAllowed });
  res.json({ ok: true });
});
app.post('/api/upload', (req, res) => res.json({ ok: true }));
app.post('/api/assert-recipient', (req, res) => {
  try { demo.assertDemoRecipient(req.body.email); res.json({ ok: true }); } catch (e) { res.status(e.status || 500).json({ error: e.message, demo: !!e.demo }); }
});
app.post('/api/assert-not-demo', (req, res) => {
  try { demo.assertNotSharedDemoRequest(); res.json({ ok: true }); } catch (e) { res.status(e.status || 500).json({ error: e.message, demo: !!e.demo }); }
});
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { cookie = null, body = null, type = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (data != null) { headers['Content-Type'] = type; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data != null) req.write(data); req.end();
  });
}

const setSetting = (k, v) => db.prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value').run(k, v);
const inAnHour = () => new Date(Date.now() + 3600 * 1000).toISOString();
const openDemo = () => { setSetting('public_demo_enabled', 'true'); setSetting('public_demo_ends_at', inAnHour()); };
const closeDemo = () => { setSetting('public_demo_enabled', 'false'); setSetting('public_demo_ends_at', ''); };
const demoSite = () => `fn_user_session=${signSession('site', { userId: 5, demo: true }, '1h')}`;
const plainSite = () => `fn_user_session=${signSession('site', { userId: 6 }, '1h')}`;
const demoStudent = () => `fn_student_session=${signSession('student', { studentId: 9, demo: true }, '1h')}`;
const reset = () => { closeDemo(); sent.length = 0; poolBroken = false; };

test('the window rule: open only when switched on AND the end time is still ahead', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const w = (enabled, endsAt) => demo.evaluateDemoWindow({ enabled, endsAt }, now);
  assert.equal(w('false', '2026-11-25T00:00:00Z').open, false);
  assert.equal(w('', '2026-11-25T00:00:00Z').open, false);
  assert.equal(w('true', '').open, false, 'on with no end date is off');
  assert.equal(w('true', 'not a date').open, false);
  assert.equal(w('true', '2026-11-20T11:59:59Z').open, false, 'a switch left on past its date is off');
  assert.equal(w('true', '2026-11-20T12:00:00Z').open, false, 'the end moment itself is closed');
  assert.equal(w('true', '2026-11-20T12:00:01Z').open, true);
  assert.equal(w(' TRUE ', '2026-11-25T00:00:00Z').open, true);
  assert.equal(w('true', '2026-11-25T00:00:00Z').reason, 'open');
});

test('the demo is off with nothing set, and isPublicDemoOpen reads the settings', async () => {
  reset();
  assert.equal(await demo.isPublicDemoOpen(), false);
  openDemo();
  assert.equal(await demo.isPublicDemoOpen(), true);
  setSetting('public_demo_ends_at', new Date(Date.now() - 1000).toISOString());
  assert.equal(await demo.isPublicDemoOpen(), false, 'flag still on, date passed');
});

test('CLOSED: a demo site cookie and a demo student cookie are dropped, and the browser is told to clear them', async () => {
  reset();
  const r = await call('GET', '/api/whoami', { cookie: `${demoSite()}; ${demoStudent()}` });
  assert.deepEqual(r.json, { demo: false, site: false, student: false });
  const cleared = (r.headers['set-cookie'] || []).join('|');
  assert.match(cleared, /fn_user_session=;/);
  assert.match(cleared, /fn_student_session=;/);
});

test('CLOSED: an ordinary site session is untouched', async () => {
  reset();
  const r = await call('GET', '/api/whoami', { cookie: plainSite() });
  assert.deepEqual(r.json, { demo: false, site: true, student: false });
  assert.equal(r.headers['set-cookie'], undefined);
});

test('OPEN: demo sessions are kept and run inside the demo context', async () => {
  reset(); openDemo();
  assert.deepEqual((await call('GET', '/api/whoami', { cookie: demoSite() })).json, { demo: true, site: true, student: false });
  assert.deepEqual((await call('GET', '/api/whoami', { cookie: demoStudent() })).json, { demo: true, site: false, student: true });
  assert.deepEqual((await call('GET', '/api/whoami', { cookie: plainSite() })).json, { demo: false, site: true, student: false });
});

test('OPEN, then the end time passes: the same demo cookie stops working', async () => {
  reset(); openDemo();
  assert.equal((await call('GET', '/api/whoami', { cookie: demoSite() })).json.site, true);
  setSetting('public_demo_ends_at', new Date(Date.now() - 1000).toISOString());
  assert.equal((await call('GET', '/api/whoami', { cookie: demoSite() })).json.site, false);
});

test('if the settings cannot be read, the gate fails closed', async () => {
  reset(); openDemo();
  poolBroken = true;
  const r = await call('GET', '/api/whoami', { cookie: demoSite() });
  assert.equal(r.status, 200);
  assert.equal(r.json.site, false);
});

test('a forged demo claim is worthless: the token must be signed by us', async () => {
  reset(); openDemo();
  const forged = 'fn_user_session=eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOjEsImRlbW8iOnRydWV9.';
  const r = await call('GET', '/api/whoami', { cookie: forged });
  assert.deepEqual(r.json, { demo: false, site: true, student: false }, 'left alone for the normal checks to reject; never treated as a demo session');
});

test('MAIL: a demo session cannot email an outsider, and the answer says so', async () => {
  reset(); openDemo();
  const r = await call('POST', '/api/mail-outsider', { cookie: demoSite(), body: {} });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 0);
  assert.equal(r.json.demoNotice, 'This is a demo, so no email was sent.');
  assert.equal(r.headers['x-demo-email-suppressed'], '1');
});

test('MAIL: outside a demo session the same email is sent as before', async () => {
  reset(); openDemo();
  const r = await call('POST', '/api/mail-outsider', { cookie: plainSite(), body: {} });
  assert.equal(sent.length, 1);
  assert.equal(r.json.demoNotice, undefined);
  reset();
  await call('POST', '/api/mail-outsider', { body: {} });
  assert.equal(sent.length, 1);
});

test('MAIL: a public form notice to staff still goes out from a demo session (a demo visitor can ask a question or request a quote)', async () => {
  reset(); openDemo();
  const r = await call('POST', '/api/mail-form', { cookie: demoSite(), body: {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'admin@fixernationeducation.com');
  assert.equal(r.json.demoNotice, undefined);
});

test('MAIL: a staff alert goes out from a demo session only when its caller says so, and only to a staff address', async () => {
  reset(); openDemo();
  const staff = 'admin@fixernationeducation.com';
  let r = await call('POST', '/api/alert', { cookie: demoSite(), body: { to: staff } });
  assert.equal(sent.length, 0, 'a safety or order alert is held back');
  assert.ok(r.json.demoNotice);
  r = await call('POST', '/api/alert', { cookie: demoSite(), body: { to: staff, demoAllowed: true } });
  assert.equal(sent.length, 1, 'a support-request notice reaches staff');
  r = await call('POST', '/api/alert', { cookie: demoSite(), body: { to: 'someone@school.test', demoAllowed: true } });
  assert.equal(sent.length, 1, 'allowed does not mean any address: an outsider is still refused');
});

test('MAIL: a staff address set in the admin settings counts as staff', async () => {
  reset(); openDemo();
  setSetting('contact_email_support', 'support-desk@fixernationeducation.com');
  await call('POST', '/api/alert', { cookie: demoSite(), body: { to: 'support-desk@fixernationeducation.com', demoAllowed: true } });
  assert.equal(sent.length, 1);
});

test('UPLOADS: a demo session cannot upload a file; an ordinary one is untouched', async () => {
  reset(); openDemo();
  const body = '--b\r\nContent-Disposition: form-data; name="f"; filename="x.png"\r\n\r\nx\r\n--b--\r\n';
  const r = await call('POST', '/api/upload', { cookie: demoSite(), body, type: 'multipart/form-data; boundary=b' });
  assert.equal(r.status, 403);
  assert.equal(r.json.demo, true);
  const ok = await call('POST', '/api/upload', { cookie: plainSite(), body, type: 'multipart/form-data; boundary=b' });
  assert.equal(ok.status, 200);
});

test('RECIPIENTS: a demo session may only name a fake (example.com) address; an ordinary session is not restricted', async () => {
  for (const ok of ['teacher2@example.com', 'a@public-demo.example.com', 'A@Sub.Example.COM ']) assert.equal(demo.demoRecipientAllowed(ok), true, ok);
  for (const no of ['someone@school.org', 'x@notexample.com', 'x@example.com.evil.org', 'example.com', '', null, undefined]) assert.equal(demo.demoRecipientAllowed(no), false, String(no));
  reset(); openDemo();
  const bad = await call('POST', '/api/assert-recipient', { cookie: demoSite(), body: { email: 'real.teacher@school.org' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.json.demo, true);
  assert.match(bad.json.error, /example\.com/);
  assert.equal((await call('POST', '/api/assert-recipient', { cookie: demoSite(), body: { email: 'teacher2@example.com' } })).status, 200);
  assert.equal((await call('POST', '/api/assert-recipient', { cookie: plainSite(), body: { email: 'real.teacher@school.org' } })).status, 200, 'an ordinary session is unaffected');
  assert.equal((await call('POST', '/api/assert-recipient', { body: { email: 'real.teacher@school.org' } })).status, 200);
});

test('RESEND AND RESET: refused in a demo session, allowed otherwise', async () => {
  reset(); openDemo();
  assert.equal((await call('POST', '/api/assert-not-demo', { cookie: demoSite(), body: {} })).status, 403);
  assert.equal((await call('POST', '/api/assert-not-demo', { cookie: plainSite(), body: {} })).status, 200);
  assert.equal((await call('POST', '/api/assert-not-demo', { body: {} })).status, 200);
});

test('TWO DEMOS: confinement knows both the salesperson demo and the shared demo, and keeps each to its own school', () => {
  const s = require(path.join(SERVER, 'lib/sales-demo.js'));
  assert.equal(s.isDemoDistrictName('FNE Sales Demo District'), true);
  assert.equal(s.isDemoDistrictName('FNE Demo District'), true);
  assert.equal(s.isDemoDistrictName('Riverbend Schools'), false);
  assert.equal(s.isDemoSchoolDomain('sales-demo.example.com'), true);
  assert.equal(s.isDemoSchoolDomain('public-demo.example.com'), true);
  assert.equal(s.isDemoSchoolDomain('school.org'), false);
  assert.equal(s.demoKindOfDistrict('FNE Sales Demo District'), s.demoKindOfSchool('sales-demo.example.com'));
  assert.equal(s.demoKindOfDistrict('FNE Demo District'), s.demoKindOfSchool('public-demo.example.com'));
  assert.notEqual(s.demoKindOfDistrict('FNE Demo District'), s.demoKindOfSchool('sales-demo.example.com'), 'the shared demo district cannot hold the salesperson demo school');
  assert.equal(s.demoKindOfDistrict('Riverbend Schools'), s.demoKindOfSchool('school.org'), 'two real ones match (both null), so the rule only bites on demo mixing');
  assert.notEqual(s.demoKindOfDistrict('FNE Demo District'), s.demoKindOfSchool('school.org'), 'a real school cannot join a demo district');
  // and neither demo district may ever be public on the standards pages
  assert.deepEqual(s.DEMO_DISTRICT_NAMES, ['FNE Sales Demo District', 'FNE Demo District']);
});

test('NO BACK DOOR: nothing outside lib/mailer.js creates a mail transport or sends mail', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'uploads', 'data'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      // routes/morning-boost.js is the one other sender: the Morning Boost broadcast, started only by an admin route (requireAuth) or the cron
      // script, never by a site or student session, so the demo guard has nothing to guard there.
      if (!full.endsWith('.js') || full === path.join(SERVER, 'lib/mailer.js') || full === path.join(SERVER, 'routes/morning-boost.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (/createTransport\s*\(|\.sendMail\s*\(|require\(['"]nodemailer['"]\)/.test(src)) offenders.push(path.relative(SERVER, full));
    }
  };
  walk(SERVER);
  assert.deepEqual(offenders, [], 'every email must go through lib/mailer.js so the shared-demo guard covers it');
});

test('every send in lib/mailer.js goes through getTransporter (the guard), never the real transport directly', () => {
  const src = fs.readFileSync(path.join(SERVER, 'lib/mailer.js'), 'utf8');
  const uses = src.match(/getRealTransporter\(\)/g).length;
  assert.equal(uses, 3, 'the guard, getTransporter and the definition are the only mentions of the real transport');
  assert.ok(!/getRealTransporter\(\)\.sendMail/.test(src.replace('return getRealTransporter().sendMail(mail)', '')), 'no send bypasses the guard');
  const sends = (src.match(/\.sendMail\(/g) || []).length;
  const guarded = (src.match(/getTransporter\([^)]*\)\.sendMail\(/g) || []).length;
  assert.equal(sends - guarded, 1, 'every .sendMail( goes through getTransporter(...) except the guard\'s own single hand-off to the real transport');
});

test('an FNE admin holding a demo cookie in the same browser is not restricted', async () => {
  reset(); openDemo();
  const admin = `fn_session=${signSession('admin', { userId: 1, username: 'a' }, '1h')}`;
  const r = await call('GET', '/api/whoami', { cookie: `${demoSite()}; ${admin}` });
  assert.equal(r.json.demo, false);
  await call('POST', '/api/mail-outsider', { cookie: `${demoSite()}; ${admin}`, body: {} });
  assert.equal(sent.length, 1, 'the admin\'s own email goes out');
  // a made-up admin cookie does not lift the restrictions
  const fake = await call('GET', '/api/whoami', { cookie: `${demoSite()}; fn_session=garbage` });
  assert.equal(fake.json.demo, true);
});
