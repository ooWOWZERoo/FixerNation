// A teacher accepting an invitation must be let in under the same rule that let the administrator send it
// (lib/license-access.js, docs/reference/po-license-activation-requirements.md): paid, OR a purchase order that has been
// received. Before Release 105 the four accept routes in routes/school-invite.js still asked only "is the invoice paid?",
// so a PO school could send invitations and then every teacher was told the license was "pending payment".
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, school_domain TEXT, payment_status TEXT, payment_method TEXT, license_status TEXT, license_product_id INTEGER);
CREATE TABLE license_products (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, password_hash TEXT);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, first_name TEXT, last_name TEXT, token TEXT, status TEXT, grade_level TEXT, audiences TEXT, department TEXT, personal_message TEXT, expires_at TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER);
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/\s+FOR UPDATE\s*$/i, '');
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const pool = { query: run, async getConnection() { return { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }; } };
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => null },
  [path.join(SERVER, 'lib/teacher-onboarding.js')]: { onboardInvitedTeacher: async () => {} },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/school-invite', require(path.join(SERVER, 'routes/school-invite.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

let n = 0;
function invitation(purchase) {
  n += 1;
  const p = db.prepare('INSERT INTO purchases (school_domain, payment_status, payment_method, license_status) VALUES (?, ?, ?, ?)')
    .run('school.example.com', purchase.payment_status, purchase.payment_method, purchase.license_status);
  const token = `tok-${n}`;
  db.prepare("INSERT INTO school_invitations (purchase_id, invited_email, first_name, last_name, token, status, expires_at) VALUES (?, ?, 'Tess', 'Teacher', ?, 'pending', '2999-01-01 00:00:00')")
    .run(Number(p.lastInsertRowid), `tess${n}@school.example.com`, token);
  return token;
}

const CASES = [
  ['PO received, invoice not paid', { payment_status: 'pending', payment_method: 'po', license_status: 'active' }, true],
  ['PO received, expiring soon, not paid', { payment_status: 'pending', payment_method: 'po', license_status: 'expiring_soon' }, true],
  ['PO received and paid', { payment_status: 'paid', payment_method: 'po', license_status: 'active' }, true],
  ['card, paid', { payment_status: 'paid', payment_method: 'card', license_status: 'active' }, true],
  ['PO placed, not received', { payment_status: 'pending', payment_method: 'po', license_status: 'pending' }, false],
  ['card, not paid', { payment_status: 'pending', payment_method: 'card', license_status: 'active' }, false],
];

for (const [label, purchase, open] of CASES) {
  test(`VALIDATE: ${label} -> ${open ? 'the invitation opens' : 'told the license is not active'}`, async () => {
    const r = await call('GET', `/api/school-invite/validate?token=${invitation(purchase)}`);
    if (open) { assert.equal(r.status, 200); assert.equal(r.json.valid, true); assert.ok(!r.json.paymentPending); }
    else { assert.equal(r.status, 422); assert.equal(r.json.paymentPending, true); }
  });
}

test('REGISTER and ACCEPT-AND-VERIFY use the same rule as validate', async () => {
  const po = invitation({ payment_status: 'pending', payment_method: 'po', license_status: 'active' });
  const notYet = invitation({ payment_status: 'pending', payment_method: 'po', license_status: 'pending' });
  // Past the license gate a later step may fail in this small database; what matters is whether the gate itself says no.
  const gate = (r) => r.status === 422 && /not yet active/.test(r.json.error || '');
  const reg = (token) => call('POST', '/api/school-invite/register', { token, firstName: 'Tess', lastName: 'Teacher', password: 'a-long-password-1' });
  const acc = (token) => call('POST', '/api/school-invite/accept-and-verify', { token, password: 'a-long-password-1' });
  assert.equal(gate(await reg(po)), false, 'register: PO received must get past the license gate');
  assert.equal(gate(await reg(notYet)), true, 'register: PO not received is still refused');
  assert.equal(gate(await acc(po)), false, 'accept-and-verify: PO received must get past the license gate');
  assert.equal(gate(await acc(notYet)), true, 'accept-and-verify: PO not received is still refused');
});
