// My Graduate Portrait, tier 1 (docs/reference/graduate-portrait-requirements.md): one student's own evidence of practice, plus up to 3
// pinned words. Runs the real lib/pog-evidence.js, lib/portrait-pins.js and routes/student-portrait.js on a real SQL engine (node:sqlite).
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
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, teacher_site_user_id INTEGER, archived_at TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT, is_active INTEGER DEFAULT 1);
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
  // The student session: x-student carries the id; the real middleware also needs an active student in an unarchived classroom.
  [path.join(SERVER, 'middleware/studentAuth.js')]: {
    requireStudentAuth: (req, res, next) => {
      const id = Number(req.get('x-student'));
      const row = id ? db.prepare('SELECT cs.* FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id WHERE cs.id = ? AND cs.is_active = 1 AND c.archived_at IS NULL').get(id) : null;
      if (!row) return res.status(401).json({ error: 'Not logged in' });
      req.student = row; next();
    },
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const pog = require(path.join(SERVER, 'lib/pog-evidence.js'));
const pins = require(path.join(SERVER, 'lib/portrait-pins.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/student-portrait', require(path.join(SERVER, 'routes/student-portrait.js')));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

const YEAR = pog.currentSchoolYearStart();
const IN_YEAR = `${YEAR}-09-15 10:00:00`;
const LAST_YEAR = `${YEAR - 1}-09-15 10:00:00`;

function call(method, urlPath, { student, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = student ? { 'x-student': String(student) } : {};
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
    'classroom_students', 'classrooms', 'classroom_assignments', 'classroom_game_assignments', 'student_lesson_progress', 'student_game_completions', 'brain_game_sessions']) db.exec(`DELETE FROM ${t}`);
  db.exec(`
INSERT INTO brain_games (id, name, slug, band, active) VALUES (1, 'Perspective Swap', 'perspective-swap', 'advance', 1), (2, 'Sharing Circle', 'sharing-circle', 'discover', 1), (4, 'Peer Pressure Pause', 'peer-pressure-pause', 'challenge', 1);
INSERT INTO curricula (id, title, published) VALUES (10, 'Pause Before You Escalate - Lesson Plan 1 - ES', 1), (11, 'Pause Before You Escalate - Lesson Plan 1 - MS', 1), (13, 'Pause Before You Escalate - Lesson Plan 1 - HE', 1);
INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (10, 'Elementary School'), (11, 'Middle School'), (13, 'Higher Education');
INSERT INTO districts (id, name) VALUES (1, 'A district');
INSERT INTO standards_frameworks (id, state_code, framework_type, name, issuing_body, official_url, review_status, reviewed_at, district_id) VALUES
  (1, 'NY', 'sel_standards', 'NY SEL Benchmarks', 'NYSED', 'https://example.org/sel', 'verified', '2026-11-01 00:00:00', NULL),
  (2, 'NY', 'portrait_of_graduate', 'NY Portrait', 'NYSED', 'https://example.org/pog', 'verified', '2026-11-01 00:00:00', NULL),
  (3, 'NY', 'sel_standards', 'NY Draft Framework', 'NYSED', 'https://example.org/draft', 'draft', NULL, NULL),
  (4, 'NY', 'portrait_of_graduate', 'District Portrait', 'A district', 'https://example.org/d', 'verified', '2026-11-01 00:00:00', 1);
INSERT INTO standards_items (id, framework_id, code, title, summary, sort_order) VALUES
  (1, 1, '2A', 'Empathy', 'Understanding how others feel.', 1), (2, 1, '3B', 'Decision-making', NULL, 2), (3, 1, '1B', 'Identity and agency', NULL, 3),
  (4, 2, 'GC', 'Global Citizen', NULL, 1), (5, 3, 'X1', 'Draft item', NULL, 1), (6, 4, 'D1', 'District item', NULL, 1);
INSERT INTO classrooms (id, teacher_site_user_id) VALUES (1, 100), (2, 200);
INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (1001, 1, 'Alex Rivera'), (1002, 1, 'Sam Lee'), (2001, 2, 'Jordan Poe');
`);
}
const align = (itemId, type, targetId, strength, status = 'verified') =>
  db.prepare('INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?, ?, ?, ?, ?, ?)').run(itemId, type, targetId, strength, 'Because.', status);
const play = (sid, gid, at = IN_YEAR) => db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at) VALUES (?, ?, ?)').run(sid, gid, at);
const lesson = (sid, cid, at = IN_YEAR) => db.prepare('INSERT INTO student_lesson_progress (student_id, curriculum_id, completed_at) VALUES (?, ?, ?)').run(sid, cid, at);
const reflect = (sid, text, at = IN_YEAR, cid = 10) => Number(db.prepare('INSERT INTO student_reflections (student_id, curriculum_id, prompt_key, response_text, submitted_at) VALUES (?, ?, ?, ?, ?)').run(sid, cid, 'p1', text, at).lastInsertRowid);
const goal = (sid, text, at = IN_YEAR) => Number(db.prepare('INSERT INTO student_goals (student_id, goal_text, created_at) VALUES (?, ?, ?)').run(sid, text, at).lastInsertRowid);
const byCode = (p) => Object.fromEntries(p.frameworks.flatMap((f) => f.items).map((i) => [i.code, i]));

test('STATUSES: practiced = a finished direct activity; touched = only a supporting one; not yet; no connection', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); align(1, 'curriculum', 10, 'supporting');   // 2A
  align(2, 'brain_game', 2, 'supporting');                                           // 3B (supporting only)
  align(4, 'brain_game', 4, 'direct');                                               // GC (direct, not finished)
  // 1B has nothing connected
  play(1001, 1); lesson(1001, 10); play(1001, 2);
  const p = byCode(await pog.studentPortrait({ studentId: 1001, schoolYearStart: YEAR }));
  assert.equal(p['2A'].status, 'practiced');
  assert.equal(p['3B'].status, 'touched');
  assert.equal(p.GC.status, 'not_yet');
  assert.equal(p['1B'].status, 'no_connection', 'nothing connected is not the same as nothing practiced');
  assert.deepEqual(p['2A'].activities.map((a) => `${a.strength}:${a.title}`), ['direct:Perspective Swap', 'supporting:Pause Before You Escalate'], 'direct first');
  assert.deepEqual(p.GC.activities, [], 'an activity the student has not finished is never listed');
});

test('ONLY the student\'s own, finished, in-year, verified activity counts; the summary counts attributes, not scores', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); align(5, 'brain_game', 1, 'direct'); align(6, 'brain_game', 1, 'direct'); align(4, 'brain_game', 2, 'direct', 'draft');
  play(1002, 1);                       // another student's play
  play(1001, 1, LAST_YEAR);            // last school year
  db.prepare("INSERT INTO brain_game_sessions (student_id, game_id, completed_at, validation_status) VALUES (1001, 1, ?, 'invalid')").run(IN_YEAR);
  db.prepare('INSERT INTO brain_game_sessions (student_id, game_id, completed_at) VALUES (1001, 1, NULL)').run();
  let p = await pog.studentPortrait({ studentId: 1001, schoolYearStart: YEAR });
  assert.deepEqual(p.summary, { items: 4, connected: 1, practiced: 0, touched: 0 }, 'only the two verified frameworks are listed; nothing of Alex\'s counts yet');
  assert.deepEqual(p.frameworks.map((f) => f.name).sort(), ['NY Portrait', 'NY SEL Benchmarks'], 'draft and district frameworks never appear');
  play(1001, 1);
  p = await pog.studentPortrait({ studentId: 1001, schoolYearStart: YEAR });
  assert.deepEqual(p.summary, { items: 4, connected: 1, practiced: 1, touched: 0 });
  assert.ok(!/score|quiz|accuracy|percent|rank|level|streak|grade/i.test(JSON.stringify(p).replace(/gradeLevel/g, '')), 'no score-like field anywhere in the answer');
});

test('a lesson connection covers the grade versions but not higher education', async () => {
  reset();
  align(1, 'curriculum', 10, 'direct');
  lesson(1001, 11);                                  // the middle-school copy
  lesson(1002, 13);                                  // the higher-education copy
  assert.equal(byCode(await pog.studentPortrait({ studentId: 1001, schoolYearStart: YEAR }))['2A'].status, 'practiced');
  assert.equal(byCode(await pog.studentPortrait({ studentId: 1002, schoolYearStart: YEAR }))['2A'].status, 'not_yet');
});

test('bad student ids are refused', async () => {
  await assert.rejects(() => pog.studentPortrait({ studentId: 'x', schoolYearStart: YEAR }), /Not a student/);
});

test('ROUTE: no session is 401; a student sees only their own portrait and name; a client-sent student id is ignored', async () => {
  reset();
  align(1, 'brain_game', 1, 'direct'); align(1, 'brain_game', 2, 'direct');
  play(1001, 1); play(2001, 2);
  assert.equal((await call('GET', '/api/student-portrait')).status, 401);
  assert.equal((await call('GET', '/api/student-portrait', { student: 9999 })).status, 401, 'an unknown student');
  const a = await call('GET', '/api/student-portrait?studentId=2001&classroomId=2', { student: 1001 });
  assert.equal(a.status, 200);
  assert.equal(a.json.student.displayName, 'Alex Rivera');
  assert.deepEqual(byCode(a.json)['2A'].activities.map((x) => x.title), ['Perspective Swap'], 'Jordan\'s play never shows on Alex\'s portrait');
  assert.ok(!a.raw.includes('Jordan') && !a.raw.includes('Sam Lee'), 'no other student is named');
  db.prepare('UPDATE classrooms SET archived_at = ? WHERE id = 1').run(IN_YEAR);
  assert.equal((await call('GET', '/api/student-portrait', { student: 1001 })).status, 401, 'an archived classroom is cut off, as everywhere else');
});

test('PINS: pin a reflection and a goal from this year; at most 3; no duplicates; the portrait lists them and the rest as pinnable', async () => {
  reset(); align(1, 'brain_game', 1, 'direct');
  const r1 = reflect(1001, 'I listened better today.'), r2 = reflect(1001, 'I paused before answering.'), g1 = goal(1001, 'Be kinder at lunch.'), g2 = goal(1001, 'Finish my reading.');
  let g = (await call('GET', '/api/student-portrait', { student: 1001 })).json;
  assert.equal(g.maxPins, 3);
  assert.deepEqual(g.pinnable.map((x) => `${x.kind}:${x.id}`).sort(), [`goal:${g1}`, `goal:${g2}`, `reflection:${r1}`, `reflection:${r2}`].sort());
  assert.equal(g.pinnable.find((x) => x.kind === 'reflection').from, 'Pause Before You Escalate', 'a reflection says which lesson it came from');
  assert.equal((await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'reflection', sourceId: r1, itemId: 1 } })).status, 201);
  assert.equal((await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'goal', sourceId: g1 } })).status, 201, 'an attribute is optional');
  assert.equal((await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'goal', sourceId: g1 } })).status, 409, 'duplicate');
  assert.equal((await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'reflection', sourceId: r2 } })).status, 201);
  const fourth = await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'goal', sourceId: g2 } });
  assert.equal(fourth.status, 409); assert.match(fourth.json.error, /up to 3/);
  g = (await call('GET', '/api/student-portrait', { student: 1001 })).json;
  assert.deepEqual(g.pins.map((p) => [p.kind, p.text, p.itemId]), [['reflection', 'I listened better today.', 1], ['goal', 'Be kinder at lunch.', null], ['reflection', 'I paused before answering.', null]]);
  assert.deepEqual(g.pinnable.map((x) => `${x.kind}:${x.id}`), [`goal:${g2}`], 'what is pinned is no longer offered');
});

test('PINS: only your own words from this school year; another student\'s, last year\'s and made-up ids are refused; bad input is 400', async () => {
  reset(); align(1, 'brain_game', 1, 'direct');
  const mine = reflect(1001, 'Mine.'), theirs = reflect(2001, 'Jordan wrote this.'), old = reflect(1001, 'Last year.', LAST_YEAR), oldGoal = goal(1001, 'Old goal.', LAST_YEAR);
  const post = (body, student = 1001) => call('POST', '/api/student-portrait/pins', { student, body });
  assert.equal((await post({ kind: 'reflection', sourceId: theirs })).status, 404, 'another student\'s reflection');
  assert.equal((await post({ kind: 'reflection', sourceId: old })).status, 404, 'last school year');
  assert.equal((await post({ kind: 'goal', sourceId: oldGoal })).status, 404);
  assert.equal((await post({ kind: 'reflection', sourceId: 99999 })).status, 404);
  assert.equal((await post({ kind: 'goal', sourceId: mine })).status, 404, 'a reflection id is not a goal id');
  for (const bad of [{}, { kind: 'quiz', sourceId: mine }, { kind: ['reflection'], sourceId: mine }, { kind: 'reflection' }, { kind: 'reflection', sourceId: 'abc' }, { kind: 'reflection', sourceId: -4 }, { kind: 'reflection', sourceId: mine, itemId: 'x' }, { kind: 'reflection', sourceId: mine, itemId: 5 }, { kind: 'reflection', sourceId: mine, itemId: 6 }, { kind: 'reflection', sourceId: mine, itemId: 99 }]) {
    assert.equal((await post(bad)).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal((await call('POST', '/api/student-portrait/pins', { student: 1001 })).status, 400, 'no body at all');
  assert.equal((await call('POST', '/api/student-portrait/pins', { body: { kind: 'reflection', sourceId: mine } })).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_portrait_pins').get().n, 0);
});

test('PINS: remove your own; someone else\'s pin id is a 404 and stays; a deleted source drops the pin; a pointer, not a copy', async () => {
  reset(); align(1, 'brain_game', 1, 'direct');
  const r1 = reflect(1001, 'Original words.'), r2 = reflect(2001, 'Jordan\'s words.');
  const mine = (await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'reflection', sourceId: r1 } })).json.id;
  const theirs = (await call('POST', '/api/student-portrait/pins', { student: 2001, body: { kind: 'reflection', sourceId: r2 } })).json.id;
  assert.equal((await call('DELETE', `/api/student-portrait/pins/${theirs}`, { student: 1001 })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_portrait_pins WHERE id = ?').get(theirs).n, 1, 'Jordan\'s pin is untouched');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_portrait_pins').get().n, 2);
  assert.equal(Object.keys(db.prepare('SELECT * FROM student_portrait_pins WHERE id = ?').get(mine)).some((k) => /text|words/.test(k)), false, 'no copy of the words is stored');
  db.prepare('UPDATE student_reflections SET response_text = ? WHERE id = ?').run('Edited words.', r1);
  assert.equal((await call('GET', '/api/student-portrait', { student: 1001 })).json.pins[0].text, 'Edited words.', 'the pin follows its source');
  db.prepare('DELETE FROM student_reflections WHERE id = ?').run(r1);
  assert.deepEqual((await call('GET', '/api/student-portrait', { student: 1001 })).json.pins, [], 'the source is gone, so the pin is gone from every read');
  assert.equal((await call('DELETE', `/api/student-portrait/pins/${mine}`, { student: 1001 })).status, 200);
  assert.equal((await call('DELETE', `/api/student-portrait/pins/${mine}`, { student: 1001 })).status, 404);
  assert.equal((await call('DELETE', '/api/student-portrait/pins/abc', { student: 1001 })).status, 404);
});

test('PINS: deleting a goal removes its pin (removePinsFor)', async () => {
  reset();
  const g = goal(1001, 'A goal.');
  await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'goal', sourceId: g } });
  await pins.removePinsFor(1001, 'goal', g);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_portrait_pins').get().n, 0);
});

test('PINS: one student\'s pins never appear on another student\'s portrait', async () => {
  reset();
  const r1 = reflect(1001, 'Private to Alex.');
  await call('POST', '/api/student-portrait/pins', { student: 1001, body: { kind: 'reflection', sourceId: r1 } });
  const sam = await call('GET', '/api/student-portrait', { student: 1002 });
  assert.deepEqual(sam.json.pins, []);
  assert.ok(!sam.raw.includes('Private to Alex'));
});

test('PRIVACY: pinned words are read only by the student route; no parent, teacher, admin or staff route touches the pins table', () => {
  const offenders = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) { if (!['node_modules', 'test', 'scripts'].includes(f)) walk(p); } else if (/\.js$/.test(f) && /student_portrait_pins|portrait-pins/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(SERVER, p)); } };
  walk(SERVER);
  assert.deepEqual(offenders.sort(), ['lib/portrait-pins.js', 'routes/student-portrait.js', 'routes/student.js'], 'only the student routes and the pins library may touch pins');
});
