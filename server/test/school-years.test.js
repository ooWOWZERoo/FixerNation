// The classroom Academic Year list starts at the current school year and runs through grade 12 for a child starting kindergarten
// now; it moves forward each August; a year already saved on a classroom is never lost. Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..', '..');

const win = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'school-years.js'), 'utf8'), { window: win, Date, String, Array });
const Y = win.FnSchoolYears;
const D = (iso) => new Date(iso + 'T12:00:00');

test('in November 2026 the list is 2026-2027 through 2038-2039 (13 years: kindergarten to grade 12)', () => {
  const list = Y.list(D('2026-11-06'));
  assert.equal(list.length, 13);
  assert.equal(list[0], '2026–2027');
  assert.equal(list[12], '2038–2039');
  assert.ok(!list.includes('2024–2025') && !list.includes('2025–2026'));
});

test('the school year changes on August 1 and not before', () => {
  assert.equal(Y.list(D('2027-07-31'))[0], '2026–2027');
  assert.equal(Y.list(D('2027-08-01'))[0], '2027–2028');
  assert.equal(Y.list(D('2027-01-15'))[0], '2026–2027');
});

test('fill() keeps a saved year that is no longer in the list, so editing a classroom never blanks it', () => {
  const sel = { innerHTML: '', value: '' };
  Y.fill(sel, '2025–2026');
  assert.match(sel.innerHTML, /<option>2025–2026<\/option>/);
  assert.equal(sel.value, '2025–2026');
  Y.fill(sel, '2025-2026');
  assert.match(sel.innerHTML, /<option>2025-2026<\/option>/);
  Y.fill(sel);
  assert.equal(sel.value, '');
  assert.ok(!/2025/.test(sel.innerHTML));
});

test('both classroom pages use the shared list, with no fixed year left in them', () => {
  for (const f of ['teacher-classrooms.html', 'teacher-classroom.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(html, /school-years\.js\?v=1/, `${f} loads school-years.js`);
    assert.match(html, /FnSchoolYears\.fill\(/, `${f} fills the year list`);
    assert.ok(!/<option>20\d\d–20\d\d<\/option>/.test(html), `${f} still has a fixed year option`);
  }
});
