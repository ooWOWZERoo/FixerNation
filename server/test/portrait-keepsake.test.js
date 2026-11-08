// My Graduate Portrait, tier 2: the end-of-year keepsake (docs/reference/graduate-portrait-requirements.md section 5, D1, D3, D4).
// Runs the real lib/portrait-keepsake.js, routes/student-portrait.js, routes/parent-portrait.js and the teacher's switch in
// routes/classrooms.js on a real SQL engine (node:sqlite).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY, state_code TEXT, framework_type TEXT, name TEXT, issuing_body TEXT, official_url TEXT, review_status TEXT DEFAULT 'draft', reviewed_at TEXT, district_id INTEGER);
CREATE TABLE standards_items (id INTEGER PRIMARY KEY, framework_id INTEGER, code TEXT, title TEXT, summary TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE standards_alignments (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, target_type TEXT, target_id INTEGER DEFAULT 0, strength TEXT, rationale TEXT, review_status TEXT DEFAULT 'draft');
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, name TEXT, teacher_site_user_id INTEGER, archived_at TEXT, academic_year TEXT, grade_level TEXT, subject TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, keepsake_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER, student_id INTEGER);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, curriculum_id INTEGER);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, game_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, completed_at TEXT);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_assignment_id INTEGER, completed_at TEXT);
CREATE TABLE brain_game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_id INTEGER, completed_at TEXT, validation_status TEXT DEFAULT 'valid');
CREATE TABLE student_reflections (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, prompt_key TEXT, response_text TEXT, submitted_at TEXT);
CREATE TABLE student_goals (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, goal_text TEXT, created_at TEXT);
CREATE TABLE student_portrait_pins (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, kind TEXT NOT NULL, source_id INTEGER NOT NULL, item_id INTEGER, school_year_start INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (student_id, kind, source_id));
`);
const run = async (sql, params = []) => {
  const s = sql.trim();
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/studentAuth.js')]: {
    requireStudentAuth: (req, res, next) => {
      const id = Number(req.get('x-student'));
      const row = id ? db.prepare('SELECT cs.* FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id WHERE cs.id = ? AND cs.is_active = 1 AND c.archived_at IS NULL').get(id) : null;
      if (!row) return res.status(401).json({ error: 'Not logged in' });
      req.student = row; next();
    },
  },
  // The parent / teacher session: x-user carries the site user id. (A student header does NOT pass here: two separate auth systems.)
  [path.join(SERVER, 'routes/site-auth.js')]: { requireSiteAuth: (req, res, next) => (Number(req.get('x-user')) ? ((req.siteUser = { id: Number(req.get('x-user')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
  [path.join(SERVER, 'lib/access.js')]: { hasActiveLicense: async () => true },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({}, { get: () => async () => ({}) }),
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const pog = require(path.join(SERVER, 'lib/pog-evidence.js'));
const keep = require(path.join(SERVER, 'lib/portrait-keepsake.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/student-portrait', require(path.join(SERVER, 'routes/student-portrait.js')));
app.use('/api/parent-portrait', require(path.join(SERVER, 'routes/parent-portrait.js')));
app.use('/api/classrooms', require(path.join(SERVER, 'routes/classrooms.js')));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

const YEAR = pog.currentSchoolYearStart();
const IN_YEAR = `${YEAR}-09-15 10:00:00`;
const LAST_YEAR = `${YEAR - 1}-09-15 10:00:00`;

function call(method, urlPath, { student, user, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (student) headers['x-student'] = String(student);
    if (user) headers['x-user'] = String(user);
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: urlPath, headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null, raw: b }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function reset() {
  for (const t of ['student_portrait_pins', 'student_goals', 'student_reflections', 'standards_alignments', 'standards_items', 'standards_frameworks', 'districts', 'curriculum_audiences', 'curricula', 'brain_games',
    'parent_classroom_links', 'classroom_students', 'classrooms', 'classroom_assignments', 'classroom_game_assignments', 'student_lesson_progress', 'student_game_completions', 'brain_game_sessions']) db.exec(`DELETE FROM ${t}`);
  db.exec(`
INSERT INTO brain_games (id, name, slug, band, active) VALUES (1, 'Perspective Swap', 'perspective-swap', 'advance', 1), (2, 'Sharing Circle', 'sharing-circle', 'discover', 1);
INSERT INTO curricula (id, title, published) VALUES (10, 'Pause Before You Escalate - Lesson Plan 1 - ES', 1);
INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (10, 'Elementary School');
INSERT INTO standards_frameworks (id, state_code, framework_type, name, issuing_body, official_url, review_status, reviewed_at, district_id) VALUES
  (1, 'NY', 'sel_standards', 'NY SEL Benchmarks', 'NYSED', 'https://example.org/sel', 'verified', '2026-11-01 00:00:00', NULL),
  (2, 'NY', 'portrait_of_graduate', 'NY Portrait', 'NYSED', 'https://example.org/pog', 'verified', '2026-11-01 00:00:00', NULL);
INSERT INTO standards_items (id, framework_id, code, title, summary, sort_order) VALUES (1, 1, '2A', 'Empathy', NULL, 1), (2, 1, '3B', 'Decision-making', NULL, 2), (4, 2, 'GC', 'Global Citizen', NULL, 1);
-- Classroom 1 is this school year's, classroom 2 is last school year's (still around), classroom 3 is another teacher's with another child.
INSERT INTO classrooms (id, name, teacher_site_user_id, academic_year) VALUES (1, 'Period 3 SEL', 100, '${YEAR}–${YEAR + 1}'), (2, 'Period 1 Last Year', 100, '${YEAR - 1}–${YEAR}'), (3, 'Other class', 200, '${YEAR}–${YEAR + 1}');
INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (1001, 1, 'Alex Rivera'), (1002, 1, 'Sam Lee'), (2001, 2, 'Pat Last'), (3001, 3, 'Jordan Poe');
INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (500, 1, 1001), (500, 2, 2001), (600, 3, 3001);
`);
}
const align = (itemId, type, targetId, strength) => db.prepare("INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?, ?, ?, ?, 'Because.', 'verified')").run(itemId, type, targetId, strength);
const play = (sid, gid, at = IN_YEAR) => db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at) VALUES (?, ?, ?)').run(sid, gid, at);
const reflect = (sid, text, at = IN_YEAR) => Number(db.prepare('INSERT INTO student_reflections (student_id, curriculum_id, prompt_key, response_text, submitted_at) VALUES (?, 10, ?, ?, ?)').run(sid, 'p1', text, at).lastInsertRowid);
const byCode = (p) => Object.fromEntries(p.frameworks.flatMap((f) => f.items).map((i) => [i.code, i]));

test('WINDOW: until the purge exists the keepsake opens with the classroom\'s school year and never closes; with it, 1 June to the day data is due', () => {
  const room = { academic_year: '2026–2027', created_at: '2026-09-01 00:00:00' };
  const at = (d) => new Date(`${d}T12:00:00Z`);
  assert.equal(keep.PURGE_BUILT, false, 'flip it in the release that ships the purge, and update this test');
  assert.equal(keep.keepsakeWindow(room, at('2026-07-31')).state, 'not_yet');
  assert.equal(keep.keepsakeWindow(room, at('2026-08-01')).state, 'open');
  assert.equal(keep.keepsakeWindow(room, at('2028-01-01')).state, 'open', 'no purge, no end');
  assert.equal(keep.keepsakeWindow(room, at('2027-09-01')).start, 2026, 'in September 2027 it is still the 2026-2027 keepsake, not the new school year');
  // with the purge built
  assert.equal(keep.keepsakeWindow(room, at('2027-05-31'), true).state, 'not_yet');
  assert.equal(keep.keepsakeWindow(room, at('2027-06-01'), true).state, 'open');
  assert.equal(keep.keepsakeWindow(room, at('2027-09-28'), true).state, 'open', 'the day before the data is due is the last day');
  assert.equal(keep.keepsakeWindow(room, at('2027-09-29'), true).state, 'closed', 'the data is due (and may be gone) on 29 September');
  assert.equal(keep.keepsakeWindow(room, at('2027-10-01'), true).state, 'closed');
  assert.deepEqual([keep.keepsakeWindow(room, at('2027-06-01'), true).opensOn, keep.keepsakeWindow(room, at('2027-06-01'), true).closesOn], ['2027-06-01', '2027-09-28']);
  // a classroom with no Academic Year uses the year it was created in
  assert.equal(keep.keepsakeWindow({ academic_year: null, created_at: '2026-10-05 00:00:00' }, at('2026-11-08')).start, 2026);
});

test('STATUS: on by default (even before the column exists); a teacher\'s 0 turns it off', () => {
  const room = { academic_year: `${YEAR}–${YEAR + 1}`, created_at: IN_YEAR };
  assert.equal(keep.keepsakeStatus({ ...room }).enabled, true, 'no column yet');
  assert.equal(keep.keepsakeStatus({ ...room, keepsake_enabled: null }).enabled, true);
  assert.equal(keep.keepsakeStatus({ ...room, keepsake_enabled: 1 }).available, true);
  assert.deepEqual([keep.keepsakeStatus({ ...room, keepsake_enabled: 0 }).enabled, keep.keepsakeStatus({ ...room, keepsake_enabled: 0 }).available], [false, false]);
});

test('STUDENT: opens their own keepsake with their name, class, year and the games behind each skill, plus the words they pinned', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); align(4, 'brain_game', 2, 'supporting');
  play(1001, 1); play(1001, 2); play(1002, 1);
  const r = reflect(1001, 'I listened better today.');
  await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'reflection', sourceId: r, itemId: 1 } });
  assert.equal((await call('GET', '/api/student-portrait/keepsake')).status, 401);
  const k = await call('GET', '/api/student-portrait/keepsake?studentId=1002', { student: 1001 });
  assert.equal(k.status, 200);
  assert.equal(k.json.student.displayName, 'Alex Rivera');
  assert.equal(k.json.className, 'Period 3 SEL');
  assert.equal(k.json.schoolYear, `${YEAR}–${YEAR + 1}`);
  assert.equal(byCode(k.json)['2A'].status, 'practiced');
  assert.equal(byCode(k.json).GC.status, 'touched');
  assert.deepEqual(k.json.pins, [{ text: 'I listened better today.', itemId: 1 }], 'the student\'s own keepsake carries their pinned words');
  assert.ok(!k.raw.includes('Sam Lee'), 'no other student is named');
  assert.match(k.json.madeOn, /^\d{4}-\d{2}-\d{2}$/);
});

test('STUDENT: the keepsake is for the CLASSROOM\'s school year, so a class from last year prints last year\'s work', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  play(2001, 1, LAST_YEAR); play(2001, 1, IN_YEAR);
  const k = await call('GET', '/api/student-portrait/keepsake', { student: 2001 });
  assert.equal(k.status, 200);
  assert.equal(k.json.schoolYear, `${YEAR - 1}–${YEAR}`);
  assert.equal(byCode(k.json)['2A'].status, 'practiced', 'last year\'s play counts for last year\'s class');
  db.prepare('DELETE FROM brain_game_sessions WHERE completed_at = ?').run(LAST_YEAR);
  assert.equal(byCode((await call('GET', '/api/student-portrait/keepsake', { student: 2001 })).json)['2A'].status, 'not_yet', 'this year\'s play does not leak into last year\'s keepsake');
});

test('TEACHER SWITCH: off means no keepsake for the student or the parent, and the portrait page is told; on again restores it', async () => {
  reset(); align(1, 'brain_game', 1, 'direct'); play(1001, 1);
  assert.equal((await call('GET', '/api/student-portrait', { student: 1001 })).json.keepsake.available, true);
  const off = await call('PUT', '/api/classrooms/1', { user: 100, body: { keepsakeEnabled: false } });
  assert.equal(off.status, 200); assert.equal(off.json.keepsake_enabled, 0);
  const s = await call('GET', '/api/student-portrait/keepsake', { student: 1001 });
  assert.equal(s.status, 403); assert.equal(s.json.reason, 'off'); assert.match(s.json.error, /turned the keepsake off/);
  assert.equal((await call('GET', '/api/parent-portrait/students/1001', { user: 500 })).status, 403);
  const page = (await call('GET', '/api/student-portrait', { student: 1001 })).json;
  assert.deepEqual([page.keepsake.enabled, page.keepsake.available], [false, false]);
  assert.equal(page.frameworks.length > 0, true, 'the tier 1 portrait page itself is unaffected');
  assert.equal((await call('PUT', '/api/classrooms/1', { user: 100, body: { keepsakeEnabled: true } })).json.keepsake_enabled, 1);
  assert.equal((await call('GET', '/api/student-portrait/keepsake', { student: 1001 })).status, 200);
});

test('TEACHER SWITCH: only the classroom\'s own teacher; only a real true or false; other edits still work without it', async () => {
  reset();
  assert.equal((await call('PUT', '/api/classrooms/1', { user: 200, body: { keepsakeEnabled: false } })).status, 404, 'another teacher');
  assert.equal(db.prepare('SELECT keepsake_enabled FROM classrooms WHERE id = 1').get().keepsake_enabled, 1);
  assert.equal((await call('PUT', '/api/classrooms/1', { body: { keepsakeEnabled: false } })).status, 401);
  for (const bad of ['false', 0, null, 'no', [false]]) {
    await call('PUT', '/api/classrooms/1', { user: 100, body: { keepsakeEnabled: bad } });
    assert.equal(db.prepare('SELECT keepsake_enabled FROM classrooms WHERE id = 1').get().keepsake_enabled, 1, `ignores ${JSON.stringify(bad)}`);
  }
  const edit = await call('PUT', '/api/classrooms/1', { user: 100, body: { name: 'Renamed' } });
  assert.equal(edit.status, 200); assert.equal(edit.json.keepsake_enabled, 1, 'a normal edit leaves the switch alone');
});

test('PARENT: sees their own linked child\'s keepsake (skills and activity names), NEVER the pinned words; no other family\'s child; no student session', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); play(1001, 1);
  const r = reflect(1001, 'My secret reflection words.');
  await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'reflection', sourceId: r } });
  const ok = await call('GET', '/api/parent-portrait/students/1001', { user: 500 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.student.displayName, 'Alex Rivera');
  assert.equal(byCode(ok.json)['2A'].status, 'practiced');
  assert.deepEqual(byCode(ok.json)['2A'].activities.map((a) => a.title), ['Perspective Swap']);
  assert.equal('pins' in ok.json, false, 'no pins field at all');
  assert.ok(!ok.raw.includes('secret reflection'), 'the student\'s own words never reach a parent');
  assert.equal((await call('GET', '/api/parent-portrait/students/1001')).status, 401, 'no login');
  assert.equal((await call('GET', '/api/parent-portrait/students/1001', { student: 1001 })).status, 401, 'a student session is not a parent session');
  assert.equal((await call('GET', '/api/parent-portrait/students/1001', { user: 600 })).status, 404, 'another family\'s parent');
  assert.equal((await call('GET', '/api/parent-portrait/students/3001', { user: 500 })).status, 404, 'a child they are not linked to');
  assert.equal((await call('GET', '/api/parent-portrait/students/1002', { user: 500 })).status, 404, 'a classmate');
  assert.equal((await call('GET', '/api/parent-portrait/students/999999', { user: 500 })).status, 404, 'a student that does not exist looks the same');
  for (const bad of ['abc', '1e3', '-1', '1001x', '%20']) assert.equal((await call('GET', `/api/parent-portrait/students/${bad}`, { user: 500 })).status, 404, `rejects ${bad}`);
  db.prepare('UPDATE classroom_students SET is_active = 0 WHERE id = 1001').run();
  assert.equal((await call('GET', '/api/parent-portrait/students/1001', { user: 500 })).status, 404, 'a removed student');
});

test('PARENT: a child whose class is archived still has a keepsake (the class ends at the end of the year; the family still wants it)', async () => {
  reset(); align(1, 'brain_game', 1, 'direct'); play(1001, 1);
  db.prepare('UPDATE classrooms SET archived_at = ? WHERE id = 1').run(IN_YEAR);
  assert.equal((await call('GET', '/api/student-portrait/keepsake', { student: 1001 })).status, 401, 'the student is cut off, as everywhere');
  assert.equal((await call('GET', '/api/parent-portrait/students/1001', { user: 500 })).status, 200);
});

test('NOTHING IS STORED OR SENT: the keepsake library and routes never write, and the pins table is untouched by opening one', async () => {
  const src = ['lib/portrait-keepsake.js', 'routes/parent-portrait.js'].map((f) => fs.readFileSync(path.join(SERVER, f), 'utf8')).join('\n');
  assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(src.replace(/\/\/.*$/gm, '')), 'no write statement');
  assert.ok(!/mailer|sendMail|nodemailer/i.test(src.replace(/\/\/.*$/gm, '')), 'nothing is emailed');
  reset(); align(1, 'brain_game', 1, 'direct'); play(1001, 1);
  const before = db.prepare('SELECT COUNT(*) AS n FROM student_portrait_pins').get().n;
  await call('GET', '/api/student-portrait/keepsake', { student: 1001 });
  await call('GET', '/api/parent-portrait/students/1001', { user: 500 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_portrait_pins').get().n, before);
});

test('BEFORE THE ALTER SCRIPT: a missing keepsake_enabled column does not break the portrait or the keepsake (the switch simply counts as on)', async () => {
  reset(); align(1, 'brain_game', 1, 'direct'); play(1001, 1);
  const orig = run;
  const room = await keep.loadClassroom(1);
  assert.equal(room.id, 1);
  // Simulate the column being absent: the first query throws the MariaDB error, the fallback query has no such column.
  const pool = require(path.join(SERVER, 'db/pool.js'));
  const saved = pool.query;
  pool.query = async (sql, params) => {
    if (/keepsake_enabled/.test(sql)) { const e = new Error('Unknown column'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    return saved(sql, params);
  };
  try {
    const noCol = await keep.loadClassroom(1);
    assert.equal(noCol.id, 1);
    assert.equal(keep.keepsakeStatus(noCol).enabled, true);
    assert.equal((await call('GET', '/api/student-portrait', { student: 1001 })).json.keepsake.available, true);
    assert.equal((await call('PUT', '/api/classrooms/1', { user: 100, body: { name: 'Edited', keepsakeEnabled: false } })).status, 200, 'the edit saves even though the switch cannot');
  } finally { pool.query = saved; }
  assert.equal(typeof orig, 'function');
});
