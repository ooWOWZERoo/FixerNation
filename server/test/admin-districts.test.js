// Tests for adding/removing a school in a district (routes/admin-districts.js, FNE admin).
// What must hold: adding a school creates its schools row if it has none, points EVERY purchase for that
// domain at it (the concierge flow and branding key on purchases.school_id), leaves license admins and
// teacher seats attached to their purchases, reports what got linked, never moves a school out of
// another district, and keeps the sales-demo school and district apart.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email_verified INTEGER DEFAULT 1, session_invalidated_at TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, email TEXT, email_verified INTEGER DEFAULT 1);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL UNIQUE, district_id INTEGER REFERENCES districts(id) ON DELETE SET NULL, display_name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, product_type TEXT NOT NULL DEFAULT 'group_license', school_domain TEXT, school_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL, purchase_id INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL, district_id INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT);
`);
const pool = { async query(sql, params = []) {
  const s = sql.trim();
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
} };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'lib/mailer.js')]: { sendDistrictAdminWelcomeEmail: async () => {}, sendSalesAlertEmail: async () => {} },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => 'ops@example.com' },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signSession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const { DEMO_DISTRICT_NAME, DEMO_SCHOOL_DOMAIN } = require(path.join(SERVER, 'lib/sales-demo.js'));
const app = express();
app.use(express.json(), cookieParser());
app.use('/api/admin/districts', require(path.join(SERVER, 'routes/admin-districts.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

const adminCookie = () => 'fn_session=' + signSession('admin', { userId: 1, username: 'admin' }, '1h');
function call(method, url, { body, cookie = adminCookie() } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port, method, path: '/api/admin/districts' + url,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let json = null; try { json = b ? JSON.parse(b) : null; } catch { /* html */ } resolve({ status: res.statusCode, json }); }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const add = (districtId, body) => call('PUT', `/${districtId}/schools`, { body: { assign: true, ...body } });

let D1, D2, DEMO;
function reset() {
  db.exec('DELETE FROM license_seats; DELETE FROM school_license_admins; DELETE FROM purchases; DELETE FROM schools; DELETE FROM district_license_admins; DELETE FROM districts; DELETE FROM site_users; DELETE FROM admin_users;');
  db.exec(`INSERT INTO admin_users (id, username) VALUES (1, 'admin')`);
  db.exec(`INSERT INTO site_users (id, first_name, last_name, email) VALUES (21,'A','One','a@x.example.com'),(22,'B','Two','b@x.example.com'),(23,'C','Three','c@x.example.com')`);
  D1 = Number(db.prepare(`INSERT INTO districts (name) VALUES ('North District')`).run().lastInsertRowid);
  D2 = Number(db.prepare(`INSERT INTO districts (name) VALUES ('South District')`).run().lastInsertRowid);
  DEMO = Number(db.prepare(`INSERT INTO districts (name) VALUES (?)`).run(DEMO_DISTRICT_NAME).lastInsertRowid);
}
const purchase = (domain, schoolId = null, type = 'group_license') => Number(db.prepare(`INSERT INTO purchases (product_type, school_domain, school_id) VALUES (?, ?, ?)`).run(type, domain, schoolId).lastInsertRowid);
const q = (sql, ...p) => db.prepare(sql).all(...p);

// ====================================================================================
test('ACCESS: only an FNE admin session can add or remove schools', async () => {
  reset();
  assert.equal((await call('PUT', `/${D1}/schools`, { body: { assign: true, domain: 'x.edu' }, cookie: null })).status, 401);
  assert.equal((await call('GET', `/${D1}/available-schools`, { cookie: null })).status, 401);
  const siteCookie = 'fn_user_session=' + signSession('site', { userId: 21, role: 'teacher' }, '1h');
  assert.equal((await call('PUT', `/${D1}/schools`, { body: { assign: true, domain: 'x.edu' }, cookie: siteCookie })).status, 401);
});

test('ADD by domain: a licensed school with no school record can be picked, gets one, and every purchase is linked', async () => {
  reset();
  const p1 = purchase('Oak.Example.edu'), p2 = purchase('oak.example.edu '), other = purchase('elm.example.edu');
  const avail = (await call('GET', `/${D1}/available-schools`)).json;
  assert.deepEqual(avail.schools, []);
  assert.deepEqual(avail.unlinked.map(u => [u.domain, u.licenses]), [['elm.example.edu', 1], ['oak.example.edu', 2]], 'both licensed domains are offered, case-insensitively');

  // seats, admins and teachers hang off the purchases
  db.exec(`INSERT INTO school_license_admins (site_user_id, purchase_id, is_active) VALUES (21, ${p1}, 1), (21, ${p2}, 1), (22, ${p2}, 1), (23, ${p1}, 0)`);
  db.exec(`INSERT INTO license_seats (purchase_id, status) VALUES (${p1}, 'registered'), (${p1}, 'registered'), (${p2}, 'registered'), (${p2}, 'pending'), (${p2}, 'revoked')`);

  const r = await add(D1, { domain: 'Oak.Example.edu' });
  assert.equal(r.status, 200);
  assert.equal(r.json.createdSchoolRecord, true);
  assert.equal(r.json.newlyLinkedPurchases, 2);
  assert.deepEqual(r.json.linkage, { licenses: 2, schoolAdmins: 2, teachers: 3 }, 'distinct active school admins; registered teachers only');

  const school = q(`SELECT * FROM schools WHERE LOWER(domain) = 'oak.example.edu'`);
  assert.equal(school.length, 1); assert.equal(school[0].district_id, D1);
  assert.deepEqual(q('SELECT school_id FROM purchases WHERE id IN (?, ?)', p1, p2).map(x => x.school_id), [school[0].id, school[0].id]);
  assert.equal(q('SELECT school_id FROM purchases WHERE id = ?', other)[0].school_id, null, 'another domain is untouched');
  assert.equal(q('SELECT COUNT(*) AS n FROM school_license_admins').at(0).n, 4, 'license admins stay attached');
  assert.equal(q('SELECT COUNT(*) AS n FROM license_seats').at(0).n, 5, 'seats stay attached');

  // it no longer shows as unlinked, and re-adding is harmless
  assert.deepEqual((await call('GET', `/${D1}/available-schools`)).json.unlinked.map(u => u.domain), ['elm.example.edu']);
  const again = await add(D1, { domain: 'oak.example.edu' });
  assert.equal(again.status, 200); assert.equal(again.json.createdSchoolRecord, false); assert.equal(again.json.newlyLinkedPurchases, 0);
  assert.equal(q('SELECT COUNT(*) AS n FROM schools').at(0).n, 1);

  // the district page now reports the same numbers
  const detail = (await call('GET', `/${D1}`)).json;
  assert.deepEqual(detail.schools.map(s => [s.domain, s.linkage]), [['oak.example.edu', { licenses: 2, schoolAdmins: 2, teachers: 3 }]]);
});

test('ADD by id: an existing school record whose purchases never got a school_id is repaired', async () => {
  reset();
  const sid = Number(db.prepare(`INSERT INTO schools (domain) VALUES ('pine.example.edu')`).run().lastInsertRowid);
  const legacy = purchase('pine.example.edu', null), fine = purchase('pine.example.edu', sid), nonLicense = purchase('pine.example.edu', null, 'individual');
  const avail = (await call('GET', `/${D1}/available-schools`)).json;
  assert.deepEqual(avail.schools.map(s => s.domain), ['pine.example.edu']); assert.deepEqual(avail.unlinked, []);
  const r = await add(D1, { schoolId: sid });
  assert.equal(r.status, 200); assert.equal(r.json.createdSchoolRecord, false);
  assert.equal(q('SELECT school_id FROM purchases WHERE id = ?', legacy)[0].school_id, sid);
  assert.equal(r.json.linkage.licenses, 2, 'group licenses only');
  assert.equal(q('SELECT district_id FROM schools WHERE id = ?', sid)[0].district_id, D1);
  assert.ok(fine && nonLicense);
});

test('CONFLICT: a school in another district is never moved, and nothing else changes', async () => {
  reset();
  const sid = Number(db.prepare(`INSERT INTO schools (domain, district_id) VALUES ('maple.example.edu', ?)`).run(D2).lastInsertRowid);
  const p = purchase('maple.example.edu', null);
  for (const body of [{ schoolId: sid }, { domain: 'maple.example.edu' }]) {
    const r = await add(D1, body);
    assert.equal(r.status, 409, JSON.stringify(body));
  }
  assert.equal(q('SELECT district_id FROM schools WHERE id = ?', sid)[0].district_id, D2);
  assert.equal(q('SELECT school_id FROM purchases WHERE id = ?', p)[0].school_id, null, 'no partial linking on a refused add');
});

test('DEMO: the demo school and the demo district stay together and apart from real ones', async () => {
  reset();
  const demoSchool = Number(db.prepare(`INSERT INTO schools (domain) VALUES (?)`).run(DEMO_SCHOOL_DOMAIN).lastInsertRowid);
  const realSchool = Number(db.prepare(`INSERT INTO schools (domain) VALUES ('real.example.edu')`).run().lastInsertRowid);
  purchase(DEMO_SCHOOL_DOMAIN, null); purchase('unmade.example.edu', null);
  assert.equal((await add(D1, { schoolId: demoSchool })).status, 409, 'demo school into a real district');
  assert.equal((await add(D1, { domain: DEMO_SCHOOL_DOMAIN })).status, 409, '... by domain');
  assert.equal((await add(DEMO, { schoolId: realSchool })).status, 409, 'real school into the demo district');
  assert.equal((await add(DEMO, { domain: 'unmade.example.edu' })).status, 409, 'real licensed domain into the demo district');
  assert.equal(q(`SELECT COUNT(*) AS n FROM schools WHERE domain = 'unmade.example.edu'`)[0].n, 0, 'a refused add creates no school record');
  assert.equal((await add(DEMO, { schoolId: demoSchool })).status, 200, 'demo school into the demo district is fine');
});

test('VALIDATION: bad input is refused and creates nothing', async () => {
  reset();
  purchase('real.example.edu');
  assert.equal((await add(D1, {})).status, 400);
  assert.equal((await add(D1, { schoolId: 'abc' })).status, 400);
  assert.equal((await add(D1, { schoolId: -3 })).status, 400);
  assert.equal((await add(D1, { schoolId: 99999 })).status, 404);
  assert.equal((await add(D1, { domain: 'typo.example.edu' })).status, 404, 'a domain with no group license');
  assert.equal((await add(99999, { domain: 'real.example.edu' })).status, 404, 'unknown district');
  assert.equal((await call('PUT', `/${D1}/schools`, { body: { assign: false } })).status, 400);
  assert.equal(q('SELECT COUNT(*) AS n FROM schools').at(0).n, 0, 'none of that created a school');
});

test('REMOVE: takes the school out of the district and leaves its licenses, admins and teachers alone', async () => {
  reset();
  const p = purchase('birch.example.edu');
  db.exec(`INSERT INTO school_license_admins (site_user_id, purchase_id) VALUES (21, ${p})`);
  db.exec(`INSERT INTO license_seats (purchase_id, status) VALUES (${p}, 'registered')`);
  const sid = (await add(D1, { domain: 'birch.example.edu' })).json.school.id;
  assert.equal((await call('PUT', `/${D2}/schools`, { body: { schoolId: sid, assign: false } })).status, 200);
  assert.equal(q('SELECT district_id FROM schools WHERE id = ?', sid)[0].district_id, D1, 'another district cannot remove it');
  assert.equal((await call('PUT', `/${D1}/schools`, { body: { schoolId: sid, assign: false } })).status, 200);
  assert.equal(q('SELECT district_id FROM schools WHERE id = ?', sid)[0].district_id, null);
  assert.equal(q('SELECT school_id FROM purchases WHERE id = ?', p)[0].school_id, sid, 'still linked to its school record');
  assert.equal(q('SELECT COUNT(*) AS n FROM school_license_admins').at(0).n, 1);
  assert.equal(q('SELECT COUNT(*) AS n FROM license_seats').at(0).n, 1);
  // and it can be added again
  assert.equal((await add(D2, { schoolId: sid })).status, 200);
});

// ---- a school added before any license exists ---------------------------------------------
const addEmpty = (districtId, domain, extra = {}) => add(districtId, { domain, allowUnlicensed: true, ...extra });

test('NO LICENSE YET: a school can be added by domain, only on request, and it links nothing it does not have', async () => {
  reset();
  const other = purchase('elsewhere.example.edu');
  assert.equal((await add(D1, { domain: 'cedar.example.edu' })).status, 404, 'without the explicit flag an unlicensed domain is still refused');
  const r = await addEmpty(D1, ' @Cedar.Example.EDU ');
  assert.equal(r.status, 200);
  assert.equal(r.json.createdSchoolRecord, true); assert.equal(r.json.newlyLinkedPurchases, 0);
  assert.deepEqual(r.json.linkage, { licenses: 0, schoolAdmins: 0, teachers: 0 });
  const row = q(`SELECT * FROM schools WHERE domain = 'cedar.example.edu'`);
  assert.equal(row.length, 1, 'stored normalized, so a later purchase finds this exact row'); assert.equal(row[0].district_id, D1);
  assert.equal(q('SELECT school_id FROM purchases WHERE id = ?', other)[0].school_id, null, 'other schools untouched');
  const detail = (await call('GET', `/${D1}`)).json;
  assert.deepEqual(detail.schools.map(s => [s.domain, s.linkage.licenses]), [['cedar.example.edu', 0]]);
  // once a license exists for the domain, re-adding (or the purchase flow) links it
  const p = purchase('cedar.example.edu', null);
  const again = await add(D1, { schoolId: row[0].id });
  assert.equal(again.json.newlyLinkedPurchases, 1); assert.equal(q('SELECT school_id FROM purchases WHERE id = ?', p)[0].school_id, row[0].id);
  assert.equal((await addEmpty(D1, 'cedar.example.edu')).status, 200, 'adding the same school twice is harmless');
  assert.equal(q('SELECT COUNT(*) AS n FROM schools').at(0).n, 1);
});

test('NO LICENSE YET: malformed domains are refused and create nothing', async () => {
  reset();
  for (const bad of ['http://oak.example.edu', 'oak', 'oak edu', 'oak.example.edu/path', 'oak..edu', '-oak.edu', 'oak.e', 'a@b.edu']) {
    const r = await addEmpty(D1, bad);
    assert.equal(r.status, 400, bad);
  }
  assert.equal(q('SELECT COUNT(*) AS n FROM schools').at(0).n, 0);
});

test('NO LICENSE YET: a domain close to one we already know needs confirmation (typo guard)', async () => {
  reset();
  db.exec(`INSERT INTO schools (domain, district_id) VALUES ('oak.example.edu', ${D2})`);
  purchase('birch.example.edu');
  const typo = await addEmpty(D1, 'oak.exampel.edu');
  assert.equal(typo.status, 409); assert.equal(typo.json.needsConfirm, true); assert.deepEqual(typo.json.similar, ['oak.example.edu']);
  assert.equal(q(`SELECT COUNT(*) AS n FROM schools WHERE domain = 'oak.exampel.edu'`)[0].n, 0, 'nothing created while unconfirmed');
  assert.equal((await addEmpty(D1, 'birch.exampl.edu')).status, 409, 'licensed domains count, even without a school record');
  assert.equal((await addEmpty(D1, 'oak.exampel.edu', { confirmSimilar: true })).status, 200, 'confirmed');
  assert.equal((await addEmpty(D1, 'totally-different.org')).status, 200, 'unrelated domains need no confirmation');
  // an exact existing school is not a typo of itself; it belongs to another district, so it is refused, not warned about
  assert.equal((await addEmpty(D1, 'oak.example.edu')).status, 409);
  assert.equal(q(`SELECT district_id AS d FROM schools WHERE domain = 'oak.example.edu'`)[0].d, D2);
});

test('NO LICENSE YET: the demo school and demo district still stay apart', async () => {
  reset();
  assert.equal((await addEmpty(D1, DEMO_SCHOOL_DOMAIN)).status, 409);
  assert.equal((await addEmpty(DEMO, 'real-new.example.edu', { confirmSimilar: true })).status, 409);
  assert.equal(q('SELECT COUNT(*) AS n FROM schools').at(0).n, 0, 'refused adds create no school record');
});
