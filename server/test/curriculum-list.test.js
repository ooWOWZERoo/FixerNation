// GET /api/curricula (routes/curriculum.js): the plain list is every published lesson for everyone, including a licensed
// teacher who has saved plans to My Lesson Plans. The narrowed "my library" list is opt-in with ?library=true (used by the
// classroom Assign Lesson box). Runs the real route on a real SQL engine (node:sqlite); the lesson child tables are stubbed empty.
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
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, series TEXT, short_description TEXT, overview TEXT, lessons_count INTEGER,
  weeks_count INTEGER, download_limit INTEGER, published INTEGER DEFAULT 1, is_featured INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER NOT NULL, curriculum_id INTEGER NOT NULL);
INSERT INTO curricula (id, title, published) VALUES (1, 'One', 1), (2, 'Two', 1), (3, 'Three', 1), (4, 'Draft', 0);
INSERT INTO teacher_lesson_plans VALUES (10, 2), (10, 3);
`);
const pool = {
  query: async (sql, params = []) => {
    const s = sql.trim();
    // Lesson child rows and license seats are not under test: no trial seats, no lesson attachments.
    if (/FROM (curriculum_(audiences|objectives|materials|resources|videos|documents|quiz_questions|quiz_options)|license_seats)/.test(s)) return [[]];
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    throw new Error('unexpected query: ' + s);
  },
};

// Who is signed in is set by a header the test client sends (0 = nobody); user 10 and 11 hold a license, 12 does not.
const userOf = (req) => { const id = Number(req.get('x-test-user') || 0); return id ? { id } : null; };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  [path.join(SERVER, 'lib/access.js')]: {
    getSiteUser: async (req) => userOf(req),
    hasActiveLicense: async (id) => id === 10 || id === 11,
    hasParentAccessToCurriculum: async () => false,
    isLinkedParent: async () => false,
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const router = require(path.join(SERVER, 'routes/curriculum.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/curricula', router);
app.use((err, req, res, next) => res.status(500).json({ error: String(err.stack) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function get(p, user) {
  return new Promise((resolve, reject) => {
    const headers = user ? { 'x-test-user': String(user) } : {};
    // Express 4 never answers when an async handler throws, so fail fast instead of hanging the run.
    http.get({ port, path: p, headers, timeout: 5000 }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => resolve(JSON.parse(buf)));
    }).on('timeout', function () { this.destroy(new Error('request timed out: ' + p)); }).on('error', reject);
  });
}
const ids = (body) => body.curricula.map((c) => c.id).sort();

test('a licensed teacher with saved plans still sees every published lesson on the plain list', async () => {
  assert.deepEqual(ids(await get('/api/curricula', 10)), [1, 2, 3]);
});

test('?library=true narrows a licensed teacher with saved plans to their library', async () => {
  assert.deepEqual(ids(await get('/api/curricula?library=true', 10)), [2, 3]);
});

test('?library=true shows everything to a licensed teacher with nothing saved yet', async () => {
  assert.deepEqual(ids(await get('/api/curricula?library=true', 11)), [1, 2, 3]);
});

test('?library=true does nothing for a signed-out visitor or an unlicensed user', async () => {
  assert.deepEqual(ids(await get('/api/curricula?library=true')), [1, 2, 3]);
  assert.deepEqual(ids(await get('/api/curricula?library=true', 12)), [1, 2, 3]);
});

test('unpublished lessons never appear, and the library flag does not change what is locked', async () => {
  const plain = await get('/api/curricula', 10);
  assert.ok(!ids(plain).includes(4));
  assert.ok(plain.curricula.every((c) => c.access.canDownload === true));
  const visitor = await get('/api/curricula');
  assert.ok(visitor.curricula.every((c) => c.access.canDownload === false));
});
