// Customer Hub follow-up: "My checklist steps", the open procurement steps one person is responsible for, across every deal (G15 follow-up).
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/checklists', R('crm-checklists.js')], ['/api/crm/attention', R('crm-attention.js')]]);
test.after(() => server.close());
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const OWN = require(path.join(env.SERVER, 'lib/crm-checklist-owners.js'));

const admin = env.addAdmin(db, 'cfboss', 'admin'), sales = env.addAdmin(db, 'cfrep', 'sales'), sales2 = env.addAdmin(db, 'cfrep2', 'sales'), viewer = env.addAdmin(db, 'cfviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const ymd = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const TODAY = ymd(0);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Steps District', 'district')").run().lastInsertRowid);
const deal = (owner, state = 'open') => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state, stage_entered_at) VALUES (?, 'Steps deal', 1, ?, ?, '2026-11-01 10:00:00')").run(acct, owner, state).lastInsertRowid);
const step = (d, label, f = {}) => Number(db.prepare('INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, status, due_on, sort_order, owner_admin_id) VALUES (?, ?, ?, ?, 10, ?)').run(d, label, f.status || 'open', f.due || null, f.owner || null).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_opportunity_checklist_items; DELETE FROM crm_opportunities; DELETE FROM school_audit_log');
const mineOf = (who, qs = '') => call('GET', `/api/crm/checklists/mine?today=${TODAY}${qs}`, undefined, who);
const labels = (r) => r.json.steps.map(s => s.label);

test('MY STEPS: a step that names me, and a blank step on a deal I own, are mine; a step named for someone else on my deal is theirs, not mine', async () => {
  reset();
  const myDeal = deal(sales), theirDeal = deal(sales2), nobodyDeal = deal(null);
  step(myDeal, 'Blank on my deal', { due: ymd(2) });
  step(myDeal, 'Named for rep2 on my deal', { due: ymd(2), owner: sales2 });
  step(theirDeal, 'Named for me on their deal', { due: ymd(1), owner: sales });
  step(theirDeal, 'Blank on their deal', { due: ymd(1) });
  step(nobodyDeal, 'Blank on an unowned deal', { due: ymd(1) });
  const r = await mineOf(sales);
  assert.equal(r.status, 200);
  assert.deepEqual(labels(r), ['Named for me on their deal', 'Blank on my deal'], 'soonest due first');
  assert.deepEqual(r.json.steps.map(s => s.namedOwner), [true, false]);
  assert.deepEqual(labels(await mineOf(sales2)), ['Blank on their deal', 'Named for rep2 on my deal']);
  assert.deepEqual(labels(await mineOf(admin)), [], 'a step on an unowned deal with no named owner is nobody\'s');
});

test('MY STEPS: done and not-needed steps, and steps on a closed deal, are not listed; steps with no due date come last', async () => {
  reset();
  const d = deal(sales), closed = deal(sales, 'won');
  step(d, 'Open late', { due: ymd(-2) }); step(d, 'Open no date'); step(d, 'Done', { status: 'done', due: ymd(-1) }); step(d, 'Not needed', { status: 'not_needed' });
  step(closed, 'On a closed deal', { due: ymd(-5) });
  const r = await mineOf(sales);
  assert.deepEqual(labels(r), ['Open late', 'Open no date']);
  assert.equal(r.json.steps[0].overdue, true); assert.equal(r.json.steps[1].overdue, false);
  assert.deepEqual(r.json.summary, { open: 2, overdue: 1, dueToday: 0 });
});

test('MY STEPS: the views overdue, today and week narrow the list; the summary always describes everything that is mine; paging counts the filtered list', async () => {
  reset();
  const d = deal(sales);
  step(d, 'Late', { due: ymd(-1) }); step(d, 'Today', { due: TODAY }); step(d, 'In 5 days', { due: ymd(5) }); step(d, 'In 30 days', { due: ymd(30) }); step(d, 'No date');
  assert.deepEqual(labels(await mineOf(sales, '&view=overdue')), ['Late']);
  assert.deepEqual(labels(await mineOf(sales, '&view=today')), ['Late', 'Today'], 'due today or earlier, like the Tasks page');
  assert.deepEqual(labels(await mineOf(sales, '&view=week')), ['Late', 'Today', 'In 5 days']);
  const p = await mineOf(sales, '&pageSize=2&page=2');
  assert.equal(p.json.total, 5); assert.deepEqual(labels(p), ['In 5 days', 'In 30 days']);
  assert.deepEqual((await mineOf(sales, '&view=week')).json.summary, { open: 5, overdue: 1, dueToday: 1 });
  assert.equal((await mineOf(sales, '&view=nonsense')).json.total, 5, 'an unknown view is ignored, not an error');
});

test('MY STEPS: who may tick - the named owner (never Read-only) or whoever may edit the deal; and ticking uses the deal\'s own route', async () => {
  reset();
  const theirDeal = deal(sales2), myDeal = deal(sales);
  const named = step(theirDeal, 'Named for me', { due: ymd(1), owner: sales }), blank = step(myDeal, 'Blank on mine', { due: ymd(2) });
  const r = await mineOf(sales);
  assert.deepEqual(r.json.steps.map(s => [s.label, s.canComplete]), [['Named for me', true], ['Blank on mine', true]]);
  assert.equal((await call('PUT', `/api/crm/checklists/${named}`, { status: 'done' }, sales)).status, 200, 'the page ticks through the existing route');
  assert.deepEqual(labels(await mineOf(sales)), ['Blank on mine'], 'a ticked step leaves the list');
  // A Read-only login that is named on a step sees it but cannot tick it, and the route agrees.
  db.prepare('UPDATE crm_opportunity_checklist_items SET owner_admin_id = ? WHERE id = ?').run(viewer, blank);
  const v = await mineOf(viewer);
  assert.deepEqual(v.json.steps.map(s => [s.label, s.canComplete]), [['Blank on mine', false]]);
  assert.equal((await call('PUT', `/api/crm/checklists/${blank}`, { status: 'done' }, viewer)).status, 403);
  // A CRM Admin who owns the deal may tick.
  const adminDeal = deal(admin); step(adminDeal, 'Admin step', { due: ymd(3) });
  assert.equal((await mineOf(admin)).json.steps[0].canComplete, true);
});

test('MY STEPS: a Read-only login with nothing of its own gets an empty list, not an error; signed out is 401; the Hub off is 404', async () => {
  reset(); step(deal(sales), 'Someone else\'s');
  const v = await mineOf(viewer);
  assert.equal(v.status, 200); assert.deepEqual(v.json.steps, []); assert.deepEqual(v.json.summary, { open: 0, overdue: 0, dueToday: 0 });
  assert.equal((await call('GET', '/api/crm/checklists/mine', undefined, null)).status, 401);
  env.enable(db, false);
  try { assert.equal((await mineOf(sales)).status, 404); } finally { env.enable(db, true); }
});

test('SAME RULE AS NEEDS ATTENTION: the person an overdue step is raised for is the person whose list holds it', async () => {
  reset();
  const myDeal = deal(sales), theirDeal = deal(sales2);
  const a = step(myDeal, 'Mine by deal', { due: ymd(-3) }), b = step(myDeal, 'Named rep2', { due: ymd(-3), owner: sales2 }), c = step(theirDeal, 'Named rep1', { due: ymd(-3), owner: sales });
  const items = (await A.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === 'checklist_overdue');
  const owners = Object.fromEntries(items.map(i => [i.subjectId, i.ownerAdminId]));
  assert.deepEqual(owners, { [a]: sales, [b]: sales2, [c]: sales });
  for (const [who, ids] of [[sales, [a, c]], [sales2, [b]]]) assert.deepEqual((await mineOf(who)).json.steps.map(s => s.id).sort(), ids.sort());
});

test('BEFORE THE ALTER SCRIPT: with no owner column on the steps, every step belongs to its deal\'s owner and the list still works', async () => {
  reset();
  const d = deal(sales); step(d, 'Plain step', { due: ymd(1) });
  db.exec('ALTER TABLE crm_opportunity_checklist_items DROP COLUMN owner_admin_id');
  try {
    const r = await mineOf(sales);
    assert.equal(r.status, 200); assert.deepEqual(labels(r), ['Plain step']); assert.equal(r.json.steps[0].namedOwner, false);
    assert.deepEqual(labels(await mineOf(sales2)), []);
  } finally { db.exec('ALTER TABLE crm_opportunity_checklist_items ADD COLUMN owner_admin_id INTEGER'); }
});

test('FILES AND PAGE: the Tasks page has the view, escapes what it shows, the owner rule has one home, and the code parses', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const page = read('../admin-crm-tasks.html');
  assert.match(page, /\['steps', 'My checklist steps'\]/); assert.match(page, /\/api\/crm\/checklists\/mine/);
  for (const k of ['st.label', 'st.dealName', 'st.accountName', 'st.note']) assert.match(page, new RegExp(`esc\\(${k.replace('.', '\\.')}\\)`), k);
  assert.match(read('lib/crm-checklist-owners.js'), /COALESCE\(i\.owner_admin_id, o\.owner_admin_id\)/);
  assert.doesNotMatch(read('lib/crm-checklist-owners.js').replace(/\/\/.*$/gm, ''), /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|ALTER TABLE)\b/i, 'the list only reads');
  assert.ok(OWN.EFFECTIVE_OWNER_SQL.includes('COALESCE'));
  for (const f of ['lib/crm-checklist-owners.js', 'routes/crm-checklists.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  for (const s of scripts) assert.doesNotThrow(() => new (require('node:vm').Script)(s));
});
