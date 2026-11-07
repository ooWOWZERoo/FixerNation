// Release 147: three public pages that disagreed with what the system does now say the same thing as the rest.
// Parents see lesson completion only; reflections are for the assigning teacher only; parents join by a teacher's invitation.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('for-parents.html does not promise quiz scores or skill growth', () => {
  const s = read('for-parents.html');
  assert.ok(!/quiz scores/i.test(s));
  assert.ok(!/skill growth/i.test(s));
  assert.match(s, /started and finished/);
});

test('for-students.html says reflections are for the assigning teacher only', () => {
  const s = read('for-students.html');
  assert.ok(!/teacher and school administrator/i.test(s));
  assert.match(s, /Reflections are visible only to the assigning teacher\./);
});

test('education-portal.html tells parents to wait for an invitation, not ask for a code', () => {
  const s = read('education-portal.html');
  assert.ok(!/parent code/i.test(s));
  assert.match(s, /sends an invitation/);
});

test('for-schools.html takes its prices from the admin price list, not from its own text', () => {
  const s = read('for-schools.html');
  assert.ok(!/Contact us for pricing/i.test(s));
  assert.match(s, /\/api\/license-products/);
  for (const tier of ['individual', 'school', 'district']) assert.match(s, new RegExp(`data-tier="${tier}"`));
});

test('education-schools.html no longer carries a hard-coded $149 or $0', () => {
  const s = read('education-schools.html');
  assert.ok(!/\$<span id="regSoloPrice">149/.test(s));
  assert.ok(!/id="regPrice">\$0</.test(s));
});
