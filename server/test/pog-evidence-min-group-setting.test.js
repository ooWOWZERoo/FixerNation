// The FNE admin setting behind Graduate Evidence's smallest-group rule (routes/settings.js, lib/pog-evidence.js): default 10,
// whole numbers 5 to 100 only, and the reading code (clampMinGroup, used by routes/pog-evidence.js) can never go below 5.
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
const pog = require(path.join(SERVER, 'lib/pog-evidence.js'));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, body, admin = true) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = admin ? { 'x-admin': '1' } : {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: '/api/settings/pog-evidence-min-group', headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('the default is 10, with the allowed range shown', async () => {
  db.exec('DELETE FROM settings');
  assert.deepEqual((await call('GET')).json, { students: 10, min: 5, max: 100 });
});

test('an admin can set 5, 25 or 100 (a number or numeric text) and the reading code agrees', async () => {
  for (const n of [5, 25, 100, '12']) {
    const put = await call('PUT', { students: n });
    assert.equal(put.status, 200);
    assert.equal(put.json.students, Number(n));
    assert.equal((await call('GET')).json.students, Number(n));
    const [rows] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', ['pog_evidence_min_group']);
    assert.equal(pog.clampMinGroup(rows[0].setting_value), Number(n));
  }
});

test('anything else is refused and the saved value stays', async () => {
  await call('PUT', { students: 20 });
  for (const bad of [0, 1, 4, 101, 2.5, 'abc', '', null, undefined, '1e2', '20x', [20], {}, true]) {
    assert.equal((await call('PUT', { students: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal((await call('GET')).json.students, 20);
});

test('a damaged saved value can never switch the rule off', async () => {
  for (const [stored, expected] of [['garbage', 10], ['1', 5], ['0', 5], ['-3', 5], ['500', 100], [null, 10], ['30', 30]]) {
    assert.equal(pog.clampMinGroup(stored), expected, `stored ${stored}`);
  }
  db.prepare("UPDATE settings SET setting_value = '1' WHERE setting_key = 'pog_evidence_min_group'").run();
  assert.equal((await call('GET')).json.students, 5);
});

test('only an FNE admin can read or change it', async () => {
  assert.equal((await call('GET', undefined, false)).status, 401);
  assert.equal((await call('PUT', { students: 30 }, false)).status, 401);
});
