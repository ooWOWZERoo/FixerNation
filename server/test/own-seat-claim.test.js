// A person who already has an account and buys a trial or single license must be able to use it at once: the seat held for their
// email is claimed for them (lib/own-seat-claim.js). Seats a school administrator invited them to are left for them to accept.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

// What a claim sets in motion has its own tests; here only whether it was asked to run.
const calls = [];
for (const [file, exports] of [
  ['../lib/social-groups', { addTeacherToSocialGroups: async (id) => { calls.push(['groups', id]); } }],
  ['../lib/teacher-onboarding', { onboardInvitedTeacher: async (a) => { calls.push(['onboard', a.siteUserId]); } }],
]) {
  const p = require.resolve(file);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
const { claimOwnPurchaseSeats, claimForAccountByEmail, findClaimableSeats } = require('../lib/own-seat-claim');

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, school_domain TEXT, payment_status TEXT, payment_method TEXT, license_status TEXT, expiration_date TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, seat_id INTEGER);
`);
const pool = { async query(sql, params = []) {
  const s = sql.trim();
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
} };
const reset = () => { for (const t of ['site_users', 'purchases', 'license_seats', 'school_invitations']) db.exec(`DELETE FROM ${t}`); calls.length = 0; };
const user = (email) => Number(db.prepare("INSERT INTO site_users (email, first_name, last_name) VALUES (?, 'Jo', 'Teacher')").run(email).lastInsertRowid);
const own = (email, p = {}) => {
  const pid = Number(db.prepare('INSERT INTO purchases (school_domain, payment_status, payment_method, license_status, expiration_date) VALUES (?, ?, ?, ?, ?)')
    .run(p.domain ?? null, p.pay ?? 'paid', p.method ?? 'stripe', p.status ?? 'active', p.expires ?? null).lastInsertRowid);
  return Number(db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')").run(pid, email).lastInsertRowid);
};
const seat = (id) => db.prepare('SELECT status, registered_site_user_id AS uid FROM license_seats WHERE id = ?').get(id);
const TODAY = '2026-11-05';

test('EXISTING ACCOUNT: the seat bought for their own email is claimed, and Community groups, CRM and Morning Boost are set in motion', async () => {
  reset();
  const u = user('John@Example.org');
  const s = own('john@example.org');
  assert.equal(await claimForAccountByEmail(pool, 'john@example.org'), 1);
  assert.equal(seat(s).status, 'registered');
  assert.equal(seat(s).uid, u);
  assert.deepEqual(calls.sort(), [['groups', u], ['onboard', u]]);
});

test('SECOND CALL changes nothing and does not run the follow-up again', async () => {
  reset();
  user('a@example.org'); own('a@example.org');
  await claimForAccountByEmail(pool, 'a@example.org');
  calls.length = 0;
  assert.equal(await claimForAccountByEmail(pool, 'a@example.org'), 0);
  assert.equal(calls.length, 0);
});

test('NO ACCOUNT YET: nothing to claim (the seat is claimed when the account is created)', async () => {
  reset();
  const s = own('new@example.org');
  assert.equal(await claimForAccountByEmail(pool, 'new@example.org'), 0);
  assert.equal(seat(s).status, 'pending');
});

test('SCHOOL INVITATION: a seat the school invited them to is left for them to accept', async () => {
  reset();
  const u = user('t@example.org');
  const s = own('t@example.org', { domain: 'example.org' });
  db.prepare('INSERT INTO school_invitations (seat_id) VALUES (?)').run(s);
  assert.equal(await claimOwnPurchaseSeats(pool, u, 't@example.org', { today: TODAY }), 0);
  assert.equal(seat(s).status, 'pending');
});

test('LICENSE MUST BE OPEN: unpaid card, PO not received, expired and past-date licenses are not claimed; PO received is', async () => {
  reset();
  const u = user('b@example.org');
  const unpaid = own('b@example.org', { pay: 'pending', method: 'stripe', status: 'active' });
  const poWait = own('b@example.org', { pay: 'pending', method: 'po', status: 'pending' });
  const past = own('b@example.org', { expires: '2026-11-01' });
  const poIn = own('b@example.org', { pay: 'pending', method: 'po', status: 'active' });
  assert.equal(await claimOwnPurchaseSeats(pool, u, 'b@example.org', { today: TODAY }), 1);
  assert.equal(seat(poIn).status, 'registered');
  for (const id of [unpaid, poWait, past]) assert.equal(seat(id).status, 'pending');
});

test('SCHOOL DOMAIN: a license tied to a school domain is only claimed by an address at that domain', async () => {
  reset();
  const u = user('c@gmail.example');
  const s = own('c@gmail.example', { domain: 'school.example.org' });
  assert.equal(await claimOwnPurchaseSeats(pool, u, 'c@gmail.example', { today: TODAY }), 0);
  assert.equal(seat(s).status, 'pending');
});

test('REPORT: findClaimableSeats lists exactly what a claim would take, and nothing else', async () => {
  reset();
  user('d@example.org'); user('e@example.org');
  const mine = own('d@example.org');
  const invited = own('e@example.org'); db.prepare('INSERT INTO school_invitations (seat_id) VALUES (?)').run(invited);
  own('nobody@example.org');
  const found = await findClaimableSeats(pool, { today: TODAY });
  assert.deepEqual(found.map((f) => f.seatId), [mine]);
  assert.equal(found[0].email, 'd@example.org');
});
