// Sales CRM gap G1 (PRD section 8 rule 4, decision D4): what an account is to us (Customer, Prospect, Suspect) and whether it needs review, derived on every read. Checked on data
// built to include the near misses: a trial, a purchase that names no school, a lost deal, a test address, an ended membership, an archived account.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec('ALTER TABLE invoices ADD COLUMN total_cents INTEGER');
env.install(pool);
const rel = require(path.join(env.SERVER, 'lib/crm-account-relationship.js'));
const { server, call } = env.listen([['/api/crm/accounts', require(path.join(env.SERVER, 'routes/crm-accounts.js'))], ['/api/crm/overview', require(path.join(env.SERVER, 'routes/crm-overview.js'))]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin'), sales = env.addAdmin(db, 'rep', 'sales'), viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const school = (domain, district = null) => Number(db.prepare('INSERT INTO schools (domain, district_id) VALUES (?, ?)').run(domain, district).lastInsertRowid);
const acct = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, school_id, district_id, archived_at) VALUES (?, ?, ?, ?, ?)').run(name, f.district ? 'district' : 'school', f.schoolId || null, f.districtId || null, f.archived ? `${day(-1)} 00:00:00` : null).lastInsertRowid);
const member = (a, c, ended = null) => db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id, ended_on) VALUES (?, ?, ?)').run(a, c, ended);
const deal = (a, state = 'open') => Number(db.prepare('INSERT INTO crm_opportunities (account_id, name, stage_id, state) VALUES (?, ?, ?, ?)').run(a, `deal ${a} ${state}`, stage(state === 'won' ? 'won' : 'qualified'), state).lastInsertRowid);
const purchase = (contact, sid, f = {}) => { const id = env.addPurchase(db, contact, { paymentStatus: f.status || 'paid', amountCents: f.cents === undefined ? 50000 : f.cents, trialLessonLimit: f.trial ? 3 : undefined }); db.prepare('UPDATE purchases SET school_id = ?, school_domain = ? WHERE id = ?').run(sid, f.domain || null, id); return id; };
const label = (id, c) => db.prepare('UPDATE newsletter_contacts SET crm_classification = ? WHERE id = ?').run(c, id);
const list = async (qs = '', who = viewer) => (await call('GET', `/api/crm/accounts?${qs}`, undefined, who)).json;
const names = async (qs) => (await list(qs)).accounts.map(a => a.name).sort();

// The fixture ---------------------------------------------------------------------------------------------------------------------------
const buyer = env.addContact(db, 'buyer@school.test', 'Buyer'), prospectPerson = env.addContact(db, 'prospect@school.test', 'Prospect Person'), customerPerson = env.addContact(db, 'unplaced@school.test', 'Unplaced Buyer');
const qa = env.addContact(db, 'qa-prospect@example.com', 'QA');
label(prospectPerson, 'prospect'); label(customerPerson, 'customer'); label(qa, 'prospect');
const s1 = school('one.test'), s2 = school('two.test'), d1 = Number(db.prepare("INSERT INTO districts (name) VALUES ('D1')").run().lastInsertRowid), s3 = school('three.test', d1), s4 = school('four.test', d1);
const A = {
  customerSchool: acct('Customer school', { schoolId: s1 }), trialOnly: acct('Trial only school', { schoolId: s2 }), customerDistrict: acct('Customer district', { district: true, districtId: d1 }),
  personProspect: acct('Prospect by person'), unresolved: acct('Unresolved school'), nothing: acct('Nothing yet'), lostOnly: acct('Lost deal only'), archived: acct('Archived customer', { schoolId: school('arch.test'), archived: true }),
  testDeal: acct('Test deal'), ended: acct('Ended membership'), testPerson: acct('Test person'), customerWithUnplaced: acct('Customer also unplaced', { schoolId: school('five.test') }),
};
purchase(buyer, s1); purchase(buyer, s2, { trial: true, cents: 0 }); purchase(buyer, s4); purchase(buyer, db.prepare("SELECT id FROM schools WHERE domain = 'arch.test'").get().id);
purchase(buyer, db.prepare("SELECT id FROM schools WHERE domain = 'five.test'").get().id);
deal(A.trialOnly); member(A.personProspect, prospectPerson);
member(A.unresolved, customerPerson); purchase(customerPerson, null, { domain: 'unplaced.test' });           // a paid purchase that names no school
member(A.customerWithUnplaced, customerPerson);                                                                  // the same person is on a Customer school, too
deal(A.lostOnly, 'lost'); const td = deal(A.testDeal); env.addQuote(db, 'qa@example.com', { opportunityId: td, number: 'QT' });
member(A.ended, prospectPerson, day(-30)); member(A.testPerson, qa);

test('RULES: Customer needs a paid non-trial purchase placed on the school or district; Prospect an open deal or a Prospect/Customer person; everything else is a Suspect', async () => {
  const m = await rel.accountRelationships(pool, day(0));
  const r = (k) => m.get(A[k]);
  assert.equal(r('customerSchool').relationship, 'customer');
  assert.equal(r('customerDistrict').relationship, 'customer', 'a purchase for one of the district\'s schools counts for the district');
  assert.equal(r('trialOnly').relationship, 'prospect', 'a trial is not a purchase; its open deal makes it a Prospect'); assert.match(r('trialOnly').why, /open deal/);
  assert.equal(r('personProspect').relationship, 'prospect'); assert.match(r('personProspect').why, /Prospect or a Customer/);
  assert.equal(r('unresolved').relationship, 'prospect', 'its Customer person makes it a Prospect, not a Customer: the purchase names no school');
  for (const k of ['nothing', 'lostOnly', 'testDeal', 'ended', 'testPerson']) assert.equal(r(k).relationship, 'suspect', k);
  assert.equal(m.has(A.archived), false, 'an archived account is not worked out');
  assert.equal(r('customerSchool').needsReview, false);
});

test('NEEDS REVIEW: a person on the account owns a paid purchase that names no school; not shown once the account is a Customer; never guessed into a Customer', async () => {
  const m = await rel.accountRelationships(pool, day(0));
  assert.equal(m.get(A.unresolved).needsReview, true); assert.match(m.get(A.unresolved).why, /names no school/);
  assert.equal(m.get(A.customerWithUnplaced).relationship, 'customer'); assert.equal(m.get(A.customerWithUnplaced).needsReview, false, 'already a Customer');
  assert.equal([...m.values()].filter(v => v.needsReview).length, 1);
  assert.deepEqual(rel.relationshipCounts(m), { suspect: 5, prospect: 3, customer: 3, review: 1, handSet: 0 });
});

test('THE LIST: filters by label and by needs-review, counts every label, attaches the label to each row, and treats a bad filter as no filter', async () => {
  assert.deepEqual(await names('relationship=customer'), ['Customer also unplaced', 'Customer district', 'Customer school']);
  assert.deepEqual(await names('relationship=prospect'), ['Prospect by person', 'Trial only school', 'Unresolved school']);
  assert.deepEqual(await names('relationship=suspect'), ['Ended membership', 'Lost deal only', 'Nothing yet', 'Test deal', 'Test person']);
  assert.deepEqual(await names('relationship=review'), ['Unresolved school']);
  assert.equal((await list('relationship=bogus')).total, 11, 'a bad value is ignored');
  const all = await list();
  assert.deepEqual(all.relationshipCounts, { suspect: 5, prospect: 3, customer: 3, review: 1, handSet: 0 });
  const row = all.accounts.find(a => a.name === 'Unresolved school');
  assert.deepEqual([row.relationship, row.needsReview], ['prospect', true]);
  assert.equal((await list('relationship=customer&type=district')).total, 1, 'it combines with the other filters');
  assert.equal((await list('relationship=customer&q=school')).total, 1);
  for (const who of [admin, sales, viewer]) assert.equal((await call('GET', '/api/crm/accounts?relationship=customer', undefined, who)).status, 200);
  assert.equal((await call('GET', '/api/crm/accounts?relationship=customer')).status, 401);
});

test('THE ACCOUNT PAGE DATA: the label, the flag and one plain sentence of why', async () => {
  const d = (await call('GET', `/api/crm/accounts/${A.unresolved}`, undefined, viewer)).json.account;
  assert.deepEqual([d.relationship, d.needsReview], ['prospect', true]); assert.match(d.relationshipWhy, /Customer/i);
  const c = (await call('GET', `/api/crm/accounts/${A.customerDistrict}`, undefined, viewer)).json.account;
  assert.equal(c.relationship, 'customer'); assert.match(c.relationshipWhy, /district/);
});

test('UNPLACED PURCHASES: paid, non-trial, non-test purchases that name no school, with the buyer and the accounts the buyer is on; paged; nothing is linked or changed', async () => {
  purchase(buyer, null, { status: 'pending' }); purchase(buyer, null, { trial: true, cents: 0 }); purchase(qa, null);   // none of these qualifies
  const before = db.prepare('SELECT COUNT(*) n FROM purchases WHERE school_id IS NOT NULL').get().n;
  const r = await call('GET', '/api/crm/accounts/review/unplaced', undefined, viewer);
  assert.equal(r.status, 200); assert.equal(r.json.total, 1);
  const p = r.json.purchases[0];
  assert.equal(p.contactId, customerPerson); assert.equal(p.schoolDomain, 'unplaced.test'); assert.equal(p.amountCents, 50000);
  assert.deepEqual(p.accounts.map(a => a.name), ['Customer also unplaced', 'Unresolved school']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM purchases WHERE school_id IS NOT NULL').get().n, before, 'read only');
  assert.equal((await call('GET', '/api/crm/accounts/review/unplaced', undefined)).status, 401);
  assert.equal((await call('GET', '/api/crm/accounts/review/unplaced?pageSize=1&page=2', undefined, viewer)).json.purchases.length, 0);
  // Once the school is set on the purchase, the flag clears by itself and the account becomes a Customer.
  db.prepare('UPDATE purchases SET school_id = ? WHERE id = ?').run(s2, p.purchaseId);
  assert.equal((await call('GET', '/api/crm/accounts/review/unplaced', undefined, viewer)).json.total, 0);
  const after = await rel.accountRelationships(pool, day(0));
  assert.equal(after.get(A.unresolved).needsReview, false); assert.equal(after.get(A.trialOnly).relationship, 'customer', 'the trial-only school now has a paid purchase placed on it');
  db.prepare('UPDATE purchases SET school_id = NULL WHERE id = ?').run(p.purchaseId);
});

test('ONE PLACE: the Overview\'s Customer organizations number is this same rule, and the pages show the label with the right wording', async () => {
  const o = (await call('GET', `/api/crm/overview?today=${day(0)}`, undefined, viewer)).json.cards.customerOrganizations;
  assert.equal(o.count, rel.relationshipCounts(await rel.accountRelationships(pool, day(0))).customer);
  const root = path.join(env.SERVER, '..');
  const list = fs.readFileSync(path.join(root, 'admin-crm-accounts.html'), 'utf8'), one = fs.readFileSync(path.join(root, 'admin-crm-account.html'), 'utf8');
  for (const t of ['What it is to us', 'Needs review', 'Show those purchases', 'review/unplaced', 'relationship: st.relationship']) assert.ok(list.includes(t), `accounts page: ${t}`);
  for (const t of ['What it is to us', 'relationshipWhy', 'Needs review']) assert.ok(one.includes(t), `account page: ${t}`);
  for (const page of [list, one]) {
    assert.doesNotMatch(page.replace('onclick="fnToggleTheme()"', ''), /onclick=/);
    assert.doesNotMatch(page, /\b(hot|warm|cold)\b/i);
    assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
  }
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-account-relationship.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/, 'it only reads');
});
