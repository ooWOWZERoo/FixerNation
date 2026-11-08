// Graduate Evidence routes: the access matrix in docs/reference/pog-evidence-requirements.md, section 5, plus the privacy rules
// (no names, small groups hidden, someone else's id is a 404). Real routes and lib on a real SQL engine (node:sqlite); only the
// four login checks are stubbed, by request header.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 1);
CREATE TABLE curriculum_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, audience TEXT);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, band TEXT, active INTEGER DEFAULT 1);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY, product_type TEXT, school_id INTEGER, school_domain TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, registered_site_user_id INTEGER, status TEXT);
CREATE TABLE site_user_audiences (site_user_id INTEGER, audience TEXT);
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY, state_code TEXT, framework_type TEXT, name TEXT, issuing_body TEXT, official_url TEXT, review_status TEXT, reviewed_at TEXT, district_id INTEGER);
CREATE TABLE standards_items (id INTEGER PRIMARY KEY, framework_id INTEGER, code TEXT, title TEXT, summary TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE standards_alignments (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, target_type TEXT, target_id INTEGER, strength TEXT, rationale TEXT, review_status TEXT);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, teacher_site_user_id INTEGER);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, curriculum_id INTEGER);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, game_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, completed_at TEXT);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_assignment_id INTEGER, completed_at TEXT);
CREATE TABLE brain_game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_id INTEGER, completed_at TEXT, validation_status TEXT DEFAULT 'valid');

INSERT INTO brain_games (id, name, slug, band) VALUES (1, 'Perspective Swap', 'perspective-swap', 'advance');
INSERT INTO districts (id, name) VALUES (1, 'District One'), (2, 'District Two');
INSERT INTO schools (id, domain, district_id, display_name) VALUES (1, 'one.example.org', 1, 'One Elementary'), (2, 'two.example.org', 1, 'Two Middle'), (3, 'three.example.org', 2, 'Three High');
INSERT INTO purchases (id, product_type, school_id, school_domain) VALUES (100, 'group_license', 1, 'one.example.org'), (200, 'group_license', 2, 'two.example.org'), (300, 'group_license', 3, 'three.example.org');
INSERT INTO standards_frameworks VALUES (1, 'NY', 'sel_standards', 'NY SEL', 'NYSED', 'https://example.org/sel', 'verified', '2026-11-01 00:00:00', NULL);
INSERT INTO standards_items (id, framework_id, code, title, sort_order) VALUES (1, 1, '2A', 'Empathy', 1), (2, 1, '1B', 'Identity', 2);
INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (1, 'brain_game', 1, 'direct', 'Because.', 'verified');
-- Teachers: 11 teaches in school 1 (14 students), 12 teaches in school 1 (3 students), 13 teaches in school 2 (4 students), 14 in district 2 school 3 (12 students).
INSERT INTO license_seats (purchase_id, registered_site_user_id, status) VALUES (100, 11, 'registered'), (100, 12, 'registered'), (200, 13, 'registered'), (300, 14, 'registered');
INSERT INTO classrooms (id, teacher_site_user_id) VALUES (1, 11), (2, 12), (3, 13), (4, 14);
INSERT INTO site_user_audiences VALUES (11, 'High School');
`);
let sid = 1;
const kids = (classroomId, n, practiced) => { for (let i = 0; i < n; i++, sid++) {
  db.prepare('INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (?, ?, ?)').run(sid, classroomId, `Secret Name ${sid}`);
  if (i < practiced) db.prepare("INSERT INTO brain_game_sessions (student_id, game_id, completed_at) VALUES (?, 1, ?)").run(sid, new Date().toISOString().slice(0, 19).replace('T', ' '));
} };
kids(1, 14, 6); kids(2, 3, 1); kids(3, 4, 4); kids(4, 12, 3);

let settings = {};
const run = async (sql, params = []) => [db.prepare(sql.trim()).all(...params)];
const header = (req, name) => req.headers[name];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'routes/site-auth.js')]: { requireSiteAuth: (req, res, next) => (header(req, 'x-teacher') ? ((req.siteUser = { id: Number(header(req, 'x-teacher')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => (header(req, 'x-staff') ? next() : res.status(401).json({ error: 'Not authenticated' })), getAuthUser: () => null },
  [path.join(SERVER, 'middleware/schoolAdminAuth.js')]: { requireSchoolAdmin: (req, res, next) => (header(req, 'x-school-admin') ? ((req.schoolAdmin = { purchaseIds: JSON.parse(header(req, 'x-school-admin')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
  [path.join(SERVER, 'middleware/districtAdminAuth.js')]: { requireDistrictAdmin: (req, res, next) => (header(req, 'x-district-admin') ? ((req.districtAdmin = { districtIds: JSON.parse(header(req, 'x-district-admin')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
  [path.join(SERVER, 'lib/access.js')]: { hasActiveLicense: async (id) => id !== 99 },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async (k) => (k in settings ? settings[k] : null) },
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
app.use('/api/graduate-evidence', require(path.join(SERVER, 'routes/pog-evidence.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());
const get = (url, headers = {}) => new Promise((resolve, reject) => {
  http.get({ port, path: url, headers }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {}, raw: b })); }).on('error', reject);
});
const item = (json, code) => json.frameworks.flatMap((f) => f.items).find((i) => i.code === code);

test('TEACHER: sees their own classroom with counts and a suggested next step; no student name anywhere', async () => {
  const r = await get('/api/graduate-evidence/classroom/1', { 'x-teacher': '11' });
  assert.equal(r.status, 200);
  assert.equal(r.json.students, 14);
  assert.equal(item(r.json, '2A').practiced, 6);
  assert.equal(item(r.json, '1B').status, 'no_connection');
  assert.equal(item(r.json, '2A').suggestions[0].title, 'Perspective Swap', 'a verified direct game for a high-school teacher');
  assert.equal(r.json.years.length, 2);
  assert.ok(!r.raw.includes('Secret Name'));
});
test('TEACHER: another teacher\'s classroom is a 404, a teacher without a license is a 403, no login is a 401', async () => {
  assert.equal((await get('/api/graduate-evidence/classroom/2', { 'x-teacher': '11' })).status, 404);
  assert.equal((await get('/api/graduate-evidence/classroom/999', { 'x-teacher': '11' })).status, 404);
  assert.equal((await get('/api/graduate-evidence/classroom/abc', { 'x-teacher': '11' })).status, 404);
  db.exec("INSERT OR IGNORE INTO classrooms (id, teacher_site_user_id) VALUES (50, 99)");
  assert.equal((await get('/api/graduate-evidence/classroom/50', { 'x-teacher': '99' })).status, 403);
  assert.equal((await get('/api/graduate-evidence/classroom/1')).status, 401);
});
test('A bad year is refused, not silently replaced', async () => {
  const h = { 'x-teacher': '11' };
  assert.equal((await get('/api/graduate-evidence/classroom/1?year=banana', h)).status, 400);
  assert.equal((await get('/api/graduate-evidence/classroom/1?year=2999', h)).status, 400);
  assert.equal((await get('/api/graduate-evidence/classroom/1?year=1999', h)).status, 400);
});

test('SCHOOL ADMIN: own school only; classrooms are labelled neutrally and small ones are merged', async () => {
  const r = await get('/api/graduate-evidence/school?purchaseId=100', { 'x-school-admin': '[100]' });
  assert.equal(r.status, 200);
  assert.equal(r.json.suppressed, false);
  assert.equal(r.json.students, 17);
  assert.ok(r.json.groups.every((g) => g.students >= 10), 'the 3-student classroom is folded into the 14-student one');
  assert.equal(r.json.groups.length, 1);
  assert.equal(item(r.json, '2A').practiced, 7, '6 + 1 across both classrooms');
  assert.ok(!r.raw.includes('Secret Name'));
});
test('SCHOOL ADMIN: another school\'s purchase is a 404; the default is their own first purchase; no login is a 401', async () => {
  assert.equal((await get('/api/graduate-evidence/school?purchaseId=200', { 'x-school-admin': '[100]' })).status, 404);
  assert.equal((await get('/api/graduate-evidence/school?purchaseId=abc', { 'x-school-admin': '[100]' })).status, 404);
  const d = await get('/api/graduate-evidence/school', { 'x-school-admin': '[100]' });
  assert.equal(d.json.purchaseId, 100);
  assert.equal((await get('/api/graduate-evidence/school?purchaseId=100')).status, 401);
});
test('SCHOOL ADMIN: a school under the minimum gets no figures at all', async () => {
  const r = await get('/api/graduate-evidence/school?purchaseId=200', { 'x-school-admin': '[200]' });   // 4 students
  assert.equal(r.status, 200);
  assert.equal(r.json.suppressed, true);
  assert.equal(item(r.json, '2A').practiced, undefined);
  assert.equal(item(r.json, '2A').students, undefined);
  assert.equal(r.json.groups, undefined);
});

test('DISTRICT ADMIN: own district, one group per school, small schools merged; another district is a 404', async () => {
  const r = await get('/api/graduate-evidence/district?districtId=1', { 'x-district-admin': '[1]' });
  assert.equal(r.status, 200);
  assert.equal(r.json.students, 21, '14 + 3 in school one, 4 in school two');
  assert.ok(r.json.groups.every((g) => g.students >= 10));
  assert.ok(!r.raw.includes('Three High'), 'another district\'s school never appears');
  assert.equal((await get('/api/graduate-evidence/district?districtId=2', { 'x-district-admin': '[1]' })).status, 404);
  assert.equal((await get('/api/graduate-evidence/district', { 'x-district-admin': '[2]' })).json.districtId, 2);
  assert.equal((await get('/api/graduate-evidence/district?districtId=1')).status, 401);
});

test('The minimum is a setting but can never be switched off', async () => {
  settings = { pog_evidence_min_group: '1' };
  const r = await get('/api/graduate-evidence/school?purchaseId=200', { 'x-school-admin': '[200]' });
  assert.equal(r.json.minGroup, 5, 'a setting of 1 is raised to 5');
  assert.equal(r.json.suppressed, true, '4 students is still under 5');
  settings = { pog_evidence_min_group: '3000' };
  assert.equal((await get('/api/graduate-evidence/school?purchaseId=200', { 'x-school-admin': '[200]' })).json.minGroup, 100);
  settings = {};
});

test('STAFF: any classroom, school or district; the same small-group rule; others get 401', async () => {
  const s = { 'x-staff': '1' };
  assert.equal((await get('/api/graduate-evidence/staff/classroom/2', s)).status, 200);
  assert.equal((await get('/api/graduate-evidence/staff/classroom/777', s)).status, 404);
  assert.equal((await get('/api/graduate-evidence/staff/school/300', s)).json.students, 12);
  assert.equal((await get('/api/graduate-evidence/staff/school/200', s)).json.suppressed, true);
  assert.equal((await get('/api/graduate-evidence/staff/district/2', s)).status, 200);
  assert.equal((await get('/api/graduate-evidence/staff/district/55', s)).status, 404);
  for (const p of ['classroom/1', 'school/100', 'district/1']) {
    assert.equal((await get(`/api/graduate-evidence/staff/${p}`)).status, 401, 'anonymous');
    assert.equal((await get(`/api/graduate-evidence/staff/${p}`, { 'x-teacher': '11' })).status, 401, 'a teacher is not staff');
    assert.equal((await get(`/api/graduate-evidence/staff/${p}`, { 'x-school-admin': '[100]' })).status, 401, 'a school admin is not staff');
  }
});

test('Nobody without a login of the right kind reaches any view (students and parents have no login that passes these checks)', async () => {
  for (const p of ['classroom/1', 'school', 'district']) assert.equal((await get(`/api/graduate-evidence/${p}`)).status, 401);
  assert.equal((await get('/api/graduate-evidence/school?purchaseId=100', { 'x-teacher': '11' })).status, 401, 'a teacher is not a school admin');
  assert.equal((await get('/api/graduate-evidence/district?districtId=1', { 'x-school-admin': '[100]' })).status, 401, 'a school admin is not a district admin');
});
