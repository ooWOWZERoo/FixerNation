// Sales CRM routes: the off switch, the role matrix, accounts, contacts and deals (routes/crm-*.js, lib/crm-permissions.js).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const perms = require(path.join(env.SERVER, 'lib/crm-permissions.js'));
const { server, call } = env.listen([
  ['/api/crm/accounts', require(path.join(env.SERVER, 'routes/crm-accounts.js'))],
  ['/api/crm/contacts', require(path.join(env.SERVER, 'routes/crm-contacts.js'))],
  ['/api/crm/opportunities', require(path.join(env.SERVER, 'routes/crm-opportunities.js'))],
  ['/api/crm', require(path.join(env.SERVER, 'routes/crm-settings.js'))],
]);
test.after(() => server.close());

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const sales2 = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const noRole = env.addAdmin(db, 'odd', 'bogus');

async function newAccount(name = 'Acme Schools', as = admin) {
  const r = await call('POST', '/api/crm/accounts', { name, accountType: 'district' }, as);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}
async function newDeal(accountId, body = {}, as = admin) {
  const r = await call('POST', '/api/crm/opportunities', { accountId, name: 'Deal', ...body }, as);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}
const audits = () => db.prepare('SELECT * FROM school_audit_log ORDER BY id').all();

test('OFF SWITCH: while crm_v2_enabled is not true, every CRM route answers 404', async () => {
  for (const [m, p] of [['GET', '/api/crm/me'], ['GET', '/api/crm/stages'], ['GET', '/api/crm/accounts'], ['GET', '/api/crm/contacts'], ['GET', '/api/crm/opportunities'], ['POST', '/api/crm/accounts']]) {
    const r = await call(m, p, m === 'POST' ? { name: 'x' } : undefined, admin);
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  env.enable(db, true);
  assert.equal((await call('GET', '/api/crm/me', undefined, admin)).status, 200);
});

test('SIGNED OUT: no admin cookie, no CRM, even with the switch on', async () => {
  assert.equal((await call('GET', '/api/crm/accounts')).status, 401);
});

test('ROLE MATRIX: every action is allowed for exactly the roles the matrix says', () => {
  const want = {
    view: ['admin', 'sales', 'readonly'], write: ['admin', 'sales'], edit_deal: ['admin', 'sales'], promote_prospect: ['admin', 'sales'],
    reopen_deal: ['admin'], set_customer: ['admin'], override_probability: ['admin'], edit_settings: ['admin'], merge: ['admin'], assign_roles: ['admin'], audit_view: ['admin'], export: ['admin'], erase: ['admin'], files: ['admin', 'sales'], accept_for_customer: ['admin'], edit_quote_price: ['admin'], raise_refund: ['admin', 'sales'], decide_refund: ['admin'],
  };
  assert.deepEqual(Object.keys(perms.ALLOWED).sort(), Object.keys(want).sort(), 'no action is missing from the matrix, none extra');
  for (const [action, roles] of Object.entries(want)) {
    for (const role of perms.ROLES) assert.equal(perms.can(role, action), roles.includes(role), `${role} / ${action}`);
  }
  assert.equal(perms.can('anything-else', 'view'), false);
  assert.throws(() => perms.requireCrm('not_an_action'));
});

test('READ-ONLY: can look, cannot change anything', async () => {
  const acct = await newAccount('Look Only');
  assert.equal((await call('GET', `/api/crm/accounts/${acct}`, undefined, viewer)).status, 200);
  assert.equal((await call('GET', '/api/crm/opportunities', undefined, viewer)).status, 200);
  for (const [m, p, b] of [['POST', '/api/crm/accounts', { name: 'Nope' }], ['PUT', `/api/crm/accounts/${acct}`, { name: 'Nope' }], ['POST', '/api/crm/opportunities', { accountId: acct, name: 'Nope' }],
    ['POST', `/api/crm/accounts/${acct}/contacts`, { contactId: 1 }], ['PUT', '/api/crm/contacts/1', { assignedAdminId: null }]]) {
    assert.equal((await call(m, p, b, viewer)).status, 403, `${m} ${p}`);
  }
});

test('NO ROLE: an admin whose role is not one of the three is refused everywhere', async () => {
  assert.equal((await call('GET', '/api/crm/accounts', undefined, noRole)).status, 403);
});

test('SALES: cannot edit settings, assign roles, reopen deals, override Customer or reach archive', async () => {
  const acct = await newAccount('Sales Limits');
  const deal = await newDeal(acct, {}, sales);
  await call('POST', `/api/crm/opportunities/${deal}/close`, { outcome: 'inactive' }, sales);
  assert.equal((await call('PUT', '/api/crm/stages/1', { defaultProbability: 99 }, sales)).status, 403);
  assert.equal((await call('POST', '/api/crm/loss-reasons', { key: 'x_y', label: 'X' }, sales)).status, 403);
  assert.equal((await call('PUT', `/api/crm/staff/${sales}/role`, { role: 'admin' }, sales)).status, 403);
  assert.equal((await call('POST', `/api/crm/opportunities/${deal}/reopen`, { reason: 'because' }, sales)).status, 403);
  const c = env.addContact(db, 'someone@sales-limits.example.org');
  assert.equal((await call('POST', `/api/crm/contacts/${c}/customer-override`, { reason: 'r', evidence: 'e' }, sales)).status, 403);
  assert.equal((await call('POST', `/api/crm/accounts/${acct}/archive`, {}, sales)).status, 403);
  assert.equal(env.classOf(db, c), 'suspect');
});

test('ROLES: only a CRM Admin assigns roles, and the last CRM Admin cannot be lowered', async () => {
  assert.equal((await call('PUT', `/api/crm/staff/${sales2}/role`, { role: 'readonly' }, admin)).status, 200);
  assert.equal(db.prepare('SELECT crm_role FROM admin_users WHERE id = ?').get(sales2).crm_role, 'readonly');
  assert.equal((await call('PUT', `/api/crm/staff/${sales2}/role`, { role: 'boss' }, admin)).status, 400);
  const saved = db.prepare('SELECT id, crm_role FROM admin_users').all();
  db.prepare("UPDATE admin_users SET crm_role = 'sales' WHERE id NOT IN (?)").run(admin); // admin is now the only CRM Admin
  try {
    const last = await call('PUT', `/api/crm/staff/${admin}/role`, { role: 'sales' }, admin);
    assert.equal(last.status, 409); assert.equal(last.json.code, 'last_crm_admin');
    assert.equal(audits().filter(a => a.action === 'crm_role_changed').length, 1);
  } finally {
    for (const r of saved) db.prepare('UPDATE admin_users SET crm_role = ? WHERE id = ?').run(r.id === sales2 ? 'sales' : r.crm_role, r.id); // put everyone back for the tests that follow
  }
});

test('SETUP NOT RUN: a database without the role column answers 503, not a crash', async () => {
  // loadCrmRole treats a missing column as "not set up". Simulate it by asking for an admin through a pool whose query fails like MariaDB would.
  const realQuery = pool.query;
  pool.query = async (sql, params) => {
    if (/SELECT crm_role FROM admin_users/.test(sql)) { const e = new Error('Unknown column'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; }
    return realQuery(sql, params);
  };
  try { assert.equal((await call('GET', '/api/crm/accounts', undefined, admin)).status, 503); } finally { pool.query = realQuery; }
});

// ---- Accounts --------------------------------------------------------------------------------------------------------------------

test('ACCOUNTS: create, edit, duplicate warning, school and district links are one-to-one, parents cannot loop', async () => {
  const a = await newAccount('Maple District');
  const dup = await call('POST', '/api/crm/accounts', { name: '  maple   district ' }, admin);
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'possible_duplicate'); assert.equal(dup.json.existingAccountId, a);
  assert.equal((await call('POST', '/api/crm/accounts', { name: 'Maple District', allowDuplicate: true }, admin)).status, 201);
  assert.equal((await call('POST', '/api/crm/accounts', { name: '' }, admin)).status, 400);
  assert.equal((await call('POST', '/api/crm/accounts', { name: 'Bad Type', accountType: 'planet' }, admin)).status, 400);

  const schoolId = Number(db.prepare("INSERT INTO schools (domain) VALUES ('maple-high.example.org')").run().lastInsertRowid);
  const s1 = await call('POST', '/api/crm/accounts', { name: 'Maple High', schoolId, parentAccountId: a }, admin);
  assert.equal(s1.status, 201);
  const s2 = await call('POST', '/api/crm/accounts', { name: 'Maple High again', schoolId }, admin);
  assert.equal(s2.status, 409); assert.equal(s2.json.code, 'already_linked');
  assert.equal((await call('POST', '/api/crm/accounts', { name: 'Ghost', schoolId: 99999 }, admin)).status, 400);

  assert.equal((await call('PUT', `/api/crm/accounts/${a}`, { parentAccountId: s1.json.id }, admin)).status, 400, 'a parent cannot sit under its own child');
  assert.equal((await call('PUT', `/api/crm/accounts/${a}`, { parentAccountId: a }, admin)).status, 400, 'or under itself');
  assert.equal((await call('PUT', `/api/crm/accounts/${a}`, { state: 'PA', websiteDomain: 'maple.example.org' }, admin)).status, 200);
  const detail = await call('GET', `/api/crm/accounts/${a}`, undefined, viewer);
  assert.equal(detail.json.account.state, 'PA'); assert.equal(detail.json.children.length, 1);
});

test('ACCOUNTS: a person can belong to several accounts, only once to each', async () => {
  const c = env.addContact(db, 'both@multi.example.org', 'Both');
  const a1 = await newAccount('Multi One'); const a2 = await newAccount('Multi Two');
  assert.equal((await call('POST', `/api/crm/accounts/${a1}/contacts`, { contactId: c, title: 'Principal', isPrimary: true }, sales)).status, 201);
  assert.equal((await call('POST', `/api/crm/accounts/${a2}/contacts`, { contactId: c, isFinance: true }, sales)).status, 201);
  assert.equal((await call('POST', `/api/crm/accounts/${a1}/contacts`, { contactId: c }, sales)).status, 409);
  const card = await call('GET', `/api/crm/contacts/${c}`, undefined, viewer);
  assert.equal(card.json.accounts.length, 2);
  assert.equal((await call('PUT', `/api/crm/accounts/${a1}/contacts/${c}`, { isChampion: true }, sales)).status, 200);
  assert.equal((await call('DELETE', `/api/crm/accounts/${a1}/contacts/${c}`, undefined, sales)).status, 200);
  assert.equal((await call('GET', `/api/crm/contacts/${c}`, undefined, viewer)).json.accounts.length, 1);
});

test('ACCOUNTS: an account with an open deal cannot be archived; once the deal closes it can, and can be restored', async () => {
  const a = await newAccount('Archive Me');
  const deal = await newDeal(a);
  const blocked = await call('POST', `/api/crm/accounts/${a}/archive`, {}, admin);
  assert.equal(blocked.status, 409); assert.equal(blocked.json.code, 'open_deals');
  await call('POST', `/api/crm/opportunities/${deal}/close`, { outcome: 'inactive' }, admin);
  assert.equal((await call('POST', `/api/crm/accounts/${a}/archive`, {}, admin)).status, 200);
  assert.equal((await call('GET', '/api/crm/accounts?q=Archive', undefined, admin)).json.total, 0, 'hidden from the default list');
  assert.equal((await call('GET', '/api/crm/accounts?q=Archive&archived=true', undefined, admin)).json.total, 1);
  const noDeal = await call('POST', '/api/crm/opportunities', { accountId: a, name: 'New' }, admin);
  assert.equal(noDeal.status, 409); assert.equal(noDeal.json.code, 'account_archived');
  assert.equal((await call('POST', `/api/crm/accounts/${a}/unarchive`, {}, admin)).status, 200);
});

// ---- Deals -----------------------------------------------------------------------------------------------------------------------

test('DEALS: create writes the first stage history and an audit row with a CRM entity type and no purchase id', async () => {
  const a = await newAccount('Deal Co');
  const id = await newDeal(a, { name: 'First deal', amountCents: 250000, oppType: 'new_business' }, sales);
  const d = (await call('GET', `/api/crm/opportunities/${id}`, undefined, viewer)).json;
  assert.equal(d.opportunity.stage, 'new_inquiry'); assert.equal(d.opportunity.state, 'open'); assert.equal(d.opportunity.ownerAdminId, sales, 'the creator owns it');
  assert.equal(d.history.length, 1); assert.equal(d.history[0].fromState, null); assert.equal(d.history[0].toState, 'open');
  const row = audits().find(x => x.action === 'crm_opportunity_created' && x.entity_id === id);
  assert.equal(row.entity_type, 'crm_opportunity'); assert.equal(row.entity_id, id); assert.equal(row.actor_type, 'admin_user'); assert.equal(row.purchase_id, null); assert.equal(row.school_domain, null);
});

test('DEALS: money is whole cents; bad dates, types and probabilities are refused', async () => {
  const a = await newAccount('Validate Co');
  for (const body of [{ amountCents: 12.5 }, { amountCents: -1 }, { amountCents: '1e3' }, { oppType: 'weird' }, { expectedCloseDate: '2026-02-30' }, { nextStepDueAt: 'not a date' }]) {
    const r = await call('POST', '/api/crm/opportunities', { accountId: a, name: 'Bad', ...body }, admin);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await call('POST', '/api/crm/opportunities', { accountId: a }, admin)).status, 400, 'a name is required');
  assert.equal((await call('POST', '/api/crm/opportunities', { name: 'No account' }, admin)).status, 400);
});

test('STAGES: moving past Qualified needs a next step, or a stated reason; every move is written to the history', async () => {
  const a = await newAccount('Stage Co');
  const id = await newDeal(a, { name: 'Stage deal' });
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'qualified' }, admin)).status, 200, 'Qualified itself needs no next step');
  const blocked = await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'discovery' }, admin);
  assert.equal(blocked.status, 409); assert.equal(blocked.json.code, 'next_step_required');
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'discovery', overrideReason: 'Waiting on the district calendar' }, admin)).status, 200);
  await call('PUT', `/api/crm/opportunities/${id}`, { nextStep: 'Send the demo link', nextStepDueAt: '2026-12-01' }, admin);
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'demo_evaluation', reason: 'Demo booked' }, admin)).status, 200);
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'demo_evaluation' }, admin)).status, 400, 'already there');
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'won' }, admin)).json.code, 'use_close', 'Won is reached by closing the deal');
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'nonsense' }, admin)).status, 400);
  const d = (await call('GET', `/api/crm/opportunities/${id}`, undefined, viewer)).json;
  assert.deepEqual(d.history.map(h => h.to), ['New Inquiry', 'Qualified', 'Discovery', 'Demo / Evaluation']);
  assert.match(d.history[2].reason, /Next step override: Waiting on the district calendar/);
  assert.ok(d.opportunity.daysInStage !== null);
});

test('CLOSING: Won sets the Won stage and state; Lost needs a reason and keeps its stage; closing does not touch quotes, purchases or invoices', async () => {
  const a = await newAccount('Close Co');
  const won = await newDeal(a, { name: 'Won deal' });
  const lost = await newDeal(a, { name: 'Lost deal' });
  const quoteId = env.addQuote(db, 'q@close.example.org', { status: 'new', opportunityId: won });
  const purchasesBefore = db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n;
  assert.equal((await call('POST', `/api/crm/opportunities/${won}/close`, { outcome: 'won' }, admin)).status, 200);
  const w = (await call('GET', `/api/crm/opportunities/${won}`, undefined, admin)).json;
  assert.equal(w.opportunity.stage, 'won'); assert.equal(w.opportunity.state, 'won'); assert.ok(w.opportunity.closedAt);
  assert.equal(db.prepare('SELECT status FROM quote_requests WHERE id = ?').get(quoteId).status, 'new', 'the quote status enum is not co-opted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n, purchasesBefore, 'no purchase is created by closing a deal');
  assert.equal((await call('POST', `/api/crm/opportunities/${won}/close`, { outcome: 'lost', lossReason: 'no_budget' }, admin)).status, 409, 'already closed');

  assert.equal((await call('POST', `/api/crm/opportunities/${lost}/close`, { outcome: 'lost' }, admin)).json.code, 'loss_reason_required');
  assert.equal((await call('POST', `/api/crm/opportunities/${lost}/close`, { outcome: 'lost', lossReason: 'made_up' }, admin)).status, 400);
  assert.equal((await call('POST', `/api/crm/opportunities/${lost}/close`, { outcome: 'lost', lossReason: 'chose_competitor', competitor: 'Other Vendor', reengageOn: '2027-03-01' }, admin)).status, 200);
  const l = (await call('GET', `/api/crm/opportunities/${lost}`, undefined, admin)).json;
  assert.equal(l.opportunity.state, 'lost'); assert.equal(l.opportunity.stage, 'new_inquiry', 'lost is a state, not a stage'); assert.equal(l.opportunity.lossReason, 'Chose a competitor');
});

test('REOPEN: a CRM Admin only, with a reason; a Won deal comes back at an open stage', async () => {
  const a = await newAccount('Reopen Co');
  const id = await newDeal(a);
  await call('POST', `/api/crm/opportunities/${id}/close`, { outcome: 'won' }, admin);
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/reopen`, { reason: 'x' }, sales)).status, 403);
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/reopen`, {}, admin)).json.code, 'reason_required');
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/reopen`, { reason: 'PO fell through' }, admin)).status, 200);
  const d = (await call('GET', `/api/crm/opportunities/${id}`, undefined, admin)).json;
  assert.equal(d.opportunity.state, 'open'); assert.equal(d.opportunity.stage, 'verbal_commitment');
  assert.equal((await call('POST', `/api/crm/opportunities/${id}/reopen`, { reason: 'again' }, admin)).json.code, 'already_open');
});

test('OWNERSHIP: Sales edits their own and unassigned deals, not a colleague\'s; only a CRM Admin hands a deal to someone else', async () => {
  const a = await newAccount('Owner Co');
  const mine = await newDeal(a, { name: 'Mine' }, sales);
  const theirs = await newDeal(a, { name: 'Theirs' }, sales2);
  const nobody = await newDeal(a, { name: 'Nobody', ownerAdminId: null }, admin);
  assert.equal((await call('PUT', `/api/crm/opportunities/${mine}`, { nextStep: 'Call Tuesday' }, sales)).status, 200);
  const no = await call('PUT', `/api/crm/opportunities/${theirs}`, { nextStep: 'Hijack' }, sales);
  assert.equal(no.status, 403); assert.equal(no.json.code, 'not_your_deal');
  assert.equal((await call('POST', `/api/crm/opportunities/${theirs}/stage`, { stageKey: 'qualified' }, sales)).status, 403);
  assert.equal((await call('POST', `/api/crm/opportunities/${theirs}/close`, { outcome: 'inactive' }, sales)).status, 403);
  assert.equal((await call('PUT', `/api/crm/opportunities/${nobody}`, { ownerAdminId: sales }, sales)).status, 200, 'an unassigned deal can be taken');
  assert.equal((await call('PUT', `/api/crm/opportunities/${mine}`, { ownerAdminId: sales2 }, sales)).status, 403, 'but not handed away');
  assert.equal((await call('PUT', `/api/crm/opportunities/${mine}`, { ownerAdminId: sales2 }, admin)).status, 200);
  assert.equal((await call('PUT', `/api/crm/opportunities/${theirs}`, { nextStep: 'Admin edit' }, admin)).status, 200);
  assert.equal((await call('PUT', `/api/crm/opportunities/${mine}`, { ownerAdminId: 99999 }, admin)).status, 400);
});

test('PROBABILITY: only a CRM Admin overrides it, and the default comes from the stage', async () => {
  const a = await newAccount('Prob Co');
  const id = await newDeal(a, { amountCents: 100000 }, sales);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { probabilityOverride: 90 }, sales)).status, 403);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { probabilityOverride: 150 }, admin)).status, 400);
  assert.equal((await call('GET', `/api/crm/opportunities/${id}`, undefined, admin)).json.opportunity.probability, 5);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { probabilityOverride: 90 }, admin)).status, 200);
  const o = (await call('GET', `/api/crm/opportunities/${id}`, undefined, admin)).json.opportunity;
  assert.equal(o.probability, 90); assert.equal(o.probabilityIsOverride, true);
});

test('FORECAST: each deal is counted once however many contacts, committee members or quote versions it has', async () => {
  // A fresh set of accounts so the totals are exactly these deals.
  db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_opportunity_contacts; DELETE FROM quote_requests;');
  const a = await newAccount('Forecast Co');
  const d1 = await newDeal(a, { name: 'F1', amountCents: 100000 });           // New Inquiry, 5%
  const d2 = await newDeal(a, { name: 'F2', amountCents: 200000, stageKey: 'qualified' }); // 15%
  const noValue = await newDeal(a, { name: 'F3' });
  // Three committee members and three quote versions on the first deal, with one contact also on the second deal.
  const people = [1, 2, 3].map(i => env.addContact(db, `p${i}@forecast.example.org`));
  for (const p of people) assert.equal((await call('POST', `/api/crm/opportunities/${d1}/contacts`, { contactId: p, role: 'champion' }, admin)).status, 201);
  await call('POST', `/api/crm/opportunities/${d2}/contacts`, { contactId: people[0], role: 'finance' }, admin);
  for (const n of ['100001', '100002', '100003']) env.addQuote(db, 'p1@forecast.example.org', { number: n, opportunityId: d1, amountCents: 100000 });
  const list = (await call('GET', '/api/crm/opportunities', undefined, viewer)).json;
  assert.equal(list.total, 3);
  assert.equal(list.summary.openCount, 3);
  assert.equal(list.summary.grossCents, 300000, 'quote versions are never added together');
  assert.equal(list.summary.weightedCents, Math.round(100000 * 0.05) + Math.round(200000 * 0.15));
  assert.equal(list.summary.openWithoutValue, 1);
  const detail = (await call('GET', `/api/crm/opportunities/${d1}`, undefined, viewer)).json;
  assert.equal(detail.quotes.length, 3);
  assert.equal(JSON.stringify(detail).includes('secret-token-value'), false, 'the quote accept token is never sent to the browser');
  assert.ok(noValue);
});

test('BUYING COMMITTEE: the same person can play different roles on different deals; roles are validated; duplicates refused', async () => {
  const a = await newAccount('Committee Co');
  const d1 = await newDeal(a, { name: 'C1' }); const d2 = await newDeal(a, { name: 'C2' });
  const p = env.addContact(db, 'multi-role@committee.example.org');
  assert.equal((await call('POST', `/api/crm/opportunities/${d1}/contacts`, { contactId: p, role: 'champion', influence: 'high', stance: 'supporter' }, admin)).status, 201);
  assert.equal((await call('POST', `/api/crm/opportunities/${d2}/contacts`, { contactId: p, role: 'procurement' }, admin)).status, 201);
  assert.equal((await call('POST', `/api/crm/opportunities/${d1}/contacts`, { contactId: p, role: 'champion' }, admin)).status, 409);
  assert.equal((await call('POST', `/api/crm/opportunities/${d1}/contacts`, { contactId: 99999 }, admin)).status, 404);
  const bad = env.addContact(db, 'bad-role@committee.example.org');
  assert.equal((await call('POST', `/api/crm/opportunities/${d1}/contacts`, { contactId: bad, role: 'emperor' }, admin)).status, 400);
  assert.equal((await call('PUT', `/api/crm/opportunities/${d1}/contacts/${p}`, { stance: 'skeptic' }, admin)).status, 200);
  const card = (await call('GET', `/api/crm/contacts/${p}`, undefined, viewer)).json;
  assert.deepEqual(card.opportunities.map(o => o.role).sort(), ['champion', 'procurement']);
  assert.equal((await call('DELETE', `/api/crm/opportunities/${d1}/contacts/${p}`, undefined, admin)).status, 200);
});

test('STALE MOVE: two people moving the same card cannot both win', async () => {
  const a = await newAccount('Race Co');
  const id = await newDeal(a);
  // Simulate the second person: the deal changed stage between their page load and their click.
  const realQuery = pool.query;
  let tripped = false;
  pool.query = async (sql, params) => {
    if (!tripped && /^UPDATE crm_opportunities SET stage_id/.test(sql.trim())) { tripped = true; db.prepare("UPDATE crm_opportunities SET stage_id = 3 WHERE id = ?").run(id); }
    return realQuery(sql, params);
  };
  try {
    const r = await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'qualified' }, admin);
    assert.equal(r.status, 409); assert.equal(r.json.code, 'changed');
  } finally { pool.query = realQuery; }
});

// ---- Contacts --------------------------------------------------------------------------------------------------------------------

test('CONTACTS: the list pages on the server, filters by classification and owner, hides test addresses, and never changes the subscription status', async () => {
  db.exec('DELETE FROM newsletter_contacts');
  for (let i = 1; i <= 7; i++) env.addContact(db, `person${i}@list.example.org`, `Person ${i}`);
  env.addContact(db, 'qa-test@example.com', 'QA Test');
  const unsub = env.addContact(db, 'quiet@list.example.org', 'Quiet', { status: 'Unsubscribed' });
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(unsub);
  const p1 = (await call('GET', '/api/crm/contacts?pageSize=5&sort=email&dir=asc', undefined, viewer)).json;
  assert.equal(p1.total, 8, 'the @example.com contact is left out'); assert.equal(p1.contacts.length, 5);
  assert.equal((await call('GET', '/api/crm/contacts?pageSize=5&page=2&sort=email&dir=asc', undefined, viewer)).json.contacts.length, 3);
  assert.equal((await call('GET', '/api/crm/contacts?includeTest=true', undefined, viewer)).json.total, 9);
  const prospects = (await call('GET', '/api/crm/contacts?classification=prospect', undefined, viewer)).json;
  assert.equal(prospects.total, 1); assert.equal(prospects.contacts[0].subscriptionStatus, 'Unsubscribed');
  assert.equal((await call('GET', '/api/crm/contacts?classification=hot', undefined, viewer)).json.total, 8, 'an unknown label is ignored, not matched');
  assert.equal((await call('GET', '/api/crm/contacts?q=Person%203', undefined, viewer)).json.total, 1);
  assert.equal((await call('GET', '/api/crm/contacts?q=%25', undefined, viewer)).json.total, 0, 'a % typed in the search box is a literal, not a wildcard');
  assert.deepEqual((await call('GET', '/api/crm/contacts/counts', undefined, viewer)).json.counts, { suspect: 7, prospect: 1, customer: 0 });
});

test('CONTACT CARD: shows why each purchase does or does not make a Customer, and the classification history', async () => {
  const c = env.addContact(db, 'card@card.example.org');
  const trial = Number(db.prepare("INSERT INTO license_products (name, is_trial) VALUES ('T', 1)").run().lastInsertRowid);
  env.addPurchase(db, c, { productId: trial, amountCents: 5000 });
  const real = env.addPurchase(db, c, { amountCents: 5000 });
  const r = await call('POST', `/api/crm/contacts/${c}/reconcile`, {}, sales);
  assert.equal(r.json.to, 'customer');
  const card = (await call('GET', `/api/crm/contacts/${c}`, undefined, viewer)).json;
  assert.equal(card.contact.classification, 'customer');
  assert.deepEqual(card.purchases.map(p => [p.id, p.isTrial, p.qualifies]).sort((a, b) => a[0] - b[0]), [[real - 1, true, false], [real, false, true]]);
  assert.equal(card.events[0].type, 'purchase_verified');
});

test('PROMOTE and OVERRIDE through the routes: reasons required, roles enforced, both audited', async () => {
  const c = env.addContact(db, 'route-promote@route.example.org');
  assert.equal((await call('POST', `/api/crm/contacts/${c}/promote`, {}, sales)).status, 400);
  assert.equal((await call('POST', `/api/crm/contacts/${c}/promote`, { reason: 'Asked for pricing by email' }, sales)).status, 200);
  assert.equal(env.classOf(db, c), 'prospect');
  assert.equal((await call('POST', `/api/crm/contacts/${c}/promote`, { reason: 'again' }, sales)).status, 409);
  assert.equal((await call('POST', `/api/crm/contacts/${c}/promote`, { reason: 'viewer' }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/contacts/${c}/customer-override`, { reason: 'Paid by check' }, admin)).status, 400, 'evidence is required too');
  assert.equal((await call('POST', `/api/crm/contacts/${c}/customer-override`, { reason: 'Paid by check', evidence: 'check 4411' }, admin)).status, 200);
  assert.equal(env.classOf(db, c), 'customer');
  const log = audits().filter(a => a.entity_type === 'crm_contact' && a.entity_id === c).map(a => a.action);
  assert.deepEqual(log, ['crm_contact_promoted', 'crm_customer_override']);
});

test('CONTACT OWNER: must be a real staff member; unassigning is allowed', async () => {
  const c = env.addContact(db, 'owner-pick@route.example.org');
  assert.equal((await call('PUT', `/api/crm/contacts/${c}`, { assignedAdminId: 99999 }, sales)).status, 400);
  assert.equal((await call('PUT', `/api/crm/contacts/${c}`, { assignedAdminId: sales }, sales)).status, 200);
  assert.equal((await call('PUT', `/api/crm/contacts/${c}`, { assignedAdminId: null }, sales)).status, 200);
  assert.equal((await call('PUT', `/api/crm/contacts/${c}`, {}, sales)).status, 400);
});

test('SETTINGS: stages are edited by a CRM Admin only, probability is 0 to 100, a stage with open deals cannot be turned off', async () => {
  assert.equal((await call('GET', '/api/crm/stages', undefined, viewer)).json.stages.length, 8);
  const qualified = db.prepare("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'qualified'").get().id;
  assert.equal((await call('PUT', `/api/crm/stages/${qualified}`, { defaultProbability: 101 }, admin)).status, 400);
  assert.equal((await call('PUT', `/api/crm/stages/${qualified}`, { defaultProbability: 20, label: 'Qualified lead' }, admin)).status, 200);
  const a = await newAccount('Settings Co');
  await newDeal(a, { stageKey: 'qualified' });
  const inUse = await call('PUT', `/api/crm/stages/${qualified}`, { isActive: false }, admin);
  assert.equal(inUse.status, 409); assert.equal(inUse.json.code, 'stage_in_use');
  const won = db.prepare("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'won'").get().id;
  assert.equal((await call('PUT', `/api/crm/stages/${won}`, { isActive: false }, admin)).status, 400, 'Won stays on');
  assert.equal((await call('POST', '/api/crm/loss-reasons', { key: 'budget_cut', label: 'Budget cut' }, admin)).status, 201);
  assert.equal((await call('POST', '/api/crm/loss-reasons', { key: 'budget_cut', label: 'Dup' }, admin)).status, 409);
  assert.equal((await call('POST', '/api/crm/loss-reasons', { key: 'Bad Key', label: 'x' }, admin)).status, 400);
});

test('ME: reports the role and exactly the permissions it has', async () => {
  const r = (await call('GET', '/api/crm/me', undefined, sales)).json;
  assert.equal(r.role, 'sales'); assert.equal(r.permissions.write, true); assert.equal(r.permissions.set_customer, false); assert.equal(r.adminId, sales);
});

test('AUDIT: every CRM change is recorded with a crm_ entity type, one actor spelling, and never a purchase or school', () => {
  const rows = audits();
  assert.ok(rows.length > 15);
  const { CRM_ENTITY_TYPES } = require(path.join(env.SERVER, 'lib/audit.js'));
  for (const r of rows) {
    assert.ok(CRM_ENTITY_TYPES.includes(r.entity_type), `${r.action} used entity type ${r.entity_type}`);
    assert.equal(r.actor_type, 'admin_user');
    assert.equal(r.purchase_id, null); assert.equal(r.school_domain, null);
  }
});
