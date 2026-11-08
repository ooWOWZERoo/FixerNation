// Graduate Evidence library (docs/reference/pog-evidence-requirements.md): verified connections x finished activity.
// Runs the real lib/pog-evidence.js and lib/standards.js on a real SQL engine (node:sqlite), like test/standards.test.js.
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
`);
const run = async (sql, params = []) => [db.prepare(sql.trim()).all(...params)];
const poolPath = path.join(SERVER, 'db/pool.js');
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { if (Module._resolveFilename(request, parent) === poolPath) return { query: run }; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const pog = require(path.join(SERVER, 'lib/pog-evidence.js'));

const IN_YEAR = '2026-10-15 10:00:00';  // school year 2026-2027
const LAST_YEAR = '2026-05-01 10:00:00';
const NEXT_YEAR = '2027-08-01 00:00:00';

function reset() {
  for (const t of ['standards_alignments', 'standards_items', 'standards_frameworks', 'districts', 'curriculum_audiences', 'curricula', 'brain_games',
    'classroom_students', 'classrooms', 'classroom_assignments', 'classroom_game_assignments', 'student_lesson_progress', 'student_game_completions', 'brain_game_sessions']) db.exec(`DELETE FROM ${t}`);
  db.exec(`
INSERT INTO brain_games (id, name, slug, band, active) VALUES (1, 'Perspective Swap', 'perspective-swap', 'advance', 1), (2, 'Sharing Circle', 'sharing-circle', 'discover', 1),
  (3, 'Retired Game', 'retired', 'advance', 0), (4, 'Peer Pressure Pause', 'peer-pressure-pause', 'challenge', 1);
INSERT INTO curricula (id, title, published) VALUES (10, 'Pause Before You Escalate - Lesson Plan 1 - ES', 1), (11, 'Pause Before You Escalate - Lesson Plan 1 - MS', 1),
  (12, 'Pause Before You Escalate - Lesson Plan 1 - HS', 1), (13, 'Pause Before You Escalate - Lesson Plan 1 - HE', 1), (20, 'Draft Lesson - Lesson Plan 1 - MS', 0);
INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (10, 'Elementary School'), (11, 'Middle School'), (12, 'High School'), (13, 'Higher Education'), (20, 'Middle School');
INSERT INTO districts (id, name) VALUES (1, 'A district');
-- A verified NY SEL framework with 3 items, a verified NY PoG framework, a DRAFT NY framework, a verified framework of one district, and a verified TX one.
INSERT INTO standards_frameworks (id, state_code, framework_type, name, issuing_body, official_url, review_status, reviewed_at, district_id) VALUES
  (1, 'NY', 'sel_standards', 'NY SEL Benchmarks', 'NYSED', 'https://example.org/sel', 'verified', '2026-11-01 00:00:00', NULL),
  (2, 'NY', 'portrait_of_graduate', 'NY Portrait', 'NYSED', 'https://example.org/pog', 'verified', '2026-11-01 00:00:00', NULL),
  (3, 'NY', 'sel_standards', 'NY Draft Framework', 'NYSED', 'https://example.org/draft', 'draft', NULL, NULL),
  (4, 'NY', 'portrait_of_graduate', 'District Portrait', 'A district', 'https://example.org/d', 'verified', '2026-11-01 00:00:00', 1),
  (5, 'TX', 'sel_standards', 'TX SEL', 'TEA', 'https://example.org/tx', 'verified', '2026-11-01 00:00:00', NULL);
INSERT INTO standards_items (id, framework_id, code, title, sort_order) VALUES
  (1, 1, '2A', 'Empathy', 1), (2, 1, '3B', 'Decision-making', 2), (3, 1, '1B', 'Identity and agency', 3),
  (4, 2, 'GC', 'Global Citizen', 1), (5, 3, 'X1', 'Draft item', 1), (6, 4, 'D1', 'District item', 1), (7, 5, 'T1', 'Texas item', 1);
`);
}
const align = (itemId, type, targetId, strength, status = 'verified') =>
  db.prepare('INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?, ?, ?, ?, ?, ?)').run(itemId, type, targetId, strength, 'Because.', status);
const classroom = (id, n, extra = {}) => {
  db.prepare('INSERT INTO classrooms (id, teacher_site_user_id) VALUES (?, 1)').run(id);
  const base = id * 1000;
  for (let i = 1; i <= n; i++) db.prepare('INSERT INTO classroom_students (id, classroom_id, display_name, is_active) VALUES (?, ?, ?, ?)').run(base + i, id, `Kid ${i}`, extra.inactiveFrom && i >= extra.inactiveFrom ? 0 : 1);
  return base;
};
const finishLesson = (sid, cid, at = IN_YEAR) => db.prepare('INSERT INTO student_lesson_progress (student_id, curriculum_id, completed_at) VALUES (?, ?, ?)').run(sid, cid, at);
const playGame = (sid, gid, at = IN_YEAR, valid = 'valid') => db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at, validation_status) VALUES (?, ?, ?, ?)').run(sid, gid, at, valid);
const evidence = async (classroomIds, start = 2026) => {
  const connections = await pog.loadConnections('NY');
  return { connections, ev: await pog.classroomEvidence({ classroomIds, schoolYearStart: start, connections }) };
};
const itemId = (connections, code) => connections.frameworks.flatMap((f) => f.items).find((i) => i.code === code).id;

test('school years run 1 August to 31 July', () => {
  assert.equal(pog.schoolYearStartOf('2026-08-01'), 2026);
  assert.equal(pog.schoolYearStartOf('2026-07-31'), 2025);
  assert.equal(pog.schoolYearStartOf('2027-01-15 08:00:00'), 2026);
  assert.deepEqual(pog.schoolYearBounds(2026), { from: '2026-08-01 00:00:00', to: '2027-08-01 00:00:00', label: '2026–2027' });
  assert.throws(() => pog.schoolYearBounds('banana'), /not a school year/);
});

test('only VERIFIED connections in a VERIFIED state framework count; drafts, district and other-state frameworks never do', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');                 // verified, counts
  align(2, 'brain_game', 1, 'direct', 'draft');        // draft alignment: never counts
  align(5, 'brain_game', 1, 'direct');                 // inside a draft framework
  align(6, 'brain_game', 1, 'direct');                 // a district's own framework
  align(7, 'brain_game', 1, 'direct');                 // another state
  const c = await pog.loadConnections('NY');
  assert.deepEqual(c.frameworks.map((f) => f.name).sort(), ['NY Portrait', 'NY SEL Benchmarks'], 'the draft and district frameworks are not even listed');
  assert.deepEqual(c.frameworks.flatMap((f) => f.items).filter((i) => i.direct.length).map((i) => i.code), ['2A']);
  const b = base(c);
  assert.equal(b['3B'].direct.length, 0, 'a draft alignment does not make 3B connected');
});
const base = (c) => Object.fromEntries(c.frameworks.flatMap((f) => f.items).map((i) => [i.code, i]));

test('an item with no verified connection says so; it is not shown as 0%', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const k = classroom(10, 4);
  const conns = await pog.loadConnections('NY');
  const rep = await pog.teacherClassroomReport({ classroomId: 10, schoolYearStart: 2026, connections: conns });
  const items = Object.fromEntries(rep.frameworks.flatMap((f) => f.items).map((i) => [i.code, i]));
  assert.equal(items['1B'].status, 'no_connection');
  assert.equal(items['1B'].practiced, undefined, 'no number at all for an item nothing is connected to');
  assert.equal(items['2A'].status, 'ok');
  assert.equal(items['2A'].practiced, 0, 'a connected item nobody practiced is a real 0');
  assert.equal(k, 10000);
});

test('PRACTICED needs a finished direct activity; supporting only makes a student TOUCHED; direct wins over supporting', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  align(1, 'brain_game', 2, 'supporting');
  const base0 = classroom(10, 5);
  playGame(base0 + 1, 1);                 // direct only -> practiced
  playGame(base0 + 2, 2);                 // supporting only -> touched
  playGame(base0 + 3, 1); playGame(base0 + 3, 2); // both -> practiced, not also touched
  const { connections, ev } = await evidence([10]);
  const c = ev.get(10), id = itemId(connections, '2A');
  assert.equal(c.students, 5);
  assert.deepEqual(c.items[id], { practiced: 2, touched: 1 });
});

test('finishing the same activity ten times, or by assigned play AND free play, counts once', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const b = classroom(10, 3);
  for (let i = 0; i < 10; i++) playGame(b + 1, 1);
  db.prepare('INSERT INTO classroom_game_assignments (id, classroom_id, game_id) VALUES (1, 10, 1)').run();
  db.prepare('INSERT INTO student_game_completions (student_id, game_assignment_id, completed_at) VALUES (?, 1, ?)').run(b + 2, IN_YEAR);
  db.prepare('INSERT INTO student_game_completions (student_id, game_assignment_id, completed_at) VALUES (?, 1, ?)').run(b + 2, IN_YEAR);
  playGame(b + 2, 1);                      // student 2 also played it freely
  const { connections, ev } = await evidence([10]);
  assert.equal(ev.get(10).items[itemId(connections, '2A')].practiced, 2, 'two different students, however many plays');
});

test('unfinished, invalid and out-of-year activity does not count; the school year is placed by finish date', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const b = classroom(10, 5);
  db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at) VALUES (?, 1, NULL)').run(b + 1); // started only
  playGame(b + 2, 1, IN_YEAR, 'invalid');   // flagged invalid
  playGame(b + 3, 1, LAST_YEAR);            // last school year
  playGame(b + 4, 1, NEXT_YEAR);            // next school year
  playGame(b + 5, 1, IN_YEAR);              // counts
  const { connections, ev } = await evidence([10]);
  assert.equal(ev.get(10).items[itemId(connections, '2A')].practiced, 1);
  const last = await pog.classroomEvidence({ classroomIds: [10], schoolYearStart: 2025, connections });
  assert.equal(last.get(10).items[itemId(connections, '2A')].practiced, 1, 'the student who finished in May is in the 2025-2026 year');
});

test('removed students are left out of both sides of the percentage', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const b = classroom(10, 4, { inactiveFrom: 4 });   // student 4 removed
  playGame(b + 1, 1); playGame(b + 4, 1);
  const { connections, ev } = await evidence([10]);
  assert.equal(ev.get(10).students, 3);
  assert.equal(ev.get(10).items[itemId(connections, '2A')].practiced, 1, 'the removed student does not count');
});

test('a lesson connection covers every K-12 grade version but not higher education', async () => {
  reset();
  align(2, 'curriculum', 11, 'direct');     // stored against the middle-school copy
  const b = classroom(10, 5);
  finishLesson(b + 1, 10);   // elementary copy
  finishLesson(b + 2, 11);   // middle copy
  finishLesson(b + 3, 12);   // high school copy
  finishLesson(b + 4, 13);   // higher-education copy: outside K-12 standards
  const { connections, ev } = await evidence([10]);
  assert.equal(ev.get(10).items[itemId(connections, '3B')].practiced, 3);
});

test('a connection to a retired game or an unpublished lesson is not evidence of anything', async () => {
  reset();
  align(1, 'brain_game', 3, 'direct');       // retired
  align(2, 'curriculum', 20, 'direct');      // unpublished
  align(3, 'program', 0, 'direct');          // "FNE as a whole" is not an activity
  const c = await pog.loadConnections('NY');
  assert.ok(c.frameworks.flatMap((f) => f.items).every((i) => !i.direct.length && !i.supporting.length));
});

test('classroomEvidence returns nothing for a classroom it was not asked about', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const a = classroom(10, 3), other = classroom(20, 3);
  playGame(a + 1, 1); playGame(other + 1, 1);
  const { connections, ev } = await evidence([10]);
  assert.deepEqual([...ev.keys()], [10]);
  assert.equal(ev.get(10).items[itemId(connections, '2A')].practiced, 1);
});

// ---- the small-group rule --------------------------------------------------------------------------------------------
const g = (key, students, practiced = 0) => ({ key, label: key, students, items: { 1: { practiced, touched: 0 } } });

test('SMALL GROUPS: a group under the minimum is merged, never shown on its own, and nothing under the minimum is left', () => {
  const r = pog.groupWithMinimum([g('big', 30, 20), g('tiny', 3, 1), g('small', 8, 2)], 10);
  assert.equal(r.suppressed, false);
  assert.ok(r.groups.every((x) => x.students >= 10), 'no group under 10 is shown');
  assert.deepEqual(r.groups.map((x) => [x.key, x.students]), [['big', 30], ['other', 11]], 'the two small groups are pooled (3 + 8) and the pool is big enough to show');
  assert.deepEqual(r.groups.find((x) => x.key === 'other').items[1], { practiced: 3, touched: 0 });
  assert.equal(r.total.students, 41);
});

test('SMALL GROUPS: when the leftovers are still under the minimum they take the smallest visible group with them (no subtraction trick)', () => {
  const r = pog.groupWithMinimum([g('a', 12), g('b', 15), g('tiny', 2)], 10);
  assert.ok(r.groups.every((x) => x.students >= 10));
  const other = r.groups.find((x) => x.key === 'other');
  assert.equal(other.students, 14, 'the 2 leftover students are folded into the 12-student group, so they cannot be worked out by subtraction');
  assert.deepEqual(r.groups.map((x) => x.key).sort(), ['b', 'other']);
});

test('SMALL GROUPS: if everything together is under the minimum there are no figures at all', async () => {
  assert.deepEqual(pog.groupWithMinimum([g('a', 4), g('b', 3)], 10), { suppressed: true, min: 10, groups: [], total: null });
  reset();
  align(1, 'brain_game', 1, 'direct');
  const b = classroom(10, 6); playGame(b + 1, 1);
  const rep = await pog.groupedReport({ groups: [{ key: 'c', label: 'C', classroomIds: [10] }], schoolYearStart: 2026, min: 10 });
  assert.equal(rep.suppressed, true);
  const gc = rep.frameworks.flatMap((f) => f.items).find((i) => i.code === '2A');
  assert.equal(gc.practiced, undefined, 'a hidden group shows no practiced count');
  assert.equal(gc.students, undefined);
  assert.equal(JSON.stringify(rep).includes('Kid'), false, 'no student name anywhere');
});

test('groupedReport rolls classrooms up, merges small ones and never returns a name', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');
  const a = classroom(10, 12), b = classroom(20, 11), c = classroom(30, 3);
  for (let i = 1; i <= 6; i++) playGame(a + i, 1);
  for (let i = 1; i <= 3; i++) playGame(b + i, 1);
  playGame(c + 1, 1);
  const rep = await pog.groupedReport({ groups: [
    { key: 'a', label: 'Classroom A', classroomIds: [10] }, { key: 'b', label: 'Classroom B', classroomIds: [20] }, { key: 'c', label: 'Classroom C', classroomIds: [30] }], schoolYearStart: 2026, min: 10 });
  assert.equal(rep.suppressed, false);
  assert.equal(rep.students, 26);
  const it = rep.frameworks.flatMap((f) => f.items).find((i) => i.code === '2A');
  assert.equal(it.practiced, 10);
  assert.ok(rep.groups.every((x) => x.students >= 10));
  assert.ok(!JSON.stringify(rep).includes('Kid '));
  assert.equal(rep.connectedItems, 1);
});

// ---- suggestions -------------------------------------------------------------------------------------------------
test('suggestions: verified direct activities only, matched to the teacher\'s grade levels, not already assigned', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct');   // advance
  align(1, 'brain_game', 2, 'direct');   // discover
  align(1, 'brain_game', 4, 'supporting'); // supporting is never suggested
  align(1, 'curriculum', 11, 'direct');
  classroom(10, 3);
  const connections = await pog.loadConnections('NY');
  const item = connections.frameworks.flatMap((f) => f.items).find((i) => i.code === '2A');
  const hs = await pog.suggestionsForItem({ item, classroomId: 10, teacherLevels: ['High School'], connections });
  assert.deepEqual(hs.map((s) => `${s.type}:${s.title}`).sort(), ['game:Perspective Swap', 'lesson:Pause Before You Escalate']);
  assert.equal(hs.find((s) => s.type === 'lesson').level, 'High school', 'the high-school copy, not the middle-school one the connection is stored on');
  assert.equal(hs.find((s) => s.type === 'lesson').id, 12);
  const es = await pog.suggestionsForItem({ item, classroomId: 10, teacherLevels: ['Elementary School'], connections });
  assert.deepEqual(es.map((s) => s.title).sort(), ['Pause Before You Escalate', 'Sharing Circle']);
  db.prepare('INSERT INTO classroom_game_assignments (classroom_id, game_id) VALUES (10, 1)').run();
  db.prepare('INSERT INTO classroom_assignments (classroom_id, curriculum_id) VALUES (10, 12)').run();
  const after = await pog.suggestionsForItem({ item, classroomId: 10, teacherLevels: ['High School'], connections });
  assert.deepEqual(after, [], 'already assigned: nothing left to suggest');
});

// ---- the "ideas" box ----------------------------------------------------------------------------------------------
const ideas = async (classroomId, teacherLevels, limit) => {
  const connections = await pog.loadConnections('NY');
  const report = await pog.teacherClassroomReport({ classroomId, schoolYearStart: 2026, connections });
  const candidates = await pog.candidatePool({ classroomId, teacherLevels, connections });
  return pog.bestNextSteps({ report, connections, pool: candidates, ...(limit ? { limit } : {}) });
};
function ideasScene() {
  reset();
  align(1, 'brain_game', 1, 'direct');     // Perspective Swap (advance): empathy 2A
  align(4, 'brain_game', 1, 'direct');     //   ... and Global Citizen GC
  align(1, 'brain_game', 2, 'direct');     // Sharing Circle (discover): 2A only
  align(2, 'brain_game', 4, 'direct');     // Peer Pressure Pause (challenge): 3B
  align(2, 'curriculum', 11, 'direct');    // a lesson for 3B (stored on the middle-school copy)
  align(3, 'brain_game', 1, 'supporting'); // supporting never makes a pick
  return classroom(10, 5);
}

test('IDEAS: picks the activity that adds the most attributes first, and says which it adds', async () => {
  ideasScene();
  const picks = await ideas(10, ['High School']);
  assert.equal(picks[0].title, 'Perspective Swap');
  assert.deepEqual(picks[0].adds.map((a) => a.code).sort(), ['2A', 'GC']);
  assert.equal(picks[1].type, 'lesson');
  assert.equal(picks[1].level, 'High school', 'the high-school copy of the lesson, not the middle-school one the connection is stored on');
  assert.deepEqual(picks[1].adds.map((a) => a.code), ['3B']);
  assert.equal(picks.length, 2, 'nothing else adds a new attribute, so there is no third pick');
});

test('IDEAS: each pick must add something new (no pick repeats what an earlier pick covered)', async () => {
  ideasScene();
  const picks = await ideas(10, null);   // no registered level: every band
  const seen = new Set();
  for (const p of picks) { assert.ok(p.adds.length > 0); for (const a of p.adds) { assert.ok(!seen.has(a.code), `${a.code} is added only once`); seen.add(a.code); } }
  assert.deepEqual([...seen].sort(), ['2A', '3B', 'GC']);
});

test('IDEAS: matched to the teacher\'s grade levels, so an elementary class is not offered the high-school game', async () => {
  ideasScene();
  const picks = await ideas(10, ['Elementary School']);
  assert.deepEqual(picks.map((p) => p.title).sort(), ['Pause Before You Escalate', 'Sharing Circle']);
  assert.deepEqual(picks.find((p) => p.title === 'Sharing Circle').adds.map((a) => a.code), ['2A']);
});

test('IDEAS: leaves out what the classroom already has, and an attribute everyone has practiced is not a gap', async () => {
  const b = ideasScene();
  db.prepare('INSERT INTO classroom_game_assignments (classroom_id, game_id) VALUES (10, 1)').run();
  let picks = await ideas(10, ['High School']);
  assert.ok(!picks.some((p) => p.title === 'Perspective Swap'));
  db.prepare('INSERT INTO classroom_assignments (classroom_id, curriculum_id) VALUES (10, 10)').run();   // the ELEMENTARY copy of the lesson
  picks = await ideas(10, ['High School']);
  assert.ok(!picks.some((p) => p.type === 'lesson'), 'any grade version of a lesson counts as already assigned');
  // Everyone finishes Perspective Swap and Sharing Circle: 2A and GC are no longer gaps.
  for (let i = 1; i <= 5; i++) { playGame(b + i, 1); playGame(b + i, 2); }
  db.exec('DELETE FROM classroom_game_assignments; DELETE FROM classroom_assignments');
  picks = await ideas(10, ['High School']);
  assert.deepEqual(picks.flatMap((p) => p.adds.map((a) => a.code)), ['3B']);
});

test('IDEAS: a classroom with no students gets none, and one that has practiced everything connected gets none', async () => {
  const b = ideasScene();
  db.exec('DELETE FROM classroom_students');
  assert.deepEqual(await ideas(10, ['High School']), []);
  ideasScene();
  const kid = classroom(30, 2);
  for (const sid of [kid + 1, kid + 2]) { playGame(sid, 1); playGame(sid, 2); playGame(sid, 4); finishLesson(sid, 12); }
  assert.deepEqual(await ideas(30, null), []);
});

test('IDEAS: the limit is honoured, and ties go to a game over a lesson, then to the title', async () => {
  reset();
  align(1, 'brain_game', 2, 'direct');     // Sharing Circle: 2A
  align(2, 'brain_game', 4, 'direct');     // Peer Pressure Pause: 3B
  align(3, 'curriculum', 11, 'direct');    // the lesson: 1B
  classroom(10, 4);
  const all = await ideas(10, null);
  assert.equal(all.length, 3);
  assert.equal(all[0].type, 'game', 'a game before the lesson when each adds one attribute');
  assert.deepEqual(all.slice(0, 2).map((p) => p.title), ['Peer Pressure Pause', 'Sharing Circle'], 'then alphabetical');
  assert.equal((await ideas(10, null, 1)).length, 1);
});
