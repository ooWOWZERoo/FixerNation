// Sales CRM punch list G17 (ACC-03, ACC-05): possible duplicate accounts by website address, and paid purchase and deal rollups on an account. Read only. Real routes and SQL. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const c of ['seat_count INTEGER', 'expiration_date TEXT', 'school_domain TEXT']) { try { db.exec(`ALTER TABLE purchases ADD COLUMN ${c}`); } catch { /* there already */ } }
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/accounts', R('crm-accounts.js')]]);
test.after(() => server.close());
const roll = require(path.join(env.SERVER, 'lib/crm-account-rollups.js'));

const admin = env.addAdmin(db, 'g17boss', 'admin'), sales = env.addAdmin(db, 'g17rep', 'sales'), viewer = env.addAdmin(db, 'g17viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const account = (name, type, domain, f = {}) => ins('INSERT INTO crm_accounts (name, account_type, website_domain, school_id, district_id, archived_at) VALUES (?, ?, ?, ?, ?, ?)', name, type, domain, f.school || null, f.district || null, f.archived || null);
const reset = () => db.exec('DELETE FROM purchases; DELETE FROM crm_opportunities; DELETE FROM crm_account_contacts; DELETE FROM crm_accounts; DELETE FROM schools; DELETE FROM districts; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log');

test('THE WEB ADDRESS KEY: capitals, scheme, www, a port, a trailing slash, a query and a fragment are ignored; a different path is a different address; shared sites and non-addresses give nothing', () => {
  const k = roll.domainKey;
  for (const v of ['https://www.Maple.example.org/', 'maple.example.org', 'HTTP://maple.example.org:8080', 'www.maple.example.org?x=1#top', ' maple.example.org/ ']) assert.equal(k(v), 'maple.example.org', v);
  assert.equal(k('https://district.org/maple/'), 'district.org/maple'); assert.notEqual(k('district.org/maple'), k('district.org/oak')); assert.equal(k('district.org/maple?x=1'), 'district.org/maple');
  for (const v of ['https://facebook.com/maple', 'www.instagram.com/maple', 'https://sites.google.com/view/maple', 'maple.wixsite.com', 'localhost', 'not a site', 'a@b.com', '', '   ', null, undefined, 5, {}]) assert.equal(k(v), null, String(v));
  assert.equal(k('https://maple.facebook.com'), null, 'a subdomain of a shared site, with no path of its own');
});

test('DUPLICATES: live accounts of the same type with the same address are grouped; other types, other paths, archived accounts, shared sites and shared email domains are not; nothing is changed', async () => {
  reset();
  const a = account('Maple Elementary', 'school', 'https://www.maple.example.org/'), b = account('Maple Elem. School', 'school', 'maple.example.org'), c = account('Maple (old)', 'school', 'maple.example.org/', { archived: '2026-01-01 00:00:00' });
  const d = account('Maple District', 'district', 'maple.example.org'), e = account('Oak A', 'school', 'district.org/oak'), f = account('Oak B', 'school', 'district.org/pine');
  const g = account('FB one', 'school', 'facebook.com/one'), h = account('FB two', 'school', 'facebook.com/one'), i = account('No site', 'school', null), j = account('Blank', 'school', '');
  const person1 = env.addContact(db, 'a@shared-mail.test'), person2 = env.addContact(db, 'b@shared-mail.test');
  db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(i, person1); db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(j, person2); // share an email domain, not a website
  db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state) VALUES (?, 'Open deal', 1, 'open')").run(b);
  const before = JSON.stringify(['crm_accounts', 'crm_account_contacts', 'crm_opportunities'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`)));
  const r = await call('GET', '/api/crm/accounts/review/duplicates', undefined, viewer);
  assert.equal(r.status, 200); assert.equal(r.json.total, 1);
  assert.deepEqual(r.json.groups[0].accounts.map(x => x.id), [a, b]); assert.equal(r.json.groups[0].domain, 'maple.example.org');
  assert.equal(r.json.groups[0].accounts[1].openDeals, 1); assert.ok(r.json.groups[0].accounts.every(x => x.relationship));
  assert.equal(JSON.stringify(['crm_accounts', 'crm_account_contacts', 'crm_opportunities'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`))), before, 'read only');
  assert.equal((await call('GET', '/api/crm/accounts/review/duplicates')).status, 401);
  void [c, d, e, f, g, h];
});

test('ON THE ACCOUNT PAGE: the other accounts with the same address are named (at most 5), and an archived account has none', async () => {
  reset();
  const a = account('One', 'school', 'maple.example.org'), b = account('Two', 'school', 'https://maple.example.org/'), arch = account('Gone', 'school', 'maple.example.org', { archived: '2026-01-01 00:00:00' });
  const x = (await call('GET', `/api/crm/accounts/${a}`, undefined, sales)).json;
  assert.deepEqual(x.possibleDuplicates.map(d => d.id), [b]);
  assert.deepEqual((await call('GET', `/api/crm/accounts/${arch}`, undefined, sales)).json.possibleDuplicates, []);
  for (let n = 0; n < 7; n++) account(`Extra ${n}`, 'school', 'maple.example.org');
  assert.equal((await call('GET', `/api/crm/accounts/${a}`, undefined, sales)).json.possibleDuplicates.length, 5);
});

test('PAID PURCHASE ROLLUPS: only paid, non-trial purchases of more than $0 by real buyers, placed by school (a district also by its schools), counted once, with the dates', async () => {
  reset();
  const district = ins("INSERT INTO districts (name) VALUES ('Rollup District')");
  const s1 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('s1.test', ?, 'S1')", district), s2 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('s2.test', ?, 'S2')", district), other = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('o.test', NULL, 'Other')");
  const schoolAcct = account('S1 school', 'school', null, { school: s1 }), otherAcct = account('Other school', 'school', null, { school: other }), distAcct = account('The district', 'district', null, { district });
  const buyer = env.addContact(db, 'buyer@real.test'), tester = env.addContact(db, 'qa@example.com');
  const buy = (c, school, o = {}) => { const id = env.addPurchase(db, c, { amountCents: o.cents === undefined ? 100000 : o.cents, paymentStatus: o.status || 'paid', trialLessonLimit: o.trial ? 5 : undefined, trialExpirationDate: o.trial ? day(20) : undefined }); db.prepare('UPDATE purchases SET school_id = ?, purchased_at = ?, expiration_date = ?, seat_count = ? WHERE id = ?').run(school, o.at || '2026-03-01 10:00:00', o.ends || day(100), o.seats || 50, id); return id; };
  buy(buyer, s1, { cents: 100000, at: '2026-01-10 10:00:00' }); buy(buyer, s1, { cents: 50000, at: '2026-06-10 10:00:00', ends: day(40) });
  buy(buyer, s2, { cents: 30000, at: '2026-05-05 10:00:00' });
  buy(buyer, s1, { trial: true }); buy(buyer, s1, { cents: 0 }); buy(buyer, s1, { status: 'pending' }); buy(tester, s1); buy(buyer, other, { cents: 7000 });
  const t = await roll.purchaseTotals(pool, [schoolAcct, otherAcct, distAcct]);
  assert.deepEqual(t.get(schoolAcct), { count: 2, totalCents: 150000, firstAt: '2026-01-10 10:00:00', lastAt: '2026-06-10 10:00:00' });
  assert.deepEqual(t.get(otherAcct), { count: 1, totalCents: 7000, firstAt: '2026-03-01 10:00:00', lastAt: '2026-03-01 10:00:00' });
  assert.equal(t.get(distAcct).count, 3, 'a district includes its schools'); assert.equal(t.get(distAcct).totalCents, 180000);
  assert.equal((await roll.purchaseTotals(pool, [])).size, 0);
  // Counted once even when both the school and the district match the same account.
  const district2 = ins("INSERT INTO districts (name) VALUES ('Second District')"), s4 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('s4.test', ?, 'S4')", district2);
  const both = account('Both', 'district', null, { school: s4, district: district2 });
  buy(buyer, s4, { cents: 12000 });
  assert.deepEqual((await roll.purchaseTotals(pool, [both])).get(both).count, 1, 'a purchase that matches by school and by district is one purchase');
  // The list and the page.
  const list = (await call('GET', '/api/crm/accounts?pageSize=50', undefined, viewer)).json.accounts;
  assert.equal(list.find(a => a.id === schoolAcct).paid.count, 2); assert.equal(list.find(a => a.id === distAcct).paid.totalCents, 180000);
  const empty = account('Nothing yet', 'school', null); assert.deepEqual((await call('GET', '/api/crm/accounts?pageSize=50', undefined, viewer)).json.accounts.find(a => a.id === empty).paid, { count: 0, totalCents: 0, firstAt: null, lastAt: null });
  const page = (await call('GET', `/api/crm/accounts/${schoolAcct}?today=${day(0)}`, undefined, sales)).json.rollup;
  assert.equal(page.paid.count, 2); assert.equal(page.paid.nextEnd, day(40)); assert.equal(page.paid.items.length, 2); assert.equal(page.paid.items[0].amountCents, 50000); assert.equal(page.includesSchools, false);
  assert.equal((await call('GET', `/api/crm/accounts/${distAcct}?today=${day(0)}`, undefined, sales)).json.rollup.includesSchools, true);
  assert.doesNotMatch(JSON.stringify(page), /@|buyer/i, 'no buyer address or name');
  const none = (await call('GET', `/api/crm/accounts/${empty}`, undefined, sales)).json.rollup; assert.equal(none.paid.count, 0); assert.equal(none.paid.totalCents, 0); assert.equal(none.paid.nextEnd, null); assert.deepEqual(none.paid.items, []);
});

test('DEAL ROLLUPS: open deals and their value (an open deal with no value is counted, not added as zero), and deals won; test-address deals are left out', async () => {
  reset();
  const a = account('Deals', 'school', null);
  const deal = (o) => ins("INSERT INTO crm_opportunities (account_id, name, stage_id, state, amount_cents) VALUES (?, 'D', 1, ?, ?)", a, o.state || 'open', o.amount === undefined ? null : o.amount);
  deal({ amount: 100000 }); deal({ amount: 50000 }); deal({}); deal({ state: 'won', amount: 99999 }); deal({ state: 'lost', amount: 5 });
  const t = env.addContact(db, 'test-deal@example.com'); const hidden = deal({ amount: 7777 }); db.prepare("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'other')").run(hidden, t);
  const q = ins("INSERT INTO quote_requests (quote_number, email, opportunity_id) VALUES ('T', 'someone@example.com', ?)", hidden); void q;
  const r = (await call('GET', `/api/crm/accounts/${a}`, undefined, sales)).json.rollup.deals;
  assert.equal(r.open, 3); assert.equal(r.openValueCents, 150000); assert.equal(r.openWithoutValue, 1); assert.equal(r.won, 1);
});

test('PAGES AND RULES: the accounts page has the duplicates tab and the Paid column, the account page shows the rollup and the hint, everything outside is escaped, and nothing here writes', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const accounts = read('../admin-crm-accounts.html'), account1 = read('../admin-crm-account.html');
  for (const k of ['view=duplicates', 'fetchDupes', 'review/duplicates', 'Paid purchases', 'a.paid']) assert.ok(accounts.includes(k), k);
  assert.match(accounts, /esc\(why\)/); assert.match(accounts, /g\.domain/); assert.match(accounts, /esc\(a\.websiteDomain\)/);
  for (const k of ['Paid purchases and deals', 'data.rollup', 'possibleDuplicates', 'Includes purchases for the schools']) assert.ok(account1.includes(k), k);
  assert.match(account1, /esc\(d\.name\)/); assert.match(account1, /esc\(i\.product/);
  const lib = read('lib/crm-account-rollups.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(lib, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b|\bALTER TABLE\b|mailer|\bscore\b/i);
  assert.match(lib, /QUALIFYING_SQL/); assert.doesNotMatch(lib, /email_domain|SUBSTRING_INDEX|split\('@'\)/, 'a shared email domain is never used');
  for (const f of ['lib/crm-account-rollups.js', 'routes/crm-accounts.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
