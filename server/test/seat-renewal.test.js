// Renewing an expired license brings back the seats the expiry job switched off, and only those.
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
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, product_type TEXT DEFAULT 'group_license', license_status TEXT, effective_date TEXT, expiration_date TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending',
  inactive_reason TEXT, registered_site_user_id INTEGER);
CREATE TABLE site_users (id INTEGER PRIMARY KEY, session_invalidated_at TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER);
`);
const run = async (sql, rawParams = []) => {
  // mysql2 expands an array parameter (IN (?)); SQLite does not, so do it here.
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/NOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const noop = () => {};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({}, { get: () => async () => {} }),
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async () => {} },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { attributePurchase: async () => {} },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const { restoreExpiredSeats } = require(path.join(SERVER, 'lib/seat-renewal.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/newsletter', require(path.join(SERVER, 'routes/newsletter.js')).router);
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function put(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port, method: 'PUT', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); });
    req.on('error', reject); req.write(data); req.end();
  });
}

// An expired purchase with: a teacher the expiry switched off, one the school admin switched off by hand,
// an invitation not yet accepted, and an unclaimed seat.
function expiredSchool() {
  const pid = Number(db.prepare("INSERT INTO purchases (license_status, expiration_date) VALUES ('expired', '2026-06-30')").run().lastInsertRowid);
  const seat = (email, status, reason, user) =>
    Number(db.prepare('INSERT INTO license_seats (purchase_id, invited_email, status, inactive_reason, registered_site_user_id) VALUES (?, ?, ?, ?, ?)')
      .run(pid, email, status, reason, user).lastInsertRowid);
  return {
    pid,
    expired: seat('a@x.example.com', 'inactive', 'license_expired', 11),
    byHand: seat('b@x.example.com', 'inactive', null, 12),
    invite: seat('c@x.example.com', 'inactive', 'license_expired', null),
    open: seat(null, 'inactive', 'license_expired', null),
  };
}
const statusOf = (id) => db.prepare('SELECT status, inactive_reason FROM license_seats WHERE id = ?').get(id);

test('restoreExpiredSeats: expired seats come back as what they were, the admin-deactivated one stays off', async () => {
  const s = expiredSchool();
  assert.equal(await restoreExpiredSeats({ query: run }, s.pid), 3);
  assert.deepEqual({ ...statusOf(s.expired) }, { status: 'registered', inactive_reason: null });
  assert.deepEqual({ ...statusOf(s.invite) }, { status: 'pending', inactive_reason: null });
  assert.deepEqual({ ...statusOf(s.open) }, { status: 'available', inactive_reason: null });
  assert.deepEqual({ ...statusOf(s.byHand) }, { status: 'inactive', inactive_reason: null });
});

test('restoreExpiredSeats: running it twice changes nothing the second time, and other schools are untouched', async () => {
  const s = expiredSchool();
  const other = expiredSchool();
  await restoreExpiredSeats({ query: run }, s.pid);
  assert.equal(await restoreExpiredSeats({ query: run }, s.pid), 0);
  assert.equal(statusOf(other.expired).status, 'inactive');
});

test('license-dates route: renewing to active restores the seats and says how many', async () => {
  const s = expiredSchool();
  const r = await put(`/api/newsletter/purchases/${s.pid}/license-dates`, { licenseStatus: 'active', effectiveDate: '2026-07-01', expirationDate: '2027-06-30' });
  assert.equal(r.status, 200);
  assert.equal(r.json.seatsRestored, 3);
  assert.equal(statusOf(s.expired).status, 'registered');
  assert.equal(statusOf(s.byHand).status, 'inactive');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM school_audit_log WHERE action = 'seats_restored_on_renewal' AND entity_id = ?").get(s.pid).n, 1);
});

test('license-dates route: a status that keeps access closed restores nothing', async () => {
  for (const status of ['expired', 'suspended', 'cancelled', 'pending']) {
    const s = expiredSchool();
    const r = await put(`/api/newsletter/purchases/${s.pid}/license-dates`, { licenseStatus: status, effectiveDate: '2026-07-01', expirationDate: '2027-06-30' });
    assert.equal(r.json.seatsRestored, 0, status);
    assert.equal(statusOf(s.expired).status, 'inactive', status);
  }
});
