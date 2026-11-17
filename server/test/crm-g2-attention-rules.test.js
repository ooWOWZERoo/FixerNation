// Sales CRM punch list G2 (PRD FR-ACT-05): the Needs Attention rules the first build lacked (quote unanswered, expected close date passed, purchase order not received,
// trial ending, trial well used) and the thresholds behind every rule, changeable by a CRM Admin only. Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER)");
// setSetting() uses MySQL's ON DUPLICATE KEY; give the settings table a real upsert here.
const baseQuery = pool.query;
pool.query = (sql, params) => {
  if (/INSERT INTO settings \(setting_key, setting_value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE setting_value = \?/.test(String(sql))) {
    return baseQuery('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', [params[0], params[1]]);
  }
  return baseQuery(sql, params);
};
env.install(pool);
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const { server, call } = env.listen([['/api/crm/attention', require(path.join(env.SERVER, 'routes/crm-attention.js'))]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const at = (n, time = '12:00:00') => `${day(n)} ${time}`;
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('G2 District')").run().lastInsertRowid);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const mkDeal = (f = {}) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, next_step, stage_entered_at, expected_close_date)
  VALUES (?, ?, ?, ?, ?, 'Call them', ?, ?)`).run(acct, f.name || 'G2 deal', stage('qualified'), f.owner === undefined ? sales : f.owner, f.state || 'open', at(-1), f.close || null).lastInsertRowid);
const fired = async (rule, thresholds) => (await A.evaluate(pool, { today: TODAY, thresholds })).filter(i => i.ruleKey === rule);
const titles = (items) => items.map(i => i.title).sort();

// ---- quote unanswered ----------------------------------------------------------------------------------------------------------------
test('QUOTE UNANSWERED: a sent quote with no answer after the threshold, never one accepted, replaced, still a draft, on a closed deal or for a test address; it never says "viewed"', async () => {
  const live = mkDeal({ name: 'live deal' }), lost = mkDeal({ name: 'lost deal', state: 'lost' });
  const q = (number, f = {}) => { const id = env.addQuote(db, f.email || 'buyer@school.test', { number, opportunityId: f.deal === undefined ? live : f.deal, sentAt: f.sent === undefined ? at(-20) : f.sent, status: f.status || 'contacted' });
    if (f.accepted) db.prepare('UPDATE quote_requests SET accepted_at = ? WHERE id = ?').run(at(-1), id);
    if (f.superseded) db.prepare("UPDATE quote_requests SET version_status = 'superseded' WHERE id = ?").run(id);
    return id; };
  q('Q-OLD'); q('Q-NODEAL', { deal: null }); q('Q-RECENT', { sent: at(-5) }); q('Q-ACCEPTED', { accepted: true }); q('Q-REPLACED', { superseded: true });
  q('Q-DRAFT', { sent: null }); q('Q-LOSTDEAL', { deal: lost }); q('Q-TEST', { email: 'qa@example.com' }); q('Q-CLOSED', { status: 'closed' });
  const items = await fired('quote_unanswered');
  assert.deepEqual(titles(items), ['Quote Q-NODEAL', 'Quote Q-OLD']);
  const old = items.find(i => i.title === 'Quote Q-OLD');
  assert.equal(old.ownerAdminId, sales); assert.match(old.link, /admin-crm-opportunity\.html\?id=/); assert.doesNotMatch(old.why, /viewed|opened|read it/i);
  assert.equal(old.fingerprint, day(-20));
  assert.deepEqual(titles(await fired('quote_unanswered', { ...A.THRESHOLD_DEFAULTS, quoteUnansweredDays: 3 })), ['Quote Q-NODEAL', 'Quote Q-OLD', 'Quote Q-RECENT'], 'a lower threshold lists the 5-day-old one too');
  db.exec('DELETE FROM quote_requests; DELETE FROM crm_opportunities');
});

// ---- expected close date -------------------------------------------------------------------------------------------------------------
test('CLOSE DATE PASSED: an open deal whose expected close date is before today (or by the grace days), never today, nothing set, or a closed deal', async () => {
  mkDeal({ name: 'late', close: day(-3) }); mkDeal({ name: 'today', close: day(0) }); mkDeal({ name: 'future', close: day(9) }); mkDeal({ name: 'none' });
  mkDeal({ name: 'won', state: 'won', close: day(-30) }); mkDeal({ name: 'lost', state: 'lost', close: day(-30) });
  const items = await fired('close_date_passed');
  assert.deepEqual(titles(items), ['late']);
  assert.match(items[0].why, /3 days ago/); assert.equal(items[0].fingerprint, day(-3), 'moving the date brings a dismissed item back');
  assert.deepEqual(titles(await fired('close_date_passed', { ...A.THRESHOLD_DEFAULTS, closeGraceDays: 5 })), [], 'with 5 days of grace a 3-day-old date is not listed yet');
  db.exec('DELETE FROM crm_opportunities');
});

// ---- purchase order not received -----------------------------------------------------------------------------------------------------
test('PO NOT RECEIVED: a PO purchase still pending past the threshold with no PO received date; not one received, paid, recent, or a test buyer', async () => {
  const deal = mkDeal({ name: 'PO deal' });
  const buyer = env.addContact(db, 'po-buyer@school.test', 'PO Buyer');
  const mk = (po, f = {}) => {
    const inv = Number(db.prepare("INSERT INTO invoices (invoice_number, contact_id, status, po_received_date) VALUES (?, ?, ?, ?)").run(`I-${po}`, f.buyer || buyer, f.invStatus || 'unpaid', f.received || null).lastInsertRowid);
    const quote = env.addQuote(db, 'po-buyer@school.test', { opportunityId: f.noDeal ? null : deal, number: `QP-${po}` });
    const pid = env.addPurchase(db, f.buyer || buyer, { method: 'po', paymentStatus: f.status || 'pending', amountCents: 50000, invoiceId: inv, quoteId: quote });
    db.prepare('UPDATE purchases SET po_number = ?, purchased_at = ?, school_domain = ? WHERE id = ?').run(po, at(f.age === undefined ? -20 : f.age), 'school.test', pid);
    return pid;
  };
  const waiting = mk('PO-WAIT'); mk('PO-GOT', { received: day(-2) }); mk('PO-PAID', { status: 'paid', invStatus: 'paid' }); mk('PO-NEW', { age: -4 });
  mk('PO-TEST', { buyer: env.addContact(db, 'qa-po@example.com', 'QA') });
  const items = await fired('po_not_received');
  assert.deepEqual(titles(items), ['PO PO-WAIT']);
  assert.equal(items[0].subjectType, 'purchase'); assert.equal(items[0].subjectId, waiting); assert.equal(items[0].ownerAdminId, sales, 'the deal owner');
  assert.match(items[0].link, /admin-crm-opportunity\.html\?id=/);
  assert.deepEqual(titles(await fired('po_not_received', { ...A.THRESHOLD_DEFAULTS, poWaitDays: 3 })), ['PO PO-NEW', 'PO PO-WAIT']);
  db.exec('DELETE FROM purchases; DELETE FROM invoices; DELETE FROM quote_requests; DELETE FROM crm_opportunities');
});

// ---- trials ----------------------------------------------------------------------------------------------------------------------------
function trial(email, f = {}) {
  const c = env.addContact(db, email, f.name || 'Trial Teacher');
  if (f.assigned) db.prepare('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?').run(f.assigned, c);
  const pid = env.addPurchase(db, c, { paymentStatus: 'paid', amountCents: 0, trialExpirationDate: at(f.ends === undefined ? 3 : f.ends), trialLessonLimit: 5 });
  db.prepare('UPDATE purchases SET seat_count = ?, school_domain = ?, license_status = ? WHERE id = ?').run(f.seats === undefined ? 5 : f.seats, 'trial.test', f.status || 'active', pid);
  for (let i = 0; i < (f.registered || 0); i++) db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'registered')").run(pid, `t${i}-${pid}@private.test`);
  return pid;
}
test('TRIAL ENDING: a live trial that ends within the threshold; not a far one, an ended one, a cancelled one or a test address; owned by the contact\'s owner', async () => {
  const soon = trial('soon@trial.test', { ends: 3, assigned: sales }); trial('far@trial.test', { ends: 20 }); trial('over@trial.test', { ends: -1 }); trial('cancelled@trial.test', { status: 'cancelled' }); trial('qa@example.com');
  const items = await fired('trial_ending');
  assert.deepEqual(items.map(i => i.subjectId), [soon]);
  assert.equal(items[0].ownerAdminId, sales); assert.match(items[0].link, /admin-crm-contact\.html\?id=/); assert.match(items[0].why, /ends on/);
  assert.equal((await fired('trial_ending', { ...A.THRESHOLD_DEFAULTS, trialEndingDays: 30 })).length, 2, 'a wider window adds the far one');
  db.exec('DELETE FROM purchases; DELETE FROM license_seats; DELETE FROM newsletter_contacts');
});

test('TRIAL WELL USED: only a multi-seat trial with enough seats registered; the text holds counts, never a name or address', async () => {
  const busy = trial('busy@trial.test', { seats: 5, registered: 4 }); trial('quiet@trial.test', { seats: 5, registered: 2 }); trial('single@trial.test', { seats: 1, registered: 1 });
  trial('over2@trial.test', { seats: 5, registered: 5, ends: -2 });
  const items = await fired('trial_high_use');
  assert.deepEqual(items.map(i => i.subjectId), [busy]);
  assert.match(items[0].why, /4 of this trial's 5 seats are registered/);
  assert.doesNotMatch(JSON.stringify(items), /private\.test|@trial\.test|Trial Teacher/, 'no teacher or buyer is named');
  assert.equal((await fired('trial_high_use', { ...A.THRESHOLD_DEFAULTS, trialUsePercent: 30 })).length, 2, 'a lower line adds the 2-of-5 trial');
  db.exec('DELETE FROM purchases; DELETE FROM license_seats; DELETE FROM newsletter_contacts');
});

test('NEW RULES: purchase items can be snoozed and dismissed like any other, and a missing table or column raises nothing instead of an error', async () => {
  const pid = trial('snooze@trial.test', { ends: 2 });
  const body = { ruleKey: 'trial_ending', subjectType: 'purchase', subjectId: pid, today: TODAY };
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...body, until: day(3) }, sales)).status, 200);
  const hidden = await call('GET', `/api/crm/attention?rule=trial_ending&today=${TODAY}`, undefined, viewer);
  assert.equal(hidden.json.total, 0, 'snoozed items leave the active list');
  assert.equal((await call('POST', '/api/crm/attention/snooze', { ...body, until: day(3) }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/crm/attention/restore', body, sales)).status, 200);
  assert.equal((await call('GET', `/api/crm/attention?rule=trial_ending&today=${TODAY}`, undefined, viewer)).json.total, 1);
  db.exec('DROP TABLE license_seats');
  await assert.doesNotReject(A.evaluate(pool, { today: TODAY }));
  assert.deepEqual(await fired('trial_high_use'), []);
  db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER)");
  db.exec('DELETE FROM purchases; DELETE FROM newsletter_contacts; DELETE FROM crm_attention_states');
});

// ---- thresholds --------------------------------------------------------------------------------------------------------------------------
test('THRESHOLDS: everyone with a CRM role can read them; only a CRM Admin can change them; a bad value is refused; each change is audited; the rule wording follows', async () => {
  const r = await call('GET', '/api/crm/attention/thresholds', undefined, viewer);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.thresholds.map(t => [t.key, t]));
  assert.equal(by.staleStageDays.value, 30); assert.equal(by.quoteUnansweredDays.value, 14); assert.equal(by.trialUsePercent.value, 60);
  assert.ok(r.json.thresholds.every(t => t.label && t.help && t.min < t.max && t.value >= t.min && t.value <= t.max));
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: { staleStageDays: 20 } }, sales)).status, 403);
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: { staleStageDays: 20 } }, viewer)).status, 403);
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: { staleStageDays: 20 } })).status, 401);
  for (const bad of [{ staleStageDays: 3 }, { staleStageDays: 9999 }, { staleStageDays: '20' }, { staleStageDays: 20.5 }, { staleStageDays: null }, { nonsense: 5 }, {}]) {
    assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: bad }, admin)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', {}, admin)).status, 400);
  assert.equal(get("SELECT COUNT(*) n FROM settings WHERE setting_key LIKE 'crm_attn_%'").n, 0, 'nothing was stored by the refused calls');
  const ok = await call('PUT', '/api/crm/attention/thresholds', { values: { staleStageDays: 20, quoteUnansweredDays: 10, trialUsePercent: 60 } }, admin);
  assert.equal(ok.status, 200); assert.deepEqual(ok.json.changed.sort(), ['quoteUnansweredDays', 'staleStageDays'], 'a value that did not change is not written or logged');
  assert.equal(get("SELECT setting_value v FROM settings WHERE setting_key = 'crm_attn_stale_stage_days'").v, '20');
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_attention_thresholds_changed'");
  assert.deepEqual(JSON.parse(row.prev_value), { staleStageDays: 30, quoteUnansweredDays: 14 }); assert.deepEqual(JSON.parse(row.new_value), { staleStageDays: 20, quoteUnansweredDays: 10 });
  const rules = (await call('GET', '/api/crm/attention/rules', undefined, viewer)).json.rules;
  assert.equal(rules.length, 16);
  assert.match(rules.find(x => x.key === 'stale_deal').help, /sat in one stage for 20 days/);
  assert.match(rules.find(x => x.key === 'quote_unanswered').help, /sent 10 or more days ago/);
  // And the rule itself uses the number: a deal quiet for 25 days is listed at 20, not at 30.
  const quiet = mkDeal({ name: 'quiet 25' });
  db.prepare('UPDATE crm_opportunities SET stage_entered_at = ? WHERE id = ?').run(at(-25), quiet);
  assert.equal((await fired('stale_deal')).length, 1);
  db.prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('crm_attn_stale_stage_days', '30')").run();
  assert.equal((await fired('stale_deal')).length, 0, 'at the old 30 it is not yet');
  db.exec('DELETE FROM crm_opportunities');
});

test('THRESHOLDS: a stored value that is missing, text, a decimal or out of range falls back to the default, so a bad setting never switches a rule off or floods the list', async () => {
  for (const [k, v] of [['crm_attn_stale_stage_days', 'abc'], ['crm_attn_quiet_days', '2'], ['crm_attn_quote_window_days', '99999'], ['crm_attn_won_grace_days', '3.5'], ['crm_attn_po_wait_days', ' 21 '], ['crm_attn_trial_use_percent', '-5']]) {
    db.prepare('INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES (?, ?)').run(k, v);
  }
  const t = await A.loadThresholds(pool);
  assert.deepEqual({ a: t.staleStageDays, b: t.quietDays, c: t.quoteWindowDays, d: t.wonGraceDays, e: t.poWaitDays, f: t.trialUsePercent }, { a: 30, b: 14, c: 7, d: 3, e: 21, f: 60 });
  db.exec("DELETE FROM settings WHERE setting_key LIKE 'crm_attn_%'");
});

test('PAGES: Hub Settings has the thresholds card, and the new rule keys are classed and ordered in the route', () => {
  const root = path.join(env.SERVER, '..');
  const page = fs.readFileSync(path.join(root, 'admin-crm-settings.html'), 'utf8');
  assert.match(page, /Needs Attention thresholds/); assert.match(page, /\/api\/crm\/attention\/thresholds/);
  assert.doesNotMatch(page.replace('onclick="fnToggleTheme()"', ''), /onclick=/);
  const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  assert.doesNotThrow(() => new (require('node:vm').Script)(script), 'the page script parses');
  const route = fs.readFileSync(path.join(env.SERVER, 'routes/crm-attention.js'), 'utf8');
  for (const k of Object.keys(A.RULES)) assert.ok(route.includes(`'${k}'`), `${k} has a place in the list order`);
});
