// Release 165: favorites for lessons and games, and the one list of everything starred (routes/favorites.js), on a real SQL engine (node:sqlite).
// Access matrix being tested (docs/reference/game-pages-parent-view-favorites-requirements.md section 3): signed out gets nothing; a signed-in
// site user only ever reads and changes their OWN favorites; a lesson can be added only if it is published and a game only if it is active
// (and, for a Tune Your Brain pilot game, only while the pilot flag is on); removing is always allowed; bad input is rejected; the cap and
// the per-user limit hold. Students and the admin session cannot pass requireSiteAuth (separate cookie and audience), which the wiring test checks.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY, email TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 1);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, active INTEGER DEFAULT 1, reward_pipeline TEXT DEFAULT 'legacy');
CREATE TABLE blog_posts (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 1, publish_date TEXT);
CREATE TABLE feature_flags (id INTEGER PRIMARY KEY AUTOINCREMENT, flag_key TEXT, enabled_globally INTEGER DEFAULT 0);
CREATE TABLE feature_flag_schools (flag_id INTEGER, school_id INTEGER);
CREATE TABLE blog_post_favorites (site_user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (site_user_id, post_id));
CREATE TABLE lesson_favorites (site_user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE, curriculum_id INTEGER NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (site_user_id, curriculum_id));
CREATE TABLE game_favorites (site_user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE, game_id INTEGER NOT NULL REFERENCES brain_games(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (site_user_id, game_id));
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/CURDATE\(\)/g, "date('now')");
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  // Who is "signed in" is set by a header the test client sends (0 = nobody), standing in for the session cookie.
  [path.join(SERVER, 'routes/site-auth.js')]: {
    requireSiteAuth: (req, res, next) => {
      const id = Number(req.get('x-test-user') || 0);
      if (!id) return res.status(401).json({ error: 'Not logged in' });
      req.siteUser = { id };
      next();
    },
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/favorites', require(path.join(SERVER, 'routes/favorites.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.stack) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, user, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'x-test-user': String(user || 0) };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = null; try { json = b ? JSON.parse(b) : null; } catch { /* Express's own HTML 404 for a path that matches no route */ } resolve({ status: res.statusCode, json }); }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const list = (user) => call('GET', '/api/favorites', user);
const putL = (user, id, favorited) => call('PUT', `/api/favorites/lessons/${id}`, user, { favorited });
const putG = (user, id, favorited) => call('PUT', `/api/favorites/games/${id}`, user, { favorited });

function reset() {
  db.exec('DELETE FROM blog_post_favorites; DELETE FROM lesson_favorites; DELETE FROM game_favorites; DELETE FROM blog_posts; DELETE FROM curricula; DELETE FROM brain_games; DELETE FROM site_users; DELETE FROM feature_flags;');
  db.exec("INSERT INTO site_users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');");
  db.exec("INSERT INTO feature_flags (flag_key, enabled_globally) VALUES ('tune_your_brain_pilot_enabled', 1);");
  db.exec("INSERT INTO curricula (id, title, published) VALUES (10, 'Live lesson', 1), (11, 'Draft lesson', 0), (12, 'Second live lesson', 1);");
  db.exec("INSERT INTO brain_games (id, name, slug, active, reward_pipeline) VALUES (20, 'Pilot game', 'pilot-game', 1, 'classroom_generic'), (21, 'Legacy game', 'legacy-game', 1, 'legacy'), (22, 'Retired game', 'retired', 0, 'legacy');");
  db.exec("INSERT INTO blog_posts (id, title, published) VALUES (30, 'Live post', 1), (31, 'Hidden post', 0);");
}

test('ACCESS: signed out gets 401 everywhere and nothing changes', async () => {
  reset();
  assert.equal((await list(0)).status, 401);
  assert.equal((await putL(0, 10, true)).status, 401);
  assert.equal((await putG(0, 21, true)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lesson_favorites').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_favorites').get().n, 0);
});

test('LESSONS: add, list, add again (same answer), remove, remove again', async () => {
  reset();
  assert.deepEqual((await list(1)).json, { posts: [], lessons: [], games: [] });
  let r = await putL(1, 10, true);
  assert.deepEqual(r.json, { ok: true, favorited: true, count: 1 });
  r = await putL(1, 10, true);
  assert.deepEqual(r.json, { ok: true, favorited: true, count: 1 }, 'a repeated tap cannot flip it or double it');
  await putL(1, 12, true);
  assert.deepEqual((await list(1)).json.lessons, [12, 10], 'newest star first');
  assert.deepEqual((await putL(1, 10, false)).json, { ok: true, favorited: false, count: 1 });
  assert.deepEqual((await putL(1, 10, false)).json, { ok: true, favorited: false, count: 1 });
  assert.deepEqual((await list(1)).json.lessons, [12]);
});

test('GAMES: add, list, remove, and a different kind never mixes into the other list', async () => {
  reset();
  assert.deepEqual((await putG(1, 21, true)).json, { ok: true, favorited: true, count: 1 });
  await putL(1, 10, true);
  const l = (await list(1)).json;
  assert.deepEqual(l.games, [21]);
  assert.deepEqual(l.lessons, [10]);
  assert.deepEqual((await putG(1, 21, false)).json, { ok: true, favorited: false, count: 0 });
  assert.deepEqual((await list(1)).json.games, []);
});

test('ISOLATION: one person never sees or changes another person\'s favorites', async () => {
  reset();
  await putL(1, 10, true); await putG(1, 21, true);
  assert.deepEqual((await list(2)).json, { posts: [], lessons: [], games: [] });
  await putL(2, 12, true);
  assert.deepEqual((await list(1)).json.lessons, [10]);
  await putL(2, 10, false); // person 2 "removes" a lesson they never had: person 1 keeps theirs
  assert.deepEqual((await list(1)).json.lessons, [10]);
});

test('WHAT CAN BE ADDED: published lessons and active games only; unknown ids are 404', async () => {
  reset();
  assert.equal((await putL(1, 11, true)).status, 404, 'a draft lesson');
  assert.equal((await putL(1, 999, true)).status, 404, 'an unknown lesson');
  assert.equal((await putG(1, 22, true)).status, 404, 'a retired game');
  assert.equal((await putG(1, 999, true)).status, 404, 'an unknown game');
  assert.deepEqual((await list(1)).json, { posts: [], lessons: [], games: [] });
});

test('PILOT FLAG: with it off a pilot game cannot be added and drops out of the list; a legacy game is unaffected', async () => {
  reset();
  assert.equal((await putG(1, 20, true)).status, 200);
  assert.deepEqual((await list(1)).json.games, [20]);
  db.exec('UPDATE feature_flags SET enabled_globally = 0');
  assert.deepEqual((await list(1)).json.games, [], 'hidden while the pilot is off, still stored');
  assert.equal((await putG(1, 20, true)).status, 404);
  assert.equal((await putG(1, 21, true)).status, 200);
  assert.deepEqual((await list(1)).json.games, [21]);
  assert.deepEqual((await putG(1, 20, false)).json.favorited, false, 'removing always works');
  db.exec('UPDATE feature_flags SET enabled_globally = 1');
});

test('LIVE ONLY: a lesson unpublished later stays stored but is hidden; deleting the lesson removes the row', async () => {
  reset();
  await putL(1, 10, true); await putL(1, 12, true);
  db.exec('UPDATE curricula SET published = 0 WHERE id = 10');
  assert.deepEqual((await list(1)).json.lessons, [12]);
  db.exec('UPDATE curricula SET published = 1 WHERE id = 10');
  assert.ok((await list(1)).json.lessons.includes(10), 'republishing brings the star back');
  db.exec('DELETE FROM curricula WHERE id = 10');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lesson_favorites WHERE curriculum_id = 10').get().n, 0, 'cascade');
});

test('POSTS: the list also returns this person\'s live Morning Boost stars (the post route itself is unchanged)', async () => {
  reset();
  db.exec('INSERT INTO blog_post_favorites (site_user_id, post_id) VALUES (1, 30), (1, 31), (2, 30)');
  assert.deepEqual((await list(1)).json.posts, [30], 'the unpublished post is hidden');
  assert.deepEqual((await list(2)).json.posts, [30]);
});

test('BAD INPUT: ids and bodies are checked before use (400)', async () => {
  reset();
  for (const id of ['abc', '1.5', '-1', '', '99999999999', '1e3', '%20']) {
    const r = await call('PUT', `/api/favorites/lessons/${encodeURIComponent(id)}`, 1, { favorited: true });
    assert.ok([400, 404].includes(r.status), `lesson id ${JSON.stringify(id)} gave ${r.status}`);
    assert.notEqual(r.status, 500);
  }
  for (const body of [{}, { favorited: 'true' }, { favorited: 1 }, { favorited: null }, []]) {
    assert.equal((await call('PUT', '/api/favorites/games/21', 1, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('PUT', '/api/favorites/lessons/10', 1)).status, 400, 'no body at all');
  assert.equal((await call('PUT', '/api/favorites/other/10', 1, { favorited: true })).status, 404, 'only lessons and games');
});

test('CAP: 500 per kind; the 501st is refused (409) with a plain sentence, removing frees a place, the other kind is separate', async () => {
  reset();
  const ins = db.prepare('INSERT INTO curricula (id, title, published) VALUES (?, ?, 1)');
  const fav = db.prepare('INSERT INTO lesson_favorites (site_user_id, curriculum_id) VALUES (1, ?)');
  for (let i = 1000; i < 1500; i++) { ins.run(i, 'L' + i); fav.run(i); }
  let r = await putL(1, 10, true);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /500 favorites/);
  assert.equal((await putL(1, 1000, true)).status, 200, 'one that is already starred is still fine');
  assert.equal((await putG(1, 21, true)).status, 200, 'games have their own 500');
  await putL(1, 1001, false);
  assert.equal((await putL(1, 10, true)).status, 200);
});

test('RATE: more than 60 changes a minute from one person is refused (429); another person is not affected', async () => {
  reset();
  let last;
  for (let i = 0; i < 61; i++) last = await putG(1, 21, i % 2 === 0);
  assert.equal(last.status, 429);
  assert.equal((await putG(2, 21, true)).status, 200);
});

// ---- wiring ----
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
test('WIRING: both tables are the same in fresh installs and the alter script; the route is mounted once and every handler needs sign-in', () => {
  for (const f of ['server/db/schema.sql', 'server/scripts/alter-add-lesson-game-favorites.js']) {
    const src = read(f);
    for (const [t, col, parent] of [['lesson_favorites', 'curriculum_id', 'curricula'], ['game_favorites', 'game_id', 'brain_games']]) {
      assert.match(src, new RegExp(t));
      assert.match(src, new RegExp(`PRIMARY KEY \\(site_user_id, ${col}\\)`));
      assert.match(src, /FOREIGN KEY \(site_user_id\) REFERENCES site_users\(id\) ON DELETE CASCADE/);
      assert.match(src, new RegExp(`FOREIGN KEY \\(${col}\\) REFERENCES ${parent}\\(id\\) ON DELETE CASCADE`));
    }
  }
  assert.match(read('server/scripts/alter-add-lesson-game-favorites.js'), /already exists/, 'safe to run twice');
  assert.match(read('SCHEMA.md'), /lesson_favorites/);
  const schema = read('server/db/schema.sql');
  assert.ok(schema.indexOf('CREATE TABLE IF NOT EXISTS game_favorites') > schema.indexOf('CREATE TABLE IF NOT EXISTS brain_games ('), 'game_favorites comes after brain_games');
  assert.ok(schema.indexOf('CREATE TABLE IF NOT EXISTS lesson_favorites') > schema.indexOf('CREATE TABLE IF NOT EXISTS curricula'), 'lesson_favorites comes after curricula');
  const app = read('server/app.js');
  assert.match(app, /require\('\.\/routes\/favorites'\)/);
  assert.equal((app.match(/app\.use\('\/api\/favorites'/g) || []).length, 1);
  const route = read('server/routes/favorites.js');
  assert.equal((route.match(/router\.(get|put|post|delete)\(/g) || []).length, 3);
  assert.equal((route.match(/router\.(get|put)\([^\n]*requireSiteAuth/g) || []).length, 3, 'every route uses requireSiteAuth');
  assert.ok(!/req\.(body|query|params)\.(siteUserId|userId|site_user_id)/.test(route), 'the user id never comes from the request');
});
