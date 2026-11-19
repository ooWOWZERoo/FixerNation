// Customer Hub follow-up F13: a CRM Admin marks a school or district account a Customer by hand (reason + evidence), like the hand-set label on a person. Shown as "set by hand", counted with
// the other Customers, released with a reason, audited, and it never touches a purchase. Real routes and SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
env.install(pool);
const rel = require(path.join(env.SERVER, 'lib/crm-account-relationship.js'));
const rules = require(path.join(env.SERVER, 'lib/crm-classification-rules.js'));
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/accounts', R('crm-accounts.js')], ['/api/crm/overview', R('crm-overview.js')]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'f13boss', 'admin'), sales = env.addAdmin(db, 'f13rep', 'sales'), viewer = env.addAdmin(db, 'f13viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const school = (domain) => Number(db.prepare('INSERT INTO schools (domain) VALUES (?)').run(domain).lastInsertRowid);
const acct = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, school_id, archived_at) VALUES (?, ?, ?, ?)').run(name, 'school', f.schoolId || null, f.archived || null).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_accounts; DELETE FROM purchases; DELETE FROM schools; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log');
const mark = (id, body, who = admin) => call('POST', `/api/crm/accounts/${id}/customer-override`, body, who);
const release = (id, body, who = admin) => call('POST', `/api/crm/accounts/${id}/release-customer-override`, body, who);
const view = async (id, who = viewer) => (await call('GET', `/api/crm/accounts/${id}`, undefined, who)).json;
const GOOD = { reason: 'Licensed under quote 307785', evidence: 'PO 4471 received 11 Nov' };

test('A PROSPECT BECOMES A CUSTOMER BY HAND: reason and evidence required, shown as set by hand with who and why, counted with the other Customers, listed under the Customer filter', async () => {
  reset();
  const onboces = acct('onboces.org'), other = acct('Plain school');
  const person = env.addContact(db, 'p@onboces.test', 'Person'); db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(person);
  db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(onboces, person);
  assert.equal((await view(onboces)).account.relationship, 'prospect', 'before: a Prospect, because a person there is a Prospect');
  for (const bad of [{}, { reason: 'x' }, { evidence: 'y' }, { reason: '  ', evidence: 'y' }, { reason: 'x', evidence: '' }]) { const r = await mark(onboces, bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.json.code, 'evidence_required'); }
  const r = await mark(onboces, GOOD);
  assert.equal(r.status, 200); assert.deepEqual({ relationship: r.json.relationship, handSet: r.json.handSet }, { relationship: 'customer', handSet: true });
  const v = await view(onboces);
  assert.equal(v.account.relationship, 'customer'); assert.equal(v.account.handSetCustomer, true); assert.match(v.account.relationshipWhy, /Set by hand by a CRM Admin: Licensed under quote 307785/);
  assert.deepEqual({ reason: v.customerOverride.reason, evidence: v.customerOverride.evidence, by: v.customerOverride.by }, { reason: GOOD.reason, evidence: GOOD.evidence, by: 'f13boss' }); assert.ok(v.customerOverride.at);
  assert.equal((await view(other)).customerOverride, null); assert.equal((await view(other)).account.handSetCustomer, false);
  const list = (await call('GET', '/api/crm/accounts?relationship=customer', undefined, viewer)).json;
  assert.deepEqual(list.accounts.map(a => a.name), ['onboces.org']); assert.equal(list.accounts[0].handSet, true);
  assert.equal(list.relationshipCounts.customer, 1); assert.equal(list.relationshipCounts.handSet, 1);
  const map = await rel.accountRelationships(pool); assert.equal(map.get(onboces).handSet, true); assert.equal(map.get(other).handSet, false);
  assert.equal((await call('GET', '/api/crm/overview', undefined, viewer)).json.cards.customerOrganizations.count, 1, 'the Overview’s Customer organizations card counts it');
});

test('WHO MAY: CRM Admin only (the same action as marking a person); Sales and Read-only are refused; signed out 401; Hub off 404', async () => {
  reset(); const a = acct('Someone school');
  for (const who of [sales, viewer]) { assert.equal((await mark(a, GOOD, who)).status, 403); assert.equal((await release(a, { reason: 'x' }, who)).status, 403); }
  assert.equal((await mark(a, GOOD, null)).status, 401); assert.equal((await release(a, { reason: 'x' }, null)).status, 401);
  assert.equal(get('SELECT label_override FROM crm_accounts WHERE id = ?', a).label_override, null, 'nothing was written');
  env.enable(db, false);
  try { assert.equal((await mark(a, GOOD)).status, 404); } finally { env.enable(db, true); }
  assert.equal((await mark(999999, GOOD)).status, 404); assert.equal((await mark('abc', GOOD)).status, 404);
});

test('NO DEAD LABELS: an account a paid purchase already makes a Customer, one already set, and an archived one are refused with a plain reason', async () => {
  reset();
  const s = school('paid.test'), paid = acct('Paid school', { schoolId: s }), archived = acct('Archived school', { archived: '2026-01-01 00:00:00' });
  const buyer = env.addContact(db, 'buyer@paid.test', 'Buyer'); const pid = env.addPurchase(db, buyer, { amountCents: 100000 }); db.prepare('UPDATE purchases SET school_id = ? WHERE id = ?').run(s, pid);
  assert.equal((await view(paid)).account.relationship, 'customer');
  let r = await mark(paid, GOOD); assert.equal(r.status, 409); assert.equal(r.json.code, 'already_customer');
  r = await mark(archived, GOOD); assert.equal(r.status, 409); assert.equal(r.json.code, 'archived');
  const plain = acct('Plain'); assert.equal((await mark(plain, GOOD)).status, 200);
  r = await mark(plain, GOOD); assert.equal(r.status, 409); assert.equal(r.json.code, 'already_set');
  assert.equal(get('SELECT label_override FROM crm_accounts WHERE id = ?', paid).label_override, null);
});

test('RELEASE: needs a reason, only works on a hand-set account, clears all five columns and the label goes back to what the purchases and deals say; both steps are audited with the evidence', async () => {
  reset(); const a = acct('Hand set school');
  await mark(a, GOOD);
  assert.equal((await release(a, {})).status, 400); assert.equal((await release(a, { reason: '  ' })).json.code, 'reason_required');
  const r = await release(a, { reason: 'Entered by mistake' });
  assert.equal(r.status, 200); assert.equal(r.json.relationship, 'suspect');
  assert.deepEqual({ ...get('SELECT label_override, label_override_reason, label_override_evidence, label_override_by_admin_id, label_override_at FROM crm_accounts WHERE id = ?', a) }, { label_override: null, label_override_reason: null, label_override_evidence: null, label_override_by_admin_id: null, label_override_at: null });
  assert.equal((await release(a, { reason: 'again' })).json.code, 'not_set'); assert.equal((await view(a)).account.relationship, 'suspect');
  const rows = all("SELECT * FROM school_audit_log WHERE action LIKE 'crm_account_customer_%' ORDER BY id");
  assert.deepEqual(rows.map(x => x.action), ['crm_account_customer_override', 'crm_account_customer_released']);
  for (const x of rows) { assert.equal(x.entity_type, 'crm_account'); assert.equal(x.actor_type, 'admin_user'); assert.equal(x.purchase_id, null); }
  assert.match(rows[0].reason, /Licensed under quote 307785; evidence: PO 4471 received 11 Nov/); assert.equal(rows[1].reason, 'Entered by mistake');
  assert.equal(JSON.parse(rows[1].prev_value).evidence, GOOD.evidence, 'the release keeps what the label had said');
});

test('IT TOUCHES NOTHING ELSE: no purchase, invoice, seat or person changes, and the rule for people and reports is the same (a hand-set account is not a purchase)', async () => {
  reset(); const a = acct('Quiet school');
  const person = env.addContact(db, 'q@quiet.test', 'Q'); db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(a, person);
  const before = JSON.stringify(['purchases', 'invoices', 'newsletter_contacts', 'crm_account_contacts', 'crm_opportunities'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`)));
  await mark(a, GOOD);
  assert.equal(JSON.stringify(['purchases', 'invoices', 'newsletter_contacts', 'crm_account_contacts', 'crm_opportunities'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`))), before);
  assert.equal(get('SELECT crm_classification AS c FROM newsletter_contacts WHERE id = ?', person).c, 'suspect', 'the person on the account is not made a Customer by it');
  const lib = fs.readFileSync(path.join(env.SERVER, 'lib/crm-account-relationship.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(lib, /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i, 'the label lib only reads');
  const route = fs.readFileSync(path.join(env.SERVER, 'routes/crm-accounts.js'), 'utf8');
  const seg = route.slice(route.indexOf("router.post('/:id/customer-override'"), route.indexOf("router.post('/:id/archive'"));
  assert.doesNotMatch(seg, /UPDATE (purchases|invoices|license_seats|newsletter_contacts)|INSERT INTO (purchases|invoices)/i);
});

test('THE EXPLAINER AND COUNTS: the Customer line says it can be set by hand, and the live counts carry a "set by hand" figure; nothing names a school', async () => {
  reset(); const a = acct('Counted school'); await mark(a, GOOD);
  const o = await rules.overview(pool, new Date().toISOString().slice(0, 10));
  assert.match(o.rules.accounts.find(x => x.label === 'Customer').text, /set it by hand with a reason and the evidence/);
  assert.equal(o.counts.accounts.customer, 1); assert.equal(o.counts.accounts.handSet, 1);
  assert.doesNotMatch(JSON.stringify(o), /Counted school/);
});

test('BEFORE THE ALTER SCRIPT: with no columns every label works as before, nothing is hand-set, and marking says it is not available yet', async () => {
  reset(); const a = acct('Old install school');
  db.exec('ALTER TABLE crm_accounts DROP COLUMN label_override; ALTER TABLE crm_accounts DROP COLUMN label_override_reason; ALTER TABLE crm_accounts DROP COLUMN label_override_evidence; ALTER TABLE crm_accounts DROP COLUMN label_override_by_admin_id; ALTER TABLE crm_accounts DROP COLUMN label_override_at;');
  try {
    const v = await view(a); assert.equal(v.account.relationship, 'suspect'); assert.equal(v.customerOverride, null); assert.equal(v.account.handSetCustomer, false);
    assert.equal((await call('GET', '/api/crm/accounts', undefined, viewer)).status, 200); assert.equal((await call('GET', '/api/crm/overview', undefined, viewer)).status, 200);
    const m = await mark(a, GOOD); assert.equal(m.status, 503); assert.equal(m.json.code, 'not_available');
    assert.equal((await release(a, { reason: 'x' })).status, 503);
    assert.equal((await rules.overview(pool, '2026-11-18')).counts.accounts.handSet, 0);
  } finally {
    db.exec('ALTER TABLE crm_accounts ADD COLUMN label_override TEXT; ALTER TABLE crm_accounts ADD COLUMN label_override_reason TEXT; ALTER TABLE crm_accounts ADD COLUMN label_override_evidence TEXT; ALTER TABLE crm_accounts ADD COLUMN label_override_by_admin_id INTEGER; ALTER TABLE crm_accounts ADD COLUMN label_override_at TEXT;');
  }
});

test('FILES AND PAGES: schema, alter script and test DDL agree and the script only adds; both pages escape what they show and ask for reason and evidence; the explainer shows the figure; the code parses', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  for (const c of ['label_override', 'label_override_reason', 'label_override_evidence', 'label_override_by_admin_id', 'label_override_at']) { assert.match(read('db/schema.sql'), new RegExp(c)); assert.match(read('scripts/alter-add-crm-account-customer-override.js'), new RegExp(c)); }
  const alter = read('scripts/alter-add-crm-account-customer-override.js').replace(/\/\/.*$/gm, '');
  assert.match(alter, /information_schema\.COLUMNS/); assert.doesNotMatch(alter, /DROP|RENAME|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET/i);
  const page = read('../admin-crm-account.html');
  for (const k of ["id=\"markCust\"", "id=\"releaseCust\"", "C.can('set_customer')", 'Set by hand', '/customer-override', '/release-customer-override', 'esc(data.customerOverride.evidence)', 'esc(data.account.name)']) assert.ok(page.includes(k), k);
  assert.match(read('../admin-crm-accounts.html'), /\(by hand\)/); assert.match(read('../admin-crm-settings.html'), /ct\.accounts\.handSet/);
  for (const f of ['lib/crm-account-relationship.js', 'lib/crm-classification-rules.js', 'routes/crm-accounts.js', 'scripts/alter-add-crm-account-customer-override.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  for (const f of ['../admin-crm-account.html', '../admin-crm-accounts.html', '../admin-crm-settings.html']) for (const s of [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s), f);
});
