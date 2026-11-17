// Sales CRM punch list G10 (PRD FR-ATTR-01): "Source to paid" also groups deals by how the deal's main contact found us, first visit and latest visit side by side,
// with the Source staff typed as a labelled fallback. Real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const which of ['first', 'latest']) {
  for (const c of ['source', 'medium', 'campaign', 'landing']) db.exec(`ALTER TABLE newsletter_contacts ADD COLUMN ${which}_touch_${c} TEXT`);
  db.exec(`ALTER TABLE newsletter_contacts ADD COLUMN ${which}_touch_at TEXT`);
}
env.install(pool);
const reports = require(path.join(env.SERVER, 'lib/crm-reports.js'));

const get = (sql, ...a) => db.prepare(sql).get(...a);
const WIN = { from: '2026-10-01', to: '2026-10-31' };
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('G10 District')").run().lastInsertRowid);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
let n = 0;
// A deal whose main contact has the given touches. f: first [source, medium], latest [source, medium], typed (deal Source), paid (cents), noPrimary (link through the quote only), trial.
function deal(f = {}) {
  n++;
  const email = f.email || `g10-${n}@school.test`;
  const contact = env.addContact(db, email);
  if (f.first) db.prepare('UPDATE newsletter_contacts SET first_touch_source = ?, first_touch_medium = ?, first_touch_at = ? WHERE id = ?').run(f.first[0], f.first[1] || null, '2026-09-01 10:00:00', contact);
  if (f.latest) db.prepare('UPDATE newsletter_contacts SET latest_touch_source = ?, latest_touch_medium = ?, latest_touch_at = ? WHERE id = ?').run(f.latest[0], f.latest[1] || null, '2026-10-02 10:00:00', contact);
  const id = Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, state, source, primary_contact_id, created_at, stage_entered_at)
    VALUES (?, ?, ?, 'open', ?, ?, '2026-10-10 09:00:00', '2026-10-10 09:00:00')`).run(acct, `G10 deal ${n}`, stage('qualified'), f.typed === undefined ? null : f.typed, f.noPrimary ? null : contact).lastInsertRowid);
  const quote = env.addQuote(db, email, { opportunityId: id, number: `G10-${n}`, contactId: contact });
  if (f.paid) env.addPurchase(db, contact, { amountCents: f.paid, quoteId: quote, trialLessonLimit: f.trial ? 5 : undefined, trialExpirationDate: f.trial ? '2026-12-01 00:00:00' : undefined });
  return id;
}
const run = async () => reports.runReport(pool, 'sourcetopaid', WIN);
const rowOf = (r, label) => r.touchRows.find(x => x.label === label);

test('SIDE BY SIDE: each deal is counted once on each side; first and latest can differ; money counts once', async () => {
  deal({ first: ['google', 'cpc'], latest: ['newsletter', 'email'], paid: 40000 });
  deal({ first: ['google', 'cpc'], latest: ['google', 'cpc'], paid: 25000 });
  deal({ first: ['linkedin', 'social'], latest: ['newsletter', 'email'] });
  const r = await run();
  assert.equal(r.touch.available, true);
  const g = rowOf(r, 'google / cpc'), nl = rowOf(r, 'newsletter / email'), li = rowOf(r, 'linkedin / social');
  assert.deepEqual(g.first, { deals: 2, paidDeals: 2, paidCents: 65000 });
  assert.deepEqual(g.latest, { deals: 1, paidDeals: 1, paidCents: 25000 });
  assert.deepEqual(nl.first, { deals: 0, paidDeals: 0, paidCents: 0 });
  assert.deepEqual(nl.latest, { deals: 2, paidDeals: 1, paidCents: 40000 });
  assert.equal(li.first.deals, 1); assert.equal(li.latest.deals, 0);
  const t = r.tables[0].rows.at(-1);
  assert.equal(t[0], 'All deals');
  assert.equal(t[1], r.totals.deals, 'the first-visit side adds up to every deal'); assert.equal(t[4], r.totals.deals, 'so does the latest-visit side');
  assert.equal(t[3], (r.totals.paidCents / 100).toFixed(2)); assert.equal(t[6], t[3]);
  db.exec('DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts');
});

test('FALLBACK: a deal whose contact has no tracked visit is grouped under "Typed by staff:" with the typed Source, on both sides', async () => {
  deal({ typed: 'Conference', paid: 10000 });
  deal({ typed: 'Conference' });
  deal({ typed: null });
  deal({ first: ['google', 'cpc'], typed: 'Referral' });   // a tracked visit wins over what staff typed
  const r = await run();
  const c = rowOf(r, 'Typed by staff: Conference');
  assert.deepEqual(c.first, c.latest); assert.equal(c.first.deals, 2); assert.equal(c.first.paidDeals, 1);
  assert.equal(rowOf(r, 'Typed by staff: Not recorded').first.deals, 1);
  assert.equal(rowOf(r, 'google / cpc').first.deals, 1);
  assert.ok(!rowOf(r, 'Typed by staff: Referral'), 'the typed Source is only a fallback');
  assert.deepEqual([r.touch.trackedDeals, r.touch.typedFallbackDeals], [1, 3]);
  db.exec('DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts');
});

test('WHICH CONTACT: the primary contact, else the person on the earliest quote; a trial is never paid; test addresses stay out', async () => {
  deal({ first: ['bing', 'cpc'], noPrimary: true, paid: 30000 });
  deal({ first: ['bing', 'cpc'], paid: 9000, trial: true });
  deal({ first: ['bing', 'cpc'], email: 'qa@example.com', paid: 5000 });
  const r = await run();
  const b = rowOf(r, 'bing / cpc');
  assert.equal(b.first.deals, 2, 'the test-address deal is out'); assert.equal(b.first.paidDeals, 1); assert.equal(b.first.paidCents, 30000);
  db.exec('DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts');
});

test('TYPED TABLE AND TOTALS ARE UNCHANGED, and a no-medium or "none" medium shows just the source', async () => {
  deal({ first: ['direct', 'none'], typed: 'Web', paid: 20000 });
  deal({ first: ['partner-site'], typed: 'Web' });
  const r = await run();
  assert.ok(rowOf(r, 'direct') && rowOf(r, 'partner-site'));
  const web = r.sources.find(s => s.source === 'Web');
  assert.equal(web.deals, 2); assert.equal(web.paidCents, 20000);
  assert.equal(r.tables[1].rows.length, r.table.rows.length, 'the typed Source table is still there, row for row');
  assert.equal(r.tables.length, 2);
  db.exec('DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts');
});

test('SAFE: before the touch columns exist the report still runs on the typed Source and says tracking is not installed', async () => {
  const { db: db2, pool: pool2 } = env.makeDb();   // a database with no touch columns at all
  env.install(pool2);
  const a = Number(db2.prepare("INSERT INTO crm_accounts (name) VALUES ('Old District')").run().lastInsertRowid);
  const st = db2.prepare("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'qualified'").get().id;
  db2.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state, source, created_at, stage_entered_at) VALUES (?, 'Old deal', ?, 'open', 'Referral', '2026-10-10 09:00:00', '2026-10-10 09:00:00')").run(a, st);
  const r = await reports.runReport(pool2, 'sourcetopaid', WIN);
  assert.equal(r.touch.available, false);
  assert.equal(r.touchRows[0].label, 'Typed by staff: Referral');
  env.install(pool);
});

test('EXPORT AND RULES: the CSV carries both tables, a formula-looking source cannot run, and nothing here writes or names a person', async () => {
  deal({ first: ['=HYPERLINK("x")', 'cpc'], paid: 1000 });
  const r = await run();
  const csv = reports.toCsv(r);
  assert.match(csv, /By how the main contact found us/); assert.match(csv, /By the Source staff typed/);
  assert.ok(!csv.split('\r\n').some(l => /^[=+@]/.test(l)));
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-reports.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b/i);
  assert.doesNotMatch(JSON.stringify(r), /@school\.test|G10 deal/, 'no email or deal name in the report');
  db.exec('DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts');
});
