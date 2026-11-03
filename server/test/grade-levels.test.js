// lib/grade-levels.js: the one place that turns ES/MS/HS/HE (or full names) into the four stored names.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGradeLevels, summarize, toStored, fromStored } = require('../lib/grade-levels');

test('codes, full names and mixed case all resolve to the stored names, in a fixed order', () => {
  assert.deepEqual(parseGradeLevels(['hs', 'ES']), ['Elementary School', 'High School']);
  assert.deepEqual(parseGradeLevels(['Middle School', 'HE']), ['Middle School', 'Higher Education']);
});

test('strings split on ; , or | and duplicates collapse', () => {
  assert.deepEqual(parseGradeLevels('ES;MS'), ['Elementary School', 'Middle School']);
  assert.deepEqual(parseGradeLevels(' ms | MS , es '), ['Elementary School', 'Middle School']);
});

test('an empty list is refused', () => {
  for (const bad of [[], '', '  ;  ', null, undefined, 5]) {
    assert.throws(() => parseGradeLevels(bad), (e) => e.status === 400 && /at least one/.test(e.message));
  }
});

test('anything that is not one of the four levels is refused, naming the bad value', () => {
  assert.throws(() => parseGradeLevels('4th grade'), (e) => e.status === 400 && /4th grade/.test(e.message));
  assert.throws(() => parseGradeLevels(['ES', 'K12']), (e) => e.status === 400 && /K12/.test(e.message));
  assert.throws(() => parseGradeLevels([1]), (e) => e.status === 400);
});

test('summarize and the stored form round-trip', () => {
  const names = parseGradeLevels('MS;HS');
  assert.equal(summarize(names), 'MS, HS');
  assert.equal(toStored(names), 'Middle School,High School');
  assert.deepEqual(fromStored('Middle School,High School'), names);
  assert.deepEqual(fromStored(null), []);
  assert.deepEqual(fromStored('5th grade'), []);
});
