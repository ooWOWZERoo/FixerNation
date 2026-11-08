// District Program Use Report (docs/reference/district-program-report-requirements.md): the counting rules, the small-group rules, the
// scoping to a district, the privacy of what the route returns, and the staff settings. Runs the real lib/program-use.js and
// routes/program-report.js on a real SQL engine (node:sqlite).
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
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY, display_name TEXT, domain TEXT, district_id INTEGER);
CREATE TABLE purchases (id INTEGER PRIMARY KEY, product_type TEXT, school_id INTEGER, school_domain TEXT, seat_count INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, name TEXT, teacher_site_user_id INTEGER);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, game_id INTEGER);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, curriculum_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_assignment_id INTEGER, completed_at TEXT);
CREATE TABLE brain_game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_id INTEGER, completed_at TEXT, validation_status TEXT DEFAULT 'valid');
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 1);
CREATE TABLE curriculum_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, audience TEXT);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, band TEXT, active INTEGER DEFAULT 1);
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY, state_code TEXT, framework_type TEXT, name TEXT, issuing_body TEXT, official_url TEXT, review_status TEXT DEFAULT 'draft', reviewed_at TEXT, district_id INTEGER);
CREATE TABLE standards_items (id INTEGER PRIMARY KEY, framework_id INTEGER, code TEXT, title TEXT, summary TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE standards_alignments (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, target_type TEXT, target_id INTEGER DEFAULT 0, strength TEXT, rationale TEXT, review_status TEXT DEFAULT 'draft');
CREATE TABLE program_use_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, school_year_start INTEGER NOT NULL, month TEXT NOT NULL, school_id INTEGER NOT NULL, district_id INTEGER, teachers_licensed INTEGER NOT NULL, teachers_activated INTEGER NOT NULL,
  teachers_teaching INTEGER NOT NULL, teachers_teaching_ytd INTEGER NOT NULL, classrooms INTEGER NOT NULL, classrooms_active INTEGER NOT NULL, classrooms_regular INTEGER NOT NULL, students_enrolled INTEGER NOT NULL, students_active INTEGER NOT NULL,
  students_active_ytd INTEGER NOT NULL, activities INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'monthly', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (school_year_start, month, school_id));
CREATE TABLE pog_evidence_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, state_code TEXT NOT NULL, school_year_start INTEGER NOT NULL, classroom_id INTEGER NOT NULL, framework_id INTEGER NOT NULL, framework_name TEXT NOT NULL, item_id INTEGER NOT NULL,
  item_code TEXT NOT NULL, item_title TEXT NOT NULL, students_counted INTEGER NOT NULL, practiced INTEGER NOT NULL, touched INTEGER NOT NULL, activities_finished INTEGER NOT NULL, direct_activities INTEGER NOT NULL, supporting_activities INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (state_code, school_year_start, classroom_id, item_id));
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/^INSERT INTO settings \(setting_key, setting_value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE setting_value = \?$/,
    'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value');
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const usable = /ON CONFLICT/.test(s) ? params.slice(0, 2) : params;
  const r = db.prepare(s).run(...usable);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const header = (req, n) => req.get(n);
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => (header(req, 'x-staff') ? next() : res.status(401).json({ error: 'no' })), getAuthUser: () => null },
  [path.join(SERVER, 'middleware/schoolAdminAuth.js')]: { requireSchoolAdmin: (req, res, next) => (header(req, 'x-school-admin') ? ((req.schoolAdmin = { purchaseIds: JSON.parse(header(req, 'x-school-admin')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
  [path.join(SERVER, 'middleware/districtAdminAuth.js')]: { requireDistrictAdmin: (req, res, next) => (header(req, 'x-district-admin') ? ((req.districtAdmin = { districtIds: JSON.parse(header(req, 'x-district-admin')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const pog = require(path.join(SERVER, 'lib/pog-evidence.js'));
const use = require(path.join(SERVER, 'lib/program-use.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/program-report', require(path.join(SERVER, 'routes/program-report.js')));
app.use('/api/settings', require(path.join(SERVER, 'routes/settings.js')));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: urlPath, headers: h, timeout: 8000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b && /json/.test(res.headers['content-type'] || '') ? JSON.parse(b) : null, raw: b }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const Y = 2026;                                  // school year 2026-2027, used by the library tests
const AS_OF = new Date('2026-11-09T12:00:00Z');  // November: October is the last full month
let nextId = 1000;
const id = () => ++nextId;

function reset() {
  for (const t of ['settings', 'districts', 'schools', 'purchases', 'license_seats', 'school_license_admins', 'district_license_admins', 'classrooms', 'classroom_students', 'classroom_game_assignments',
    'classroom_assignments', 'student_lesson_progress', 'student_game_completions', 'brain_game_sessions', 'curricula', 'curriculum_audiences', 'brain_games', 'standards_frameworks', 'standards_items', 'standards_alignments', 'program_use_snapshots', 'pog_evidence_snapshots']) db.exec(`DELETE FROM ${t}`);
  db.exec(`INSERT INTO districts (id, name) VALUES (1, 'Maple District'), (2, 'Other District');
    INSERT INTO brain_games (id, name, slug, band, active) VALUES (1, 'Perspective Swap', 'perspective-swap', 'advance', 1), (2, 'Sharing Circle', 'sharing-circle', 'discover', 1);
    INSERT INTO curricula (id, title, published) VALUES (10, 'Pause Before You Escalate - Lesson Plan 1 - ES', 1), (11, 'Listen First - Lesson Plan 2 - ES', 1);
    INSERT INTO standards_frameworks (id, state_code, framework_type, name, issuing_body, official_url, review_status, reviewed_at, district_id) VALUES (1, 'NY', 'sel_standards', 'NY SEL', 'NYSED', 'https://example.org', 'verified', '2026-11-01 00:00:00', NULL);
    INSERT INTO standards_items (id, framework_id, code, title, sort_order) VALUES (1, 1, '2A', 'Empathy', 1);
    INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (1, 'brain_game', 1, 'direct', 'x', 'verified');`);
}
// A school in a district with `teachers` activated teachers, each with ONE classroom of `perClass` students. Returns { purchaseId, classrooms: [{ id, students: [ids], teacher }] }.
function school({ schoolId, name, district = 1, teachers = 5, perClass = 2, seats = 10 }) {
  const purchaseId = id();
  db.prepare('INSERT INTO schools (id, display_name, domain, district_id) VALUES (?, ?, ?, ?)').run(schoolId, name, `${name.toLowerCase().replace(/\W/g, '')}.example.org`, district);
  db.prepare("INSERT INTO purchases (id, product_type, school_id, school_domain, seat_count) VALUES (?, 'group_license', ?, ?, ?)").run(purchaseId, schoolId, `${name}.example.org`, seats);
  const classrooms = [];
  for (let t = 0; t < teachers; t++) {
    const teacher = id(), cid = id();
    db.prepare("INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, 'registered', ?)").run(purchaseId, teacher);
    db.prepare('INSERT INTO classrooms (id, name, teacher_site_user_id) VALUES (?, ?, ?)').run(cid, `Mrs ${name} ${t} secret class`, teacher);
    const students = [];
    for (let s = 0; s < perClass; s++) { const sid = id(); db.prepare('INSERT INTO classroom_students (id, classroom_id, display_name, is_active) VALUES (?, ?, ?, 1)').run(sid, cid, `Student ${sid} Private`); students.push(sid); }
    classrooms.push({ id: cid, students, teacher });
  }
  return { purchaseId, classrooms };
}
const lesson = (sid, at, cur = 10) => db.prepare('INSERT INTO student_lesson_progress (student_id, curriculum_id, started_at, completed_at) VALUES (?, ?, ?, ?)').run(sid, cur, at, at);
const startedOnly = (sid, at) => db.prepare('INSERT INTO student_lesson_progress (student_id, curriculum_id, started_at, completed_at) VALUES (?, 10, ?, NULL)').run(sid, at);
const play = (sid, at, game = 1, valid = 'valid') => db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at, validation_status) VALUES (?, ?, ?, ?)').run(sid, game, at, valid);
const assignedGame = (cid, sid, at, game = 2) => { const a = Number(db.prepare('INSERT INTO classroom_game_assignments (classroom_id, game_id) VALUES (?, ?)').run(cid, game).lastInsertRowid); db.prepare('INSERT INTO student_game_completions (student_id, game_assignment_id, completed_at) VALUES (?, ?, ?)').run(sid, a, at); };
const report = async (extra = {}) => {
  const groups = await use.districtSchoolGroups(1);
  return use.programReport({ groups, schoolYearStart: Y, asOf: AS_OF, settings: { minStudents: 10, ...extra.settings } });
};
const row = (r, label) => r.schools.find((s) => s.label === label);
const OCT = (d) => `2026-10-${String(d).padStart(2, '0')} 10:00:00`;

test('CALENDAR: the twelve months run August to July, and a week is Monday to Sunday', () => {
  const m = use.monthsOf(2026);
  assert.deepEqual([m[0].key, m[4].key, m[11].key], ['2026-08', '2026-12', '2027-07']);
  assert.deepEqual([m[0].from, m[0].to, m[4].to], ['2026-08-01 00:00:00', '2026-09-01 00:00:00', '2027-01-01 00:00:00']);
  assert.equal(use.weekKey('2026-10-05 08:00:00'), '2026-10-05', 'a Monday');
  assert.equal(use.weekKey('2026-10-11 23:59:00'), '2026-10-05', 'the Sunday of that week');
  assert.equal(use.weekKey('2026-10-12 00:00:00'), '2026-10-12');
});

test('ACTIVE means FINISHED: started-only, invalid sessions and removed students never count; the same activity twice in a month counts once; each month counts again', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  const [c1] = a.classrooms; const [s1, s2] = c1.students;
  lesson(s1, OCT(6)); lesson(s1, OCT(20));                 // the same lesson finished twice in October: once
  lesson(s1, '2026-09-10 10:00:00');                        // and again in September: counts there too
  startedOnly(s2, OCT(7));                                  // started only: nobody
  play(s2, OCT(8), 1, 'invalid');                           // an invalid session: nobody
  const removed = a.classrooms[1].students[0];
  db.prepare('UPDATE classroom_students SET is_active = 0 WHERE id = ?').run(removed);
  play(removed, OCT(9));                                    // a removed student: nobody
  const r = await report();
  const oct = r.months.find((m) => m.key === '2026-10'), sep = r.months.find((m) => m.key === '2026-09');
  assert.equal(oct.studentsActive, 1); assert.equal(oct.activities, 1);
  assert.equal(sep.studentsActive, 1); assert.equal(sep.activities, 1);
  assert.equal(r.totals.activities, 2, 'the months add up to the year');
  assert.equal(r.totals.studentsActive, 1, 'one student, however many months');
  assert.equal(r.totals.studentsEnrolled, 14, 'the removed student is left out of enrollment too (15 enrolled, 1 removed)');
  assert.equal(r.months.find((m) => m.key === '2026-08').studentsActive, 0);
  assert.equal(r.months.find((m) => m.key === '2026-12').future, true);
});

test('ACTIVITIES: lessons, assigned games and free-play games all count, once per student per activity per month', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 2 });
  const [c1] = a.classrooms; const s = c1.students[0];
  lesson(s, OCT(6), 10); lesson(s, OCT(7), 11);             // two different lessons
  assignedGame(c1.id, s, OCT(8), 2);                        // an assigned game
  play(s, OCT(9), 1);                                       // a free-play game
  play(s, OCT(10), 1);                                      // the same free-play game again
  assignedGame(c1.id, s, OCT(11), 2);                       // the same assigned game again (a second assignment of game 2)
  const r = await report();
  assert.equal(r.months.find((m) => m.key === '2026-10').activities, 4);
});

test('REGULAR USE: a classroom needs finishes in at least 3 different weeks of a month (a setting)', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 2 });
  const [c1, c2] = a.classrooms;
  lesson(c1.students[0], OCT(5), 10); lesson(c1.students[0], OCT(13), 11); play(c1.students[1], OCT(21), 1);   // three weeks
  lesson(c2.students[0], OCT(5), 10); play(c2.students[1], OCT(7), 1);                                          // one week
  let r = await report();
  const oct = r.months.find((m) => m.key === '2026-10');
  assert.deepEqual([oct.classroomsActive, oct.classroomsRegular], [2, 1]);
  r = await report({ settings: { regularWeeks: 1 } });
  assert.equal(r.months.find((m) => m.key === '2026-10').classroomsRegular, 2, 'a looser setting');
  assert.equal(use.clampRegularWeeks('0'), 1); assert.equal(use.clampRegularWeeks('9'), 4); assert.equal(use.clampRegularWeeks('abc'), 3);
});

test('REACH, per active student, and the flag: a school is flagged when under the set percent of its classrooms were in regular use last month', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 2 });
  const b = school({ schoolId: 2, name: 'Beta', teachers: 5, perClass: 2 });
  for (const c of a.classrooms) { lesson(c.students[0], OCT(5), 10); lesson(c.students[0], OCT(13), 11); play(c.students[1], OCT(21), 1); }   // all 5 regular
  lesson(b.classrooms[0].students[0], OCT(5), 10);                                                                                           // 0 of 5 regular
  const r = await report();
  const alpha = row(r, 'Alpha'), beta = row(r, 'Beta');
  assert.deepEqual([alpha.studentsEnrolled, alpha.studentsActive, alpha.reach], [10, 10, 100].map((v, i) => (i === 1 ? 10 : v)));
  assert.equal(alpha.flag, null);
  assert.equal(alpha.activitiesPerActiveStudent, 1.5);
  assert.equal(beta.flag, 'low_use');
  assert.equal(beta.classroomsRegularLastMonth, 0);
  assert.equal(r.lastFullMonth, '2026-10');
  const early = await use.programReport({ groups: await use.districtSchoolGroups(1), schoolYearStart: Y, asOf: new Date('2026-08-20T12:00:00Z'), settings: { minStudents: 10 } });
  assert.equal(row(early, 'Alpha').flag, 'no_data_yet', 'in August there is no full month to judge yet');
  assert.equal(use.clampLowUsePct('5'), 10); assert.equal(use.clampLowUsePct('95'), 90);
});

test('SMALL GROUPS: a school under the student minimum is merged, never shown on its own, and nothing under the minimum is left', async () => {
  reset();
  school({ schoolId: 1, name: 'Big', teachers: 5, perClass: 4 });         // 20 students
  school({ schoolId: 2, name: 'Tiny One', teachers: 5, perClass: 1 });    // 5 students
  school({ schoolId: 3, name: 'Tiny Two', teachers: 5, perClass: 1 });    // 5 students
  school({ schoolId: 4, name: 'Empty', teachers: 5, perClass: 0 });       // no students yet
  const r = await report();
  assert.equal(r.suppressed, false);
  const labels = r.schools.map((s) => s.label);
  assert.deepEqual(labels, ['Big', 'Empty', 'Other schools combined']);
  assert.equal(row(r, 'Other schools combined').studentsEnrolled, 10, 'two 5-student schools together are exactly the minimum');
  assert.equal(row(r, 'Other schools combined').merged, 2);
  assert.ok(r.schools.every((s) => s.studentsEnrolled === 0 || s.studentsEnrolled >= 10), 'nothing under the minimum is ever shown');
  assert.equal(row(r, 'Empty').studentsEnrolled, 0, 'a school with no students yet is shown: zero reveals no one');
});

test('SMALL GROUPS: when the leftovers are still too few they take the smallest visible school with them (no subtraction trick)', async () => {
  reset();
  school({ schoolId: 1, name: 'Mid', teachers: 5, perClass: 2 });      // 10
  school({ schoolId: 2, name: 'Big', teachers: 5, perClass: 4 });      // 20
  school({ schoolId: 3, name: 'Tiny', teachers: 3, perClass: 1 });     // 3
  const r = await report();
  assert.deepEqual(r.schools.map((s) => s.label), ['Big', 'Other schools combined']);
  assert.equal(row(r, 'Other schools combined').studentsEnrolled, 13);
});

test('SMALL GROUPS: if the whole district is under the minimum, there are no figures at all', async () => {
  reset();
  school({ schoolId: 1, name: 'Tiny', teachers: 5, perClass: 1 });
  const r = await report();
  assert.equal(r.suppressed, true);
  assert.equal(r.totals, undefined); assert.equal(r.schools, undefined); assert.equal(r.months, undefined);
  assert.equal(r.teachersLicensed, 10, 'license counts are the district\'s own seat facts and stay');
});

test('SMALL TEACHER GROUPS: under 5 activated teachers a school shows no teacher or classroom figure and no support flag', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Few Teachers', teachers: 2, perClass: 6 });    // 12 students, 2 teachers
  const b = school({ schoolId: 2, name: 'Enough', teachers: 5, perClass: 3 });           // 15 students, 5 teachers
  lesson(a.classrooms[0].students[0], OCT(5));
  const r = await report();
  const few = row(r, 'Few Teachers'), enough = row(r, 'Enough');
  assert.equal(few.teachers, null); assert.equal(few.classrooms, null); assert.equal(few.classroomsRegularLastMonth, null);
  assert.equal(few.flag, 'hidden');
  assert.equal(few.studentsEnrolled, 12, 'the student figures stay (12 is over the student minimum)');
  assert.deepEqual(enough.teachers, { licensed: 10, activated: 5, teaching: 0 });
  assert.equal(use.clampMinTeachers('1'), 3, 'never below 3');
  assert.equal(use.clampMinTeachers('99'), 50);
  const lowered = await report({ settings: { minTeachers: 2 } });
  assert.equal(lowered.settings.minTeachers, 3, 'a setting of 2 is raised to 3');
  assert.equal(row(lowered, 'Few Teachers').teachers, null);
});

test('SCOPE: only the district\'s own schools; a classroom whose teacher holds seats at two schools is counted once, under the lowest school id', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 2 });
  const b = school({ schoolId: 2, name: 'Beta', teachers: 5, perClass: 2 });
  school({ schoolId: 9, name: 'Elsewhere', district: 2, teachers: 5, perClass: 2 });
  db.prepare("INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, 'registered', ?)").run(b.purchaseId, a.classrooms[0].teacher);   // Alpha's teacher also holds a Beta seat
  const groups = await use.districtSchoolGroups(1);
  assert.deepEqual(groups.map((g) => g.label), ['Alpha', 'Beta']);
  assert.equal(groups[0].classroomIds.length, 5); assert.equal(groups[1].classroomIds.length, 5, 'Beta keeps its own five; the shared classroom is not repeated');
  assert.ok(!groups.flatMap((g) => g.classroomIds).includes(groups[1].classroomIds.find((c) => groups[0].classroomIds.includes(c))), 'no classroom is in two groups');
});

test('ROUTE: a district administrator sees their own district; another district\'s id is a 404; no login is a 401; staff can look at any district', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  school({ schoolId: 9, name: 'Elsewhere', district: 2, teachers: 5, perClass: 3 });
  lesson(a.classrooms[0].students[0], `${pog.currentSchoolYearStart()}-09-15 10:00:00`);
  const adm = { 'x-district-admin': '[1]' };
  assert.equal((await call('GET', '/api/program-report/district')).status, 401);
  const mine = await call('GET', '/api/program-report/district', { headers: adm });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.districtId, 1);
  assert.deepEqual(mine.json.schools.map((s) => s.label), ['Alpha']);
  assert.ok(mine.json.standards, 'standards coverage rides along, from Graduate Evidence');
  assert.equal((await call('GET', '/api/program-report/district?districtId=2', { headers: adm })).status, 404);
  assert.equal((await call('GET', '/api/program-report/district?districtId=abc', { headers: adm })).status, 404);
  assert.equal((await call('GET', '/api/program-report/district?districtId=1', { headers: adm })).status, 200);
  assert.equal((await call('GET', '/api/program-report/staff/district/2')).status, 401);
  const staff = await call('GET', '/api/program-report/staff/district/2', { headers: { 'x-staff': '1' } });
  assert.equal(staff.status, 200); assert.deepEqual(staff.json.schools.map((s) => s.label), ['Elsewhere']);
  assert.equal((await call('GET', '/api/program-report/staff/district/xyz', { headers: { 'x-staff': '1' } })).status, 404);
});

test('PRIVACY: nothing in the answer names a teacher, classroom or student, and no outcome or score word appears', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  lesson(a.classrooms[0].students[0], `${pog.currentSchoolYearStart()}-09-15 10:00:00`);
  const r = await call('GET', '/api/program-report/district', { headers: { 'x-district-admin': '[1]' } });
  assert.ok(!/secret class|Private|Student \d+/.test(r.raw), 'no classroom or student name');
  assert.ok(!/teacher_site_user_id|studentId|student_id|classroomId|"email"/i.test(r.raw), 'no id fields');
  assert.ok(!/\b(score|grade|mastery|proficien|outcome|impact|growth|improv)/i.test(JSON.stringify(Object.keys(r.json)) + JSON.stringify(r.json.schools.map((s) => Object.keys(s)))), 'no outcome word in a field name');
});

test('SETTINGS: staff can change the three thresholds within limits; anything else is refused and a damaged value is clamped', async () => {
  reset();
  const staff = { 'x-staff': '1' };
  assert.deepEqual((await call('GET', '/api/settings/program-report', { headers: staff })).json, { regularWeeks: 3, lowUsePct: 50, minTeachers: 5, limits: { regularWeeks: [1, 4], lowUsePct: [10, 90], minTeachers: [3, 50] } });
  assert.equal((await call('PUT', '/api/settings/program-report', { headers: staff, body: { regularWeeks: 2, lowUsePct: 40, minTeachers: 6 } })).status, 200);
  const got = (await call('GET', '/api/settings/program-report', { headers: staff })).json;
  assert.deepEqual([got.regularWeeks, got.lowUsePct, got.minTeachers], [2, 40, 6]);
  for (const bad of [{ regularWeeks: 0 }, { regularWeeks: 5 }, { lowUsePct: 9 }, { lowUsePct: 91 }, { minTeachers: 2 }, { minTeachers: 51 }, { regularWeeks: 'x' }, { minTeachers: null }, { lowUsePct: 2.5 }]) {
    assert.equal((await call('PUT', '/api/settings/program-report', { headers: staff, body: { regularWeeks: 3, lowUsePct: 50, minTeachers: 5, ...bad } })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal((await call('GET', '/api/settings/program-report')).status, 401);
  assert.equal((await call('PUT', '/api/settings/program-report', { body: { regularWeeks: 3, lowUsePct: 50, minTeachers: 5 } })).status, 401);
  db.prepare("UPDATE settings SET setting_value = '1' WHERE setting_key = 'program_report_min_teachers'").run();
  assert.equal((await call('GET', '/api/settings/program-report', { headers: staff })).json.minTeachers, 3, 'a damaged value cannot lower the teacher minimum below 3');
});

// ======================= phases 2 to 4 (Release 162): history, CSV, school administrators =======================
const csvLib = require(path.join(SERVER, 'lib/program-use-csv.js'));
const snapRow = (o) => db.prepare(`INSERT INTO program_use_snapshots (school_year_start, month, school_id, district_id, teachers_licensed, teachers_activated, teachers_teaching, teachers_teaching_ytd,
  classrooms, classrooms_active, classrooms_regular, students_enrolled, students_active, students_active_ytd, activities, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(o.year || 2025, o.month, o.school, o.district || 1, o.lic || 10, o.act || 6, o.teach || 4, o.teachYtd || 5, o.rooms || 6, o.roomsActive || 4, o.roomsReg || 3, o.enrolled || 60, o.studs || 30, o.studsYtd || 45, o.acts || 100, o.source || 'monthly');
const snapGroups = async () => use.districtSchoolGroups(1);

test('SNAPSHOT MONTHS: the monthly run saves the month that just ended, the first of August saves July, and a backfill saves every finished month of this year', () => {
  const at = (d) => new Date(`${d}T12:00:00Z`);
  assert.deepEqual(use.monthsToSnapshot({ today: at('2026-11-09') }), { schoolYearStart: 2026, monthKeys: ['2026-10'] });
  assert.deepEqual(use.monthsToSnapshot({ today: at('2026-09-01') }), { schoolYearStart: 2026, monthKeys: ['2026-08'] });
  assert.deepEqual(use.monthsToSnapshot({ today: at('2026-08-01') }), { schoolYearStart: 2025, monthKeys: ['2026-07'] }, 'the last month of the school year that just ended');
  assert.deepEqual(use.monthsToSnapshot({ today: at('2027-01-01') }), { schoolYearStart: 2026, monthKeys: ['2026-12'] });
  assert.deepEqual(use.monthsToSnapshot({ today: at('2026-11-09'), backfill: true }), { schoolYearStart: 2026, monthKeys: ['2026-08', '2026-09', '2026-10'] });
  assert.deepEqual(use.monthsToSnapshot({ today: at('2026-08-03'), backfill: true }).monthKeys, [], 'nothing has finished in the first days of August');
});

test('SNAPSHOT: rows hold the month\'s counts and year-to-date counts, no id or name; saved once and never recomputed, even after the records are gone', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  lesson(a.classrooms[0].students[0], OCT(5), 10); lesson(a.classrooms[0].students[0], OCT(13), 11); play(a.classrooms[0].students[1], OCT(21), 1);
  lesson(a.classrooms[1].students[0], '2026-09-10 10:00:00', 10);
  const groups = await snapGroups();
  const rows = await use.snapshotRowsFor({ groups, schoolYearStart: Y, monthKeys: ['2026-09', '2026-10'], districtId: 1, source: 'monthly' });
  assert.equal(rows.length, 2);
  const oct = rows.find((r) => r.month === '2026-10'), sep = rows.find((r) => r.month === '2026-09');
  assert.deepEqual([oct.studentsActive, oct.activities, oct.classroomsActive, oct.classroomsRegular, oct.studentsEnrolled, oct.classrooms, oct.teachersActivated], [2, 3, 1, 1, 15, 5, 5]);
  assert.deepEqual([sep.studentsActive, sep.studentsActiveYtd, oct.studentsActiveYtd, oct.teachersTeachingYtd], [1, 1, 3, 2], 'year to date counts people once across months');
  const cols = db.prepare('PRAGMA table_info(program_use_snapshots)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /student_id|teacher_id|classroom_id|name|email|text/.test(c)), `no id, name or text column: ${cols.join(',')}`);
  assert.deepEqual(await use.writeSnapshotRows(rows), { written: 2, skipped: 0 });
  const before = JSON.stringify(db.prepare('SELECT * FROM program_use_snapshots ORDER BY month').all());
  db.exec('DELETE FROM student_lesson_progress; DELETE FROM brain_game_sessions; DELETE FROM classroom_students;');      // the records are removed
  const again = await use.snapshotRowsFor({ groups, schoolYearStart: Y, monthKeys: ['2026-09', '2026-10'], districtId: 1, source: 'monthly' });
  assert.deepEqual(await use.writeSnapshotRows(again), { written: 0, skipped: 2 }, 'already saved: left exactly as they were');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM program_use_snapshots ORDER BY month').all()), before);
});

test('LAST YEAR: read only from saved rows, with the small-group rules applied when it is READ; no support flag; null when nothing was saved', async () => {
  reset();
  school({ schoolId: 1, name: 'Big', teachers: 5, perClass: 1 });
  school({ schoolId: 2, name: 'Tiny One', teachers: 5, perClass: 1 });
  school({ schoolId: 3, name: 'Tiny Two', teachers: 5, perClass: 1 });
  const groups = await snapGroups();
  assert.equal(await use.lastYearReport({ groups, schoolYearStart: 2025 }), null, 'nothing saved yet: no last-year section');
  for (const m of ['2025-09', '2025-10']) { snapRow({ school: 1, month: m, enrolled: 40, studs: 30, studsYtd: 35, acts: 90, source: 'backfill' }); snapRow({ school: 2, month: m, enrolled: 6, studs: 3, studsYtd: 3, acts: 6, teach: 2, act: 2 }); snapRow({ school: 3, month: m, enrolled: 5, studs: 4, studsYtd: 4, acts: 8, act: 2 }); }
  const r = await use.lastYearReport({ groups, schoolYearStart: 2025 });
  assert.equal(r.schoolYear, '2025–2026');
  assert.deepEqual(r.schools.map((s) => s.label), ['Big', 'Other schools combined'], 'the two small schools are combined when read');
  assert.equal(r.schools[1].studentsEnrolled, 11, 'the two small schools together are over the minimum');
  assert.ok(r.schools.every((x) => x.flag === null || x.flag === 'hidden'), 'no support flag about a finished year');
  assert.equal(r.monthsSaved, 2); assert.equal(r.backfilledMonths, 2, 'two months were backfilled');
  assert.equal(r.months.find((m) => m.key === '2025-09').saved, true); assert.equal(r.months.find((m) => m.key === '2025-12').saved, false);
  assert.equal(r.totals.studentsActive, 35 + 3 + 4, 'year-to-date people come from the latest saved month');
  assert.equal(r.totals.activities, 2 * (90 + 6 + 8), 'the months add up');
});

test('LAST YEAR: a district under the minimum shows no figures from the saved rows either', async () => {
  reset();
  school({ schoolId: 1, name: 'Tiny', teachers: 5, perClass: 1 });
  snapRow({ school: 1, month: '2025-10', enrolled: 5, studs: 3, studsYtd: 3, acts: 6 });
  const r = await use.lastYearReport({ groups: await snapGroups(), schoolYearStart: 2025 });
  assert.equal(r.suppressed, true); assert.equal(r.totals, undefined);
});

test('LAST YEAR ATTRIBUTES: read from the Graduate Evidence year snapshot, grouped by school, merged when small, with the names saved that year', async () => {
  reset();
  const big = school({ schoolId: 1, name: 'Big', teachers: 5, perClass: 1 });
  const t1 = school({ schoolId: 2, name: 'Tiny One', teachers: 5, perClass: 1 });
  const t2 = school({ schoolId: 3, name: 'Tiny Two', teachers: 5, perClass: 1 });
  const put = (cid, students, practiced, item = 1, direct = 1) => db.prepare(`INSERT INTO pog_evidence_snapshots (state_code, school_year_start, classroom_id, framework_id, framework_name, item_id, item_code, item_title, students_counted, practiced, touched, activities_finished, direct_activities, supporting_activities)
    VALUES ('NY', 2025, ?, 1, 'NY SEL Benchmarks', ?, ?, ?, ?, ?, 1, 5, ?, 0)`).run(cid, item, item === 1 ? '2A' : '3B', item === 1 ? 'Empathy' : 'Decision-making', students, practiced, direct);
  for (const c of big.classrooms) { put(c.id, 12, 6); put(c.id, 12, 0, 2, 0); }
  put(t1.classrooms[0].id, 4, 2); put(t2.classrooms[0].id, 4, 1);
  const st = await use.snapshotStandards({ groups: await snapGroups(), schoolYearStart: 2025, minStudents: 10 });
  assert.equal(st.suppressed, false);
  const items = Object.fromEntries(st.frameworks.flatMap((f) => f.items).map((i) => [i.code, i]));
  assert.equal(items['2A'].status, 'ok'); assert.equal(items['2A'].students, 5 * 12 + 8); assert.equal(items['2A'].practiced, 5 * 6 + 3);
  assert.equal(items['3B'].status, 'no_connection', 'nothing was connected that year, and it says so rather than showing zero');
  assert.equal(items['3B'].practiced, undefined);
  assert.equal(st.frameworks[0].name, 'NY SEL Benchmarks');
  assert.equal(await use.snapshotStandards({ groups: await snapGroups(), schoolYearStart: 2024, minStudents: 10 }), null, 'a year with no snapshot: nothing');
  const small = await use.snapshotStandards({ groups: [{ key: 's9', label: 'X', classroomIds: [t1.classrooms[0].id] }], schoolYearStart: 2025, minStudents: 10 });
  assert.equal(small.suppressed, true, 'fewer than the minimum: no figures');
});

test('CSV: a header with the definitions and claim lines, the same numbers as the page, "suppressed" instead of 0, formulas defused, and no name of a teacher, classroom or student', async () => {
  reset();
  const a = school({ schoolId: 1, name: '=HYPERLINK("http://x")', teachers: 5, perClass: 3 });
  school({ schoolId: 2, name: 'Two, Inc "Quoted"', teachers: 2, perClass: 6 });
  lesson(a.classrooms[0].students[0], `${pog.currentSchoolYearStart()}-09-15 10:00:00`);
  const r = await call('GET', '/api/program-report/district/export', { headers: { 'x-district-admin': '[1]' } });
  assert.equal(r.status, 200);
  assert.match(r.raw, /^\uFEFFProgram Use Report/);
  assert.match(String(r.raw), /How we count,https:\/\/fixernationeducation\.com\/program-report-how-we-count\.html/);
  assert.match(r.raw, /not an evaluation of student outcomes/); assert.match(r.raw, /New York State and CASEL have not endorsed or certified them/); assert.match(r.raw, /no demographic information/);
  assert.match(r.raw, /'=HYPERLINK/, 'a school name that starts like a formula is defused');
  assert.ok(!/^=HYPERLINK/m.test(r.raw.replace(/\uFEFF/, '')));
  assert.match(r.raw, /"Two, Inc ""Quoted"""/, 'commas and quotes are escaped');
  assert.match(r.raw, /Hidden|suppressed/, 'the small teacher group is marked, not shown as 0');
  assert.ok(!/secret class|Private|Student \d+/.test(r.raw), 'no classroom or student name');
  assert.ok(csvLib.cell('+1+1').startsWith("'") && csvLib.cell('@x').startsWith("'") && csvLib.cell('-2x').startsWith("'") && csvLib.cell(-2) === '-2', 'text is defused, real numbers are not');
});

test('CSV ACCESS: another district is a 404, no login a 401, staff can export any district; the headers say it is a download', async () => {
  reset();
  school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  assert.equal((await call('GET', '/api/program-report/district/export')).status, 401);
  assert.equal((await call('GET', '/api/program-report/district/export?districtId=2', { headers: { 'x-district-admin': '[1]' } })).status, 404);
  assert.equal((await call('GET', '/api/program-report/staff/district/1/export')).status, 401);
  const ok = await call('GET', '/api/program-report/staff/district/1/export', { headers: { 'x-staff': '1' } });
  assert.equal(ok.status, 200);
  const head = await new Promise((resolve) => http.get({ port, path: '/api/program-report/district/export', headers: { 'x-district-admin': '[1]' } }, (res) => { res.resume(); resolve(res.headers); }));
  assert.match(head['content-type'], /text\/csv/); assert.match(head['content-disposition'], /attachment; filename="program-use-report-district-1-\d+\.csv"/); assert.equal(head['cache-control'], 'no-store');
});

test('LAST YEAR IN THE ROUTE: the answer carries it only when rows were saved, and the CSV adds it', async () => {
  reset();
  school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  const adm = { 'x-district-admin': '[1]' };
  assert.equal((await call('GET', '/api/program-report/district', { headers: adm })).json.lastYear, null);
  snapRow({ year: pog.currentSchoolYearStart() - 1, month: `${pog.currentSchoolYearStart() - 1}-10`, school: 1, enrolled: 15, studs: 10, studsYtd: 12, acts: 30 });
  const r = (await call('GET', '/api/program-report/district', { headers: adm })).json;
  assert.ok(r.lastYear && r.lastYear.schoolYear.startsWith(String(pog.currentSchoolYearStart() - 1)));
  assert.match((await call('GET', '/api/program-report/district/export', { headers: adm })).raw, /LAST SCHOOL YEAR/);
});

test('SCHOOL ADMINISTRATOR: sees only their own school; another purchase is a 404; teacher figures hide under the minimum; a small school shows no student figures', async () => {
  reset();
  const a = school({ schoolId: 1, name: 'Alpha', teachers: 5, perClass: 3 });
  const b = school({ schoolId: 2, name: 'Beta', teachers: 2, perClass: 8 });
  const c = school({ schoolId: 3, name: 'Gamma', teachers: 5, perClass: 1 });
  lesson(a.classrooms[0].students[0], `${pog.currentSchoolYearStart()}-09-15 10:00:00`);
  const mine = (id) => ({ 'x-school-admin': JSON.stringify([id]) });
  assert.equal((await call('GET', '/api/program-report/school')).status, 401);
  const ra = await call('GET', `/api/program-report/school?purchaseId=${a.purchaseId}`, { headers: mine(a.purchaseId) });
  assert.equal(ra.status, 200); assert.equal(ra.json.schoolLabel, 'Alpha'); assert.equal(ra.json.schools.length, 1); assert.deepEqual(ra.json.schools[0].teachers.activated, 5);
  assert.equal(ra.json.lastYear, undefined, 'one school: no district-style last-year section');
  assert.equal((await call('GET', `/api/program-report/school?purchaseId=${b.purchaseId}`, { headers: mine(a.purchaseId) })).status, 404, 'another school\'s purchase');
  assert.equal((await call('GET', '/api/program-report/school?purchaseId=abc', { headers: mine(a.purchaseId) })).status, 404);
  const rb = await call('GET', `/api/program-report/school?purchaseId=${b.purchaseId}`, { headers: mine(b.purchaseId) });
  assert.equal(rb.json.schools[0].teachers, null); assert.equal(rb.json.schools[0].flag, 'hidden');
  const rc = await call('GET', `/api/program-report/school?purchaseId=${c.purchaseId}`, { headers: mine(c.purchaseId) });
  assert.equal(rc.json.suppressed, true, '5 students: under the minimum');
  assert.ok(!/secret class|Private|Student \d+/.test(ra.raw + rb.raw + rc.raw));
  const csv = await call('GET', `/api/program-report/school/export?purchaseId=${a.purchaseId}`, { headers: mine(a.purchaseId) });
  assert.equal(csv.status, 200); assert.match(csv.raw, /Alpha/); assert.equal((await call('GET', `/api/program-report/school/export?purchaseId=${b.purchaseId}`, { headers: mine(a.purchaseId) })).status, 404);
});
