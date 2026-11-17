// Sales CRM punch list G4 (PRD FR-WON-03): a deal that is Won AND has a real paid purchase on one of its quotes gets the "Onboarding" checklist, once per deal, ever. Real SQL (node:sqlite).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
const LEDGER = 'CREATE TABLE crm_onboarding_started (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, template_id INTEGER, steps_added INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (opportunity_id))';
db.exec(LEDGER);
env.install(pool);
const OB = require(path.join(env.SERVER, 'lib/crm-onboarding.js'));

const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const NOW = '2026-11-16 06:50:00';
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('G4 District')").run().lastInsertRowid);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
let n = 0;
// A deal. f: state (default 'won'), email (the quote's address), paid ('paid' | 'pending' | none), cents, trial, noQuote.
function deal(f = {}) {
  n++;
  const id = Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, state, closed_at, stage_entered_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(acct, `G4 deal ${n}`, stage('qualified'), f.state || 'won', f.state === 'open' ? null : '2026-11-10 10:00:00', '2026-11-01 10:00:00').lastInsertRowid);
  if (f.noQuote) return id;
  const email = f.email || `buyer${n}@school.test`;
  const contact = env.addContact(db, email);
  const quote = env.addQuote(db, email, { opportunityId: id, number: `G4-${n}`, contactId: contact });
  if (f.paid !== 'none') env.addPurchase(db, contact, {
    paymentStatus: f.paid || 'paid', amountCents: f.cents === undefined ? 50000 : f.cents, quoteId: quote,
    trialLessonLimit: f.trial ? 5 : undefined, trialExpirationDate: f.trial ? '2026-12-01 00:00:00' : undefined,
  });
  return id;
}
const addTemplate = (steps = OB.STARTER_STEPS, active = 1) => db.prepare('INSERT INTO crm_procurement_templates (name, items_json, is_active) VALUES (?, ?, ?)')
  .run(OB.TEMPLATE_NAME, JSON.stringify(steps.map(label => ({ label }))), active);
const items = (id) => all('SELECT * FROM crm_opportunity_checklist_items WHERE opportunity_id = ? ORDER BY sort_order, id', id);
const reset = () => db.exec('DELETE FROM crm_onboarding_started; DELETE FROM crm_opportunity_checklist_items; DELETE FROM crm_procurement_templates; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log');
const run = (apply = true) => OB.startOnboarding(pool, { apply, now: NOW });

test('WON AND PAID: only a Won deal with a paid, non-trial purchase of more than zero on one of its quotes is started', async () => {
  addTemplate();
  const good = deal();
  deal({ state: 'open' });                    // not Won
  deal({ paid: 'pending' });                  // Won but not paid
  deal({ paid: 'none' });                     // Won, quote, no purchase
  deal({ noQuote: true });                    // Won by phone, nothing to link a purchase to
  deal({ cents: 0 });                         // paid but zero
  deal({ trial: true });                      // a trial
  deal({ email: 'qa@example.com' });          // a test address
  const r = await run();
  assert.equal(r.eligible, 1); assert.equal(r.made, 1); assert.equal(r.stepsAdded, OB.STARTER_STEPS.length);
  assert.deepEqual(all('SELECT opportunity_id FROM crm_onboarding_started').map(x => x.opportunity_id), [good]);
  assert.deepEqual(items(good).map(i => i.label), OB.STARTER_STEPS);
  assert.ok(items(good).every(i => i.status === 'open' && i.created_by_admin_id === null && i.template_id));
  assert.equal(all('SELECT * FROM crm_opportunity_checklist_items').length, OB.STARTER_STEPS.length, 'no other deal got any step');
  reset();
});

test('ONCE: running again, running twice at once, and deleting the steps never add them a second time; two paid quotes on one deal are still one deal', async () => {
  addTemplate(['Welcome call', 'Invitations sent']);
  const d = deal();
  const email2 = 'second@school.test';
  const c2 = env.addContact(db, email2);
  env.addPurchase(db, c2, { amountCents: 70000, quoteId: env.addQuote(db, email2, { opportunityId: d, number: 'G4-second', contactId: c2 }) });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.made + b.made, 1, 'exactly one of two simultaneous runs did the work');
  assert.equal(items(d).length, 2);
  assert.equal((await run()).made, 0); assert.equal((await run()).alreadyDone, 1);
  db.prepare('DELETE FROM crm_opportunity_checklist_items WHERE opportunity_id = ?').run(d);
  assert.equal((await run()).made, 0); assert.equal(items(d).length, 0, 'staff removing the steps on purpose is respected');
  reset();
});

test('RESPECTS WHAT IS THERE: a step the deal already has (same words, any capitals) is not doubled, and the deal still counts as done', async () => {
  addTemplate(['Welcome call', 'Invitations sent']);
  const d = deal();
  db.prepare("INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, sort_order, status) VALUES (?, 'welcome CALL', 10, 'done')").run(d);
  const r = await run();
  assert.equal(r.made, 1); assert.equal(r.stepsAdded, 1);
  assert.deepEqual(items(d).map(i => [i.label, i.status]), [['welcome CALL', 'done'], ['Invitations sent', 'open']]);
  assert.ok(items(d)[1].sort_order > items(d)[0].sort_order, 'new steps go after the existing ones');
  assert.equal((await run()).made, 0);
  reset();
});

test('TEMPLATE: no template, an inactive one or one with no steps adds nothing and claims nothing, so the deal is picked up once a template exists', async () => {
  const d = deal();
  let r = await run();
  assert.equal(r.hasTemplate, false); assert.equal(r.made, 0); assert.equal(r.eligible, 1);
  addTemplate(['Step one'], 0);
  assert.equal((await run()).hasTemplate, false, 'inactive');
  db.exec('DELETE FROM crm_procurement_templates'); addTemplate([]);
  assert.equal((await run()).hasTemplate, false, 'no steps');
  assert.equal(get('SELECT COUNT(*) n FROM crm_onboarding_started').n, 0);
  db.exec('DELETE FROM crm_procurement_templates'); addTemplate(['Step one', 'Step two']);
  r = await run();
  assert.equal(r.made, 1); assert.deepEqual(items(d).map(i => i.label), ['Step one', 'Step two']);
  // Editing the template later changes what NEW deals get, never a deal that was already started.
  const d2 = deal();
  db.prepare('UPDATE crm_procurement_templates SET items_json = ?').run(JSON.stringify([{ label: 'Only step' }]));
  await run();
  assert.deepEqual(items(d2).map(i => i.label), ['Only step']); assert.equal(items(d).length, 2);
  reset();
});

test('SWITCH AND REPORT: without apply it counts and writes nothing; the audit row names counts and ids only', async () => {
  addTemplate(['Welcome call']);
  const d = deal();
  const dry = await run(false);
  assert.equal(dry.eligible, 1); assert.equal(dry.wouldMake, 1); assert.equal(dry.made, 0);
  assert.equal(items(d).length, 0); assert.equal(get('SELECT COUNT(*) n FROM crm_onboarding_started').n, 0);
  await run(true);
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_onboarding_started'");
  assert.ok(row); assert.equal(Number(row.entity_id), d); assert.equal(row.actor_type, 'system');
  assert.doesNotMatch(JSON.stringify(row), /@school\.test|Pat|Example/, 'no person is named');
  reset();
});

test('SAFE: before the alter script has run it skips and says so; a failed write leaves no claim so the next run tries again', async () => {
  addTemplate(['Welcome call']);
  const d = deal();
  db.exec('DROP TABLE crm_onboarding_started');
  assert.equal((await run()).available, false); assert.equal(items(d).length, 0);
  db.exec(LEDGER);
  const broken = { query: (sql, p) => (/INSERT INTO crm_opportunity_checklist_items/.test(sql) ? Promise.reject(new Error('disk full')) : pool.query(sql, p)) };
  await assert.rejects(OB.startOnboarding(broken, { apply: true, now: NOW }), /disk full/);
  assert.equal(get('SELECT COUNT(*) n FROM crm_onboarding_started').n, 0);
  assert.equal((await run()).made, 1); assert.equal(items(d).length, 1);
  reset();
});

test('WRITES ONLY CHECKLIST STEPS: no purchase, invoice, quote, contact label, task or email is touched', async () => {
  addTemplate(); deal(); deal();
  const snap = () => JSON.stringify(['purchases', 'quote_requests', 'invoices', 'newsletter_contacts', 'crm_opportunities', 'crm_tasks', 'license_seats'].map(t => { try { return all(`SELECT * FROM ${t} ORDER BY 1`); } catch { return []; } }));
  const before = snap();
  await run();
  assert.equal(snap(), before);
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-onboarding.js'), 'utf8');
  assert.doesNotMatch(src, /mailer|sendMail|UPDATE (purchases|quote_requests|invoices|newsletter_contacts|crm_opportunities)|INSERT INTO (purchases|invoices|license_seats|crm_tasks)|OpenAI|anthropic/i);
  reset();
});

test('FILES: schema.sql and the alter script define the ledger with its unique key and seed the template only when missing; the daily script has the switch', () => {
  const schema = fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8');
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-create-crm-onboarding.js'), 'utf8');
  const daily = fs.readFileSync(path.join(env.SERVER, 'scripts/crm-daily-attention.js'), 'utf8');
  for (const src of [schema, alter]) { assert.match(src, /CREATE TABLE IF NOT EXISTS crm_onboarding_started/); assert.match(src, /UNIQUE KEY uq_crm_onboarding_opp \(opportunity_id\)/); }
  assert.match(alter, /already exists \(left as it is\)/); assert.match(alter, /information_schema\.TABLES/);
  assert.match(daily, /--onboarding/); assert.match(daily, /OB\.SWITCH/); assert.equal(OB.SWITCH, 'crm_onboarding_auto');
  assert.equal(OB.TEMPLATE_NAME, 'Onboarding'); assert.equal(OB.STARTER_STEPS.length, 6);
  for (const f of ['lib/crm-onboarding.js', 'scripts/alter-create-crm-onboarding.js', 'scripts/crm-daily-attention.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
