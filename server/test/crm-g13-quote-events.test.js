// Sales CRM punch list G13 (PRD QUOTE-03), the staff and CRM side: recording or undoing a decline by hand, the deal page payload, the "Quote was declined" Needs Attention item, the
// 'send_failed' event when the mail server refuses a quote email, the 'expired' event from the daily check, and the follow-up job leaving declined quotes alone.
// Real routes and real SQL (node:sqlite) from test/helpers/crm-env.js. The customer's own decline (the public route) is in crm-g13-quote-decline.test.js. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
db.exec('CREATE TABLE crm_quote_followup_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, task_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (quote_id))');
let failSend = null;
const mailerStub = new Proxy({ sendQuoteEmail: async () => { if (failSend) throw failSend; } }, { get: (t, k) => (k in t ? t[k] : async () => {}) });
env.install(pool, { [path.join(env.SERVER, 'lib/mailer.js')]: mailerStub, [path.join(env.SERVER, 'routes/quote-accept.js')]: { router: require('express').Router(), acceptQuoteViaPO: async () => { throw new Error('not used'); } } });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/opportunities', R('crm-opportunities.js')], ['/api/contact', R('contact.js')], ['/api/crm/attention', R('crm-attention.js')]]);
test.after(() => server.close());
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const QE = require(path.join(env.SERVER, 'lib/crm-quote-events.js'));
const QF = require(path.join(env.SERVER, 'lib/crm-quote-followups.js'));

const admin = env.addAdmin(db, 'g13boss', 'admin'), sales = env.addAdmin(db, 'g13rep', 'sales'), viewer = env.addAdmin(db, 'g13viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const ymd = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const TODAY = ymd(0);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('G13 District', 'district')").run().lastInsertRowid);
let n = 700;
function deal(f = {}) { return Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state, owner_admin_id, stage_entered_at) VALUES (?, ?, 1, ?, ?, '2026-11-01 10:00:00')").run(acct, `G13 deal ${n++}`, f.state || 'open', f.owner === undefined ? sales : f.owner).lastInsertRowid); }
// A sent quote. f: deal (id, or null for no deal), sentDaysAgo, validUntilDays, email, version, status.
function quote(f = {}) {
  const email = f.email || `g13-${n}@school.test`;
  const id = Number(db.prepare(`INSERT INTO quote_requests (quote_number, email, status, accept_token, quoted_amount_cents, opportunity_id, first_name, last_name, school, quoted_product_name, quote_sent_at, quote_valid_until, version_status)
    VALUES (?, ?, ?, ?, 50000, ?, 'Pat', 'Example', 'Sample Elementary', 'Group license', ?, ?, ?)`)
    .run(`Q${n++}`, email, f.status || 'contacted', `tok-${n}`, f.deal === undefined ? null : f.deal, `${ymd(-(f.sentDaysAgo === undefined ? 20 : f.sentDaysAgo))} 10:00:00`, f.validUntilDays === undefined ? null : ymd(f.validUntilDays), f.version || 'current').lastInsertRowid);
  return id;
}
const row = (id) => get('SELECT * FROM quote_requests WHERE id = ?', id);
const events = (id, type) => all('SELECT * FROM crm_quote_events WHERE quote_id = ?' + (type ? ' AND event_type = ?' : '') + ' ORDER BY id', ...(type ? [id, type] : [id]));
const reset = () => db.exec('DELETE FROM crm_quote_followup_tasks; DELETE FROM crm_tasks; DELETE FROM crm_quote_events; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM school_audit_log; DELETE FROM crm_attention_states; DELETE FROM crm_attention_events');
const dec = (id, who = admin, body = { reason: 'They went with someone else' }) => call('POST', `/api/contact/quotes/${id}/decline`, body, who);

test('STAFF RECORD A DECLINE: CRM Admin and Sales may; Read-only and a signed-out caller may not; the deal stays open and nothing is priced; the reason and actor are kept', async () => {
  reset();
  const d = deal(); const q = quote({ deal: d });
  assert.equal((await dec(q, viewer)).status, 403); assert.equal((await call('POST', `/api/contact/quotes/${q}/decline`, {})).status, 401);
  assert.equal(row(q).declined_at, null);
  const r = await dec(q, sales);
  assert.equal(r.status, 200); assert.equal(r.json.already, false);
  const x = row(q);
  assert.ok(x.declined_at); assert.equal(x.declined_by, 'staff'); assert.equal(x.decline_reason, 'They went with someone else'); assert.equal(x.quoted_amount_cents, 50000);
  assert.equal(get('SELECT state FROM crm_opportunities WHERE id = ?', d).state, 'open', 'the deal is not closed');
  const e = events(q, 'declined'); assert.equal(e.length, 1); assert.equal(e[0].actor_admin_id, sales); assert.match(e[0].detail, /recorded by staff: They went with someone else/);
  assert.equal(get("SELECT actor_type FROM school_audit_log WHERE action = 'crm_quote_declined'").actor_type, 'admin');
  assert.equal((await dec(q, admin)).json.already, true, 'a second record changes nothing'); assert.equal(events(q, 'declined').length, 1);
  assert.equal((await dec(999999)).status, 404);
  const acc = quote({ deal: d }); db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-10 10:00:00' WHERE id = ?").run(acc);
  assert.equal((await dec(acc)).status, 409); assert.equal((await dec(quote({ deal: d, version: 'superseded' }))).status, 409);
});

test('UNDO: put it back; the event is kept; Read-only may not; a quote that is not declined is refused', async () => {
  reset();
  const q = quote({ deal: deal() });
  assert.equal((await call('POST', `/api/contact/quotes/${q}/undo-decline`, {}, admin)).status, 409);
  await dec(q);
  assert.equal((await call('POST', `/api/contact/quotes/${q}/undo-decline`, { reason: 'Mistake' }, viewer)).status, 403);
  assert.ok(row(q).declined_at);
  const r = await call('POST', `/api/contact/quotes/${q}/undo-decline`, { reason: 'Mistake' }, sales);
  assert.equal(r.status, 200); assert.equal(row(q).declined_at, null); assert.equal(row(q).decline_reason, null);
  assert.equal(events(q, 'decline_undone').length, 1); assert.equal(events(q, 'decline_undone')[0].detail, 'Mistake');
  assert.ok(get("SELECT id FROM school_audit_log WHERE action = 'crm_quote_decline_undone'"));
});

test('THE DEAL PAGE: shows who declined and when; the reason (the customer\'s own words) only to roles that can write', async () => {
  reset();
  const d = deal(); const q = quote({ deal: d });
  await dec(q, admin, { reason: '<b>too</b> costly' });
  const a = (await call('GET', `/api/crm/opportunities/${d}`, undefined, admin)).json.quotes[0];
  assert.equal(a.declined.by, 'staff'); assert.equal(a.declined.reason, '<b>too</b> costly', 'stored as text; the page escapes it');
  const v = (await call('GET', `/api/crm/opportunities/${d}`, undefined, viewer)).json.quotes[0];
  assert.equal(v.declined.by, 'staff'); assert.equal(v.declined.reason, null);
  const plain = quote({ deal: d });
  assert.equal((await call('GET', `/api/crm/opportunities/${d}`, undefined, admin)).json.quotes.find(x => x.id === plain).declined, null);
});

test('NEEDS ATTENTION: a declined quote on an open deal is its own item, and it leaves the "no answer" and "runs out soon" lists; closing the deal, a revision or a test address clears it', async () => {
  reset();
  const d = deal(), d2 = deal();
  const declined = quote({ deal: d, sentDaysAgo: 30, validUntilDays: 3 });       // would be "no answer" and "runs out soon" if it were not declined
  const open = quote({ deal: d2, sentDaysAgo: 30, validUntilDays: 3 });           // the same, not declined
  await dec(declined);
  const items = async (rule) => (await A.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === rule);
  const di = await items('quote_declined');
  assert.equal(di.length, 1); assert.equal(di[0].subjectId, declined); assert.equal(di[0].subjectType, 'quote'); assert.equal(di[0].ownerAdminId, sales); assert.equal(di[0].dealId, d);
  assert.match(di[0].why, /Send a revised quote, or close the deal as Lost/);
  assert.deepEqual((await items('quote_unanswered')).map(i => i.subjectId), [open], 'the declined one is answered');
  assert.deepEqual((await items('quote_expiring')).map(i => i.subjectId), [open]);
  db.prepare("UPDATE crm_opportunities SET state = 'lost' WHERE id = ?").run(d);
  assert.equal((await items('quote_declined')).length, 0, 'a closed deal needs no decision');
  db.prepare("UPDATE crm_opportunities SET state = 'open' WHERE id = ?").run(d);
  db.prepare("UPDATE quote_requests SET version_status = 'superseded' WHERE id = ?").run(declined);
  assert.equal((await items('quote_declined')).length, 0, 'a revision replaced it');
  db.prepare("UPDATE quote_requests SET version_status = 'current', email = 'qa@example.com' WHERE id = ?").run(declined);
  assert.equal((await items('quote_declined')).length, 0, 'a test address is left out');
  assert.equal(Object.keys(A.RULES).length, 18); assert.ok(A.RULES.quote_declined.help);
  assert.ok(fs.readFileSync(path.join(env.SERVER, 'routes/crm-attention.js'), 'utf8').includes("'quote_declined'"));
});

test('THE FOLLOW-UP TASK (G20): a declined quote gets none', async () => {
  reset();
  const q1 = quote({ deal: deal(), sentDaysAgo: 8 }), q2 = quote({ deal: deal(), sentDaysAgo: 8 });
  await dec(q1);
  const r = await QF.createFollowUps(pool, { apply: true, now: `${TODAY} 06:50:00`, today: TODAY });
  assert.equal(r.eligible, 1); assert.equal(r.made, 1);
  assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks WHERE quote_id = ?', q1).n, 0); assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks WHERE quote_id = ?', q2).n, 1);
});

test('SEND FAILED: when the mail server refuses a quote email the quote records it (the error code only, never the address) and is not marked sent', async () => {
  reset();
  const d = deal();
  const id = Number(db.prepare(`INSERT INTO quote_requests (quote_number, email, status, accept_token, first_name, last_name, school, opportunity_id) VALUES ('QSEND', 'someone@bounce.test', 'new', 'tok-send', 'Pat', 'Example', 'Sample Elementary', ?)`).run(d).lastInsertRowid);
  failSend = Object.assign(new Error('550 5.1.1 <someone@bounce.test> user unknown'), { responseCode: 550 });
  const r = await call('POST', `/api/contact/quotes/${id}/send`, { quotedProductName: 'Group license', quotedAmountCents: 45000, quotedSeatCount: 10 }, admin);
  failSend = null;
  assert.equal(r.status, 500);
  const e = events(id, 'send_failed'); assert.equal(e.length, 1); assert.equal(e[0].detail, 'mail server code 550'); assert.doesNotMatch(JSON.stringify(e), /bounce\.test|someone/);
  assert.equal(row(id).quote_sent_at, null, 'nothing says it was sent'); assert.equal(events(id, 'sent').length, 0);
});

test('EXPIRED: one event per unanswered quote past its valid-until date, once ever, never for a declined, accepted, replaced or test quote; a dry run writes nothing', async () => {
  reset();
  const d = deal();
  const gone = quote({ deal: d, validUntilDays: -3 });
  quote({ deal: d, validUntilDays: 5 });                                          // still valid
  quote({ deal: d });                                                             // no end date
  const declined = quote({ deal: d, validUntilDays: -3 }); await dec(declined);
  const accepted = quote({ deal: d, validUntilDays: -3 }); db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-10 10:00:00' WHERE id = ?").run(accepted);
  quote({ deal: d, validUntilDays: -3, version: 'superseded' });
  quote({ deal: d, validUntilDays: -3, email: 'qa@example.com' });
  const dry = await QE.recordExpired(pool, { today: TODAY, apply: false });
  assert.equal(dry.eligible, 1); assert.equal(dry.made, 0); assert.equal(events(gone, 'expired').length, 0);
  const a = await QE.recordExpired(pool, { today: TODAY, apply: true });
  assert.equal(a.made, 1); assert.equal(events(gone, 'expired').length, 1); assert.equal(events(gone, 'expired')[0].detail, `valid until ${ymd(-3)}`);
  const b = await QE.recordExpired(pool, { today: TODAY, apply: true });
  assert.equal(b.eligible, 0, 'it has its event now'); assert.equal(b.made, 0); assert.equal(events(gone, 'expired').length, 1);
  assert.equal(get("SELECT COUNT(*) n FROM crm_quote_events WHERE event_type = 'expired'").n, 1);
  assert.equal(row(gone).status, 'contacted', 'nothing about the quote changed');
});

test('THE TIMELINE AND THE DEAL PAGE NAME THE NEW EVENTS, and the daily job reports expired quotes', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const tl = read('lib/crm-timeline.js'); for (const t of ['declined', 'decline_undone', 'send_failed', 'expired']) assert.match(tl, new RegExp(`'${t}'`));
  const page = read('../admin-crm-opportunity.html'); for (const t of ['Quote declined', 'Quote decline undone', 'Quote email could not be sent', 'Quote expired with no answer']) assert.match(page, new RegExp(t));
  assert.match(read('scripts/crm-daily-attention.js'), /QE\.recordExpired/);
});
