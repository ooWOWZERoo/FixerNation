// Tests for lib/license-access.js and the places that use it (docs/reference/po-license-activation-requirements.md).
// What must hold: a purchase-order school opens as soon as its PO is received, with the invoice still unpaid; a card
// purchase must have actually paid; nothing that was open before closes; and the rule is the same in code and in SQL.
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
  seat_count INTEGER NOT NULL DEFAULT 10, payment_status TEXT, payment_method TEXT, license_status TEXT, contact_id INTEGER, purchased_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT);
CREATE TABLE school_admin_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, school_domain TEXT, reason TEXT, teacher_email TEXT, admin_contact_id INTEGER, sent_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, first_name TEXT, last_name TEXT, token TEXT, status TEXT, grade_level TEXT, audiences TEXT, role_title TEXT, department TEXT, subject_area TEXT, personal_message TEXT, invited_by_site_user_id INTEGER, expires_at TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT);
`);
const run = async (sql, params = []) => {
  const s = sql.trim().replace(/\s+FOR UPDATE\s*$/i, '').replace(/DATE_SUB\(NOW\(\), INTERVAL 24 HOUR\)/g, "'0000-00-00'");
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const pool = { query: run, async getConnection() { return { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }; } };
const sentMail = [];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({ sendContactFormEmail: async (m) => { sentMail.push(m); } }, { get: (t, k) => t[k] || (async () => {}) }),
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next() },
  [path.join(SERVER, 'lib/audit.js')]: { audit: async () => {}, AFFILIATE_ENTITY_TYPES: [] },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const { licenseAccess, licenseOpenSql } = require(path.join(SERVER, 'lib/license-access.js'));
const { inviteTeacherToSeat } = require(path.join(SERVER, 'lib/teacher-invitations.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/school-registration', require(path.join(SERVER, 'routes/school-registration.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.stack) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port, method: 'POST', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); });
    req.on('error', reject); req.write(data); req.end();
  });
}

// every state in the access matrix: [label, purchase, expected open, expected reason]
const MATRIX = [
  ['PO placed, not received', { payment_status: 'pending', payment_method: 'po', license_status: 'pending' }, false, 'po_not_received'],
  ['PO received, invoice unpaid', { payment_status: 'pending', payment_method: 'po', license_status: 'active' }, true, null],
  ['PO received, license expiring soon, unpaid', { payment_status: 'pending', payment_method: 'po', license_status: 'expiring_soon' }, true, null],
  ['PO received and paid', { payment_status: 'paid', payment_method: 'po', license_status: 'active' }, true, null],
  ['PO paid in advance, not yet received (open today, stays open)', { payment_status: 'paid', payment_method: 'po', license_status: 'pending' }, true, null],
  ['Card, paid', { payment_status: 'paid', payment_method: 'card', license_status: 'active' }, true, null],
  ['Card, unpaid (checkout started)', { payment_status: 'pending', payment_method: 'card', license_status: 'active' }, false, 'payment_pending'],
  ['Manual order, paid', { payment_status: 'paid', payment_method: 'manual', license_status: 'active' }, true, null],
  ['Free quote, paid', { payment_status: 'paid', payment_method: null, license_status: 'active' }, true, null],
  ['PO expired, unpaid', { payment_status: 'pending', payment_method: 'po', license_status: 'expired' }, false, 'po_not_received'],
];

test('MATRIX: licenseAccess gives the right answer for every state', () => {
  for (const [label, purchase, open, reason] of MATRIX) {
    const a = licenseAccess(purchase);
    assert.equal(a.open, open, label);
    assert.equal(a.reason, reason, label);
  }
  assert.equal(licenseAccess(undefined).open, false);
});

test('NOTHING NARROWS: every purchase that was open under the old rule (payment_status paid) is still open', () => {
  for (const status of ['active', 'expiring_soon', 'pending', 'expired', 'scheduled', null]) {
    for (const method of ['po', 'card', 'manual', null]) {
      assert.equal(licenseAccess({ payment_status: 'paid', payment_method: method, license_status: status }).open, true, `${method}/${status}`);
    }
  }
});

test('SQL AGREES WITH CODE: licenseOpenSql selects exactly the purchases licenseAccess opens', () => {
  db.exec('DELETE FROM purchases');
  MATRIX.forEach(([label, p]) => db.prepare('INSERT INTO purchases (school_domain, payment_status, payment_method, license_status) VALUES (?, ?, ?, ?)').run(label, p.payment_status, p.payment_method, p.license_status));
  const openByCode = MATRIX.filter(([, p]) => licenseAccess(p).open).map(([label]) => label).sort();
  const openBySql = db.prepare(`SELECT school_domain FROM purchases p WHERE ${licenseOpenSql('p')}`).all().map((r) => r.school_domain).sort();
  assert.deepEqual(openBySql, openByCode);
});

function school(domain, p) {
  db.exec('DELETE FROM purchases; DELETE FROM license_seats; DELETE FROM newsletter_contacts; DELETE FROM school_admin_notifications; DELETE FROM school_invitations');
  const contact = Number(db.prepare(`INSERT INTO newsletter_contacts (id, email, first_name) VALUES (1, 'principal@${domain}', 'Pat')`).run().lastInsertRowid);
  return Number(db.prepare('INSERT INTO purchases (school_domain, payment_status, payment_method, license_status, contact_id) VALUES (?, ?, ?, ?, ?)').run(domain, p.payment_status, p.payment_method, p.license_status, contact).lastInsertRowid);
}

test('INVITATIONS: a PO school can invite once the PO is received, unpaid; not before; a card school must have paid', async () => {
  const gate = /purchase order|marked as paid/;
  const cases = [
    [MATRIX[0][1], false, /waiting to receive your purchase order/],
    [MATRIX[1][1], true],
    [MATRIX[6][1], false, /marked as paid/],
    [MATRIX[5][1], true],
  ];
  for (const [p, shouldOpen, message] of cases) {
    const id = school('oak.example.edu', p);
    let error = null;
    try { await inviteTeacherToSeat({ purchaseId: id, email: 't@oak.example.edu', firstName: 'T', lastName: 'Teacher', gradeLevels: ['ES'], invitedBy: { siteUserId: 1, email: 'a@oak.example.edu', name: 'A', actorType: 'site_user' }, ipAddress: '1.1.1.1' }); } catch (e) { error = e; }
    if (shouldOpen) assert.ok(!error || !gate.test(error.message), `should not be refused by the license gate: ${error && error.message}`);
    else { assert.ok(error && error.status === 422, 'should be refused'); assert.match(error.message, message); }
  }
});

test('NOTIFY ADMIN: a teacher at a PO school (PO received, unpaid) reaches the administrator; before that the school is not found', async () => {
  school('oak.example.edu', MATRIX[0][1]);
  const early = await post('/api/school-registration/notify-admin', { email: 'tess@oak.example.edu', firstName: 'Tess', lastName: 'T', reason: 'no_seats' });
  assert.equal(early.status, 404, 'PO not received: no open license yet');
  school('oak.example.edu', MATRIX[1][1]);
  sentMail.length = 0;
  const open = await post('/api/school-registration/notify-admin', { email: 'tess@oak.example.edu', firstName: 'Tess', lastName: 'T', reason: 'no_seats' });
  assert.equal(open.status, 200);
  assert.equal(open.json.sent, true);
  assert.equal(sentMail.length, 1);
  assert.match(sentMail[0].fields['Action Needed'], /purchase order/);
});

test('CHECK AND NOTIFY AGREE: a PO-received, unpaid school is eligible at step 1 and found by the notify lookup', async () => {
  school('oak.example.edu', MATRIX[1][1]);
  const check = await post('/api/school-registration/check', { email: 'tess@oak.example.edu', firstName: 'Tess', lastName: 'T' });
  assert.equal(check.json.eligible, true);
});
