// Customer Hub follow-up to G14: a time of day on a task's reminder, and the separate reminder EMAIL at that time. Staff only, off until a dry run is read, once per moment.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/tasks', R('crm-tasks.js')]]);
test.after(() => server.close());
const TR = require(path.join(env.SERVER, 'lib/crm-task-reminders.js'));
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));

const admin = env.addAdmin(db, 'rmboss', 'admin'), sales = env.addAdmin(db, 'rmrep', 'sales'), sales2 = env.addAdmin(db, 'rmrep2', 'sales');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Reminder District', 'district')").run().lastInsertRowid);
const deal = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, stage_entered_at) VALUES (?, 'Reminder deal', 1, ?, '2026-11-01 10:00:00')").run(acct, sales).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_task_reminder_sends; DELETE FROM crm_tasks; DELETE FROM crm_attention_events; DELETE FROM crm_attention_states; DELETE FROM settings WHERE setting_key = \'crm_task_reminder_emails\'; DELETE FROM school_audit_log');
const task = (f = {}) => Number(db.prepare("INSERT INTO crm_tasks (opportunity_id, title, state, assigned_admin_id, remind_on, remind_time, remind_tz, due_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
  f.noDeal ? null : deal, f.title || 'Call the principal', f.state || 'open', f.owner === undefined ? sales : f.owner, f.on === undefined ? '2026-11-17' : f.on, f.time === undefined ? '09:30' : f.time, f.tz === undefined ? 'America/New_York' : f.tz, f.due === undefined ? '2026-11-20' : f.due).lastInsertRowid);
const at = (iso) => new Date(iso);
const sender = () => { const sent = []; return { sent, send: async (m) => { sent.push(m); } }; };
const post = (body, who = sales) => call('POST', '/api/crm/tasks', { opportunityId: deal, title: 'T', ...body }, who);

test('THE FIELDS: a time needs a date and a real zone and looks like 09:30; clearing the date clears the time; moving the date keeps the time; "" clears the time', async () => {
  reset();
  const ok = await post({ dueOn: '2026-11-20', remindOn: '2026-11-18', remindTime: '09:30', remindTz: 'America/Chicago' });
  assert.equal(ok.status, 201);
  assert.deepEqual({ ...get('SELECT remind_on, remind_time, remind_tz FROM crm_tasks WHERE id = ?', ok.json.id) }, { remind_on: '2026-11-18', remind_time: '09:30', remind_tz: 'America/Chicago' });
  for (const bad of [{ remindOn: '2026-11-18', remindTime: '25:00', remindTz: 'America/Chicago' }, { remindOn: '2026-11-18', remindTime: '9:30', remindTz: 'America/Chicago' }, { remindOn: '2026-11-18', remindTime: 930, remindTz: 'America/Chicago' },
    { remindOn: '2026-11-18', remindTime: '09:30' }, { remindOn: '2026-11-18', remindTime: '09:30', remindTz: 'Mars/Phobos' }, { remindOn: '2026-11-18', remindTime: '09:30', remindTz: '<script>' }, { remindTime: '09:30', remindTz: 'America/Chicago' }]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  }
  const t = ok.json.id;
  const moved = await call('PUT', `/api/crm/tasks/${t}`, { remindOn: '2026-11-19' }, sales);
  assert.equal(moved.status, 200); assert.deepEqual({ ...get('SELECT remind_on, remind_time, remind_tz FROM crm_tasks WHERE id = ?', t) }, { remind_on: '2026-11-19', remind_time: '09:30', remind_tz: 'America/Chicago' }, 'the same time on the new day');
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { remindTime: '14:05' }, sales)).status, 200);
  assert.equal(get('SELECT remind_time, remind_tz FROM crm_tasks WHERE id = ?', t).remind_time, '14:05'); assert.equal(get('SELECT remind_tz FROM crm_tasks WHERE id = ?', t).remind_tz, 'America/Chicago', 'the saved zone is kept');
  const list = (await call('GET', '/api/crm/tasks?assignee=me', undefined, sales)).json.tasks.find(x => x.id === t);
  assert.deepEqual([list.remindTime, list.remindTz], ['14:05', 'America/Chicago']);
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { remindTime: '' }, sales)).status, 200);
  assert.deepEqual({ ...get('SELECT remind_on, remind_time, remind_tz FROM crm_tasks WHERE id = ?', t) }, { remind_on: '2026-11-19', remind_time: null, remind_tz: null });
  await call('PUT', `/api/crm/tasks/${t}`, { remindTime: '10:00', remindTz: 'Asia/Kolkata' }, sales);
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { remindOn: null }, sales)).status, 200);
  assert.deepEqual({ ...get('SELECT remind_on, remind_time, remind_tz FROM crm_tasks WHERE id = ?', t) }, { remind_on: null, remind_time: null, remind_tz: null }, 'no date, no time');
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { remindTime: '10:00', remindTz: 'Asia/Kolkata' }, sales)).status, 400, 'a time with no date is refused');
  assert.equal((await post({ dueOn: '2026-11-20', remindOn: '2026-11-21', remindTime: '09:30', remindTz: 'America/Chicago' })).status, 400, 'still not after the due day');
});

test('WHEN IT IS DUE: at the moment in the task’s own zone (winter and summer), not before, and not more than two hours late', async () => {
  reset();
  const winter = task({ on: '2026-11-17', time: '09:30', tz: 'America/New_York' });   // 14:30Z
  const summer = task({ on: '2026-07-01', time: '09:30', tz: 'America/New_York' });   // 13:30Z (daylight time)
  const india = task({ on: '2026-11-17', time: '09:30', tz: 'Asia/Kolkata' });       // 04:00Z
  const fx = (iso) => TR.fireAtOf({ remind_on: '2026-11-17', remind_time: '09:30', remind_tz: 'America/New_York' }).toISOString() === iso;
  assert.ok(fx('2026-11-17T14:30:00.000Z'));
  assert.equal(TR.fireAtOf({ remind_on: '2026-07-01', remind_time: '09:30', remind_tz: 'America/New_York' }).toISOString(), '2026-07-01T13:30:00.000Z', 'daylight time');
  assert.equal(TR.fireAtOf({ remind_on: '2026-11-17', remind_time: '09:30:00', remind_tz: 'Asia/Kolkata' }).toISOString(), '2026-11-17T04:00:00.000Z');
  for (const bad of [{ remind_on: '2026-11-17', remind_time: '09:30', remind_tz: 'Nope/Zone' }, { remind_on: '2026-11-17', remind_time: 'x', remind_tz: 'UTC' }, { remind_on: '', remind_time: '09:30', remind_tz: 'UTC' }, { remind_on: '2026-11-17', remind_time: '09:30', remind_tz: '' }]) assert.equal(TR.fireAtOf(bad), null);
  let f = sender();
  let r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:29:00Z'), send: f.send });
  assert.equal(r.sent, 0); assert.equal(r.early, 1, 'a minute early: not yet');
  r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:31:00Z'), send: f.send });
  assert.equal(r.sent, 1); assert.deepEqual(f.sent.map(x => x.task.id), [winter]);
  r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T04:05:00Z'), send: f.send });
  assert.deepEqual(f.sent.map(x => x.task.id), [winter, india], 'the Kolkata task fired at its own 09:30');
  r = await TR.sendDue(pool, { apply: true, now: at('2026-07-01T13:40:00Z'), send: f.send });
  assert.equal(f.sent.length, 3); assert.equal(f.sent[2].task.id, summer);
  // two hours and one minute late is "missed": never sent, so switching it on can never send a pile of old reminders
  reset(); const old = task({ on: '2026-11-17', time: '09:30', tz: 'America/New_York' }); f = sender();
  r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T16:31:00Z'), send: f.send });
  assert.deepEqual([r.sent, r.missed], [0, 1]); assert.equal(all('SELECT id FROM crm_task_reminder_sends').length, 0); void old;
  r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T16:29:00Z'), send: f.send });
  assert.equal(r.sent, 1, 'a few missed runs are caught up inside the window');
});

test('A DRY RUN SENDS AND WRITES NOTHING: it counts what it would send; the switch is the cron script’s job (off means apply is false)', async () => {
  reset(); task(); const f = sender();
  const r = await TR.sendDue(pool, { apply: false, now: at('2026-11-17T14:40:00Z'), send: f.send });
  assert.deepEqual([r.due, r.wouldSend, r.sent], [1, 1, 0]); assert.equal(f.sent.length, 0); assert.equal(all('SELECT id FROM crm_task_reminder_sends').length, 0);
  assert.equal(all('SELECT id FROM school_audit_log').length, 0);
  const script = fs.readFileSync(path.join(env.SERVER, 'scripts/crm-task-reminders.js'), 'utf8');
  assert.match(script, /const live = apply && on;/); assert.match(script, /apply: live/); assert.match(script, /--task-reminders/); assert.match(script, /--only-if-enabled/); assert.match(script, /crm_v2_enabled/);
  assert.equal(TR.SWITCH, 'crm_task_reminder_emails');
});

test('ONCE PER MOMENT: running twice, or two runs at once, sends one email and leaves one ledger row; moving the reminder is a new moment', async () => {
  reset(); const t = task(); const f = sender();
  const now = at('2026-11-17T14:40:00Z');
  const [a, b] = await Promise.all([TR.sendDue(pool, { apply: true, now, send: f.send }), TR.sendDue(pool, { apply: true, now, send: f.send })]);
  assert.equal(f.sent.length, 1, 'two at once: one email'); assert.equal(a.sent + b.sent, 1);
  assert.equal((await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:45:00Z'), send: f.send })).alreadySent, 1);
  assert.equal(f.sent.length, 1);
  const led = all('SELECT * FROM crm_task_reminder_sends'); assert.equal(led.length, 1); assert.deepEqual([led[0].status, led[0].task_id, led[0].owner_admin_id, led[0].attempts], ['sent', t, sales, 1]);
  assert.equal(led[0].fire_at, '2026-11-17 14:30:00');
  db.prepare("UPDATE crm_tasks SET remind_time = '10:00' WHERE id = ?").run(t); // moved to 15:00Z
  await TR.sendDue(pool, { apply: true, now: at('2026-11-17T15:05:00Z'), send: f.send });
  assert.equal(f.sent.length, 2, 'a new time is a new reminder'); assert.equal(all('SELECT id FROM crm_task_reminder_sends').length, 2);
  const audit = all("SELECT * FROM school_audit_log WHERE action = 'crm_task_reminder_emailed'"); assert.equal(audit.length, 2); assert.doesNotMatch(JSON.stringify(audit), /@|Call the principal/);
});

test('A FAILED SEND IS TRIED ONCE MORE, THEN GIVEN UP; a dead run’s old claim can be taken over once, a fresh claim is left alone', async () => {
  reset(); task(); let n = 0;
  const flaky = async () => { n++; throw new Error('mail down'); };
  const quiet = console.error; console.error = () => {};
  try {
    let r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:40:00Z'), send: flaky });
    assert.deepEqual([r.sent, r.failed], [0, 1]); assert.equal(get('SELECT status FROM crm_task_reminder_sends').status, 'failed');
    r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:45:00Z'), send: flaky });
    assert.equal(r.failed, 1); assert.equal(get('SELECT attempts FROM crm_task_reminder_sends').attempts, 2);
    r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:50:00Z'), send: flaky });
    assert.deepEqual([r.failed, r.gaveUp], [0, 1]); assert.equal(n, 2, 'two tries and no more');
  } finally { console.error = quiet; }
  reset(); task(); const f = sender();
  db.prepare("INSERT INTO crm_task_reminder_sends (task_id, fire_at, owner_admin_id, status, attempts, claimed_at) VALUES ((SELECT id FROM crm_tasks), '2026-11-17 14:30:00', ?, 'claimed', 1, '2026-11-17 14:38:00')").run(sales);
  let r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:40:00Z'), send: f.send });
  assert.deepEqual([r.sent, r.inFlight], [0, 1], 'claimed two minutes ago: another run is still on it');
  r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T15:15:00Z'), send: f.send });
  assert.equal(r.sent, 1, 'claimed 37 minutes ago with no result: taken over'); assert.equal(get('SELECT status, attempts FROM crm_task_reminder_sends').attempts, 2);
});

test('STAFF ONLY: the email goes to the assigned staff member’s own address and nobody else; no owner, no address, a finished task and a deleted task send nothing; no customer address is read', async () => {
  reset();
  const noMail = env.addAdmin(db, 'rmnomail', 'sales'); db.prepare('UPDATE admin_users SET email = NULL WHERE id = ?').run(noMail);
  const contact = env.addContact(db, 'parent@customer-school.test', 'Customer Person'); env.addQuote(db, 'buyer@customer-school.test', { school: 'Customer School' });
  const mine = task({ owner: sales, title: 'Mine' }), other = task({ owner: sales2, title: 'Other' });
  task({ owner: null, title: 'Nobody' }); task({ owner: noMail, title: 'No address' }); task({ state: 'done', title: 'Done' });
  const gone = task({ title: 'Deleted' }); db.prepare('DELETE FROM crm_tasks WHERE id = ?').run(gone);
  db.prepare('INSERT INTO crm_tasks (contact_id, title, state, assigned_admin_id, remind_on, remind_time, remind_tz) VALUES (?, ?, ?, ?, ?, ?, ?)').run(contact, 'On a contact', 'open', sales, '2026-11-17', '09:30', 'America/New_York');
  const f = sender();
  const r = await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:40:00Z'), send: f.send });
  assert.deepEqual([r.noOwner, r.noAddress], [1, 1]);
  const adminMail = (id) => get('SELECT email FROM admin_users WHERE id = ?', id).email;
  assert.deepEqual(f.sent.map(x => x.to).sort(), [adminMail(sales), adminMail(sales), adminMail(sales2)].sort(), 'only the two owners’ own addresses');
  assert.ok(!f.sent.some(x => /customer-school|parent@|buyer@/.test(JSON.stringify(x))), 'no customer address anywhere');
  assert.deepEqual(f.sent.map(x => x.task.title).sort(), ['Mine', 'On a contact', 'Other']);
  assert.deepEqual(f.sent.find(x => x.task.title === 'On a contact').task.about, { kind: 'contact', name: 'Customer Person' }); void [mine, other];
  // the mailer itself refuses an empty or non-address recipient instead of falling back to the sales inbox
  // (the test environment stubs lib/mailer.js, so the real one is run in its own process)
  const probe = `const m = require(${JSON.stringify(path.join(env.SERVER, 'lib/mailer.js'))}); (async () => { const out = []; for (const b of ['', '   ', null, undefined, 'not an address']) { try { await m.sendTaskReminderEmail({ to: b, title: 'x' }); out.push('sent'); } catch (e) { out.push(/staff member/.test(e.message) ? 'refused' : 'other: ' + e.message); } } console.log(JSON.stringify(out)); })()`;
  assert.deepEqual(JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' })), ['refused', 'refused', 'refused', 'refused', 'refused']);
});

test('NEEDS ATTENTION AND THE DIGEST: with the switch ON a timed reminder is left out of the daily digest (the page still lists it); with it OFF, or no time set, the digest is unchanged', async () => {
  reset();
  const timed = task({ on: '2026-11-17', time: '09:30' }), dated = task({ on: '2026-11-17', time: null, tz: null, title: 'Date only' });
  const today = '2026-11-17';
  const flags = async () => Object.fromEntries((await A.evaluate(pool, { today })).filter(i => i.ruleKey === 'task_reminder').map(i => [i.subjectId, !!i.noDigest]));
  assert.deepEqual(await flags(), { [timed]: false, [dated]: false }, 'switch off: unchanged');
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('crm_task_reminder_emails', 'true')").run();
  assert.deepEqual(await flags(), { [timed]: true, [dated]: false });
  const digests = []; await A.runDaily(pool, { apply: true, now: `${today} 07:00:00`, sendDigest: async (to, list) => { digests.push(list.filter(i => i.ruleKey === 'task_reminder').map(i => i.subjectId)); } });
  assert.deepEqual(digests.flat().sort(), [dated], 'only the date-only reminder is in the digest');
  assert.equal((await A.evaluate(pool, { today })).filter(i => i.ruleKey === 'task_reminder').length, 2, 'the Needs Attention page still lists both');
});

test('BEFORE THE ALTER SCRIPT: with no time columns or no ledger the job says it is not available and does nothing; tasks save without the time, and nothing else is lost', async () => {
  reset();
  const ok = await post({ dueOn: '2026-11-20', priority: 'high', remindOn: '2026-11-18', remindTime: '09:30', remindTz: 'America/Chicago' });
  db.exec('ALTER TABLE crm_tasks DROP COLUMN remind_time; ALTER TABLE crm_tasks DROP COLUMN remind_tz;');
  try {
    assert.equal((await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:40:00Z'), send: sender().send })).available, false);
    const saved = await post({ dueOn: '2026-11-20', priority: 'high', remindOn: '2026-11-18', remindTime: '09:30', remindTz: 'America/Chicago' });
    assert.equal(saved.status, 201, 'the task saves without its time');
    assert.deepEqual({ ...get('SELECT priority, remind_on FROM crm_tasks WHERE id = ?', saved.json.id) }, { priority: 'high', remind_on: '2026-11-18' }, 'priority and the reminder date are kept');
    assert.equal((await call('PUT', `/api/crm/tasks/${saved.json.id}`, { title: 'renamed', priority: 'low', remindOn: '2026-11-19', remindTime: '10:00', remindTz: 'UTC' }, sales)).status, 200);
    assert.deepEqual({ ...get('SELECT title, priority, remind_on FROM crm_tasks WHERE id = ?', saved.json.id) }, { title: 'renamed', priority: 'low', remind_on: '2026-11-19' });
    assert.equal((await call('GET', '/api/crm/tasks?assignee=me', undefined, sales)).status, 200);
    assert.equal((await A.evaluate(pool, { today: '2026-11-18' })).some(i => i.ruleKey === 'task_reminder'), true, 'Needs Attention still works');
  } finally { db.exec('ALTER TABLE crm_tasks ADD COLUMN remind_time TEXT; ALTER TABLE crm_tasks ADD COLUMN remind_tz TEXT;'); }
  db.exec('ALTER TABLE crm_task_reminder_sends RENAME TO crm_task_reminder_sends_x');
  try { assert.equal((await TR.sendDue(pool, { apply: true, now: at('2026-11-17T14:40:00Z'), send: sender().send })).available, false); } finally { db.exec('ALTER TABLE crm_task_reminder_sends_x RENAME TO crm_task_reminder_sends'); }
  void ok;
});

test('FILES AND PAGES: schema, alter script, cron line and panels agree; mail goes only through lib/mailer.js; the alter script only adds; the pages send the zone and bump the panels version', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  for (const c of ['remind_time', 'remind_tz', 'crm_task_reminder_sends']) { assert.match(read('db/schema.sql'), new RegExp(c)); assert.match(read('scripts/alter-add-crm-task-reminder-time.js'), new RegExp(c)); }
  const alter = read('scripts/alter-add-crm-task-reminder-time.js').replace(/\/\/.*$/gm, '');
  assert.match(alter, /information_schema\.COLUMNS/); assert.doesNotMatch(alter, /DROP|RENAME|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET/i);
  assert.match(read('scripts/setup-cron-jobs.sh'), /\*\/5 \* \* \* \* \$NODE \$SCRIPTS\/crm-task-reminders\.js --apply --only-if-enabled/);
  for (const f of ['lib/crm-task-reminders.js', 'scripts/crm-task-reminders.js']) assert.doesNotMatch(read(f).replace(/\/\/.*$/gm, ''), /createTransport|nodemailer|sendMail/, f);
  assert.doesNotMatch(read('lib/crm-task-reminders.js').replace(/\/\/.*$/gm, ''), /newsletter_contacts\s+(c\s+)?WHERE[^;]*email|quote_requests|campaign_sends|SELECT[^;`]*\bemail\b[^;`]*FROM (newsletter_contacts|quote_requests)/i, 'no customer address is read');
  const panels = read('../crm-panels.js'), tasks = read('../admin-crm-tasks.html');
  for (const src of [panels, tasks]) { assert.match(src, /id="tRemindAt"/); assert.match(src, /remindTz/); }
  for (const f of ['account', 'contact', 'opportunity']) assert.match(read(`../admin-crm-${f}.html`), /crm-panels\.js\?v=4/);
  for (const f of ['lib/crm-task-reminders.js', 'lib/crm-task-fields.js', 'routes/crm-tasks.js', 'lib/mailer.js', 'scripts/crm-task-reminders.js', 'scripts/alter-add-crm-task-reminder-time.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  new (require('node:vm').Script)(panels);
  for (const s of [...tasks.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s));
});
