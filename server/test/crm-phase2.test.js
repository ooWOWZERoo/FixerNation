// Sales CRM phase 2: the API pieces added for the screens (quotes without a deal, deal from a quote, manual Suspect, contact and account merge,
// duplicate review, Overview numbers, deal list filters). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const { server, call } = env.listen([
  ['/api/crm/accounts', require(path.join(env.SERVER, 'routes/crm-accounts.js'))],
  ['/api/crm/contacts', require(path.join(env.SERVER, 'routes/crm-contacts.js'))],
  ['/api/crm/opportunities', require(path.join(env.SERVER, 'routes/crm-opportunities.js'))],
  ['/api/crm/quotes', require(path.join(env.SERVER, 'routes/crm-quotes.js'))],
  ['/api/crm/overview', require(path.join(env.SERVER, 'routes/crm-overview.js'))],
  ['/api/crm', require(path.join(env.SERVER, 'routes/crm-settings.js'))],
]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const sales2 = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const audits = (action) => all('SELECT * FROM school_audit_log WHERE action = ?', action);

async function account(name, as = admin) {
  const r = await call('POST', '/api/crm/accounts', { name, accountType: 'district' }, as);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

// ---- Quotes without a deal -------------------------------------------------------------------------------------------------------

test('QUOTES LIST: shows quotes with no deal or no contact, never the accept token, and leaves test addresses out', async () => {
  const c = env.addContact(db, 'pat@school-a.org');
  const q1 = env.addQuote(db, 'pat@school-a.org');                                  // no deal, no contact id, one contact matches
  const q2 = env.addQuote(db, 'nobody@school-b.org', { school: 'School B' });       // no deal, no contact at all
  env.addQuote(db, 'qa@example.com');                                               // test address
  const acct = await account('Done Already');
  const deal = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id) VALUES (?, 'D', 1)").run(acct).lastInsertRowid);
  env.addQuote(db, 'linked@school-c.org', { contactId: env.addContact(db, 'linked@school-c.org'), opportunityId: deal }); // fully linked: not listed

  const r = await call('GET', '/api/crm/quotes?gap=no_deal', undefined, viewer);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.quotes.map(q => q.id).sort(), [q1, q2].sort());
  assert.equal(r.json.total, 2);
  assert.ok(!JSON.stringify(r.json).includes('secret-token-value'), 'the accept token is never returned');
  assert.equal(r.json.quotes.find(q => q.id === q1).emailMatches, 1);
  assert.equal(r.json.quotes.find(q => q.id === q2).emailMatches, 0);

  const withTest = await call('GET', '/api/crm/quotes?gap=no_deal&includeTest=true', undefined, viewer);
  assert.equal(withTest.json.total, 3);
  const noContact = await call('GET', '/api/crm/quotes?gap=no_contact', undefined, viewer);
  assert.equal(noContact.json.total, 2);
  const paged = await call('GET', '/api/crm/quotes?gap=no_deal&pageSize=1&page=2', undefined, viewer);
  assert.equal(paged.json.quotes.length, 1);
  assert.equal(paged.json.total, 2);
  assert.ok(c);
});

test('CREATE DEAL FROM QUOTE: links the deal and the one matching contact, starts at the stage the evidence shows, writes history and audit, makes a Prospect', async () => {
  const contact = env.addContact(db, 'lee@school-d.org', 'Lee Person');
  const quote = env.addQuote(db, ' LEE@school-d.org ', { school: 'School D', amountCents: 500000, sentAt: '2026-10-01 10:00:00', status: 'contacted' });
  const acct = await account('School D');
  const r = await call('POST', `/api/crm/quotes/${quote}/create-deal`, { accountId: acct }, sales);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.contactLinked, true);
  const q = get('SELECT * FROM quote_requests WHERE id = ?', quote);
  assert.equal(q.opportunity_id, r.json.opportunityId);
  assert.equal(q.contact_id, contact);
  assert.equal(q.status, 'contacted', 'the quote status is never changed');
  const deal = get('SELECT o.*, s.stage_key FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.id = ?', r.json.opportunityId);
  assert.equal(deal.stage_key, 'proposal_sent');
  assert.equal(deal.state, 'open');
  assert.equal(deal.amount_cents, 500000);
  assert.equal(deal.owner_admin_id, sales);
  assert.equal(deal.primary_contact_id, contact);
  assert.equal(all('SELECT * FROM crm_opportunity_stage_history WHERE opportunity_id = ?', deal.id).length, 1);
  assert.equal(all('SELECT * FROM crm_opportunity_contacts WHERE opportunity_id = ?', deal.id).length, 1);
  assert.ok(audits('crm_quote_linked').length >= 1);
  assert.equal(env.classOf(db, contact), 'prospect', 'a quote request makes a Prospect');
  assert.equal(all('SELECT * FROM purchases').length, 0, 'the CRM creates no purchase');

  const again = await call('POST', `/api/crm/quotes/${quote}/create-deal`, { accountId: acct }, admin);
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'already_linked');
  assert.equal(all('SELECT * FROM crm_opportunities WHERE name LIKE ?', '%School D%').length, 1, 'a second try made no second deal');
});

test('CREATE DEAL FROM QUOTE: an email with two contacts or none is never guessed; a converted quote starts Won; a new account can be made but not duplicated', async () => {
  env.addContact(db, 'Twin@school-e.org');
  env.addContact(db, 'twin@school-e.org');
  const ambiguous = env.addQuote(db, 'twin@school-e.org', { school: 'School E' });
  const r1 = await call('POST', `/api/crm/quotes/${ambiguous}/create-deal`, { createAccount: true }, admin);
  assert.equal(r1.status, 201);
  assert.equal(r1.json.contactLinked, false);
  assert.equal(get('SELECT contact_id FROM quote_requests WHERE id = ?', ambiguous).contact_id, null);
  assert.equal(r1.json.createdAccount, true);

  const none = env.addQuote(db, 'ghost@school-f.org', { school: 'school   e', status: 'converted' });
  const dup = await call('POST', `/api/crm/quotes/${none}/create-deal`, { createAccount: true }, admin);
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'possible_duplicate');
  assert.equal(get('SELECT opportunity_id FROM quote_requests WHERE id = ?', none).opportunity_id, null, 'nothing was linked on a refusal');

  const ok = await call('POST', `/api/crm/quotes/${none}/create-deal`, { accountId: r1.json.accountId }, admin);
  assert.equal(ok.status, 201);
  const deal = get('SELECT state, closed_at FROM crm_opportunities WHERE id = ?', ok.json.opportunityId);
  assert.equal(deal.state, 'won');
  assert.ok(deal.closed_at);

  const noOrg = env.addQuote(db, 'x@school-g.org', { school: '' });
  assert.equal((await call('POST', `/api/crm/quotes/${noOrg}/create-deal`, { createAccount: true }, admin)).status, 400);
  assert.equal((await call('POST', `/api/crm/quotes/${noOrg}/create-deal`, {}, admin)).status, 400);
});

test('CREATE DEAL FROM QUOTE: read-only cannot; linking to an existing deal respects who owns it; a contact can be linked by hand', async () => {
  const acct = await account('School H');
  const q = env.addQuote(db, 'h@school-h.org');
  assert.equal((await call('POST', `/api/crm/quotes/${q}/create-deal`, { accountId: acct }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/quotes/${q}/link-contact`, { contactId: 1 }, viewer)).status, 403);

  const mine = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'Mine' }, sales)).json.id;
  const theirs = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'Theirs' }, sales2)).json.id;
  const no = await call('POST', `/api/crm/quotes/${q}/link-deal`, { opportunityId: theirs }, sales);
  assert.equal(no.status, 403);
  assert.equal(no.json.code, 'not_your_deal');
  const yes = await call('POST', `/api/crm/quotes/${q}/link-deal`, { opportunityId: mine }, sales);
  assert.equal(yes.status, 200);
  assert.equal(get('SELECT opportunity_id FROM quote_requests WHERE id = ?', q).opportunity_id, mine);

  const person = env.addContact(db, 'other.mailbox@school-h.org');
  const link = await call('POST', `/api/crm/quotes/${q}/link-contact`, { contactId: person }, sales);
  assert.equal(link.status, 200);
  assert.equal(get('SELECT contact_id FROM quote_requests WHERE id = ?', q).contact_id, person);
  assert.equal((await call('POST', `/api/crm/quotes/${q}/link-contact`, { contactId: person }, sales)).status, 409);
});

// ---- A Suspect by hand -----------------------------------------------------------------------------------------------------------

test('NEW CONTACT: made as a Suspect, kept OFF the newsletter unless asked, never a duplicate, quote history makes a Prospect', async () => {
  const acct = await account('School I');
  const r = await call('POST', '/api/crm/contacts', { name: 'Sam Lead', email: 'sam@school-i.org', company: 'School I', accountId: acct, title: 'Principal' }, sales);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.classification, 'suspect');
  const row = get('SELECT * FROM newsletter_contacts WHERE id = ?', r.json.id);
  assert.equal(row.status, 'Unsubscribed', 'no consent recorded, so not on the newsletter');
  assert.equal(row.crm_source, 'crm_manual');
  assert.equal(row.assigned_admin_id, sales);
  assert.equal(all('SELECT * FROM crm_account_contacts WHERE contact_id = ?', r.json.id).length, 1);

  const dupe = await call('POST', '/api/crm/contacts', { email: 'SAM@school-i.org' }, admin);
  assert.equal(dupe.status, 409);
  assert.equal(dupe.json.code, 'duplicate_email');
  assert.equal(dupe.json.existingContactId, r.json.id);
  assert.equal((await call('POST', '/api/crm/contacts', { email: 'not an email' }, admin)).status, 400);
  assert.equal((await call('POST', '/api/crm/contacts', {}, admin)).status, 400);
  assert.equal((await call('POST', '/api/crm/contacts', { email: 'v@school-i.org' }, viewer)).status, 403);

  const subscribed = await call('POST', '/api/crm/contacts', { email: 'sub@school-i.org', subscribe: true }, admin);
  assert.equal(get('SELECT status FROM newsletter_contacts WHERE id = ?', subscribed.json.id).status, 'Subscribed');

  env.addQuote(db, 'late@school-i.org');
  const withQuote = await call('POST', '/api/crm/contacts', { email: 'late@school-i.org' }, admin);
  assert.equal(withQuote.json.classification, 'prospect');
});

// ---- Merge ----------------------------------------------------------------------------------------------------------------------

test('CONTACT MERGE: CRM Admin only; moves links, quotes and lists, fills blanks, keeps the subscription, removes the duplicate, audits it', async () => {
  const keep = env.addContact(db, 'jo.keep@school-j.org', 'Jo Keep');
  const dupe = env.addContact(db, 'jo.old@school-j.org', 'Jo K');
  db.prepare("UPDATE newsletter_contacts SET company = 'School J', status = 'Unsubscribed' WHERE id = ?").run(dupe);
  const acct = await account('School J');
  const acct2 = await account('School J Annex');
  await call('POST', `/api/crm/accounts/${acct}/contacts`, { contactId: keep }, admin);
  await call('POST', `/api/crm/accounts/${acct}/contacts`, { contactId: dupe }, admin);       // both on the same account: one seat survives
  await call('POST', `/api/crm/accounts/${acct2}/contacts`, { contactId: dupe }, admin);
  const deal = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'J deal', primaryContactId: dupe }, admin)).json.id;
  await call('POST', `/api/crm/opportunities/${deal}/contacts`, { contactId: dupe, role: 'champion' }, admin);
  const quote = env.addQuote(db, 'jo.old@school-j.org', { contactId: dupe });
  db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, 7), (?, 8), (?, 8)').run(dupe, dupe, keep);

  assert.equal((await call('POST', `/api/crm/contacts/${dupe}/merge`, { intoId: keep }, sales)).status, 403, 'Sales cannot merge');
  assert.equal((await call('POST', `/api/crm/contacts/${dupe}/merge`, { intoId: keep }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/contacts/${dupe}/merge`, { intoId: dupe }, admin)).status, 400);

  const r = await call('POST', `/api/crm/contacts/${dupe}/merge`, { intoId: keep, reason: 'same person' }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(get('SELECT id FROM newsletter_contacts WHERE id = ?', dupe), undefined, 'the duplicate is gone');
  assert.equal(get('SELECT company, status FROM newsletter_contacts WHERE id = ?', keep).company, 'School J', 'a blank detail is filled from the duplicate');
  assert.equal(get('SELECT status FROM newsletter_contacts WHERE id = ?', keep).status, 'Subscribed', 'the kept contact subscription is untouched');
  assert.deepEqual(all('SELECT account_id FROM crm_account_contacts WHERE contact_id = ? ORDER BY account_id', keep).map(x => x.account_id), [acct, acct2]);
  assert.equal(get('SELECT primary_contact_id FROM crm_opportunities WHERE id = ?', deal).primary_contact_id, keep);
  assert.equal(all('SELECT * FROM crm_opportunity_contacts WHERE opportunity_id = ? AND contact_id = ?', deal, keep).length, 1);
  assert.equal(get('SELECT contact_id FROM quote_requests WHERE id = ?', quote).contact_id, keep);
  assert.deepEqual(all('SELECT group_id FROM contact_group_members WHERE contact_id = ? ORDER BY group_id', keep).map(x => x.group_id), [7, 8]);
  const a = audits('crm_contact_merged');
  assert.equal(a.length, 1);
  assert.match(a[0].prev_value, /jo\.old@school-j\.org/);
  assert.equal(env.classOf(db, keep), 'prospect', 'the merged quote makes the kept contact a Prospect');
});

test('CONTACT MERGE: refuses when the duplicate owns money, has a sign-in account, a staff address or a locked label', async () => {
  const keep = env.addContact(db, 'k@school-k.org');
  const buyer = env.addContact(db, 'buyer@school-k.org');
  env.addPurchase(db, buyer);
  const r1 = await call('POST', `/api/crm/contacts/${buyer}/merge`, { intoId: keep }, admin);
  assert.equal(r1.status, 409);
  assert.equal(r1.json.code, 'source_owns_purchases');
  assert.ok(get('SELECT id FROM newsletter_contacts WHERE id = ?', buyer));

  const withLogin = env.addContact(db, 'login@school-k.org');
  db.prepare("INSERT INTO site_users (email) VALUES ('login@school-k.org')").run();
  assert.equal((await call('POST', `/api/crm/contacts/${withLogin}/merge`, { intoId: keep }, admin)).json.code, 'has_account');

  const locked = env.addContact(db, 'locked@school-k.org');
  db.prepare('UPDATE newsletter_contacts SET classification_locked = 1 WHERE id = ?').run(locked);
  assert.equal((await call('POST', `/api/crm/contacts/${locked}/merge`, { intoId: keep }, admin)).json.code, 'source_locked');

  const staffMail = env.addContact(db, 'staffer@example.org');
  db.prepare("UPDATE admin_users SET email = 'staffer@example.org' WHERE id = ?").run(viewer);
  assert.equal((await call('POST', `/api/crm/contacts/${staffMail}/merge`, { intoId: keep }, admin)).json.code, 'has_account');
  db.prepare("UPDATE admin_users SET email = 'viewer@example.com' WHERE id = ?").run(viewer);
});

test('DUPLICATE REVIEW: same full name or same mailbox minus a + tag; two people on one school domain are never suggested; test addresses are left out', async () => {
  env.addContact(db, 'maria.lopez@big-district.org', 'Maria Lopez');
  env.addContact(db, 'm.lopez2@other-district.org', 'maria  LOPEZ');
  env.addContact(db, 'tim+news@dupes-school.org', 'T');
  env.addContact(db, 'tim@dupes-school.org', 'Timothy');
  env.addContact(db, 'ann.smith@same-domain.org', 'Ann Smith');
  env.addContact(db, 'bob.jones@same-domain.org', 'Bob Jones');
  env.addContact(db, 'qa.one@example.com', 'Qa Tester');
  env.addContact(db, 'qa.two@example.com', 'Qa Tester');
  const r = await call('GET', '/api/crm/contacts/review/duplicates?pageSize=100', undefined, viewer);
  assert.equal(r.status, 200);
  const emails = r.json.groups.map(g => g.contacts.map(c => c.email).sort());
  assert.ok(emails.some(g => g.includes('maria.lopez@big-district.org') && g.includes('m.lopez2@other-district.org')));
  assert.ok(emails.some(g => g.includes('tim@dupes-school.org') && g.includes('tim+news@dupes-school.org')));
  assert.ok(!emails.some(g => g.includes('ann.smith@same-domain.org') && g.includes('bob.jones@same-domain.org')), 'a shared domain alone never makes a pair');
  assert.ok(!JSON.stringify(r.json).includes('@example.com'), 'test addresses are left out');
  const paged = await call('GET', '/api/crm/contacts/review/duplicates?pageSize=1', undefined, viewer);
  assert.equal(paged.json.groups.length, 1);
  assert.ok(paged.json.total >= 2);
});

test('ACCOUNT MERGE: CRM Admin only; moves people, deals, sub-accounts and the school link; archives the duplicate; refuses a loop', async () => {
  const school = Number(db.prepare("INSERT INTO schools (domain) VALUES ('merge.example.org')").run().lastInsertRowid);
  const keep = await account('Keep District');
  const dupe = await account('Duplicate District');
  db.prepare('UPDATE crm_accounts SET school_id = ?, website_domain = ?, assigned_admin_id = ? WHERE id = ?').run(school, 'dupe.example.org', sales, dupe);
  const child = Number(db.prepare('INSERT INTO crm_accounts (name, parent_account_id) VALUES (?, ?)').run('Child', dupe).lastInsertRowid);
  const person = env.addContact(db, 'p@merge-accts.org');
  const both = env.addContact(db, 'q@merge-accts.org');
  await call('POST', `/api/crm/accounts/${dupe}/contacts`, { contactId: person }, admin);
  await call('POST', `/api/crm/accounts/${dupe}/contacts`, { contactId: both }, admin);
  await call('POST', `/api/crm/accounts/${keep}/contacts`, { contactId: both }, admin);
  const deal = (await call('POST', '/api/crm/opportunities', { accountId: dupe, name: 'Dupe deal' }, admin)).json.id;

  assert.equal((await call('POST', `/api/crm/accounts/${dupe}/merge`, { intoId: keep }, sales)).status, 403);
  const loop = await call('POST', `/api/crm/accounts/${dupe}/merge`, { intoId: child }, admin);
  assert.equal(loop.status, 409, 'a parent cannot be merged into its own sub-account');
  assert.equal(loop.json.code, 'sub_account');
  const r = await call('POST', `/api/crm/accounts/${dupe}/merge`, { intoId: keep, reason: 'duplicate' }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(get('SELECT account_id FROM crm_opportunities WHERE id = ?', deal).account_id, keep);
  assert.equal(get('SELECT parent_account_id FROM crm_accounts WHERE id = ?', child).parent_account_id, keep);
  assert.equal(all('SELECT * FROM crm_account_contacts WHERE account_id = ?', keep).length, 2);
  assert.equal(all('SELECT * FROM crm_account_contacts WHERE account_id = ?', dupe).length, 0);
  const kept = get('SELECT * FROM crm_accounts WHERE id = ?', keep);
  assert.equal(kept.school_id, school, 'the school link moved to the kept account');
  assert.equal(kept.assigned_admin_id, sales);
  assert.equal(kept.website_domain, 'dupe.example.org');
  const gone = get('SELECT * FROM crm_accounts WHERE id = ?', dupe);
  assert.ok(gone.archived_at, 'archived, not deleted');
  assert.equal(gone.school_id, null);
  assert.match(gone.description, /Merged into "Keep District"/);
  assert.equal(audits('crm_account_merged').length, 1);
  assert.equal((await call('POST', `/api/crm/accounts/${dupe}/merge`, { intoId: keep }, admin)).json.code, 'already_archived');
});

// ---- Overview and list filters ---------------------------------------------------------------------------------------------------

test('OVERVIEW: the counts match the SQL, the pipeline sums one row per deal, and the decision lists show what needs a person', async () => {
  const r = await call('GET', '/api/crm/overview', undefined, viewer);
  assert.equal(r.status, 200);
  const sql = Object.fromEntries(all("SELECT crm_classification AS k, COUNT(*) AS n FROM newsletter_contacts WHERE LOWER(TRIM(email)) NOT LIKE '%@example.com' GROUP BY crm_classification").map(x => [x.k, x.n]));
  assert.equal(r.json.counts.suspect, sql.suspect || 0);
  assert.equal(r.json.counts.prospect, sql.prospect || 0);
  assert.equal(r.json.counts.customer, sql.customer || 0);

  const open = all("SELECT o.amount_cents AS a, COALESCE(o.probability_override, s.default_probability) AS p FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open'");
  assert.equal(r.json.pipeline.openCount, open.length);
  assert.equal(r.json.pipeline.grossCents, open.reduce((n, x) => n + (x.a || 0), 0));
  assert.equal(r.json.pipeline.weightedCents, open.reduce((n, x) => n + Math.round((x.a || 0) * x.p / 100), 0));
  assert.equal(r.json.pipeline.byStage.reduce((n, s) => n + s.count, 0), open.length);

  const noDeal = all("SELECT COUNT(*) AS n FROM quote_requests WHERE opportunity_id IS NULL AND LOWER(TRIM(email)) NOT LIKE '%@example.com'")[0].n;
  assert.equal(r.json.decisions.quotesWithoutDeal.total, noDeal);
  assert.ok(r.json.decisions.quotesWithoutDeal.items.length <= 8);
  assert.ok(!JSON.stringify(r.json).includes('secret-token-value'));
});

test('OVERVIEW: overdue and missing next steps are counted and listed; a purchase with no amount lands on the review list', async () => {
  const acct = await account('Overview Co');
  const late = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'Late', nextStep: 'Call back', nextStepDueAt: '2020-01-02', amountCents: 100000 }, admin)).json.id;
  const none = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'No step' }, admin)).json.id;
  const before = (await call('GET', '/api/crm/overview', undefined, admin)).json;
  assert.ok(before.nextSteps.overdue.items.some(d => d.id === late));
  assert.ok(before.nextSteps.missing.items.some(d => d.id === none));
  assert.ok(!before.nextSteps.missing.items.some(d => d.id === late));
  assert.ok(before.nextSteps.overdue.total >= 1 && before.nextSteps.missing.total >= 1);

  const buyer = env.addContact(db, 'review@school-r.org', 'Rae Buyer');
  const p = env.addPurchase(db, buyer, { amountCents: null });
  const rv = await call('GET', '/api/crm/contacts/review/purchases?pageSize=100', undefined, viewer);
  const row = rv.json.purchases.find(x => x.purchaseId === p);
  assert.ok(row);
  assert.equal(row.contactEmail, 'review@school-r.org');
  assert.equal(rv.json.total, rv.json.purchases.length);
  assert.equal(env.classOf(db, buyer), 'suspect', 'a purchase with no amount is never a Customer by itself');
  const first = await call('GET', '/api/crm/contacts/review/purchases?pageSize=1&page=1', undefined, viewer);
  assert.equal(first.json.purchases.length, 1);
});

test('DEAL LIST FILTERS: overdue, days in stage, sort, owner=me; the contact 360 lists its quotes', async () => {
  const acct = await account('Filter Co');
  const a = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'Aaa filter', nextStep: 'x', nextStepDueAt: '2020-02-02', amountCents: 300 }, sales)).json.id;
  const b = (await call('POST', '/api/crm/opportunities', { accountId: acct, name: 'Bbb filter', nextStep: 'y', nextStepDueAt: '2999-02-02', amountCents: 100 }, admin)).json.id;
  db.prepare("UPDATE crm_opportunities SET stage_entered_at = '2020-01-01 00:00:00' WHERE id = ?").run(b);
  const ids = r => r.json.opportunities.map(o => o.id);
  const q = s => call('GET', `/api/crm/opportunities?q=filter&${s}`, undefined, sales);
  assert.deepEqual(ids(await q('overdue=true')), [a]);
  assert.deepEqual(ids(await q('staleDays=30')), [b]);
  assert.deepEqual(ids(await q('owner=me')), [a]);
  assert.deepEqual(ids(await q('sort=name&dir=asc')), [a, b]);
  assert.deepEqual(ids(await q('sort=amount&dir=asc')), [b, a]);
  assert.deepEqual(ids(await q('sort=daysinstage&dir=desc')), [b, a], 'most days in stage first');

  const person = env.addContact(db, 'q360@school-q.org');
  const quote = env.addQuote(db, 'q360@school-q.org');
  const c = await call('GET', `/api/crm/contacts/${person}`, undefined, viewer);
  assert.equal(c.json.quotes.length, 1);
  assert.equal(c.json.quotes[0].id, quote);
  assert.ok(!JSON.stringify(c.json).includes('secret-token-value'));
});

test('B1: merging keeps the duplicate\'s Prospect label (a staff promotion has no quote to re-derive it) and its label history, and never demotes the kept contact', async () => {
  const keep = env.addContact(db, 'keep.b1@school-b1.org', 'Keep');
  const dupe = env.addContact(db, 'dupe.b1@school-b1.org', 'Dupe');
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(dupe);
  db.prepare("INSERT INTO crm_classification_events (contact_id, from_classification, to_classification, event_type, reason, created_at) VALUES (?, 'suspect', 'prospect', 'manual_promotion', 'Met at a conference', '2026-11-01 09:00:00')").run(dupe);
  const r = await call('POST', `/api/crm/contacts/${dupe}/merge`, { intoId: keep, reason: 'same person' }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(get('SELECT crm_classification AS c FROM newsletter_contacts WHERE id = ?', keep).c, 'prospect', 'the Prospect label is not lost');
  const ev = all('SELECT event_type, reason FROM crm_classification_events WHERE contact_id = ? ORDER BY id', keep);
  assert.ok(ev.some(e => e.event_type === 'manual_promotion' && e.reason === 'Met at a conference'), 'the removed contact\'s history moved to the kept one');
  assert.ok(ev.some(e => e.event_type === 'merge_kept_label'), 'and the carry-over itself is recorded');
  assert.equal(all('SELECT id FROM crm_classification_events WHERE contact_id = ?', dupe).length, 0);

  // The other way round: the kept contact is already a Prospect and the duplicate a Suspect: nothing changes except the history moves.
  const keep2 = env.addContact(db, 'keep2.b1@school-b1.org', 'Keep2');
  const dupe2 = env.addContact(db, 'dupe2.b1@school-b1.org', 'Dupe2');
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(keep2);
  db.prepare("INSERT INTO crm_classification_events (contact_id, from_classification, to_classification, event_type, created_at) VALUES (?, 'suspect', 'suspect', 'note_only', '2026-11-02 09:00:00')").run(dupe2);
  assert.equal((await call('POST', `/api/crm/contacts/${dupe2}/merge`, { intoId: keep2 }, admin)).status, 200);
  assert.equal(get('SELECT crm_classification AS c FROM newsletter_contacts WHERE id = ?', keep2).c, 'prospect');
  assert.ok(!all('SELECT event_type FROM crm_classification_events WHERE contact_id = ?', keep2).some(e => e.event_type === 'merge_kept_label'), 'no carry-over event when nothing was carried');
  assert.ok(all('SELECT event_type FROM crm_classification_events WHERE contact_id = ?', keep2).some(e => e.event_type === 'note_only'), 'its history still moved');
});
