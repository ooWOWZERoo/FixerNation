// Customer Hub follow-up to G18: the numbers behind the engagement card's "Worth a look" alerts are settings a CRM Admin can change. Same rules as the Needs Attention thresholds (G2).
// Real route and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
// setSetting() uses MySQL's ON DUPLICATE KEY; give the settings table a real upsert here (same shim as the G2 test).
const baseQuery = pool.query;
pool.query = (sql, params) => {
  if (/INSERT INTO settings \(setting_key, setting_value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE setting_value = \?/.test(String(sql))) {
    return baseQuery('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', [params[0], params[1]]);
  }
  return baseQuery(sql, params);
};
env.install(pool);
const { server, call } = env.listen([['/api/crm', require(path.join(env.SERVER, 'routes/crm-settings.js'))]]);
test.after(() => server.close());
env.enable(db, true);
const E = require(path.join(env.SERVER, 'lib/crm-engagement.js'));
const L = require(path.join(env.SERVER, 'lib/crm-engagement-limits.js'));

const admin = env.addAdmin(db, 'elboss', 'admin'), sales = env.addAdmin(db, 'elrep', 'sales'), viewer = env.addAdmin(db, 'elviewer', 'readonly');
const all = (sql, ...a) => db.prepare(sql).all(...a);
const reset = () => db.exec("DELETE FROM settings WHERE setting_key LIKE 'crm_eng_%'; DELETE FROM school_audit_log");
const known = (v) => ({ value: v, unknownReason: null, kind: null });
const month = (key, label, o = {}) => ({ month: key, label, schoolsReporting: 1, schoolsInScope: 1, teachersLicensed: known(20), teachersTeaching: o.teaching || known(8), classroomsActive: known(5), activities: o.acts || known(40), studentsActive: known(60) });
const lic = (o = {}) => ({ items: [{ purchaseId: 7, kind: o.kind || 'paid', licenseStatus: 'active', daysLeft: o.days === undefined ? 30 : o.days, seatsBought: known(o.bought || 50), seatsRegistered: known(o.reg === undefined ? 10 : o.reg) }] });
const TODAY = '2026-11-17';
const two = (from, to) => [month('2026-10', 'October 2026', { teaching: known(to) }), month('2026-09', 'September 2026', { teaching: known(from) })];

test('DEFAULTS: with nothing changed the alerts say exactly what they always did', () => {
  assert.deepEqual(L.DEFAULTS, { teachingDropMin: 4, teachingDropPercent: 50, licenseDays: 60, licenseSeatPercent: 50, trialDays: 7, staleMonths: 2 });
  const fell = E.alertsFor({ items: [] }, { months: two(10, 5) }, TODAY);
  assert.match(fell[0].text, /fell from 10 in September 2026 to 5 in October 2026, a drop of half or more\./);
  assert.equal(E.alertsFor({ items: [] }, { months: two(10, 6) }, TODAY).length, 0);
  assert.match(E.alertsFor(lic({ days: 20, reg: 10 }), { months: [] }, TODAY)[0].text, /ends in 20 days and only 10 of its 50 seats are signed up/);
  assert.equal(E.alertsFor(lic({ days: 20, reg: 25 }), { months: [] }, TODAY).length, 0, 'half is not fewer than half');
  assert.equal(E.alertsFor(lic({ kind: 'trial', days: 7 }), { months: [month('2026-10', 'October 2026', { acts: known(0) })] }, TODAY).filter(x => x.key === 'trial_ending_quiet').length, 1);
});

test('EACH NUMBER CHANGES WHAT IT SHOULD: the drop and its minimum, the license days and seat share, the trial days and how old a month may be', () => {
  const lim = (o) => ({ ...L.DEFAULTS, ...o });
  // the drop: 25% fall alerts at 25, not at 50; the words name the percent
  const drop = (o, from = 10, to = 7) => E.alertsFor({ items: [] }, { months: two(from, to) }, TODAY, lim(o));
  assert.equal(drop({}).length, 0); assert.equal(drop({ teachingDropPercent: 30 }).length, 1);
  assert.match(drop({ teachingDropPercent: 30 })[0].text, /a drop of 30% or more\./);
  assert.match(drop({ teachingDropPercent: 50 }, 10, 5)[0].text, /a drop of half or more\./);
  assert.equal(drop({ teachingDropMin: 11 }, 10, 5).length, 0, 'it started below the new minimum'); assert.equal(drop({ teachingDropMin: 2 }, 3, 1).length, 1);
  // the license: 90 days, and "fewer than 80% signed up"
  assert.equal(E.alertsFor(lic({ days: 80, reg: 10 }), { months: [] }, TODAY).length, 0); assert.equal(E.alertsFor(lic({ days: 80, reg: 10 }), { months: [] }, TODAY, lim({ licenseDays: 90 })).length, 1);
  assert.equal(E.alertsFor(lic({ days: 20, reg: 30 }), { months: [] }, TODAY).length, 0); assert.equal(E.alertsFor(lic({ days: 20, reg: 30 }), { months: [] }, TODAY, lim({ licenseSeatPercent: 80 })).length, 1);
  assert.equal(E.alertsFor(lic({ days: 20, reg: 40 }), { months: [] }, TODAY, lim({ licenseSeatPercent: 80 })).length, 0, '40 of 50 is exactly 80%, not fewer');
  // the trial: 14 days
  const trial = (d, o) => E.alertsFor(lic({ kind: 'trial', days: d }), { months: [month('2026-10', 'October 2026', { acts: known(0) })] }, TODAY, lim(o)).filter(x => x.key === 'trial_ending_quiet');
  assert.equal(trial(10, {}).length, 0); assert.equal(trial(10, { trialDays: 14 }).length, 1);
  // how old a month may be: October is 1 month before November; July is 4
  const old = (o) => E.alertsFor({ items: [] }, { months: [month('2026-07', 'July 2026', { acts: known(0) })] }, TODAY, lim(o));
  assert.equal(old({}).length, 0); assert.equal(old({ staleMonths: 4 }).length, 1);
});

test('THE LOADER: a stored value is used only if it is a whole number inside its limits; anything else, or no settings table, gives the default', async () => {
  reset();
  const put = (k, v) => db.prepare('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)').run(k, v);
  put('crm_eng_license_days', '90'); put('crm_eng_trial_days', 'abc'); put('crm_eng_teaching_drop_percent', '95'); put('crm_eng_teaching_drop_min', '3.5'); put('crm_eng_license_seat_percent', ' 70 '); put('crm_eng_stale_months', '');
  const l = await L.loadLimits(pool);
  assert.deepEqual(l, { ...L.DEFAULTS, licenseDays: 90, licenseSeatPercent: 70 });
  db.exec('ALTER TABLE settings RENAME TO settings_x');
  try { assert.deepEqual(await L.loadLimits(pool), L.DEFAULTS); } finally { db.exec('ALTER TABLE settings_x RENAME TO settings'); }
  reset();
});

test('THE ROUTE: everyone with a role reads; only a CRM Admin changes; a bad number refuses the whole change; each change is audited with old and new values', async () => {
  reset();
  const g = await call('GET', '/api/crm/engagement-alerts', undefined, viewer);
  assert.equal(g.status, 200); assert.equal(g.json.limits.length, 6); assert.deepEqual(g.json.limits.map(x => x.value), g.json.limits.map(x => x.default));
  assert.deepEqual(Object.keys(g.json.limits[0]).sort(), ['default', 'help', 'key', 'label', 'max', 'min', 'unit', 'value']);
  assert.equal((await call('PUT', '/api/crm/engagement-alerts', { values: { licenseDays: 90 } }, sales)).status, 403);
  assert.equal((await call('PUT', '/api/crm/engagement-alerts', { values: { licenseDays: 90 } }, viewer)).status, 403);
  assert.equal((await call('PUT', '/api/crm/engagement-alerts', { values: { licenseDays: 90 } }, null)).status, 401);
  for (const bad of [{ licenseDays: 6 }, { licenseDays: 366 }, { licenseDays: '90' }, { licenseDays: 90.5 }, { licenseDays: null }, { nope: 5 }, { constructor: 5 }, { __proto__: 5 }, { licenseDays: 90, trialDays: 0 }]) {
    const r = await call('PUT', '/api/crm/engagement-alerts', { values: bad }, admin); assert.equal(r.status, 400, JSON.stringify(bad));
  }
  for (const bad of [{}, { values: [] }, { values: 'x' }, { values: {} }]) assert.equal((await call('PUT', '/api/crm/engagement-alerts', bad, admin)).status, 400);
  assert.equal(all("SELECT * FROM settings WHERE setting_key LIKE 'crm_eng_%'").length, 0, 'a refused change stored nothing, not even its valid half');
  const ok = await call('PUT', '/api/crm/engagement-alerts', { values: { licenseDays: 90, trialDays: 7 } }, admin);
  assert.equal(ok.status, 200); assert.deepEqual(ok.json.changed, ['licenseDays'], 'only what actually changed');
  assert.equal(ok.json.limits.find(x => x.key === 'licenseDays').value, 90);
  assert.equal((await L.loadLimits(pool)).licenseDays, 90);
  const rows = all("SELECT * FROM school_audit_log WHERE action = 'crm_engagement_alerts_changed'");
  assert.equal(rows.length, 1); assert.equal(rows[0].entity_type, 'crm_attention'); assert.equal(rows[0].actor_type, 'admin_user');
  assert.deepEqual([JSON.parse(rows[0].prev_value), JSON.parse(rows[0].new_value)], [{ licenseDays: 60 }, { licenseDays: 90 }]);
  assert.equal((await call('PUT', '/api/crm/engagement-alerts', { values: { licenseDays: 90 } }, admin)).json.changed.length, 0, 'the same value changes nothing and writes no audit row');
  assert.equal(all("SELECT * FROM school_audit_log WHERE action = 'crm_engagement_alerts_changed'").length, 1);
  assert.equal((await call('PUT', '/api/crm/engagement-alerts', { values: Object.fromEntries(L.limitView(L.DEFAULTS).map(x => [x.key, x.default])) }, admin)).json.limits.find(x => x.key === 'licenseDays').value, 60, 'put back the usual numbers');
  env.enable(db, false);
  try { assert.equal((await call('GET', '/api/crm/engagement-alerts', undefined, admin)).status, 404); } finally { env.enable(db, true); }
  reset();
});

test('FILES AND PAGE: the alert text keeps its vocabulary, the card payload and the lib rules are untouched, the key prefix is its own, the settings page has its own Save and Reset', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const eng = read('lib/crm-engagement.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(eng, /\blabel\b\s*(,|FROM)|SELECT[^;`]*\blabel\b/i, 'the rule the engagement tests pin');
  assert.doesNotMatch(eng, /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b|setSetting|mailer|crm_attention/i);
  assert.doesNotMatch(read('lib/crm-engagement-limits.js').replace(/\/\/.*$/gm, ''), /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b|setSetting/, 'the loader only reads');
  for (const d of Object.values(L.LIMITS)) assert.match(d.setting, /^crm_eng_/);
  assert.doesNotMatch(read('lib/crm-attention.js'), /crm_eng_/, 'Needs Attention never reads these');
  const page = read('../admin-crm-settings.html');
  for (const k of ['saveEl', 'resetEl', 'data-el=', '/api/crm/engagement-alerts', 'esc(t.label)', 'esc(t.help)']) assert.ok(page.includes(k), k);
  assert.ok(page.includes("for (var i = 0; i < res.length; i++)") && page.includes('res[6].data, res[5].data.limits'));
  for (const f of ['lib/crm-engagement.js', 'lib/crm-engagement-limits.js', 'routes/crm-settings.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  for (const s of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s));
  assert.match(read('../docs/reference/crm-operations-runbook.md'), /Engagement alerts/, 'the runbook says where to change the numbers');
});
