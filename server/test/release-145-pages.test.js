// Release 145: the expired-trial card has no Convert button, and the Get help quick answers put the signed-in person's own role first.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('TRIAL CARD: an expired trial shows no Convert button and no credit line; an open one still does', () => {
  const html = read('my-license.html');
  const src = html.slice(html.indexOf('function renderTrialCard'), html.indexOf('\nfunction ', html.indexOf('function renderTrialCard') + 10));
  const ctx = { Date, Math, formatDate: (d) => String(d) };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const day = 86400000;
  const base = { id: 1, purchasedAt: new Date(Date.now() - 40 * day).toISOString(), conversionCreditCents: 7450, conversionCreditRedeemedAt: null };
  const expired = ctx.renderTrialCard({ ...base, trialExpirationDate: new Date(Date.now() - 2 * day).toISOString() });
  assert.doesNotMatch(expired, /Convert to Annual Access|openConvertModal|conversion credit/);
  assert.match(expired, /This trial has ended/); assert.match(expired, /href="licenses\.html"/);
  const open = ctx.renderTrialCard({ ...base, trialExpirationDate: new Date(Date.now() + 10 * day).toISOString() });
  assert.match(open, /Convert to Annual Access/); assert.match(open, /conversion credit/);
  const done = ctx.renderTrialCard({ ...base, conversionCreditRedeemedAt: '2026-10-01', trialExpirationDate: new Date(Date.now() - 2 * day).toISOString() });
  assert.doesNotMatch(done, /Convert to Annual Access/);
});

test('QUICK ANSWERS: signed-in order is own role, then everyone, then the rest; signed out keeps list order', () => {
  const html = read('support.html');
  assert.match(html, /myAudiences = c\.audiences \|\| \[\];\s*showAnswers\(\);/, 'the box is redrawn once the role is known');
  const start = html.indexOf('if (myAudiences.length) {');
  const body = html.slice(start, html.indexOf('found = found.slice(0, 4);'));
  const sorter = new Function('found', 'myAudiences', body + '\nreturn found;');
  const e = (id, forWho) => ({ id, for: forWho });
  const list = [e('admin1', ['school', 'district']), e('every1', ['everyone']), e('teach1', ['teacher']), e('admin2', ['school']), e('teach2', ['teacher', 'student'])];
  assert.deepEqual(sorter(list, ['teacher']).map((x) => x.id), ['teach1', 'teach2', 'every1', 'admin1', 'admin2']);
  assert.deepEqual(sorter(list, ['school', 'teacher']).map((x) => x.id), ['admin1', 'teach1', 'admin2', 'teach2', 'every1']);
});
