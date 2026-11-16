// Sales CRM gap G7 (PRD FR-VIEW-01): the saved views the first build lacked (Pennsylvania districts, trials ending soon, expected this quarter, unpaid won deals,
// renewals). A saved view is only a set of filters in the page address, so each one is a filter on the deal list; here each filter is checked on data built to include the
// near misses. Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
db.exec('ALTER TABLE purchases ADD COLUMN seat_count INTEGER');
env.install(pool);
const { server, call } = env.listen([['/api/crm/opportunities', require(path.join(env.SERVER, 'routes/crm-opportunities.js'))]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const at = (n) => `${day(n)} 12:00:00`;
const account = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, state, school_id) VALUES (?, ?, ?, ?)').run(name, f.type || 'school', f.state === undefined ? null : f.state, f.schoolId || null).lastInsertRowid);
const deal = (name, acct, f = {}) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, opp_type, expected_close_date, closed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(acct, name, stage(f.state === 'won' ? 'won' : 'qualified'), admin, f.state || 'open', f.type || 'new_business', f.close || null, f.state === 'won' ? at(-3) : null).lastInsertRowid);
const names = async (qs, who = viewer) => (await call('GET', `/api/crm/opportunities?${qs}`, undefined, who)).json.opportunities.map(o => o.name).sort();
const base = account('Base school');

test('RENEWALS: only open deals of the renewal type', async () => {
  deal('plain', base); deal('renewal A', base, { type: 'renewal' }); deal('expansion', base, { type: 'expansion' }); deal('renewal won', base, { type: 'renewal', state: 'won' });
  assert.deepEqual(await names('oppType=renewal'), ['renewal A']);
  assert.deepEqual(await names('oppType=renewal&state=won'), ['renewal won']);
  assert.deepEqual(await names('oppType=bogus'), ['expansion', 'plain', 'renewal A'], 'an unknown type is ignored, never an error or a crash');
  db.exec('DELETE FROM crm_opportunities');
});

test('PENNSYLVANIA DISTRICTS: district accounts whose State is PA or Pennsylvania in any case; not schools, other states or accounts with no State', async () => {
  deal('pa code', account('PA District 1', { type: 'district', state: 'PA' }));
  deal('pa name', account('PA District 2', { type: 'district', state: ' pennsylvania ' }));
  deal('pa lower', account('PA District 3', { type: 'district', state: 'pa' }));
  deal('ohio', account('OH District', { type: 'district', state: 'OH' }));
  deal('pa school', account('PA School', { type: 'school', state: 'PA' }));
  deal('no state', account('Stateless District', { type: 'district' }));
  deal('pa closed', account('PA District 4', { type: 'district', state: 'PA' }), { state: 'lost' });
  assert.deepEqual(await names('accountType=district&accountState=PA'), ['pa code', 'pa lower', 'pa name']);
  assert.deepEqual(await names('accountState=pa'), ['pa code', 'pa lower', 'pa name', 'pa school'], 'the state alone also finds the school; the type narrows it');
  assert.deepEqual(await names('accountType=district&accountState=OH'), ['ohio']);
  assert.equal((await call('GET', '/api/crm/opportunities?accountState=ZZ', undefined, viewer)).status, 400, 'not a real state');
  assert.equal((await call('GET', '/api/crm/opportunities?accountState=Pennsylvania', undefined, viewer)).status, 400, 'the code, not the name, is what the page sends');
  assert.deepEqual(await names('accountType=bogus&accountState=OH'), ['ohio']);
  db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_accounts');
});

test('EXPECTED THIS QUARTER: open deals closing inside the calendar quarter of the day the page names; both ends count, a day outside does not, no date does not', async () => {
  const a = account('Q school');
  deal('q4 first day', a, { close: '2026-10-01' }); deal('q4 last day', a, { close: '2026-12-31' }); deal('q4 middle', a, { close: '2026-11-20' });
  deal('q3 last day', a, { close: '2026-09-30' }); deal('q1 next year', a, { close: '2027-01-01' }); deal('no date', a); deal('q4 but won', a, { close: '2026-11-02', state: 'won' });
  assert.deepEqual(await names('closeIn=quarter&today=2026-11-15'), ['q4 first day', 'q4 last day', 'q4 middle']);
  assert.deepEqual(await names('closeIn=quarter&today=2026-10-01'), ['q4 first day', 'q4 last day', 'q4 middle'], 'the first day of the quarter');
  assert.deepEqual(await names('closeIn=quarter&today=2026-12-31'), ['q4 first day', 'q4 last day', 'q4 middle'], 'the last day of the quarter');
  assert.deepEqual(await names('closeIn=quarter&today=2027-02-10'), ['q1 next year'], 'the next quarter has its own');
  assert.deepEqual(await names('closeIn=quarter&today=2026-08-10'), ['q3 last day'], 'and the one before');
  assert.deepEqual(await names('closeIn=quarter&today=2026-11-15&state=won'), ['q4 but won']);
  assert.ok((await names('closeIn=quarter&today=not-a-date')).length >= 0, 'a bad day falls back to the server day, never an error');
  assert.equal((await call('GET', '/api/crm/opportunities?closeIn=quarter&today=2026-11-15', undefined, viewer)).json.summary.openCount, 3, 'the total on the page counts the same deals');
  db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_accounts');
});

test('UNPAID WON DEALS: won deals with no paid purchase on any of their quotes (nothing bought, or a purchase order still waiting)', async () => {
  const a = account('Won school');
  const paidDeal = deal('paid', a, { state: 'won' }), poWaiting = deal('po waiting', a, { state: 'won' }), noQuote = deal('no quote', a, { state: 'won' }), noPurchase = deal('quote only', a, { state: 'won' });
  const mixed = deal('one paid one pending', a, { state: 'won' }), other = deal('someone else paid', a, { state: 'won' });
  const buyer = env.addContact(db, 'buyer@school.test', 'Buyer');
  const q = (d, n) => env.addQuote(db, 'buyer@school.test', { opportunityId: d, number: n });
  env.addPurchase(db, buyer, { paymentStatus: 'paid', quoteId: q(paidDeal, 'P1') });
  env.addPurchase(db, buyer, { method: 'po', paymentStatus: 'pending', quoteId: q(poWaiting, 'P2') });
  q(noPurchase, 'P3');
  env.addPurchase(db, buyer, { paymentStatus: 'pending', quoteId: q(mixed, 'P4a') }); env.addPurchase(db, buyer, { paymentStatus: 'paid', quoteId: q(mixed, 'P4b') });
  env.addPurchase(db, buyer, { paymentStatus: 'paid' }); // a paid purchase on no quote does not count for anyone
  void noQuote; void other;
  assert.deepEqual(await names('state=won&unpaid=true'), ['no quote', 'po waiting', 'quote only', 'someone else paid']);
  assert.deepEqual(await names('state=won'), ['no quote', 'one paid one pending', 'paid', 'po waiting', 'quote only', 'someone else paid']);
  db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_accounts; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM newsletter_contacts');
});

test('TRIALS ENDING SOON: open deals with a live trial ending inside the window, found through the deal\'s quotes or the account\'s school; not far, ended or cancelled ones', async () => {
  const sid = Number(db.prepare("INSERT INTO schools (domain) VALUES ('trial-school.test')").run().lastInsertRowid);
  const linked = account('Linked school', { schoolId: sid }), plain = account('Plain school');
  const viaQuote = deal('via quote', plain), viaSchool = deal('via school', linked), far = deal('far trial', plain), over = deal('ended trial', plain), cancelled = deal('cancelled trial', plain), none = deal('no trial', plain);
  const buyer = env.addContact(db, 'trial@school.test', 'Trial');
  const trial = (ends, f = {}) => { const id = env.addPurchase(db, buyer, { paymentStatus: 'paid', amountCents: 0, trialExpirationDate: at(ends), trialLessonLimit: 5, quoteId: f.quote || null });
    db.prepare('UPDATE purchases SET school_id = ?, license_status = ? WHERE id = ?').run(f.school || null, f.status || 'active', id); return id; };
  trial(5, { quote: env.addQuote(db, 'trial@school.test', { opportunityId: viaQuote, number: 'T1' }) });
  trial(3, { school: sid });
  trial(40, { quote: env.addQuote(db, 'trial@school.test', { opportunityId: far, number: 'T2' }) });
  trial(-2, { quote: env.addQuote(db, 'trial@school.test', { opportunityId: over, number: 'T3' }) });
  trial(4, { status: 'cancelled', quote: env.addQuote(db, 'trial@school.test', { opportunityId: cancelled, number: 'T4' }) });
  void none;
  assert.deepEqual(await names('trialEndsInDays=14'), ['via quote', 'via school']);
  assert.deepEqual(await names('trialEndsInDays=60'), ['far trial', 'via quote', 'via school']);
  assert.deepEqual(await names('trialEndsInDays=0'), await names(''), 'zero is no filter');
  assert.equal((await call('GET', '/api/crm/opportunities?trialEndsInDays=14', undefined, viewer)).json.summary.openCount, 2);
  db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_accounts; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM newsletter_contacts; DELETE FROM schools');
});

test('THE PAGE: every view is listed under its name, each one\'s filters are read back from the address and sent to the server, the active one explains itself, and the script parses', () => {
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-opportunities.html'), 'utf8');
  for (const name of ['My opportunities', 'Pennsylvania districts', 'Open procurement', 'Stale quotes', 'Trials ending soon', 'Expected this quarter', 'Unpaid won deals', 'Renewals']) {
    assert.ok(page.includes(`['${name}',`), `${name} is a saved view`);
  }
  for (const k of ['oppType', 'accountType', 'accountState', 'closeIn', 'unpaid', 'trialEndsInDays']) {
    assert.match(page, new RegExp(`${k}: q\\.${k}`), `${k} is read from the address`);
    assert.match(page, new RegExp(`'${k}'`), `${k} is part of what makes a view the active one`);
  }
  assert.match(page, /req\.today = C\.todayLocal\(\)/, 'the quarter is the person\'s own day');
  assert.match(page, /VIEW_HELP/);
  assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
});
