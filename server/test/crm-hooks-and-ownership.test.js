// Sales CRM: the hooks that keep Suspect / Prospect / Customer current must never break a payment, a quote or an invoice, and deleting staff or a
// contact must not leave sales records without an owner or a deal without its people (lib/crm-hooks.js, lib/crm-ownership.js, routes/auth.js, routes/newsletter.js).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
process.env.SESSION_SECRET = 'test-secret-not-real';
const env = require('./helpers/crm-env');

const { db, pool, conn } = env.makeDb();
env.install(pool, {
  [path.join(env.SERVER, 'lib/automations.js')]: { fireAutomation: async () => {} },
  [path.join(env.SERVER, 'lib/affiliate-attribution.js')]: { attributePurchase: async () => {} },
});
const hooks = require(path.join(env.SERVER, 'lib/crm-hooks.js'));
const own = require(path.join(env.SERVER, 'lib/crm-ownership.js'));
const { server, call } = env.listen([
  ['/api/auth', require(path.join(env.SERVER, 'routes/auth.js')).router],
  ['/api/newsletter', require(path.join(env.SERVER, 'routes/newsletter.js')).router],
]);
test.after(() => server.close());

const paidProduct = Number(db.prepare("INSERT INTO license_products (name, is_trial) VALUES ('Annual', 0)").run().lastInsertRowid);
const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };
test.after(() => { console.error = origError; });

test('HOOKS OFF: while crm_v2_enabled is not true, a payment changes nothing about the label', async () => {
  const c = env.addContact(db, 'off@hooks.example.org');
  const p = env.addPurchase(db, c, { productId: paidProduct, amountCents: 5000 });
  await hooks.contactChanged(c); await hooks.purchaseChanged(p); await hooks.contactChangedByEmail('off@hooks.example.org');
  assert.equal(env.classOf(db, c), 'suspect');
});

test('HOOKS ON: purchase, invoice and quote changes re-derive the label; none of them throws or logs an error', async () => {
  env.enable(db, true);
  const buyer = env.addContact(db, 'on@hooks.example.org');
  const p = env.addPurchase(db, buyer, { productId: paidProduct, amountCents: 5000, paymentStatus: 'pending', method: 'po' });
  await hooks.purchaseChanged(p);
  assert.equal(env.classOf(db, buyer), 'suspect', 'pending is not paid');
  db.prepare("UPDATE purchases SET payment_status = 'paid' WHERE id = ?").run(p);
  await hooks.purchaseChanged(p);
  assert.equal(env.classOf(db, buyer), 'customer');

  const poBuyer = env.addContact(db, 'invoice@hooks.example.org');
  const inv = Number(db.prepare("INSERT INTO invoices (contact_id, status) VALUES (?, 'paid')").run(poBuyer).lastInsertRowid);
  env.addPurchase(db, poBuyer, { productId: paidProduct, amountCents: 9000, invoiceId: inv });
  await hooks.invoiceChanged(inv);
  assert.equal(env.classOf(db, poBuyer), 'customer');

  const asker = env.addContact(db, 'Asker@Hooks.example.org');
  env.addQuote(db, 'asker@hooks.example.org');
  await hooks.contactChangedByEmail('  ASKER@hooks.example.org ');
  assert.equal(env.classOf(db, asker), 'prospect');
  await hooks.contactChangedByEmail(undefined); await hooks.contactChangedByEmail('nobody@nowhere.example.org'); await hooks.contactChanged(null); await hooks.purchaseChanged(99999);
  assert.deepEqual(errors, []);
});

test('HOOKS BROKEN: a database error inside a hook is swallowed (logged), never raised into the payment', async () => {
  const realQuery = pool.query;
  pool.query = async (sql, params) => {
    if (/FROM newsletter_contacts WHERE id/.test(sql)) throw new Error('boom: database gone');
    return realQuery(sql, params);
  };
  try {
    await assert.doesNotReject(() => hooks.contactChanged(1));
    assert.ok(errors.some(e => /crm hook failed: boom/.test(e)));
  } finally { pool.query = realQuery; }
});

test('HOOKS NOT SET UP: a database with no CRM tables stays quiet (no error text) and does nothing', async () => {
  const bare = env.makeDb({ withCrmTables: false });
  // The alter script has not run: the contact table has none of the CRM columns.
  bare.db.exec("DROP TABLE newsletter_contacts; CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY, email TEXT); INSERT INTO newsletter_contacts (id, email) VALUES (1, 'a@b.example.org'); INSERT INTO purchases (id, contact_id) VALUES (1, 1)");
  env.enable(bare.db, true);
  const before = errors.length;
  const realQuery = pool.query;
  pool.query = bare.run;
  try { await hooks.contactChanged(1); await hooks.purchaseChanged(1); } finally { pool.query = realQuery; }
  assert.equal(errors.length, before);
});

// ---- Deleting staff ---------------------------------------------------------------------------------------------------------------

test('DELETE ADMIN: an admin who owns CRM records must say who takes them over, or leave them unassigned; nothing is deleted until they do', async () => {
  const boss = env.addAdmin(db, 'boss', 'admin');
  const leaver = env.addAdmin(db, 'leaver', 'sales');
  const heir = env.addAdmin(db, 'heir', 'sales');
  const c = env.addContact(db, 'owned@own.example.org');
  db.prepare('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?').run(leaver, c);
  const acct = Number(db.prepare("INSERT INTO crm_accounts (name, assigned_admin_id) VALUES ('Owned Co', ?)").run(leaver).lastInsertRowid);
  db.prepare("INSERT INTO crm_opportunities (account_id, name, owner_admin_id, stage_id) VALUES (?, 'D1', ?, 1), (?, 'D2', ?, 1)").run(acct, leaver, acct, leaver);

  assert.deepEqual(await own.ownedRecordCounts(conn, leaver), { contacts: 1, accounts: 1, opportunities: 2, total: 4 });
  const ask = await call('DELETE', `/api/auth/admins/${leaver}`, undefined, boss);
  assert.equal(ask.status, 409); assert.equal(ask.json.code, 'owns_crm_records'); assert.equal(ask.json.owned.total, 4);
  assert.ok(db.prepare('SELECT id FROM admin_users WHERE id = ?').get(leaver), 'still there');

  assert.equal((await call('DELETE', `/api/auth/admins/${leaver}`, { reassignTo: leaver }, boss)).status, 400, 'cannot hand it to themselves');
  assert.equal((await call('DELETE', `/api/auth/admins/${leaver}`, { reassignTo: 99999 }, boss)).status, 400);
  const done = await call('DELETE', `/api/auth/admins/${leaver}`, { reassignTo: heir }, boss);
  assert.equal(done.status, 200); assert.equal(done.json.reassigned, 4); assert.equal(done.json.reassignedTo, heir);
  assert.equal(db.prepare('SELECT assigned_admin_id AS a FROM newsletter_contacts WHERE id = ?').get(c).a, heir);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM crm_opportunities WHERE owner_admin_id = ?").get(heir).n, 2);
  assert.equal(db.prepare('SELECT id FROM admin_users WHERE id = ?').get(leaver), undefined);
});

test('DELETE ADMIN: choosing "unassigned" leaves the records with no owner; an admin who owns nothing is deleted as before', async () => {
  const boss = env.addAdmin(db, 'boss2', 'admin');
  const leaver = env.addAdmin(db, 'leaver2', 'sales');
  const acct = Number(db.prepare("INSERT INTO crm_accounts (name, assigned_admin_id) VALUES ('Orphan Co', ?)").run(leaver).lastInsertRowid);
  const r = await call('DELETE', `/api/auth/admins/${leaver}`, { unassign: true }, boss);
  assert.equal(r.status, 200); assert.equal(r.json.reassignedTo, null);
  assert.equal(db.prepare('SELECT assigned_admin_id AS a FROM crm_accounts WHERE id = ?').get(acct).a, null);
  const nothing = env.addAdmin(db, 'quiet-leaver', 'readonly');
  assert.equal((await call('DELETE', `/api/auth/admins/${nothing}`, undefined, boss)).status, 200);
});

test('DELETE ADMIN: the last CRM Admin cannot be deleted, and the existing guards (not yourself, not the last admin) still hold', async () => {
  db.exec('DELETE FROM admin_users');
  const only = env.addAdmin(db, 'only-crm-admin', 'admin');
  // Managing admin accounts is a CRM Admin action (punch list S1), so the one deleting is a CRM Admin who has not activated their account yet (not counted as "another CRM Admin").
  const other = env.addAdmin(db, 'pending-crm-admin', 'admin', { verified: 0 });
  const sales = env.addAdmin(db, 'a-sales-rep', 'sales');
  assert.equal((await call('DELETE', `/api/auth/admins/${only}`, undefined, sales)).status, 403, 'a Sales admin cannot delete anyone');
  const blocked = await call('DELETE', `/api/auth/admins/${only}`, undefined, other);
  assert.equal(blocked.status, 400); assert.match(blocked.json.error, /last Sales CRM admin/);
  assert.equal((await call('DELETE', `/api/auth/admins/${other}`, undefined, other)).status, 400, 'not your own account');
  assert.equal((await call('DELETE', `/api/auth/admins/${other}`, undefined, only)).status, 200);
  assert.equal((await call('DELETE', `/api/auth/admins/${only}`, undefined, only)).status, 400);
});

// ---- Deleting a contact -----------------------------------------------------------------------------------------------------------

test('DELETE CONTACT: a contact on a deal (buying committee or primary contact) is refused until they are taken off it', async () => {
  const boss = env.addAdmin(db, 'boss3', 'admin');
  const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Deal Co')").run().lastInsertRowid);
  const opp = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id) VALUES (?, 'D', 1)").run(acct).lastInsertRowid);
  const member = env.addContact(db, 'member@del.example.org');
  const primary = env.addContact(db, 'primary@del.example.org');
  db.prepare('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id) VALUES (?, ?)').run(opp, member);
  db.prepare('UPDATE crm_opportunities SET primary_contact_id = ? WHERE id = ?').run(primary, opp);
  for (const id of [member, primary]) {
    const r = await call('DELETE', `/api/newsletter/contacts/${id}`, {}, boss);
    assert.equal(r.status, 409); assert.equal(r.json.code, 'contact_on_deals'); assert.equal(r.json.deals, 1);
    assert.ok(db.prepare('SELECT id FROM newsletter_contacts WHERE id = ?').get(id), 'not deleted');
  }
  assert.equal(await own.dealCountForContact(conn, env.addContact(db, 'free@del.example.org')), 0);
});

test('DELETE CONTACT: the older refusal for a contact that owns purchases still comes first and is unchanged', async () => {
  const boss = env.addAdmin(db, 'boss4', 'admin');
  const buyer = env.addContact(db, 'buyer@del.example.org');
  env.addPurchase(db, buyer, { productId: paidProduct, amountCents: 100 });
  const r = await call('DELETE', `/api/newsletter/contacts/${buyer}`, {}, boss);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'contact_owns_purchases');
});

test('NO CRM TABLES YET: staff and contact deletion behave exactly as before on a database the alter script has not touched', async () => {
  const bare = env.makeDb({ withCrmTables: false });
  const counts = await own.ownedRecordCounts(bare.conn, 1);
  assert.deepEqual(counts, { contacts: 0, accounts: 0, opportunities: 0, total: 0 });
  assert.equal(await own.dealCountForContact(bare.conn, 1), 0);
});
