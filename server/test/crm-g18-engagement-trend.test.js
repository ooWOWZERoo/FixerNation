// Sales CRM punch list G18 (FR-TRIAL-01): a trend (latest saved month against the one before) and four plain-fact usage alerts on the engagement card. Unknown never raises an alert.
// The pure rules are tested directly; the route is tested through the real engagement route in crm-phase6-engagement.test.js (its key whitelist). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const E = require(path.join(env.SERVER, 'lib/crm-engagement.js'));
const known = (v) => ({ value: v, unknownReason: null, kind: null });
const unk = (r = 'No record.') => ({ value: null, unknownReason: r, kind: 'unknown' });
const small = () => ({ value: null, unknownReason: 'Fewer than 10 students.', kind: 'small' });
// A saved month as the card builds it.
const month = (key, label, o = {}) => ({ month: key, label, schoolsReporting: o.schools === undefined ? 1 : o.schools, schoolsInScope: 1,
  teachersLicensed: o.licensed === undefined ? known(20) : o.licensed, teachersTeaching: o.teaching === undefined ? known(8) : o.teaching, classroomsActive: o.classes === undefined ? known(5) : o.classes,
  activities: o.acts === undefined ? known(40) : o.acts, studentsActive: o.students === undefined ? known(60) : o.students });
const lic = (o = {}) => ({ items: [{ purchaseId: o.id || 7, kind: o.kind || 'paid', licenseStatus: o.status || 'active', daysLeft: o.days === undefined ? 30 : o.days, seatsBought: o.bought === undefined ? known(50) : o.bought, seatsRegistered: o.reg === undefined ? known(10) : o.reg }] });
const TODAY = '2026-11-17';

test('TREND: the latest month against the one before, per measure: up, down, no change; an unknown or hidden number is not a change; one month says there is nothing to compare', () => {
  const t = E.trendOf([month('2026-10', 'October 2026', { teaching: known(8), classes: known(5), acts: known(40), students: known(60) }), month('2026-09', 'September 2026', { teaching: known(6), classes: known(5), acts: known(55), students: small() })]);
  assert.equal(t.comparedWith, 'September 2026'); assert.equal(t.note, null);
  assert.deepEqual(t.metrics.teachersTeaching, { change: 2, direction: 'up', unknownReason: null });
  assert.deepEqual(t.metrics.classroomsActive, { change: 0, direction: 'same', unknownReason: null });
  assert.deepEqual(t.metrics.activities, { change: -15, direction: 'down', unknownReason: null });
  assert.equal(t.metrics.studentsActive.change, null); assert.equal(t.metrics.studentsActive.direction, null); assert.match(t.metrics.studentsActive.unknownReason, /Fewer than 10/, 'a hidden small number is never turned into a change');
  const one = E.trendOf([month('2026-10', 'October 2026')]); assert.equal(one.metrics, null); assert.match(one.note, /nothing to compare/);
  assert.equal(E.trendOf([]).metrics, null);
});

test('TREND IS FAIR: a different number of schools reporting means no comparison; a gap of more than one month is said out loud', () => {
  const unfair = E.trendOf([month('2026-10', 'October 2026', { schools: 3 }), month('2026-09', 'September 2026', { schools: 2 })]);
  assert.equal(unfair.metrics, null); assert.match(unfair.note, /3 schools reported in October 2026 and 2 in September 2026/);
  const gap = E.trendOf([month('2026-10', 'October 2026'), month('2026-07', 'July 2026')]);
  assert.ok(gap.metrics); assert.match(gap.note, /3 months before October 2026/);
  assert.equal(E.trendOf([month('2026-10', 'October 2026'), month('2026-09', 'September 2026')]).note, null);
});

test('ALERT 1, no activity: the latest saved month shows zero activities while teachers are licensed; a real zero only, a stale month, no licensed teachers or an unknown never alerts', () => {
  const alerts = (months, licenses = { items: [] }, today = TODAY) => E.alertsFor(licenses, { months }, today);
  const a = alerts([month('2026-10', 'October 2026', { acts: known(0), licensed: known(20) })]);
  assert.equal(a.length, 1); assert.equal(a[0].key, 'no_activity'); assert.match(a[0].text, /No activities were finished in October 2026, although 20 teachers are licensed/);
  assert.equal(alerts([month('2026-10', 'October 2026', { acts: known(0), licensed: known(1) })])[0].text.includes('1 teacher is licensed'), true);
  assert.deepEqual(alerts([month('2026-10', 'October 2026', { acts: unk() })]), [], 'unknown is not zero');
  assert.deepEqual(alerts([month('2026-10', 'October 2026', { acts: known(0), licensed: known(0) })]), [], 'nobody licensed');
  assert.deepEqual(alerts([month('2026-05', 'May 2026', { acts: known(0) })]), [], 'too old to judge now from');
  assert.deepEqual(alerts([]), []);
});

test('ALERT 2, teachers teaching fell: half or more from at least 4, comparing like with like; smaller drops, small starting numbers, unknowns and unfair comparisons do not alert', () => {
  const fell = (from, to, o = {}) => E.alertsFor({ items: [] }, { months: [month('2026-10', 'October 2026', { teaching: to, ...o.latest }), month('2026-09', 'September 2026', { teaching: from, ...o.prev })] }, TODAY).filter(x => x.key === 'teaching_fell');
  assert.match(fell(known(10), known(5))[0].text, /fell from 10 in September 2026 to 5 in October 2026, a drop of half or more/);
  assert.equal(fell(known(10), known(0)).length, 1);
  assert.equal(fell(known(10), known(6)).length, 0, 'a smaller drop'); assert.equal(fell(known(3), known(0)).length, 0, 'it started below 4');
  assert.equal(fell(known(10), unk()).length, 0); assert.equal(fell(unk(), known(1)).length, 0);
  assert.equal(fell(known(10), known(2), { latest: { schools: 2 } }).length, 0, 'a different number of schools reported');
});

test('ALERT 3, a paid license ends soon and fewer than half its seats are signed up: within 60 days, seat counts known, not cancelled; otherwise nothing', () => {
  const a = (o) => E.alertsFor(lic(o), { months: [] }, TODAY).filter(x => x.key === 'license_ending_low_use');
  assert.match(a({ days: 20, bought: known(50), reg: known(10) })[0].text, /Purchase #7 ends in 20 days and only 10 of its 50 seats are signed up/);
  assert.equal(a({ days: 1 })[0].text.includes('ends in 1 day and'), true);
  assert.equal(a({ days: 61 }).length, 0); assert.equal(a({ days: -3 }).length, 0, 'already ended'); assert.equal(a({ days: 20, reg: known(25) }).length, 0, 'half is not fewer than half');
  assert.equal(a({ days: 20, reg: unk() }).length, 0, 'no seat records is unknown'); assert.equal(a({ days: 20, bought: unk() }).length, 0); assert.equal(a({ days: 20, status: 'cancelled' }).length, 0);
  assert.equal(a({ days: 20, kind: 'trial' }).length, 0, 'a trial is alert 4, not this one');
});

test('ALERT 4, a trial is nearly over and nothing was finished: 7 days or fewer and a real zero in the latest saved month; a busy trial, an unknown and a trial with time left do not alert', () => {
  const t = (o, months) => E.alertsFor(lic({ kind: 'trial', ...o }), { months: months || [month('2026-10', 'October 2026', { acts: known(0) })] }, TODAY).filter(x => x.key === 'trial_ending_quiet');
  assert.match(t({ days: 3, id: 9 })[0].text, /Trial #9 has 3 days left and no activities were finished in October 2026/);
  assert.equal(t({ days: 7 }).length, 1); assert.equal(t({ days: 8 }).length, 0); assert.equal(t({ days: -1 }).length, 0);
  assert.equal(t({ days: 3 }, [month('2026-10', 'October 2026', { acts: known(12) })]).length, 0, 'it is being used'); assert.equal(t({ days: 3 }, [month('2026-10', 'October 2026', { acts: unk() })]).length, 0);
  assert.equal(t({ days: 3 }, []).length, 0, 'no snapshot yet: unknown, so no alert');
});

test('NO WORDS OF SCORING, NO WRITES, NO PEOPLE: alert texts hold numbers and purchase ids only; the library never writes, mails or touches Needs Attention; the card shows the alerts and the trend escaped', () => {
  const all = E.alertsFor(lic({ days: 20, kind: 'paid' }), { months: [month('2026-10', 'October 2026', { acts: known(0), teaching: known(1) }), month('2026-09', 'September 2026', { teaching: known(8) })] }, TODAY);
  assert.ok(all.length >= 2); for (const a of all) { assert.ok(a.key && a.text); assert.doesNotMatch(a.text, /@|score|risk|health|hot|warm|cold|churn/i); }
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const code = read('lib/crm-engagement.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDELETE FROM\b|mailer|crm_attention|sendSalesAlert/i);
  const panels = read('../crm-panels.js');
  for (const k of ['Worth a look', 'trendHtml', 'Compared with']) assert.ok(panels.includes(k), k);
  assert.match(panels, /esc\(a\.text\)/); assert.match(panels, /esc\(t\.comparedWith\)/); assert.match(panels, /esc\(t\.note\)/);
  require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, 'lib/crm-engagement.js')]);
});
