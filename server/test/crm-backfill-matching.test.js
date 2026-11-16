// Punch list B6: the CRM backfill does not merge two schools that share a name in different states, and no longer skips a real district just because "demo" appears in its name.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isDemoDistrict, matchAccountByName } = require(path.join(__dirname, '..', 'scripts', 'backfill-crm-core.js'));

test('B6: one account with that name matches; two in different states are told apart by the quote\'s state', () => {
  assert.deepEqual(matchAccountByName([{ id: 1, state: 'PA' }], 'PA'), { id: 1 });
  assert.deepEqual(matchAccountByName([{ id: 1, state: 'PA' }], ' pa '), { id: 1 }, 'case and spaces do not matter');
  assert.deepEqual(matchAccountByName([{ id: 1, state: 'PA' }, { id: 2, state: 'OH' }], 'OH'), { id: 2 });
  assert.deepEqual(matchAccountByName([{ id: 1, state: 'PA' }], 'OH'), { none: true }, 'a different state is a different school: a new account is made');
});

test('B6: when the state cannot settle it, nothing is guessed', () => {
  assert.deepEqual(matchAccountByName([{ id: 1, state: 'PA' }, { id: 2, state: 'OH' }], null), { several: true }, 'two schools of that name and no state on the quote');
  assert.deepEqual(matchAccountByName([{ id: 1, state: null }, { id: 2, state: 'OH' }], 'OH'), { several: true }, 'an account with no state could be either');
  assert.deepEqual(matchAccountByName([{ id: 1, state: null }], 'OH'), { id: 1 }, 'a single account with no recorded state is the best and only match');
  assert.deepEqual(matchAccountByName([], 'OH'), { none: true });
  assert.deepEqual(matchAccountByName(undefined, null), { none: true });
});

test('B6: a district is skipped as a demo only when it is one; a real name that contains "demo" is kept', () => {
  assert.equal(isDemoDistrict('FNE Demo District'), true);
  assert.equal(isDemoDistrict('FNE Demo District 07'), true);
  assert.equal(isDemoDistrict('Demopolis City Schools'), false);
  assert.equal(isDemoDistrict('Academy of Demonstration Arts'), false);
  assert.equal(isDemoDistrict(''), false);
});
