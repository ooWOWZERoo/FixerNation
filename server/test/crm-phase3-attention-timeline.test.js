// Sales CRM phase 3: Needs Attention (each rule explainable, snooze and dismiss persist, the daily job fires once not twice) and the timeline (every source, paged by 50,
// never student-level data, a demo shown only as "Demo"). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/attention', R('crm-attention.js')], ['/api/crm/timeline', R('crm-timeline.js')], ['/api/crm/tasks', R('crm-tasks.js')]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const sales2 = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const at = (n, time = '12:00:00') => `${day(n)} ${time}`;

const account = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Test District')").run().lastInsertRowid);
const deal = (f = {}) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, next_step, next_step_due_at, stage_entered_at, closed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(account, f.name || 'Deal', f.stage || 2, f.owner === undefined ? sales : f.owner, f.state || 'open', f.nextStep === undefined ? 'Call them' : f.nextStep,
  f.due || null, f.entered || at(-1), f.closed || null).lastInsertRowid);

const overdueDeal = deal({ name: 'Overdue deal', nextStep: 'Send the quote', due: at(-5) });
const adminsDeal = deal({ name: 'Admin deal', owner: admin, nextStep: 'Check in', due: at(-4) });
const ownerless = deal({ name: 'Ownerless deal', owner: null });
const noStep = deal({ name: 'No step deal', nextStep: '', entered: at(-2) });
const quiet = deal({ name: 'Quiet deal', entered: at(-40) });
const notQuiet = deal({ name: 'Noted deal', entered: at(-40) });
db.prepare("INSERT INTO crm_notes (opportunity_id, account_id, body, created_at) VALUES (?, ?, 'Spoke recently', ?)").run(notQuiet, account, at(-2));
const wonNoPurchase = deal({ name: 'Won no purchase', state: 'won', stage: 8, closed: at(-10) });
env.addQuote(db, 'wonnopurchase@school-a.test', { opportunityId: wonNoPurchase }); // punch list B12: the rule needs a quote to have nothing to link
const wonPaid = deal({ name: 'Won with purchase', state: 'won', stage: 8, closed: at(-10) });
const paidQuote = env.addQuote(db, 'buyer@school-a.test', { opportunityId: wonPaid, status: 'converted' });
env.addPurchase(db, env.addContact(db, 'buyer@school-a.test'), { quoteId: paidQuote });
db.prepare("INSERT INTO crm_tasks (opportunity_id, account_id, title, due_on, state, assigned_admin_id) VALUES (?, ?, 'Send the W-9', ?, 'open', ?)").run(overdueDeal, account, day(-3), sales);
db.prepare("INSERT INTO crm_tasks (account_id, title, due_on, state, assigned_admin_id) VALUES (?, 'Future task', ?, 'open', ?)").run(account, day(3), sales);
db.prepare("INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, status, due_on) VALUES (?, 'Vendor form', 'open', ?)").run(overdueDeal, day(-2));
const expiring = env.addQuote(db, 'lead@school-c.test', { opportunityId: overdueDeal, status: 'contacted', sentAt: at(-6), number: 'Q-100' });
db.prepare('UPDATE quote_requests SET quote_valid_until = ? WHERE id = ?').run(day(3), expiring);
const testQuote = env.addQuote(db, 'qa@example.com', { status: 'contacted', sentAt: at(-6) });
db.prepare('UPDATE quote_requests SET quote_valid_until = ? WHERE id = ?').run(day(2), testQuote);

const list = (as, q = '') => call('GET', `/api/crm/attention?today=${TODAY}&pageSize=100${q}`, undefined, as);
const find = (r, rule, subjectId) => r.json.items.find(i => i.ruleKey === rule && i.subjectId === subjectId);

test('OFF SWITCH and ROLES for the list: 404 while off, 401 signed out, every role may read', async () => {
  env.enable(db, false);
  assert.equal((await list(admin)).status, 404);
  env.enable(db, true);
  assert.equal((await call('GET', '/api/crm/attention')).status, 401);
  for (const who of [admin, sales, viewer]) assert.equal((await list(who)).status, 200);
});

test('RULES: each one fires on the right thing, says why in a sentence, and links to the page that shows the evidence', async () => {
  const r = await list(admin);
  const expect = [
    ['next_step_overdue', overdueDeal, /Send the quote.*was due/, `admin-crm-opportunity.html?id=${overdueDeal}`],
    ['no_next_step', noStep, /does not say what happens next/, `admin-crm-opportunity.html?id=${noStep}`],
    ['stale_deal', quiet, /for \d+ days/, `admin-crm-opportunity.html?id=${quiet}`],
    ['no_owner', ownerless, /Nobody owns/, `admin-crm-opportunity.html?id=${ownerless}`],
    ['won_no_purchase', wonNoPurchase, /no purchase is linked/, `admin-crm-opportunity.html?id=${wonNoPurchase}`],
    ['quote_expiring', expiring, /not been accepted/, `admin-crm-opportunity.html?id=${overdueDeal}`],
  ];
  for (const [rule, id, why, link] of expect) {
    const it = find(r, rule, id);
    assert.ok(it, `${rule} fires for ${id}`);
    assert.match(it.why, why, rule);
    assert.equal(it.link, link, rule);
    assert.ok(it.ruleLabel && it.title);
  }
  const task = r.json.items.find(i => i.ruleKey === 'task_overdue');
  assert.match(task.why, /was due/); assert.equal(task.link, `admin-crm-opportunity.html?id=${overdueDeal}`);
  assert.ok(r.json.items.find(i => i.ruleKey === 'checklist_overdue'));
  // What must NOT fire
  assert.ok(!find(r, 'stale_deal', notQuiet), 'a recent note keeps a deal from being quiet');
  assert.ok(!find(r, 'won_no_purchase', wonPaid), 'a deal whose quote has a purchase is fine');
  assert.ok(!r.json.items.some(i => i.ruleKey === 'quote_expiring' && i.subjectId === testQuote), 'a quote to an @example.com address is left out');
  assert.ok(!r.json.items.some(i => i.ruleKey === 'task_overdue' && /Future/.test(i.title)));
  assert.ok(!JSON.stringify(r.json).match(/\bviewed\b/i), 'never claims a quote was viewed');
  assert.equal(r.json.counts.next_step_overdue, 2);
  assert.equal(r.json.activeTotal, Object.values(r.json.counts).reduce((a, b) => a + b, 0));
  assert.equal((await list(admin, '&rule=no_owner')).json.items.length, 1);
  const mine = await list(sales, '&owner=me');
  assert.ok(mine.json.items.every(i => i.ownerAdminId === sales) && !find(mine, 'next_step_overdue', adminsDeal));
  assert.equal((await call('GET', '/api/crm/attention/rules', undefined, viewer)).json.rules.length, 17);
});

test('SNOOZE persists until its day, then the item comes back; Read-only and other people\'s deals are refused', async () => {
  const item = { ruleKey: 'next_step_overdue', subjectType: 'opportunity', subjectId: overdueDeal, today: TODAY };
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: day(7) }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: day(7) }, sales2)).status, 403, 'not their deal');
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: TODAY }, sales)).status, 400, 'a snooze must end after today');
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: day(900) }, sales)).status, 400);
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, subjectId: 99999, until: day(7) }, sales)).status, 404, 'an item that is not raised cannot be snoozed');
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: day(7), reason: 'Waiting on their board meeting' }, sales)).status, 200);

  assert.ok(get("SELECT * FROM crm_attention_states WHERE rule_key = 'next_step_overdue' AND subject_id = ?", overdueDeal), 'stored in the database, not in the browser');
  assert.ok(!find(await list(admin), 'next_step_overdue', overdueDeal), 'hidden from everyone\'s active list');
  const held = await list(admin, '&status=snoozed');
  const it = find(held, 'next_step_overdue', overdueDeal);
  assert.equal(it.status, 'snoozed'); assert.equal(it.stateReason, 'Waiting on their board meeting'); assert.equal(it.stateBy, 'rep');
  assert.equal(held.json.snoozedTotal, 1);

  db.prepare("UPDATE crm_attention_states SET snooze_until = ? WHERE rule_key = 'next_step_overdue'").run(at(-1));
  assert.ok(find(await list(admin), 'next_step_overdue', overdueDeal), 'an ended snooze brings the item back');

  await call('POST', '/api/crm/attention/snooze', { ...item, until: day(7) }, sales);
  assert.ok(!find(await list(admin), 'next_step_overdue', overdueDeal));
  assert.equal((await call('POST', '/api/crm/attention/restore', item, sales)).status, 200);
  assert.ok(find(await list(admin), 'next_step_overdue', overdueDeal), 'restore brings it back at once');
});

test('DISMISS persists until the thing changes: a new due date that is missed raises it again', async () => {
  const item = { ruleKey: 'next_step_overdue', subjectType: 'opportunity', subjectId: adminsDeal, today: TODAY };
  assert.equal((await call('POST', '/api/crm/attention/dismiss', item, sales)).status, 403, 'Sales cannot dismiss an item on the CRM Admin\'s deal');
  assert.equal((await call('POST', '/api/crm/attention/dismiss', item, admin)).status, 200);
  assert.ok(!find(await list(admin), 'next_step_overdue', adminsDeal));
  assert.equal((await list(admin, '&status=dismissed')).json.dismissedTotal, 1);
  assert.ok(!find(await list(admin), 'next_step_overdue', adminsDeal), 'still gone on the next look');
  db.prepare('UPDATE crm_opportunities SET next_step_due_at = ? WHERE id = ?').run(at(-1), adminsDeal);
  assert.ok(find(await list(admin), 'next_step_overdue', adminsDeal), 'a different due date is a different problem, so it is back');
  assert.ok(find(await list(admin), 'next_step_overdue', adminsDeal).status === 'active');
});

test('A task assigned to a Sales user can be snoozed by them even when it sits on a deal that is not theirs', async () => {
  const t = Number(db.prepare("INSERT INTO crm_tasks (opportunity_id, account_id, title, due_on, state, assigned_admin_id) VALUES (?, ?, 'Mine on theirs', ?, 'open', ?)").run(adminsDeal, account, day(-1), sales).lastInsertRowid);
  const item = { ruleKey: 'task_overdue', subjectType: 'task', subjectId: t, today: TODAY };
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: day(3) }, sales)).status, 200);
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...item, until: day(3) }, sales2)).status, 403);
});

// ---- The daily job ------------------------------------------------------------------------------------------------------------------

test('DAILY JOB: fires once per item and once per due date, never twice; a report run changes nothing; snoozed items are not fired', async () => {
  const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
  const now = `${TODAY} 06:50:00`;
  const dry = await A.runDaily(pool, { apply: false, now });
  assert.ok(dry.fresh > 0);
  assert.equal(all('SELECT * FROM crm_attention_events').length, 0, 'a report run writes nothing');
  const first = await A.runDaily(pool, { apply: true, now });
  assert.equal(first.fresh, dry.fresh);
  assert.equal(all('SELECT * FROM crm_attention_events').length, first.fresh);
  const second = await A.runDaily(pool, { apply: true, now });
  assert.equal(second.fresh, 0, 'the second run fires nothing');
  assert.equal(all('SELECT * FROM crm_attention_events').length, first.fresh, 'and writes nothing');
  // A new occurrence (the deal gets a new due date and misses it too) is new news.
  db.prepare('UPDATE crm_opportunities SET next_step_due_at = ? WHERE id = ?').run(at(-2), overdueDeal);
  db.prepare("DELETE FROM crm_attention_states WHERE rule_key = 'next_step_overdue' AND subject_id = ?").run(overdueDeal);
  assert.equal((await A.runDaily(pool, { apply: true, now })).fresh, 1);
  assert.equal((await A.runDaily(pool, { apply: true, now })).fresh, 0);
  // A snoozed item does not fire.
  const quietId = deal({ name: 'Brand new overdue', nextStep: 'x', due: at(-3) });
  await call('POST', '/api/crm/attention/snooze', { ruleKey: 'next_step_overdue', subjectType: 'opportunity', subjectId: quietId, until: day(5), today: TODAY }, admin);
  assert.equal((await A.runDaily(pool, { apply: true, now })).fresh, 0, 'held items are left alone');
});

test('DAILY JOB DIGEST: only when switched on, one email per owner, each item mentioned in one email ever', async () => {
  const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
  const now = `${TODAY} 06:50:00`;
  const fresh = deal({ name: 'Fresh overdue for digest', owner: sales, nextStep: 'Ring them', due: at(-6) });
  const mails = [];
  const off = await A.runDaily(pool, { apply: true, now });          // digest off: sendDigest not given
  assert.equal(off.digests, 0); assert.equal(off.fresh, 1);
  assert.equal(get('SELECT emailed_at FROM crm_attention_events WHERE subject_id = ? AND rule_key = ?', fresh, 'next_step_overdue').emailed_at, null);

  const fresh2 = deal({ name: 'Second overdue for digest', owner: sales, nextStep: 'Ring them too', due: at(-7) });
  const on = await A.runDaily(pool, { apply: true, now, sendDigest: async (to, items) => { mails.push({ to, n: items.length }); } });
  assert.equal(on.fresh, 1);
  assert.deepEqual(mails, [{ to: 'rep@example.com', n: 1 }], 'one email to the owner, naming only the new item');
  assert.ok(get('SELECT emailed_at FROM crm_attention_events WHERE subject_id = ? AND rule_key = ?', fresh2, 'next_step_overdue').emailed_at);
  const again = await A.runDaily(pool, { apply: true, now, sendDigest: async (to, items) => { mails.push({ to, n: items.length }); } });
  assert.equal(again.fresh, 0); assert.equal(mails.length, 1, 'a second run sends nothing');
  // Punch list S14: a failed send takes the item back out of "first seen", so the next run finds it new and mails it (it used to be marked seen and never mailed).
  const fresh3 = deal({ name: 'Third', owner: sales, nextStep: 'x', due: at(-8) });
  const failed = await A.runDaily(pool, { apply: true, now, sendDigest: async () => { throw new Error('smtp down'); } });
  assert.equal(failed.fresh, 1); assert.equal(failed.digests, 0);
  assert.equal(get('SELECT emailed_at FROM crm_attention_events WHERE subject_id = ? AND rule_key = ?', fresh3, 'next_step_overdue'), undefined, 'no "seen" row is left behind');
  const retried = await A.runDaily(pool, { apply: true, now, sendDigest: async (to, items) => { mails.push({ to, n: items.length }); } });
  assert.equal(retried.fresh, 1); assert.equal(retried.digests, 1);
  assert.deepEqual(mails[1], { to: 'rep@example.com', n: 1 }, 'the item that failed is mailed on the next run');
  assert.ok(get('SELECT emailed_at FROM crm_attention_events WHERE subject_id = ? AND rule_key = ?', fresh3, 'next_step_overdue').emailed_at);
  // An owner with no email address yet: nothing is sent and the item is not used up either.
  db.prepare("UPDATE admin_users SET email = NULL WHERE id = ?").run(sales);
  const fresh4 = deal({ name: 'Fourth', owner: sales, nextStep: 'y', due: at(-9) });
  const noAddr = await A.runDaily(pool, { apply: true, now, sendDigest: async () => { throw new Error('should not be called'); } });
  assert.equal(noAddr.digests, 0);
  assert.equal(get('SELECT emailed_at FROM crm_attention_events WHERE subject_id = ? AND rule_key = ?', fresh4, 'next_step_overdue'), undefined);
  db.prepare("UPDATE admin_users SET email = 'rep@example.com' WHERE id = ?").run(sales);
});

test('CRON FILES: the job is scheduled once a day, does nothing while the Hub is off, and the setup script lists it', () => {
  const fs = require('node:fs');
  const setup = fs.readFileSync(path.join(env.SERVER, 'scripts/setup-cron-jobs.sh'), 'utf8');
  assert.match(setup, /50 6 \* \* \* \$NODE \$SCRIPTS\/crm-daily-attention\.js --apply --only-if-enabled/);
  const script = fs.readFileSync(path.join(env.SERVER, 'scripts/crm-daily-attention.js'), 'utf8');
  assert.match(script, /--only-if-enabled/); assert.match(script, /crm_v2_enabled/); assert.match(script, /crm_attention_email/);
  assert.doesNotMatch(script, /createTransport/);
});

// ---- Timeline ---------------------------------------------------------------------------------------------------------------------

const tlAccount = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Timeline District')").run().lastInsertRowid);
const tlContact = env.addContact(db, 'tl.person@school-t.test', 'Tina Timeline');
db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(tlAccount, tlContact);
const tlDeal = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, next_step) VALUES (?, 'Timeline deal', 2, ?, 'x')").run(tlAccount, sales).lastInsertRowid);
db.prepare("INSERT INTO crm_pipeline_stages (stage_key, label, sort_order, default_probability) VALUES ('tl_x', 'TL', 99, 1)").run();
db.prepare('INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, actor_admin_id, reason, created_at) VALUES (?, 1, 2, ?, ?, ?, ?, ?)').run(tlDeal, 'open', 'open', sales, 'Qualified after a call', '2026-03-01 10:00:00');
db.prepare("INSERT INTO crm_notes (opportunity_id, account_id, kind, body, created_by_admin_id, created_at) VALUES (?, ?, 'call', 'Talked pricing with Tina', ?, '2026-03-02 09:00:00')").run(tlDeal, tlAccount, sales);
db.prepare("INSERT INTO crm_notes (contact_id, kind, body, created_by_admin_id, created_at) VALUES (?, 'note', 'Contact-only note', ?, '2026-03-03 09:00:00')").run(tlContact, sales);
db.prepare("INSERT INTO crm_tasks (opportunity_id, account_id, title, state, assigned_admin_id, created_by_admin_id, created_at, completed_at, completed_by_admin_id) VALUES (?, ?, 'Send agreement', 'done', ?, ?, '2026-03-04 09:00:00', '2026-03-05 09:00:00', ?)").run(tlDeal, tlAccount, sales, sales, sales);
db.prepare("INSERT INTO crm_appointments (opportunity_id, account_id, title, starts_at, ends_at, uid, status) VALUES (?, ?, 'Walkthrough', '2026-03-06 15:00:00', '2026-03-06 15:30:00', 'uid-tl-1', 'scheduled')").run(tlDeal, tlAccount);
db.prepare("INSERT INTO crm_attachments (opportunity_id, account_id, original_name, stored_name, kind, mime, size_bytes, created_at) VALUES (?, ?, 'purchase-order.pdf', ?, 'pdf', 'application/pdf', 10, '2026-03-07 09:00:00')").run(tlDeal, tlAccount, 'a'.repeat(32) + '.bin');
db.prepare("INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, status, completed_at) VALUES (?, 'W-9 sent', 'done', '2026-03-08 09:00:00')").run(tlDeal);
db.prepare("INSERT INTO crm_classification_events (contact_id, from_classification, to_classification, event_type, reason, created_at) VALUES (?, 'suspect', 'prospect', 'quote_request', 'secret evidence text', '2026-03-09 09:00:00')").run(tlContact);
db.prepare("INSERT INTO public_demo_invitations (label, workspace_id, status, starts_at, ends_at, ended_at) VALUES ('Secret Group Label', 1, 'ended', '2026-02-20 14:00:00', '2026-02-27 14:00:00', '2026-02-27 14:00:00')").run();
const tlQuote = env.addQuote(db, 'tl.person@school-t.test', { contactId: tlContact, opportunityId: tlDeal, sentAt: '2026-03-10 09:00:00', number: 'Q-777', status: 'converted' });
db.prepare("UPDATE quote_requests SET accepted_at = '2026-03-11 09:00:00', demo_invitation_id = 1 WHERE id = ?").run(tlQuote);
db.prepare("INSERT INTO purchases (contact_id, payment_status, payment_method, amount_cents, purchased_at, quote_id) VALUES (?, 'paid', 'po', 120000, '2026-03-12 09:00:00', ?)").run(tlContact, tlQuote);
const tlInvoice = Number(db.prepare("INSERT INTO invoices (contact_id, invoice_number, status, created_at) VALUES (?, 'INV-1', 'paid', '2026-03-13 09:00:00')").run(tlContact).lastInsertRowid);
db.prepare('UPDATE purchases SET invoice_id = ? WHERE quote_id = ?').run(tlInvoice, tlQuote);
db.prepare("INSERT INTO support_requests (ref, status, category, subject, requester_name, requester_email, created_at, demo_invitation_id) VALUES ('SR-ABCDE', 'open', 'roster', 'Alex Student cannot log in to class 4B', 'Parent Name', 'tl.person@school-t.test', '2026-03-14 09:00:00', 1)").run();
db.prepare("INSERT INTO campaigns (subject) VALUES ('Fall news')").run();
db.prepare("INSERT INTO campaign_sends (campaign_id, contact_id, email, status, sent_at, opened_at) VALUES (1, ?, 'tl.person@school-t.test', 'sent', '2026-03-15 09:00:00', '2026-03-15 10:00:00')").run(tlContact);

const tl = (q, as = viewer) => call('GET', `/api/crm/timeline?${q}`, undefined, as);

test('TIMELINE: every source shows, newest first, for a contact, an account and a deal', async () => {
  const types = (r) => new Set(r.json.events.map(e => e.type));
  const c = await tl(`contactId=${tlContact}`, admin);
  assert.equal(c.status, 200);
  for (const t of ['note', 'quote', 'purchase', 'invoice', 'support', 'campaign', 'label', 'demo']) assert.ok(types(c).has(t), `contact timeline has ${t}`);
  assert.ok(!c.json.events.some(e => e.detail === 'Talked pricing with Tina'), 'a deal\'s note is not on the contact timeline');
  const a = await tl(`accountId=${tlAccount}`, admin);
  for (const t of ['note', 'task', 'meeting', 'file', 'stage', 'checklist', 'quote', 'purchase', 'invoice', 'support', 'campaign', 'label', 'demo']) assert.ok(types(a).has(t), `account timeline has ${t}`);
  assert.ok(a.json.events.some(e => e.detail === 'Talked pricing with Tina'));
  const at = a.json.events.map(e => e.at);
  assert.deepEqual(at, [...at].sort().reverse(), 'newest first');
  const d = await tl(`opportunityId=${tlDeal}`, admin);
  for (const t of ['note', 'task', 'meeting', 'file', 'stage', 'checklist', 'quote', 'purchase', 'invoice', 'demo']) assert.ok(types(d).has(t), `deal timeline has ${t}`);
  assert.ok(!types(d).has('support') && !types(d).has('campaign') && !types(d).has('label'), 'a deal timeline carries no contact-level events');
  assert.ok(a.json.events.find(e => e.type === 'quote' && /Q-777/.test(e.detail)).link.includes(`id=${tlDeal}`), 'a quote links to its deal');
});

test('TIMELINE PRIVACY: no student-level data, no group name, no viewed claim, no evidence text', async () => {
  for (const q of [`contactId=${tlContact}`, `accountId=${tlAccount}`, `opportunityId=${tlDeal}`]) {
    const text = JSON.stringify((await tl(q)).json);
    assert.ok(!text.includes('Alex Student'), 'a support request\'s subject never appears');
    assert.ok(!text.includes('Parent Name'), 'nor the requester\'s name');
    assert.ok(!text.includes('Secret Group Label'), 'the demo group\'s name stays staff-only and off the timeline');
    assert.ok(!text.includes('secret evidence text'), 'label changes show the label, not the evidence');
    assert.doesNotMatch(text, /\bviewed\b/i);
  }
  const support = (await tl(`contactId=${tlContact}`)).json.events.find(e => e.type === 'support');
  assert.equal(support.detail, 'SR-ABCDE · roster · open', 'reference, category and status only');
  const demos = (await tl(`accountId=${tlAccount}`)).json.events.filter(e => e.type === 'demo');
  assert.equal(demos.length, 1, 'one demo, shown once even though a quote and a request both came from it');
  assert.equal(demos[0].title, 'Demo'); assert.match(demos[0].detail, /2026-02-20 to 2026-02-27/);
  // Static guard: the timeline code never reads a student, class or roster table.
  const src = require('node:fs').readFileSync(path.join(env.SERVER, 'lib/crm-timeline.js'), 'utf8');
  assert.doesNotMatch(src, /\b(students?|classrooms?|rosters?|class_students|student_progress)\b\s*(?:s|\bON\b|WHERE|\()|FROM\s+(students?|classrooms?|class_)/i);
  const supportSelect = src.match(/add\('ticket'[\s\S]*?select: '([^']*)'/)[1];
  assert.equal(supportSelect, 'r.id, r.ref, r.category, r.status, r.created_at AS at', 'the support query selects the reference, category and status and nothing else');
});

test('TIMELINE PAGING: 50 at a time, nothing repeated or lost across pages', async () => {
  const c = env.addContact(db, 'busy@school-t.test', 'Busy Person');
  const ins = db.prepare("INSERT INTO crm_notes (contact_id, body, created_at) VALUES (?, ?, ?)");
  for (let i = 0; i < 60; i++) ins.run(c, `note ${i}`, `2026-04-01 ${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`);
  const p1 = await tl(`contactId=${c}`), p2 = await tl(`contactId=${c}&page=2`), p3 = await tl(`contactId=${c}&page=3`);
  assert.equal(p1.json.events.length, 50); assert.equal(p2.json.events.length, 10); assert.equal(p3.json.events.length, 0);
  assert.equal(p1.json.total, 60); assert.equal(p1.json.pageSize, 50);
  const ids = [...p1.json.events, ...p2.json.events].map(e => e.id);
  assert.equal(new Set(ids).size, 60, 'no repeats');
  assert.equal(p1.json.events[0].detail, 'note 59'); assert.equal(p2.json.events[9].detail, 'note 0');
  assert.equal((await tl(`contactId=${c}&pageSize=500`)).json.pageSize, 50, 'the page size cannot be raised above 50');
});

test('TIMELINE ACCESS: a subject is required and must exist; 404 while off; 401 signed out', async () => {
  assert.equal((await tl('')).status, 400);
  assert.equal((await tl(`contactId=${tlContact}&accountId=${tlAccount}`)).status, 400);
  assert.equal((await tl('contactId=99999')).status, 404);
  assert.equal((await tl('accountId=abc')).status, 400);
  assert.equal((await call('GET', `/api/crm/timeline?contactId=${tlContact}`)).status, 401);
  env.enable(db, false);
  assert.equal((await tl(`contactId=${tlContact}`, admin)).status, 404);
  env.enable(db, true);
});

test('S7: file entries on the timeline follow the Files rule: Read-only sees none, Sales sees files on deals they own or nobody owns, CRM Admin sees all', async () => {
  const names = (r) => r.json.events.filter(e => e.type === 'file').map(e => e.detail);
  // tlDeal belongs to `sales`; add a file on a deal that belongs to `sales2` and one on an ownerless deal, same account.
  const theirs = deal({ name: 'Rep2 deal', owner: sales2 });
  const nobody = deal({ name: 'Nobody deal', owner: null });
  const addFile = (d, n) => db.prepare("INSERT INTO crm_attachments (opportunity_id, account_id, original_name, stored_name, kind, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, 'pdf', 'application/pdf', 10, '2026-03-08 09:00:00')").run(d, tlAccount, n, n.replace(/\W/g, '').padEnd(32, 'a').slice(0, 32) + '.bin');
  addFile(theirs, 'rep2-w9.pdf'); addFile(nobody, 'nobody-contract.pdf');
  const q = `accountId=${tlAccount}`;
  const asAdmin = names(await tl(q, admin));
  assert.ok(asAdmin.includes('purchase-order.pdf') && asAdmin.includes('rep2-w9.pdf') && asAdmin.includes('nobody-contract.pdf'), 'CRM Admin sees every file');
  const asSales = names(await tl(q, sales));
  assert.ok(asSales.includes('purchase-order.pdf') && asSales.includes('nobody-contract.pdf'), 'Sales sees their own deal and an ownerless one');
  assert.ok(!asSales.includes('rep2-w9.pdf'), 'Sales does not see the other rep\'s file name');
  const asViewer = await tl(q, viewer);
  assert.equal(asViewer.status, 200);
  assert.deepEqual(names(asViewer), [], 'Read-only sees no file entries');
  assert.ok(!JSON.stringify(asViewer.json).includes('purchase-order') && !JSON.stringify(asViewer.json).includes('rep2-w9'));
  assert.ok(asViewer.json.events.length > 0, 'the rest of the timeline still shows');
});
