// Tests for the district dashboard (lib/district-dashboard.js, GET /api/district-admin/dashboard).
// What must hold: the numbers match the school-admin pages (shared seat and licence rules), another district's
// schools never appear, nothing identifies a teacher, the attention lists use the agreed thresholds, and
// the Portrait of a Graduate tile counts only published frameworks.
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
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, product_type TEXT DEFAULT 'group_license', school_domain TEXT, school_id INTEGER, seat_count INTEGER DEFAULT 0,
  payment_status TEXT, payment_method TEXT, license_status TEXT, expiration_date TEXT, effective_date TEXT, purchased_at TEXT, license_product_id INTEGER);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE license_products (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
`);
const pool = { async query(sql, params = []) {
  const s = sql.trim();
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
} };

let portraitFixture = [];
let districtIds = [1];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'middleware/districtAdminAuth.js')]: { requireDistrictAdmin: (req, res, next) => { req.districtAdmin = { districtIds, siteUserId: 1, email: 'd@example.com' }; next(); } },
  [path.join(SERVER, 'lib/branding-editor.js')]: {},
  [path.join(SERVER, 'lib/school-admin-assignment.js')]: {},
  [path.join(SERVER, 'lib/district-standards.js')]: { listOwn: async (ids, id) => ({ districtId: id, frameworks: portraitFixture }) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const { buildDashboard } = require(path.join(SERVER, 'lib/district-dashboard.js'));
const app = express();
app.use(express.json());
app.use('/api/district-admin', require(path.join(SERVER, 'routes/district-admin.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.stack) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());
const get = (p) => new Promise((resolve, reject) => { http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b), raw: b })); }).on('error', reject); });

const dayStr = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
function school(domain, district, name) { return Number(db.prepare('INSERT INTO schools (domain, district_id, display_name) VALUES (?, ?, ?)').run(domain, district, name).lastInsertRowid); }
function purchase(schoolId, domain, o) {
  return Number(db.prepare(`INSERT INTO purchases (school_domain, school_id, seat_count, payment_status, payment_method, license_status, expiration_date, effective_date, purchased_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(domain, schoolId, o.seats, o.payment || 'paid', o.method || 'card', o.status || 'active', o.expires || dayStr(300), o.started || dayStr(-200), o.started || dayStr(-200)).lastInsertRowid);
}
function seats(pid, status, n) { for (let i = 0; i < n; i++) db.prepare('INSERT INTO license_seats (purchase_id, status) VALUES (?, ?)').run(pid, status); }
function admin(pid, userId) { db.prepare('INSERT INTO school_license_admins (purchase_id, site_user_id) VALUES (?, ?)').run(pid, userId); }

function seed() {
  db.exec('DELETE FROM purchases; DELETE FROM schools; DELETE FROM license_seats; DELETE FROM school_license_admins; DELETE FROM district_license_admins');
  const a = school('oak.example.edu', 1, 'Oak Elementary');
  const b = school('birch.example.edu', 1, 'Birch Middle');
  const c = school('cedar.example.edu', 1, 'Cedar High');
  const d = school('dune.example.edu', 1, 'Dune Academy');
  const other = school('far.example.edu', 2, 'Far Away School');
  // Oak: 20 seats, 10 registered + 2 inactive + 3 pending = 15 assigned (75%), ends in 30 days, one admin; one admin holds a seat (not counted)
  const pa = purchase(a, 'oak.example.edu', { seats: 20, expires: dayStr(30) }); seats(pa, 'registered', 10); seats(pa, 'inactive', 2); seats(pa, 'pending', 3); seats(pa, 'revoked', 1); admin(pa, 101);
  db.prepare('INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, ?, 101)').run(pa, 'registered');
  // Birch: PO not received (pending licence), no seats
  const pb = purchase(b, 'birch.example.edu', { seats: 30, payment: 'pending', method: 'po', status: 'pending' }); admin(pb, 102);
  // Cedar: 10 seats, 1 pending (10%), started 100 days ago, NO administrator
  const pc = purchase(c, 'cedar.example.edu', { seats: 10, started: dayStr(-100) }); seats(pc, 'pending', 1);
  // Dune: 10 seats, 9 registered (90%), one admin
  const pd = purchase(d, 'dune.example.edu', { seats: 10 }); seats(pd, 'registered', 9); admin(pd, 103);
  // another district
  const po = purchase(other, 'far.example.edu', { seats: 99 }); seats(po, 'registered', 50); admin(po, 104);
  return { pa, pb, pc, pd, po };
}

test('NUMBERS: totals use the shared seat rule, only licences in force count, and admins holding a seat are excluded', async () => {
  seed();
  const { status, json } = await get('/api/district-admin/dashboard?districtId=1');
  assert.equal(status, 200);
  assert.equal(json.stats.schools, 4);
  assert.equal(json.stats.seatsTotal, 40, 'Oak 20 + Cedar 10 + Dune 10; Birch is waiting for its purchase order');
  assert.equal(json.stats.seatsAssigned, 25, '15 + 1 + 9');
  assert.equal(json.stats.activeTeachers, 19, '10 + 0 + 9; the admin holding a seat is not counted');
  assert.equal(json.stats.pctUsed, 63);
  assert.equal(json.stats.schoolAdmins, 3, 'Oak, Birch and Dune each have one');
  const oak = json.schools.find((s) => s.domain === 'oak.example.edu');
  assert.deepEqual(oak.seats, { total: 20, assigned: 15, pctUsed: 75 });
});

test('ATTENTION: expiring within 90 days, waiting on a PO, no administrator, few seats used, nearly full', async () => {
  seed();
  const { json } = await get('/api/district-admin/dashboard?districtId=1');
  const names = (list) => list.map((x) => x.school).sort();
  assert.deepEqual(names(json.attention.expiring), ['Oak Elementary']);
  assert.equal(json.attention.expiring[0].daysLeft, 30);
  assert.deepEqual(names(json.attention.awaitingPO), ['Birch Middle']);
  assert.deepEqual(names(json.attention.noAdmin), ['Cedar High']);
  assert.deepEqual(names(json.attention.lowAdoption), ['Cedar High'], '10 percent used, 100 days after it started');
  assert.deepEqual(names(json.attention.nearlyFull), ['Dune Academy']);
});

test('LOW ADOPTION waits 60 days: a school that started last week is not flagged', () => {
  const rows = [{ purchase_id: 1, school_id: 1, school_domain: 'new.example.edu', seat_count: 10, payment_status: 'paid', payment_method: 'card', license_status: 'active', expiration_date: dayStr(300), effective_date: dayStr(-7), purchased_at: dayStr(-7) }];
  const counts = new Map([[1, { total: 10, registered: 0, inactive: 0, pending: 0, revoked: 0, assigned: 0, available: 10, pctUsed: 0 }]]);
  const out = buildDashboard({ rows, counts, adminsByPurchase: new Map([[1, new Set([5])]]) });
  assert.equal(out.attention.lowAdoption.length, 0);
});

test('SCOPE: another district never appears, and asking for it is refused', async () => {
  seed();
  const mine = await get('/api/district-admin/dashboard?districtId=1');
  assert.ok(!mine.raw.includes('Far Away'), 'no school from district 2');
  assert.ok(!mine.raw.includes('far.example.edu'));
  const refused = await get('/api/district-admin/dashboard?districtId=2');
  assert.equal(refused.status, 403);
  districtIds = [2];
  const theirs = await get('/api/district-admin/dashboard?districtId=2');
  assert.equal(theirs.json.stats.schools, 1);
  assert.ok(!theirs.raw.includes('Oak Elementary'));
  districtIds = [1];
});

test('PRIVACY: nothing in the response identifies a person', async () => {
  seed();
  db.exec("CREATE TABLE IF NOT EXISTS site_users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT)");
  const { raw } = await get('/api/district-admin/dashboard?districtId=1');
  assert.ok(!/@/.test(raw), 'no email addresses');
  assert.ok(!/first_name|last_name|email|site_user/i.test(raw), 'no person fields');
});

test('PORTRAIT TILE: counts only published Portrait of a Graduate frameworks and their verified connections', async () => {
  seed();
  portraitFixture = [
    { type: 'portrait_of_graduate', status: 'published', items: [{ alignments: [{ status: 'verified' }] }, { alignments: [{ status: 'in_review' }] }, { alignments: [] }] },
    { type: 'portrait_of_graduate', status: 'in_review', items: [{ alignments: [{ status: 'verified' }] }] },
    { type: 'sel_standards', status: 'published', items: [{ alignments: [{ status: 'verified' }] }] },
  ];
  const { json } = await get('/api/district-admin/dashboard?districtId=1');
  assert.deepEqual(json.portrait, { frameworks: 2, published: 1, inReview: 1, draft: 0, attributes: 3, attributesWithVerifiedConnection: 1 });
  portraitFixture = [];
  const empty = await get('/api/district-admin/dashboard?districtId=1');
  assert.equal(empty.json.portrait.frameworks, 0);
});

test('EMPTY DISTRICT: no licensed schools gives zeros and empty lists, not an error', async () => {
  db.exec('DELETE FROM purchases; DELETE FROM schools; DELETE FROM license_seats; DELETE FROM school_license_admins');
  const { status, json } = await get('/api/district-admin/dashboard?districtId=1');
  assert.equal(status, 200);
  assert.equal(json.stats.schools, 0);
  assert.equal(json.schools.length, 0);
  assert.equal(json.attention.expiring.length, 0);
});
