// Sales CRM punch list G20 (PRD section 20, the one event the owner chose): ONE follow-up task a settable number of days after a quote was sent and not accepted,
// once per quote, ever, logged. Real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
const LEDGER = 'CREATE TABLE crm_quote_followup_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, task_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (quote_id))';
db.exec(LEDGER);
env.install(pool);
const QF = require(path.join(env.SERVER, 'lib/crm-quote-followups.js'));
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));

const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const TODAY = '2026-11-16';
const NOW = '2026-11-16 06:50:00';
const rep = env.addAdmin(db, 'g20rep', 'sales');
const rep2 = env.addAdmin(db, 'g20other', 'sales');
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('G20 District')").run().lastInsertRowid);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
let n = 0;
const daysAgo = (d) => new Date(new Date(`${TODAY}T10:00:00Z`).getTime() - d * 86400000).toISOString().slice(0, 19).replace('T', ' ');
// A quote. f: ago (days since it was sent, default 6), state (deal state; 'none' = no deal), owner (deal owner), contactOwner, email, accepted, version, status, noContact.
function quote(f = {}) {
  n++;
  const email = f.email || `g20-${n}@school.test`;
  const contact = f.noContact ? null : env.addContact(db, email);
  if (contact && f.contactOwner) db.prepare('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?').run(f.contactOwner, contact);
  let deal = null;
  if (f.state !== 'none') {
    deal = Number(db.prepare(`INSERT INTO crm_opportunities (account_id, name, stage_id, state, owner_admin_id, stage_entered_at) VALUES (?, ?, ?, ?, ?, '2026-11-01 10:00:00')`)
      .run(acct, `G20 deal ${n}`, stage('proposal_sent'), f.state || 'open', f.owner || null).lastInsertRowid);
  }
  const id = env.addQuote(db, email, { number: `G20-${n}`, contactId: contact, opportunityId: deal, sentAt: daysAgo(f.ago === undefined ? 6 : f.ago) });
  if (f.accepted) db.prepare('UPDATE quote_requests SET accepted_at = ? WHERE id = ?').run(daysAgo(1), id);
  if (f.version) db.prepare('UPDATE quote_requests SET version_status = ? WHERE id = ?').run(f.version, id);
  if (f.status) db.prepare('UPDATE quote_requests SET status = ? WHERE id = ?').run(f.status, id);
  return { id, deal, contact };
}
const tasks = () => all('SELECT * FROM crm_tasks ORDER BY id');
const reset = () => db.exec('DELETE FROM crm_quote_followup_tasks; DELETE FROM crm_tasks; DELETE FROM purchases; DELETE FROM quote_requests; DELETE FROM crm_opportunities; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log; DELETE FROM settings');
const run = (apply = true, days) => QF.createFollowUps(pool, { apply, now: NOW, today: TODAY, days });

test('WHICH QUOTES: sent N or more days ago, not accepted, not replaced, still open, on an open deal or none, not a test address, and not older than the look-back', async () => {
  const good = quote({ ago: 6, owner: rep });
  quote({ ago: 5 });                                 // exactly the number of days: counts
  quote({ ago: 4 });                                 // too soon
  quote({ ago: QF.LOOKBACK_DAYS + 5 });              // too old: left to the Needs Attention page
  quote({ accepted: true });
  quote({ version: 'superseded' });
  quote({ status: 'converted' });
  quote({ state: 'won' });
  quote({ state: 'lost' });
  quote({ email: 'qa@example.com' });
  quote({ state: 'none' });                          // no deal: counts, goes on the contact
  const r = await run();
  assert.equal(r.days, 5); assert.equal(r.eligible, 3); assert.equal(r.made, 3);
  assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks').n, 3);
  const t = tasks().find(x => x.opportunity_id === good.deal);
  assert.match(t.title, /^Follow up on quote G20-/); assert.equal(t.due_on, TODAY); assert.equal(t.state, 'open'); assert.equal(t.assigned_admin_id, rep);
  assert.match(t.details, /Nothing has been offered or sent/); assert.doesNotMatch(t.details + t.title, /@|Pat|Example/);
  reset();
});

test('ONCE: running again, running twice at once, and deleting the task never make a second one for the same quote; a revision is its own quote', async () => {
  const q = quote({ owner: rep });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.made + b.made, 1, 'exactly one of two simultaneous runs made it');
  assert.equal((await run()).made, 0); assert.equal((await run()).alreadyMade, 1);
  db.prepare('DELETE FROM crm_tasks').run();
  assert.equal((await run()).made, 0); assert.equal(tasks().length, 0, 'staff deleting the task on purpose is respected');
  assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks WHERE quote_id = ?', q.id).n, 1, 'the ledger row stays when the task goes (in MariaDB the foreign key only clears task_id)');
  // The quote is revised: the old one is replaced (no task needed) and the revision, once sent and old enough, gets its own.
  db.prepare("UPDATE quote_requests SET version_status = 'superseded' WHERE id = ?").run(q.id);
  const rev = env.addQuote(db, 'g20-rev@school.test', { number: 'G20-rev', opportunityId: q.deal, contactId: q.contact, sentAt: daysAgo(6) });
  assert.equal((await run()).made, 1); assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks WHERE quote_id = ?', rev).n, 1);
  reset();
});

test('WHERE IT GOES AND WHO GETS IT: the deal and its owner, else the buyer and their owner, else nobody; an owner who is gone leaves it unassigned; nothing to hang it on makes nothing and claims nothing', async () => {
  const onDeal = quote({ owner: rep, contactOwner: rep2 });
  const contactOnly = quote({ state: 'none', contactOwner: rep2 });
  const nobody = quote({});
  const gone = quote({ owner: 99999 });
  const orphan = quote({ state: 'none', noContact: true });
  const r = await run();
  assert.equal(r.made, 4); assert.equal(r.noPlace, 1);
  const t = (id) => tasks().find(x => x.opportunity_id === id);
  assert.equal(t(onDeal.deal).assigned_admin_id, rep, 'the deal owner, not the buyer owner');
  assert.equal(t(nobody.deal).assigned_admin_id, null);
  assert.equal(t(gone.deal).assigned_admin_id, null);
  const c = tasks().find(x => x.contact_id === contactOnly.contact);
  assert.ok(c && c.opportunity_id === null && c.assigned_admin_id === rep2);
  assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks WHERE quote_id = ?', orphan.id).n, 0, 'no claim, so it is made once a contact exists');
  reset();
});

test('SWITCH AND LOG: without apply it counts and writes nothing; each task has an audit row naming ids and dates only', async () => {
  const q = quote({ owner: rep });
  const dry = await run(false);
  assert.equal(dry.eligible, 1); assert.equal(dry.wouldMake, 1); assert.equal(dry.made, 0);
  assert.equal(tasks().length, 0); assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks').n, 0);
  await run(true);
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_task_created'");
  assert.ok(row); assert.equal(row.actor_type, 'system');
  const nv = JSON.parse(row.new_value);
  assert.equal(nv.generated, 'crm.quote.followup'); assert.equal(nv.quoteId, q.id); assert.equal(nv.subject, 'opportunity');
  assert.doesNotMatch(JSON.stringify(row), /@school\.test|Pat|Example/, 'no person is named');
  reset();
});

test('SETTABLE: the number of days is a Hub Settings threshold (default 5, 1 to 60); a bad stored value falls back to 5', async () => {
  const d = A.THRESHOLDS.quoteFollowupDays;
  assert.equal(d.def, 5); assert.equal(d.min, 1); assert.equal(d.max, 60); assert.equal(d.setting, 'crm_attn_quote_followup_days');
  assert.ok(d.label && d.help && !/—/.test(d.label + d.help));
  quote({ ago: 3 });
  assert.equal((await run()).eligible, 0, 'default 5 days');
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('crm_attn_quote_followup_days', '2')").run();
  assert.equal((await QF.createFollowUps(pool, { apply: true, now: NOW, today: TODAY })).made, 1, 'the setting is read when no number is passed');
  db.prepare("UPDATE settings SET setting_value = '0' WHERE setting_key = 'crm_attn_quote_followup_days'").run();
  assert.equal((await A.loadThresholds(pool)).quoteFollowupDays, 5, 'out of range falls back');
  db.prepare("UPDATE settings SET setting_value = 'soon' WHERE setting_key = 'crm_attn_quote_followup_days'").run();
  assert.equal((await A.loadThresholds(pool)).quoteFollowupDays, 5);
  reset();
});

test('SAFE: before the alter script has run it skips and says so; a failed write leaves no claim so the next run tries again', async () => {
  quote({ owner: rep });
  db.exec('DROP TABLE crm_quote_followup_tasks');
  assert.equal((await run()).available, false); assert.equal(tasks().length, 0);
  db.exec(LEDGER);
  const broken = { query: (sql, p) => (/INSERT INTO crm_tasks/.test(sql) ? Promise.reject(new Error('disk full')) : pool.query(sql, p)) };
  await assert.rejects(QF.createFollowUps(broken, { apply: true, now: NOW, today: TODAY }), /disk full/);
  assert.equal(get('SELECT COUNT(*) n FROM crm_quote_followup_tasks').n, 0);
  assert.equal((await run()).made, 1);
  reset();
});

test('WRITES ONLY A TASK: no quote, purchase, deal, contact label or email is touched', async () => {
  quote({ owner: rep }); quote({ state: 'none' });
  const snap = () => JSON.stringify(['quote_requests', 'purchases', 'invoices', 'crm_opportunities', 'newsletter_contacts'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`)));
  const before = snap();
  await run();
  assert.equal(snap(), before);
  const src = fs.readFileSync(path.join(env.SERVER, 'lib/crm-quote-followups.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(src, /mailer|sendMail|UPDATE (quote_requests|purchases|invoices|newsletter_contacts|crm_opportunities)|INSERT INTO (quote_requests|purchases|invoices)|OpenAI|anthropic/i);
  reset();
});

test('FILES: schema.sql and the alter script define the ledger with its unique key; the daily script has the switch', () => {
  const schema = fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8');
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-create-crm-quote-followups.js'), 'utf8');
  const daily = fs.readFileSync(path.join(env.SERVER, 'scripts/crm-daily-attention.js'), 'utf8');
  for (const src of [schema, alter]) { assert.match(src, /CREATE TABLE IF NOT EXISTS crm_quote_followup_tasks/); assert.match(src, /UNIQUE KEY uq_crm_quote_followup \(quote_id\)/); }
  assert.match(alter, /already exists/); assert.match(alter, /information_schema\.TABLES/);
  assert.match(daily, /--quote-followups/); assert.match(daily, /QF\.SWITCH/); assert.equal(QF.SWITCH, 'crm_quote_followup_tasks');
  for (const f of ['lib/crm-quote-followups.js', 'scripts/alter-create-crm-quote-followups.js', 'scripts/crm-daily-attention.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
