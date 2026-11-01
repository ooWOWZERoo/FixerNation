// Tests for lib/seat-counts.js, the one place seats are counted.
// What must hold: assigned = registered + inactive + pending (a deactivated teacher still holds a seat), revoked and
// 'available' placeholder rows use none, admins never use a seat, available never goes below 0, and the four
// school-admin endpoints (dashboard, org, licenses, reports) all return identical figures for the same school.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, school_domain TEXT, seat_count INTEGER NOT NULL DEFAULT 0, payment_status TEXT DEFAULT 'paid',
  payment_method TEXT, purchased_at TEXT, invoice_id INTEGER, license_product_id INTEGER, contact_id INTEGER, effective_date TEXT, expiration_date TEXT,
  license_status TEXT, notes TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending',
  registered_site_user_id INTEGER, registered_at TEXT, revoked_at TEXT, revocation_reason TEXT, invitation_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, site_user_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, email TEXT);
CREATE TABLE site_user_audiences (site_user_id INTEGER, audience TEXT);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, status TEXT, created_at TEXT, resend_count INTEGER);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, action TEXT, entity_type TEXT, actor_email TEXT, created_at TEXT, reason TEXT);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT, paid_at TEXT, invoice_number TEXT, total_cents INTEGER);
CREATE TABLE license_products (id INTEGER PRIMARY KEY, name TEXT, footer_note TEXT);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, company TEXT, street TEXT, city TEXT, state TEXT, zip TEXT);
`);
const run = async (sql, params = []) => {
  // sqlite has no FOR UPDATE, DATE_SUB or NOW(); the dashboard's "last 7 days" list is not what this file tests
  const s = sql.trim().replace(/\s+FOR UPDATE\s*$/i, '').replace(/DATE_SUB\(NOW\(\), INTERVAL 7 DAY\)/g, "'0000-00-00'");
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const pool = { query: run, async getConnection() { return { query: run, release() {} }; } };

let purchaseId = 0;
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'middleware/schoolAdminAuth.js')]: {
    requireSchoolAdmin: (req, res, next) => { req.schoolAdmin = { purchaseIds: [purchaseId], siteUserId: 1, email: 'a@example.com' }; next(); },
    blockIfReadOnly: () => false,
    blockIfCannotRevoke: () => false,
  },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({}, { get: () => async () => {} }),
  [path.join(SERVER, 'lib/branding.js')]: {},
  [path.join(SERVER, 'lib/branding-editor.js')]: {},
  [path.join(SERVER, 'lib/school-admin-roles.js')]: {},
  [path.join(SERVER, 'lib/teacher-invitations.js')]: {},
  [path.join(SERVER, 'lib/audit.js')]: { audit: async () => {}, AFFILIATE_ENTITY_TYPES: ['affiliate_commission'] },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const { getSeatCounts } = require(path.join(SERVER, 'lib/seat-counts.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/school-admin', require(path.join(SERVER, 'routes/school-admin.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.stack) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

const get = (p) => new Promise((resolve, reject) => {
  http.get({ port, path: p }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject);
});

function license(seatCount, seats = {}) {
  db.exec('DELETE FROM license_seats; DELETE FROM purchases; DELETE FROM school_license_admins; DELETE FROM district_license_admins; DELETE FROM site_users');
  purchaseId = Number(db.prepare(`INSERT INTO purchases (school_domain, seat_count) VALUES ('oak.example.edu', ?)`).run(seatCount).lastInsertRowid);
  for (const [status, n] of Object.entries(seats)) {
    for (let i = 0; i < n; i++) db.prepare('INSERT INTO license_seats (purchase_id, status) VALUES (?, ?)').run(purchaseId, status);
  }
  return purchaseId;
}
// A seat held by a registered user who is also an active school admin (or district admin)
function adminSeat(kind, status = 'registered') {
  const uid = Number(db.prepare(`INSERT INTO site_users (first_name, last_name, email) VALUES ('Ann', 'Admin', ?)`).run(`admin${Date.now()}${Math.random()}@example.com`).lastInsertRowid);
  db.prepare('INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, ?, ?)').run(purchaseId, status, uid);
  if (kind === 'school') db.prepare('INSERT INTO school_license_admins (purchase_id, site_user_id) VALUES (?, ?)').run(purchaseId, uid);
  else db.prepare('INSERT INTO district_license_admins (district_id, site_user_id) VALUES (1, ?)').run(uid);
}

test('ASSIGNED: a deactivated (inactive) teacher still holds a seat', async () => {
  const id = license(20, { registered: 10, inactive: 2, pending: 3 });
  const c = await getSeatCounts(id);
  assert.equal(c.assigned, 15);
  assert.equal(c.available, 5);
  assert.equal(c.pctUsed, 75);
  assert.equal(c.registered + c.inactive + c.pending + c.available, c.total, 'the parts must add up to the total');
});

test('REVOKED and unclaimed placeholders use no seat', async () => {
  const id = license(5, { registered: 1, revoked: 3, available: 4 });
  const c = await getSeatCounts(id);
  assert.equal(c.assigned, 1);
  assert.equal(c.available, 4);
  assert.equal(c.revoked, 3);
});

test('ADMINS never use a seat (school or district admin)', async () => {
  const id = license(5, { registered: 2 });
  adminSeat('school');
  adminSeat('district');
  adminSeat('school', 'inactive');
  const c = await getSeatCounts(id);
  assert.equal(c.assigned, 2, 'only the two ordinary teachers count');
  assert.equal(c.available, 3);
});

test('OVER-ASSIGNED: available stops at 0, the percentage can pass 100', async () => {
  const id = license(2, { registered: 3 });
  const c = await getSeatCounts(id);
  assert.equal(c.available, 0);
  assert.equal(c.pctUsed, 150);
});

test('NO PURCHASE or zero seats: zeros, no divide-by-zero', async () => {
  assert.deepEqual(await getSeatCounts(999999), { total: 0, registered: 0, inactive: 0, pending: 0, revoked: 0, assigned: 0, available: 0, pctUsed: 0 });
});

test('EVERY PAGE AGREES: dashboard, org, licenses and reports return identical seat figures', async () => {
  const id = license(20, { registered: 10, inactive: 2, pending: 3, revoked: 1, available: 4 });
  adminSeat('school');
  const expected = await getSeatCounts(id);
  assert.equal(expected.assigned, 15);

  const dash = (await get(`/api/school-admin/dashboard?purchaseId=${id}`)).licenses;
  const org = (await get(`/api/school-admin/org?purchaseId=${id}`)).utilization;
  const lic = await get(`/api/school-admin/licenses?purchaseId=${id}`);
  const rep = (await get(`/api/school-admin/reports?type=utilization&purchaseId=${id}`)).utilization;

  for (const [name, got] of Object.entries({ dashboard: dash, org, licenses: lic, reports: rep })) {
    for (const key of Object.keys(expected)) {
      assert.equal(got[key], expected[key], `${name}.${key} must equal the shared count`);
    }
  }
});

test('ORG PAGE: the co-administrator list flags the signed-in administrator as "you" and lists the others', async () => {
  const id = license(10, { registered: 1 });
  // the stub session is site user 1
  db.prepare(`INSERT INTO site_users (id, first_name, last_name, email) VALUES (1, 'Sam', 'Carter', 'sam@example.com')`).run();
  db.prepare(`INSERT INTO site_users (id, first_name, last_name, email) VALUES (2, 'Robin', 'Hale', 'robin@example.com')`).run();
  db.prepare(`INSERT INTO school_license_admins (purchase_id, site_user_id, permission_level, is_active) VALUES (?, 1, 'primary', 1)`).run(id);
  db.prepare(`INSERT INTO school_license_admins (purchase_id, site_user_id, permission_level, is_active) VALUES (?, 2, 'read_only', 1)`).run(id);
  const org = await get(`/api/school-admin/org?purchaseId=${id}`);
  const byEmail = Object.fromEntries(org.coAdmins.map((a) => [a.email, Number(a.is_you)]));
  assert.deepEqual(byEmail, { 'sam@example.com': 1, 'robin@example.com': 0 });
});
