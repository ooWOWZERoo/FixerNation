// Release 94: My Lesson Plans level warning, remove and swap (routes/teacher-lesson-plans.js, routes/admin-teacher-lesson-plans.js),
// run on a real SQL engine (node:sqlite) with real transactions. Rules: docs/reference/lesson-plan-swaps-requirements.md.
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
CREATE TABLE site_user_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL, audience TEXT NOT NULL);
CREATE TABLE curricula (id INTEGER PRIMARY KEY, title TEXT, series TEXT, short_description TEXT, overview TEXT, published INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE curriculum_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER NOT NULL, audience TEXT NOT NULL);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER NOT NULL, curriculum_id INTEGER NOT NULL, selected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_user_id, curriculum_id));
CREATE TABLE teacher_lesson_plan_swaps (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL, removed_curriculum_id INTEGER NOT NULL,
  added_curriculum_id INTEGER, swapped_at TEXT DEFAULT CURRENT_TIMESTAMP, voided_at TEXT);
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
`);

// Expands array parameters into one ? each (MariaDB's IN (?) with an array), strips FOR UPDATE, and maps sqlite's UNIQUE error to MariaDB's code.
function run(sql, params = []) {
  let s = sql.trim().replace(/\s+FOR UPDATE\s*$/i, '');
  const flat = [];
  let i = 0;
  s = s.replace(/\?/g, () => {
    const p = params[i++];
    if (Array.isArray(p)) { flat.push(...p); return p.map(() => '?').join(', ') || 'NULL'; }
    flat.push(p);
    return '?';
  });
  if (/FROM license_seats/i.test(s)) return [[]]; // no trial purchases in these tests
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...flat)];
  try {
    const r = db.prepare(s).run(...flat);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY/.test(e.message)) throw Object.assign(new Error(e.message), { code: 'ER_DUP_ENTRY' });
    throw e;
  }
}
const query = async (sql, params) => run(sql, params);
const pool = {
  query,
  async getConnection() {
    return {
      query,
      beginTransaction: async () => db.exec('BEGIN'),
      commit: async () => db.exec('COMMIT'),
      rollback: async () => { try { db.exec('ROLLBACK'); } catch { /* nothing open */ } },
      release() {},
    };
  },
};

const licensed = new Set([1, 2, 3, 4]);
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
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
require('express-async-errors'); // app.js loads it, so a thrown error in an async route becomes a 500 instead of a hung request
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/teacher/lesson-plans', require(path.join(SERVER, 'routes/teacher-lesson-plans.js')));
app.use('/api/admin/teacher-lesson-plans', require(path.join(SERVER, 'routes/admin-teacher-lesson-plans.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, user, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (user) headers['x-test-user'] = String(user);
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out: ' + p)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const BASE = '/api/teacher/lesson-plans';
const add = (user, id, confirm) => call('POST', BASE, user, { curriculumId: id, ...(confirm ? { confirmMismatch: true } : {}) });
const remove = (user, id) => call('DELETE', `${BASE}/${id}`, user);
const swap = (user, out, inn, confirm) => call('POST', `${BASE}/swap`, user, { removeCurriculumId: out, addCurriculumId: inn, ...(confirm ? { confirmMismatch: true } : {}) });
const libraryOf = (user) => db.prepare('SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ? ORDER BY curriculum_id').all(user).map((r) => r.curriculum_id);

const ES = 'Elementary School', MS = 'Middle School', HS = 'High School';
function reset() {
  db.exec('DELETE FROM site_users; DELETE FROM site_user_audiences; DELETE FROM curricula; DELETE FROM curriculum_audiences; DELETE FROM teacher_lesson_plans; DELETE FROM teacher_lesson_plan_swaps; DELETE FROM settings;');
  db.exec("INSERT INTO site_users (id, email) VALUES (1, 'a@x.edu'), (2, 'b@x.edu'), (3, 'c@x.edu'), (4, 'd@x.edu'), (5, 'unlicensed@x.edu')");
  // Lessons: 10 ES, 11 ES, 12 MS, 13 ES+MS, 14 HS, 15 no levels, 16 unpublished ES
  const lesson = db.prepare('INSERT INTO curricula (id, title, published) VALUES (?, ?, ?)');
  const level = db.prepare('INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (?, ?)');
  [[10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 0]].forEach(([id, pub]) => lesson.run(id, `Lesson ${id}`, pub));
  [[10, ES], [11, ES], [12, MS], [13, ES], [13, MS], [14, HS], [16, ES]].forEach(([id, a]) => level.run(id, a));
  // Teacher 1 teaches ES; teacher 2 has no levels; teacher 3 teaches MS and HS
  db.exec(`INSERT INTO site_user_audiences (site_user_id, audience) VALUES (1, '${ES}'), (3, '${MS}'), (3, '${HS}'), (4, '${ES}'), (5, '${ES}')`);
  db.exec(`DROP TRIGGER IF EXISTS boom`);
}

test('no license: 403 everywhere; no grade levels: levels_required for add, remove and swap', async () => {
  reset();
  assert.equal((await add(5, 10)).status, 403);
  assert.equal((await remove(5, 10)).status, 403);
  assert.equal((await call('GET', BASE, 5)).status, 403);
  assert.equal((await add(0, 10)).status, 401);
  for (const r of [await add(2, 10), await remove(2, 10), await swap(2, 10, 11)]) {
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'levels_required');
  }
  assert.deepEqual(libraryOf(2), []);
});

test('adding a lesson at the teacher\'s level, or one with no levels, needs no confirmation', async () => {
  reset();
  assert.equal((await add(1, 10)).status, 200);
  assert.equal((await add(1, 13)).status, 200, 'ES+MS overlaps an ES teacher');
  assert.equal((await add(1, 15)).status, 200, 'a lesson with no levels is never a mismatch');
  assert.deepEqual(libraryOf(1), [10, 13, 15]);
});

test('a mismatched lesson answers 409 level_mismatch with both level lists, and is added once confirmed', async () => {
  reset();
  const r = await add(1, 12);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'level_mismatch');
  assert.match(r.json.error, /Curriculum level mismatch/);
  assert.deepEqual(r.json.lessonLevels, [MS]);
  assert.deepEqual(r.json.teacherLevels, [ES]);
  assert.deepEqual(libraryOf(1), []);
  assert.equal((await add(1, 12, true)).status, 200);
  assert.deepEqual(libraryOf(1), [12]);
});

test('add: unpublished or missing is 404, a full library is 400, a duplicate is 409', async () => {
  reset();
  assert.equal((await add(1, 16)).status, 404);
  assert.equal((await add(1, 999)).status, 404);
  assert.equal((await add(1, 10)).status, 200);
  assert.equal((await add(1, 10)).status, 409);
  db.exec("INSERT INTO settings VALUES ('teacher_lesson_plan_limit', '2')");
  assert.equal((await add(1, 11)).status, 200);
  const full = await add(1, 13);
  assert.equal(full.status, 400);
  assert.equal(full.json.limit, 2);
});

test('removing a lesson costs one swap; the count, the library and the history agree', async () => {
  reset();
  await add(1, 10); await add(1, 11);
  const r = await remove(1, 10);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.count, r.json.swapsUsed, r.json.swapLimit, r.json.swapsLeft], [1, 1, 3, 2]);
  assert.deepEqual(libraryOf(1), [11]);
  const log = db.prepare('SELECT * FROM teacher_lesson_plan_swaps').all();
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].site_user_id, log[0].removed_curriculum_id, log[0].added_curriculum_id], [1, 10, null]);
});

test('removing something that is not in the library is 404 and costs nothing', async () => {
  reset();
  assert.equal((await remove(1, 10)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps').get().n, 0);
});

test('with no swaps left, removal and swap are refused and the library is untouched', async () => {
  reset();
  db.exec("INSERT INTO settings VALUES ('teacher_lesson_plan_swap_limit', '1')");
  await add(1, 10); await add(1, 11); await add(1, 13);
  assert.equal((await remove(1, 10)).status, 200);
  const no = await remove(1, 11);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'no_swaps_left');
  assert.equal((await swap(1, 11, 14, true)).status, 403);
  assert.deepEqual(libraryOf(1), [11, 13]);
});

test('a swap limit of 0 turns removal off', async () => {
  reset();
  db.exec("INSERT INTO settings VALUES ('teacher_lesson_plan_swap_limit', '0')");
  await add(1, 10);
  const r = await remove(1, 10);
  assert.equal(r.status, 403);
  assert.equal(r.json.swapLimit, 0);
  assert.deepEqual(libraryOf(1), [10]);
});

test('a swap replaces one lesson with another, keeps the count, and costs one swap', async () => {
  reset();
  await add(1, 10); await add(1, 11);
  const r = await swap(1, 10, 13);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.count, r.json.swapsUsed, r.json.swapsLeft], [2, 1, 2]);
  assert.deepEqual(libraryOf(1), [11, 13]);
  const log = db.prepare('SELECT removed_curriculum_id AS r, added_curriculum_id AS a FROM teacher_lesson_plan_swaps').all();
  assert.deepEqual(log.map((x) => [x.r, x.a]), [[10, 13]]);
});

test('a swap into a mismatched lesson needs confirmation and changes nothing until it has it', async () => {
  reset();
  await add(1, 10);
  const r = await swap(1, 10, 12);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'level_mismatch');
  assert.deepEqual(libraryOf(1), [10]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps').get().n, 0);
  assert.equal((await swap(1, 10, 12, true)).status, 200);
  assert.deepEqual(libraryOf(1), [12]);
});

test('swap input checks: same lesson, not in library, already in library, unpublished', async () => {
  reset();
  await add(1, 10); await add(1, 11);
  assert.equal((await swap(1, 10, 10)).status, 400);
  assert.equal((await swap(1, 13, 14)).status, 404);
  assert.equal((await swap(1, 10, 11)).status, 409);
  assert.equal((await swap(1, 10, 16)).status, 404);
  assert.equal((await call('POST', `${BASE}/swap`, 1, {})).status, 400);
  assert.deepEqual(libraryOf(1), [10, 11]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps').get().n, 0);
});

test('a swap is all or nothing: if the history row cannot be written, the library is unchanged', async () => {
  reset();
  await add(1, 10);
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON teacher_lesson_plan_swaps BEGIN SELECT RAISE(ABORT, 'boom'); END");
  const r = await swap(1, 10, 13);
  assert.equal(r.status, 500);
  assert.deepEqual(libraryOf(1), [10], 'the removal and the addition were rolled back');
  const again = await remove(1, 10);
  assert.equal(again.status, 500);
  assert.deepEqual(libraryOf(1), [10]);
  db.exec('DROP TRIGGER boom');
});

test('teachers only ever touch their own library', async () => {
  reset();
  await add(1, 10);
  assert.equal((await remove(3, 10)).status, 404, 'another licensed teacher cannot remove it');
  assert.deepEqual(libraryOf(1), [10]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps').get().n, 0);
  assert.deepEqual((await call('GET', BASE, 3)).json.selections, []);
});

test('the library views report swaps and the teacher\'s own levels', async () => {
  reset();
  await add(1, 10);
  await remove(1, 10);
  const mine = (await call('GET', BASE, 1)).json;
  assert.deepEqual([mine.swapsUsed, mine.swapLimit, mine.swapsLeft], [1, 3, 2]);
  assert.deepEqual(mine.myAudiences, [ES]);
  const browse = (await call('GET', `${BASE}/browse`, 3)).json;
  assert.deepEqual([browse.swapsUsed, browse.swapLimit, browse.swapsLeft], [0, 3, 3]);
  assert.deepEqual(browse.myAudiences.sort(), [HS, MS]);
  assert.deepEqual(browse.curricula.find((c) => c.id === 13).audiences.sort(), [ES, MS]);
});

test('FNE admin: sees swaps used, reset gives them back and keeps the history, removing costs no swap', async () => {
  reset();
  await add(1, 10); await add(1, 11); await add(1, 13);
  await remove(1, 10); await remove(1, 11);
  const before = (await call('GET', '/api/admin/teacher-lesson-plans/1')).json;
  assert.deepEqual([before.swapsUsed, before.swapLimit, before.swapsLeft], [2, 3, 1]);

  const reset1 = await call('POST', '/api/admin/teacher-lesson-plans/1/reset-swaps');
  assert.equal(reset1.status, 200);
  assert.equal(reset1.json.restored, 2);
  assert.deepEqual([reset1.json.swapsUsed, reset1.json.swapsLeft], [0, 3]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps').get().n, 2, 'history kept');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps WHERE voided_at IS NOT NULL').get().n, 2);

  await call('DELETE', '/api/admin/teacher-lesson-plans/1/13');
  assert.equal((await call('GET', BASE, 1)).json.swapsUsed, 0, 'an admin removal is free');
  assert.equal((await call('POST', '/api/admin/teacher-lesson-plans/1/reset-swaps')).json.restored, 0);
});

test('each removal frees one slot to add, until the swaps run out; then removal is refused and no slot opens', async () => {
  reset();
  db.exec("INSERT INTO settings VALUES ('teacher_lesson_plan_limit', '3'), ('teacher_lesson_plan_swap_limit', '2')");
  const slots = async () => { const j = (await call('GET', BASE, 1)).json; return { used: j.count, free: j.limit - j.count, swapsLeft: j.swapsLeft }; };

  await add(1, 10); await add(1, 11); await add(1, 13);
  assert.deepEqual(await slots(), { used: 3, free: 0, swapsLeft: 2 });
  assert.equal((await add(1, 15)).status, 400, 'library is full');

  assert.equal((await remove(1, 10)).status, 200);               // swap 1
  assert.deepEqual(await slots(), { used: 2, free: 1, swapsLeft: 1 });
  assert.equal((await add(1, 15)).status, 200, 'the freed slot can be filled');
  assert.deepEqual(await slots(), { used: 3, free: 0, swapsLeft: 1 });

  assert.equal((await remove(1, 11)).status, 200);               // swap 2
  assert.deepEqual(await slots(), { used: 2, free: 1, swapsLeft: 0 });
  assert.equal((await add(1, 14, true)).status, 200);
  assert.deepEqual(await slots(), { used: 3, free: 0, swapsLeft: 0 });

  const refused = await remove(1, 13);                           // over the limit
  assert.equal(refused.status, 403);
  assert.deepEqual(await slots(), { used: 3, free: 0, swapsLeft: 0 }, 'a refused removal opens no slot');
  assert.equal((await add(1, 12, true)).status, 400, 'so nothing more can be added');
  assert.deepEqual(libraryOf(1), [13, 14, 15]);
});
