// Customer Hub follow-up to G17: the "not a duplicate" memory on the account duplicate review. Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/accounts', R('crm-accounts.js')]]);
test.after(() => server.close());
const ND = require(path.join(env.SERVER, 'lib/crm-account-not-duplicates.js'));

const admin = env.addAdmin(db, 'ndboss', 'admin'), sales = env.addAdmin(db, 'ndrep', 'sales'), viewer = env.addAdmin(db, 'ndviewer', 'readonly');
env.enable(db, true);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const acct = (name, site, type = 'school') => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, website_domain) VALUES (?, ?, ?)').run(name, type, site).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_account_not_duplicates; DELETE FROM crm_accounts; DELETE FROM school_audit_log');
const groups = async (who = sales) => (await call('GET', '/api/crm/accounts/review/duplicates', undefined, who)).json;
const mark = (ids, who = sales) => call('POST', '/api/crm/accounts/review/not-duplicates', { accountIds: ids }, who);

test('MARKING A PAIR: it leaves the duplicate list, stays out of the account page notice, and undo brings it back', async () => {
  reset();
  const a = acct('Maple Elementary', 'https://maple.example.org'), b = acct('Maple Elem School', 'http://www.maple.example.org/'), c = acct('Oak Elementary', 'oak.example.org'), d = acct('Oak Elem', 'oak.example.org');
  let g = await groups(); assert.equal(g.total, 2); assert.equal(g.memoryAvailable, true); assert.equal(g.markedCount, 0);
  const r = await mark([b, a]); // order does not matter
  assert.equal(r.status, 201); assert.equal(r.json.marked, 1);
  assert.deepEqual(all('SELECT account_a_id, account_b_id FROM crm_account_not_duplicates').map(r => [r.account_a_id, r.account_b_id]), [[a, b]], 'stored lower id first');
  g = await groups(); assert.equal(g.total, 1); assert.deepEqual(g.groups[0].accounts.map(x => x.id).sort(), [c, d].sort());
  assert.equal((await call('GET', `/api/crm/accounts/${a}`, undefined, sales)).json.possibleDuplicates.length, 0, 'the account page does not name the separate account');
  assert.equal((await call('GET', `/api/crm/accounts/${c}`, undefined, sales)).json.possibleDuplicates.length, 1, 'an unmarked pair still shows');
  const list = await call('GET', '/api/crm/accounts/review/not-duplicates', undefined, viewer);
  assert.equal(list.status, 200); assert.equal(list.json.total, 1); assert.deepEqual([list.json.pairs[0].a.name, list.json.pairs[0].b.name], ['Maple Elementary', 'Maple Elem School']); assert.equal(list.json.pairs[0].decidedBy, 'ndrep');
  assert.equal((await call('DELETE', `/api/crm/accounts/review/not-duplicates/${list.json.pairs[0].id}`, {}, sales)).status, 200);
  assert.equal((await groups()).total, 2, 'undo brings the pair back');
  assert.equal((await call('GET', `/api/crm/accounts/${a}`, undefined, sales)).json.possibleDuplicates.length, 1);
});

test('A GROUP OF THREE: one marked pair leaves the rest suspected; every pair marked removes the group; "none of these" marks every pair', async () => {
  reset();
  const a = acct('A School', 'same.example.org'), b = acct('B School', 'same.example.org'), c = acct('C School', 'same.example.org');
  assert.equal((await groups()).groups[0].accounts.length, 3);
  await mark([a, b]);
  let g = await groups(); assert.equal(g.total, 1); assert.equal(g.groups[0].accounts.length, 3, 'A-C and B-C are still suspected, so all three stay');
  await mark([a, c]);
  g = await groups(); assert.equal(g.total, 1); assert.deepEqual(g.groups[0].accounts.map(x => x.id).sort(), [b, c].sort(), 'only B and C are left suspected');
  await mark([b, c]);
  assert.equal((await groups()).total, 0);
  db.exec('DELETE FROM crm_account_not_duplicates');
  const all3 = await mark([a, b, c]);
  assert.equal(all3.json.marked, 3, 'three accounts: three pairs'); assert.equal((await groups()).total, 0);
});

test('MARKING IS SAFE TO REPEAT: a second mark changes nothing and is not an error; bad input is refused; nothing about the accounts changes', async () => {
  reset();
  const a = acct('X School', 'x.example.org'), b = acct('Y School', 'x.example.org');
  const before = JSON.stringify(all('SELECT * FROM crm_accounts ORDER BY id'));
  assert.equal((await mark([a, b])).status, 201);
  const again = await mark([a, b]); assert.equal(again.status, 200); assert.equal(again.json.marked, 0); assert.equal(again.json.alreadyMarked, 1);
  assert.equal(all('SELECT * FROM crm_account_not_duplicates').length, 1);
  for (const bad of [[a], [a, a], 'x', null, [a, 'abc'], [a, 999999]]) assert.ok([400, 404].includes((await mark(bad)).status), JSON.stringify(bad));
  assert.equal((await mark(Array.from({ length: 21 }, (_, i) => i + 1))).status, 400, 'at most 20 at a time');
  assert.equal(JSON.stringify(all('SELECT * FROM crm_accounts ORDER BY id')), before, 'no account was touched');
  assert.equal((await call('DELETE', '/api/crm/accounts/review/not-duplicates/999999', {}, sales)).status, 404);
  assert.equal((await call('DELETE', '/api/crm/accounts/review/not-duplicates/abc', {}, sales)).status, 404);
});

test('WHO MAY: CRM Admin and Sales mark and undo; Read-only looks only; signed out is 401; the Hub off is 404', async () => {
  reset();
  const a = acct('P School', 'p.example.org'), b = acct('Q School', 'p.example.org');
  assert.equal((await mark([a, b], viewer)).status, 403);
  assert.equal((await call('GET', '/api/crm/accounts/review/not-duplicates', undefined, viewer)).status, 200);
  assert.equal((await mark([a, b], null)).status, 401);
  assert.equal((await mark([a, b], admin)).status, 201);
  const id = all('SELECT id FROM crm_account_not_duplicates')[0].id;
  assert.equal((await call('DELETE', `/api/crm/accounts/review/not-duplicates/${id}`, {}, viewer)).status, 403);
  assert.equal((await call('DELETE', `/api/crm/accounts/review/not-duplicates/${id}`, {}, null)).status, 401);
  assert.equal((await call('DELETE', `/api/crm/accounts/review/not-duplicates/${id}`, {}, sales)).status, 200);
  env.enable(db, false);
  try { assert.equal((await mark([a, b], admin)).status, 404); assert.equal((await call('GET', '/api/crm/accounts/review/duplicates', undefined, admin)).status, 404); } finally { env.enable(db, true); }
});

test('AN ARCHIVED (MERGED) ACCOUNT leaves the review by itself; its remembered pair is harmless', async () => {
  reset();
  const a = acct('M School', 'm.example.org'), b = acct('N School', 'm.example.org'), c = acct('O School', 'm.example.org');
  await mark([a, b]);
  db.prepare("UPDATE crm_accounts SET archived_at = '2026-11-01 10:00:00' WHERE id = ?").run(c);
  assert.equal((await groups()).total, 0, 'C is archived and A-B are marked');
  db.prepare('UPDATE crm_accounts SET archived_at = NULL WHERE id = ?').run(c);
  assert.equal((await groups()).total, 1);
});

test('AUDIT: marking and undoing each write one row with the pair of ids and no names', async () => {
  reset();
  const a = acct('Audit One', 'au.example.org'), b = acct('Audit Two', 'au.example.org');
  await mark([a, b], admin);
  const id = all('SELECT id FROM crm_account_not_duplicates')[0].id;
  await call('DELETE', `/api/crm/accounts/review/not-duplicates/${id}`, {}, admin);
  const rows = all("SELECT * FROM school_audit_log WHERE action LIKE 'crm_account_not_duplicate%' ORDER BY id");
  assert.deepEqual(rows.map(r => r.action), ['crm_account_not_duplicate_marked', 'crm_account_not_duplicate_undone']);
  for (const r of rows) { assert.equal(r.entity_type, 'crm_account'); assert.equal(r.actor_type, 'admin_user'); assert.doesNotMatch(JSON.stringify(r), /Audit One|Audit Two/); }
  assert.match(JSON.stringify(rows[0]), new RegExp(`\\[${a},${b}\\]`));
});

test('BEFORE THE ALTER SCRIPT: with no table the list and the account page still work, nothing is remembered, and marking says it is not available yet', async () => {
  reset();
  const a = acct('Old One', 'old.example.org'), b = acct('Old Two', 'old.example.org');
  db.exec('DROP TABLE crm_account_not_duplicates');
  try {
    const g = await groups(); assert.equal(g.total, 1); assert.equal(g.memoryAvailable, false);
    assert.equal((await call('GET', `/api/crm/accounts/${a}`, undefined, sales)).json.possibleDuplicates.length, 1);
    const m = await mark([a, b]); assert.equal(m.status, 503); assert.equal(m.json.code, 'not_available');
    assert.equal((await call('GET', '/api/crm/accounts/review/not-duplicates', undefined, sales)).json.available, false);
    assert.equal((await call('DELETE', '/api/crm/accounts/review/not-duplicates/1', {}, sales)).status, 503);
  } finally {
    db.exec('CREATE TABLE crm_account_not_duplicates (id INTEGER PRIMARY KEY AUTOINCREMENT, account_a_id INTEGER NOT NULL, account_b_id INTEGER NOT NULL, decided_by_admin_id INTEGER, decided_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (account_a_id, account_b_id))');
  }
});

test('THE FILTER ITSELF: pure and exact (components, order, nothing remembered returns the same groups)', () => {
  const g = [{ domain: 'd', accounts: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }];
  assert.equal(ND.applyMemory(g, new Set()), g);
  const out = ND.applyMemory(g, new Set(['1-2', '3-4']));
  assert.equal(out.length, 1, 'the four accounts are linked 1-3, 1-4, 2-3, 2-4: still one group'); assert.equal(out[0].accounts.length, 4);
  const split = ND.applyMemory(g, new Set(['1-3', '1-4', '2-3', '2-4']));
  assert.deepEqual(split.map(x => x.accounts.map(a => a.id)), [[1, 2], [3, 4]], 'two separate groups');
  assert.deepEqual(ND.keepSuspected(1, [{ id: 2 }, { id: 3 }], new Set(['1-2'])), [{ id: 3 }]);
});

test('FILES AND PAGES: schema, alter script and test DDL agree; the page escapes names and uses data- attributes; the rollups lib stays read only; the code parses', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  assert.match(read('db/schema.sql'), /CREATE TABLE IF NOT EXISTS crm_account_not_duplicates/); assert.match(read('scripts/alter-create-crm-not-duplicates.js'), /CREATE TABLE IF NOT EXISTS crm_account_not_duplicates/);
  assert.match(read('scripts/alter-create-crm-not-duplicates.js'), /information_schema\.TABLES/);
  // the table must come after crm_accounts in schema.sql, or a fresh install cannot create its foreign keys
  assert.ok(read('db/schema.sql').indexOf('CREATE TABLE IF NOT EXISTS crm_account_not_duplicates') > read('db/schema.sql').indexOf('CREATE TABLE IF NOT EXISTS crm_accounts'));
  const page = read('../admin-crm-accounts.html');
  assert.match(page, /data-sep="/); assert.match(page, /data-undo="/); assert.match(page, /esc\(p\.a\.name\)/); assert.match(page, /esc\(x\.name\) \+ ' and ' \+ esc\(y\.name\)/);
  assert.doesNotMatch(read('lib/crm-account-rollups.js').replace(/\/\/.*$/gm, ''), /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|ALTER TABLE)\b/i);
  for (const f of ['lib/crm-account-not-duplicates.js', 'routes/crm-accounts.js', 'scripts/alter-create-crm-not-duplicates.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  for (const s of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s));
});
