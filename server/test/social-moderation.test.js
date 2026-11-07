// Release 145: staff can see a post's comments and remove one (admin-social.html). Staff only; a removed comment stays listed, tagged.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE social_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, author_id INTEGER, content TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT);
INSERT INTO site_users (id, email, first_name, last_name) VALUES (1, 'a@school.test', 'Ann', 'Ames'), (2, 'b@school.test', 'Ben', 'Bell');
`);
const run = async (sql, rawParams = []) => {
  const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP');
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...rawParams)];
  const r = db.prepare(s).run(...rawParams);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const noop = new Proxy({}, { get: () => async () => ({}) });
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  // staff = the request carries x-staff; anyone else is refused, as the real middleware does
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => req.headers['x-staff'] ? next() : res.status(401).json({ error: 'Not authenticated' }), getAuthUser: () => null },
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: () => null },
  [path.join(SERVER, 'lib/safety/gateway.js')]: { screenContent: async () => ({ decision: 'allow' }), isPublishable: () => true },
  [path.join(SERVER, 'lib/safety/school-context.js')]: { resolveSchoolDomainForSocialGroup: async () => null, resolveSchoolDomainForTeacher: async () => null },
  [path.join(SERVER, 'lib/mailer.js')]: noop,
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
app.use('/api/social', require(path.join(SERVER, 'routes/social.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, url, staff = true) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': 2 };
    if (staff) headers['x-staff'] = '1';
    const req = http.request({ port, path: url, method, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); req.end('{}');
  });
}
function reset() {
  db.exec("DELETE FROM social_comments");
  db.exec("INSERT INTO social_comments (id, post_id, author_id, content) VALUES (10, 1, 1, 'First'), (11, 1, 2, 'Second'), (12, 2, 2, 'Other post')");
}

test('LIST: staff see every comment on one post, with who wrote it', async () => {
  reset();
  const r = await call('GET', '/api/social/admin/posts/1/comments');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.comments.map((c) => c.id), [10, 11]);
  assert.equal(r.json.comments[0].email, 'a@school.test');
  assert.equal(r.json.comments[0].deleted_at, null);
});

test('REMOVE: a removed comment stays in the staff list, tagged by deleted_at, and a second remove says not found', async () => {
  reset();
  assert.equal((await call('DELETE', '/api/social/comments/10')).status, 200);
  const r = await call('GET', '/api/social/admin/posts/1/comments');
  assert.equal(r.json.comments.length, 2);
  assert.ok(r.json.comments.find((c) => c.id === 10).deleted_at);
  assert.equal(r.json.comments.find((c) => c.id === 11).deleted_at, null);
  assert.equal((await call('DELETE', '/api/social/comments/10')).status, 404);
  assert.equal(db.prepare('SELECT deleted_at FROM social_comments WHERE id = 12').get().deleted_at, null, 'other posts are untouched');
});

test('ACCESS: signed out, both routes are refused and nothing changes', async () => {
  reset();
  assert.equal((await call('GET', '/api/social/admin/posts/1/comments', false)).status, 401);
  assert.equal((await call('DELETE', '/api/social/comments/10', false)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_comments WHERE deleted_at IS NOT NULL').get().n, 0);
  assert.equal((await call('GET', '/api/social/admin/posts/abc/comments')).status, 404, 'a junk post id is a 404, not an error');
});

test('PAGE: comment text and names go through fnEscape, and ids reach the handlers by data- attribute', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin-social.html'), 'utf8');
  assert.match(html, /soc-comment-text">\$\{esc\(c\.content\)\}/);
  assert.match(html, /\$\{esc\(c\.first_name\)\} \$\{esc\(c\.last_name\)\} &middot; \$\{esc\(c\.email\)\}/);
  assert.match(html, /onclick="removeComment\(this\.dataset\.post, this\.dataset\.id\)"/);
  assert.match(html, /onclick="toggleComments\(this\.dataset\.post\)"/);
});
