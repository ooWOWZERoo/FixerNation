// A person who holds both a school license admin assignment and a district admin assignment must show up in the school admin
// lists (they were hidden before), tagged is_district_admin, and the staff concierge page must report whether each admin has
// set up their account (email_verified) so it can show Registered or Pending like the teacher roster.
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
CREATE TABLE site_users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, role TEXT, email_verified INTEGER);
CREATE TABLE purchases (id INTEGER PRIMARY KEY, school_domain TEXT, seat_count INTEGER, payment_status TEXT, license_product_id INTEGER, invoice_id INTEGER, license_status TEXT, po_number TEXT, school_id INTEGER, quote_id INTEGER);
CREATE TABLE license_products (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY, district_id INTEGER);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_number TEXT, status TEXT);
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY, quote_number TEXT, first_name TEXT, last_name TEXT, email TEXT, school TEXT, quoted_school_domain TEXT, quoted_product_name TEXT, quoted_seat_count INTEGER, quoted_amount_cents INTEGER, accepted_at TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY, purchase_id INTEGER, status TEXT, invited_email TEXT);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY, seat_id INTEGER, first_name TEXT, last_name TEXT);
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/NOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const noop = new Proxy({}, { get: () => async () => ({}) });
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  [path.join(SERVER, 'lib/school-admin-assignment.js')]: noop,
  [path.join(SERVER, 'lib/mailer.js')]: noop,
  [path.join(SERVER, 'lib/teacher-invitations.js')]: noop,
  [path.join(SERVER, 'lib/branding-editor.js')]: noop,
  [path.join(SERVER, 'lib/audit.js')]: { audit: async () => {}, AFFILIATE_ENTITY_TYPES: [] },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/admin/school-admins', require(path.join(SERVER, 'routes/admin-school-admins.js')));
app.use('/api/admin/concierge', require(path.join(SERVER, 'routes/admin-concierge.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); }).on('error', reject);
  });
}

// One license (purchase 1) in district 7. Cheryl is both its school admin and the district admin; Sam is only a school admin and has not set up yet.
db.exec(`
INSERT INTO districts VALUES (7, 'Orleans-Niagara');
INSERT INTO schools VALUES (21, 7);
INSERT INTO purchases (id, school_domain, seat_count, payment_status, school_id, quote_id) VALUES (1, 'onboces.example.com', 17, 'pending', 21, 36);
INSERT INTO quote_requests (id, quote_number, first_name, last_name, email) VALUES (36, '307785', 'Cheryl', 'Herman', 'cherman@onboces.example.com');
INSERT INTO site_users VALUES (1, 'Cheryl', 'Herman', 'cherman@onboces.example.com', 'school_license_admin', 1);
INSERT INTO site_users VALUES (2, 'Sam', 'Lee', 'sam@onboces.example.com', 'school_license_admin', 0);
INSERT INTO school_license_admins (id, site_user_id, purchase_id, permission_level) VALUES (10, 1, 1, 'primary'), (11, 2, 1, 'secondary');
INSERT INTO district_license_admins (id, site_user_id, district_id) VALUES (20, 1, 7);
`);

test('SCHOOL ADMINS PAGE lists a district admin who is also a school admin, tagged', async () => {
  const r = await get('/api/admin/school-admins');
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 2);
  const byEmail = Object.fromEntries(r.json.admins.map((a) => [a.email, a]));
  assert.equal(Number(byEmail['cherman@onboces.example.com'].is_district_admin), 1);
  assert.equal(Number(byEmail['sam@onboces.example.com'].is_district_admin), 0);
});

test('SCHOOL ADMINS PAGE: an inactive district assignment does not tag the person', async () => {
  db.exec('UPDATE district_license_admins SET is_active = 0 WHERE id = 20');
  const r = await get('/api/admin/school-admins');
  const cheryl = r.json.admins.find((a) => a.email === 'cherman@onboces.example.com');
  assert.equal(Number(cheryl.is_district_admin), 0);
  assert.equal(r.json.total, 2);
  db.exec('UPDATE district_license_admins SET is_active = 1 WHERE id = 20');
});

test('CONCIERGE returns each admin with email_verified, and the district tag for the school admin', async () => {
  const r = await get('/api/admin/concierge/quotes/36');
  assert.equal(r.status, 200);
  const sa = Object.fromEntries(r.json.schoolAdmins.map((a) => [a.email, a]));
  assert.equal(Number(sa['cherman@onboces.example.com'].email_verified), 1);
  assert.equal(Number(sa['cherman@onboces.example.com'].is_district_admin), 1);
  assert.equal(Number(sa['sam@onboces.example.com'].email_verified), 0);
  assert.equal(Number(sa['sam@onboces.example.com'].is_district_admin), 0);
  assert.equal(r.json.districtAdmins.length, 1);
  assert.equal(Number(r.json.districtAdmins[0].email_verified), 1);
});
