// Release 110: the CRM is the record of who is on the platform (docs/reference/crm-record-of-truth-requirements.md).
// Community lists, group counts, direct messages, profiles and Community access follow it, and a buyer's CRM contact cannot be deleted.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, is_sales_demo INTEGER DEFAULT 0, session_invalidated_at TEXT);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, license_status TEXT, expiration_date TEXT, school_domain TEXT);
CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER);
CREATE TABLE social_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, avatar_url TEXT, bio TEXT, bio_consent INTEGER DEFAULT 0);
CREATE TABLE social_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, description TEXT, is_public INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE social_group_members (group_id INTEGER, user_id INTEGER, PRIMARY KEY (group_id, user_id));
CREATE TABLE social_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, recipient_id INTEGER, content TEXT, attachments TEXT, read_at TEXT, deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE social_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, author_id INTEGER, content TEXT, deleted_at TEXT);
CREATE TABLE brain_game_privacy (user_id INTEGER, show_badges INTEGER);
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP'); // MariaDB spellings
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const noopProxy = new Proxy({}, { get: () => async () => ({}) });
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  // the cookie value is the user id, so a test signs in as anyone by sending it
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: (kind, token) => ({ userId: Number(token), iat: Math.floor(Date.now() / 1000) }) },
  [path.join(SERVER, 'lib/safety/gateway.js')]: { screenContent: async () => ({ decision: 'allow' }), isPublishable: () => true },
  [path.join(SERVER, 'lib/safety/school-context.js')]: { resolveSchoolDomainForSocialGroup: async () => null, resolveSchoolDomainForTeacher: async () => null },
  [path.join(SERVER, 'lib/mailer.js')]: noopProxy,
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
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
app.use('/api/social', require(path.join(SERVER, 'routes/social.js')));
app.use('/api/newsletter', require(path.join(SERVER, 'routes/newsletter.js')).router);
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

const FUTURE = '2999-01-01';
let n = 0;
// a person: an account, optionally a CRM contact, a license seat (status of its purchase), a Community profile
function person(name, o = {}) {
  n += 1;
  const email = `${name.toLowerCase()}${n}@school.test`;
  const uid = Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, is_sales_demo) VALUES (?, ?, ?, ?)').run(email, name, 'Smith', o.demo ? 1 : 0).lastInsertRowid);
  if (o.contact !== false) db.prepare('INSERT INTO newsletter_contacts (email, name) VALUES (?, ?)').run(email, name);
  if (o.license !== false) {
    const pid = Number(db.prepare('INSERT INTO purchases (license_status, expiration_date) VALUES (?, ?)').run(o.status || 'active', o.expires || FUTURE).lastInsertRowid);
    db.prepare("INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, 'registered', ?)").run(pid, uid);
  }
  db.prepare('INSERT INTO social_profiles (user_id) VALUES (?)').run(uid);
  return { uid, email };
}
const reset = () => { for (const t of ['site_users', 'newsletter_contacts', 'purchases', 'invoices', 'license_seats', 'social_profiles', 'social_groups', 'social_group_members', 'social_messages', 'social_posts']) db.exec(`DELETE FROM ${t}`); };

test('MEMBERS LIST shows only people with a CRM contact and a working license, and not demo accounts', async () => {
  reset();
  const me = person('Me');
  person('Ok');
  person('NoContact', { contact: false });
  person('Expired', { status: 'expired' });
  person('Lapsed', { expires: '2020-01-01' });
  person('NoSeat', { license: false });
  person('Demo', { demo: true });
  const r = await call('GET', '/api/social/members', { as: me.uid });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.members.map((m) => m.first_name).sort(), ['Me', 'Ok']);
});

test('REMOVING A CONTACT takes the person off the members list at once (the three John Shaws)', async () => {
  reset();
  const me = person('Me');
  const gone = person('Gone');
  assert.equal((await call('GET', '/api/social/members', { as: me.uid })).json.members.length, 2);
  db.prepare('DELETE FROM newsletter_contacts WHERE email = ?').run(gone.email);
  const after = await call('GET', '/api/social/members', { as: me.uid });
  assert.deepEqual(after.json.members.map((m) => m.first_name), ['Me']);
});

test('COMMUNITY ACCESS needs a CRM contact', async () => {
  reset();
  const orphan = person('Orphan', { contact: false });
  const r = await call('GET', '/api/social/members', { as: orphan.uid });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /not active/);
});

test('GROUP MEMBER COUNTS count only current members, in the browse list and in My groups', async () => {
  reset();
  const me = person('Me'), a = person('A'), b = person('B', { contact: false }), c = person('C', { status: 'expired' });
  const gid = Number(db.prepare("INSERT INTO social_groups (name, type) VALUES ('Everyone', 'custom')").run().lastInsertRowid);
  for (const p of [me, a, b, c]) db.prepare('INSERT INTO social_group_members (group_id, user_id) VALUES (?, ?)').run(gid, p.uid);
  const browse = await call('GET', '/api/social/groups/browse', { as: me.uid });
  assert.equal(Number(browse.json.groups[0].member_count), 2);
  assert.equal(Number(browse.json.groups[0].is_member), 1);
  const mine = await call('GET', '/api/social/groups', { as: me.uid });
  assert.equal(Number(mine.json.groups[0].member_count), 2);
  const admin = await call('GET', '/api/social/admin/groups');
  assert.equal(Number(admin.json.groups[0].member_count), 2);
});

test('DIRECT MESSAGES: you cannot message, list or open someone who is no longer a member', async () => {
  reset();
  const me = person('Me'), ok = person('Ok'), gone = person('Gone');
  assert.equal((await call('POST', '/api/social/messages', { as: me.uid, body: { recipientId: ok.uid, content: 'hi' } })).status, 201);
  db.prepare("INSERT INTO social_messages (sender_id, recipient_id, content) VALUES (?, ?, 'old')").run(gone.uid, me.uid);
  assert.equal((await call('GET', '/api/social/messages/conversations', { as: me.uid })).json.conversations.length, 2);
  db.prepare('DELETE FROM newsletter_contacts WHERE email = ?').run(gone.email);
  const convos = await call('GET', '/api/social/messages/conversations', { as: me.uid });
  assert.deepEqual(convos.json.conversations.map((c) => c.first_name), ['Ok']);
  const send = await call('POST', '/api/social/messages', { as: me.uid, body: { recipientId: gone.uid, content: 'hello?' } });
  assert.equal(send.status, 403);
});

test('PROFILES: a former member\'s profile is not found', async () => {
  reset();
  const me = person('Me'), ok = person('Ok'), gone = person('Gone', { contact: false });
  assert.equal((await call('GET', `/api/social/profile/${ok.uid}`, { as: me.uid })).status, 200);
  assert.equal((await call('GET', `/api/social/profile/${gone.uid}`, { as: me.uid })).status, 404);
});

test('CRM DELETE: a contact that owns a purchase or an invoice is refused, and nothing is deleted', async () => {
  reset();
  const cid = Number(db.prepare("INSERT INTO newsletter_contacts (email, name) VALUES ('buyer@school.test', 'Buyer')").run().lastInsertRowid);
  db.prepare('INSERT INTO purchases (contact_id, license_status) VALUES (?, ?)').run(cid, 'active');
  db.prepare('INSERT INTO purchases (contact_id, license_status) VALUES (?, ?)').run(cid, 'active');
  db.prepare('INSERT INTO invoices (contact_id) VALUES (?)').run(cid);
  const r = await call('DELETE', `/api/newsletter/contacts/${cid}`, { body: {} });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'contact_owns_purchases');
  assert.equal(r.json.purchases, 2); assert.equal(r.json.invoices, 1);
  assert.match(r.json.error, /2 purchases and 1 invoice/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts WHERE id = ?').get(cid).n, 1);
});

test('CRM DELETE: a contact that owns nothing is deleted as before', async () => {
  reset();
  const cid = Number(db.prepare("INSERT INTO newsletter_contacts (email, name) VALUES ('lead@school.test', 'Lead')").run().lastInsertRowid);
  const r = await call('DELETE', `/api/newsletter/contacts/${cid}`, { body: {} });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 0);
  assert.equal((await call('DELETE', `/api/newsletter/contacts/${cid}`, { body: {} })).status, 404);
});
