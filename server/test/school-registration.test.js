// Tests for teacher self-registration seat checks (routes/school-registration.js POST /check).
// What must hold: a brand-new license (every seat an 'available' placeholder) is NOT full, a seat is reserved
// for the teacher, released ('revoked') seats don't count, real seats do, and a full license says no_seats.
// Same counting rule as inviteTeacherToSeat in lib/teacher-invitations.js.
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
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, product_type TEXT NOT NULL DEFAULT 'group_license', school_domain TEXT,
  seat_count INTEGER NOT NULL DEFAULT 0, payment_status TEXT, license_status TEXT, contact_id INTEGER, purchased_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT);
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/\s+FOR UPDATE\s*$/i, '');
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const pool = {
  query: run,
  async getConnection() { return { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }; },
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'lib/mailer.js')]: { sendContactFormEmail: async () => {} },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next() },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/school-registration', require(path.join(SERVER, 'routes/school-registration.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function check(email) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, firstName: 'Tess', lastName: 'Teacher' });
    const req = http.request({ port, method: 'POST', path: '/api/school-registration/check',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
    (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); });
    req.on('error', reject); req.write(data); req.end();
  });
}
function license(domain, seatCount, seats = {}) {
  db.exec('DELETE FROM license_seats; DELETE FROM purchases; DELETE FROM school_audit_log');
  const id = Number(db.prepare(`INSERT INTO purchases (school_domain, seat_count, payment_status, license_status) VALUES (?, ?, 'paid', 'active')`).run(domain, seatCount).lastInsertRowid);
  for (const [status, n] of Object.entries(seats)) for (let i = 0; i < n; i++) db.prepare('INSERT INTO license_seats (purchase_id, status) VALUES (?, ?)').run(id, status);
  return id;
}
const seatRows = (id) => db.prepare('SELECT status, invited_email FROM license_seats WHERE purchase_id = ?').all(id);

test('NEW LICENSE: seats that are all unclaimed placeholders do not make the license look full', async () => {
  const id = license('oak.example.edu', 5, { available: 5 });
  const r = await check('tess@oak.example.edu');
  assert.equal(r.json.eligible, true, 'a new license with 5 free seats must let a teacher register');
  assert.ok(seatRows(id).some(s => s.status === 'pending' && s.invited_email === 'tess@oak.example.edu'), 'a seat is reserved for the teacher');
});

test('COUNT: released seats do not count, real seats do', async () => {
  const id = license('oak.example.edu', 3, { registered: 1, pending: 1, revoked: 4, available: 2 });
  assert.equal((await check('a@oak.example.edu')).json.eligible, true, '2 of 3 seats in use, so one is left');
  const full = await check('b@oak.example.edu');
  assert.equal(full.json.eligible, false, 'now 3 of 3 are in use');
  assert.equal(full.json.reason, 'no_seats');
  assert.equal(full.json.usedSeats, 3);
  assert.equal(seatRows(id).filter(s => s.invited_email === 'b@oak.example.edu').length, 0, 'no seat is reserved when full');
});

test('FULL: a license whose every seat is registered says no_seats', async () => {
  license('oak.example.edu', 2, { registered: 2 });
  const r = await check('tess@oak.example.edu');
  assert.equal(r.json.eligible, false);
  assert.equal(r.json.reason, 'no_seats');
});

test('OTHER REASONS are unchanged: unknown school, unpaid license', async () => {
  license('oak.example.edu', 2, { available: 2 });
  assert.equal((await check('tess@elm.example.edu')).json.reason, 'no_school');
  db.exec(`UPDATE purchases SET license_status = 'pending'`);
  assert.equal((await check('tess@oak.example.edu')).json.reason, 'license_pending');
});
