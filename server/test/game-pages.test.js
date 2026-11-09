// Release 163: the public page for one game (game.html, GET /api/brain-games/:slug).
// Runs the REAL router and lib/game-pages.js + lib/standards.js against a REAL SQL engine (node:sqlite), so "a draft connection or a
// district framework never reaches the public page" is proven through the actual queries. Requirements and access matrix:
// docs/reference/game-pages-parent-view-favorites-requirements.md.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE feature_flags (id INTEGER PRIMARY KEY AUTOINCREMENT, flag_key TEXT, enabled_globally INTEGER DEFAULT 0);
CREATE TABLE feature_flag_schools (flag_id INTEGER, school_id INTEGER);
CREATE TABLE brain_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, description TEXT, icon TEXT, primary_skill TEXT,
  active INTEGER DEFAULT 1, display_order INTEGER DEFAULT 0, reward_pipeline TEXT DEFAULT 'classroom_generic',
  band TEXT, domain TEXT, casel_competencies TEXT, focus TEXT, created_at TEXT);
CREATE TABLE standards_frameworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, state_code TEXT NOT NULL, framework_type TEXT NOT NULL, name TEXT NOT NULL,
  issuing_body TEXT NOT NULL DEFAULT 'x', official_url TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'draft',
  district_id INTEGER REFERENCES districts(id) ON DELETE CASCADE);
CREATE TABLE standards_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, framework_id INTEGER NOT NULL REFERENCES standards_frameworks(id) ON DELETE CASCADE,
  code TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE standards_alignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES standards_items(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id INTEGER NOT NULL DEFAULT 0, strength TEXT NOT NULL, rationale TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'draft');
`);
const pool = {
  async query(sql, params = []) {
    const s = sql.trim();
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const r = db.prepare(s).run(...params);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  },
};
const poolPath = path.join(SERVER, 'db/pool.js');
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { if (Module._resolveFilename(request, parent) === poolPath) return pool; } catch { /* not resolvable here -> default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
app.use(express.json(), cookieParser());
app.use('/api/brain-games', require(path.join(SERVER, 'routes/brain-games.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());
const get = async (url) => { const r = await fetch(`http://127.0.0.1:${port}${url}`); return { status: r.status, body: await r.json().catch(() => null) }; };

const run = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
let g1, gHidden, gOff, fwNy, fwDraft, fwDistrict, itemNy, itemNy2, itemDraft, itemDistrict;
test.before(() => {
  run("INSERT INTO feature_flags (flag_key, enabled_globally) VALUES ('tune_your_brain_pilot_enabled', 1)");
  g1 = run("INSERT INTO brain_games (name, slug, description, icon, primary_skill, band, focus, casel_competencies, reward_pipeline) VALUES ('Peace Table','peace-table','Two kids disagree.','🕊️','Conflict Resolution','explore','relationship_skills','relationship_skills,social_awareness','classroom_generic')");
  gOff = run("INSERT INTO brain_games (name, slug, active) VALUES ('Retired Game','retired-game',0)");
  gHidden = run("INSERT INTO brain_games (name, slug, reward_pipeline) VALUES ('Legacy Game','legacy-game','legacy')");
  const dist = run("INSERT INTO districts (name) VALUES ('Some District')");
  fwNy = run("INSERT INTO standards_frameworks (state_code, framework_type, name, official_url, review_status) VALUES ('NY','sel_standards','NY SEL Benchmarks','https://example.com/ny','verified')");
  fwDraft = run("INSERT INTO standards_frameworks (state_code, framework_type, name, official_url, review_status) VALUES ('OH','sel_standards','OH draft','https://example.com/oh','draft')");
  fwDistrict = run("INSERT INTO standards_frameworks (state_code, framework_type, name, official_url, review_status, district_id) VALUES ('NY','portrait_of_graduate','District PoG','https://example.com/d','verified',?)", dist);
  itemNy = run("INSERT INTO standards_items (framework_id, code, title, sort_order) VALUES (?,'1A','Self-awareness',1)", fwNy);
  itemNy2 = run("INSERT INTO standards_items (framework_id, code, title, sort_order) VALUES (?,'2B','Relationship skills',2)", fwNy);
  itemDraft = run("INSERT INTO standards_items (framework_id, code, title) VALUES (?,'X1','Draft framework item')", fwDraft);
  itemDistrict = run("INSERT INTO standards_items (framework_id, code, title) VALUES (?,'D1','District item')", fwDistrict);
  const al = (item, strength, rationale, status) => run("INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?,?,?,?,?,?)", item, 'brain_game', g1, strength, rationale, status);
  al(itemNy, 'direct', 'Players name what they see and feel.', 'verified');
  al(itemNy2, 'supporting', 'Players listen before they answer.', 'verified');
  al(itemDraft, 'direct', 'A verified connection inside a draft framework.', 'verified');
  al(itemDistrict, 'direct', 'A verified connection inside a district framework.', 'verified');
  run("INSERT INTO standards_alignments (item_id, target_type, target_id, strength, rationale, review_status) VALUES (?,?,?,?,?,?)", itemNy, 'brain_game', gHidden, 'direct', 'Other game, not this one.', 'verified');
  // a draft connection and a blank-rationale connection on a verified framework item
  const itemNy3 = run("INSERT INTO standards_items (framework_id, code, title, sort_order) VALUES (?,'3C','Draft only item',3)", fwNy);
  const itemNy4 = run("INSERT INTO standards_items (framework_id, code, title, sort_order) VALUES (?,'4D','Blank rationale item',4)", fwNy);
  al(itemNy3, 'direct', 'A draft connection must not show.', 'draft');
  al(itemNy4, 'direct', '', 'verified');
});

test('PAGE: a public visitor gets the catalog text, band, focus and grades', async () => {
  const r = await get('/api/brain-games/peace-table');
  assert.equal(r.status, 200);
  const g = r.body.game;
  assert.equal(g.name, 'Peace Table');
  assert.equal(g.band, 'explore');
  assert.equal(g.bandLabel, 'Explore');
  assert.equal(g.grades, '3-5');
  assert.equal(g.focus, 'relationship_skills');
  assert.equal(g.focusLabel, 'Relationship Skills');
  assert.ok(g.focusHelp);
  assert.deepEqual(g.competencies.map((c) => c.key), ['relationship_skills', 'social_awareness']);
  assert.equal(g.playUrl, 'brain-peace-table.html');
});

test('PAGE: only verified connections in verified state frameworks appear (no draft, no blank rationale, no district framework)', async () => {
  const r = await get('/api/brain-games/peace-table');
  const states = r.body.connections;
  assert.equal(states.length, 1, 'only New York: the Ohio framework is a draft');
  assert.equal(states[0].state.code, 'NY');
  assert.equal(states[0].state.name, 'New York');
  assert.equal(states[0].frameworks.length, 1, 'the district framework is never listed');
  const items = states[0].frameworks[0].items;
  assert.deepEqual(items.map((i) => i.code), ['1A', '2B']);
  assert.deepEqual(items.map((i) => i.strength), ['direct', 'supporting']);
  const text = JSON.stringify(r.body);
  assert.ok(!/draft connection must not show|inside a draft framework|inside a district framework|Other game/i.test(text));
});

test('PAGE: nothing leaks that is not public (no reviewer fields, no ids of review, no notes)', async () => {
  const r = await get('/api/brain-games/peace-table');
  const text = JSON.stringify(r.body);
  for (const word of ['reviewed_by', 'reviewedBy', 'notes', 'review_status', 'reviewStatus', 'district_id']) assert.ok(!text.includes(word), word);
});

test('PAGE: unknown, retired and badly formed slugs answer 404 (not 500)', async () => {
  for (const slug of ['no-such-game', 'retired-game', 'Peace_Table', '..%2Fetc', 'a'.repeat(60), '-bad', 'bad-']) {
    const r = await get('/api/brain-games/' + slug);
    assert.equal(r.status, 404, slug);
  }
});

test('PAGE: with the pilot flag off a Tune Your Brain pilot game has no page, a legacy game still does', async () => {
  db.exec("UPDATE feature_flags SET enabled_globally = 0");
  assert.equal((await get('/api/brain-games/peace-table')).status, 404);
  assert.equal((await get('/api/brain-games/legacy-game')).status, 200);
  db.exec("UPDATE feature_flags SET enabled_globally = 1");
  assert.equal((await get('/api/brain-games/peace-table')).status, 200);
});

test('PAGE: a game with no connections still opens, with an empty list', async () => {
  const r = await get('/api/brain-games/legacy-game');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.connections, [{ state: { code: 'NY', name: 'New York' }, frameworks: [{ id: fwNy, type: 'sel_standards', name: 'NY SEL Benchmarks', officialUrl: 'https://example.com/ny', items: [{ code: '1A', title: 'Self-awareness', strength: 'direct', rationale: 'Other game, not this one.' }] }] }]);
  const none = run("INSERT INTO brain_games (name, slug) VALUES ('Fresh Game','fresh-game')");
  assert.ok(none);
  assert.deepEqual((await get('/api/brain-games/fresh-game')).body.connections, []);
});

test('ROUTES: the literal paths still win over /:slug (a slug route must not swallow them)', async () => {
  // /me/progress has two segments, so it can never match /:slug; /sessions is POST/PUT only. The catalog list still answers.
  const list = await get('/api/brain-games');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.games));
  assert.equal((await get('/api/brain-games/me/progress')).status, 401);
});

// ---- wiring: the pages and links exist and carry the safety rules ----
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('WIRING: game.html loads the shared scripts, escapes database text and only follows https links', () => {
  const html = read('game.html');
  for (const s of ['fonts.css?v=1', 'brain-games.css?v=7', 'nav.js?v=21', 'site-auth.js?v=11', 'footer.js?v=18']) assert.ok(html.includes(s), s);
  assert.ok(!/fonts\.googleapis|cdn\./i.test(html), 'no third-party font or CDN script');
  assert.match(html, /function esc\(/);
  assert.match(html, /function safeUrl\(/);
  assert.match(html, /\^https:\\\/\\\//, 'official links must be https');
  assert.match(html, /\/api\/brain-games\/' \+ encodeURIComponent\(slug\)/);
  assert.ok(!/innerHTML\s*=\s*[^;]*\b(g\.description|g\.name|g\.primarySkill)\b/.test(html), 'catalog text goes in with textContent');
});

test('WIRING: game.html inline script has no stray apostrophe (a syntax error blanks the page)', () => {
  const html = read('game.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const code of scripts) assert.doesNotThrow(() => new (require('node:vm').Script)(code), 'inline script parses');
});

test('WIRING: each card on the games page links to its game page, and the standards page links games', () => {
  assert.match(read('brain-games.html'), /game\.html\?slug=\$\{encodeURIComponent\(g\.slug\)\}/);
  const std = read('state-standards.html');
  assert.match(std, /game\.html\?slug=/);
  assert.match(std, /\^\[a-z0-9-\]\{1,50\}\$/, 'the slug is checked before it goes in a link');
});

test('WIRING: game.html is not a game page (the game list test counts brain-*.html only)', () => {
  assert.ok(!/^brain-/.test('game.html'));
});
