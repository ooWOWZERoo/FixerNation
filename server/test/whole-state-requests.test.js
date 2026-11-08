// Release 148, phase 2: an affiliate can ask for a whole state; an admin approves it through the same overlap warning.
// Docs: docs/reference/affiliate-whole-state-requirements.md. Run:  cd server && npm test
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
CREATE TABLE affiliates (id INTEGER PRIMARY KEY, site_user_id INTEGER, status TEXT DEFAULT 'active', referral_code TEXT, commission_rate REAL DEFAULT 10);
CREATE TABLE territories (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT, state TEXT, county TEXT DEFAULT '', name TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (state, county));
CREATE TABLE affiliate_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, affiliate_id INTEGER, territory_id INTEGER, status TEXT DEFAULT 'active', assigned_by_admin_id INTEGER, revoked_at TEXT, revoked_by_admin_id INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE territory_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, affiliate_id INTEGER, request_type TEXT, requested_state TEXT, requested_county TEXT NOT NULL, previous_assignment_id INTEGER, status TEXT DEFAULT 'pending', reviewed_by_admin_id INTEGER, reviewed_at TEXT, rejection_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO site_users VALUES (1, 'Ann', 'Ames', 'ann@aff.test'), (2, 'Ben', 'Bell', 'ben@aff.test'), (3, 'Cy', 'Cole', 'cy@aff.test');
INSERT INTO affiliates (id, site_user_id, status, referral_code) VALUES (1, 1, 'active', 'ANN'), (2, 2, 'active', 'BEN'), (3, 3, 'suspended', 'CY');
`);
const emails = [];
const audits = [];
const toSqlite = (sql) => sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\s+FOR UPDATE\b/g, '');
const run = async (sql, params = []) => {
  const s = toSqlite(sql);
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const conn = { query: run, beginTransaction: async () => db.exec('BEGIN'), commit: async () => db.exec('COMMIT'), rollback: async () => { try { db.exec('ROLLBACK'); } catch { /* none open */ } }, release: () => {} };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run, getConnection: async () => conn },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { if (!req.headers['x-staff']) return res.status(401).json({ error: 'Not authenticated' }); req.user = { userId: 9, username: 'admin' }; next(); } },
  [path.join(SERVER, 'routes/site-auth.js')]: { requireSiteAuth: (req, res, next) => { if (!req.headers['x-user']) return res.status(401).json({ error: 'Not signed in' }); req.siteUser = { id: Number(req.headers['x-user']), first_name: 'T', email: 't@aff.test' }; next(); } },
  [path.join(SERVER, 'lib/audit.js')]: { audit: async (c, e) => { audits.push(e); }, AFFILIATE_ENTITY_TYPES: ['affiliate'] },
  [path.join(SERVER, 'lib/mailer.js')]: { sendSalesAlertEmail: async () => {} },
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async (key, data) => { emails.push({ key, ...data }); } },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => null },
  [path.join(SERVER, 'lib/site-tokens.js')]: { createToken: async () => 'x' },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { LEDGER_TOTALS_SQL: 'SELECT 1 AS x' },
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
app.use('/api/affiliate-portal', require(path.join(SERVER, 'routes/affiliate-portal.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, url, body, who = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (who.staff) headers['x-staff'] = '1';
    if (who.user) headers['x-user'] = String(who.user);
    const req = http.request({ port, path: url, method, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); req.end(data);
  });
}
const ann = { user: 1 };
const staff = { staff: true };
const reset = () => { db.exec('DELETE FROM affiliate_territories; DELETE FROM territories; DELETE FROM territory_requests;'); emails.length = 0; audits.length = 0; };
const heldBy = (aff, state) => db.prepare(`SELECT COUNT(*) AS n FROM affiliate_territories at JOIN territories t ON t.id = at.territory_id WHERE at.affiliate_id = ? AND at.status = 'active' AND t.state = ?`).get(aff, state).n;
const NY = countiesForState('NY').length;
const reqId = () => db.prepare('SELECT MAX(id) AS id FROM territory_requests').get().id; // AUTOINCREMENT keeps counting after a reset
const askNY = (who = ann) => call('POST', '/api/affiliate-portal/territories/request', { state: 'NY', wholeState: true }, who);

test('REQUEST: an affiliate can ask for a whole state; it is stored with no county and nothing is assigned yet', async () => {
  reset();
  const r = await askNY();
  assert.equal(r.status, 201);
  assert.equal(r.json.requestType, 'initial');
  const row = db.prepare('SELECT * FROM territory_requests').get();
  assert.equal(row.requested_state, 'NY');
  assert.equal(row.requested_county, '');
  assert.equal(heldBy(1, 'NY'), 0, 'a request assigns nothing');
  assert.equal(emails[0].mergeFields.territory, 'All of New York');
  const mine = await call('GET', '/api/affiliate-portal/territories/requests', null, ann);
  assert.equal(mine.json.requests[0].requestedLabel, 'All of New York');
  assert.equal(mine.json.requests[0].wholeState, true);
});

test('REQUEST RULES: one pending request at a time; a whole state cannot replace one county; already holding all of it is refused', async () => {
  reset();
  assert.equal((await askNY()).status, 201);
  assert.equal((await askNY()).status, 409, 'a second request while one is pending');
  reset();
  await call('POST', '/api/affiliates/1/territories', { state: 'NY', county: 'Albany County' }, staff);
  const change = await call('POST', '/api/affiliate-portal/territories/request', { state: 'NY', wholeState: true, requestType: 'change', previousAssignmentId: 1 }, ann);
  assert.equal(change.status, 400);
  reset();
  await call('POST', '/api/affiliates/1/territories/whole-state', { state: 'NY' }, staff);
  assert.equal((await askNY()).status, 409, 'already holds every county');
  reset();
  assert.equal((await call('POST', '/api/affiliate-portal/territories/request', { state: 'ZZ', wholeState: true }, ann)).status, 400);
});

test('A county request still needs a real county', async () => {
  reset();
  assert.equal((await call('POST', '/api/affiliate-portal/territories/request', { state: 'NY', county: 'Nowhere County' }, ann)).status, 400);
  assert.equal((await call('POST', '/api/affiliate-portal/territories/request', { state: 'NY', county: 'albany county' }, ann)).status, 201);
});

test('ADMIN LIST: the queue names the request "All of New York"', async () => {
  reset();
  await askNY();
  const r = await call('GET', '/api/affiliates/territory-requests', null, staff);
  assert.equal(r.json.requests[0].requestedLabel, 'All of New York');
  assert.equal(r.json.requests[0].wholeState, true);
});

test('APPROVE with no overlap: every county is assigned and the request is approved', async () => {
  reset();
  await askNY();
  const r = await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, {}, staff);
  assert.equal(r.status, 200);
  assert.equal(r.json.added, NY);
  assert.equal(heldBy(1, 'NY'), NY);
  assert.equal(db.prepare('SELECT status FROM territory_requests WHERE id = ?').get(reqId()).status, 'approved');
  assert.equal(emails.at(-1).key, 'affiliate_territory_request_approved');
  assert.equal(emails.at(-1).mergeFields.territory, 'All of New York');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM affiliate_territories WHERE notes = ?").get(`Approved territory request #${reqId()}`).n, NY);
});

test('APPROVE with overlap: refused until the admin confirms, and the request stays pending meanwhile', async () => {
  reset();
  await call('POST', '/api/affiliates/2/territories', { state: 'NY', county: 'Kings County' }, staff);
  await askNY();
  const first = await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, {}, staff);
  assert.equal(first.status, 409);
  assert.equal(first.json.code, 'confirm_overlap');
  assert.equal(first.json.plan.overlap[0].holders[0].name, 'Ben Bell');
  assert.equal(db.prepare('SELECT status FROM territory_requests WHERE id = ?').get(reqId()).status, 'pending');
  assert.equal(heldBy(1, 'NY'), 0);
  const second = await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, { acknowledgeOverlap: true }, staff);
  assert.equal(second.status, 200);
  assert.equal(second.json.overlapped, 1);
  assert.equal(heldBy(1, 'NY'), NY);
  assert.equal(heldBy(2, 'NY'), 1, 'the other affiliate keeps theirs');
  assert.equal(db.prepare('SELECT status FROM territory_requests WHERE id = ?').get(reqId()).status, 'approved');
  assert.deepEqual(audits.at(-1).newValue.otherHolders, ['Ben Bell']);
});

test('APPROVE is refused for a suspended affiliate, and a decided request cannot be approved twice', async () => {
  reset();
  db.prepare("INSERT INTO territory_requests (affiliate_id, request_type, requested_state, requested_county) VALUES (3, 'initial', 'NY', '')").run();
  assert.equal((await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, { acknowledgeOverlap: true }, staff)).status, 409);
  reset();
  await askNY();
  assert.equal((await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, {}, staff)).status, 200);
  assert.equal((await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, {}, staff)).status, 409);
});

test('REJECT works on a whole-state request, and signed-out visitors are refused everywhere', async () => {
  reset();
  await askNY();
  assert.equal((await call('POST', `/api/affiliates/territory-requests/${reqId()}/reject`, { reason: 'Too large for now.' }, staff)).status, 200);
  assert.equal(heldBy(1, 'NY'), 0);
  assert.equal((await call('POST', '/api/affiliate-portal/territories/request', { state: 'NY', wholeState: true }, {})).status, 401);
  assert.equal((await call('POST', `/api/affiliates/territory-requests/${reqId()}/approve`, {}, {})).status, 401);
});

test('PAGES: the dashboard offers all counties and the admin approval uses the overlap dialog', () => {
  const dash = fs.readFileSync(path.join(ROOT, 'affiliate-dashboard.html'), 'utf8');
  assert.match(dash, /value="__ALL__">All counties in this state/);
  assert.match(dash, /wholeState: wholeState/);
  const admin = fs.readFileSync(path.join(ROOT, 'admin-affiliates.html'), 'utf8');
  assert.match(admin, /startWholeStateRequest\(wholeReq\)/);
  assert.match(admin, /territory-requests\/' \+ wholeStateRequestId \+ '\/approve/);
  assert.match(fs.readFileSync(path.join(SERVER, 'db/schema.sql'), 'utf8'), /requested_county VARCHAR\(100\) NOT NULL, -- a county/);
});
