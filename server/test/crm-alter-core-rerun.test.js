// Punch list B5: scripts/alter-create-crm-core.js adds each column and then its index and foreign key as separate, separately checked steps, so a run that
// stopped between the column and the index is finished by the next run. A fake database stands in for MariaDB (answers the information_schema checks, records the ALTERs).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { COLUMNS, ensureColumns } = require(path.join(__dirname, '..', 'scripts', 'alter-create-crm-core.js'));

function fakeDb(state, { failOn = null } = {}) {
  const alters = [];
  return {
    alters,
    async query(sql, params = []) {
      if (/information_schema\.COLUMNS/.test(sql)) return [state.columns.has(`${params[1]}.${params[2]}`) ? [{ 1: 1 }] : []];
      if (/information_schema\.STATISTICS/.test(sql)) return [state.indexes.has(`${params[1]}.${params[2]}`) ? [{ 1: 1 }] : []];
      if (/information_schema\.TABLE_CONSTRAINTS/.test(sql)) return [state.fks.has(`${params[1]}.${params[2]}`) ? [{ 1: 1 }] : []];
      alters.push(sql);
      if (failOn && failOn.test(sql)) { failOn = null; throw Object.assign(new Error('simulated failure'), { code: 'ER_LOCK_DEADLOCK' }); }
      const table = /^ALTER TABLE (\w+)/.exec(sql)[1];
      let m;
      if ((m = /ADD COLUMN (\w+)/.exec(sql))) state.columns.add(`${table}.${m[1]}`);
      if ((m = /ADD INDEX (\w+)/.exec(sql))) state.indexes.add(`${table}.${m[1]}`);
      if ((m = /ADD CONSTRAINT (\w+)/.exec(sql))) state.fks.add(`${table}.${m[1]}`);
      return [{}];
    },
  };
}
const fresh = () => ({ columns: new Set(), indexes: new Set(), fks: new Set() });
const quiet = () => {};

test('B5: a clean run adds every column, index and foreign key once, and a second run changes nothing', async () => {
  const state = fresh();
  const first = fakeDb(state);
  await ensureColumns(first, 'db', quiet);
  const wantIndexes = COLUMNS.flatMap(([t, , , ex]) => ex.filter(e => e[0] === 'index').map(e => `${t}.${e[1]}`));
  const wantFks = COLUMNS.flatMap(([t, , , ex]) => ex.filter(e => e[0] === 'fk').map(e => `${t}.${e[1]}`));
  assert.equal(state.columns.size, COLUMNS.length);
  assert.deepEqual([...state.indexes].sort(), wantIndexes.sort());
  assert.deepEqual([...state.fks].sort(), wantFks.sort());
  assert.ok(wantFks.length >= 3, 'the foreign keys are really in the list');
  const second = fakeDb(state);
  await ensureColumns(second, 'db', quiet);
  assert.deepEqual(second.alters, [], 'nothing is altered on a re-run');
});

test('B5: if the index or foreign key failed after the column was added, the next run adds them (the old script skipped both)', async () => {
  const state = fresh();
  await assert.rejects(ensureColumns(fakeDb(state, { failOn: /ADD INDEX idx_contacts_assigned_admin/ }), 'db', quiet), /simulated failure/);
  assert.ok(state.columns.has('newsletter_contacts.assigned_admin_id'), 'the column was added before the failure');
  assert.ok(!state.indexes.has('newsletter_contacts.idx_contacts_assigned_admin') && !state.fks.has('newsletter_contacts.fk_contacts_assigned_admin'));
  const again = fakeDb(state);
  await ensureColumns(again, 'db', quiet);
  assert.ok(state.indexes.has('newsletter_contacts.idx_contacts_assigned_admin'), 'the index is added on the re-run');
  assert.ok(state.fks.has('newsletter_contacts.fk_contacts_assigned_admin'), 'and so is the foreign key');
  assert.ok(!again.alters.some(s => /ADD COLUMN (admin_users|crm_role|crm_classification|classification_updated_at|classification_locked|assigned_admin_id)\b/.test(s)), 'a column that already exists is not added again');
  assert.ok(again.alters.some(s => /ADD COLUMN last_contacted_at/.test(s)), 'the columns the first run never reached are added');
  assert.ok(state.indexes.has('quote_requests.idx_quote_requests_opportunity') && state.fks.has('quote_requests.fk_quote_requests_opportunity'), 'the columns after the failure were finished too');
});

test('B5: an index or foreign key that is already there (a duplicate-name error from the server) is skipped, not fatal', async () => {
  const state = fresh();
  const db = fakeDb(state);
  const realQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/ADD INDEX idx_contacts_crm_classification/.test(sql)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_KEYNAME' });
    return realQuery(sql, params);
  };
  await ensureColumns(db, 'db', quiet);
  assert.equal(state.columns.size, COLUMNS.length);
});
