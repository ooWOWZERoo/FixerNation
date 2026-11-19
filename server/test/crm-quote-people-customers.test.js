// One-off: the licensed teachers and school admins on one quote's PAID purchase become hand-set Customers (asked for quote #307785). Real SQL (node:sqlite) and the Hub's own override code.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER);" +
  'CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL, purchase_id INTEGER NOT NULL, permission_level TEXT DEFAULT \'primary\', is_active INTEGER NOT NULL DEFAULT 1);');
env.install(pool);
const Q = require(path.join(env.SERVER, 'lib/crm-quote-people.js'));
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));

const admin = env.addAdmin(db, 'qpboss', 'admin');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const user = (email, f = {}) => Number(db.prepare('INSERT INTO site_users (email, closed_at) VALUES (?, ?)').run(email, f.closed || null).lastInsertRowid);
const seat = (purchase, uid, status = 'registered') => db.prepare('INSERT INTO license_seats (purchase_id, status, registered_site_user_id, invited_email) VALUES (?, ?, ?, ?)').run(purchase, status, uid || null, 'x@y.z');
const schoolAdmin = (purchase, uid, active = 1) => db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id, is_active) VALUES (?, ?, ?)').run(uid, purchase, active);
const label = (id) => ({ ...get('SELECT crm_classification AS label, classification_locked AS locked FROM newsletter_contacts WHERE id = ?', id) });
const reset = () => db.exec('DELETE FROM license_seats; DELETE FROM school_license_admins; DELETE FROM site_users; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM newsletter_contacts; DELETE FROM crm_classification_events; DELETE FROM school_audit_log');

// A school: a buyer who paid, three teachers, two admins, and the odd ones out.
function school(o = {}) {
  reset();
  const buyer = env.addContact(db, 'buyer@school.test', 'Buyer Person');
  const quote = env.addQuote(db, 'buyer@school.test', { number: '307785', contactId: buyer });
  const purchase = env.addPurchase(db, buyer, { quoteId: quote, amountCents: o.amountCents === undefined ? 500000 : o.amountCents, paymentStatus: o.paymentStatus || 'paid' });
  const people = {};
  for (const [k, email] of [['t1', 'ada@school.test'], ['t2', 'bo@school.test'], ['t3', 'cy@school.test'], ['a1', 'dee@school.test'], ['a2', 'ed@school.test'], ['both', 'flo@school.test']]) {
    people[k] = { user: user(email), contact: env.addContact(db, email, k.toUpperCase() + ' Person') };
  }
  seat(purchase, people.t1.user); seat(purchase, people.t2.user); seat(purchase, people.t3.user); seat(purchase, people.both.user);
  schoolAdmin(purchase, people.a1.user); schoolAdmin(purchase, people.a2.user); schoolAdmin(purchase, people.both.user);
  return { buyer, quote, purchase, people };
}

test('THE LIST (dry run): teachers with a registered seat and active school admins are found, matched to their contacts and described; nothing is written', async () => {
  const s = school();
  const before = JSON.stringify(all('SELECT * FROM newsletter_contacts ORDER BY id'));
  const plan = await Q.planQuote(pool, '307785');
  assert.equal(plan.error, undefined); assert.equal(plan.purchaseId, s.purchase);
  assert.equal(plan.people.length, 6);
  assert.deepEqual(plan.people.map(p => p.role).sort(), ['admin', 'admin', 'teacher', 'teacher', 'teacher', 'teacher and admin']);
  assert.ok(plan.people.every(p => p.action === 'mark' && p.label === 'suspect' && p.locked === false));
  assert.equal(JSON.stringify(all('SELECT * FROM newsletter_contacts ORDER BY id')), before, 'a dry run writes nothing');
  assert.equal(all('SELECT id FROM school_audit_log').length, 0);
  assert.ok(!plan.people.some(p => p.contactId === s.buyer), 'the buyer is not on this list: they are a Customer by the ordinary rule');
});

test('APPLY: each person becomes a locked, hand-set Customer with the reason and evidence, history and audit rows; the buyer, the purchase and the seats are untouched; running again changes nothing', async () => {
  const s = school();
  const buyerBefore = label(s.buyer), purchaseBefore = JSON.stringify(all('SELECT * FROM purchases')), seatsBefore = JSON.stringify(all('SELECT * FROM license_seats'));
  const plan = await Q.planQuote(pool, '307785');
  const r = await Q.applyPlan(pool, plan, { adminId: admin });
  assert.deepEqual(r, { marked: 6, locked: 0, already: 0, noContact: 0, failed: 0 });
  for (const k of Object.keys(s.people)) assert.deepEqual(label(s.people[k].contact), { label: 'customer', locked: 1 }, k);
  const events = all("SELECT * FROM crm_classification_events WHERE event_type = 'manual_override' ORDER BY id");
  assert.equal(events.length, 6); assert.match(events[0].reason, /Licensed under quote #307785; evidence: Quote #307785, purchase #\d+ paid;/);
  const audits = all("SELECT * FROM school_audit_log WHERE action = 'crm_customer_override'");
  assert.equal(audits.length, 6); assert.ok(audits.every(a => a.entity_type === 'crm_contact' && a.actor_type === 'admin_user' && a.actor_id === admin));
  assert.equal(JSON.stringify(all('SELECT * FROM purchases')), purchaseBefore, 'the purchase is not touched'); assert.equal(JSON.stringify(all('SELECT * FROM license_seats')), seatsBefore);
  assert.deepEqual(label(s.buyer), buyerBefore);
  // again: nothing changes, nothing new is written
  const again = await Q.applyPlan(pool, await Q.planQuote(pool, '307785'), { adminId: admin });
  assert.deepEqual(again, { marked: 0, locked: 0, already: 6, noContact: 0, failed: 0 });
  assert.equal(all("SELECT id FROM crm_classification_events WHERE event_type = 'manual_override'").length, 6); assert.equal(all("SELECT id FROM school_audit_log WHERE action = 'crm_customer_override'").length, 6);
  // the nightly check never undoes a locked Customer
  for (const k of Object.keys(s.people)) await cls.reconcileContact(pool, s.people[k].contact, { actorAdminId: admin });
  for (const k of Object.keys(s.people)) assert.equal(label(s.people[k].contact).label, 'customer', `${k} stays a Customer after the nightly check`);
});

test('WHO IS LEFT OUT, AND SAID SO: pending invitations, revoked seats, deactivated admins, closed accounts, test addresses and people with no contact record; a contact already Customer is only locked', async () => {
  const s = school();
  seat(s.purchase, null, 'pending');                                              // invited, never registered
  const gone = user('gone@school.test'); env.addContact(db, 'gone@school.test', 'Gone'); seat(s.purchase, gone, 'revoked');
  const off = user('off@school.test'); env.addContact(db, 'off@school.test', 'Off'); schoolAdmin(s.purchase, off, 0);
  const closed = user('closed@school.test', { closed: '2026-01-01 00:00:00' }); env.addContact(db, 'closed@school.test', 'Closed'); seat(s.purchase, closed);
  const tester = user('qa@example.com'); env.addContact(db, 'qa@example.com', 'Tester'); seat(s.purchase, tester);
  const nobody = user('nocontact@school.test'); seat(s.purchase, nobody);          // a sign-in account with no contact record
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id = ?").run(s.people.t1.contact);   // already a Customer, not locked
  const plan = await Q.planQuote(pool, '307785');
  assert.deepEqual({ ...plan.skipped }, { pendingSeats: 1, revokedOrInactive: 2, closedAccounts: 1, testAddresses: 1, noContact: 1 });
  assert.equal(plan.people.length, 7); assert.equal(plan.people.find(p => p.action === 'no_contact').contactId, null);
  assert.equal(plan.people.find(p => p.contactId === s.people.t1.contact).action, 'lock');
  const r = await Q.applyPlan(pool, plan, { adminId: admin });
  assert.deepEqual(r, { marked: 5, locked: 1, already: 0, noContact: 1, failed: 0 });
  for (const email of ['gone', 'off', 'closed']) assert.equal(get('SELECT crm_classification AS c FROM newsletter_contacts WHERE email = ?', `${email}@school.test`).c, 'suspect', email);
  assert.equal(get("SELECT crm_classification AS c FROM newsletter_contacts WHERE email = 'qa@example.com'").c, 'suspect');
  assert.equal(all("SELECT id FROM newsletter_contacts WHERE email = 'nocontact@school.test'").length, 0, 'no contact is ever created');
  assert.equal(label(s.people.t1.contact).locked, 1);
});

test('ONLY A PURCHASE THE CUSTOMER RULE ACCEPTS: an unpaid, trial, zero-amount or no-amount purchase, a wrong number, an unknown quote and a quote with no purchase mark nobody', async () => {
  let s = school({ paymentStatus: 'pending' });
  let plan = await Q.planQuote(pool, '307785'); assert.match(plan.error, /not paid and has no PO received/); assert.equal(plan.people, undefined);
  s = school({ amountCents: 0 }); plan = await Q.planQuote(pool, '307785'); assert.match(plan.error, /not paid and has no PO received/);
  s = school({ amountCents: null }); plan = await Q.planQuote(pool, '307785'); assert.match(plan.error, /amount not recorded/);
  s = school(); db.prepare('UPDATE purchases SET trial_expiration_date = ?, trial_lesson_limit = 5 WHERE id = ?').run('2027-01-01', s.purchase);
  plan = await Q.planQuote(pool, '307785'); assert.match(plan.error, /trial or refunded/, 'a trial never counts');
  school(); assert.match((await Q.planQuote(pool, '999999')).error, /No quote has the number/);
  for (const bad of ['', 'abc', '30778', '3077850', '307785; DROP', null, undefined, 307785.5]) assert.match((await Q.planQuote(pool, bad)).error, /six digits/, String(bad));
  const quote = env.addQuote(db, 'lone@school.test', { number: '111111' }); void quote;
  assert.match((await Q.planQuote(pool, '111111')).error, /no purchase yet/);
  school({ paymentStatus: 'pending' }); assert.equal(all("SELECT id FROM newsletter_contacts WHERE crm_classification = 'customer'").length, 0);
  void s;
});

test('PO RECEIVED COUNTS (for this one quote, as the owner said): paid counts; a PO received on a not-yet-paid invoice counts and says so in the evidence; a PO not received, a cancelled invoice, a trial and a confirmed full refund do not', async () => {
  let s = school();
  assert.equal((await Q.planQuote(pool, '307785')).basis, 'paid');
  // PO purchase: not marked paid, invoice with the PO received
  db.exec('DELETE FROM invoices');
  const inv = Number(db.prepare("INSERT INTO invoices (invoice_number, contact_id, status, po_received_date) VALUES ('INV-1', ?, 'unpaid', NULL)").run(s.buyer).lastInsertRowid);
  db.prepare("UPDATE purchases SET payment_method = 'po', payment_status = 'pending', invoice_id = ? WHERE id = ?").run(inv, s.purchase);
  assert.match((await Q.planQuote(pool, '307785')).error, /not paid and has no PO received/, 'PO promised, not received');
  db.prepare("UPDATE invoices SET po_received_date = '2026-11-10' WHERE id = ?").run(inv);
  const plan = await Q.planQuote(pool, '307785');
  assert.equal(plan.basis, 'PO received'); assert.equal(plan.people.length, 6);
  await Q.applyPlan(pool, plan, { adminId: admin });
  assert.match(all("SELECT reason FROM crm_classification_events WHERE event_type = 'manual_override'")[0].reason, /purchase #\d+ PO received; (teacher|school admin) on the license/);
  db.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").run(inv);
  assert.match((await Q.planQuote(pool, '307785')).error, /not paid and has no PO received/, 'a cancelled invoice');
  db.prepare("UPDATE invoices SET status = 'unpaid' WHERE id = ?").run(inv); db.prepare('UPDATE purchases SET trial_lesson_limit = 5 WHERE id = ?').run(s.purchase);
  assert.match((await Q.planQuote(pool, '307785')).error, /trial or refunded/);
  db.prepare('UPDATE purchases SET trial_lesson_limit = NULL WHERE id = ?').run(s.purchase);
  db.prepare("INSERT INTO crm_purchase_refunds (purchase_id, kind, state, is_full, source) VALUES (?, 'refund', 'confirmed', 1, 'manual')").run(s.purchase);
  assert.match((await Q.planQuote(pool, '307785')).error, /trial or refunded/, 'a confirmed full refund');
  db.exec('DELETE FROM crm_purchase_refunds'); void s;
});

test('THE SCRIPT: a dry run by default; applying needs a named CRM Admin; it prints names and counts and never an email address; it uses the Hub’s own override and nothing else', () => {
  const src = fs.readFileSync(path.join(env.SERVER, 'scripts/mark-quote-people-customers.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.match(src, /Dry run: nothing was changed/); assert.match(code, /const apply = args\.includes\('--apply'\)/); assert.match(code, /--as/); assert.match(code, /a\.crm_role !== 'admin'/);
  assert.match(code, /Q\.planQuote\(db, number\)/); assert.match(code, /Q\.applyPlan\(db, plan, \{ adminId: admin\.id \}\)/);
  assert.doesNotMatch(code, /\.email|u\.email|\bemail\b.*console/, 'no address is printed');
  const lib = fs.readFileSync(path.join(env.SERVER, 'lib/crm-quote-people.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(lib, /INSERT INTO|DELETE FROM|UPDATE\s+(purchases|invoices|license_seats|school_license_admins|quote_requests|site_users)/i, 'it reads purchases, seats and accounts and writes none of them');
  assert.match(lib, /setCustomerOverride/);
  for (const f of ['lib/crm-quote-people.js', 'scripts/mark-quote-people-customers.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
