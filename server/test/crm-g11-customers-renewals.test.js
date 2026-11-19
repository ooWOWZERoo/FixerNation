// Sales CRM punch list G11 (PRD section 17): the Customers & Renewals screen. Read only. Renewals with plain reasons (never a score), the expansion pipeline, and onboarding progress.
// Real route and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const c of ['school_domain TEXT', 'seat_count INTEGER', 'expiration_date TEXT', 'product_type_unused TEXT']) { try { db.exec(`ALTER TABLE purchases ADD COLUMN ${c}`); } catch { /* already there */ } }
try { db.exec('CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT \'available\')'); } catch { /* already there */ }
db.exec('CREATE TABLE IF NOT EXISTS crm_purchase_refunds (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, kind TEXT, source TEXT, stripe_event_id TEXT, amount_cents INTEGER, is_full INTEGER, state TEXT NOT NULL DEFAULT \'needs_review\', note TEXT, raised_by_admin_id INTEGER, created_at TEXT, decided_by_admin_id INTEGER, decided_at TEXT)');
db.exec('CREATE TABLE crm_onboarding_started (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, template_id INTEGER, steps_added INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (opportunity_id))');
env.install(pool);
const C = require(path.join(env.SERVER, 'lib/crm-customers.js'));
const { server, call } = env.listen([['/api/crm/customers', require(path.join(env.SERVER, 'routes/crm-customers.js'))]]);
test.after(() => server.close());

const admin = env.addAdmin(db, 'g11boss', 'admin'), sales = env.addAdmin(db, 'g11rep', 'sales'), viewer = env.addAdmin(db, 'g11viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
const ymd = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const TODAY = ymd(0), NOW = `${TODAY} 12:00:00`;
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;

const D1 = ins("INSERT INTO districts (name) VALUES ('G11 District')");
let n = 0;
// A school with a CRM account. Returns { school, account }.
function school(name, owner = null) {
  n++;
  const s = ins('INSERT INTO schools (domain, district_id, display_name) VALUES (?, ?, ?)', `s${n}.g11.test`, D1, name);
  const a = ins("INSERT INTO crm_accounts (name, account_type, school_id, assigned_admin_id) VALUES (?, 'school', ?, ?)", name, s, owner);
  return { school: s, account: a, domain: `s${n}.g11.test` };
}
// A paid group license. f: ends (days from today), seats, registered, email, cents, trial.
function license(sc, f = {}) {
  const buyer = env.addContact(db, f.email || `buyer${++n}@g11.test`);
  const id = env.addPurchase(db, buyer, { amountCents: f.cents === undefined ? 90000 : f.cents, trialLessonLimit: f.trial ? 5 : undefined, trialExpirationDate: f.trial ? ymd(20) : undefined });
  db.prepare('UPDATE purchases SET school_id = ?, school_domain = ?, seat_count = ?, expiration_date = ?, product_type = ? WHERE id = ?').run(sc.school, sc.domain, f.seats === undefined ? 50 : f.seats, ymd(f.ends === undefined ? 40 : f.ends), 'group_license', id);
  for (let i = 0; i < (f.registered || 0); i++) db.prepare("INSERT INTO license_seats (purchase_id, status) VALUES (?, 'registered')").run(id);
  return id;
}
// A deal on an account. f: type, state, next (next step text), due, amount, owner, renewalOf, stageKey.
function deal(sc, f = {}) {
  return ins(`INSERT INTO crm_opportunities (account_id, name, stage_id, state, opp_type, amount_cents, owner_admin_id, next_step, next_step_due_at, renewal_of_purchase_id, expected_close_date, stage_entered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-11-01 10:00:00')`, sc.account, f.name || `G11 deal ${++n}`, stage(f.stageKey || 'qualified'), f.state || 'open', f.type || 'renewal', f.amount === undefined ? null : f.amount,
    f.owner || null, f.next === undefined ? 'Call the principal' : f.next, f.due || null, f.renewalOf || null, f.close || null);
}
const reset = () => db.exec('DELETE FROM crm_onboarding_started; DELETE FROM crm_opportunity_checklist_items; DELETE FROM crm_procurement_templates; DELETE FROM crm_purchase_refunds; DELETE FROM license_seats; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunity_contacts; DELETE FROM crm_opportunities; DELETE FROM crm_accounts; DELETE FROM schools; DELETE FROM newsletter_contacts');
const build = () => C.build(pool, { today: TODAY, now: NOW });

test('RENEWALS: only paid, non-trial group licenses ending inside the window (or just ended), not already renewed, not a test address; each with its reasons and no score', async () => {
  const a = school('Alpha School'), b = school('Beta School'), c = school('Gamma School'), d = school('Delta School'), e = school('Epsilon School'), f = school('Old School'), t = school('Test School');
  const pa = license(a, { ends: 20, seats: 50, registered: 40 }); deal(a, { renewalOf: pa });                        // healthy: deal, next step, good use
  const pb = license(b, { ends: 60, seats: 50, registered: 10 });                                                     // no deal and low use
  const pc = license(c, { ends: 30, seats: 50, registered: 45 }); deal(c, { renewalOf: pc, next: '' });              // no next step
  const pd = license(d, { ends: 30, seats: 50, registered: 45 }); deal(d, { renewalOf: pd, due: `${ymd(-3)} 12:00:00` }); // overdue next step
  const pe = license(e, { ends: -10, seats: null, registered: 0 }); deal(e, { renewalOf: pe });                       // just ended, seats unknown
  db.prepare("INSERT INTO crm_purchase_refunds (purchase_id, kind, source, state) VALUES (?, 'refund', 'staff', 'needs_review')").run(pa);
  license(f, { ends: 200 });                                                                                          // too far away
  license(f, { ends: -90 });                                                                                          // ended too long ago
  license(f, { ends: 30, trial: true });                                                                              // a trial
  license(f, { ends: 30, cents: 0 });                                                                                 // zero amount
  license(t, { ends: 30, email: 'qa@example.com' });                                                                  // a test address
  const r = (await build()).renewals;
  const by = Object.fromEntries(r.rows.map(x => [x.purchaseId, x]));
  assert.deepEqual(Object.keys(by).map(Number).sort((x, y) => x - y), [pa, pb, pc, pd, pe].sort((x, y) => x - y));
  assert.deepEqual(by[pa].reasons, ['A refund or dispute flag is waiting for a decision']);
  assert.deepEqual(by[pb].reasons, ['No open renewal deal yet', 'Fewer than half the seats are registered (10 of 50)']);
  assert.deepEqual(by[pc].reasons, ['The renewal deal has no next step']);
  assert.deepEqual(by[pd].reasons, ['The renewal deal’s next step is overdue']);
  assert.deepEqual(by[pe].reasons, [], 'unknown seat use is never a reason, and a healthy deal is not flagged');
  assert.equal(by[pe].seatsTotal, null); assert.equal(by[pe].seatsRegistered, null); assert.equal(by[pe].endedDaysAgo, 10); assert.equal(by[pe].atRisk, false);
  assert.equal(r.atRisk, 4); assert.equal(r.total, 5);
  assert.deepEqual(r.rows.map(x => x.atRisk), [true, true, true, true, false], 'the ones that need a look come first');
  assert.equal(by[pa].deal.stage, 'Qualified'); assert.equal(by[pa].lastTermCents, 90000);
  assert.doesNotMatch(JSON.stringify(r), /score|\bhot\b|\bwarm\b|\bcold\b|@/i, 'no score, no hot/warm/cold, no email address');
  reset();
});

test('ALREADY RENEWED AND DEALS: a later license that runs well past this one takes it off the list; a closed renewal deal does not count as open', async () => {
  const a = school('Alpha School'), b = school('Beta School');
  const old = license(a, { ends: 20 });
  license(a, { ends: 400 });                                   // the renewal itself
  const pb = license(b, { ends: 25, registered: 30, seats: 50 });
  deal(b, { renewalOf: pb, state: 'won' });                    // finished: not an open deal
  const r = (await build()).renewals;
  assert.deepEqual(r.rows.map(x => x.purchaseId), [pb]); assert.equal(r.alreadyRenewedLeftOut, 1);
  assert.ok(!r.rows.some(x => x.purchaseId === old));
  assert.deepEqual(r.rows[0].reasons, ['No open renewal deal yet']);
  reset();
});

test('EXPANSION: open expansion deals with their total (no value is not zero), and well-used licenses with no open expansion deal', async () => {
  const a = school('Alpha School', admin), b = school('Beta School'), c = school('Gamma School'), d = school('Delta School');
  deal(a, { type: 'expansion', amount: 250000, owner: admin, close: ymd(20), name: 'More seats Alpha' });
  deal(a, { type: 'expansion', amount: null, name: 'More seats Alpha 2' });
  deal(a, { type: 'expansion', state: 'won', amount: 99999 });
  deal(b, { type: 'renewal', amount: 5000 });
  license(a, { seats: 50, registered: 49 });                   // well used, but Alpha already has an open expansion deal
  const pb = license(b, { seats: 50, registered: 46 });        // well used, no expansion deal
  license(c, { seats: 50, registered: 20 });                   // not well used
  license(d, { seats: 50, registered: 50, email: 'qa@example.com' }); // a test address
  const x = (await build()).expansion;
  assert.equal(x.dealCount, 2); assert.equal(x.valueCents, 250000); assert.equal(x.withoutValue, 1);
  assert.deepEqual(x.deals.map(d => d.name), ['More seats Alpha', 'More seats Alpha 2'], 'dated first');
  assert.deepEqual(x.wellUsed.map(w => w.purchaseId), [pb]); assert.equal(x.wellUsed[0].seatsRegistered, 46); assert.equal(x.wellUsedPercent, 90);
  reset();
});

test('ONBOARDING: progress per deal from the Onboarding checklist only, steps done and overdue, the waiting count, and the switch state', async () => {
  const a = school('Alpha School');
  const tpl = ins("INSERT INTO crm_procurement_templates (name, items_json, is_active) VALUES ('Onboarding', '[{\"label\":\"Welcome call\"}]', 1)");
  const other = ins("INSERT INTO crm_procurement_templates (name, items_json, is_active) VALUES ('Procurement', '[]', 1)");
  const d1 = deal(a, { type: 'new_business', state: 'won', name: 'Alpha onboarding' });
  const step = (d, label, status, due, t) => ins('INSERT INTO crm_opportunity_checklist_items (opportunity_id, template_id, label, status, due_on) VALUES (?, ?, ?, ?, ?)', d, t, label, status, due);
  step(d1, 'Welcome call', 'done', ymd(-5), tpl); step(d1, 'Invitations', 'open', ymd(-2), tpl); step(d1, 'Training', 'open', ymd(10), tpl); step(d1, 'COI', 'open', ymd(-9), other);
  db.prepare('INSERT INTO crm_onboarding_started (opportunity_id, template_id, steps_added) VALUES (?, ?, 3)').run(d1, tpl);
  // A Won and paid deal with no checklist yet.
  const b = school('Beta School');
  const d2 = deal(b, { type: 'new_business', state: 'won' });
  const cb = env.addContact(db, 'b-buyer@g11.test');
  const q = env.addQuote(db, 'b-buyer@g11.test', { opportunityId: d2, number: 'G11-1', contactId: cb });
  env.addPurchase(db, cb, { amountCents: 70000, quoteId: q });
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('crm_onboarding_auto', 'true')").run();
  const o = (await build()).onboarding;
  assert.equal(o.dealCount, 1); assert.deepEqual(o.deals[0], { id: d1, name: 'Alpha onboarding', accountName: 'Alpha School', ownerName: null, total: 3, done: 1, overdue: 1 });
  assert.equal(o.steps, 3); assert.equal(o.stepsDone, 1); assert.equal(o.stepsOverdue, 1);
  assert.equal(o.waitingForChecklist, 1); assert.equal(o.switchOn, true);
  db.prepare("UPDATE settings SET setting_value = 'false' WHERE setting_key = 'crm_onboarding_auto'").run();
  assert.equal((await build()).onboarding.switchOn, false);
  reset(); db.exec("DELETE FROM settings WHERE setting_key = 'crm_onboarding_auto'");
});

test('WHO CAN READ IT: every CRM role; nobody signed in gets nothing; the route and the library only read', async () => {
  const a = school('Alpha School'); license(a, { ends: 20 });
  for (const who of [admin, sales, viewer]) {
    const r = await call('GET', '/api/crm/customers', undefined, who);
    assert.equal(r.status, 200); assert.ok(r.json.renewals && r.json.expansion && r.json.onboarding, 'all three parts');
  }
  assert.equal((await call('GET', '/api/crm/customers')).status, 401);
  env.enable(db, false);
  assert.equal((await call('GET', '/api/crm/customers', undefined, admin)).status, 404, 'a 404 while the Hub is off, like every CRM route');
  env.enable(db, true);
  const src = ['lib/crm-customers.js', 'routes/crm-customers.js'].map(f => fs.readFileSync(path.join(env.SERVER, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')).join('\n');
  assert.doesNotMatch(src, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b|\bALTER TABLE\b|mailer|\bscore\b/i);
  assert.match(fs.readFileSync(path.join(env.SERVER, 'lib/crm-permissions.js'), 'utf8'), /view: \[/);
  reset();
});

test('A SOURCE THAT IS NOT THERE YET IS NULL, NOT ZERO: before the onboarding table exists that part comes back null and the rest still works', async () => {
  const a = school('Alpha School'); license(a, { ends: 20 });
  db.exec('DROP TABLE crm_onboarding_started');
  const r = await build();
  assert.equal(r.onboarding, null); assert.equal(r.renewals.total, 1); assert.ok(r.expansion);
  db.exec('CREATE TABLE crm_onboarding_started (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, template_id INTEGER, steps_added INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (opportunity_id))');
  reset();
});

test('THE PAGE: every outside value is escaped, it shows reasons not a score, it is read only, and the menu, shell and route are wired', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
  const page = read('admin-crm-customers.html');
  assert.match(page, /esc\(r\.deal\.nextStep\)/); assert.match(page, /esc\(x\.name\)/); assert.match(page, /esc\(x\)/);
  assert.doesNotMatch(page, /C\.api\('(POST|PUT|DELETE)'/, 'nothing on this page writes');
  assert.doesNotMatch(page, /hot lead|warm lead|cold lead/i);
  assert.match(page, /admin-nav\.js\?v=40/); assert.match(page, /admin-shell\.js\?v=13/); assert.match(page, /name="robots" content="noindex"/);
  assert.match(read('admin-nav.js'), /admin-crm-customers\.html/); assert.match(read('admin-nav.js'), /"crm-customers": "</);
  assert.match(read('admin-shell.js'), /'crm-customers':/);
  assert.match(fs.readFileSync(path.join(env.SERVER, 'app.js'), 'utf8'), /\/api\/crm\/customers/);
  for (const f of ['lib/crm-customers.js', 'routes/crm-customers.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
