// Sales CRM gap G8 (PRD FR-REP-01): the Overview cards the first build lacked (Customer organizations, expected closings, open quotes, unpaid invoices, renewals due, win rate).
// Each number is checked against data built to include the near misses. Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec('ALTER TABLE invoices ADD COLUMN total_cents INTEGER');
env.install(pool);
const reports = require(path.join(env.SERVER, 'lib/crm-reports.js'));
const { server, call } = env.listen([['/api/crm/overview', require(path.join(env.SERVER, 'routes/crm-overview.js'))]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const TODAY = '2026-11-15';
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const at = (n) => `${day(n)} 12:00:00`;
const cards = async (who = viewer) => (await call('GET', `/api/crm/overview?today=${TODAY}`, undefined, who)).json.cards;
const school = (domain, district = null) => Number(db.prepare('INSERT INTO schools (domain, district_id) VALUES (?, ?)').run(domain, district).lastInsertRowid);
const acct = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, school_id, district_id, archived_at) VALUES (?, ?, ?, ?, ?)').run(name, f.district ? 'district' : 'school', f.schoolId || null, f.districtId || null, f.archived ? at(-1) : null).lastInsertRowid);
const deal = (name, f = {}) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, opp_type, amount_cents, expected_close_date, created_at, closed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.account || base, name, stage(f.state === 'won' ? 'won' : 'qualified'), admin, f.state || 'open', f.type || 'new_business', f.amount === undefined ? null : f.amount, f.close || null, f.created || at(-100), f.closedAt || null).lastInsertRowid);
const base = acct('Base account');
const wipe = (...t) => db.exec(t.map(x => `DELETE FROM ${x};`).join(' '));

test('CUSTOMER ORGANIZATIONS: a school or district with a paid, non-trial purchase for that school (or a school in that district), counted once each; unplaceable purchases are counted apart, never guessed', async () => {
  const buyer = env.addContact(db, 'org-buyer@school.test', 'Buyer'), qa = env.addContact(db, 'qa@example.com', 'QA');
  const s1 = school('one.test'), s2 = school('two.test'), s3 = school('three.test'), d5 = Number(db.prepare("INSERT INTO districts (name) VALUES ('D5')").run().lastInsertRowid);
  const sd1 = school('d1.test', d5), sd2 = school('d2.test', d5);
  acct('School one', { schoolId: s1 }); acct('School two (trial only)', { schoolId: s2 }); acct('School three (pending)', { schoolId: s3 });
  acct('District five', { district: true, districtId: d5 }); acct('Archived school', { schoolId: school('arch.test'), archived: true }); acct('Test buyer school', { schoolId: school('qa.test') });
  const paid = (c, sid, f = {}) => { const id = env.addPurchase(db, c, { paymentStatus: f.status || 'paid', amountCents: f.cents === undefined ? 50000 : f.cents, trialLessonLimit: f.trial ? 3 : undefined }); db.prepare('UPDATE purchases SET school_id = ? WHERE id = ?').run(sid, id); return id; };
  paid(buyer, s1); paid(buyer, s1);                  // two purchases, one organization
  paid(buyer, s2, { trial: true, cents: 0 }); paid(buyer, s3, { status: 'pending' });
  paid(buyer, sd1); paid(buyer, sd2);                // two schools in one district: the district counts once (and each school has no account of its own)
  paid(buyer, school('arch.test2'));                 // a school with no account at all
  paid(qa, db.prepare("SELECT id FROM schools WHERE domain = 'qa.test'").get().id);
  paid(buyer, null); paid(buyer, null, { status: 'pending' }); paid(qa, null); // unplaceable: one real, the others do not qualify or are tests
  const c = await cards();
  assert.deepEqual(c.customerOrganizations, { count: 2, unresolvedPurchases: 1 });
  wipe('purchases', 'crm_accounts', 'schools', 'districts', 'newsletter_contacts');
});

test('EXPECTED CLOSINGS: open deals whose expected close date is in the current quarter of the day the page names, with their value; the value-less ones are counted apart', async () => {
  deal('in A', { close: '2026-10-01', amount: 100000 }); deal('in B', { close: '2026-12-31', amount: 50000 }); deal('in no value', { close: '2026-11-30' });
  deal('before', { close: '2026-09-30', amount: 999 }); deal('after', { close: '2027-01-01', amount: 999 }); deal('no date', { amount: 999 }); deal('won', { close: '2026-11-02', state: 'won', amount: 999 });
  const t = deal('test deal', { close: '2026-11-03', amount: 999 }); env.addQuote(db, 'qa@example.com', { opportunityId: t, number: 'QX' });
  const x = (await cards()).expectedClosings;
  assert.deepEqual(x, { period: 'Q4 2026', from: '2026-10-01', to: '2026-12-31', count: 3, grossCents: 150000, withoutValue: 1 });
  const q1 = (await call('GET', '/api/crm/overview?today=2027-02-01', undefined, viewer)).json.cards.expectedClosings;
  assert.equal(q1.period, 'Q1 2027'); assert.equal(q1.count, 1);
  wipe('crm_opportunities', 'quote_requests');
});

test('OPEN QUOTES: sent and unanswered, current revision only, not expired, not closed, on an open deal or none; the total adds each quote once', async () => {
  const live = deal('live'), lost = deal('lost', { state: 'lost' });
  const q = (n, f = {}) => { const id = env.addQuote(db, f.email || 'b@school.test', { number: n, opportunityId: f.deal === undefined ? live : f.deal, sentAt: f.sent === undefined ? at(-3) : f.sent, status: f.status || 'contacted', amountCents: f.cents === undefined ? 10000 : f.cents });
    if (f.accepted) db.prepare('UPDATE quote_requests SET accepted_at = ? WHERE id = ?').run(at(-1), id);
    if (f.superseded) db.prepare("UPDATE quote_requests SET version_status = 'superseded' WHERE id = ?").run(id);
    if (f.until) db.prepare('UPDATE quote_requests SET quote_valid_until = ? WHERE id = ?').run(f.until, id);
    return id; };
  q('A'); q('B', { cents: 25000, deal: null }); q('C', { cents: null, until: day(10) });
  q('D', { accepted: true }); q('E', { superseded: true }); q('F', { sent: null }); q('G', { until: day(-1) }); q('H', { status: 'closed' }); q('I', { deal: lost }); q('J', { email: 'qa@example.com' });
  q('K', { until: day(0) });
  assert.deepEqual((await cards()).openQuotes, { count: 4, totalCents: 45000, unpriced: 1 });
  wipe('quote_requests', 'crm_opportunities');
});

test('UNPAID INVOICES: invoices still unpaid, with their total; not paid, cancelled or test-address ones', async () => {
  const buyer = env.addContact(db, 'inv@school.test', 'Inv'), qa = env.addContact(db, 'qa-inv@example.com', 'QA');
  const inv = (n, c, status, cents) => db.prepare('INSERT INTO invoices (invoice_number, contact_id, status, total_cents) VALUES (?, ?, ?, ?)').run(n, c, status, cents);
  inv('I1', buyer, 'unpaid', 120000); inv('I2', buyer, 'unpaid', 30000); inv('I3', buyer, 'paid', 999); inv('I4', buyer, 'cancelled', 999); inv('I5', qa, 'unpaid', 999);
  assert.deepEqual((await cards()).unpaidInvoices, { count: 2, totalCents: 150000 });
  wipe('invoices', 'newsletter_contacts');
});

test('RENEWALS DUE: paid group licenses ending within the generator\'s lead time with no renewal yet, and the open renewal deals; not trials, ended or far ones', async () => {
  const buyer = env.addContact(db, 'ren@school.test', 'Ren');
  const lic = (sid, ends, f = {}) => { const id = env.addPurchase(db, buyer, { paymentStatus: f.status || 'paid', amountCents: 500000, trialLessonLimit: f.trial ? 3 : undefined }); db.prepare("UPDATE purchases SET product_type = 'group_license', school_id = ?, expiration_date = ?, seat_count = 10 WHERE id = ?").run(sid, ends, id); return id; };
  const a = school('r1.test'), b = school('r2.test'), c = school('r3.test'), d = school('r4.test'), e = school('r5.test'), f = school('r6.test');
  lic(a, day(40));                          // due
  lic(b, day(40)); lic(b, day(400));        // already renewed by a later license
  lic(c, day(40), { trial: true });         // a trial
  lic(d, day(-1));                          // ended yesterday
  lic(e, day(200));                         // beyond the 120 days
  lic(f, day(100), { status: 'pending' });  // not paid
  deal('renewal one', { type: 'renewal' }); deal('renewal won', { type: 'renewal', state: 'won' }); deal('plain');
  assert.deepEqual((await cards()).renewalsDue, { licensesEnding: 1, windowDays: 120, openRenewalDeals: 1 });
  wipe('purchases', 'crm_opportunities', 'schools', 'newsletter_contacts');
});

test('WIN RATE: won over won-plus-lost for the last 90 days, the same figure the Reports give; no closed deals is "no rate", never 0%', async () => {
  assert.deepEqual((await cards()).winRate, { percent: null, won: 0, lost: 0, days: 90 });
  for (let i = 0; i < 3; i++) deal(`won ${i}`, { state: 'won', closedAt: at(-10 - i) });
  deal('lost', { state: 'lost', closedAt: at(-5) }); deal('inactive', { state: 'inactive', closedAt: at(-5) });
  deal('old win', { state: 'won', closedAt: at(-120) }); deal('old loss', { state: 'lost', closedAt: at(-95) }); deal('still open');
  const w = (await cards()).winRate;
  assert.deepEqual(w, { percent: 75, won: 3, lost: 1, days: 90 });
  const rep = await reports.runReport(pool, 'winloss', { from: day(-89), to: TODAY });
  assert.equal(w.percent, rep.totals.winRate, 'the card and the Reports agree');
  wipe('crm_opportunities');
});

test('ACCESS AND SAFETY: all three CRM roles can read the cards, signed out is refused, a card the server cannot work out is null (never a zero) and the others still arrive', async () => {
  for (const who of [admin, sales, viewer]) assert.ok((await call('GET', `/api/crm/overview?today=${TODAY}`, undefined, who)).json.cards);
  assert.equal((await call('GET', '/api/crm/overview')).status, 401);
  db.exec('ALTER TABLE invoices RENAME TO invoices_away');
  const c = await cards();
  assert.equal(c.unpaidInvoices, null); assert.ok(c.openQuotes && c.winRate && c.expectedClosings, 'the rest are unaffected');
  db.exec('ALTER TABLE invoices_away RENAME TO invoices');
  const bad = await call('GET', '/api/crm/overview?today=garbage', undefined, viewer);
  assert.equal(bad.status, 200, 'a bad day falls back to the server day');
  assert.ok(bad.json.cards.expectedClosings.period);
});

test('THE PAGE: the contacts tile says contacts, organizations and the new cards have their own labels, an unknown card shows a dash and a reason, no status colours or hot/warm/cold words, and no pretend inbox card', () => {
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-overview.html'), 'utf8');
  for (const label of ["'Customer contacts'", "'Customer organizations'", "'Open quotes'", "'Unpaid invoices'", "'Renewals due'", "'Win rate, last '", "'Expected to close '"]) assert.ok(page.includes(label), label);
  assert.match(page, /Not available on this server yet/);
  assert.match(page, /C\.qstr\(\{ today: C\.todayLocal\(\) \}\)/);
  const row = page.slice(page.indexOf('function cardsRow'), page.indexOf('function draw'));
  assert.doesNotMatch(row, /FnCrmStatus|crm-status|\b(hot|warm|cold)\b/i);
  assert.doesNotMatch(page, /Inbox unread|Unread/i, 'the unread card waits for the email phase');
  assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
});
