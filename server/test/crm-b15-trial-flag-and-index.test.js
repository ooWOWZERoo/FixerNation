// Punch list B15: the Customer rule reads a trial flag frozen on the purchase (so editing a product later cannot move a Customer), the alter script is additive and
// re-runnable, and the composite quote index is part of it. Real SQL on node:sqlite from test/helpers/crm-env.js; a fake database stands in for MariaDB in the alter test.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));
const alter = require(path.join(env.SERVER, 'scripts/alter-crm-trial-flag-and-quote-index.js'));

const product = (trial) => Number(db.prepare('INSERT INTO license_products (name, is_trial) VALUES (?, ?)').run('P', trial ? 1 : 0).lastInsertRowid);
const flag = (id) => db.prepare('SELECT is_trial_flag f FROM purchases WHERE id = ?').get(id).f;

test('B15: a paid purchase stays a Customer purchase after its product is later marked a trial, and a trial stays a trial after the product is edited the other way', async () => {
  const paidProduct = product(false), trialProduct = product(true);
  const buyer = env.addContact(db, 'buyer@school.test', 'Buyer');
  const paid = env.addPurchase(db, buyer, { paymentStatus: 'paid', amountCents: 50000, productId: paidProduct });
  const trial = env.addPurchase(db, buyer, { paymentStatus: 'paid', amountCents: 50000, productId: trialProduct });
  await cls.reconcileContact(pool, buyer);
  assert.equal(flag(paid), 0, 'the CRM froze the flag from the product as it was');
  assert.equal(flag(trial), 1);
  assert.equal(env.classOf(db, buyer), 'customer', 'the paid, non-trial purchase makes a Customer');

  db.prepare('UPDATE license_products SET is_trial = 1 WHERE id = ?').run(paidProduct); // an admin edits the product later
  db.prepare('UPDATE license_products SET is_trial = 0 WHERE id = ?').run(trialProduct);
  const qualifying = db.prepare(`SELECT p.id FROM purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id WHERE p.contact_id = ? AND ${cls.QUALIFYING_SQL}`).all(buyer).map(r => r.id);
  assert.deepEqual(qualifying, [paid], 'the old purchases keep the answer they had');
  const again = await cls.reconcileContact(pool, buyer);
  assert.equal(again.needsReview, undefined, 'no "needs review" flag appears just because the product was edited');
  assert.equal(env.classOf(db, buyer), 'customer');
});

test('B15: the JS rule agrees with the SQL rule on a frozen flag, and a purchase not frozen yet falls back to the live product', () => {
  assert.equal(cls.isTrialLike({ is_trial_flag: 0, is_trial: 1 }), false);
  assert.equal(cls.isTrialLike({ is_trial_flag: 1, is_trial: 0 }), true);
  assert.equal(cls.isTrialLike({ is_trial_flag: null, is_trial: 1 }), true);
  assert.equal(cls.isTrialLike({ is_trial_flag: null, is_trial: 0, trial_lesson_limit: 3 }), true, 'the trial fields on the purchase still count');
});

test('B15: a dry run freezes nothing', async () => {
  const p = product(true);
  const c = env.addContact(db, 'dry@school.test', 'Dry');
  const id = env.addPurchase(db, c, { paymentStatus: 'paid', amountCents: 100, productId: p });
  await cls.reconcileContact(pool, c, { dryRun: true });
  assert.equal(flag(id), null);
});

// ---- the alter script, against a fake MariaDB -----------------------------------------------------------------------------------------
function fakeDb(state, { failOn = null } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      if (/information_schema\.COLUMNS/.test(sql)) return [state.columns.has(`${params[1]}.${params[2]}`) ? [{ 1: 1 }] : []];
      if (/information_schema\.STATISTICS/.test(sql)) return [state.indexes.has(`${params[1]}.${params[2]}`) ? [{ 1: 1 }] : []];
      log.push(sql);
      if (/^UPDATE/.test(sql)) return [{ affectedRows: state.unfrozen }];
      if (failOn && failOn.test(sql)) { failOn = null; throw Object.assign(new Error('simulated failure'), { code: 'ER_LOCK_DEADLOCK' }); }
      let m;
      if ((m = /ADD COLUMN (\w+)/.exec(sql))) state.columns.add(`purchases.${m[1]}`);
      if ((m = /ADD INDEX (\w+)/.exec(sql))) state.indexes.add(`quote_requests.${m[1]}`);
      return [{}];
    },
  };
}
const quiet = () => {};

test('B15: the alter script adds the column and the composite index once, fills the flag, and a second run changes nothing', async () => {
  const state = { columns: new Set(), indexes: new Set(), unfrozen: 7 };
  const first = await alter.ensure(fakeDb(state), 'db', quiet);
  assert.deepEqual(first.added.sort(), ['idx_quote_requests_opp_revision', 'is_trial_flag']);
  assert.equal(first.backfilled, 7);
  state.unfrozen = 0;
  const db2 = fakeDb(state);
  const second = await alter.ensure(db2, 'db', quiet);
  assert.deepEqual(second.added, []);
  assert.ok(!db2.log.some(s => /^ALTER/.test(s)), 'nothing is altered on a re-run');
});

test('B15: if the index step fails after the column was added, the next run finishes it', async () => {
  const state = { columns: new Set(), indexes: new Set(), unfrozen: 0 };
  await assert.rejects(alter.ensure(fakeDb(state, { failOn: /ADD INDEX/ }), 'db', quiet), /simulated failure/);
  assert.ok(state.columns.has('purchases.is_trial_flag') && !state.indexes.has('quote_requests.idx_quote_requests_opp_revision'));
  await alter.ensure(fakeDb(state), 'db', quiet);
  assert.ok(state.indexes.has('quote_requests.idx_quote_requests_opp_revision'));
});

test('B15: every CRM alter script is additive only (nothing dropped, renamed or rewritten), so the previous code can run against the new schema', () => {
  const dir = path.join(env.SERVER, 'scripts');
  const files = fs.readdirSync(dir).filter(f => /^alter-.*crm.*\.js$/.test(f) || f === 'alter-crm-trial-flag-and-quote-index.js');
  assert.ok(files.length >= 5, 'the CRM alter scripts were found');
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|INDEX|KEY|FOREIGN|CONSTRAINT)\b/i, `${f} drops something`);
    // One reviewed exception: alter-widen-crm-task-text.js only ever makes two varchar columns longer (it reads the width first and never narrows), so the previous code still runs against it.
    if (f !== 'alter-widen-crm-task-text.js') assert.doesNotMatch(code, /\b(MODIFY|CHANGE)\s+COLUMN\b/i, `${f} rewrites a column`);
    assert.doesNotMatch(code, /\bRENAME\s+(TABLE|COLUMN|TO)\b/i, `${f} renames something`);
    assert.doesNotMatch(code, /\bTRUNCATE\b/i, `${f} truncates a table`);
    assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i, `${f} deletes rows`);
  }
});

test('B15: the schema file carries the new column and index for a fresh install', () => {
  const schema = fs.readFileSync(path.join(env.SERVER, 'db', 'schema.sql'), 'utf8');
  assert.match(schema, /is_trial_flag TINYINT\(1\) NULL/);
  assert.match(schema, /KEY idx_quote_requests_opp_revision \(opportunity_id, revision_number\)/);
});
