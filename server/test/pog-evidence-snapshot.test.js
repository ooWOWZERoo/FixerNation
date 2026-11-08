// Graduate Evidence year snapshot (docs/reference/pog-evidence-requirements.md section 14): de-identified year totals written once,
// before a purge. Runs the real lib/pog-evidence-snapshot.js on a real SQL engine (node:sqlite).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 1);
CREATE TABLE curriculum_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, audience TEXT);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, band TEXT, active INTEGER DEFAULT 1);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE standards_frameworks (
  id INTEGER PRIMARY KEY, state_code TEXT, framework_type TEXT, name TEXT, issuing_body TEXT, official_url TEXT,
  review_status TEXT DEFAULT 'draft', reviewed_at TEXT, district_id INTEGER);
CREATE TABLE standards_items (id INTEGER PRIMARY KEY, framework_id INTEGER, code TEXT, title TEXT, summary TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE standards_alignments (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, target_type TEXT, target_id INTEGER DEFAULT 0, strength TEXT, rationale TEXT, review_status TEXT DEFAULT 'draft');
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, teacher_site_user_id INTEGER);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, curriculum_id INTEGER);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, game_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, completed_at TEXT);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_assignment_id INTEGER, completed_at TEXT);
CREATE TABLE brain_game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_id INTEGER, completed_at TEXT, validation_status TEXT DEFAULT 'valid');
CREATE TABLE pog_evidence_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, state_code TEXT NOT NULL, school_year_start INTEGER NOT NULL, classroom_id INTEGER NOT NULL,
  framework_id INTEGER NOT NULL, framework_name TEXT NOT NULL, item_id INTEGER NOT NULL, item_code TEXT NOT NULL, item_title TEXT NOT NULL,
  students_counted INTEGER NOT NULL, practiced INTEGER NOT NULL, touched INTEGER NOT NULL, activities_finished INTEGER NOT NULL,
  direct_activities INTEGER NOT NULL, supporting_activities INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (state_code, school_year_start, classroom_id, item_id));
`);
const run = async (sql, params = []) => {
  const s = sql.trim();
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const poolPath = path.join(SERVER, 'db/pool.js');
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { if (Module._resolveFilename(request, parent) === poolPath) return { query: run }; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const pog = require(path.join(SERVER, 'lib/pog-evidence.js'));
const snap = require(path.join(SERVER, 'lib/pog-evidence-snapshot.js'));

const IN_YEAR = '2026-10-15 10:00:00';   // school year 2026-2027
const AUG_2027 = new Date('2027-08-20T12:00:00Z'); // the 2026-2027 year has ended
const MAY_2027 = new Date('2027-05-01T12:00:00Z'); // it has not

function reset() {
  for (const t of ['pog_evidence_snapshots', 'standards_alignments', 'standards_items', 'standards_frameworks', 'districts', 'curriculum_audiences', 'curricula', 'brain_games',
    'classroom_students', 'classrooms', 'classroom_assignments', 'classroom_game_assignments', 'student_lesson_progress', 'student_game_completions', 'brain_game_sessions']) db.exec(`DELETE FROM ${t}`);
  db.exec(`
INSERT INTO brain_games (id, name, slug, band, active) VALUES (1, 'Perspective Swap', 'perspective-swap', 'advance', 1), (2, 'Sharing Circle', 'sharing-circle', 'discover', 1);
INSERT INTO curricula (id, title, published) VALUES (10, 'Pause Before You Escalate - Lesson Plan 1 - ES', 1);
INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (10, 'Elementary School');
INSERT INTO standards_frameworks (id, state_code, framework_type, name, issuing_body, official_url, review_status, reviewed_at, district_id) VALUES
  (1, 'NY', 'sel_standards', 'NY SEL Benchmarks', 'NYSED', 'https://example.org/sel', 'verified', '2026-11-01 00:00:00', NULL),
  (2, 'NY', 'portrait_of_graduate', 'NY Portrait', 'NYSED', 'https://example.org/pog', 'verified', '2026-11-01 00:00:00', NULL);
INSERT INTO standards_items (id, framework_id, code, title, sort_order) VALUES (1, 1, '2A', 'Empathy', 1), (2, 1, '1B', 'Identity and agency', 2), (3, 2, 'GC', 'Global Citizen', 1);
`);
}
const align = (itemId, type, targetId, strength, status = 'verified') =>
  db.prepare('INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?, ?, ?, ?, ?, ?)').run(itemId, type, targetId, strength, 'Because.', status);
const classroom = (id, n, inactiveFrom = 0) => {
  db.prepare('INSERT INTO classrooms (id, teacher_site_user_id) VALUES (?, 1)').run(id);
  for (let i = 1; i <= n; i++) db.prepare('INSERT INTO classroom_students (id, classroom_id, display_name, is_active) VALUES (?, ?, ?, ?)').run(id * 1000 + i, id, `Kid ${i}`, inactiveFrom && i >= inactiveFrom ? 0 : 1);
  return id * 1000;
};
const play = (sid, gid, at = IN_YEAR) => db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at) VALUES (?, ?, ?)').run(sid, gid, at);
const lesson = (sid, cid, at = IN_YEAR) => db.prepare('INSERT INTO student_lesson_progress (student_id, curriculum_id, completed_at) VALUES (?, ?, ?)').run(sid, cid, at);
const rows = (where = '1=1', ...p) => db.prepare(`SELECT * FROM pog_evidence_snapshots WHERE ${where} ORDER BY item_code`).all(...p);

test('a year that has not ended cannot be saved', async () => {
  reset(); classroom(10, 3);
  await assert.rejects(() => snap.snapshotClassroomYear({ classroomId: 10, schoolYearStart: 2026, today: MAY_2027 }), /not ended/);
  await assert.rejects(() => snap.snapshotYear({ schoolYearStart: 2026, apply: true, today: MAY_2027 }), /not ended/);
  assert.equal(rows().length, 0);
  assert.equal(snap.schoolYearHasEnded(2026, new Date('2027-07-31T23:59:00Z')), false);
  assert.equal(snap.schoolYearHasEnded(2026, new Date('2027-08-01T00:00:00Z')), true);
  assert.equal(snap.lastEndedSchoolYear(new Date('2027-07-31T12:00:00Z')), 2025);
  assert.equal(snap.lastEndedSchoolYear(new Date('2027-08-01T12:00:00Z')), 2026);
});

test('one row per attribute with the right counts, and every connected activity finish counted once per student', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); align(1, 'curriculum', 10, 'supporting'); align(3, 'brain_game', 2, 'supporting');
  const base = classroom(10, 4);
  play(base + 1, 1); play(base + 1, 1); play(base + 1, 1);       // three plays of one game: one finish
  play(base + 2, 1); lesson(base + 2, 10);                       // practiced 2A (direct) and also did the supporting lesson: two finishes
  lesson(base + 3, 10);                                          // only the supporting lesson: touched
  play(base + 4, 2);                                             // touched Global Citizen only
  const res = await snap.snapshotClassroomYear({ classroomId: 10, schoolYearStart: 2026, today: AUG_2027 });
  assert.deepEqual(res, { status: 'written', rows: 3 });
  const r = Object.fromEntries(rows().map((x) => [x.item_code, x]));
  assert.deepEqual([r['2A'].students_counted, r['2A'].practiced, r['2A'].touched, r['2A'].activities_finished, r['2A'].direct_activities, r['2A'].supporting_activities], [4, 2, 1, 4, 1, 1]);
  assert.deepEqual([r.GC.practiced, r.GC.touched, r.GC.activities_finished, r.GC.direct_activities, r.GC.supporting_activities], [0, 1, 1, 0, 1]);
  assert.deepEqual([r['1B'].practiced, r['1B'].touched, r['1B'].activities_finished, r['1B'].direct_activities, r['1B'].supporting_activities], [0, 0, 0, 0, 0], 'an unconnected item is recorded as having no connection, not as a score');
  assert.equal(r['2A'].framework_name, 'NY SEL Benchmarks');
});

test('removed students, other years, draft connections and other classrooms stay out of the numbers', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); align(2, 'brain_game', 2, 'direct', 'draft');
  const a = classroom(10, 4, 3);  // students 3 and 4 removed
  const b = classroom(20, 2);
  play(a + 1, 1); play(a + 3, 1);                       // the removed student's play does not count
  play(a + 2, 1, '2026-05-01 10:00:00');                // last school year
  play(b + 1, 1);                                       // another classroom
  await snap.snapshotClassroomYear({ classroomId: 10, schoolYearStart: 2026, today: AUG_2027 });
  const r = Object.fromEntries(rows('classroom_id = 10').map((x) => [x.item_code, x]));
  assert.deepEqual([r['2A'].students_counted, r['2A'].practiced], [2, 1]);
  assert.equal(r['1B'].direct_activities, 0, 'a draft connection never counts');
  assert.equal(rows('classroom_id = 20').length, 0, 'only the classroom asked about is written');
});

test('a snapshot is written once and never recomputed, even after the students are gone', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const base = classroom(10, 3);
  play(base + 1, 1); play(base + 2, 1);
  await snap.snapshotClassroomYear({ classroomId: 10, schoolYearStart: 2026, today: AUG_2027 });
  const before = JSON.stringify(rows());
  db.exec('DELETE FROM classroom_students; DELETE FROM brain_game_sessions;');   // the purge
  assert.deepEqual(await snap.snapshotClassroomYear({ classroomId: 10, schoolYearStart: 2026, today: AUG_2027 }), { status: 'exists', rows: 0 });
  assert.equal(JSON.stringify(rows()), before, 'the saved totals are exactly as they were');
  assert.equal(rows().find((x) => x.item_code === '2A').practiced, 2);
});

test('a classroom with no active students writes nothing', async () => {
  reset(); align(1, 'brain_game', 1, 'direct');
  classroom(10, 2, 1);   // both removed
  classroom(11, 0);
  assert.deepEqual(await snap.snapshotClassroomYear({ classroomId: 10, schoolYearStart: 2026, today: AUG_2027 }), { status: 'no_students', rows: 0 });
  assert.deepEqual(await snap.snapshotClassroomYear({ classroomId: 11, schoolYearStart: 2026, today: AUG_2027 }), { status: 'no_students', rows: 0 });
  assert.equal(rows().length, 0);
});

test('the year run: a dry run writes nothing, --apply writes each classroom once, a second run changes nothing', async () => {
  reset(); align(1, 'brain_game', 1, 'direct');
  const a = classroom(10, 3), b = classroom(20, 2); classroom(30, 2, 1);
  play(a + 1, 1); play(b + 1, 1);
  const dry = await snap.snapshotYear({ schoolYearStart: 2026, today: AUG_2027 });
  assert.deepEqual([dry.applied, dry.classrooms, dry.written], [false, 2, 0]);
  assert.equal(rows().length, 0, 'dry run');
  const real = await snap.snapshotYear({ schoolYearStart: 2026, apply: true, today: AUG_2027 });
  assert.deepEqual([real.applied, real.classrooms, real.written, real.rows], [true, 2, 2, 6]);
  assert.equal(rows().length, 6);
  const again = await snap.snapshotYear({ schoolYearStart: 2026, apply: true, today: AUG_2027 });
  assert.deepEqual([again.classrooms, again.written], [0, 0], 'already-saved classrooms are not even listed');
  assert.equal(rows().length, 6);
});

test('no student id, name or text is stored: the table has only counts and labels', () => {
  const cols = db.prepare('PRAGMA table_info(pog_evidence_snapshots)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /student_id|display_name|name$|email|text|reflection|goal/.test(c.replace('framework_name', '').replace('item_title', ''))), cols.join(','));
  assert.ok(cols.includes('classroom_id'));
});

test('bad input is refused', async () => {
  await assert.rejects(() => snap.snapshotClassroomYear({ classroomId: 'x', schoolYearStart: 2026, today: AUG_2027 }), /Not a classroom/);
  await assert.rejects(() => snap.snapshotClassroomYear({ classroomId: 1, schoolYearStart: 'banana', today: AUG_2027 }), /not a school year/);
});
