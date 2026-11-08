// Release 148: an admin can give one affiliate every county of a state. Overlap with other affiliates is allowed only here, only
// after the admin has seen who holds what and confirmed. Docs: docs/reference/affiliate-whole-state-requirements.md.
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
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT);
CREATE TABLE affiliates (id INTEGER PRIMARY KEY, site_user_id INTEGER, status TEXT DEFAULT 'active');
CREATE TABLE territories (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT, state TEXT, county TEXT DEFAULT '', name TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (state, county));
CREATE TABLE affiliate_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, affiliate_id INTEGER, territory_id INTEGER, status TEXT DEFAULT 'active', assigned_by_admin_id INTEGER, revoked_at TEXT, revoked_by_admin_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO site_users VALUES (1, 'Ann', 'Ames', 'ann@aff.test'), (2, 'Ben', 'Bell', 'ben@aff.test'), (3, 'Cy', 'Cole', 'cy@aff.test');
INSERT INTO affiliates VALUES (1, 1, 'active'), (2, 2, 'active'), (3, 3, 'suspended');
`);
const audits = [];
const toSqlite = (sql) => sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\s+FOR UPDATE\b/g, '');
const run = async (sql, params = []) => {
  const s = toSqlite(sql);
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const conn = { query: run, beginTransaction: async () => db.exec('BEGIN'), commit: async () => db.exec('COMMIT'), rollback: async () => { try { db.exec('ROLLBACK'); } catch { /* no transaction open */ } }, release: () => {} };
const noop = new Proxy({}, { get: () => async () => ({}) });
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run, getConnection: async () => conn },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { if (!req.headers['x-staff']) return res.status(401).json({ error: 'Not authenticated' }); req.user = { userId: 9, username: 'admin' }; next(); } },
  [path.join(SERVER, 'lib/audit.js')]: { audit: async (c, e) => { audits.push(e); }, AFFILIATE_ENTITY_TYPES: ['affiliate'] },
  [path.join(SERVER, 'lib/mailer.js')]: { sendSalesAlertEmail: async () => {} },
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async () => {} },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => null },
  [path.join(SERVER, 'lib/site-tokens.js')]: { createToken: async () => 'x' },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { LEDGER_TOTALS_SQL: '' },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const express = require('express');
const { countiesForState } = require(path.join(SERVER, 'lib/territories.js'));
const app = express();
app.use(express.json());
app.use('/api/affiliates', require(path.join(SERVER, 'routes/affiliates.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, url, body, staff = true) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (staff) headers['x-staff'] = '1';
    const req = http.request({ port, path: url, method, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); req.end(data);
  });
}
const reset = () => { db.exec('DELETE FROM affiliate_territories; DELETE FROM territories;'); audits.length = 0; };
const active = (aff, state) => db.prepare(`SELECT COUNT(*) AS n FROM affiliate_territories at JOIN territories t ON t.id = at.territory_id WHERE at.affiliate_id = ? AND at.status = 'active' AND t.state = ?`).get(aff, state).n;
const NY = countiesForState('NY').length;

test('PREVIEW: reads only, counts the counties, and names other holders', async () => {
  reset();
  await call('POST', '/api/affiliates/2/territories', { state: 'NY', county: 'Albany County' });
  await call('POST', '/api/affiliates/2/territories', { state: 'NY', county: 'Kings County' });
  const before = db.prepare('SELECT COUNT(*) AS n FROM affiliate_territories').get().n;
  const r = await call('GET', '/api/affiliates/1/territories/whole-state?state=NY');
  assert.equal(r.status, 200);
  assert.equal(r.json.plan.totalCounties, NY);
  assert.equal(r.json.plan.toAddCount, NY);
  assert.deepEqual(r.json.plan.overlap.map((o) => o.county).sort(), ['Albany County', 'Kings County']);
  assert.equal(r.json.plan.overlap[0].holders[0].name, 'Ben Bell');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM affiliate_territories').get().n, before, 'a preview writes nothing');
});

test('NO OVERLAP: assigns every county in one go, tagged so the batch can be found', async () => {
  reset();
  const r = await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY' });
  assert.equal(r.status, 201);
  assert.equal(r.json.added, NY);
  assert.equal(r.json.overlapped, 0);
  assert.equal(active(1, 'NY'), NY);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM affiliate_territories WHERE notes = 'Whole-state assignment: NY'").get().n, NY);
  assert.equal(audits.at(-1).action, 'affiliate.whole_state_assigned');
});

test('OVERLAP: refused until the admin confirms, then both affiliates hold the shared counties', async () => {
  reset();
  await call('POST', '/api/affiliates/2/territories', { state: 'NY', county: 'Albany County' });
  const first = await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY' });
  assert.equal(first.status, 409);
  assert.equal(first.json.code, 'confirm_overlap');
  assert.equal(first.json.plan.overlap.length, 1);
  assert.equal(active(1, 'NY'), 0, 'nothing was written without the confirmation');
  const second = await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY', acknowledgeOverlap: true });
  assert.equal(second.status, 201);
  assert.equal(second.json.overlapped, 1);
  assert.equal(active(1, 'NY'), NY);
  assert.equal(active(2, 'NY'), 1, 'the other affiliate keeps theirs');
  const both = db.prepare(`SELECT COUNT(*) AS n FROM affiliate_territories at JOIN territories t ON t.id = at.territory_id WHERE t.county = 'Albany County' AND at.status = 'active'`).get().n;
  assert.equal(both, 2, 'Albany County now has two active holders');
  assert.deepEqual(audits.at(-1).newValue.otherHolders, ['Ben Bell']);
});

test('SKIP: counties the affiliate already holds are not duplicated', async () => {
  reset();
  await call('POST', '/api/affiliates/1/territories', { state: 'NY', county: 'Albany County' });
  const r = await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY' });
  assert.equal(r.status, 201);
  assert.equal(r.json.skipped, 1);
  assert.equal(r.json.added, NY - 1);
  assert.equal(active(1, 'NY'), NY);
});

test('ONE HOLDER STILL RULES single counties: assigning a held county on its own is refused', async () => {
  reset();
  await call('POST', '/api/affiliates/2/territories', { state: 'NY', county: 'Albany County' });
  const r = await call('POST', '/api/affiliates/1/territories', { state: 'NY', county: 'Albany County' });
  assert.equal(r.status, 409);
});

test('REVOKE STATE: revokes only this affiliate\'s counties in that state, in one step', async () => {
  reset();
  await call('POST', '/api/affiliates/2/territories', { state: 'NY', county: 'Albany County' });
  await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY', acknowledgeOverlap: true });
  await call('POST', '/api/affiliates/1/territories', { state: 'NJ', county: 'Bergen County' });
  const r = await call('POST', '/api/affiliates/1/territories/revoke-state', { state: 'NY' });
  assert.equal(r.status, 200);
  assert.equal(r.json.revoked, NY);
  assert.equal(active(1, 'NY'), 0);
  assert.equal(active(1, 'NJ'), 1, 'another state is untouched');
  assert.equal(active(2, 'NY'), 1, 'the other affiliate is untouched');
  assert.equal((await call('POST', '/api/affiliates/1/territories/revoke-state', { state: 'NY' })).status, 409, 'nothing left to revoke');
});

test('RULES: a suspended affiliate cannot be given a state; a bad state or unknown affiliate is refused', async () => {
  reset();
  assert.equal((await call('POST', '/api/affiliates/3/territories/whole-state', { state: 'NY' })).status, 409);
  assert.equal((await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'ZZ' })).status, 400);
  assert.equal((await call('POST', '/api/affiliates/99/territories/whole-state', { state: 'NY' })).status, 404);
  assert.equal((await call('GET', '/api/affiliates/1/territories/whole-state?state=ZZ')).status, 400);
});

test('DC is one county-equivalent, so a whole-state assignment adds one', async () => {
  reset();
  const r = await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'DC' });
  assert.equal(r.status, 201);
  assert.equal(r.json.added, countiesForState('DC').length);
});

test('ACCESS: signed out, all three routes are refused and nothing changes', async () => {
  reset();
  assert.equal((await call('GET', '/api/affiliates/1/territories/whole-state?state=NY', null, false)).status, 401);
  assert.equal((await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY' }, false)).status, 401);
  assert.equal((await call('POST', '/api/affiliates/1/territories/revoke-state', { state: 'NY' }, false)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM affiliate_territories').get().n, 0);
});

test('PAGES: the admin dialog escapes what it prints; nothing still promises "no overlap"', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'admin-affiliates.html'), 'utf8');
  assert.match(admin, /territories\/whole-state/);
  assert.match(admin, /acknowledgeOverlap: wholeStateNeedsAck/);
  assert.match(admin, /esc\(h\.name\)/);
  const promises = /no overlap|can't hold the same territory|(?<!normally )has one active affiliate|\bone active affiliate per/i;
  for (const f of ['admin-affiliates.html', 'become-an-affiliate.html', 'affiliate-terms.html', 'help-center.js']) {
    assert.ok(!promises.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} no longer promises one affiliate per territory`);
  }
});
