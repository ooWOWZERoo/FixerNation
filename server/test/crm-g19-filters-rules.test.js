// Sales CRM punch list G19 (PRD section 17): list filters by buying role, license status and organization (contacts and accounts), and the read-only "How labels are decided" section of
// Hub Settings. Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const c of ['expiration_date TEXT', 'seat_count INTEGER', 'school_domain TEXT']) { try { db.exec(`ALTER TABLE purchases ADD COLUMN ${c}`); } catch { /* there already */ } }
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/contacts', R('crm-contacts.js')], ['/api/crm/accounts', R('crm-accounts.js')], ['/api/crm', R('crm-settings.js')]]);
test.after(() => server.close());
const F = require(path.join(env.SERVER, 'lib/crm-filters.js'));

const admin = env.addAdmin(db, 'g19boss', 'admin'), sales = env.addAdmin(db, 'g19rep', 'sales'), viewer = env.addAdmin(db, 'g19viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const person = (name, email) => env.addContact(db, email || `${name.toLowerCase()}@g19.test`, name);
const org = (name, f = {}) => ins('INSERT INTO crm_accounts (name, account_type, school_id, district_id, parent_account_id) VALUES (?, ?, ?, ?, ?)', name, f.type || 'school', f.school || null, f.district || null, f.parent || null);
const place = (a, c, f = {}) => db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id, is_champion, is_decision_maker, is_procurement, is_finance, ended_on) VALUES (?, ?, ?, ?, ?, ?, ?)').run(a, c, f.champion ? 1 : 0, f.dm ? 1 : 0, f.proc ? 1 : 0, f.fin ? 1 : 0, f.ended || null);
// A purchase. f: school, cents, status, trial (days left, or null for none), trialNoEnd, ends (days), lic (license_status).
function buy(c, f = {}) {
  const id = env.addPurchase(db, c, { amountCents: f.cents === undefined ? 90000 : f.cents, paymentStatus: f.status || 'paid', trialLessonLimit: f.trial !== undefined || f.trialNoEnd ? 5 : undefined, trialExpirationDate: f.trial !== undefined ? day(f.trial) : undefined });
  db.prepare('UPDATE purchases SET school_id = ?, expiration_date = ?, license_status = ? WHERE id = ?').run(f.school || null, f.ends === undefined ? day(200) : (f.ends === null ? null : day(f.ends)), f.lic || 'active', id);
  return id;
}
const reset = () => db.exec('DELETE FROM purchases; DELETE FROM crm_opportunity_contacts; DELETE FROM crm_opportunities; DELETE FROM crm_account_contacts; DELETE FROM crm_accounts; DELETE FROM schools; DELETE FROM districts; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log');
const names = async (qs, who = sales) => (await call('GET', `/api/crm/contacts?pageSize=100&today=${TODAY}&${qs}`, undefined, who)).json.contacts.map(c => c.name).sort();
const anames = async (qs, who = sales) => (await call('GET', `/api/crm/accounts?pageSize=100&today=${TODAY}&${qs}`, undefined, who)).json.accounts.map(a => a.name).sort();

test('LICENSE STATUS FOR PEOPLE: live paid, live trial, only an ended trial, none; a cancelled or past-end license is not live; a trial with no end date is live; a test address is ignored', async () => {
  reset();
  const paid = person('Paid'), expired = person('Expired'), cancelled = person('Cancelled'), trial = person('Trial'), noend = person('NoEnd'), ended = person('Ended'), none = person('None'), both = person('Both'), qa = person('QA', 'qa@example.com'), zero = person('Zero');
  buy(paid); buy(expired, { ends: -5 }); buy(cancelled, { lic: 'cancelled' }); buy(trial, { trial: 10, cents: 0, ends: null }); buy(noend, { trialNoEnd: true, ends: null }); buy(ended, { trial: -10, ends: null });
  buy(both, { trial: 10, ends: null }); buy(both); buy(qa); buy(zero, { cents: 0 });
  assert.deepEqual(await names('license=paid'), ['Both', 'Paid'].sort());
  assert.deepEqual(await names('license=trial'), ['Both', 'NoEnd', 'Trial'].sort());
  assert.deepEqual(await names('license=ended_trial'), ['Ended'], 'a person with a live license or live trial is not "only an ended trial"');
  assert.deepEqual(await names('license=none'), ['None'].sort(), 'no purchase of any kind; people whose only purchases expired or were cancelled still have purchases');
  assert.deepEqual(await names('license=bogus'), (await names('')), 'an unknown value is ignored, not an error');
  void [expired, cancelled, zero];
  assert.equal((await call('GET', `/api/crm/contacts?license=paid&today=${TODAY}`, undefined, viewer)).status, 200);
});

test('BUYING ROLE FOR PEOPLE: a role flag on an account (only while still there) or a role on a deal\'s buying committee; four roles; an unknown role is ignored', async () => {
  reset();
  const champ = person('Champ'), left = person('Left'), dm = person('Dm'), onDeal = person('OnDeal'), fin = person('Fin'), proc = person('Proc'), plain = person('Plain');
  const a = org('Maple'); const d = ins("INSERT INTO crm_opportunities (account_id, name, stage_id, state) VALUES (?, 'D', 1, 'open')", a);
  place(a, champ, { champion: true }); place(a, left, { champion: true, ended: day(-3) }); place(a, dm, { dm: true }); place(a, fin, { fin: true }); place(a, proc, { proc: true }); place(a, plain);
  db.prepare("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'champion')").run(d, onDeal);
  assert.deepEqual(await names('role=champion'), ['Champ', 'OnDeal']); assert.deepEqual(await names('role=decision_maker'), ['Dm']); assert.deepEqual(await names('role=finance'), ['Fin']); assert.deepEqual(await names('role=procurement'), ['Proc']);
  assert.deepEqual(await names('role=influencer'), await names(''), 'a role we do not offer is ignored'); assert.deepEqual(await names('role=champion&license=none'), ['Champ', 'OnDeal'], 'filters combine (and)');
  assert.deepEqual(await names('role=champion&license=paid'), []);
});

test('ORGANIZATION: by exact account or by part of its name, current people only', async () => {
  reset();
  const a = person('At Maple'), b = person('At Oak'), gone = person('Was At Maple'), none = person('Nowhere');
  const maple = org('Maple Elementary'), oak = org('Oak Middle'); place(maple, a); place(oak, b); place(maple, gone, { ended: day(-2) });
  assert.deepEqual(await names(`accountId=${maple}`), ['At Maple']); assert.deepEqual(await names('organization=Maple'), ['At Maple']); assert.deepEqual(await names('organization=oak'), ['At Oak']); assert.deepEqual(await names('organization=%25'), [], 'a wildcard typed in the box is not a wildcard');
  void none;
});

test('LOCKED LABELS: ?locked=true lists the people whose label was set by hand', async () => {
  reset();
  const a = person('Hand'), b = person('Auto'); db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer', classification_locked = 1 WHERE id = ?").run(a); void b;
  assert.deepEqual(await names('classification=customer&locked=true'), ['Hand']);
});

test('ACCOUNTS: buying role (someone still there), license status (placed by school, a district by its schools), and the parent; combined with the others', async () => {
  reset();
  const district = ins("INSERT INTO districts (name) VALUES ('Dist')"); const s1 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('s1.test', ?, 'S1')", district), s2 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('s2.test', NULL, 'S2')");
  const dist = org('The district', { type: 'district', district }), school1 = org('School one', { school: s1, parent: dist }), school2 = org('School two', { school: s2 }), empty = org('Empty school');
  const buyer = person('Buyer'), c1 = person('Champ'), c2 = person('FormerChamp'); place(school1, c1, { champion: true }); place(school2, c2, { champion: true, ended: day(-1) });
  buy(buyer, { school: s1 }); buy(buyer, { school: s2, trial: 5, cents: 0, ends: null });
  assert.deepEqual(await anames('license=paid'), ['School one', 'The district'].sort(), 'a district counts its schools');
  assert.deepEqual(await anames('license=trial'), ['School two']); assert.deepEqual(await anames('license=none'), ['Empty school']);
  assert.deepEqual(await anames('role=champion'), ['School one'], 'someone who left does not count');
  assert.deepEqual(await anames(`parent=${dist}`), ['School one']); assert.deepEqual(await anames(`parent=${dist}&license=trial`), []);
  assert.deepEqual(await anames('license=nonsense'), await anames(''));
  void empty;
  const total = (await call('GET', `/api/crm/accounts?license=paid&today=${TODAY}&pageSize=1`, undefined, viewer)).json.total; assert.equal(total, 2, 'the count matches the list');
});

test('THE FILTERS ONLY READ: no write, no score; the builders return SQL with parameters, roles and license names are fixed lists', () => {
  assert.deepEqual(Object.keys(F.ROLES), ['champion', 'decision_maker', 'procurement', 'finance']); assert.deepEqual(F.LICENSES, ['paid', 'trial', 'ended_trial', 'none']);
  assert.equal(F.roleForContact('x; DROP TABLE y'), null); for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 5, null, {}]) { assert.equal(F.roleForContact(bad), null, String(bad)); assert.equal(F.roleForAccount(bad), null, String(bad)); } assert.equal(F.roleForAccount('constructor'), null); assert.equal(F.licenseForContact('x', TODAY), null);
  assert.equal(F.organizationForContact({}), null); assert.equal(F.organizationForContact({ accountId: 5 }).params[0], 5);
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-filters.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b|\bscore\b/i);
});

test('HOW LABELS ARE DECIDED: a read-only explainer with the live counts the lists use, links to the matching lists, no names; every role may read it; it is not editable', async () => {
  reset();
  const s = person('S'), p = person('P'), c = person('C'), hand = person('Hand'), qa = person('QA', 'qa@example.com');
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(p); db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id = ?").run(c);
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer', classification_locked = 1 WHERE id = ?").run(hand); db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id = ?").run(qa); void s;
  for (const who of [admin, sales, viewer]) assert.equal((await call('GET', `/api/crm/classification-rules?today=${TODAY}`, undefined, who)).status, 200);
  assert.equal((await call('GET', '/api/crm/classification-rules')).status, 401);
  const r = (await call('GET', `/api/crm/classification-rules?today=${TODAY}`, undefined, viewer)).json;
  assert.equal(r.counts.contacts.suspect, 1); assert.equal(r.counts.contacts.prospect, 1); assert.equal(r.counts.contacts.customer, 2, 'the test address is left out'); assert.equal(r.counts.contacts.handSet, 1);
  assert.equal(r.counts.contacts.customersWithoutQualifyingPurchase, 1, 'Customer with nothing qualifying and not set by hand');
  assert.ok(r.counts.accounts && typeof r.counts.accounts.customer === 'number');
  assert.ok(r.rules.contacts.length === 4 && r.rules.accounts.length === 4 && /not a score/.test(r.rules.never));
  assert.doesNotMatch(JSON.stringify(r), /@|\bS\b.*g19|hot lead|warm lead|cold lead/i);
  for (const m of ['put', 'post', 'delete']) assert.equal((await call(m.toUpperCase(), '/api/crm/classification-rules', {}, admin)).status, 404, `nothing can ${m} here`);
  const cust = (await call('GET', '/api/crm/contacts?classification=customer&locked=true', undefined, viewer)).json; assert.equal(cust.total, r.counts.contacts.handSet, 'the link shows what the count says');
});

test('PAGES: the contacts and accounts lists have the new filters, Hub Settings shows the explainer with escaped text and no edit box, and nothing outside is trusted', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const contacts = read('../admin-crm-contacts.html'), accounts = read('../admin-crm-accounts.html'), settings = read('../admin-crm-settings.html');
  for (const k of ['fRole', 'fLicense', 'fOrg', 'role: st.role', 'license: st.license', 'organization: st.organization', 'locked:']) assert.ok(contacts.includes(k), k);
  for (const k of ['fRole', 'fLicense', 'role: st.role', 'license: st.license']) assert.ok(accounts.includes(k), k);
  for (const k of ['How labels are decided', '/api/crm/classification-rules', 'ruleList', 'esc(r.text)', 'esc(rl.never)']) assert.ok(settings.includes(k), k);
  assert.doesNotMatch(settings.slice(settings.indexOf('How labels are decided')), /C\.api\('(PUT|POST)', '\/api\/crm\/classification/, 'the explainer has no way to change a rule');
  const lib = read('lib/crm-classification-rules.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(lib, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b/i);
  for (const f of ['lib/crm-filters.js', 'lib/crm-classification-rules.js', 'routes/crm-contacts.js', 'routes/crm-accounts.js', 'routes/crm-settings.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
