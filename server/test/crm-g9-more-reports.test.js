// Sales CRM gap G9 (PRD FR-REP-02 and FR-OPP-07): the eight reports the first build lacked (pipeline mix, forecast by month, sale velocity, quote conversion, trial to paid,
// procurement blockers, coverage, renewals and expansions). Every figure is compared with a hand-worked number on data built to include the near misses (a test address, a
// replaced quote, a deal outside the dates, a closed deal). Real SQL on node:sqlite. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
env.install(pool);
const R = require(path.join(env.SERVER, 'lib/crm-reports.js'));
const NOW = new Date('2026-11-15T12:00:00Z');
const TODAY = '2026-11-15';
const run = (key, win = { from: null, to: null }) => R.runReport(pool, key, win, NOW);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);
const at = (n) => `${day(n)} 12:00:00`;
const wipe = (...t) => db.exec(t.map(x => `DELETE FROM ${x};`).join(' '));
const admin = env.addAdmin(db, 'owner', 'admin'), rep = env.addAdmin(db, 'rep', 'sales');
const acct = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, state, school_id) VALUES (?, ?, ?, ?)').run(name, f.type || 'school', f.state === undefined ? null : f.state, f.schoolId || null).lastInsertRowid);
const deal = (name, f = {}) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, opp_type, amount_cents, source, product_focus, expected_close_date, next_step, next_step_due_at, created_at, closed_at, renewal_of_purchase_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.account || acct(`acct ${name}`, f.acct), name, stage(f.stage || (f.state === 'won' ? 'won' : 'qualified')), f.owner === undefined ? rep : f.owner, f.state || 'open', f.type || 'new_business',
  f.amount === undefined ? null : f.amount, f.source === undefined ? null : f.source, f.product === undefined ? null : f.product, f.close || null, f.nextStep === undefined ? 'Call' : f.nextStep, f.due || null, f.created || at(-60), f.closedAt || null, f.renewalOf || null).lastInsertRowid);
const rowOf = (report, label) => report.table.rows.find(r => r[0] === label || r[1] === label);

// ---- pipeline mix --------------------------------------------------------------------------------------------------------------------
test('PIPELINE MIX: each grouping adds up to the same open deals; State matches code or name in any case; free text is merged case-insensitively; weighted uses the stage\'s chance', async () => {
  deal('a', { amount: 100000, product: 'Annual license', source: 'Referral', acct: { state: 'PA', type: 'district' } });
  deal('b', { amount: 50000, product: 'annual license ', source: ' referral', acct: { state: ' pennsylvania ' } });
  deal('c', { amount: 20000, product: 'Pilot', source: 'Web', acct: { state: 'OH' } });
  deal('d', { product: '', source: '', acct: { state: '' } });
  deal('e', { amount: 7000, acct: { state: 'Narnia' } });
  deal('won', { state: 'won', amount: 999999, acct: { state: 'PA' } }); deal('lost', { state: 'lost', amount: 999999 });
  const t = deal('test', { amount: 999999, acct: { state: 'PA' } }); env.addQuote(db, 'qa@example.com', { opportunityId: t, number: 'QT' });
  const r = await run('pipelinemix');
  assert.deepEqual(r.totals, { deals: 5, withoutValue: 1 });
  for (const g of Object.values(r.groups)) assert.equal(g.reduce((s, x) => s + x.deals, 0), 5, 'every grouping covers each open deal exactly once');
  const state = Object.fromEntries(r.groups.state.map(g => [g.label, g]));
  assert.equal(state.Pennsylvania.deals, 2); assert.equal(state.Pennsylvania.grossCents, 150000); assert.equal(state.Pennsylvania.weightedCents, 22500, '15% at Qualified');
  assert.equal(state.Ohio.deals, 1); assert.equal(state['State not set'].deals, 1); assert.equal(state['Narnia (not a state we recognise)'].deals, 1);
  const product = Object.fromEntries(r.groups.product.map(g => [g.label, g.deals]));
  assert.equal(product['Annual license'], 2, '"annual license " merges with "Annual license"'); assert.equal(product['Product not set'], 2);
  assert.deepEqual(r.groups.accountType.map(g => [g.label, g.deals]).sort(), [['District', 1], ['School', 4]]);
  assert.equal(Object.fromEntries(r.groups.source.map(g => [g.label, g.deals])).Referral, 2);
  assert.equal(r.table.rows.length, Object.values(r.groups).reduce((s, g) => s + g.length, 0));
  assert.ok(r.table.rows.every(row => row.length === r.table.header.length));
  const renewalsOnly = await run('pipelinemix', { from: null, to: null, type: 'renewal' });
  assert.equal(renewalsOnly.totals.deals, 0, 'the deal type filter applies');
  wipe('crm_opportunities', 'crm_accounts', 'quote_requests');
});

// ---- forecast ----------------------------------------------------------------------------------------------------------------------------
test('FORECAST: open deals by expected close month, with passed, far and undated lines, and an average that counts only deals with a value', async () => {
  deal('nov', { amount: 100000, close: '2026-11-20' }); deal('dec A', { amount: 50000, close: '2026-12-01' }); deal('dec B', { close: '2026-12-31' }); deal('passed', { amount: 30000, close: '2026-11-14' });
  deal('today', { amount: 10000, close: '2026-11-15' }); deal('far', { amount: 5000, close: '2028-01-01' }); deal('undated', { amount: 5000 }); deal('won', { state: 'won', amount: 999999, close: '2026-11-20' });
  const r = await run('forecast');
  const L = Object.fromEntries(r.lines.map(l => [l.label, l]));
  assert.equal(L['Expected date has passed'].deals, 1); assert.equal(L['Expected date has passed'].grossCents, 30000);
  assert.equal(L['November 2026'].deals, 2, 'today counts as November, not passed'); assert.equal(L['November 2026'].grossCents, 110000);
  assert.equal(L['December 2026'].deals, 2); assert.equal(L['December 2026'].valued, 1); assert.equal(L['December 2026'].grossCents, 50000);
  assert.equal(L['More than 12 months away'].deals, 1); assert.equal(L['No expected date'].deals, 1);
  assert.equal(r.lines.length, 15, 'passed + 12 months + later + none');
  assert.deepEqual({ ...r.totals }, { deals: 7, withoutValue: 1, grossCents: 200000, weightedCents: 30000, averageOpenCents: 33333 });
  assert.equal(r.lines.reduce((s, l) => s + l.deals, 0), r.totals.deals, 'every open deal is on exactly one line');
  assert.equal(rowOf(r, 'Average open deal size ($)')[3], '333.33');
  wipe('crm_opportunities', 'crm_accounts');
});

// ---- velocity -----------------------------------------------------------------------------------------------------------------------------
test('SALE VELOCITY: open deals x win rate x average won value / days to win, with every ingredient shown; unknown (never zero) when one is missing', async () => {
  const none = await run('velocity');
  assert.equal(none.perDayCents, null); assert.ok(none.unknownBecause.length >= 3); assert.equal(rowOf(none, 'Sale velocity ($ per day)')[1], 'Unknown'); assert.ok(rowOf(none, 'Unknown because'));
  for (let i = 0; i < 4; i++) deal(`open ${i}`, { amount: 10000 });
  deal('open no value');
  const won = (n, amount, created, closed) => deal(n, { state: 'won', amount, created: at(created), closedAt: at(closed) });
  won('w1', 10000, -95, -85); won('w2', 20000, -100, -80); won('w3', 30000, -105, -75); deal('lost', { state: 'lost', created: at(-50), closedAt: at(-40) });
  won('too old', 1000000, -400, -380);
  const v = await run('velocity', { from: day(-89), to: TODAY });
  assert.deepEqual(v.inputs, { openDeals: 4, winRate: 75, won: 3, lost: 1, averageWonCents: 20000, averageDaysToWin: 20 });
  assert.equal(v.perDayCents, 3000, '4 x 0.75 x 20000 / 20'); assert.equal(v.perThirtyDaysCents, 90000);
  assert.deepEqual(v.unknownBecause, []);
  assert.equal(rowOf(v, 'Sale velocity ($ per day)')[1], '30.00');
  const noWon = await run('velocity', { from: day(-39), to: day(-30) });
  assert.equal(noWon.perDayCents, null);
  wipe('crm_opportunities', 'crm_accounts');
});

// ---- quote conversion --------------------------------------------------------------------------------------------------------------------
test('QUOTE CONVERSION: the latest revision of each quote sent in the dates; accepted, accepted and paid, waiting and closed, with days to accept; replaced, draft, test and out-of-window quotes left out', async () => {
  const buyer = env.addContact(db, 'q-buyer@school.test', 'Q');
  const q = (n, f = {}) => { const id = env.addQuote(db, f.email || 'q-buyer@school.test', { number: n, sentAt: f.sent === undefined ? at(-20) : f.sent, status: f.status || 'contacted' });
    if (f.accepted) db.prepare('UPDATE quote_requests SET accepted_at = ? WHERE id = ?').run(f.accepted, id);
    if (f.superseded) db.prepare("UPDATE quote_requests SET version_status = 'superseded' WHERE id = ?").run(id);
    if (f.until) db.prepare('UPDATE quote_requests SET quote_valid_until = ? WHERE id = ?').run(f.until, id);
    return id; };
  const paidQ = q('P', { accepted: at(-18), status: 'converted' }), poQ = q('O', { accepted: at(-10), status: 'converted' });
  q('W', { until: day(20) }); q('L', { until: day(-3) }); q('C', { status: 'closed' });
  q('R', { superseded: true }); q('D', { sent: null }); q('T', { email: 'qa@example.com' }); q('OLD', { sent: at(-200) });
  env.addPurchase(db, buyer, { paymentStatus: 'paid', amountCents: 50000, quoteId: paidQ }); env.addPurchase(db, buyer, { method: 'po', paymentStatus: 'pending', amountCents: 50000, quoteId: poQ });
  const r = await run('quoteconversion', { from: day(-89), to: TODAY });
  assert.deepEqual({ sent: r.totals.sent, accepted: r.totals.accepted, paid: r.totals.paid, waiting: r.totals.waiting, lapsed: r.totals.lapsed }, { sent: 5, accepted: 2, paid: 1, waiting: 1, lapsed: 2 });
  assert.equal(r.totals.averageDaysToAccept, 6, '(2 + 10) / 2 days'); assert.equal(r.totals.medianDaysToAccept, 6);
  assert.deepEqual(rowOf(r, 'Accepted and paid').slice(1), [1, 20]);
  assert.equal((await run('quoteconversion', { from: day(-250), to: day(-150) })).totals.sent, 1, 'the old quote has its own window');
  assert.equal(rowOf(await run('quoteconversion', { from: day(-5), to: TODAY }), 'Average days from sent to accepted')[1], 'Unknown');
  wipe('quote_requests', 'purchases', 'newsletter_contacts');
});

// ---- trial to paid -------------------------------------------------------------------------------------------------------------------------
test('TRIAL TO PAID: trials started in the dates and whether the same person, or someone at the same school, bought afterwards; running, ended and test trials sorted out', async () => {
  const c = (e) => env.addContact(db, e, 'T');
  const a = c('a@school.test'), b = c('b@school.test'), b2 = c('b2@school.test'), run1 = c('run@school.test'), ended = c('ended@school.test'), early = c('early@school.test'), qa = c('qa-trial@example.com'), old = c('old@school.test');
  const trial = (contact, started, ends, school) => { const id = env.addPurchase(db, contact, { paymentStatus: 'paid', amountCents: 0, trialExpirationDate: ends, trialLessonLimit: 5 }); db.prepare('UPDATE purchases SET purchased_at = ?, school_id = ? WHERE id = ?').run(started, school || null, id); return id; };
  const paid = (contact, when, school) => { const id = env.addPurchase(db, contact, { paymentStatus: 'paid', amountCents: 90000 }); db.prepare('UPDATE purchases SET purchased_at = ?, school_id = ? WHERE id = ?').run(when, school || null, id); return id; };
  trial(a, at(-40), at(-30)); paid(a, at(-30));                        // bought 10 days later
  trial(b, at(-40), at(-30), 77); paid(b2, at(-20), 77);               // a colleague at the same school bought 20 days later
  trial(run1, at(-3), at(10));                                         // still running
  trial(ended, at(-50), at(-35));                                      // ended, nothing bought
  trial(early, at(-40), at(-30)); paid(early, at(-45));                // bought BEFORE the trial: not a conversion
  trial(qa, at(-40), at(-30)); trial(old, at(-300), at(-290)); paid(old, at(-280));
  const r = await run('trialtopaid', { from: day(-89), to: TODAY });
  assert.deepEqual({ started: r.totals.started, converted: r.totals.converted, stillRunning: r.totals.stillRunning, endedWithoutBuying: r.totals.endedWithoutBuying }, { started: 5, converted: 2, stillRunning: 1, endedWithoutBuying: 2 });
  assert.equal(r.totals.conversionRate, 40); assert.equal(r.totals.averageDaysToBuy, 15, '(10 + 20) / 2'); assert.equal(r.totals.medianDaysToBuy, 15);
  assert.equal((await run('trialtopaid', { from: day(-320), to: day(-250) })).totals.converted, 1);
  assert.equal((await run('trialtopaid', { from: day(1), to: day(2) })).totals.conversionRate, null, 'no trials is "no rate", not 0%');
  assert.doesNotMatch(JSON.stringify(r), /@school\.test/, 'nobody is named');
  wipe('purchases', 'newsletter_contacts');
});

// ---- procurement ---------------------------------------------------------------------------------------------------------------------------
test('PROCUREMENT BLOCKERS: open checklist steps on open deals grouped by step, with overdue counts and the deals waiting; closed deals and done steps left out; Procurement-stage deals with no checklist counted', async () => {
  const ps = (name) => deal(name, { stage: 'procurement' });
  const d1 = ps('p1'), d2 = ps('p2'), d3 = ps('p3 no checklist'), closed = deal('closed', { state: 'lost' });
  const item = (d, label, due, status = 'open') => db.prepare('INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, status, due_on) VALUES (?, ?, ?, ?)').run(d, label, status, due);
  item(d1, 'W-9', day(-5)); item(d2, 'W-9', day(5)); item(d1, 'COI', null); item(d2, 'w-9 ', day(-1)); item(d1, 'Board approval', day(-2), 'done'); item(closed, 'W-9', day(-9));
  const r = await run('procurement');
  assert.deepEqual(r.steps.map(s => [s.label, s.open, s.overdue, s.deals]), [['W-9', 3, 2, 2], ['COI', 1, 0, 1]], 'W-9 and "w-9 " are one step; most overdue first');
  assert.deepEqual({ ...r.totals }, { openItems: 4, overdueItems: 2, dealsInProcurementStage: 3, procurementDealsWithoutChecklist: 1 });
  void d3;
  assert.ok(r.table.rows.every(row => row.length === r.table.header.length));
  wipe('crm_opportunity_checklist_items', 'crm_opportunities', 'crm_accounts');
});

// ---- coverage ---------------------------------------------------------------------------------------------------------------------------------
test('COVERAGE: by owner, how many open deals have a next step, how many next steps are overdue, and how many were worked (a note or a finished task) in the quiet-days window', async () => {
  const a1 = deal('a1', { owner: rep, nextStep: 'Call', due: `${day(-3)} 12:00:00` }), a2 = deal('a2', { owner: rep, nextStep: '' }), a3 = deal('a3', { owner: rep, nextStep: 'Email', due: `${day(4)} 12:00:00` });
  const b1 = deal('b1', { owner: admin, nextStep: 'Visit' }), u1 = deal('u1', { owner: null, nextStep: null });
  db.prepare("INSERT INTO crm_notes (opportunity_id, body, created_at) VALUES (?, 'x', ?)").run(a1, at(-3));
  db.prepare("INSERT INTO crm_notes (opportunity_id, body, created_at) VALUES (?, 'old', ?)").run(a2, at(-40));
  db.prepare("INSERT INTO crm_tasks (opportunity_id, title, state, completed_at) VALUES (?, 't', 'done', ?)").run(b1, at(-5));
  void a3; void u1;
  const r = await run('coverage');
  const O = Object.fromEntries(r.owners.map(o => [o.owner, o]));
  assert.deepEqual([O.rep.deals, O.rep.withNextStep, O.rep.overdue, O.rep.active], [3, 2, 1, 1]);
  assert.deepEqual([O.owner.deals, O.owner.withNextStep, O.owner.overdue, O.owner.active], [1, 1, 0, 1]);
  assert.deepEqual([O.Unassigned.deals, O.Unassigned.withNextStep, O.Unassigned.active], [1, 0, 0]);
  assert.deepEqual([O['All owners'].deals, O['All owners'].withNextStep, O['All owners'].overdue, O['All owners'].active], [5, 3, 1, 2]);
  assert.equal(O['All owners'].withNextStepPct, 60); assert.equal(r.owners[r.owners.length - 1].owner, 'All owners', 'the total line comes last');
  assert.equal(r.owners.filter(o => o.owner === 'All owners').length, 1);
  assert.equal(r.quietDays, 14);
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('crm_attn_quiet_days', '3')").run();
  const tight = await run('coverage');
  assert.equal(tight.quietDays, 3); assert.equal(tight.owners.find(o => o.owner === 'All owners').active, 1, 'with a 3-day window only the 3-day-old note counts, not the 5-day-old finished task');
  db.exec("DELETE FROM settings WHERE setting_key = 'crm_attn_quiet_days'");
  wipe('crm_notes', 'crm_tasks', 'crm_opportunities', 'crm_accounts');
});

// ---- renewals ----------------------------------------------------------------------------------------------------------------------------------
test('RENEWALS AND EXPANSIONS: deal outcomes by type for deals created in the dates, and the share of ended paid licenses followed by a later license; short add-ons, trials and test buyers do not count', async () => {
  deal('r open', { type: 'renewal', created: at(-30) }); deal('r won', { type: 'renewal', state: 'won', amount: 40000, created: at(-30), closedAt: at(-5), renewalOf: 1 });
  deal('r won no value', { type: 'renewal', state: 'won', created: at(-30), closedAt: at(-5) }); deal('r lost', { type: 'renewal', state: 'lost', created: at(-30), closedAt: at(-5) });
  deal('x open', { type: 'expansion', created: at(-30) }); deal('x won', { type: 'expansion', state: 'won', amount: 15000, created: at(-30), closedAt: at(-5) });
  deal('old renewal', { type: 'renewal', created: at(-300) }); deal('plain', { type: 'new_business', created: at(-30) });
  const buyer = env.addContact(db, 'ren@school.test', 'R'), qa = env.addContact(db, 'qa-ren@example.com', 'QA');
  const lic = (sid, ends, f = {}) => { const id = env.addPurchase(db, f.buyer || buyer, { paymentStatus: 'paid', amountCents: 500000, trialLessonLimit: f.trial ? 3 : undefined }); db.prepare("UPDATE purchases SET product_type = 'group_license', school_id = ?, school_domain = ?, expiration_date = ?, seat_count = 10 WHERE id = ?").run(sid, `s${sid}.test`, ends, id); return id; };
  db.exec("INSERT INTO schools (id, domain) VALUES (1, 's1.test'), (2, 's2.test'), (3, 's3.test'), (4, 's4.test'), (5, 's5.test'), (6, 's6.test')");
  lic(1, day(-30)); lic(1, day(300));                 // ended, renewed by a license that runs a year
  lic(2, day(-30)); lic(2, day(-10));                 // ended, followed only by a seat add-on that ends 20 days later: NOT renewed (and the add-on itself ended too)
  lic(3, day(-30), { trial: true });                  // a trial: not a paid license
  lic(4, day(20));                                    // still running, ends in the window
  lic(5, day(-30), { buyer: qa });                    // a test buyer
  lic(6, day(-300));                                  // ended long before the window
  const r = await run('renewals', { from: day(-89), to: day(30) });
  assert.deepEqual({ created: r.renewal.created, open: r.renewal.open, won: r.renewal.won, closedOther: r.renewal.closedOther, wonCents: r.renewal.wonCents, wonWithoutValue: r.renewal.wonWithoutValue, fromALicense: r.renewal.madeFromALicense }, { created: 4, open: 1, won: 2, closedOther: 1, wonCents: 40000, wonWithoutValue: 1, fromALicense: 1 });
  assert.deepEqual({ created: r.expansion.created, won: r.expansion.won, wonCents: r.expansion.wonCents }, { created: 2, won: 1, wonCents: 15000 });
  assert.deepEqual({ ...r.licenses }, { endedInWindow: 3, renewed: 1, stillRunning: 1, renewalRate: 33.3 });
  assert.equal(rowOf(r, 'License renewal rate (%)')[1], 33.3);
  assert.ok(r.table.rows.every(row => row.length === r.table.header.length));
  const none = await run('renewals', { from: day(1), to: day(2) });
  assert.equal(rowOf(none, 'License renewal rate (%)')[1], 'Unknown', 'no ended licenses is unknown, not 0%');
  wipe('purchases', 'crm_opportunities', 'crm_accounts', 'schools', 'newsletter_contacts');
});

// ---- the rules that must not erode -----------------------------------------------------------------------------------------------------
test('HARD RULES: the new reports only read, use no hot/warm/cold wording, carry a definition and a window label, and their exports hold labels and numbers, never a name, an address or an id', async () => {
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-reports-more.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/, 'read only');
  assert.doesNotMatch(src, /\b(hot|warm|cold)\b/i);
  assert.doesNotMatch(src, /NOW\(\)|ON DUPLICATE/);
  // Data with names in it, then every new report exported.
  deal('Secret Deal Name', { amount: 12345, acct: { state: 'PA' } });
  env.addContact(db, 'private.person@school.test', 'Private Person');
  assert.deepEqual(R.KEYS.slice(-8), ['pipelinemix', 'forecast', 'velocity', 'quoteconversion', 'trialtopaid', 'procurement', 'coverage', 'renewals']);
  for (const key of R.KEYS.slice(-8)) {
    const report = await run(key);
    assert.ok(report.definition.length > 80, `${key} explains how it counts`); assert.ok(report.windowLabel, `${key} says over which dates`);
    const csv = R.toCsv(report);
    assert.doesNotMatch(csv, /Secret Deal Name|private\.person|Private Person|@school\.test/, `${key} export names nobody`);
    assert.ok(report.table.rows.every(row => row.length === report.table.header.length), `${key} rows are as wide as the header`);
  }
  wipe('crm_opportunities', 'crm_accounts', 'newsletter_contacts');
});

test('THE PAGE: every report is drawn, in reading order, and the dates note names which ones ignore the dates', () => {
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-reports.html'), 'utf8');
  for (const k of R.KEYS.filter(x => !['funnel', 'pipeline', 'reconciliation'].includes(x))) assert.ok(page.includes(`'${k}'`), `${k} is drawn`);
  assert.match(page, /Deal type does not apply to Renewals and expansions or Trial to paid/);
  assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
});
