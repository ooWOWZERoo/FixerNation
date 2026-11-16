// Sales CRM phase 4b to 4d (docs/reference/sales-crm-update-requirements.md, "4b to 4d spec"): quote links, revisions, the quote event log, the Won handoff,
// the customer-accepts hook, and the procurement view. Real routes and real SQL (node:sqlite) from test/helpers/crm-env.js.
// The money path itself (a PO acceptance being all-or-nothing, the webhook, the evidence saved on accept) is in quote-billing-hardening.test.js.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
// A stand-in for the real PO acceptance (that function is tested with real purchases in quote-billing-hardening.test.js): it claims the quote once, makes one
// purchase and one invoice, and refuses an expired one, which is all the Won handoff route depends on.
const acceptCalls = [];
let expired = false;
const quoteAcceptStub = {
  router: require('express').Router(),
  acceptQuoteViaPO: async (quoteId, poNumber, req, opts = {}) => {
    acceptCalls.push({ quoteId, poNumber, opts });
    if (expired) throw Object.assign(new Error('expired'), { status: 400 });
    const claim = db.prepare("UPDATE quote_requests SET accepted_at = CURRENT_TIMESTAMP, accepted_payment_method = 'po', status = 'converted' WHERE id = ? AND accepted_at IS NULL").run(quoteId);
    if (!claim.changes) throw Object.assign(new Error('already_accepted'), { status: 400 });
    const q = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(quoteId);
    const inv = Number(db.prepare("INSERT INTO invoices (invoice_number, contact_id, status) VALUES (?, ?, 'unpaid')").run(`INV-${quoteId}`, q.contact_id).lastInsertRowid);
    const pid = Number(db.prepare("INSERT INTO purchases (contact_id, payment_status, payment_method, amount_cents, quote_id, invoice_id, license_status, po_number) VALUES (?, 'pending', 'po', ?, ?, ?, 'pending', ?)")
      .run(q.contact_id, q.quoted_amount_cents, quoteId, inv, poNumber || null).lastInsertRowid);
    return { purchaseId: pid, invoiceId: inv, setupUrl: '' };
  },
};
const sent = [];
const mailerStub = new Proxy({ sendQuoteEmail: async (m) => { sent.push(m); } }, { get: (t, k) => (k in t ? t[k] : async () => {}) });
env.install(pool, {
  [path.join(env.SERVER, 'routes/quote-accept.js')]: quoteAcceptStub,
  [path.join(env.SERVER, 'lib/mailer.js')]: mailerStub,
});
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/opportunities', R('crm-opportunities.js')], ['/api/contact', R('contact.js')]]);
test.after(() => server.close());

const crmHooks = require(path.join(env.SERVER, 'lib/crm-hooks.js'));
const { setQuoteLinks, dealForQuote } = require(path.join(env.SERVER, 'lib/crm-quotes.js'));
const { procurementFlags } = require(path.join(env.SERVER, 'lib/crm-procurement.js'));
const { recordQuoteEvent } = require(path.join(env.SERVER, 'lib/crm-quote-events.js'));
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const sales2 = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

const account = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Test District', 'district')").run().lastInsertRowid);
const dealOf = (owner, amount = 100000) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, amount_cents) VALUES (?, 'Deal', 1, ?, ?)").run(account, owner, amount).lastInsertRowid);
let n = 500;
// A quote as the CRM sees it. `sent` makes it a sent quote.
function quote(email, f = {}) {
  const id = Number(db.prepare(`INSERT INTO quote_requests (quote_number, email, status, accept_token, quoted_amount_cents, contact_id, opportunity_id, first_name, last_name, school, quoted_product_name, quote_sent_at, version_status, supersedes_quote_id, revision_number)
    VALUES (?, ?, 'contacted', ?, ?, ?, ?, 'Pat', 'Example', 'Sample Elementary', 'Group license', ?, ?, ?, ?)`)
    .run(String(n++), email, `tok-${n}`, f.cents === undefined ? 50000 : f.cents, f.contactId || null, f.dealId || null, f.sent === false ? null : '2026-11-01 10:00:00', f.versionStatus || 'current', f.supersedes || null, f.revision || 1).lastInsertRowid);
  return id;
}

// ---- 4b: links ----
test('LINKS: a quote is linked to the contact only when exactly one contact has that email; never to a deal unless one is named', async () => {
  const one = env.addContact(db, 'one@school.test', 'One');
  const q1 = quote('one@school.test');
  assert.equal(await setQuoteLinks(pool, q1, { contactEmail: 'ONE@school.test ' }), one, 'case and spaces do not matter');
  assert.equal(get('SELECT contact_id, opportunity_id FROM quote_requests WHERE id = ?', q1).contact_id, one);
  assert.equal(get('SELECT opportunity_id AS o FROM quote_requests WHERE id = ?', q1).o, null, 'no deal was made or chosen');
  const none = quote('nobody@school.test');
  assert.equal(await setQuoteLinks(pool, none, { contactEmail: 'nobody@school.test' }), null);
  assert.equal(get('SELECT contact_id AS c FROM quote_requests WHERE id = ?', none).c, null, 'no contact, nothing guessed');
});

test('LINKS: a database without the new columns never breaks the caller (the public form must keep working)', async () => {
  const bare = env.makeDb();
  bare.db.exec('DROP TABLE quote_requests; CREATE TABLE quote_requests (id INTEGER PRIMARY KEY, email TEXT)');
  bare.db.prepare("INSERT INTO newsletter_contacts (name, email) VALUES ('X', 'x@school.test')").run();
  bare.db.prepare("INSERT INTO quote_requests (id, email) VALUES (1, 'x@school.test')").run();
  assert.equal(await setQuoteLinks(bare.pool, 1, { contactEmail: 'x@school.test', opportunityId: 5, adminId: 2 }), null);
});

test('LINKS: a quote can be made for a deal only with a CRM role that can edit that deal', async () => {
  const mine = dealOf(sales), theirs = dealOf(sales2);
  const req = (id) => ({ user: { userId: id } });
  assert.ok((await dealForQuote(req(admin), theirs)).deal, 'a CRM Admin may');
  assert.ok((await dealForQuote(req(sales), mine)).deal, 'Sales may on their own deal');
  assert.equal((await dealForQuote(req(sales), theirs)).status, 403, 'not on someone else\'s deal');
  assert.equal((await dealForQuote(req(viewer), mine)).status, 403, 'Read-only never');
  assert.equal((await dealForQuote(req(admin), 99999)).status, 400, 'a deal that does not exist');
  env.enable(db, false);
  assert.equal((await dealForQuote(req(admin), mine)).status, 400, 'the Hub is off');
  env.enable(db, true);
});

// ---- 4b: revisions ----
test('REVISE: only a sent, unaccepted, current quote; one open revision at a time; the deal and contact come along', async () => {
  const c = env.addContact(db, 'rev@school.test', 'Rev');
  const deal = dealOf(admin);
  const unsent = quote('rev@school.test', { sent: false, contactId: c, dealId: deal });
  let r = await call('POST', `/api/contact/quotes/${unsent}/revise`, {}, admin);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'not_sent');

  const q = quote('rev@school.test', { contactId: c, dealId: deal, cents: 97900 });
  r = await call('POST', `/api/contact/quotes/${q}/revise`, {}, admin);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const rev = r.json.quote;
  assert.equal(rev.revision_number, 2);
  assert.equal(rev.supersedes_quote_id, q);
  assert.equal(rev.version_status, 'current');
  assert.equal(rev.opportunity_id, deal, 'same deal');
  assert.equal(rev.contact_id, c, 'same contact');
  assert.equal(rev.quoted_amount_cents, 97900, 'starts from the same price');
  assert.notEqual(rev.quote_number, get('SELECT quote_number AS n FROM quote_requests WHERE id = ?', q).n, 'a new quote number');
  assert.equal('accept_token' in rev, false, 'the link is never sent to the browser (punch list S4)');
  assert.equal(rev.has_accept_link, false, 'and none exists until it is sent');
  assert.equal(get('SELECT version_status AS v FROM quote_requests WHERE id = ?', q).v, 'current', 'the old link still works until the revision is SENT');

  r = await call('POST', `/api/contact/quotes/${q}/revise`, {}, admin);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'revision_open'); assert.equal(r.json.existingQuoteId, rev.id);

  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-02 10:00:00' WHERE id = ?").run(q);
  const other = quote('rev@school.test');
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-02 10:00:00' WHERE id = ?").run(other);
  r = await call('POST', `/api/contact/quotes/${other}/revise`, {}, admin);
  assert.equal(r.json.code, 'already_accepted');
});

test('REVISE: a Sales user cannot revise a quote that is on someone else\'s deal', async () => {
  const theirs = dealOf(sales2);
  const q = quote('x@school.test', { dealId: theirs });
  const r = await call('POST', `/api/contact/quotes/${q}/revise`, {}, sales);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'not_your_deal');
  assert.equal(all('SELECT id FROM quote_requests WHERE supersedes_quote_id = ?', q).length, 0);
});

test('SEND: sending the revision replaces the old quote, writes the events, and a replaced quote cannot be sent again', async () => {
  const deal = dealOf(admin);
  const q = quote('send@school.test', { dealId: deal });
  const rev = (await call('POST', `/api/contact/quotes/${q}/revise`, {}, admin)).json.quote;
  sent.length = 0;
  const body = { quotedProductName: 'Group license', quotedAmountCents: 45000, quotedSeatCount: 10 };
  const r = await call('POST', `/api/contact/quotes/${rev.id}/send`, body, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(sent.length, 1, 'the revision was emailed');
  assert.equal(get('SELECT version_status AS v FROM quote_requests WHERE id = ?', q).v, 'superseded');
  assert.equal(get('SELECT version_status AS v FROM quote_requests WHERE id = ?', rev.id).v, 'current');
  const ev = all("SELECT quote_id, event_type FROM crm_quote_events WHERE event_type IN ('superseded', 'sent') ORDER BY id").filter(e => e.quote_id === q || e.quote_id === rev.id);
  assert.ok(ev.some(e => e.quote_id === q && e.event_type === 'superseded'), 'the old quote logs that it was replaced');
  assert.ok(ev.some(e => e.quote_id === rev.id && e.event_type === 'sent'));

  const again = await call('POST', `/api/contact/quotes/${q}/send`, body, admin);
  assert.equal(again.status, 409); assert.equal(again.json.code, 'superseded');
  const reviseAgain = await call('POST', `/api/contact/quotes/${q}/revise`, {}, admin);
  assert.equal(reviseAgain.json.code, 'superseded', 'revise the newer one instead');
});

test('SEND: a revision cannot be sent once the earlier quote was accepted meanwhile, and nothing is emailed', async () => {
  const q = quote('late@school.test');
  const rev = (await call('POST', `/api/contact/quotes/${q}/revise`, {}, admin)).json.quote;
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-03 09:00:00' WHERE id = ?").run(q);
  sent.length = 0;
  const r = await call('POST', `/api/contact/quotes/${rev.id}/send`, { quotedProductName: 'Group license', quotedAmountCents: 1000 }, admin);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'earlier_version_accepted');
  assert.equal(sent.length, 0);
  assert.equal(get('SELECT version_status AS v FROM quote_requests WHERE id = ?', q).v, 'current');
});

test('COPY: the copy belongs to the same contact, and to the same deal only for the same buyer and an admin who may edit it', async () => {
  const c = env.addContact(db, 'copy@school.test', 'Copy');
  const deal = dealOf(sales);
  const q = quote('copy@school.test', { contactId: c, dealId: deal });
  let r = await call('POST', `/api/contact/quotes/${q}/copy`, {}, sales);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.quote.opportunity_id, deal);
  assert.equal(r.json.quote.contact_id, c);
  assert.equal(r.json.quote.revision_number, 1, 'a copy is a new quote, not a revision');
  assert.equal(r.json.quote.supersedes_quote_id, null);
  r = await call('POST', `/api/contact/quotes/${q}/copy`, { email: 'someone-else@school.test' }, sales);
  assert.equal(r.json.quote.opportunity_id, null, 'a different buyer is a different deal');
  r = await call('POST', `/api/contact/quotes/${q}/copy`, {}, sales2);
  assert.equal(r.json.quote.opportunity_id, null, 'an admin who may not edit the deal does not get it');
});

// ---- 4b: events ----
test('EVENTS: page opened is recorded once an hour, carries no address or token, and an unknown quote or type writes nothing', async () => {
  const q = quote('ev@school.test');
  assert.equal(await recordQuoteEvent(pool, q, 'page_opened'), true);
  assert.equal(await recordQuoteEvent(pool, q, 'page_opened'), false, 'throttled');
  db.prepare("UPDATE crm_quote_events SET created_at = '2020-01-01 00:00:00' WHERE quote_id = ?").run(q);
  assert.equal(await recordQuoteEvent(pool, q, 'page_opened'), true, 'an hour later it counts again');
  assert.equal(await recordQuoteEvent(pool, q, 'bogus'), false);
  assert.equal(await recordQuoteEvent(pool, 987654, 'sent'), false);
  const cols = Object.keys(get('SELECT * FROM crm_quote_events WHERE quote_id = ?', q));
  assert.ok(!cols.some(c => /ip|agent|token/i.test(c)), `event columns: ${cols}`);
});

test('EVENTS: with the Hub off nothing is written, and the hooks never throw', async () => {
  const q = quote('off@school.test');
  env.enable(db, false);
  await crmHooks.quoteEvent(q, 'sent');
  await crmHooks.quoteAccepted(q, 'po');
  env.enable(db, true);
  assert.equal(all('SELECT id FROM crm_quote_events WHERE quote_id = ?', q).length, 0);
  await assert.doesNotReject(() => crmHooks.quoteEvent(123456789, 'sent'));
});

// ---- 4c: the customer accepts -> the deal moves to Won, once ----
test('AUTO-WON: a customer\'s acceptance closes the quote\'s open deal Won once, with history, and leaves lost or inactive deals alone', async () => {
  const deal = dealOf(admin);
  const q = quote('won@school.test', { dealId: deal });
  await crmHooks.quoteAccepted(q, 'card');
  const o = get('SELECT state, closed_at FROM crm_opportunities WHERE id = ?', deal);
  assert.equal(o.state, 'won'); assert.ok(o.closed_at);
  const h = all('SELECT to_state, reason FROM crm_opportunity_stage_history WHERE opportunity_id = ?', deal);
  assert.equal(h.length, 1);
  assert.match(h[0].reason, /accepted by the customer \(card\)/);
  assert.equal(all("SELECT id FROM crm_quote_events WHERE quote_id = ? AND event_type = 'accepted'", q).length, 1);
  await crmHooks.quoteAccepted(q, 'card'); // a replay
  assert.equal(all('SELECT id FROM crm_opportunity_stage_history WHERE opportunity_id = ?', deal).length, 1, 'closed once');

  const lost = dealOf(admin);
  db.prepare("UPDATE crm_opportunities SET state = 'lost' WHERE id = ?").run(lost);
  await crmHooks.quoteAccepted(quote('lost@school.test', { dealId: lost }), 'po');
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', lost).state, 'lost');
  await crmHooks.quoteAccepted(quote('nodeal@school.test'), 'po'); // a quote with no deal is fine
});

test('AUTO-WON: accepting makes no purchase and no Customer; the label comes only from a paid purchase', async () => {
  const c = env.addContact(db, 'prospect@school.test', 'Pro');
  const deal = dealOf(admin);
  const q = quote('prospect@school.test', { contactId: c, dealId: deal });
  const before = all('SELECT id FROM purchases').length;
  await crmHooks.quoteAccepted(q, 'po');
  assert.equal(all('SELECT id FROM purchases').length, before, 'the CRM wrote no purchase');
  await cls.reconcileContact(pool, c);
  assert.notEqual(env.classOf(db, c), 'customer');
});

// ---- 4c: the Won handoff ----
test('HANDOFF: only a CRM Admin; Sales and Read-only are refused before anything happens', async () => {
  const deal = dealOf(sales);
  const q = quote('hand@school.test', { dealId: deal, contactId: env.addContact(db, 'hand@school.test', 'H') });
  acceptCalls.length = 0;
  for (const who of [sales, viewer]) {
    const r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: q, poNumber: 'PO-1', signerName: 'Dana W' }, who);
    assert.equal(r.status, 403);
  }
  assert.equal((await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: q })).status, 401);
  assert.equal(acceptCalls.length, 0);
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', deal).state, 'open');
});

test('HANDOFF: accepts the quote once through the existing code, closes the deal under the admin\'s name, and a repeat returns the first result', async () => {
  const c = env.addContact(db, 'first@school.test', 'First');
  const deal = dealOf(admin);
  const q = quote('first@school.test', { dealId: deal, contactId: c, cents: 80000 });
  acceptCalls.length = 0;
  const body = { quoteId: q, poNumber: 'PO-77', signerName: '  Dana   Whitaker ', signerTitle: 'Business Manager' };
  const first = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, body, admin);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.accepted, true); assert.equal(first.json.dealClosed, true); assert.equal(first.json.repeated, false);
  assert.equal(acceptCalls.length, 1);
  assert.equal(acceptCalls[0].opts.recordedBy, 'staff');
  assert.deepEqual(acceptCalls[0].opts.signer, { name: 'Dana Whitaker', title: 'Business Manager' });
  assert.equal(acceptCalls[0].opts.skipDealClose, true, 'the handoff closes the deal itself, under the admin\'s name');
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', deal).state, 'won');
  const hist = get('SELECT actor_admin_id AS a, reason FROM crm_opportunity_stage_history WHERE opportunity_id = ?', deal);
  assert.equal(hist.a, admin); assert.match(hist.reason, /accepted by PO for the customer/);
  assert.equal(all('SELECT id FROM purchases WHERE quote_id = ?', q).length, 1);
  assert.equal(all('SELECT id FROM invoices WHERE contact_id = ?', c).length, 1);
  assert.equal(first.json.paymentStatus, 'pending');
  assert.equal(first.json.licenseStatus, 'pending');
  await cls.reconcileContact(pool, c);
  assert.notEqual(env.classOf(db, c), 'customer', 'a pending PO purchase is not a Customer');

  const again = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, body, admin);
  assert.equal(again.status, 200);
  assert.equal(again.json.repeated, true);
  assert.equal(again.json.purchaseId, first.json.purchaseId, 'the same purchase');
  assert.equal(again.json.invoiceId, first.json.invoiceId, 'the same invoice');
  assert.equal(acceptCalls.length, 1, 'the acceptance code ran once');
  assert.equal(all('SELECT id FROM purchases WHERE quote_id = ?', q).length, 1);
  assert.equal(all('SELECT id FROM crm_opportunity_stage_history WHERE opportunity_id = ?', deal).length, 1);
});

test('HANDOFF: a quote that was accepted elsewhere only closes the deal and creates nothing', async () => {
  const c = env.addContact(db, 'elsewhere@school.test', 'E');
  const deal = dealOf(admin);
  const q = quote('elsewhere@school.test', { dealId: deal, contactId: c });
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-04 10:00:00', accepted_payment_method = 'card' WHERE id = ?").run(q);
  db.prepare("INSERT INTO purchases (contact_id, payment_status, payment_method, amount_cents, quote_id) VALUES (?, 'paid', 'card', 50000, ?)").run(c, q);
  acceptCalls.length = 0;
  const r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: q }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.accepted, false); assert.equal(r.json.dealClosed, true);
  assert.equal(acceptCalls.length, 0);
  assert.equal(r.json.paymentStatus, 'paid');
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', deal).state, 'won');
});

test('HANDOFF: refusals leave everything as it was (no name, expired, replaced, another deal\'s quote, a closed deal)', async () => {
  const deal = dealOf(admin);
  const q = quote('refuse@school.test', { dealId: deal });
  acceptCalls.length = 0;
  let r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: q, poNumber: 'PO-1' }, admin);
  assert.equal(r.status, 400); assert.equal(r.json.code, 'signer_required');
  assert.ok(!/reload/i.test(r.json.error), 'staff are not told to reload a page');
  expired = true;
  r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: q, poNumber: 'PO-1', signerName: 'Dana W' }, admin);
  expired = false;
  assert.equal(r.status, 400); assert.match(r.json.error, /expired/i);
  const replaced = quote('replaced@school.test', { dealId: deal, versionStatus: 'superseded' });
  r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: replaced, poNumber: 'PO-1', signerName: 'Dana W' }, admin);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'superseded');
  const elsewhere = quote('elsewhere2@school.test', { dealId: dealOf(admin) });
  r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: elsewhere, poNumber: 'PO-1', signerName: 'Dana W' }, admin);
  assert.equal(r.status, 400, 'a quote that is on a different deal');
  db.prepare("UPDATE crm_opportunities SET state = 'lost' WHERE id = ?").run(deal);
  r = await call('POST', `/api/crm/opportunities/${deal}/won-handoff`, { quoteId: q, poNumber: 'PO-1', signerName: 'Dana W' }, admin);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'not_open');
  assert.equal(get('SELECT accepted_at FROM quote_requests WHERE id = ?', q).accepted_at, null);
  assert.equal(all('SELECT id FROM purchases WHERE quote_id = ?', q).length, 0);
});

// ---- 4d: procurement, and the deal page's data ----
test('PROCUREMENT: the flags are plain facts from the purchase and its invoice', () => {
  const keys = (p) => procurementFlags(p).map(f => f.key);
  assert.deepEqual(keys({ payment_method: 'po', po_number: 'PO-1', po_received_date: null, invoice_status: 'unpaid', license_status: 'pending' }), ['po_not_received', 'invoice_unpaid', 'license_pending']);
  assert.deepEqual(keys({ payment_method: 'po', po_number: 'PO-1', po_received_date: '2026-11-05', invoice_status: 'unpaid', license_status: 'active' }), ['invoice_unpaid']);
  assert.deepEqual(keys({ payment_method: 'po', po_number: 'PO-1', po_received_date: '2026-11-05', invoice_status: 'paid', license_status: 'active' }), []);
  assert.deepEqual(keys({ payment_method: 'card', payment_status: 'pending', license_status: 'active' }), ['payment_pending']);
  assert.deepEqual(keys({ payment_method: 'po', po_number: null, invoice_status: null, license_status: 'active' }), [], 'no PO number on file, nothing to chase');
});

test('DEAL PAGE: shows revisions, who accepted, the procurement rows and the quote activity; forecast counts the deal once however many revisions', async () => {
  const c = env.addContact(db, 'page@school.test', 'Page');
  const deal = dealOf(admin, 100000);
  const v1 = quote('page@school.test', { dealId: deal, contactId: c, cents: 100000, versionStatus: 'superseded' });
  const v2 = quote('page@school.test', { dealId: deal, contactId: c, cents: 120000, supersedes: v1, revision: 2 });
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-05 10:00:00', acceptance_name = 'Dana Whitaker', acceptance_title = 'Business Manager', acceptance_recorded_at = '2026-11-05 10:00:00', acceptance_recorded_by = 'buyer', acceptance_terms_version = '1', acceptance_document_hash = ? WHERE id = ?").run('a'.repeat(64), v2);
  const inv = Number(db.prepare("INSERT INTO invoices (invoice_number, contact_id, status) VALUES ('INV-9', ?, 'unpaid')").run(c).lastInsertRowid);
  db.prepare("INSERT INTO purchases (contact_id, payment_status, payment_method, amount_cents, quote_id, invoice_id, license_status, po_number) VALUES (?, 'pending', 'po', 120000, ?, ?, 'pending', 'PO-9')").run(c, v2, inv);
  await recordQuoteEvent(pool, v2, 'page_opened');

  const r = await call('GET', `/api/crm/opportunities/${deal}`, undefined, viewer);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const quotes = r.json.quotes;
  assert.equal(quotes.length, 2);
  assert.equal(quotes.find(q => q.id === v1).versionStatus, 'superseded');
  const q2 = quotes.find(q => q.id === v2);
  assert.equal(q2.revisionNumber, 2); assert.equal(q2.supersedesQuoteId, v1);
  assert.equal(q2.acceptance.name, null, 'S7: Read-only does not get the signer name'); assert.equal(q2.acceptance.title, null);
  assert.equal(q2.acceptance.by, 'buyer'); assert.equal(q2.acceptance.documentHash.length, 12, 'the hash is shortened for display');
  const asAdmin = (await call('GET', `/api/crm/opportunities/${deal}`, undefined, admin)).json.quotes.find(q => q.id === v2);
  assert.equal(asAdmin.acceptance.name, 'Dana Whitaker'); assert.equal(asAdmin.acceptance.title, 'Business Manager');
  assert.ok(!JSON.stringify(r.json).includes('tok-'), 'no accept token is ever returned');
  assert.deepEqual(r.json.procurement.map(p => p.flags.map(f => f.key)), [['po_not_received', 'invoice_unpaid', 'license_pending']]);
  assert.equal(r.json.procurement[0].poNumber, 'PO-9');
  assert.deepEqual(r.json.quoteEvents.map(e => e.type), ['page_opened']);
  assert.equal(r.json.permissions.acceptForCustomer, false, 'Read-only cannot');
  assert.equal((await call('GET', `/api/crm/opportunities/${deal}`, undefined, admin)).json.permissions.acceptForCustomer, true);

  // Two revisions of one quote are one deal: the forecast adds the deal's own value once.
  const list = await call('GET', '/api/crm/opportunities?state=open&pageSize=200', undefined, admin);
  const mine = list.json.opportunities.filter(o => o.id === deal);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].amountCents, 100000, 'the deal value, not 100000 + 120000');
});

test('NEEDS ATTENTION: a replaced quote no longer shows as "about to run out", the current one does', async () => {
  const { evaluate } = require(path.join(env.SERVER, 'lib/crm-attention.js'));
  const day = '2026-11-14';
  const mk = (versionStatus) => quote(`att-${versionStatus}@school.test`, { versionStatus });
  const current = mk('current'), replaced = mk('superseded');
  db.prepare("UPDATE quote_requests SET quote_valid_until = '2026-11-18' WHERE id IN (?, ?)").run(current, replaced);
  const items = await evaluate(pool, { today: day });
  const ids = items.filter(i => i.ruleKey === 'quote_expiring' || i.rule === 'quote_expiring').map(i => Number(i.subjectId || i.id));
  assert.ok(ids.includes(current), 'the current quote shows');
  assert.ok(!ids.includes(replaced), 'the replaced quote does not');
});

test('SOURCE RULES: the CRM never inserts a purchase or invoice, a revision link never reaches the public page, and no token or address is logged', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const f of ['routes/crm-opportunities.js', 'lib/crm-won.js', 'lib/crm-procurement.js', 'lib/crm-quote-events.js', 'lib/crm-quotes.js']) {
    assert.doesNotMatch(read(f), /INSERT INTO (purchases|invoices|license_seats)/i, `${f} must not write money tables`);
  }
  assert.doesNotMatch(read('lib/crm-quote-events.js'), /req\.|ip_address|user-agent|accept_token/i);
  assert.match(read('routes/quote-accept.js'), /version_status === 'superseded'/);
});
