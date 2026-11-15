// Sales CRM phase 6, feature 2: the renewal and expansion generator (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec"). Real SQL on node:sqlite from
// test/helpers/crm-env.js. What must hold: only paid, non-trial group licenses are sources; a report-only run writes nothing; running it twice (or twice at once) makes
// one deal per source purchase; it writes deals and nothing else; a customer can hold a renewal and an expansion at once and stays a Customer.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec('ALTER TABLE crm_opportunities ADD COLUMN generated_key TEXT');
db.exec('CREATE UNIQUE INDEX uq_crm_opp_generated_key ON crm_opportunities (generated_key)');
db.exec('CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT \'pending\', registered_site_user_id INTEGER)');
env.install(pool);

const G = require(path.join(env.SERVER, 'lib/crm-growth.js'));
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));
const TODAY = '2026-11-15';
const NOW = '2026-11-15 08:00:00';
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const adminId = env.addAdmin(db, 'owner', 'admin');
let schoolSeq = 0;
function school(name, { account = true, archived = false, owner = adminId } = {}) {
  const sid = ++schoolSeq;
  db.prepare('INSERT INTO schools (id, domain) VALUES (?, ?)').run(sid, `s${sid}.example.com`);
  let aid = null;
  if (account) aid = Number(db.prepare('INSERT INTO crm_accounts (name, account_type, school_id, assigned_admin_id, archived_at) VALUES (?, ?, ?, ?, ?)').run(name, 'school', sid, owner, archived ? NOW : null).lastInsertRowid);
  return { sid, aid };
}
function license(contactId, sid, f = {}) {
  const r = db.prepare(`INSERT INTO purchases (contact_id, product_type, license_product_id, payment_status, amount_cents, school_id, school_domain, seat_count, expiration_date, license_status, trial_lesson_limit, trial_expiration_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contactId, f.type || 'group_license', f.productId || null, f.status || 'paid', f.amount === undefined ? 500000 : f.amount, sid, `s${sid}.example.com`,
    f.seats === undefined ? 10 : f.seats, f.ends === undefined ? day(40) : f.ends, f.licenseStatus || 'active', f.trialLimit === undefined ? null : f.trialLimit, f.trialEnds || null);
  const id = Number(r.lastInsertRowid);
  const reg = f.registered || 0;
  for (let i = 0; i < reg; i++) db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'registered')").run(id, `teacher${i}-${id}@example.com`);
  return id;
}
const deals = () => db.prepare('SELECT * FROM crm_opportunities ORDER BY id').all();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const run = (opts = {}) => G.runGrowth(pool, { today: TODAY, now: NOW, ...opts });
const reset = () => { db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_opportunity_stage_history; DELETE FROM crm_opportunity_contacts; DELETE FROM purchases; DELETE FROM license_seats; DELETE FROM school_audit_log; DELETE FROM crm_accounts;'); };

test('SOURCES: only a paid, non-trial group license inside the window is a source; the rest are left out', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-a@example.com');
  const s = school('Maple Elementary');
  const good = license(buyer, s.sid, { ends: day(40) });
  license(buyer, school('Trial School').sid, { trialLimit: 3, trialEnds: day(20) });          // a trial
  license(buyer, school('Null School').sid, { amount: null });                                 // paid, amount unknown (manual entry)
  license(buyer, school('Zero School').sid, { amount: 0 });                                    // paid, zero
  license(buyer, school('Pending School').sid, { status: 'pending' });                         // a PO still pending
  license(buyer, school('Single School').sid, { type: 'single_license' });                     // one teacher, no school deal
  license(buyer, school('Far School').sid, { ends: day(200) });                                // beyond the lead time
  license(buyer, school('Long Gone School').sid, { ends: day(-90) });                          // ended long ago
  license(buyer, school('Cancelled School').sid, { licenseStatus: 'cancelled' });
  const sources = await G.sourcePurchases(pool, TODAY);
  assert.deepEqual(sources.map(p => p.id), [good]);
  const r = await run();
  assert.equal(r.sources, 1);
  assert.equal(r.amountUnknown, 2, 'paid with a NULL or zero amount is counted for the review list, never a source');
});

test('WINDOW: 120 days ahead and 30 days back are in; one day further either way is out', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-w@example.com');
  const inAhead = license(buyer, school('A').sid, { ends: day(G.LEAD_DAYS) });
  const outAhead = license(buyer, school('B').sid, { ends: day(G.LEAD_DAYS + 1) });
  const inBack = license(buyer, school('C').sid, { ends: day(-G.LOOKBACK_DAYS) });
  const outBack = license(buyer, school('D').sid, { ends: day(-G.LOOKBACK_DAYS - 1) });
  const ids = (await G.sourcePurchases(pool, TODAY)).map(p => p.id);
  assert.ok(ids.includes(inAhead) && ids.includes(inBack));
  assert.ok(!ids.includes(outAhead) && !ids.includes(outBack));
});

test('REPORT ONLY: the default run says what it would do and writes nothing at all', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-r@example.com');
  const s = school('Report School');
  license(buyer, s.sid, { registered: 10 });
  const before = [count('crm_opportunities'), count('crm_opportunity_stage_history'), count('crm_opportunity_contacts'), count('school_audit_log')];
  const r = await run();
  assert.equal(r.renewal.wouldMake, 1);
  assert.equal(r.expansion.wouldMake, 1);
  assert.equal(r.renewal.made + r.expansion.made, 0);
  assert.deepEqual([count('crm_opportunities'), count('crm_opportunity_stage_history'), count('crm_opportunity_contacts'), count('school_audit_log')], before);
});

test('APPLY: one renewal deal with the right fields, history, buyer on the committee and an audit row by "system"', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-b@example.com');
  const s = school('Birch Elementary');
  const p = license(buyer, s.sid, { ends: day(40), amount: 750000 });
  const r = await run({ apply: true });
  assert.equal(r.renewal.made, 1);
  assert.equal(r.expansion.made, 0, 'no seats are registered, so no expansion deal');
  const [d] = deals();
  assert.equal(d.name, 'Renewal: Birch Elementary');
  assert.equal(d.opp_type, 'renewal');
  assert.equal(d.state, 'open');
  assert.equal(d.account_id, s.aid);
  assert.equal(d.owner_admin_id, adminId, 'the account owner owns it');
  assert.equal(d.primary_contact_id, buyer);
  assert.equal(d.amount_cents, 750000, "last term's amount");
  assert.match(d.source, /last term's amount/);
  assert.equal(d.expected_close_date, day(40));
  assert.equal(d.renewal_of_purchase_id, p);
  assert.equal(d.generated_key, `crm.purchase.renewal_due:${p}`);
  assert.match(d.next_step, new RegExp(`license ends ${day(40)}`));
  assert.equal(String(d.next_step_due_at).slice(0, 10), day(G.NEXT_STEP_DAYS));
  assert.equal(db.prepare('SELECT stage_key FROM crm_pipeline_stages WHERE id = ?').get(d.stage_id).stage_key, 'qualified');
  assert.equal(count('crm_opportunity_stage_history'), 1);
  assert.equal(db.prepare('SELECT contact_id FROM crm_opportunity_contacts WHERE opportunity_id = ?').get(d.id).contact_id, buyer);
  const a = db.prepare("SELECT * FROM school_audit_log WHERE entity_type = 'crm_opportunity'").get();
  assert.equal(a.actor_type, 'system');
  assert.equal(a.purchase_id, null, 'a CRM audit row never sets purchase_id');
});

test('NEVER TWICE: a second run, and two runs at the same moment, make one deal per source purchase', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-c@example.com');
  license(buyer, school('Cedar').sid, { registered: 10 });
  const first = await run({ apply: true });
  assert.equal(first.renewal.made + first.expansion.made, 2);
  const second = await run({ apply: true });
  assert.equal(second.renewal.made + second.expansion.made, 0);
  assert.equal(second.skipped.alreadyMade, 2);
  assert.equal(count('crm_opportunities'), 2);

  reset();
  const buyer2 = env.addContact(db, 'buyer-c2@example.com');
  license(buyer2, school('Cedar Two').sid, { registered: 10 });
  const [x, y] = await Promise.all([run({ apply: true }), run({ apply: true })]);
  assert.equal(count('crm_opportunities'), 2, 'one renewal and one expansion, whatever the interleaving');
  assert.equal(x.renewal.made + y.renewal.made, 1);
  assert.equal(x.expansion.made + y.expansion.made, 1);
  // The database itself refuses a second row with the same key, and any number of hand-made deals (no key) are fine.
  const stage = db.prepare("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'qualified'").get().id;
  const acct = db.prepare('SELECT id FROM crm_accounts LIMIT 1').get().id;
  const key = deals()[0].generated_key;
  await assert.rejects(() => pool.query("INSERT INTO crm_opportunities (account_id, name, stage_id, generated_key) VALUES (?, 'dup', ?, ?)", [acct, stage, key]), (e) => e.code === 'ER_DUP_ENTRY');
  await pool.query("INSERT INTO crm_opportunities (account_id, name, stage_id) VALUES (?, 'by hand one', ?)", [acct, stage]);
  await pool.query("INSERT INTO crm_opportunities (account_id, name, stage_id) VALUES (?, 'by hand two', ?)", [acct, stage]);
});

test('A CLOSED GENERATED DEAL keeps its key: lost or won, it is never made again', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-d@example.com');
  license(buyer, school('Dogwood').sid);
  await run({ apply: true });
  db.prepare("UPDATE crm_opportunities SET state = 'lost', closed_at = ?").run(NOW);
  const r = await run({ apply: true });
  assert.equal(r.renewal.made, 0);
  assert.equal(r.skipped.alreadyMade, 1);
  assert.equal(count('crm_opportunities'), 1);
});

test('ALREADY RENEWED: a later paid license, or a later PO still pending, at the same school means no deal; a later trial does not', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-e@example.com');
  const paid = school('Elm Paid');
  license(buyer, paid.sid, { ends: day(30) });
  license(buyer, paid.sid, { ends: day(400) });
  const po = school('Elm PO');
  license(buyer, po.sid, { ends: day(30) });
  license(buyer, po.sid, { ends: day(400), status: 'pending' });
  const trial = school('Elm Trial');
  const tp = license(buyer, trial.sid, { ends: day(30) });
  license(buyer, trial.sid, { ends: day(400), trialLimit: 5, trialEnds: day(400) });
  const r = await run({ apply: true });
  assert.equal(r.skipped.alreadyRenewed, 2);
  const made = deals();
  assert.deepEqual(made.map(d => d.account_id), [trial.aid], 'only the school whose "later" license is a trial gets a renewal');
  assert.equal(made[0].renewal_of_purchase_id, tp);
});

test('NO ACCOUNT: a school with no live CRM account is counted and skipped; the generator never makes an account', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-f@example.com');
  license(buyer, school('No Account School', { account: false }).sid);
  license(buyer, school('Archived School', { archived: true }).sid);
  const r = await run({ apply: true });
  assert.equal(r.skipped.noAccount, 2);
  assert.equal(count('crm_opportunities'), 0);
  assert.equal(count('crm_accounts'), 1, 'only the archived one that was already there');
});

test('STAFF ARE NOT WORKED AGAINST: an open renewal deal, or one won in the last 90 days, at the account stops a new one; an old win does not', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-g@example.com');
  const stage = db.prepare("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'qualified'").get().id;
  const open = school('Open Deal School'), won = school('Won Recently School'), old = school('Won Long Ago School');
  for (const s of [open, won, old]) license(buyer, s.sid);
  db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state, opp_type) VALUES (?, 'staff renewal', ?, 'open', 'renewal')").run(open.aid, stage);
  db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state, opp_type, closed_at) VALUES (?, 'won renewal', ?, 'won', 'renewal', ?)").run(won.aid, stage, `${day(-20)} 10:00:00`);
  db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state, opp_type, closed_at) VALUES (?, 'old win', ?, 'won', 'renewal', ?)").run(old.aid, stage, `${day(-200)} 10:00:00`);
  const r = await run({ apply: true });
  assert.equal(r.skipped.openDeal, 1);
  assert.equal(r.skipped.wonRecently, 1);
  assert.equal(r.renewal.made, 1);
  assert.equal(db.prepare("SELECT account_id FROM crm_opportunities WHERE generated_key IS NOT NULL").get().account_id, old.aid);
});

test('ONE DEAL PER ACCOUNT: two licenses ending together at one school make one renewal deal, in a report and in a real run', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-h@example.com');
  const s = school('Hickory');
  license(buyer, s.sid, { ends: day(40) });
  license(buyer, s.sid, { ends: day(41) });
  const report = await run();
  assert.equal(report.renewal.wouldMake, 1);
  const real = await run({ apply: true });
  assert.equal(real.renewal.made, 1);
  assert.equal(count('crm_opportunities'), 1);
});

test('EXPANSION: made at 90% of seats registered, not at 80%, and left unknown (not zero) when the seat count was never recorded; value stays blank', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-i@example.com');
  const hi = school('Ironwood High'), lo = school('Ironwood Low'), unk = school('Ironwood Unknown');
  license(buyer, hi.sid, { seats: 10, registered: 9 });
  license(buyer, lo.sid, { seats: 10, registered: 8 });
  license(buyer, unk.sid, { seats: null, registered: 5 });
  const r = await run({ apply: true });
  assert.equal(r.expansion.made, 1);
  assert.equal(r.skipped.belowSeatThreshold, 1);
  assert.equal(r.skipped.seatsUnknown, 1);
  const x = db.prepare("SELECT * FROM crm_opportunities WHERE opp_type = 'expansion'").get();
  assert.equal(x.account_id, hi.aid);
  assert.equal(x.amount_cents, null, 'a guess is worse than a blank');
  assert.match(x.next_step, /9 of 10 in use/);
  assert.match(x.generated_key, /^crm\.purchase\.expansion_due:\d+$/);
});

test('CUSTOMER STAYS CUSTOMER: a renewal and an expansion open together, then both lost, and the contact is still a Customer', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-j@example.com');
  license(buyer, school('Juniper').sid, { seats: 10, registered: 10 });
  await cls.reconcileContact(pool, buyer);
  assert.equal(env.classOf(db, buyer), 'customer');
  const r = await run({ apply: true });
  assert.equal(r.renewal.made, 1);
  assert.equal(r.expansion.made, 1);
  const open = db.prepare("SELECT COUNT(*) AS n FROM crm_opportunities WHERE state = 'open'").get().n;
  assert.equal(open, 2, 'both can be open at once');
  assert.equal(env.classOf(db, buyer), 'customer');
  db.prepare("UPDATE crm_opportunities SET state = 'lost', closed_at = ?").run(NOW);
  await cls.reconcileContact(pool, buyer);
  assert.equal(env.classOf(db, buyer), 'customer', 'losing a renewal never un-makes a Customer');
});

test('DEALS ONLY: a run changes no purchase, invoice, seat, quote, contact or label, and the code has no write to any of them', async () => {
  reset();
  const buyer = env.addContact(db, 'buyer-k@example.com');
  license(buyer, school('Kestrel').sid, { registered: 10 });
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'customer' WHERE id = ?").run(buyer);
  const snap = () => JSON.stringify(['purchases', 'license_seats', 'invoices', 'quote_requests', 'newsletter_contacts', 'crm_classification_events'].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
  const before = snap();
  await run({ apply: true });
  assert.equal(snap(), before);
  const code = fs.readFileSync(path.join(env.SERVER, 'lib/crm-growth.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /(INSERT INTO|UPDATE|DELETE FROM)\s+(purchases|invoices|license_seats|quote_requests|newsletter_contacts|crm_classification_events)\b/i);
  assert.doesNotMatch(code, /crm_classification/);
});

test('A MISSING KEY COLUMN stops the real script before it does anything; the script runs only when both switches are on', () => {
  const script = fs.readFileSync(path.join(env.SERVER, 'scripts/crm-renewals.js'), 'utf8');
  assert.match(script, /generated_key/);
  assert.match(script, /Stopped: crm_opportunities\.generated_key is missing/);
  assert.match(script, /crm_v2_enabled/);
  assert.match(script, /crm_renewal_generator/);
  assert.match(script, /const apply = args\.includes\('--apply'\)/, 'report only unless --apply is given');
  assert.match(fs.readFileSync(path.join(env.SERVER, 'scripts/setup-cron-jobs.sh'), 'utf8'), /crm-renewals\.js --apply --only-if-enabled/);
});

test('THE ALTER SCRIPT and schema.sql agree: the key column, its unique index and the ten attribution columns', () => {
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-create-crm-growth.js'), 'utf8');
  const schema = fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8');
  assert.match(alter, /generated_key VARCHAR\(64\) NULL/);
  assert.match(alter, /UNIQUE KEY uq_crm_opp_generated_key/);
  assert.match(schema, /generated_key VARCHAR\(64\) NULL/);
  assert.match(schema, /UNIQUE KEY uq_crm_opp_generated_key \(generated_key\)/);
  for (const which of ['first', 'latest']) for (const c of ['source', 'medium', 'campaign', 'landing', 'at']) assert.match(schema, new RegExp(`${which}_touch_${c} `), `${which}_touch_${c}`);
  assert.match(alter, /information_schema/, 'every step checks before it changes anything');
});
