// Release 147: Visitor Paths shows which games and lesson plans are used (GET /api/analytics/usage). Staff only, totals only,
// sales-demo activity left out, unused items still listed.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const db = new DatabaseSync(':memory:');
const stamp = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' ');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY, email TEXT, is_sales_demo INTEGER DEFAULT 0);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, teacher_site_user_id INTEGER);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, band TEXT, focus TEXT, active INTEGER DEFAULT 1);
CREATE TABLE brain_game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, student_id INTEGER, game_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, game_id INTEGER, created_at TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, series TEXT, published INTEGER DEFAULT 1);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER, curriculum_id INTEGER, selected_at TEXT);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, curriculum_id INTEGER, assigned_at TEXT);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);

INSERT INTO site_users (id, email, is_sales_demo) VALUES (1, 'real@school.test', 0), (2, 'demo@fne.test', 1);
INSERT INTO classrooms (id, teacher_site_user_id) VALUES (10, 1), (20, 2);
INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (100, 10, 'Real Kid'), (101, 10, 'Other Kid'), (200, 20, 'Demo Kid');
INSERT INTO brain_games (id, name, slug, band, focus, active) VALUES (1, 'Calm Down Corner', 'calm-down-corner', 'discover', 'self_management', 1), (2, 'Never Played', 'never-played', 'explore', 'math', 1), (3, 'Retired', 'retired', 'explore', 'math', 0);
INSERT INTO curricula (id, title, series, published) VALUES (1, 'Kill the Bully', 'Series A', 1), (2, 'Unused Lesson', 'Series A', 1), (3, 'Draft Lesson', 'Series A', 0);
`);
function seed() {
  db.exec('DELETE FROM brain_game_sessions; DELETE FROM classroom_game_assignments; DELETE FROM teacher_lesson_plans; DELETE FROM classroom_assignments; DELETE FROM student_lesson_progress');
  const s = db.prepare('INSERT INTO brain_game_sessions (user_id, student_id, game_id, started_at, completed_at) VALUES (?, ?, ?, ?, ?)');
  s.run(null, 100, 1, stamp(2), stamp(2));   // student 100: played and finished
  s.run(null, 100, 1, stamp(3), null);       // student 100 again: started only
  s.run(null, 101, 1, stamp(5), stamp(5));   // student 101
  s.run(1, null, 1, stamp(1), stamp(1));     // a teacher
  s.run(null, 200, 1, stamp(1), stamp(1));   // demo student: left out
  s.run(2, null, 1, stamp(1), stamp(1));     // demo teacher: left out
  s.run(null, 100, 1, stamp(60), stamp(60)); // older than 30 days
  db.prepare('INSERT INTO classroom_game_assignments (classroom_id, game_id, created_at) VALUES (?, ?, ?)').run(10, 1, stamp(4));
  db.prepare('INSERT INTO classroom_game_assignments (classroom_id, game_id, created_at) VALUES (?, ?, ?)').run(20, 1, stamp(4));
  db.prepare('INSERT INTO teacher_lesson_plans VALUES (?, ?, ?)').run(1, 1, stamp(3));
  db.prepare('INSERT INTO teacher_lesson_plans VALUES (?, ?, ?)').run(2, 1, stamp(3));
  db.prepare('INSERT INTO classroom_assignments (classroom_id, curriculum_id, assigned_at) VALUES (?, ?, ?)').run(10, 1, stamp(3));
  db.prepare('INSERT INTO classroom_assignments (classroom_id, curriculum_id, assigned_at) VALUES (?, ?, ?)').run(20, 1, stamp(3));
  const p = db.prepare('INSERT INTO student_lesson_progress (student_id, curriculum_id, started_at, completed_at) VALUES (?, ?, ?, ?)');
  p.run(100, 1, stamp(2), stamp(2));
  p.run(101, 1, stamp(2), null);
  p.run(200, 1, stamp(2), stamp(2));         // demo student: left out
  p.run(100, 3, stamp(2), null);             // unpublished lesson: not listed
}
const run = async (sql, params = []) => [db.prepare(sql.trim()).all(...params)];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => req.headers['x-staff'] ? next() : res.status(401).json({ error: 'Not authenticated' }), getAuthUser: () => null },
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
app.use('/api/analytics', require(path.join(SERVER, 'routes/analytics.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function get(url, staff = true) {
  return new Promise((resolve, reject) => {
    const headers = staff ? { 'x-staff': '1' } : {};
    http.get({ port, path: url, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {}, raw: b }));
    }).on('error', reject);
  });
}

test('GAMES: plays, finished, players and assignments over 30 days, demo activity left out, unplayed games still listed', async () => {
  seed();
  const r = await get('/api/analytics/usage?range=30');
  assert.equal(r.status, 200);
  const g = r.json.games.find((x) => x.slug === 'calm-down-corner');
  assert.equal(g.plays, 4, 'two plays by student 100, one by 101, one by a teacher; demo and old plays excluded');
  assert.equal(g.completed, 3);
  assert.equal(g.players, 3, 'student 100, student 101 and one teacher');
  assert.equal(g.assigned, 1, 'the demo classroom assignment is excluded');
  const never = r.json.games.find((x) => x.slug === 'never-played');
  assert.equal(never.plays, 0);
  assert.ok(!r.json.games.find((x) => x.slug === 'retired'), 'retired games are not listed');
  assert.equal(r.json.games[0].slug, 'calm-down-corner', 'busiest first');
});

test('GAMES: the range changes the counts', async () => {
  seed();
  const all = await get('/api/analytics/usage?range=all');
  assert.equal(all.json.games.find((x) => x.slug === 'calm-down-corner').plays, 5);
  const bogus = await get('/api/analytics/usage?range=banana');
  assert.equal(bogus.json.range, '30', 'an unknown range falls back to 30 days');
});

test('LESSONS: libraries, assignments, started and finished; demo left out, unpublished not listed', async () => {
  seed();
  const r = await get('/api/analytics/usage?range=30');
  const l = r.json.lessons.find((x) => x.id === 1);
  assert.deepEqual({ a: l.inLibraries, b: l.assigned, c: l.started, d: l.completed }, { a: 1, b: 1, c: 2, d: 1 });
  assert.equal(r.json.lessons.find((x) => x.id === 2).started, 0);
  assert.ok(!r.json.lessons.find((x) => x.id === 3));
  assert.equal(r.json.lessons[0].id, 1, 'most-started first');
});

test('PRIVACY: the response holds totals only, no student or teacher names or emails', async () => {
  seed();
  const r = await get('/api/analytics/usage?range=all');
  assert.ok(!/Real Kid|Other Kid|Demo Kid|@school|@fne/.test(r.raw));
});

test('ACCESS: signed out is refused', async () => {
  assert.equal((await get('/api/analytics/usage', false)).status, 401);
});

test('PAGE: Visitor Paths loads the usage route and escapes what it prints', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin-analytics.html'), 'utf8');
  assert.match(html, /\/api\/analytics\/usage\?range=/);
  assert.match(html, /id="gamesUsageTable"/);
  assert.match(html, /id="lessonsUsageTable"/);
  assert.ok(!/onclick="sortUsage\('\$\{/.test(html), 'no data inside an inline handler');
});
