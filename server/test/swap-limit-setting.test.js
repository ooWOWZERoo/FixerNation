// The FNE admin setting behind the library swap limit (routes/settings.js, lib/settings.js): default 3, 0 is allowed
// (teachers cannot remove lessons), whole numbers 0 to 100 only, and the library routes read it.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT)');
const pool = {
  query: async (sql, params = []) => {
    const s = sql.trim().replace(/^INSERT INTO settings \(setting_key, setting_value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE setting_value = \?$/,
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value');
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const usable = /ON CONFLICT/.test(s) ? params.slice(0, 2) : params;
    const r = db.prepare(s).run(...usable);
    return [{ affectedRows: Number(r.changes) }];
  },
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => (req.get('x-admin') ? next() : res.status(401).json({ error: 'no' })), getAuthUser: () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
require('express-async-errors');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/settings', require(path.join(SERVER, 'routes/settings.js')));
const { getSwapLimit } = require(path.join(SERVER, 'lib/lesson-library.js'));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, body, admin = true) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = admin ? { 'x-admin': '1' } : {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: '/api/settings/teacher-lesson-plan-swap-limit', headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('the default is 3, and the library code agrees', async () => {
  db.exec('DELETE FROM settings');
  assert.deepEqual((await call('GET')).json, { limit: 3 });
  assert.equal(await getSwapLimit(), 3);
});

test('an admin can set 0, 1 or 100, and the library code reads it', async () => {
  for (const n of [0, 1, 100, '7']) {
    assert.equal((await call('PUT', { limit: n })).status, 200);
    assert.equal((await call('GET')).json.limit, Number(n));
    assert.equal(await getSwapLimit(), Number(n));
  }
});

test('anything else is refused and the saved value stays', async () => {
  await call('PUT', { limit: 4 });
  for (const bad of [-1, 101, 2.5, 'abc', '', null, undefined, '1e2', '4x']) {
    assert.equal((await call('PUT', { limit: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal((await call('GET')).json.limit, 4);
});

test('only an FNE admin can read or change it', async () => {
  assert.equal((await call('GET', undefined, false)).status, 401);
  assert.equal((await call('PUT', { limit: 9 }, false)).status, 401);
});
