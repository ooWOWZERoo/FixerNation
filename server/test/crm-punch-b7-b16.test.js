// Sales CRM punch list B7, B8, B10, B11, B12, B13, B14 and B16 (docs/reference/sales-crm-punch-list.md, section C). B9 and B15 have their own files.
// Real routes and real SQL (node:sqlite) from test/helpers/crm-env.js. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER)");
db.exec(`CREATE TABLE program_use_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, school_year_start INTEGER NOT NULL, month TEXT NOT NULL, school_id INTEGER NOT NULL, district_id INTEGER,
  teachers_licensed INTEGER NOT NULL, teachers_activated INTEGER NOT NULL, teachers_teaching INTEGER NOT NULL, teachers_teaching_ytd INTEGER NOT NULL DEFAULT 0, classrooms INTEGER NOT NULL,
  classrooms_active INTEGER NOT NULL, classrooms_regular INTEGER NOT NULL DEFAULT 0, students_enrolled INTEGER NOT NULL, students_active INTEGER NOT NULL, students_active_ytd INTEGER NOT NULL DEFAULT 0,
  activities INTEGER NOT NULL, source TEXT DEFAULT 'monthly', created_at TEXT DEFAULT '2026-11-01 04:15:00', UNIQUE (school_year_start, month, school_id))`);
db.exec('CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER, kind TEXT, detail TEXT, invitation_id INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const reports = require(path.join(env.SERVER, 'lib/crm-reports.js'));
const attention = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const engagement = require(path.join(env.SERVER, 'lib/crm-engagement.js'));
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));
const hooks = require(path.join(env.SERVER, 'lib/crm-hooks.js'));
const { server, call } = env.listen([
  ['/api/crm/opportunities', R('crm-opportunities.js')], ['/api/crm/contacts', R('crm-contacts.js')], ['/api/crm/attention', R('crm-attention.js')], ['/api/crm/tasks', R('crm-tasks.js')],
]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const stageId = (key) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', key).id;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Test District')").run().lastInsertRowid);
const mkDeal = (f = {}) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, next_step, stage_entered_at, closed_at, amount_cents, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.account || acct, f.name || 'Deal', stageId(f.stage || 'qualified'), f.owner === undefined ? sales : f.owner, f.state || 'open',
  f.nextStep === undefined ? 'Call them' : f.nextStep, f.entered || `${day(-1)} 12:00:00`, f.closed || null, f.amount === undefined ? null : f.amount, f.created || '2026-10-05 09:00:00').lastInsertRowid);
const hist = (deal, rows) => { for (const [from, to, fs_, ts, at] of rows) db.prepare('INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(deal, from ? stageId(from) : null, stageId(to), fs_, ts, at); };

// ---- B8: the funnel -------------------------------------------------------------------------------------------------------------------
test('B8: a Won deal that was reopened no longer counts as having reached Won, but keeps the earlier stages it passed through', async () => {
  const stillWon = mkDeal({ name: 'B8 won', stage: 'won', state: 'won', closed: '2026-10-20 12:00:00' });
  hist(stillWon, [[null, 'new_inquiry', null, 'open', '2026-10-05 09:00:00'], ['new_inquiry', 'won', 'open', 'won', '2026-10-20 12:00:00']]);
  const reopened = mkDeal({ name: 'B8 reopened', stage: 'proposal_sent' });
  hist(reopened, [[null, 'new_inquiry', null, 'open', '2026-10-05 09:00:00'], ['new_inquiry', 'qualified', 'open', 'open', '2026-10-06 09:00:00'], ['qualified', 'won', 'open', 'won', '2026-10-10 09:00:00'], ['won', 'proposal_sent', 'won', 'open', '2026-10-12 09:00:00']]);
  const fresh = mkDeal({ name: 'B8 fresh', stage: 'new_inquiry' });
  hist(fresh, [[null, 'new_inquiry', null, 'open', '2026-10-05 09:00:00']]);
  const f = await reports.runReport(pool, 'funnel', { from: '2026-10-01', to: '2026-10-31' });
  const reached = Object.fromEntries(f.stages.map(s => [s.key, s.reached]));
  assert.equal(f.total, 3);
  assert.equal(reached.won, 1, 'only the deal that is Won now');
  assert.equal(reached.won, f.outcomes.won, 'the Won row equals "Now won"');
  assert.equal(reached.proposal_sent, 2, 'the reopened deal still reached Proposal');
  assert.equal(reached.discovery, 2, 'the won deal skipped past it and still counts');
  assert.equal(reached.qualified, 2);
  assert.equal(reached.new_inquiry, 3);
  assert.match(f.definition, /reopened deal keeps the earlier stages/);
  db.prepare('DELETE FROM crm_opportunities WHERE id IN (?, ?, ?)').run(stillWon, reopened, fresh);
});

// ---- B10: the Overview boxes ----------------------------------------------------------------------------------------------------------
test('B10: the Overview tasks and Needs Attention can include what nobody owns, and a Read-only login can read both without an owner filter', async () => {
  const mine = mkDeal({ name: 'B10 mine', owner: sales, nextStep: null });
  const theirs = mkDeal({ name: 'B10 theirs', owner: admin, nextStep: null });
  const nobody = mkDeal({ name: 'B10 nobody', owner: null, nextStep: null });
  const names = (r) => r.json.items.filter(i => i.ruleKey === 'no_next_step').map(i => i.title).sort();
  const me = await call('GET', `/api/crm/attention?owner=me&today=${TODAY}&pageSize=100`, undefined, sales);
  assert.deepEqual(names(me), ['B10 mine'], 'owner=me shows only mine, as before');
  const both = await call('GET', `/api/crm/attention?owner=me_or_none&today=${TODAY}&pageSize=100`, undefined, sales);
  assert.deepEqual(names(both), ['B10 mine', 'B10 nobody'], 'mine and unowned, never someone else\'s');
  const readonly = await call('GET', `/api/crm/attention?today=${TODAY}&pageSize=100`, undefined, viewer);
  assert.equal(readonly.status, 200);
  assert.deepEqual(names(readonly), ['B10 mine', 'B10 nobody', 'B10 theirs'], 'a Read-only login sees everyone\'s');

  const task = (title, assignee) => db.prepare("INSERT INTO crm_tasks (opportunity_id, title, due_on, state, assigned_admin_id) VALUES (?, ?, ?, 'open', ?)").run(mine, title, day(-1), assignee);
  task('mine', sales); task('unassigned', null); task('theirs', admin);
  const titles = (r) => r.json.tasks.map(t => t.title).sort();
  assert.deepEqual(titles(await call('GET', `/api/crm/tasks?assignee=me&due=upto&days=0&today=${TODAY}`, undefined, sales)), ['mine']);
  assert.deepEqual(titles(await call('GET', `/api/crm/tasks?assignee=me_or_none&due=upto&days=0&today=${TODAY}`, undefined, sales)), ['mine', 'unassigned']);
  assert.deepEqual(titles(await call('GET', `/api/crm/tasks?due=upto&days=0&today=${TODAY}`, undefined, viewer)), ['mine', 'theirs', 'unassigned']);

  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-overview.html'), 'utf8');
  assert.match(page, /C\.role === 'readonly'/, 'the page chooses the team view for Read-only');
  assert.match(page, /me_or_none/);
  assert.doesNotMatch(page, /owner: 'me'/);
  db.prepare('DELETE FROM crm_opportunities WHERE id IN (?, ?, ?)').run(mine, theirs, nobody);
  db.exec('DELETE FROM crm_tasks');
});

// ---- B11: who made a Prospect ---------------------------------------------------------------------------------------------------------
test('B11: a quote a staff member makes promotes the contact with that person and a reason on the history; the route passes both', async () => {
  const c = env.addContact(db, 'newlead@school.test', 'New Lead');
  env.addQuote(db, 'newlead@school.test', { contactId: c, number: 'B11-1' });
  await hooks.contactChangedByEmail('newlead@school.test', { actorAdminId: sales, reason: 'A staff member made a quote for this contact' });
  const ev = get("SELECT * FROM crm_classification_events WHERE contact_id = ? AND to_classification = 'prospect'", c);
  assert.ok(ev, 'a history row was written');
  assert.equal(ev.actor_admin_id, sales);
  assert.match(ev.reason, /staff member made a quote/);
  const route = fs.readFileSync(path.join(env.SERVER, 'routes/contact.js'), 'utf8');
  assert.match(route, /contactChangedByEmail\(trimmedEmail, \{ actorAdminId: req\.user\.userId, reason:/, 'the staff quote route passes who and why');
  assert.match(route, /contactChangedByEmail\(email\);/, 'the public form still passes nobody (the person asked for the quote themselves)');
});

// ---- B12: Needs Attention ------------------------------------------------------------------------------------------------------------
test('B12: "Won, but no purchase yet" skips deals with no quote at all (phone deals, generated renewals) and still lists a quoted deal with no purchase', async () => {
  const phone = mkDeal({ name: 'B12 phone', state: 'won', stage: 'won', closed: `${day(-10)} 12:00:00` });
  const renewal = mkDeal({ name: 'B12 renewal', state: 'won', stage: 'won', closed: `${day(-10)} 12:00:00` });
  db.prepare("UPDATE crm_opportunities SET opp_type = 'renewal' WHERE id = ?").run(renewal);
  const quoted = mkDeal({ name: 'B12 quoted', state: 'won', stage: 'won', closed: `${day(-10)} 12:00:00` });
  env.addQuote(db, 'b12@school.test', { opportunityId: quoted, number: 'B12-1' });
  const items = (await attention.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === 'won_no_purchase').map(i => i.title);
  assert.deepEqual(items, ['B12 quoted']);
  assert.match(attention.RULES.won_no_purchase.help, /no quote at all/);
  db.prepare('DELETE FROM crm_opportunities WHERE id IN (?, ?, ?)').run(phone, renewal, quoted);
  db.exec('DELETE FROM quote_requests');
});

test('B12: a rule with more items than the list holds says so, with the true number, instead of showing a cut-off list as the whole list', async () => {
  const stage = stageId('qualified');
  const ins = db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, next_step, stage_entered_at) VALUES (?, ?, ?, ?, 'open', '', ?)");
  const total = attention.PER_RULE_LIMIT + 5;
  for (let i = 0; i < total; i++) ins.run(acct, `Bulk ${i}`, stage, sales, `${day(-1)} 12:00:00`);
  const caps = {};
  const items = await attention.evaluate(pool, { today: TODAY, caps });
  assert.equal(items.filter(i => i.ruleKey === 'no_next_step').length, attention.PER_RULE_LIMIT, 'the list itself is still capped');
  assert.equal(caps.no_next_step, total, 'the true number is reported');
  assert.equal(caps.next_step_overdue, undefined, 'a rule under the cap reports nothing');
  const r = await call('GET', `/api/crm/attention?today=${TODAY}&pageSize=5`, undefined, viewer);
  assert.equal(r.json.cappedRules.no_next_step, total);
  assert.equal(r.json.cap, attention.PER_RULE_LIMIT);
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-attention.html'), 'utf8');
  assert.match(page, /cappedRules/);
  db.prepare("DELETE FROM crm_opportunities WHERE name LIKE 'Bulk %'").run();
});

// ---- B13: the engagement card --------------------------------------------------------------------------------------------------------
test('B13: student numbers under 10 are hidden one by one: 10 enrolled with 1 active shows the 10 but not the 1', async () => {
  const sid = Number(db.prepare("INSERT INTO schools (domain) VALUES ('b13.example.com')").run().lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO crm_accounts (name, school_id) VALUES ('B13 School', ?)").run(sid).lastInsertRowid);
  const snap = db.prepare(`INSERT INTO program_use_snapshots (school_year_start, month, school_id, teachers_licensed, teachers_activated, teachers_teaching, classrooms, classrooms_active, students_enrolled, students_active, activities)
    VALUES (2026, ?, ?, 5, 4, 3, 2, 2, ?, ?, 10)`);
  snap.run('2026-10', sid, 10, 1);
  let card = await engagement.engagementFor(pool, 'account', a, { today: TODAY });
  let m = card.programUse.months[0];
  assert.equal(m.studentsEnrolled.value, 10);
  assert.equal(m.studentsActive.value, null);
  assert.equal(m.studentsActive.kind, 'small');
  assert.match(m.studentsActive.unknownReason, /Fewer than 10 students were active/);
  db.exec('DELETE FROM program_use_snapshots');
  snap.run('2026-10', sid, 6, 6);
  card = await engagement.engagementFor(pool, 'account', a, { today: TODAY });
  m = card.programUse.months[0];
  assert.equal(m.studentsEnrolled.value, null); assert.equal(m.studentsActive.value, null);
  assert.match(m.studentsEnrolled.unknownReason, /Fewer than 10 students are enrolled/);
  db.exec('DELETE FROM program_use_snapshots');
  snap.run('2026-10', sid, 40, 25);
  card = await engagement.engagementFor(pool, 'account', a, { today: TODAY });
  assert.equal(card.programUse.months[0].studentsActive.value, 25, 'a large group is shown in full');
});

test('B13: an account does not show another school\'s purchases just because a member contact also bought for that school', async () => {
  const s1 = Number(db.prepare("INSERT INTO schools (domain) VALUES ('b13-one.example.com')").run().lastInsertRowid);
  const s2 = Number(db.prepare("INSERT INTO schools (domain) VALUES ('b13-two.example.com')").run().lastInsertRowid);
  const a1 = Number(db.prepare("INSERT INTO crm_accounts (name, school_id) VALUES ('Account One', ?)").run(s1).lastInsertRowid);
  const a2 = Number(db.prepare("INSERT INTO crm_accounts (name, school_id) VALUES ('Account Two', ?)").run(s2).lastInsertRowid);
  const person = env.addContact(db, 'both@b13.test', 'Both');
  db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(a1, person);
  db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(a2, person);
  const mk = (school) => Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_status, amount_cents, school_id, seat_count, expiration_date) VALUES (?, 'group_license', 'paid', 1000, ?, 10, '2027-06-30')").run(person, school).lastInsertRowid);
  const p1 = mk(s1), p2 = mk(s2), p0 = Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_status, amount_cents) VALUES (?, 'single_license', 'paid', 100)").run(person).lastInsertRowid);
  const ids = async (acc) => (await engagement.engagementFor(pool, 'account', acc, { today: TODAY })).licenses.items.map(i => i.purchaseId).sort((x, y) => x - y);
  assert.deepEqual(await ids(a1), [p0, p1].sort((x, y) => x - y), 'the school-one account shows its own and the school-less one, not school two\'s');
  assert.deepEqual(await ids(a2), [p0, p2].sort((x, y) => x - y));
});

// ---- B14: scale ----------------------------------------------------------------------------------------------------------------------
test('B14: the nightly candidate list finds contacts by purchase, quote link, quote email (any case, stray spaces) and Customer, and nobody else', async () => {
  db.exec('DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM newsletter_contacts;');
  const byPurchase = env.addContact(db, 'p@b14.test'); env.addPurchase(db, byPurchase);
  const byLink = env.addContact(db, 'l@b14.test'); env.addQuote(db, 'other-address@b14.test', { contactId: byLink, number: 'B14-1' });
  const byMail = env.addContact(db, 'Mail@B14.test'); env.addQuote(db, '  mail@b14.test ', { number: 'B14-2' });
  const asCustomer = env.addContact(db, 'c@b14.test'); db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id = ?").run(asCustomer);
  env.addContact(db, 'nobody@b14.test');
  assert.deepEqual(await cls.candidateContactIds(pool), [byPurchase, byLink, byMail, asCustomer].sort((x, y) => x - y));
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-classification.js'), 'utf8');
  assert.doesNotMatch(src.slice(src.indexOf('async function candidateContactIds'), src.indexOf('async function reconcileAll')), /JOIN quote_requests q ON q\.contact_id = c\.id OR/, 'the unindexable OR join is gone');
});

test('B14: the duplicate review groups once, pages from that, reads only the shown contacts in full, and sees a new contact straight away', async () => {
  db.exec('DELETE FROM newsletter_contacts;');
  const a = env.addContact(db, 'sam+one@b14.test', 'Sam Rivers'); const b = env.addContact(db, 'sam@b14.test', 'Sam R.');
  const c = env.addContact(db, 'pat@b14.test', 'Pat Morgan'); const d = env.addContact(db, 'pat.m@other14.test', 'Pat Morgan');
  env.addContact(db, 'unique@b14.test', 'Only One');
  const first = await call('GET', '/api/crm/contacts/review/duplicates?pageSize=1', undefined, viewer);
  assert.equal(first.json.total, 2);
  assert.equal(first.json.groups.length, 1);
  const second = await call('GET', '/api/crm/contacts/review/duplicates?pageSize=1&page=2', undefined, viewer);
  const ids = [...first.json.groups, ...second.json.groups].map(g => g.contacts.map(x => x.id).sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(ids, [[a, b], [c, d]]);
  assert.ok(first.json.groups[0].contacts[0].company !== undefined && first.json.groups[0].contacts[0].classification, 'the page still carries the full fields');
  env.addContact(db, 'sam+two@b14.test', 'Someone Else'); // a new contact: the count changes, so the cached grouping is not reused
  const third = await call('GET', '/api/crm/contacts/review/duplicates?pageSize=10', undefined, viewer);
  assert.ok(third.json.groups.some(g => g.contacts.length === 3), 'the new person joins the same-mailbox group');
});

// ---- B16: editing a deal --------------------------------------------------------------------------------------------------------------
test('B16: an edit is refused when the deal changed since the page loaded, and when the deal moved or closed between read and write; the page sends the version it saw', async () => {
  const deal = mkDeal({ name: 'B16 deal', stage: 'qualified', owner: sales });
  const seen = (await call('GET', `/api/crm/opportunities/${deal}`, undefined, sales)).json.opportunity.updatedAt;
  const ok = await call('PUT', `/api/crm/opportunities/${deal}`, { source: 'Referral', expectedUpdatedAt: seen }, sales);
  assert.equal(ok.status, 200);
  db.prepare("UPDATE crm_opportunities SET updated_at = '2030-01-01 00:00:00' WHERE id = ?").run(deal); // someone else saved
  const stale = await call('PUT', `/api/crm/opportunities/${deal}`, { source: 'Web', expectedUpdatedAt: seen }, sales);
  assert.equal(stale.status, 409); assert.equal(stale.json.code, 'changed');
  assert.equal(get('SELECT source FROM crm_opportunities WHERE id = ?', deal).source, 'Referral', 'nothing was written');
  const noToken = await call('PUT', `/api/crm/opportunities/${deal}`, { source: 'Web' }, sales);
  assert.equal(noToken.status, 200, 'a caller that sends no version still works (the script and old pages)');
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-opportunity.html'), 'utf8');
  assert.equal((page.match(/expectedUpdatedAt/g) || []).length, 2, 'both edit dialogs send the version they saw');
  db.prepare('DELETE FROM crm_opportunities WHERE id = ?').run(deal);
});

test('B16: the next step cannot be blanked on an open deal past Qualified unless a reason is given; earlier stages and closed deals are free', async () => {
  const late = mkDeal({ name: 'B16 late', stage: 'proposal_sent', owner: sales, nextStep: 'Send the quote' });
  const blank = await call('PUT', `/api/crm/opportunities/${late}`, { nextStep: null }, sales);
  assert.equal(blank.status, 409); assert.equal(blank.json.code, 'next_step_required');
  assert.equal(get('SELECT next_step FROM crm_opportunities WHERE id = ?', late).next_step, 'Send the quote');
  assert.equal((await call('PUT', `/api/crm/opportunities/${late}`, { nextStep: '' }, sales)).status, 409, 'an empty string is the same as blank');
  assert.equal((await call('PUT', `/api/crm/opportunities/${late}`, { nextStep: 'Phone the buyer' }, sales)).status, 200, 'changing it is fine');
  const why = await call('PUT', `/api/crm/opportunities/${late}`, { nextStep: null, overrideReason: 'Waiting on the board vote' }, sales);
  assert.equal(why.status, 200);
  const audit = get("SELECT reason FROM school_audit_log WHERE action = 'crm_opportunity_updated' AND entity_id = ? ORDER BY id DESC", late);
  assert.match(audit.reason, /Waiting on the board vote/, 'the reason is on the audit row');
  const early = mkDeal({ name: 'B16 early', stage: 'qualified', owner: sales, nextStep: 'x' });
  assert.equal((await call('PUT', `/api/crm/opportunities/${early}`, { nextStep: null }, sales)).status, 200);
  const closed = mkDeal({ name: 'B16 closed', stage: 'won', state: 'won', owner: sales, nextStep: 'x', closed: `${day(-1)} 00:00:00` });
  assert.equal((await call('PUT', `/api/crm/opportunities/${closed}`, { nextStep: null }, sales)).status, 200);
});

// ---- B7: more than one accepted quote, and a re-priced quote ------------------------------------------------------------------------
test('B7: a revision that changes the price moves the deal value, but only while the value is still the old price', async () => {
  const d1 = mkDeal({ name: 'B7 untouched', amount: 50000 });
  const q1 = env.addQuote(db, 'b7@school.test', { opportunityId: d1, number: 'B7-1', amountCents: 50000 });
  const q2 = env.addQuote(db, 'b7@school.test', { opportunityId: d1, number: 'B7-2', amountCents: 42000 });
  await hooks.quotePriceChanged(q2, 50000, { actorAdminId: sales });
  assert.equal(get('SELECT amount_cents a FROM crm_opportunities WHERE id = ?', d1).a, 42000, 'the value followed the new price');
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_opportunity_updated' AND entity_id = ? ORDER BY id DESC", d1);
  assert.deepEqual(JSON.parse(row.prev_value), { amount_cents: 50000 }); assert.deepEqual(JSON.parse(row.new_value), { amount_cents: 42000 });

  const d2 = mkDeal({ name: 'B7 typed', amount: 65000 }); // staff typed their own forecast
  const q3 = env.addQuote(db, 'b7b@school.test', { opportunityId: d2, number: 'B7-3', amountCents: 42000 });
  await hooks.quotePriceChanged(q3, 50000);
  assert.equal(get('SELECT amount_cents a FROM crm_opportunities WHERE id = ?', d2).a, 65000, 'a typed value is never overwritten');
  const d3 = mkDeal({ name: 'B7 empty' });
  const q4 = env.addQuote(db, 'b7c@school.test', { opportunityId: d3, number: 'B7-4', amountCents: 42000 });
  await hooks.quotePriceChanged(q4, 50000);
  assert.equal(get('SELECT amount_cents a FROM crm_opportunities WHERE id = ?', d3).a, null, 'a deal with no value is left empty');
  const d4 = mkDeal({ name: 'B7 closed', amount: 50000, state: 'lost', closed: `${day(-1)} 00:00:00` });
  const q5 = env.addQuote(db, 'b7d@school.test', { opportunityId: d4, number: 'B7-5', amountCents: 42000 });
  await hooks.quotePriceChanged(q5, 50000);
  assert.equal(get('SELECT amount_cents a FROM crm_opportunities WHERE id = ?', d4).a, 50000, 'a closed deal is left as it was');
  void q1;
  const route = fs.readFileSync(path.join(env.SERVER, 'routes/contact.js'), 'utf8');
  assert.match(route, /crmHooks\.quotePriceChanged\(quote\.id, replaced\.quoted_amount_cents/, 'sending a revision follows the price');
  assert.match(route, /crmHooks\.quotePriceChanged\(Number\(req\.params\.id\), existing\[0\]\.quoted_amount_cents/, 'so does re-pricing a sent quote');
});

test('B7: a second accepted quote on one deal is allowed, written to the audit log, and the deal value covers both only if nobody typed their own', async () => {
  const d = mkDeal({ name: 'B7 two quotes', amount: 50000 });
  const first = env.addQuote(db, 'two@school.test', { opportunityId: d, number: 'B7-A', amountCents: 50000 });
  const second = env.addQuote(db, 'two@school.test', { opportunityId: d, number: 'B7-B', amountCents: 20000 });
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-01 10:00:00' WHERE id = ?").run(first);
  await hooks.quoteAccepted(first, 'po', 'buyer');
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', d).state, 'won');
  assert.equal(get("SELECT COUNT(*) n FROM school_audit_log WHERE action = 'crm_opportunity_more_quotes_accepted'").n, 0, 'one accepted quote is the normal case');
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-02 10:00:00' WHERE id = ?").run(second);
  await hooks.quoteAccepted(second, 'card', 'buyer');
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', d).state, 'won', 'still Won, once');
  assert.equal(get('SELECT amount_cents a FROM crm_opportunities WHERE id = ?', d).a, 70000, 'the value now covers both');
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_opportunity_more_quotes_accepted' AND entity_id = ?", d);
  assert.deepEqual(JSON.parse(row.new_value), { acceptedQuotes: 2, quoteId: second, valueFollowed: true });

  const typed = mkDeal({ name: 'B7 typed value', amount: 99000 });
  const a = env.addQuote(db, 'typed@school.test', { opportunityId: typed, number: 'B7-C', amountCents: 50000 });
  const b = env.addQuote(db, 'typed@school.test', { opportunityId: typed, number: 'B7-D', amountCents: 20000 });
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-01 10:00:00' WHERE id IN (?, ?)").run(a, b);
  await hooks.quoteAccepted(a, 'po', 'buyer');
  await hooks.quoteAccepted(b, 'po', 'buyer');
  assert.equal(get('SELECT amount_cents a FROM crm_opportunities WHERE id = ?', typed).a, 99000, 'a typed value is left for staff');
  assert.deepEqual(JSON.parse(get("SELECT new_value FROM school_audit_log WHERE action = 'crm_opportunity_more_quotes_accepted' AND entity_id = ?", typed).new_value).valueFollowed, false);

  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-opportunity.html'), 'utf8');
  assert.match(page, /quotes on this deal were accepted/, 'the deal page shows the notice');
});
