// Release 91: favorites for blog posts and Morning Boost (routes/blog-favorites.js), run on a real SQL engine (node:sqlite).
// The access matrix being tested: signed out gets nothing; a signed-in site user can only ever read and change their OWN favorites;
// a post can be added only if it is published, not future-dated and (when locked) the user holds a license; removing is always allowed;
// bad input is rejected; the cap and the per-user limit hold.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY, email TEXT);
CREATE TABLE blog_posts (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 1, publish_date TEXT, requires_membership INTEGER DEFAULT 0);
CREATE TABLE blog_post_favorites (site_user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_user_id, post_id));
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/CURDATE\(\)/g, "date('now')");
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const pool = { query: run };

// Who is "signed in" for a request is set by a header the test client sends (0 = nobody), standing in for the session cookie.
const licensed = new Set();
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'routes/site-auth.js')]: {
    requireSiteAuth: (req, res, next) => {
      const id = Number(req.get('x-test-user') || 0);
      if (!id) return res.status(401).json({ error: 'Not logged in' });
      req.siteUser = { id };
      next();
    },
  },
  [path.join(SERVER, 'lib/access.js')]: { hasActiveLicense: async (id) => licensed.has(id) },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const router = require(path.join(SERVER, 'routes/blog-favorites.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/blog-favorites', router);
app.use((err, req, res, next) => res.status(500).json({ error: String(err.stack) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, user, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'x-test-user': String(user || 0) };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null })); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const get = (user) => call('GET', '/api/blog-favorites', user);
const put = (user, id, favorited) => call('PUT', `/api/blog-favorites/${id}`, user, { favorited });

const DAY = 24 * 3600 * 1000;
const dateOf = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
function reset() {
  db.exec('DELETE FROM blog_post_favorites; DELETE FROM blog_posts; DELETE FROM site_users;');
  licensed.clear();
  db.exec(`INSERT INTO site_users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');`);
  const ins = db.prepare('INSERT INTO blog_posts (id, title, published, publish_date, requires_membership) VALUES (?, ?, ?, ?, ?)');
  ins.run(10, 'Open post', 1, dateOf(-3), 0);
  ins.run(11, 'Locked post', 1, dateOf(-2), 1);
  ins.run(12, 'Draft', 0, dateOf(-2), 0);
  ins.run(13, 'Scheduled', 1, dateOf(5), 0);
  ins.run(14, 'No date', 1, null, 0);
}

test('SIGNED OUT: nothing is readable or changeable', async () => {
  reset();
  assert.equal((await get(0)).status, 401);
  assert.equal((await put(0, 10, true)).status, 401);
  assert.equal((await put(0, 10, false)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blog_post_favorites').get().n, 0);
});

test('ADD AND REMOVE: setting is idempotent, the list shows live posts newest star first', async () => {
  reset();
  assert.deepEqual((await get(1)).json, { ids: [] });
  assert.deepEqual((await put(1, 10, true)).json, { ok: true, favorited: true, count: 1 });
  assert.deepEqual((await put(1, 10, true)).json, { ok: true, favorited: true, count: 1 }, 'a second add changes nothing');
  db.prepare("UPDATE blog_post_favorites SET created_at = '2020-01-01 00:00:00' WHERE post_id = 10").run();
  assert.equal((await put(1, 14, true)).status, 200);
  assert.deepEqual((await get(1)).json.ids, [14, 10], 'newest star first');
  assert.deepEqual((await put(1, 10, false)).json, { ok: true, favorited: false, count: 1 });
  assert.deepEqual((await put(1, 10, false)).json, { ok: true, favorited: false, count: 1 }, 'removing twice is fine');
  assert.deepEqual((await get(1)).json.ids, [14]);
});

test('ISOLATION: one user can never see or change another user\'s favorites', async () => {
  reset();
  await put(1, 10, true);
  assert.deepEqual((await get(2)).json.ids, []);
  await put(2, 10, false); // user 2 "removing" post 10 must not touch user 1's row
  assert.deepEqual((await get(1)).json.ids, [10]);
  await put(2, 10, true);
  assert.deepEqual((await get(2)).json.ids, [10]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blog_post_favorites').get().n, 2);
});

test('WHICH POSTS: unknown, draft and future-dated posts cannot be added; removing them is still allowed', async () => {
  reset();
  assert.equal((await put(1, 999, true)).status, 404);
  assert.equal((await put(1, 12, true)).status, 404, 'draft');
  assert.equal((await put(1, 13, true)).status, 404, 'scheduled for the future');
  assert.equal((await put(1, 999, false)).status, 200, 'removing something that is not there is harmless');
});

test('LIVE ONLY: a favorite whose post stops being live is hidden from the list, kept, and returns when it is live again', async () => {
  reset();
  await put(1, 10, true);
  db.prepare('UPDATE blog_posts SET published = 0 WHERE id = 10').run();
  assert.deepEqual((await get(1)).json.ids, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blog_post_favorites WHERE site_user_id = 1').get().n, 1);
  db.prepare('UPDATE blog_posts SET published = 1 WHERE id = 10').run();
  assert.deepEqual((await get(1)).json.ids, [10]);
});

test('LOCKED POSTS: adding needs an active license; removing and keeping an old favorite do not', async () => {
  reset();
  assert.equal((await put(1, 11, true)).status, 403);
  licensed.add(1);
  assert.equal((await put(1, 11, true)).status, 200);
  licensed.clear(); // license expires
  assert.deepEqual((await get(1)).json.ids, [11], 'still favorited');
  assert.equal((await put(1, 11, false)).status, 200, 'and can be removed');
  assert.equal((await put(2, 11, true)).status, 403, 'another user without a license is still refused');
});

test('BAD INPUT: ids must be whole numbers and favorited must be a real boolean', async () => {
  reset();
  for (const id of ['abc', '1.5', '-3', '0x10', '99999999999']) assert.equal((await put(1, id, true)).status, 400, `id ${id}`);
  for (const v of ['true', 1, 0, null, undefined, {}]) {
    const r = await call('PUT', '/api/blog-favorites/10', 1, { favorited: v });
    assert.equal(r.status, 400, `favorited ${JSON.stringify(v)}`);
  }
  assert.equal((await call('PUT', '/api/blog-favorites/10', 1, { other: true })).status, 400);
  assert.equal((await call('PUT', '/api/blog-favorites/10', 1, ['x'])).status, 400, 'an array body is not a boolean field');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blog_post_favorites').get().n, 0);
});

test('CAP: a user can keep 500 favorites, and the 501st is refused with a plain message; removing frees a place', async () => {
  reset();
  const ins = db.prepare('INSERT INTO blog_posts (id, title, published, publish_date, requires_membership) VALUES (?, ?, 1, NULL, 0)');
  const fav = db.prepare('INSERT INTO blog_post_favorites (site_user_id, post_id) VALUES (1, ?)');
  for (let i = 1000; i < 1000 + router.MAX_FAVORITES; i++) { ins.run(i, 'p' + i); fav.run(i); }
  ins.run(5000, 'one more');
  const over = await put(1, 5000, true);
  assert.equal(over.status, 409);
  assert.match(over.json.error, /500 favorites/);
  assert.equal((await put(1, 1000, true)).status, 200, 'an existing favorite is not refused at the cap');
  await put(1, 1000, false);
  assert.equal((await put(1, 5000, true)).status, 200);
});

test('RATE LIMIT: more than 60 changes a minute for one user get a 429, and another user is not affected', async () => {
  reset();
  let last;
  for (let i = 0; i < 61; i++) last = await put(1, 10, i % 2 === 0);
  assert.equal(last.status, 429);
  assert.equal((await put(2, 10, true)).status, 200);
});
