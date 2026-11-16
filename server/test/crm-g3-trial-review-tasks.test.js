// Sales CRM punch list G3 (PRD FR-TRIAL-03): a trial that is nearly over, well used, or has not got going gets ONE review task for the right person, once per trial per reason,
// never again however often the daily job runs. Also the new "stalled" Needs Attention rule and its threshold. Real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER)");
const LEDGER = 'CREATE TABLE crm_trial_review_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, reason TEXT NOT NULL, task_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (purchase_id, reason))';
db.exec(LEDGER);
// setSetting() uses MySQL's ON DUPLICATE KEY; give the settings table a real upsert here (same as the G2 test).
const baseQuery = pool.query;
pool.query = (sql, params) => {
  if (/INSERT INTO settings \(setting_key, setting_value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE setting_value = \?/.test(String(sql))) {
    return baseQuery('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', [params[0], params[1]]);
  }
  return baseQuery(sql, params);
};
env.install(pool);
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const TT = require(path.join(env.SERVER, 'lib/crm-trial-tasks.js'));
const { server, call } = env.listen([['/api/crm/attention', require(path.join(env.SERVER, 'routes/crm-attention.js'))]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const other = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);
const at = (n, time = '12:00:00') => `${day(n)} ${time}`;
const NOW = `${TODAY} 06:50:00`;
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('G3 District')").run().lastInsertRowid);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const mkDeal = (owner) => Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, next_step, stage_entered_at)
  VALUES (?, 'G3 deal', ?, ?, 'open', 'Call them', ?)`).run(acct, stage('qualified'), owner === undefined ? null : owner, at(-1)).lastInsertRowid);

// A live trial. f: ends (days from today), started (days ago), seats, registered, pending (seat rows not registered), noSeatRows, assigned (contact's owner), deal (deal id, through a quote).
let n = 0;
function trial(f = {}) {
  n++;
  const email = f.email || `buyer${n}@trial.test`;
  const c = env.addContact(db, email, f.name || 'Trial Teacher');
  if (f.assigned) db.prepare('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?').run(f.assigned, c);
  const quoteId = f.deal ? env.addQuote(db, email, { opportunityId: f.deal, number: `G3-${n}` }) : null;
  const pid = env.addPurchase(db, c, { paymentStatus: 'paid', amountCents: 0, trialExpirationDate: at(f.ends === undefined ? 20 : f.ends), trialLessonLimit: 5, quoteId });
  db.prepare('UPDATE purchases SET seat_count = ?, school_domain = ?, purchased_at = ? WHERE id = ?').run(f.seats === undefined ? 5 : f.seats, 'trial.test', at(f.started === undefined ? -2 : -f.started), pid);
  for (let i = 0; i < (f.registered || 0); i++) db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'registered')").run(pid, `t${i}-${pid}@private.test`);
  for (let i = 0; i < (f.pending || 0); i++) db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')").run(pid, `p${i}-${pid}@private.test`);
  return { pid, contact: c };
}
const reset = () => db.exec('DELETE FROM crm_tasks; DELETE FROM crm_trial_review_tasks; DELETE FROM license_seats; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts; DELETE FROM crm_attention_states; DELETE FROM crm_attention_events');
const fired = async (rule, thresholds) => (await A.evaluate(pool, { today: TODAY, thresholds })).filter(i => i.ruleKey === rule);
const tasks = () => all('SELECT * FROM crm_tasks ORDER BY id');

// ---- the stalled rule ---------------------------------------------------------------------------------------------------------------
test('STALLED: a live trial that started 7 or more days ago with seat records and none registered; not a younger one, one with a registered seat, one with no seat records (unknown), an ended one or a test address', async () => {
  const stalled = trial({ started: 10, pending: 3 });
  trial({ started: 3, pending: 3 });                       // too young
  trial({ started: 10, pending: 3, registered: 1 });        // somebody registered
  trial({ started: 10 });                                    // no seat records at all: unknown, never "stalled"
  trial({ started: 10, pending: 3, ends: -1 });             // already ended
  trial({ started: 10, pending: 3, email: 'qa@example.com' });
  const items = await fired('trial_stalled');
  assert.deepEqual(items.map(i => i.subjectId), [stalled.pid]);
  assert.equal(items[0].subjectType, 'purchase'); assert.equal(items[0].fingerprint, day(-10));
  assert.match(items[0].why, /started 10 days ago and no teacher has registered a seat/);
  assert.doesNotMatch(JSON.stringify(items), /private\.test|@trial\.test|Trial Teacher/, 'no teacher or buyer is named');
  assert.match(A.helpFor('trial_stalled', A.THRESHOLD_DEFAULTS), /7 or more days ago/);
  reset();
});

test('STALLED: the day count is a setting (edges: exactly 7 days is listed, 6 is not; a lower number adds the younger trial)', async () => {
  const seven = trial({ started: 7, pending: 2 }), six = trial({ started: 6, pending: 2 });
  assert.deepEqual((await fired('trial_stalled')).map(i => i.subjectId), [seven.pid]);
  assert.deepEqual((await fired('trial_stalled', { ...A.THRESHOLD_DEFAULTS, trialStalledDays: 3 })).map(i => i.subjectId).sort(), [seven.pid, six.pid].sort());
  const t = A.THRESHOLDS.trialStalledDays;
  assert.equal(t.setting, 'crm_attn_trial_stalled_days'); assert.equal(t.def, 7);
  db.prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('crm_attn_trial_stalled_days', '3')").run();
  assert.equal((await A.loadThresholds(pool)).trialStalledDays, 3);
  db.prepare("INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES ('crm_attn_trial_stalled_days', '0')").run();
  assert.equal((await A.loadThresholds(pool)).trialStalledDays, 7, 'a value out of range falls back to the default');
  db.exec("DELETE FROM settings WHERE setting_key LIKE 'crm_attn_%'");
  // The Hub Settings card lists it, and a CRM Admin can change it through the same route as the other numbers.
  const list = (await call('GET', '/api/crm/attention/thresholds', undefined, viewer)).json.thresholds;
  assert.ok(list.find(x => x.key === 'trialStalledDays' && x.value === 7 && x.min === 1 && x.max === 60));
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: { trialStalledDays: 10 } }, sales)).status, 403);
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: { trialStalledDays: 0 } }, admin)).status, 400);
  assert.equal((await call('PUT', '/api/crm/attention/thresholds', { values: { trialStalledDays: 10 } }, admin)).status, 200);
  assert.deepEqual((await fired('trial_stalled')).map(i => i.subjectId), [], 'at 10 days neither trial qualifies');
  db.exec("DELETE FROM settings WHERE setting_key LIKE 'crm_attn_%'");
  reset();
});

// ---- the tasks --------------------------------------------------------------------------------------------------------------------------
test('TASKS: each of the three reasons makes one task, on the deal when the trial has one else on the buyer, for the deal owner, else the buyer\'s owner, else nobody', async () => {
  const deal = mkDeal(sales);
  const ending = trial({ ends: 3, deal, registered: 1, seats: 5 });                  // ends in 3 days; deal owner = sales
  const busy = trial({ ends: 20, registered: 4, seats: 5, assigned: other });        // well used; no deal; the buyer's owner = other
  const stalled = trial({ ends: 20, started: 9, pending: 3 });                       // stalled; no deal, no owner at all
  const r = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(r.trialTasks.made, 3); assert.deepEqual(Object.fromEntries(Object.entries(r.trialTasks.byReason).map(([k, v]) => [k, v.made])), { ending: 1, high_use: 1, stalled: 1 });
  const rows = tasks();
  assert.equal(rows.length, 3);
  const byTitle = (re) => rows.find(t => re.test(t.title));
  const e = byTitle(/Trial ends/), b = byTitle(/well used/), s = byTitle(/not got going/);
  assert.equal(e.title, `Trial ends ${day(3)}: ask how it went`);
  assert.equal(e.opportunity_id, deal); assert.equal(e.account_id, acct); assert.equal(e.contact_id, null); assert.equal(e.assigned_admin_id, sales); assert.equal(e.due_on, day(2), 'due the day before it ends');
  assert.equal(b.opportunity_id, null); assert.equal(b.contact_id, busy.contact); assert.equal(b.assigned_admin_id, other); assert.equal(b.due_on, TODAY);
  assert.equal(s.contact_id, stalled.contact); assert.equal(s.assigned_admin_id, null, 'nobody to give it to: left unassigned'); assert.equal(s.due_on, TODAY);
  for (const t of rows) {
    assert.equal(t.state, 'open'); assert.equal(t.created_by_admin_id, null);
    assert.match(t.details, /Nothing has been offered or sent/);
    assert.doesNotMatch(`${t.title} ${t.details}`, /@|private\.test|Trial Teacher/, 'seat counts and dates only: no teacher, buyer or address');
    assert.equal([t.opportunity_id, t.contact_id].filter(Boolean).length, 1, 'exactly one subject');
  }
  assert.match(b.details, /4 of this trial's 5 seats are registered/);
  assert.deepEqual(all('SELECT purchase_id, reason FROM crm_trial_review_tasks ORDER BY purchase_id').map(x => `${x.purchase_id}:${x.reason}`),
    [`${ending.pid}:ending`, `${busy.pid}:high_use`, `${stalled.pid}:stalled`]);
  const audits = all("SELECT * FROM school_audit_log WHERE action = 'crm_task_created'");
  assert.equal(audits.length, 3); assert.ok(audits.every(a => a.actor_type === 'system' && a.purchase_id === null && /crm\.trial\./.test(a.new_value)));
  reset();
});

test('TASKS: a trial that ends today or tomorrow is due today, never in the past; an owner who no longer exists leaves it unassigned', async () => {
  trial({ ends: 0, registered: 1, assigned: 9999 });
  await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  const t = tasks();
  assert.equal(t.length, 1); assert.equal(t[0].due_on, TODAY); assert.equal(t[0].assigned_admin_id, null);
  reset();
});

test('IDEMPOTENT: running the daily job again, or twice at once, makes nothing new; a finished or deleted task is not made again', async () => {
  const a = trial({ ends: 2, registered: 1 }), b = trial({ started: 8, pending: 2 });
  const first = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(first.trialTasks.made, 2); assert.equal(tasks().length, 2);
  const second = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(second.trialTasks.made, 0); assert.equal(second.trialTasks.alreadyMade, 2); assert.equal(tasks().length, 2);
  // Two runs at the same moment, and a direct call, still make one each.
  await Promise.all([A.runDaily(pool, { apply: true, now: NOW, trialTasks: true }), A.runDaily(pool, { apply: true, now: NOW, trialTasks: true })]);
  assert.equal(tasks().length, 2);
  // Staff finish one and delete the other: neither comes back.
  db.prepare("UPDATE crm_tasks SET state = 'done', completed_at = ? WHERE id = ?").run(NOW, tasks()[0].id);
  db.prepare('DELETE FROM crm_tasks WHERE id = ?').run(tasks()[1].id);
  const third = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(third.trialTasks.made, 0); assert.equal(tasks().length, 1);
  // The same trial can still earn a task for a DIFFERENT reason later (it ends soon after being stalled): that is a second, separate reason.
  db.prepare('UPDATE purchases SET trial_expiration_date = ? WHERE id = ?').run(at(2), b.pid);
  const fourth = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(fourth.trialTasks.made, 1); assert.equal(fourth.trialTasks.byReason.ending.made, 1);
  assert.equal(all('SELECT * FROM crm_trial_review_tasks WHERE purchase_id = ?', b.pid).length, 2);
  // A moved end date does not earn a second "ending" task.
  db.prepare('UPDATE purchases SET trial_expiration_date = ? WHERE id = ?').run(at(1), b.pid);
  assert.equal((await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true })).trialTasks.made, 0);
  void a;
  reset();
});

test('SWITCH: with the switch off, or without --apply, the job only counts what it would make and writes nothing', async () => {
  trial({ ends: 2, registered: 1 }); trial({ started: 8, pending: 2 });
  const off = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: false });
  assert.equal(off.trialTasks.made, 0); assert.equal(off.trialTasks.wouldMake, 2); assert.equal(tasks().length, 0);
  const report = await A.runDaily(pool, { apply: false, now: NOW, trialTasks: true });
  assert.equal(report.trialTasks.made, 0); assert.equal(report.trialTasks.wouldMake, 2); assert.equal(tasks().length, 0);
  assert.equal(get('SELECT COUNT(*) n FROM crm_trial_review_tasks').n, 0, 'no ledger row either');
  const on = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(on.trialTasks.made, 2);
  reset();
});

test('RESPECTS STAFF: an item staff dismissed or snoozed on Needs Attention gets no task; a test address and a trial with no seat records never do', async () => {
  const dismissed = trial({ ends: 2, registered: 1 }), snoozed = trial({ started: 8, pending: 2 }); trial({ ends: 2, registered: 1, email: 'qa@example.com' }); trial({ started: 20 });
  const items = await A.evaluate(pool, { today: TODAY });
  await A.setState(pool, items.find(i => i.ruleKey === 'trial_ending' && i.subjectId === dismissed.pid), { state: 'dismissed', adminId: admin, now: NOW });
  await A.setState(pool, items.find(i => i.ruleKey === 'trial_stalled' && i.subjectId === snoozed.pid), { state: 'snoozed', until: at(5, '00:00:00'), adminId: admin, now: NOW });
  const r = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(r.trialTasks.made, 0); assert.equal(tasks().length, 0);
  reset();
});

test('SAFE: before the alter script has run the job skips the tasks and says so, and everything else in the job still works; a failed write leaves no claim', async () => {
  trial({ ends: 2, registered: 1 });
  db.exec('DROP TABLE crm_trial_review_tasks');
  const r = await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(r.trialTasks.available, false); assert.equal(tasks().length, 0); assert.ok(r.active >= 1, 'the rest of the job ran');
  db.exec(LEDGER);
  // A task write that fails leaves no ledger row, so the next run tries again.
  const broken = { query: (sql, p) => (/INSERT INTO crm_tasks/.test(sql) ? Promise.reject(new Error('disk full')) : pool.query(sql, p)) };
  const items = (await A.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === 'trial_ending');
  await assert.rejects(TT.createReviewTasks(broken, items, { apply: true, now: NOW, today: TODAY }), /disk full/);
  assert.equal(get('SELECT COUNT(*) n FROM crm_trial_review_tasks').n, 0);
  assert.equal((await TT.createReviewTasks(pool, items, { apply: true, now: NOW, today: TODAY })).made, 1);
  reset();
});

test('WRITES ONLY TASKS: the job changes no purchase, seat, quote, invoice, contact label or email, and never offers anything', async () => {
  const deal = mkDeal(sales);
  trial({ ends: 2, registered: 1, deal }); trial({ started: 8, pending: 2 });
  const snap = () => JSON.stringify(['purchases', 'license_seats', 'quote_requests', 'invoices', 'newsletter_contacts', 'crm_opportunities'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`)));
  const before = snap();
  await A.runDaily(pool, { apply: true, now: NOW, trialTasks: true });
  assert.equal(snap(), before);
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-trial-tasks.js'), 'utf8');
  assert.doesNotMatch(src, /mailer|sendMail|UPDATE (purchases|license_seats|quote_requests|invoices|newsletter_contacts)|INSERT INTO (purchases|invoices|license_seats)|OpenAI|anthropic/i);
  reset();
});

// ---- the files ----------------------------------------------------------------------------------------------------------------------
test('FILES: schema.sql and the alter script both define the ledger with its unique key; the daily script has the switch; the new rule has its place in the list', () => {
  const schema = fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS crm_trial_review_tasks[\s\S]*?UNIQUE KEY uq_crm_trial_review \(purchase_id, reason\)/);
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-create-crm-trial-review-tasks.js'), 'utf8');
  assert.match(alter, /CREATE TABLE IF NOT EXISTS crm_trial_review_tasks/); assert.match(alter, /UNIQUE KEY uq_crm_trial_review \(purchase_id, reason\)/);
  const daily = fs.readFileSync(path.join(env.SERVER, 'scripts/crm-daily-attention.js'), 'utf8');
  assert.match(daily, /--trial-tasks/); assert.match(daily, /crm_trial_review_tasks|TT\.SWITCH/); assert.equal(TT.SWITCH, 'crm_trial_review_tasks');
  const route = fs.readFileSync(path.join(env.SERVER, 'routes/crm-attention.js'), 'utf8');
  assert.ok(route.includes("'trial_stalled'"));
  assert.ok(A.RULES.trial_stalled && A.RULES.trial_stalled.subjectType === 'purchase');
  for (const f of ['lib/crm-trial-tasks.js', 'scripts/crm-daily-attention.js', 'scripts/alter-create-crm-trial-review-tasks.js', 'lib/crm-attention.js']) assert.doesNotThrow(() => new (require('node:vm').Script)(fs.readFileSync(path.join(env.SERVER, f), 'utf8').replace(/^#!.*/, '')), f);
});
