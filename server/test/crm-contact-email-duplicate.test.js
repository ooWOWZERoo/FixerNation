// Changing a CRM contact's email to one another contact already has must say so (409, naming the other contact),
// leave both contacts untouched, and a normal edit must still save.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT NOT NULL UNIQUE, phone TEXT, company TEXT, street TEXT, city TEXT, state TEXT, zip TEXT,
  ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT, signup_date TEXT, source TEXT, status TEXT, notes TEXT);
CREATE TABLE contact_groups (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE contact_group_members (contact_id INTEGER, group_id INTEGER);
CREATE TABLE site_users (id INTEGER PRIMARY KEY, email TEXT, email_verified INTEGER, role TEXT);
CREATE TABLE site_user_audiences (site_user_id INTEGER, audience TEXT);
`);
const run = async (sql, rawParams = []) => {
  // mysql2 expands an array parameter (IN (?)); SQLite does not, so do it here.
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p);
    return '?';
  });
  try {
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const r = db.prepare(s).run(...params);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  } catch (e) {
    if (/UNIQUE constraint failed/.test(e.message)) e.code = 'ER_DUP_ENTRY'; // what MariaDB reports
    throw e;
  }
};
const conn = { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run, getConnection: async () => conn },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({}, { get: () => async () => {} }),
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async () => {} },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { attributePurchase: async () => {} },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/newsletter', require(path.join(SERVER, 'routes/newsletter.js')).router);
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function put(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port, method: 'PUT', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); });
    req.on('error', reject); req.write(data); req.end();
  });
}
const add = (name, email) => Number(db.prepare("INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'x', 'Subscribed')").run(name, email).lastInsertRowid);
const emailOf = (id) => db.prepare('SELECT email FROM newsletter_contacts WHERE id = ?').get(id).email;

test('DUPLICATE: renaming a contact to an address another contact has is refused with a message naming that contact', async () => {
  const real = add('Cheryl Herman', 'cherman@onboces.example.com');
  const typo = add('Cheryl Herman', 'ccherman@onboces.example.com');
  const r = await put(`/api/newsletter/contacts/${typo}`, { email: 'cherman@onboces.example.com' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'email_in_use');
  assert.equal(r.json.existingContactId, real);
  assert.match(r.json.error, /cherman@onboces\.example\.com already belongs to Cheryl Herman \(contact #\d+\)/);
  assert.equal(emailOf(typo), 'ccherman@onboces.example.com', 'the contact being edited is unchanged');
  assert.equal(emailOf(real), 'cherman@onboces.example.com', 'the other contact is unchanged');
});

test('DUPLICATE: an address with stray spaces is trimmed before it is compared', async () => {
  const a = add('A One', 'a1@x.example.com');
  const b = add('B Two', 'b2@x.example.com');
  const r = await put(`/api/newsletter/contacts/${b}`, { email: '  a1@x.example.com ' });
  assert.equal(r.status, 409);
  assert.equal(r.json.existingContactId, a);
});

test('A normal edit still saves (new address nobody has)', async () => {
  const id = add('C Three', 'c3@x.example.com');
  const r = await put(`/api/newsletter/contacts/${id}`, { email: 'c3-new@x.example.com', name: 'C Three-Smith' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(emailOf(id), 'c3-new@x.example.com');
});

test('Saving a contact with its own unchanged email is not a duplicate', async () => {
  const id = add('D Four', 'd4@x.example.com');
  const r = await put(`/api/newsletter/contacts/${id}`, { email: 'd4@x.example.com', company: 'Maple' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});
