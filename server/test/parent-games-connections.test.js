// Release 164: the parent portal shows a child's assigned games (completion only) and a lesson page shows how the lesson connects to
// state SEL / Portrait of a Graduate documents. Runs the REAL routes/parent.js, lib/game-pages.js, lib/standards.js and lib/access.js on
// a real SQL engine (node:sqlite). Access matrix: docs/reference/game-pages-parent-view-favorites-requirements.md section 2.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, overview TEXT, short_description TEXT, series TEXT, published INTEGER DEFAULT 1);
CREATE TABLE curriculum_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, audience TEXT);
CREATE TABLE curriculum_resources (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, resource TEXT, file_path TEXT, file_name TEXT, download_limit INTEGER);
CREATE TABLE curriculum_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, name TEXT, url TEXT, size_label TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE curriculum_objectives (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, objective TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE curriculum_materials (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER, material TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, icon TEXT, primary_skill TEXT, band TEXT, focus TEXT, active INTEGER DEFAULT 1);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY, classroom_id INTEGER, display_name TEXT);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER, student_id INTEGER);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, curriculum_id INTEGER, sort_order INTEGER DEFAULT 0, assigned_at TEXT);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER, game_id INTEGER, due_date TEXT);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, game_assignment_id INTEGER, completed_at TEXT, score REAL);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE standards_frameworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, state_code TEXT NOT NULL, framework_type TEXT NOT NULL, name TEXT NOT NULL,
  official_url TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'draft', district_id INTEGER REFERENCES districts(id) ON DELETE CASCADE);
CREATE TABLE standards_items (id INTEGER PRIMARY KEY AUTOINCREMENT, framework_id INTEGER NOT NULL, code TEXT, title TEXT, sort_order INTEGER DEFAULT 0);
CREATE TABLE standards_alignments (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, target_type TEXT, target_id INTEGER DEFAULT 0, strength TEXT, rationale TEXT, review_status TEXT DEFAULT 'draft');
`);
const run = async (sql, params = []) => {
  const s = sql.trim();
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  // The parent session: x-user carries the site user id.
  [path.join(SERVER, 'routes/site-auth.js')]: { requireSiteAuth: (req, res, next) => (Number(req.get('x-user')) ? ((req.siteUser = { id: Number(req.get('x-user')) }), next()) : res.status(401).json({ error: 'Not logged in' })) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/parent', require(path.join(SERVER, 'routes/parent.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function get(urlPath, user) {
  return new Promise((resolve, reject) => {
    const headers = user ? { 'x-user': String(user) } : {};
    http.get({ port, path: urlPath, headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null, raw: b }));
    }).on('error', reject);
  });
}
const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);

// Two families. PARENT 1 is linked to child 11 in classroom 10; PARENT 2 to child 21 in classroom 20. Child 12 shares classroom 10 with child 11.
const PARENT1 = 1, PARENT2 = 2, OUTSIDER = 3;
let gPlayed, gNot, gOther, gOff, gaPlayed, gaNot;
let fwNy, fwDraftFw, fwDistrict;
test.before(() => {
  ins("INSERT INTO classrooms (id, name) VALUES (10, 'Room 10')"); ins("INSERT INTO classrooms (id, name) VALUES (20, 'Room 20')");
  ins("INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (11, 10, 'Child Eleven')");
  ins("INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (12, 10, 'Child Twelve')");
  ins("INSERT INTO classroom_students (id, classroom_id, display_name) VALUES (21, 20, 'Child TwentyOne')");
  ins('INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (?, 10, 11)', PARENT1);
  ins('INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (?, 20, 21)', PARENT2);

  gPlayed = ins("INSERT INTO brain_games (name, slug, icon, band, focus) VALUES ('Peace Table','peace-table','P','explore','relationship_skills')");
  gNot = ins("INSERT INTO brain_games (name, slug, icon, band, focus) VALUES ('Sound Safari','sound-safari','S','discover','literacy')");
  gOther = ins("INSERT INTO brain_games (name, slug, icon) VALUES ('Other Room Game','other-room-game','O')");
  gOff = ins("INSERT INTO brain_games (name, slug, icon, active) VALUES ('Retired','retired',' ',0)");
  gaPlayed = ins("INSERT INTO classroom_game_assignments (classroom_id, game_id, due_date) VALUES (10, ?, '2026-12-01')", gPlayed);
  gaNot = ins('INSERT INTO classroom_game_assignments (classroom_id, game_id) VALUES (10, ?)', gNot);
  ins('INSERT INTO classroom_game_assignments (classroom_id, game_id) VALUES (10, ?)', gOff);
  ins('INSERT INTO classroom_game_assignments (classroom_id, game_id) VALUES (20, ?)', gOther);
  // Child 11 played Peace Table (with a score that must never reach the parent). Child 12 played Sound Safari: not child 11.
  ins("INSERT INTO student_game_completions (student_id, game_assignment_id, completed_at, score) VALUES (11, ?, '2026-11-02 10:00:00', 87)", gaPlayed);
  ins("INSERT INTO student_game_completions (student_id, game_assignment_id, completed_at, score) VALUES (12, ?, '2026-11-03 10:00:00', 55)", gaNot);

  // Lesson family "Pause Before You Escalate": elementary (100) is assigned to room 10; the middle version (101) carries the connections.
  ins("INSERT INTO curricula (id, title, overview) VALUES (100, 'Pause Before You Escalate - Lesson Plan (Elementary)', 'Overview')");
  ins("INSERT INTO curricula (id, title) VALUES (101, 'Pause Before You Escalate - Lesson Plan (Middle)')");
  ins("INSERT INTO curricula (id, title) VALUES (102, 'A Lesson Nobody Linked - Lesson Plan (Elementary)')");
  ins("INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (100, 'Elementary School')");
  ins("INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (101, 'Middle School')");
  ins("INSERT INTO classroom_assignments (classroom_id, curriculum_id) VALUES (10, 100)");
  ins("INSERT INTO classroom_assignments (classroom_id, curriculum_id) VALUES (10, 102)");
  ins("INSERT INTO classroom_assignments (classroom_id, curriculum_id) VALUES (20, 101)");

  const dist = ins("INSERT INTO districts (name) VALUES ('A District')");
  fwNy = ins("INSERT INTO standards_frameworks (state_code, framework_type, name, official_url, review_status) VALUES ('NY','sel_standards','NY SEL','https://example.com/ny','verified')");
  fwDraftFw = ins("INSERT INTO standards_frameworks (state_code, framework_type, name, official_url, review_status) VALUES ('OH','sel_standards','OH draft','https://example.com/oh','draft')");
  fwDistrict = ins("INSERT INTO standards_frameworks (state_code, framework_type, name, official_url, review_status, district_id) VALUES ('NY','portrait_of_graduate','District PoG','https://example.com/d','verified',?)", dist);
  const item = (fw, code, title, n) => ins('INSERT INTO standards_items (framework_id, code, title, sort_order) VALUES (?,?,?,?)', fw, code, title, n);
  const i1 = item(fwNy, '1A', 'Self-awareness', 1), i2 = item(fwNy, '2D', 'Manage conflict', 2), i3 = item(fwNy, '3C', 'Draft connection item', 3), i4 = item(fwNy, '4D', 'Blank reason item', 4);
  const iDraftFw = item(fwDraftFw, 'X1', 'In a draft framework', 1), iDistrict = item(fwDistrict, 'D1', 'District item', 1);
  const al = (itemId, targetId, strength, why, status = 'verified') => ins("INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?, 'curriculum', ?, ?, ?, ?)", itemId, targetId, strength, why, status);
  al(i1, 101, 'supporting', 'Learners name feelings before they act.');       // on the middle version only
  al(i2, 100, 'supporting', 'Weaker claim on the elementary version.');       // the same standard on two versions: listed once, stronger wins
  al(i2, 101, 'direct', 'Learners practice resolving a conflict calmly.');
  al(i3, 101, 'direct', 'A draft connection must not show.', 'draft');
  al(i4, 101, 'direct', '');                                                    // blank rationale: never public
  al(iDraftFw, 101, 'direct', 'Inside a draft framework.');
  al(iDistrict, 101, 'direct', 'Inside a district framework.');
});

test('ACCESS: signed out gets 401 on both routes', async () => {
  assert.equal((await get('/api/parent/children')).status, 401);
  assert.equal((await get('/api/parent/lesson/100')).status, 401);
});

test('ACCESS: a signed-in person who is not a linked parent is refused (403)', async () => {
  assert.equal((await get('/api/parent/children', OUTSIDER)).status, 403);
  assert.equal((await get('/api/parent/lesson/100', OUTSIDER)).status, 403);
});

test('GAMES: a parent sees their own child\'s classroom games, with played yes or no for THIS child only', async () => {
  const r = await get('/api/parent/children', PARENT1);
  assert.equal(r.status, 200);
  assert.equal(r.json.children.length, 1);
  const games = r.json.children[0].games;
  assert.deepEqual(games.map((g) => g.slug), ['peace-table', 'sound-safari'], 'the retired game and the other room\'s game are not listed');
  const byslug = Object.fromEntries(games.map((g) => [g.slug, g]));
  assert.equal(byslug['peace-table'].played, true);
  assert.equal(byslug['peace-table'].dueDate, '2026-12-01');
  assert.equal(byslug['peace-table'].bandLabel, 'Explore');
  assert.equal(byslug['peace-table'].grades, '3-5');
  assert.equal(byslug['sound-safari'].played, false, 'a classmate played it, this child did not');
});

test('GAMES: completion only: no score, no date played, no assignment id, no other child', async () => {
  const r = await get('/api/parent/children', PARENT1);
  const games = r.json.children[0].games;
  for (const g of games) assert.deepEqual(Object.keys(g).sort(), ['band', 'bandLabel', 'dueDate', 'focusLabel', 'grades', 'icon', 'name', 'played', 'primarySkill', 'slug']);
  assert.ok(!/87|55|score|completed|Child Twelve|Child TwentyOne/i.test(JSON.stringify(games)), 'no score, no completion date, no other child\'s name');
});

test('GAMES: a second family sees only its own classroom', async () => {
  const r = await get('/api/parent/children', PARENT2);
  assert.deepEqual(r.json.children[0].games.map((g) => g.slug), ['other-room-game']);
  assert.equal(r.json.children[0].games[0].played, false);
});

test('LESSON CONNECTIONS: a linked parent sees verified connections, merged across grade versions, no drafts', async () => {
  const r = await get('/api/parent/lesson/100', PARENT1);
  assert.equal(r.status, 200);
  const states = r.json.connections;
  assert.equal(states.length, 1, 'New York only: the Ohio framework is a draft');
  assert.equal(states[0].state.name, 'New York');
  assert.equal(states[0].frameworks.length, 1, 'the district framework is never shown to parents');
  const items = states[0].frameworks[0].items;
  assert.deepEqual(items.map((i) => i.code), ['1A', '2D'], 'draft and blank-reason connections are left out; 2D is listed once');
  const d = items.find((i) => i.code === '2D');
  assert.equal(d.strength, 'direct', 'the stronger claim wins');
  assert.equal(d.rationale, 'Learners practice resolving a conflict calmly.');
  const text = JSON.stringify(r.json.connections);
  assert.ok(!/draft connection|inside a draft|inside a district|itemId|reviewed|notes/i.test(text));
});

test('LESSON CONNECTIONS: the rest of the lesson payload is unchanged (resources, videos, no quiz)', async () => {
  const r = await get('/api/parent/lesson/100', PARENT1);
  assert.deepEqual(Object.keys(r.json).sort(), ['connections', 'curriculum']);
  for (const k of ['id', 'title', 'overview', 'shortDescription', 'series', 'objectives', 'materials', 'resources', 'videos']) assert.ok(k in r.json.curriculum, k);
  assert.ok(!('quiz' in r.json.curriculum));
});

test('LESSON CONNECTIONS: a lesson with no verified connections answers with an empty list', async () => {
  const r = await get('/api/parent/lesson/102', PARENT1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.connections, []);
});

test('LESSON CONNECTIONS: a parent not linked to a classroom that uses the lesson gets 403 and no connections', async () => {
  const r = await get('/api/parent/lesson/100', PARENT2);
  assert.equal(r.status, 403);
  assert.ok(!('connections' in r.json));
  assert.equal((await get('/api/parent/lesson/101', PARENT1)).status, 403, 'room 20 uses the middle version, room 10 does not');
});

// ---- pages ----
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
test('PAGES: both parent pages parse, escape database text and show completion words only', () => {
  for (const f of ['parent-portal.html', 'parent-lesson.html']) {
    const html = read(f);
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(m[1]), `${f} inline script parses`);
  }
  const portal = read('parent-portal.html');
  assert.match(portal, /game\.html\?slug=' \+ encodeURIComponent\(g\.slug\)/);
  assert.match(portal, /Played/);
  assert.match(portal, /Not played yet/);
  assert.ok(!/g\.score|\.score\b/.test(portal), 'the portal never reads a score');
  const lesson = read('parent-lesson.html');
  assert.match(lesson, /function safeUrl\(/);
  assert.match(lesson, /connectionsSection/);
  assert.match(lesson, /neither|No state education agency or CASEL has reviewed or endorsed it/i);
});
