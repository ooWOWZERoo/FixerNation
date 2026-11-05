// Release 114: deleting a CRM contact closes the person's sign-in account; staff can reopen it; changing a contact's email moves the
// account's email (docs/reference/crm-record-of-truth-requirements.md rules B, C and E). Closed accounts cannot sign in or use the site.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, role TEXT DEFAULT 'teacher', password_hash TEXT, email_verified INTEGER DEFAULT 1,
  is_sales_demo INTEGER DEFAULT 0, is_fne_staff INTEGER DEFAULT 0, session_invalidated_at TEXT, closed_at TEXT, closed_reason TEXT, microsoft_oid TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT, phone TEXT, company TEXT, street TEXT, city TEXT, state TEXT, zip TEXT,
  source TEXT, status TEXT, notes TEXT, ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, license_status TEXT, expiration_date TEXT, school_domain TEXT, school_id INTEGER);
CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, invited_email TEXT, registered_site_user_id INTEGER, registered_at TEXT, invitation_id INTEGER);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, status TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE districts (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER);
CREATE TABLE affiliates (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, status TEXT);
CREATE TABLE social_group_members (group_id INTEGER, user_id INTEGER);
CREATE TABLE social_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, avatar_url TEXT, bio TEXT, bio_consent INTEGER DEFAULT 0);
CREATE TABLE contact_groups (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE contact_group_members (contact_id INTEGER, group_id INTEGER);
CREATE TABLE site_user_audiences (site_user_id INTEGER, audience TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT);
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const conn = { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
const noop = new Proxy({}, { get: () => async () => ({}) });
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run, getConnection: async () => conn },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { req.user = { userId: 7 }; next(); }, getAuthUser: () => null },
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: (kind, token) => ({ userId: Number(token), iat: Math.floor(Date.now() / 1000) }) },
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
const cookieParser = require('cookie-parser');
const { getSiteUser } = require(path.join(SERVER, 'lib/site-user.js'));
const { closeAccount, reopenAccount, describeConsequences } = require(path.join(SERVER, 'lib/account-closing.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/newsletter', require(path.join(SERVER, 'routes/newsletter.js')).router);
app.use('/api/admin/account-lookup', require(path.join(SERVER, 'routes/admin-account-lookup.js')));
app.use('/api/social', require(path.join(SERVER, 'routes/social.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { as = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (as) headers.Cookie = `fn_user_session=${as}`;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const reset = () => { for (const t of ['site_users', 'newsletter_contacts', 'purchases', 'invoices', 'license_seats', 'school_invitations', 'school_license_admins', 'district_license_admins', 'districts', 'schools', 'affiliates', 'social_group_members', 'social_profiles', 'school_audit_log']) db.exec(`DELETE FROM ${t}`); };
let n = 0;
// a person with a sign-in account and a CRM contact; opts: seat, schoolAdmin, districtAdmin, role, staff
function person(name, o = {}) {
  n += 1;
  const email = `${name.toLowerCase()}${n}@school.test`;
  const uid = Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, role, is_fne_staff) VALUES (?, ?, ?, ?, ?)').run(email, name, 'T', o.role || 'teacher', o.staff ? 1 : 0).lastInsertRowid);
  const cid = Number(db.prepare('INSERT INTO newsletter_contacts (email, name, status) VALUES (?, ?, ?)').run(email, name, 'Subscribed').lastInsertRowid);
  if (o.seat || o.schoolAdmin) {
    const pid = Number(db.prepare("INSERT INTO purchases (license_status, expiration_date, school_domain) VALUES ('active', '2999-01-01', ?)").run(`s${n}.test`).lastInsertRowid);
    if (o.seat) db.prepare("INSERT INTO license_seats (purchase_id, status, invited_email, registered_site_user_id, registered_at) VALUES (?, 'registered', ?, ?, '2026-10-20')").run(pid, email, uid);
    if (o.schoolAdmin) db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id) VALUES (?, ?)').run(uid, pid);
  }
  if (o.districtAdmin) { db.prepare("INSERT OR IGNORE INTO districts VALUES (5, 'Riverbend')").run(); db.prepare('INSERT INTO district_license_admins (site_user_id, district_id) VALUES (?, 5)').run(uid); }
  db.prepare('INSERT INTO social_group_members (group_id, user_id) VALUES (1, ?)').run(uid);
  return { uid, cid, email };
}
const user = (uid) => db.prepare('SELECT * FROM site_users WHERE id = ?').get(uid);
const del = (cid, body = {}) => call('DELETE', `/api/newsletter/contacts/${cid}`, { body });

test('NO ROLES: deleting a contact closes its account at once (no confirmation needed) and the contact is gone', async () => {
  reset();
  const p = person('Plain');
  const r = await del(p.cid);
  assert.equal(r.status, 200); assert.equal(r.json.accountClosed, true);
  assert.ok(user(p.uid).closed_at); assert.equal(user(p.uid).closed_reason, 'crm_contact_deleted');
  assert.ok(user(p.uid).session_invalidated_at, 'signed out everywhere');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts WHERE id = ?').get(p.cid).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM school_audit_log WHERE action = 'account_closed' AND entity_id = ?").get(p.uid).n, 1);
});

test('NO ACCOUNT: deleting a plain lead works as before', async () => {
  reset();
  const cid = Number(db.prepare("INSERT INTO newsletter_contacts (email, name) VALUES ('lead@school.test', 'Lead')").run().lastInsertRowid);
  const r = await del(cid);
  assert.equal(r.status, 200); assert.equal(r.json.accountClosed, false);
});

test('SEAT OR ROLE: the server asks for confirmation and says what closing takes away; nothing changes until confirmed', async () => {
  reset();
  const t = person('Teach', { seat: true });
  const a = person('Admin', { schoolAdmin: true, districtAdmin: true });
  const first = await del(t.cid);
  assert.equal(first.status, 409); assert.equal(first.json.code, 'confirm_close');
  assert.equal(first.json.consequences.seats.length, 1);
  assert.match(first.json.error, /holds a license seat/);
  assert.equal(user(t.uid).closed_at, null); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts WHERE id = ?').get(t.cid).n, 1);
  const adm = await del(a.cid);
  assert.equal(adm.status, 409);
  assert.equal(adm.json.consequences.schoolAdmin.length, 1); assert.deepEqual(adm.json.consequences.districtAdmin, ['Riverbend']);
  assert.match(adm.json.error, /school license administrator.*district administrator/);
});

test('CONFIRMED CLOSE: seat goes back to the pool, roles end, groups left, invitations revoked', async () => {
  reset();
  const t = person('Teach', { seat: true });
  const a = person('Admin', { schoolAdmin: true, districtAdmin: true });
  db.prepare("INSERT INTO school_invitations (invited_email, status) VALUES (?, 'pending')").run(t.email);
  assert.equal((await del(t.cid, { confirmClose: true })).status, 200);
  assert.equal((await del(a.cid, { confirmClose: true })).status, 200);
  const seat = db.prepare('SELECT * FROM license_seats').get();
  assert.equal(seat.status, 'available'); assert.equal(seat.registered_site_user_id, null); assert.equal(seat.invited_email, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM school_license_admins WHERE is_active = 1').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM district_license_admins WHERE is_active = 1').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_group_members').get().n, 0);
  assert.equal(db.prepare("SELECT status FROM school_invitations").get().status, 'revoked');
});

test('PROTECTED: a buyer\'s contact is still refused, and a staff account is never closed', async () => {
  reset();
  const buyer = person('Buyer');
  db.prepare("INSERT INTO purchases (contact_id, license_status) VALUES (?, 'active')").run(buyer.cid);
  const staff = person('Staff', { staff: true });
  const adminRole = person('Roleadmin', { role: 'admin' });
  assert.equal((await del(buyer.cid, { confirmClose: true })).json.code, 'contact_owns_purchases');
  assert.equal((await del(staff.cid, { confirmClose: true })).json.code, 'staff_account');
  assert.equal((await del(adminRole.cid, { confirmClose: true })).json.code, 'staff_account');
  assert.equal(user(buyer.uid).closed_at, null); assert.equal(user(staff.uid).closed_at, null); assert.equal(user(adminRole.uid).closed_at, null);
});

test('CLOSED ACCOUNT is not signed in anywhere: getSiteUser, Community, even with a valid cookie', async () => {
  reset();
  const p = person('Gone', { seat: true });
  db.prepare('INSERT INTO social_profiles (user_id) VALUES (?)').run(p.uid);
  const before = await call('GET', '/api/social/members', { as: p.uid }); assert.equal(before.status, 200, 'before closing ' + JSON.stringify(before.json));
  await del(p.cid, { confirmClose: true });
  assert.equal(await getSiteUser({ cookies: { fn_user_session: String(p.uid) } }), null);
  assert.equal((await call('GET', '/api/social/members', { as: p.uid })).status, 401);
});

test('REOPEN: the account works again, a CRM contact is recreated as Unsubscribed, and the seat and roles are NOT restored', async () => {
  reset();
  const p = person('Back', { seat: true, schoolAdmin: true });
  await del(p.cid, { confirmClose: true });
  const r = await call('POST', `/api/admin/account-lookup/${p.uid}/reopen`, { body: {} });
  assert.equal(r.status, 200); assert.equal(r.json.contactCreated, true);
  assert.equal(user(p.uid).closed_at, null); assert.equal(user(p.uid).closed_reason, null);
  const c = db.prepare('SELECT status, source FROM newsletter_contacts WHERE email = ?').get(p.email);
  assert.equal(c.status, 'Unsubscribed'); assert.equal(c.source, 'Reopened account');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM license_seats WHERE status = 'registered'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM school_license_admins WHERE is_active = 1').get().n, 0);
  assert.equal((await call('POST', `/api/admin/account-lookup/${p.uid}/reopen`, { body: {} })).status, 404, 'an open account cannot be reopened');
});

test('EMAIL SYNC: changing a contact\'s email moves the account\'s email and its seat; refused when another account has that address', async () => {
  reset();
  const p = person('Mover', { seat: true });
  const other = person('Other');
  const clash = await call('PUT', `/api/newsletter/contacts/${p.cid}`, { body: { email: other.email } });
  assert.equal(clash.status, 409);
  assert.ok(['account_email_in_use', 'email_in_use'].includes(clash.json.code));
  assert.equal(user(p.uid).email, p.email, 'nothing moved');
  const ok = await call('PUT', `/api/newsletter/contacts/${p.cid}`, { body: { email: 'moved@school.test' } });
  assert.equal(ok.status, 200); assert.equal(ok.json.accountEmailUpdated, true);
  assert.equal(user(p.uid).email, 'moved@school.test');
  assert.equal(db.prepare('SELECT invited_email FROM license_seats').get().invited_email, 'moved@school.test');
});

test('EMAIL SYNC: editing other fields does not touch the account; a contact with no account just changes', async () => {
  reset();
  const p = person('Same');
  const noAcct = Number(db.prepare("INSERT INTO newsletter_contacts (email, name) VALUES ('lead@school.test', 'Lead')").run().lastInsertRowid);
  const r1 = await call('PUT', `/api/newsletter/contacts/${p.cid}`, { body: { company: 'Maple' } });
  assert.equal(r1.json.accountEmailUpdated, false);
  const r2 = await call('PUT', `/api/newsletter/contacts/${noAcct}`, { body: { email: 'lead2@school.test' } });
  assert.equal(r2.status, 200); assert.equal(r2.json.accountEmailUpdated, false);
});

test('describeConsequences lists exactly what the account holds', async () => {
  reset();
  const p = person('Everything', { seat: true, schoolAdmin: true, districtAdmin: true });
  db.prepare("INSERT INTO affiliates (site_user_id, status) VALUES (?, 'active')").run(p.uid);
  const c = await describeConsequences({ query: run }, p.uid);
  assert.equal(c.seats.length, 1); assert.equal(c.schoolAdmin.length, 1); assert.deepEqual(c.districtAdmin, ['Riverbend']); assert.equal(c.affiliate, true);
  const none = await describeConsequences({ query: run }, person('Nothing').uid);
  assert.equal(none.seats.length + none.schoolAdmin.length + none.districtAdmin.length, 0);
});
