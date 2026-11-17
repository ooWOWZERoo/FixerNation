// Sales CRM phase 7: the six reports, the export, and the hardening checks (docs/reference/sales-crm-update-requirements.md, "Phase 7 spec").
// Every figure is compared with plain SQL over distinct deals and purchases, on data built to trip a join that fans out: a deal with three quote revisions, a
// contact who is in two accounts, a trial purchase, a deal skipped past stages, and a test address. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const reports = require(path.join(env.SERVER, 'lib/crm-reports.js'));
const { server, call } = env.listen([['/api/crm/reports', R('crm-reports.js')], ['/api/crm/opportunities', R('crm-opportunities.js')], ['/api/crm/overview', R('crm-overview.js')]]);
test.after(() => server.close());

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const stage = (key) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', key).id;
const reason = (key) => get('SELECT id FROM crm_loss_reasons WHERE reason_key = ?', key).id;

const acct1 = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Account One')").run().lastInsertRowid);
const acct2 = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Account Two')").run().lastInsertRowid);
const buyer = env.addContact(db, 'buyer@school.test', 'Buyer');
db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(acct1, buyer);
db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(acct2, buyer); // the same person in two accounts
db.prepare('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (1, ?, ?)').run(buyer, 'champion'); // overwritten below once the deals exist

function deal(f) {
  const id = Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, state, amount_cents, source, owner_admin_id, created_at, closed_at, loss_reason_id, stage_entered_at, primary_contact_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.account || acct1, f.name, stage(f.stage), f.state || 'open', f.amount === undefined ? null : f.amount, f.source === undefined ? null : f.source,
    f.owner === undefined ? null : f.owner, f.created, f.closed || null, f.reason ? reason(f.reason) : null, f.entered || f.created + ' 00:00:00', f.primary || null).lastInsertRowid);
  for (const [from, to, fromState, toState, at] of f.history || []) {
    db.prepare('INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, from ? stage(from) : null, stage(to), fromState, toState, at);
  }
  return id;
}
let qn = 700;
const quote = (email, f = {}) => Number(db.prepare(`INSERT INTO quote_requests (quote_number, email, accept_token, opportunity_id, accepted_at, version_status, revision_number, quoted_amount_cents)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(String(qn++), email, `tok${qn}`, f.deal || null, f.accepted || null, f.versionStatus || 'current', f.revision || 1, f.cents === undefined ? 50000 : f.cents).lastInsertRowid);

// October deals (the window) ---------------------------------------------------------------------------------------------------------------
const D1 = deal({ name: 'D1 open', stage: 'qualified', amount: 100000, source: 'Referral', owner: sales, created: '2026-10-05', history: [[null, 'new_inquiry', null, 'open', '2026-10-05 09:00:00'], ['new_inquiry', 'qualified', 'open', 'open', '2026-10-08 09:00:00']] });
const D2 = deal({ name: 'D2 won', stage: 'won', state: 'won', amount: 50000, source: 'Referral', owner: admin, created: '2026-10-10', closed: '2026-10-20 12:00:00', primary: buyer,
  history: [[null, 'new_inquiry', null, 'open', '2026-10-10 09:00:00'], ['new_inquiry', 'discovery', 'open', 'open', '2026-10-12 09:00:00'], ['discovery', 'won', 'open', 'won', '2026-10-20 12:00:00']] });
const D3 = deal({ name: 'D3 lost', stage: 'demo_evaluation', state: 'lost', amount: 20000, source: 'Web', owner: sales, created: '2026-10-12', closed: '2026-10-25 12:00:00', reason: 'no_budget',
  history: [[null, 'new_inquiry', null, 'open', '2026-10-12 09:00:00'], ['new_inquiry', 'demo_evaluation', 'open', 'open', '2026-10-14 09:00:00'], ['demo_evaluation', 'demo_evaluation', 'open', 'lost', '2026-10-25 12:00:00']] });
const D5 = deal({ name: 'D5 inactive', stage: 'new_inquiry', state: 'inactive', source: '  ', created: '2026-10-15', closed: '2026-10-28 12:00:00',
  history: [[null, 'new_inquiry', null, 'open', '2026-10-15 09:00:00'], ['new_inquiry', 'new_inquiry', 'open', 'inactive', '2026-10-28 12:00:00']] });
const D6 = deal({ name: 'D6 test', stage: 'new_inquiry', amount: 999999, source: 'Referral', created: '2026-10-06', history: [[null, 'new_inquiry', null, 'open', '2026-10-06 09:00:00']] });
// Outside the window ------------------------------------------------------------------------------------------------------------------------
const D4 = deal({ name: 'D4 August won', stage: 'won', state: 'won', amount: 70000, source: 'Referral', owner: admin, created: '2026-08-01', closed: '2026-08-30 12:00:00',
  history: [[null, 'new_inquiry', null, 'open', '2026-08-01 09:00:00'], ['new_inquiry', 'won', 'open', 'won', '2026-08-30 12:00:00']] });
const D7 = deal({ name: 'D7 open no value', stage: 'proposal_sent', created: '2026-09-01', history: [[null, 'proposal_sent', null, 'open', '2026-09-01 09:00:00']] });
const D8 = deal({ name: 'D8 won by hand', stage: 'won', state: 'won', amount: 10000, created: '2026-09-02', closed: '2026-09-09 12:00:00', history: [[null, 'new_inquiry', null, 'open', '2026-09-02 09:00:00'], ['new_inquiry', 'won', 'open', 'won', '2026-09-09 12:00:00']] });

// D2 has three quote revisions and one accepted; D6 is a test deal; D1 has a trial purchase that must not count as paid.
const q1 = quote('buyer@school.test', { deal: D2, versionStatus: 'superseded', revision: 1 });
const q2 = quote('buyer@school.test', { deal: D2, versionStatus: 'superseded', revision: 2 });
const q3 = quote('buyer@school.test', { deal: D2, revision: 3, accepted: '2026-10-20 12:00:00' });
const qTest = quote('qa@example.com', { deal: D6 });
quote('t@example.com', { accepted: '2026-10-01 00:00:00' }); // an accepted test-address quote with no purchase: left out of the checks
const qTrial = quote('trial@school.test', { deal: D1 });
const q4 = quote('august@school.test', { deal: D4, accepted: '2026-08-30 12:00:00' }); // accepted, no purchase at all
const qOpen = quote('open@school.test', { deal: D7, accepted: '2026-09-20 12:00:00' }); // accepted but its deal is still open (and no purchase)
const qNoDeal = quote('nodeal@school.test'); // a quote on no deal, with money behind it
void q1; void q2;

const inv = (status) => Number(db.prepare("INSERT INTO invoices (invoice_number, contact_id, status) VALUES (?, ?, ?)").run(`I${qn++}`, buyer, status).lastInsertRowid);
const invPaid = inv('paid');
env.addPurchase(db, buyer, { paymentStatus: 'paid', method: 'po', amountCents: 50000, quoteId: q3, invoiceId: invPaid }); // the one qualifying purchase
env.addPurchase(db, buyer, { paymentStatus: 'paid', method: 'manual', amountCents: 9000, quoteId: qTrial, trialLessonLimit: 3 }); // a trial: never "paid" for these reports
const other = env.addContact(db, 'other@school.test', 'Other');
env.addPurchase(db, other, { paymentStatus: 'paid', method: 'card', amountCents: 30000, quoteId: qNoDeal });
env.addPurchase(db, other, { paymentStatus: 'pending', method: 'po', amountCents: 12000, invoiceId: invPaid }); // invoice says paid, purchase does not
env.addPurchase(db, env.addContact(db, 'qa@example.com', 'QA'), { paymentStatus: 'paid', method: 'card', amountCents: 77777, quoteId: qTest }); // a test address: left out everywhere
const lockedCustomer = env.addContact(db, 'override@school.test', 'Override');
const lapsed = env.addContact(db, 'lapsed@school.test', 'Lapsed');
db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id IN (?, ?)").run(buyer, lapsed);
db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer', classification_locked = 1 WHERE id = ?").run(lockedCustomer);
db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id = ?").run(other); // other has a qualifying purchase (card, 30000)

const OCT = { from: '2026-10-01', to: '2026-10-31' };

// ---- the reports, one at a time, against plain SQL --------------------------------------------------------------------------------------
test('FUNNEL: counts the deals created in the window that reached each stage or a later one, once each, and leaves the test deal out', async () => {
  const f = await reports.runReport(pool, 'funnel', OCT);
  const plain = get("SELECT COUNT(*) n FROM crm_opportunities WHERE created_at >= '2026-10-01' AND created_at <= '2026-10-31 23:59:59' AND id <> ?", D6).n;
  assert.equal(f.total, plain, 'the cohort is every October deal except the test one');
  assert.equal(f.total, 4);
  const reached = Object.fromEntries(f.stages.map(s => [s.key, s.reached]));
  assert.deepEqual(reached, { new_inquiry: 4, qualified: 3, discovery: 2, demo_evaluation: 2, proposal_sent: 1, procurement: 1, verbal_commitment: 1, won: 1 }, 'D2 skipped stages and still counts for each one before Won');
  assert.equal(f.stages[1].conversionFromPrevious, 75);
  assert.equal(f.stages[0].conversionFromPrevious, null);
  assert.deepEqual(f.outcomes, { open: 1, won: 1, lost: 1, inactive: 1 });
  assert.equal(f.windowLabel, '2026-10-01 to 2026-10-31');
});

test('PIPELINE: one row per open deal, weighted by the stage or the override, deals with no value kept apart, test deal left out', async () => {
  const p = await reports.runReport(pool, 'pipeline', OCT);
  const plain = all("SELECT o.amount_cents a, s.default_probability pr FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open' AND o.id <> ?", D6);
  assert.equal(p.totals.deals, plain.length);
  assert.equal(p.totals.grossCents, plain.reduce((s, r) => s + (r.a || 0), 0));
  assert.equal(p.totals.weightedCents, plain.reduce((s, r) => s + Math.round((r.a || 0) * r.pr / 100), 0));
  assert.equal(p.totals.withoutValue, 1, 'D7 has no value and is not read as zero');
  assert.equal(p.totals.grossCents, 100000); assert.equal(p.totals.weightedCents, 15000);
  assert.deepEqual(p.byOwner.map(o => [o.label, o.deals]).sort(), [['Unassigned', 1], ['rep', 1]]);
  assert.match(p.windowLabel, /As of today/);
  db.prepare('UPDATE crm_opportunities SET probability_override = 50 WHERE id = ?').run(D1);
  assert.equal((await reports.runReport(pool, 'pipeline')).totals.weightedCents, 50000, 'an override replaces the stage probability');
  db.prepare('UPDATE crm_opportunities SET probability_override = NULL WHERE id = ?').run(D1);
});

test('WIN AND LOSS: closed in the window, win rate leaves inactive out, days to win and loss reasons', async () => {
  const w = await reports.runReport(pool, 'winloss', OCT);
  assert.deepEqual([w.totals.won, w.totals.lost, w.totals.inactive], [1, 1, 1], 'D4 closed in August and D8 in September are outside');
  assert.equal(w.totals.winRate, 50);
  assert.equal(w.totals.wonCents, 50000); assert.equal(w.totals.lostCents, 20000);
  assert.equal(w.totals.averageWonCents, 50000);
  assert.equal(w.totals.averageDaysToWin, 10.5, '10 Oct to 20 Oct 12:00 is 10.5 days');
  assert.deepEqual(w.lossReasons, [{ label: 'No budget', count: 1 }]);
  const all3 = await reports.runReport(pool, 'winloss', { from: null, to: null });
  assert.equal(all3.totals.won, 3, 'all time: D2, D4 and D8');
  assert.equal(all3.totals.winRate, 75);
});

test('TIME IN STAGE: visits that ended in the window, from the history; a close ends a visit and starts none', async () => {
  const t = await reports.runReport(pool, 'timeinstage', OCT, new Date('2026-11-14T00:00:00Z'));
  const s = Object.fromEntries(t.stages.map(x => [x.key, x]));
  assert.equal(s.new_inquiry.visits, 4, 'D1 3 days, D2 2 days, D3 2 days, D5 13 days (until it was marked inactive)');
  assert.equal(s.new_inquiry.averageDays, 5.0);
  assert.equal(s.new_inquiry.medianDays, 2.5);
  assert.equal(s.discovery.visits, 1); assert.equal(s.discovery.averageDays, 8.1, '12 Oct 09:00 to 20 Oct 12:00');
  assert.equal(s.demo_evaluation.visits, 1);
  assert.equal(s.won.visits, 0, 'a won row ends the visit before it and starts none');
  assert.equal(s.qualified.visits, 0, 'D1 is still in Qualified; an unfinished visit is not counted');
  assert.equal(s.qualified.openNow, 1);
  assert.equal(s.qualified.openNowAverageDays, 40.0, 'D1 entered Qualified on 5 Oct 00:00 (stage_entered_at) and it is 14 Nov: 40 days');
  const empty = await reports.runReport(pool, 'timeinstage', { from: '2020-01-01', to: '2020-01-31' });
  assert.ok(empty.stages.every(x => x.visits === 0 && x.averageDays === null && x.medianDays === null), 'an empty window gives zeros and nulls, not a crash');
});

test('SOURCE TO PAID: a deal with three quote revisions and one purchase is counted once, its money once; a trial never counts as paid', async () => {
  const s = await reports.runReport(pool, 'sourcetopaid', OCT);
  const by = Object.fromEntries(s.sources.map(x => [x.source, x]));
  assert.deepEqual(Object.keys(by).sort(), ['Not recorded', 'Referral', 'Web']);
  assert.equal(by.Referral.deals, 2, 'D1 and D2; the test deal D6 is out');
  assert.equal(by.Referral.won, 1);
  assert.equal(by.Referral.paidDeals, 1, 'D2 only: D1\'s purchase is a trial');
  assert.equal(by.Referral.paidCents, 50000, 'not 150000 from three revisions');
  const plain = get(`SELECT SUM(p.amount_cents) c FROM purchases p JOIN quote_requests q ON q.id = p.quote_id JOIN crm_opportunities o ON o.id = q.opportunity_id
    WHERE p.payment_status = 'paid' AND p.amount_cents > 0 AND p.trial_lesson_limit IS NULL AND p.trial_expiration_date IS NULL AND o.created_at >= '2026-10-01' AND o.created_at <= '2026-10-31 23:59:59' AND o.id <> ?`, D6).c;
  assert.equal(s.totals.paidCents, plain);
  assert.equal(by['Not recorded'].deals, 1, 'a blank or spaces-only source');
  assert.equal(by.Web.paidDeals, 0);
  assert.equal(s.totals.deals, 4);
});

test('RECONCILIATION: each exception is found, counted once and listed by internal id, with test addresses left out', async () => {
  const r = await reports.runReport(pool, 'reconciliation');
  const c = Object.fromEntries(r.checks.map(x => [x.key, x]));
  assert.deepEqual(c.accepted_no_purchase.ids, [q4, qOpen], 'two real quotes; the accepted test-address quote is left out');
  assert.deepEqual(c.won_no_accepted_quote.ids, [D8]);
  assert.deepEqual(c.accepted_deal_open.ids, [D7]);
  assert.equal(c.purchase_quote_no_deal.count, 1, 'the purchase on the quote that is on no deal (the test one is out)');
  assert.equal(c.invoice_purchase_disagree.count, 1);
  assert.deepEqual(c.customer_without_purchase.ids, [lapsed], 'the lapsed Customer is the one nobody can explain; the staff override and the two paid buyers are not exceptions');
  assert.equal(c.paid_not_customer.count, 0);
  assert.equal(r.allClear, false);
  for (const k of ['accepted_no_purchase', 'won_no_accepted_quote', 'accepted_deal_open', 'purchase_quote_no_deal', 'invoice_purchase_disagree']) assert.equal(c[k].count, c[k].ids.length, `${k}: the count is the number of distinct rows`);
  assert.ok(r.checks.every(x => x.ids.length <= 20));
  // Fix every exception and it goes green.
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'suspect' WHERE id = ?").run(lapsed);
  const after = await reports.runReport(pool, 'reconciliation');
  assert.equal(after.checks.find(x => x.key === 'customer_without_purchase').ok, true);
  // The other direction: a paid buyer who is not labeled Customer is an exception too.
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(other);
  assert.deepEqual((await reports.runReport(pool, 'reconciliation')).checks.find(x => x.key === 'paid_not_customer').ids, [other]);
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id IN (?, ?)").run(other, lapsed);
});

test('WINDOW EDGES: the first and last second of a day belong to that day, one day is a valid window, and an empty database returns zeros and nulls', async () => {
  const edge1 = deal({ name: 'first second', stage: 'new_inquiry', created: '2026-12-01', history: [[null, 'new_inquiry', null, 'open', '2026-12-01 00:00:00']] });
  db.prepare("UPDATE crm_opportunities SET created_at = '2026-12-01 00:00:00' WHERE id = ?").run(edge1);
  const edge2 = deal({ name: 'last second', stage: 'new_inquiry', created: '2026-12-01', history: [[null, 'new_inquiry', null, 'open', '2026-12-01 23:59:59']] });
  db.prepare("UPDATE crm_opportunities SET created_at = '2026-12-01 23:59:59' WHERE id = ?").run(edge2);
  const next = deal({ name: 'next day', stage: 'new_inquiry', created: '2026-12-02', history: [[null, 'new_inquiry', null, 'open', '2026-12-02 00:00:00']] });
  db.prepare("UPDATE crm_opportunities SET created_at = '2026-12-02 00:00:00' WHERE id = ?").run(next);
  assert.equal((await reports.runReport(pool, 'funnel', { from: '2026-12-01', to: '2026-12-01' })).total, 2);
  assert.equal((await reports.runReport(pool, 'funnel', { from: '2026-12-02', to: '2026-12-02' })).total, 1);
  assert.equal((await reports.runReport(pool, 'funnel', { from: '2026-12-03', to: null })).total, 0);
  db.prepare('DELETE FROM crm_opportunity_stage_history WHERE opportunity_id IN (?, ?, ?)').run(edge1, edge2, next);
  db.prepare('DELETE FROM crm_opportunities WHERE id IN (?, ?, ?)').run(edge1, edge2, next);

  const bare = env.makeDb();
  for (const k of reports.KEYS) {
    const rep = await reports.runReport(bare.pool, k, { from: '2026-01-01', to: '2026-01-31' });
    assert.ok(rep.definition && rep.windowLabel && rep.table.header.length, `${k} carries its definition, window and export table`);
    assert.doesNotMatch(JSON.stringify(rep), /NaN|Infinity/, k);
  }
  const f = await reports.runReport(bare.pool, 'funnel', { from: null, to: null });
  assert.equal(f.total, 0); assert.ok(f.stages.every(s => s.reached === 0 && s.shareOfAll === null && s.conversionFromPrevious === null));
  const w = await reports.runReport(bare.pool, 'winloss', { from: null, to: null });
  assert.equal(w.totals.winRate, null); assert.equal(w.totals.averageWonCents, null);
});

// ---- the routes -------------------------------------------------------------------------------------------------------------------
test('ROUTES: every role with a CRM role sees the numbers; signed out is 401; the Hub off is 404; bad dates are 400; an unknown report is 404', async () => {
  for (const who of [admin, sales, viewer]) {
    const r = await call('GET', '/api/crm/reports?from=2026-10-01&to=2026-10-31', undefined, who);
    assert.equal(r.status, 200, `role ${who}`);
    assert.deepEqual(r.json.reports.map(x => x.key), reports.KEYS);
    assert.equal(r.json.window.from, '2026-10-01');
  }
  assert.equal((await call('GET', '/api/crm/reports')).status, 401);
  const def = await call('GET', '/api/crm/reports', undefined, viewer);
  assert.equal(def.json.window.to.length, 10, 'with no dates it is the last 90 days');
  assert.equal(Math.round((Date.parse(def.json.window.to) - Date.parse(def.json.window.from)) / 86400000), 89);
  assert.equal((await call('GET', '/api/crm/reports?range=all', undefined, viewer)).json.window.from, null);
  assert.equal((await call('GET', '/api/crm/reports?from=2026-13-01', undefined, viewer)).status, 400);
  assert.equal((await call('GET', '/api/crm/reports?from=2026-10-31&to=2026-10-01', undefined, viewer)).status, 400);
  assert.equal((await call('GET', '/api/crm/reports/nope', undefined, viewer)).status, 404);
  assert.equal((await call('GET', '/api/crm/reports/funnel?from=2026-10-01&to=2026-10-31', undefined, viewer)).json.total, 4);
  env.enable(db, false);
  assert.equal((await call('GET', '/api/crm/reports', undefined, admin)).status, 404);
  assert.equal((await call('GET', '/api/crm/reports/pipeline/export', undefined, admin)).status, 404);
  env.enable(db, true);
});

async function csv(key, who, query = 'from=2026-10-01&to=2026-10-31') {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const headers = who ? { 'x-admin': String(who) } : {};
    http.get({ port, path: `/api/crm/reports/${key}/export?${query}`, headers }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], disposition: res.headers['content-disposition'], body: b })); }).on('error', reject);
  });
}

test('EXPORT: CRM Admin only, audited with the report and window and no figures, summary numbers only', async () => {
  for (const who of [sales, viewer]) assert.equal((await csv('pipeline', who)).status, 403, 'Sales and Read-only are refused');
  assert.equal((await csv('pipeline', null)).status, 401);
  assert.equal((await csv('nope', admin)).status, 404);
  assert.equal((await csv('funnel', admin, 'from=bad')).status, 400);
  assert.equal(all("SELECT id FROM school_audit_log WHERE action = 'crm_report_exported'").length, 0, 'refusals and bad requests write nothing');

  const names = ['Account One', 'Account Two', 'D1 open', 'D2 won', 'D3 lost', 'Buyer', 'buyer@school.test', 'other@school.test', 'example.com'];
  for (const key of reports.KEYS) {
    const r = await csv(key, admin);
    assert.equal(r.status, 200, key);
    assert.match(r.type, /text\/csv/);
    assert.match(r.disposition, new RegExp(`crm-${key}-2026-10-01_to_2026-10-31\\.csv`));
    for (const n of names) assert.ok(!r.body.includes(n), `${key} export must not hold "${n}"`);
    assert.match(r.body, /How this is counted/, 'the definition travels with the numbers');
    assert.match(r.body, /Window:/);
  }
  const rows = all("SELECT actor_type, entity_type, entity_id, purchase_id, school_domain, new_value, action FROM school_audit_log WHERE action = 'crm_report_exported' ORDER BY id");
  assert.equal(rows.length, reports.KEYS.length, 'one row per export');
  assert.ok(rows.every(x => x.actor_type === 'admin_user' && x.entity_type === 'crm_report' && x.purchase_id === null && x.school_domain === null));
  assert.deepEqual(JSON.parse(rows[0].new_value), { report: 'funnel', from: '2026-10-01', to: '2026-10-31' });
  assert.ok(!rows.some(x => /\d{4,}/.test(x.new_value.replace(/\d{4}-\d{2}-\d{2}/g, ''))), 'no figures in the audit row');
  const all2 = await csv('winloss', admin, 'range=all');
  assert.match(all2.disposition, /crm-winloss-all-time\.csv/);
});

test('EXPORT: a source that starts with = + - or @ cannot run as a spreadsheet formula, and a long one is cut to 64 characters', async () => {
  const evil = deal({ name: 'formula', stage: 'new_inquiry', source: '=HYPERLINK("http://x.test","click")', created: '2026-10-20', history: [[null, 'new_inquiry', null, 'open', '2026-10-20 09:00:00']] });
  const long = deal({ name: 'long', stage: 'new_inquiry', source: '+' + 'x'.repeat(100), created: '2026-10-21', history: [[null, 'new_inquiry', null, 'open', '2026-10-21 09:00:00']] });
  const r = await csv('sourcetopaid', admin);
  // G10: the same source now shows in two tables (the "Typed by staff:" line in the first, the plain typed Source in the second); the plain one must be defused.
  const lines = r.body.split('\r\n').filter(l => l.includes('HYPERLINK'));
  assert.equal(lines.length, 2);
  assert.ok(lines.some(l => l.startsWith('"\'=HYPERLINK')), lines.join(' | '));
  assert.ok(!r.body.split('\r\n').some(l => /^[=+@]/.test(l)), 'no line starts with a formula character');
  assert.equal(reports.csvCell('-5'), '-5', 'a plain negative number is left alone');
  assert.equal(reports.csvCell('@x'), "'@x");
  const src = (await reports.runReport(pool, 'sourcetopaid', OCT)).sources.find(x => x.source.startsWith('+'));
  assert.equal(src.source.length, 64);
  for (const id of [evil, long]) { db.prepare('DELETE FROM crm_opportunity_stage_history WHERE opportunity_id = ?').run(id); db.prepare('DELETE FROM crm_opportunities WHERE id = ?').run(id); }
});

test('SOURCE RULES: reports only read; money is only from qualifying purchases; no score or hot, warm, cold wording', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const f of ['lib/crm-reports.js', 'routes/crm-reports.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b|\bALTER TABLE\b/i, `${f} writes nothing (the one audit row goes through crmAudit)`);
    assert.doesNotMatch(src, /\b(hot|warm|cold)\b\s*(lead|label|prospect|contact|deal)|'(hot|warm|cold)'/i, f);
    assert.doesNotMatch(src, /\bscore\b/i, `${f} has no score`);
  }
  assert.match(read('lib/crm-reports.js'), /QUALIFYING_SQL/);
  assert.doesNotMatch(read('lib/crm-reports.js'), /SUM\(\s*q\.|SUM\(\s*o\.amount_cents[^)]*\)\s+AS\s+paid/i, 'paid money never comes from a quote or a deal value');
});

test('B2: the Overview leaves test-address deals out of every deal figure, exactly as the Reports do', async () => {
  db.prepare("UPDATE crm_opportunities SET next_step_due_at = '2026-01-01 00:00:00' WHERE id = ?").run(D6); // the test deal is overdue as well
  const o = await call('GET', '/api/crm/overview', undefined, admin);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const p = await reports.runReport(pool, 'pipeline');
  assert.equal(o.json.pipeline.openCount, p.totals.deals, 'the same open deals as the weighted pipeline report');
  assert.equal(o.json.pipeline.grossCents, p.totals.grossCents, 'D6 (999999) is not in the gross');
  assert.equal(o.json.pipeline.openWithoutValue, p.totals.withoutValue);
  const ids = (list) => list.items.map(i => i.id);
  assert.ok(!ids(o.json.nextSteps.missing).includes(D6) && !ids(o.json.nextSteps.overdue).includes(D6), 'the test deal is on neither list');
  assert.equal(o.json.nextSteps.missing.total, ids(o.json.nextSteps.missing).length, 'the count matches the list (no hidden test rows)');
  const plainMissing = get(`SELECT COUNT(*) n FROM crm_opportunities o WHERE o.state = 'open' AND (o.next_step IS NULL OR o.next_step = '') AND o.id <> ?`, D6).n;
  assert.equal(o.json.nextSteps.missing.total, plainMissing);
});

test('B3: Source to paid also shows every qualifying paid purchase by purchase date, split into on a deal and on no deal, so a direct card sale is not zero', async () => {
  // A card sale straight from the site: no quote at all. The default purchase date in the test schema is 2026-01-01.
  const direct = env.addPurchase(db, other, { paymentStatus: 'paid', method: 'card', amountCents: 20000 });
  const JAN = { from: '2026-01-01', to: '2026-01-01' };
  const s = await reports.runReport(pool, 'sourcetopaid', JAN);
  // In January: the PO purchase on D2's quote (50000), the card purchase on a quote with no deal (30000) and the direct one (20000). The trial, the pending one and the test address do not count.
  assert.deepEqual(s.purchases, { count: 3, cents: 100000, onDealCount: 1, onDealCents: 50000, otherCount: 2, otherCents: 50000 });
  const plain = get(`SELECT COUNT(*) n, SUM(p.amount_cents) c FROM purchases p JOIN newsletter_contacts c ON c.id = p.contact_id
    WHERE p.payment_status = 'paid' AND p.amount_cents > 0 AND p.trial_lesson_limit IS NULL AND p.trial_expiration_date IS NULL AND LOWER(c.email) NOT LIKE '%@example.com'
    AND p.purchased_at >= '2026-01-01 00:00:00' AND p.purchased_at <= '2026-01-01 23:59:59'`);
  assert.equal(s.purchases.count, plain.n); assert.equal(s.purchases.cents, plain.c);
  assert.ok(s.table.rows.some(r => /not on any deal/.test(r[0]) && r[6] === '500.00'), 'the table and the CSV carry the direct-sale line');
  assert.match(s.definition, /by the day it was bought/);
  const feb = await reports.runReport(pool, 'sourcetopaid', { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(feb.purchases.count, 0, 'outside the window it is zero');
  db.prepare('DELETE FROM purchases WHERE id = ?').run(direct);
});

test('B4: a report can be limited to one deal type; every type is counted otherwise, the mix is shown, and a bad type is refused', async () => {
  const R9 = deal({ name: 'R9 renewal', stage: 'qualified', amount: 40000, source: 'Referral', owner: sales, created: '2026-10-18', history: [[null, 'new_inquiry', null, 'open', '2026-10-18 09:00:00'], ['new_inquiry', 'qualified', 'open', 'open', '2026-10-19 09:00:00']] });
  db.prepare("UPDATE crm_opportunities SET opp_type = 'renewal' WHERE id = ?").run(R9);
  try {
    const all_ = await reports.runReport(pool, 'funnel', OCT);
    const renewals = await reports.runReport(pool, 'funnel', { ...OCT, type: 'renewal' });
    const newBiz = await reports.runReport(pool, 'funnel', { ...OCT, type: 'new_business' });
    assert.equal(renewals.total, 1, 'only the renewal');
    assert.equal(newBiz.total, all_.total - 1, 'new business is everything else (all were new business before)');
    assert.equal(all_.byType.find(t => t.key === 'renewal').deals, 1);
    assert.equal(all_.byType.find(t => t.key === 'new_business').deals, all_.total - 1);
    assert.match(renewals.windowLabel, /Deal type: Renewals/); assert.doesNotMatch(all_.windowLabel, /Deal type/, 'with every type counted the label is unchanged');
    assert.ok(all_.table.rows.some(r => r[0] === 'Created in the window: Renewals' && r[1] === 1));

    const pAll = await reports.runReport(pool, 'pipeline'), pRen = await reports.runReport(pool, 'pipeline', { type: 'renewal' }), pNew = await reports.runReport(pool, 'pipeline', { type: 'new_business' });
    assert.equal(pRen.totals.deals, 1); assert.equal(pRen.totals.grossCents, 40000);
    assert.equal(pNew.totals.deals + pRen.totals.deals, pAll.totals.deals, 'the two together are every open deal');
    assert.equal(pNew.totals.grossCents + pRen.totals.grossCents, pAll.totals.grossCents);

    const wl = await reports.runReport(pool, 'winloss', { ...OCT, type: 'renewal' });
    assert.equal(wl.totals.won + wl.totals.lost + wl.totals.inactive, 0, 'the renewal is still open, so no closed renewals');
    const sp = await reports.runReport(pool, 'sourcetopaid', { ...OCT, type: 'renewal' });
    assert.equal(sp.purchases, null, 'purchases have no deal type, so those lines are left out');
    assert.ok(!sp.table.rows.some(r => /paid purchases bought/.test(r[0])));

    const ok = await call('GET', '/api/crm/reports/funnel?range=all&type=renewal', undefined, viewer);
    assert.equal(ok.status, 200); assert.equal(ok.json.total, 1);
    assert.equal((await call('GET', '/api/crm/reports?range=all&type=bogus', undefined, viewer)).status, 400);
    assert.equal((await call('GET', '/api/crm/reports?range=all&type=all', undefined, viewer)).status, 200);
    const exported = await csv('funnel', admin, 'range=all&type=renewal');
    assert.equal(exported.status, 200);
    assert.match(String(exported.body), /Deal type: Renewals/, 'the CSV says which type was counted');
    const audit = all("SELECT new_value FROM school_audit_log WHERE action = 'crm_report_exported' ORDER BY id DESC LIMIT 1")[0];
    assert.match(audit.new_value, /renewal/, 'the audit row says which type was exported');
  } finally {
    db.prepare('DELETE FROM crm_opportunity_stage_history WHERE opportunity_id = ?').run(R9);
    db.prepare('DELETE FROM crm_opportunities WHERE id = ?').run(R9);
  }
});
