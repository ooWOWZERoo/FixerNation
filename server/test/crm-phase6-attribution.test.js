// Sales CRM phase 6, feature 3: "how they found us" (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec"). The cookie parser, the first and latest touch
// rules, the public forms that record it (real routes, real SQL on node:sqlite), the contact page payload, the merge rule, and the rules that must not erode (no IP
// address, nothing in `source` or `crm_source`, a missing column never breaks a form, a Read-only user can see it and nobody can edit it).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const which of ['first', 'latest']) {
  for (const c of ['source', 'medium', 'campaign', 'landing']) db.exec(`ALTER TABLE newsletter_contacts ADD COLUMN ${which}_touch_${c} TEXT`);
  db.exec(`ALTER TABLE newsletter_contacts ADD COLUMN ${which}_touch_at TEXT`);
}
db.prepare('INSERT INTO quote_content_profiles (id, is_default) VALUES (1, 1)').run();
db.exec("CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER, kind TEXT, detail TEXT, invitation_id INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");

// The shared pool wrapper cannot run MySQL's ON DUPLICATE KEY; the public quote form uses it, so translate it the way other route tests do.
const baseQuery = pool.query;
pool.query = (sql, params) => {
  let s = String(sql);
  if (/ON DUPLICATE KEY UPDATE/i.test(s)) s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, '').replace(/^\s*INSERT INTO/i, 'INSERT OR IGNORE INTO');
  return baseQuery(s, params);
};
env.install(pool);

const express = require('express');
const cookieParser = require('cookie-parser');
const attr = require(path.join(env.SERVER, 'lib/attribution.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/newsletter', require(path.join(env.SERVER, 'routes/newsletter.js')).router);
app.use('/api/contact', require(path.join(env.SERVER, 'routes/contact.js')));
app.use('/api/crm/contacts', require(path.join(env.SERVER, 'routes/crm-contacts.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
const server = app.listen(0);
const port = server.address().port;
test.after(() => server.close());

function call(method, p, { body, cookie, admin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (admin) headers['x-admin'] = String(admin);
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const attrCookie = (obj) => `fn_attr=${encodeURIComponent(typeof obj === 'string' ? obj : JSON.stringify(obj))}`;
const NOW = Math.floor(Date.now() / 1000);
const touch = (s, extra = {}) => ({ s, m: 'cpc', c: 'fall_launch', p: '/licenses.html', t: NOW, ...extra });
const contactRow = (email) => db.prepare('SELECT * FROM newsletter_contacts WHERE email = ?').get(email);

env.enable(db);
const adminId = env.addAdmin(db, 'boss', 'admin');
const salesId = env.addAdmin(db, 'rep', 'sales');
const readId = env.addAdmin(db, 'viewer', 'readonly');

// ---- the parser --------------------------------------------------------------------------------------------------------------------

test('PARSE: a good cookie gives a first and a latest touch, lower-cased and trimmed', () => {
  const t = attr.parseAttribution(JSON.stringify({ f: touch('Google', { m: 'CPC' }), l: touch('newsletter', { m: 'email', c: 'oct_news' }) }));
  assert.equal(t.first.source, 'google');
  assert.equal(t.first.medium, 'cpc');
  assert.equal(t.first.campaign, 'fall_launch');
  assert.equal(t.first.landing, '/licenses.html');
  assert.equal(t.latest.source, 'newsletter');
  assert.match(t.latest.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('PARSE: a cookie with only one half uses it for both', () => {
  const t = attr.parseAttribution(JSON.stringify({ l: touch('bing') }));
  assert.equal(t.first.source, 'bing');
  assert.equal(t.latest.source, 'bing');
});

test('PARSE: hostile, oversize and wrongly shaped input is dropped, never "cleaned" into something else', () => {
  for (const bad of [null, undefined, '', 'not json', '[]', '"x"', '{}', '{"f":null,"l":null}', JSON.stringify({ f: { m: 'cpc' } }), 'x'.repeat(2000), JSON.stringify({ f: { s: 'a'.repeat(101) } }),
    JSON.stringify({ f: { s: '<script>alert(1)</script>' } }), JSON.stringify({ f: { s: 'ok; DROP TABLE x' } }), JSON.stringify({ f: 'google' }), JSON.stringify({ f: ['google'] })]) {
    assert.equal(attr.parseAttribution(bad), null, `rejected: ${String(bad).slice(0, 40)}`);
  }
  // A bad field inside an otherwise good touch is dropped on its own; the rest is kept.
  const t = attr.parseAttribution(JSON.stringify({ f: { s: 'google', m: '<b>x</b>', c: 'ok campaign', p: '/a?x=1', t: NOW } }));
  assert.equal(t.first.source, 'google');
  assert.equal(t.first.medium, null);
  assert.equal(t.first.campaign, 'ok campaign');
  assert.equal(t.first.landing, null, 'a path with a query string is refused');
  assert.equal(attr.cleanPath('/a/b.html'), '/a/b.html');
  assert.equal(attr.cleanPath('/path with space'), null);
  assert.equal(attr.cleanPath('http://x.example/'), null);
});

test('PARSE: a time in the future or years ago is treated as "now"', () => {
  const t = attr.parseAttribution(JSON.stringify({ f: touch('a', { t: NOW + 86400 * 400 }), l: touch('b', { t: 1000 }) }));
  const now = Date.now();
  for (const x of [t.first, t.latest]) assert.ok(Math.abs(Date.parse(x.at.replace(' ', 'T') + 'Z') - now) < 5000);
});

// ---- first and latest touch ---------------------------------------------------------------------------------------------------------

test('FIRST TOUCH: written once and never changed; LATEST is replaced only by a newer touch; no cookie changes nothing', async () => {
  const id = env.addContact(db, 'first-touch@example.com');
  const old = NOW - 86400 * 10;
  let t = attr.parseAttribution(JSON.stringify({ f: touch('google', { t: old }), l: touch('google', { t: old }) }));
  assert.deepEqual(await attr.recordTouches(pool, id, t), { first: true, latest: true });
  let row = contactRow('first-touch@example.com');
  assert.equal(row.first_touch_source, 'google');
  assert.equal(row.latest_touch_source, 'google');

  t = attr.parseAttribution(JSON.stringify({ f: touch('facebook', { t: NOW }), l: touch('facebook', { t: NOW }) }));
  assert.deepEqual(await attr.recordTouches(pool, id, t), { first: false, latest: true }, 'the first touch is never replaced');
  row = contactRow('first-touch@example.com');
  assert.equal(row.first_touch_source, 'google');
  assert.equal(row.latest_touch_source, 'facebook');

  // An older touch does not replace a newer latest touch.
  t = attr.parseAttribution(JSON.stringify({ l: touch('bing', { t: old }) }));
  assert.equal((await attr.recordTouches(pool, id, t)).latest, false);
  assert.equal(contactRow('first-touch@example.com').latest_touch_source, 'facebook');

  // No cookie at all: nothing changes, nothing is erased.
  assert.deepEqual(await attr.recordAttribution({ cookies: {} }, id, pool), { first: false, latest: false });
  assert.equal(contactRow('first-touch@example.com').latest_touch_source, 'facebook');
});

test('LABELS: recording a touch never changes source, crm_source, status or the Suspect / Prospect / Customer label', async () => {
  const id = env.addContact(db, 'labels@example.com');
  db.prepare("UPDATE newsletter_contacts SET source = 'Homepage', crm_source = 'Conference', crm_classification = 'prospect' WHERE id = ?").run(id);
  const before = contactRow('labels@example.com');
  await attr.recordTouches(pool, id, attr.parseAttribution(JSON.stringify({ f: touch('x'), l: touch('x') })));
  const after = contactRow('labels@example.com');
  for (const col of ['source', 'crm_source', 'status', 'crm_classification', 'assigned_admin_id', 'classification_locked']) assert.equal(after[col], before[col], col);
});

test('A MISSING COLUMN never throws (code deployed before the alter script)', async () => {
  const bare = env.makeDb();
  bare.db.exec('DROP TABLE newsletter_contacts; CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY, email TEXT)');
  bare.db.exec("INSERT INTO newsletter_contacts (id, email) VALUES (1, 'a@b.example.org')");
  assert.deepEqual(await attr.recordTouches(bare.pool, 1, attr.parseAttribution(JSON.stringify({ f: touch('x') }))), { first: false, latest: false });
});

// ---- the public forms -----------------------------------------------------------------------------------------------------------------

test('NEWSLETTER SIGNUP: the cookie on the request is recorded; the response is the same as without it; a repeat signup updates only the latest touch', async () => {
  const email = 'news-signup@example.com';
  const plain = await call('POST', '/api/newsletter/contacts', { body: { name: 'Plain', email: 'plain-signup@example.com' } });
  const withCookie = await call('POST', '/api/newsletter/contacts', { body: { name: 'N', email }, cookie: attrCookie({ f: touch('google'), l: touch('google') }) });
  assert.equal(withCookie.status, plain.status);
  assert.deepEqual(withCookie.json, plain.json);
  let row = contactRow(email);
  assert.equal(row.first_touch_source, 'google');
  assert.equal(row.source, 'Homepage', 'the form label is untouched');
  assert.equal(contactRow('plain-signup@example.com').first_touch_at, null, 'no cookie, nothing recorded, nothing invented');

  await call('POST', '/api/newsletter/contacts', { body: { name: 'N', email }, cookie: attrCookie({ f: touch('facebook'), l: touch('facebook', { t: NOW + 30 }) }) });
  row = contactRow(email);
  assert.equal(row.first_touch_source, 'google');
  assert.equal(row.latest_touch_source, 'facebook');
});

test('NEWSLETTER SIGNUP: a forged cookie full of markup records nothing and the form still works', async () => {
  const r = await call('POST', '/api/newsletter/contacts', { body: { name: 'N', email: 'forged@example.com' }, cookie: attrCookie({ f: { s: '<img src=x onerror=alert(1)>' } }) });
  assert.equal(r.status, 201);
  assert.equal(contactRow('forged@example.com').first_touch_at, null);
});

test('QUOTE REQUEST: the public form records the touch for the contact it creates', async () => {
  const r = await call('POST', '/api/contact/quote', { body: { firstName: 'Pat', lastName: 'Visitor', email: 'quote-visitor@example.com', school: 'Riverbend', phone: '555', message: 'Hi' }, cookie: attrCookie({ f: touch('linkedin', { m: 'social' }), l: touch('linkedin', { m: 'social' }) }) });
  assert.ok(r.status < 300, `status ${r.status} ${JSON.stringify(r.json)}`);
  const row = contactRow('quote-visitor@example.com');
  assert.equal(row.first_touch_source, 'linkedin');
  assert.equal(row.first_touch_medium, 'social');
  assert.equal(row.source, 'Quote Request');
});

test('ROUTES: every public form that makes a contact calls it after the contact exists; admin and system inserts do not', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  assert.match(read('routes/newsletter.js'), /recordAttributionForEmail\(req, email\)/);
  assert.match(read('routes/contact.js'), /recordAttributionForEmail\(req, email\)/);
  assert.match(read('routes/site-auth.js'), /recordAttributionForEmail\(req, email\)/);
  assert.match(read('routes/checkout.js'), /recordAttributionForEmail\(req, email\)/);
  const contact = read('routes/contact.js');
  assert.equal((contact.match(/recordAttributionForEmail\(/g) || []).length, 1, 'the admin "Sales Outreach" quote is not a visitor and is not attributed');
  assert.doesNotMatch(read('routes/crm-contacts.js'), /recordAttribution/, 'staff-made contacts are never attributed');
});

test('NO IP: the attribution code never reads an address, a user agent or a device id', () => {
  const code = fs.readFileSync(path.join(env.SERVER, 'lib/attribution.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /x-forwarded-for|clientIp|req\.ip|remoteAddress|user-agent|userAgent|ip_address|headers/i);
  const js = fs.readFileSync(path.join(env.SERVER, '..', 'referral.js'), 'utf8');
  assert.doesNotMatch(js, /userAgent|navigator\./);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon/, 'the cookie is only ever read by the server from the form request; the script sends nothing');
});

// ---- staff see it ---------------------------------------------------------------------------------------------------------------------

test('CONTACT PAGE: all three roles read first and latest touch; "not recorded" is null, never a guess from the signup source; nobody can write it', async () => {
  const id = contactRow('news-signup@example.com').id;
  for (const who of [adminId, salesId, readId]) {
    const r = await call('GET', `/api/crm/contacts/${id}`, { admin: who });
    assert.equal(r.status, 200);
    assert.equal(r.json.attribution.first.source, 'google');
    assert.equal(r.json.attribution.latest.source, 'facebook');
    assert.deepEqual(Object.keys(r.json.attribution.first).sort(), ['at', 'campaign', 'landing', 'medium', 'source']);
  }
  const old = env.addContact(db, 'before-phase-6@example.com');
  db.prepare("UPDATE newsletter_contacts SET source = 'Homepage' WHERE id = ?").run(old);
  const r = await call('GET', `/api/crm/contacts/${old}`, { admin: adminId });
  assert.deepEqual(r.json.attribution, { first: null, latest: null });
  // There is no route that edits it, and the general contact edit ignores these fields.
  for (const method of ['PUT', 'PATCH', 'POST']) await call(method, `/api/crm/contacts/${old}`, { admin: adminId, body: { firstTouchSource: 'invented', first_touch_source: 'invented', first_touch_at: '2020-01-01 00:00:00' } });
  assert.equal(contactRow('before-phase-6@example.com').first_touch_source, null, 'no staff route writes attribution');
  const anon = await call('GET', `/api/crm/contacts/${id}`);
  assert.equal(anon.status, 401);
});

test('MERGE: the earlier first touch and the newer latest touch survive; a contact with none takes the other\'s', async () => {
  const a = env.addContact(db, 'keep-a@example.com');
  const b = env.addContact(db, 'drop-b@example.com');
  const day = (n) => attr.parseAttribution(JSON.stringify({ f: touch('s' + n, { t: NOW - 86400 * n }), l: touch('s' + n, { t: NOW - 86400 * n }) }));
  await attr.recordTouches(pool, a, day(2));   // kept contact: first seen two days ago
  await attr.recordTouches(pool, b, day(9));   // duplicate: first seen nine days ago (earlier)
  // make the duplicate's LATEST older than the kept one's, and then check a newer one wins
  const r = await call('POST', `/api/crm/contacts/${b}/merge`, { admin: adminId, body: { intoId: a } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const kept = db.prepare('SELECT * FROM newsletter_contacts WHERE id = ?').get(a);
  assert.equal(kept.first_touch_source, 's9', 'the earlier first touch wins');
  assert.equal(kept.latest_touch_source, 's2', 'the newer latest touch stays');

  const c = env.addContact(db, 'keep-c@example.com');
  const d = env.addContact(db, 'drop-d@example.com');
  await attr.recordTouches(pool, d, day(3));
  assert.equal((await call('POST', `/api/crm/contacts/${d}/merge`, { admin: adminId, body: { intoId: c } })).status, 200);
  assert.equal(db.prepare('SELECT first_touch_source AS s FROM newsletter_contacts WHERE id = ?').get(c).s, 's3');
});

test('PAGES: the contact page draws the card through the shared escaping, and nothing sends the cookie anywhere', () => {
  const panels = fs.readFileSync(path.join(env.SERVER, '..', 'crm-panels.js'), 'utf8');
  const block = panels.slice(panels.indexOf('P.attribution'), panels.indexOf('/* ---- Timeline'));
  assert.match(block, /esc\(t\.source/);
  assert.match(block, /esc\(t\.landing\)/);
  assert.doesNotMatch(block, /innerHTML = [^;]*t\.(source|campaign|landing)\b(?!\))/);
  assert.match(fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-contact.html'), 'utf8'), /FnCrmPanels\.attribution\(/);
});
