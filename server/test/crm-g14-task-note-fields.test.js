// Sales CRM punch list G14 (ACT-01, ACT-02): task priority, source, remind-me date and quote link; a note's edit history. Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
db.exec('CREATE TABLE crm_quote_followup_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, task_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (quote_id))');
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/tasks', R('crm-tasks.js')], ['/api/crm/notes', R('crm-notes.js')], ['/api/crm/overview', R('crm-overview.js')], ['/api/crm/attention', R('crm-attention.js')]]);
test.after(() => server.close());
const TF = require(path.join(env.SERVER, 'lib/crm-task-fields.js'));
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const QF = require(path.join(env.SERVER, 'lib/crm-quote-followups.js'));

const admin = env.addAdmin(db, 'g14boss', 'admin'), sales = env.addAdmin(db, 'g14rep', 'sales'), sales2 = env.addAdmin(db, 'g14rep2', 'sales'), viewer = env.addAdmin(db, 'g14viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const ymd = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const TODAY = ymd(0);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('G14 District', 'district')").run().lastInsertRowid);
const deal = (owner) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, stage_entered_at) VALUES (?, 'G14 deal', 1, ?, '2026-11-01 10:00:00')").run(acct, owner).lastInsertRowid);
const myDeal = deal(sales), otherDeal = deal(sales2);
const quote = (d, n) => Number(db.prepare("INSERT INTO quote_requests (quote_number, email, status, accept_token, opportunity_id, quote_sent_at, first_name, last_name, school) VALUES (?, ?, 'contacted', ?, ?, ?, 'Pat', 'Example', 'Sample')").run(n, `g14-${n}@school.test`, `tok-${n}`, d, `${ymd(-8)} 10:00:00`).lastInsertRowid);
const myQuote = quote(myDeal, 'G14-A'), otherQuote = quote(otherDeal, 'G14-B');
const post = (body, who = sales) => call('POST', '/api/crm/tasks', { opportunityId: myDeal, title: 'G14 task', ...body }, who);
const reset = () => db.exec('DELETE FROM crm_tasks; DELETE FROM crm_notes; DELETE FROM crm_note_versions; DELETE FROM crm_quote_followup_tasks; DELETE FROM school_audit_log; DELETE FROM crm_attention_states; DELETE FROM crm_attention_events');

test('DEFAULTS AND CHECKS: a plain task is Normal, by hand, with no reminder or quote; priority must be low, normal or high; a reminder cannot be after the due date; source cannot be typed', async () => {
  reset();
  const plain = await post({ dueOn: ymd(5) });
  assert.equal(plain.status, 201);
  const row = get('SELECT * FROM crm_tasks WHERE id = ?', plain.json.id);
  assert.equal(row.priority, 'normal'); assert.equal(row.source, 'manual'); assert.equal(row.remind_on, null); assert.equal(row.quote_id, null);
  assert.equal((await post({ priority: 'urgent' })).status, 400); assert.equal((await post({ priority: ['high'] })).status, 400);
  assert.equal((await post({ dueOn: ymd(5), remindOn: ymd(6) })).status, 400, 'after the due date');
  assert.equal((await post({ remindOn: 'tomorrow' })).status, 400);
  assert.equal((await post({ dueOn: ymd(5), remindOn: ymd(5), priority: 'high' })).status, 201, 'on the due day is fine');
  const sneaky = await post({ source: 'request', priority: 'low' });
  assert.equal(get('SELECT source FROM crm_tasks WHERE id = ?', sneaky.json.id).source, 'manual', 'a request body can never set the source');
  assert.equal(all('SELECT * FROM crm_tasks').length, 3, 'nothing refused was saved');
});

test('A QUOTE LINK: only on a task on a deal, only one of that deal\'s own quotes; it shows with the quote number; the quote is not changed', async () => {
  reset();
  assert.equal((await post({ quoteId: otherQuote })).status, 400, 'another deal\'s quote');
  assert.equal((await post({ quoteId: 999999 })).status, 400); assert.equal((await post({ quoteId: 'abc' })).status, 400);
  const c = env.addContact(db, 'g14c@school.test');
  assert.equal((await call('POST', '/api/crm/tasks', { contactId: c, title: 'On a contact', quoteId: myQuote }, sales)).status, 400, 'a contact task has no quote field');
  const before = JSON.stringify(all('SELECT * FROM quote_requests'));
  const r = await post({ quoteId: myQuote });
  assert.equal(r.status, 201); assert.equal(JSON.stringify(all('SELECT * FROM quote_requests')), before);
  const list = await call('GET', `/api/crm/tasks?opportunityId=${myDeal}&today=${TODAY}`, undefined, sales);
  assert.deepEqual(list.json.tasks[0].quote, { id: myQuote, number: 'G14-A' });
  assert.equal((await call('PUT', `/api/crm/tasks/${r.json.id}`, { quoteId: otherQuote }, sales)).status, 400);
  assert.equal((await call('PUT', `/api/crm/tasks/${r.json.id}`, { quoteId: null }, sales)).status, 200); assert.equal(get('SELECT quote_id q FROM crm_tasks WHERE id = ?', r.json.id).q, null);
});

test('CHANGING A TASK: priority and reminder are editable by whoever can edit it; moving the due date earlier pulls the reminder in; Read-only and another rep\'s deal are refused', async () => {
  reset();
  const t = (await post({ dueOn: ymd(10), remindOn: ymd(8) })).json.id;
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { priority: 'high', remindOn: ymd(9) }, sales)).status, 200);
  const row = get('SELECT priority, remind_on FROM crm_tasks WHERE id = ?', t); assert.equal(row.priority, 'high'); assert.equal(row.remind_on, ymd(9));
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { remindOn: ymd(11) }, sales)).status, 400, 'after the due date');
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { dueOn: ymd(4) }, sales)).status, 200);
  assert.equal(get('SELECT remind_on FROM crm_tasks WHERE id = ?', t).remind_on, ymd(4), 'dragging the due date earlier brings the reminder with it');
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { remindOn: null }, sales)).status, 200); assert.equal(get('SELECT remind_on FROM crm_tasks WHERE id = ?', t).remind_on, null);
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { priority: 'low' }, viewer)).status, 403); assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { priority: 'low' }, sales2)).status, 403);
  assert.ok(all("SELECT new_value FROM school_audit_log WHERE action = 'crm_task_updated'").some(r => r.new_value.includes('priority')), 'the change is in the audit log');
});

test('THE LIST: High first within a day, the filters work, the summary counts reminders that have come, and Read-only sees the labels', async () => {
  reset();
  const mk = (title, o) => db.prepare("INSERT INTO crm_tasks (opportunity_id, title, due_on, state, assigned_admin_id, created_by_admin_id, priority, source, remind_on) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)").run(myDeal, title, o.due === undefined ? ymd(3) : o.due, sales, admin, o.priority || 'normal', o.source || 'manual', o.remind || null);
  mk('low one', { priority: 'low' }); mk('normal one', {}); mk('high one', { priority: 'high', source: 'daily_check' }); mk('reminded', { remind: ymd(-1), due: ymd(9) }); mk('later reminder', { remind: ymd(4), due: ymd(9) });
  const l = (q, who = sales) => call('GET', `/api/crm/tasks?assignee=me&today=${TODAY}&${q}`, undefined, who);
  assert.deepEqual((await l('due=upto&days=5')).json.tasks.map(t => t.title), ['high one', 'normal one', 'low one']);
  assert.deepEqual((await l('priority=high')).json.tasks.map(t => t.title), ['high one']);
  assert.deepEqual((await l('source=daily_check')).json.tasks.map(t => t.title), ['high one']);
  assert.deepEqual((await l('remind=due')).json.tasks.map(t => t.title), ['reminded']);
  assert.equal((await l('')).json.summary.reminders, 1);
  const v = await call('GET', `/api/crm/tasks?today=${TODAY}`, undefined, viewer);
  assert.equal(v.status, 200); assert.ok(v.json.tasks.some(t => t.priority === 'high' && t.source === 'daily_check'));
  reset();
});

test('THE SYSTEM TAGS ITS OWN TASKS: the quote follow-up job marks its tasks "daily_check" and links the quote', async () => {
  reset();
  const r = await QF.createFollowUps(pool, { apply: true, now: `${TODAY} 06:50:00`, today: TODAY });
  assert.ok(r.made >= 1);
  const t = get("SELECT * FROM crm_tasks WHERE title LIKE 'Follow up on quote%' AND opportunity_id = ?", myDeal);
  assert.equal(t.source, 'daily_check'); assert.equal(t.quote_id, myQuote);
  assert.equal(TF.SOURCES.includes('daily_check') && TF.SOURCES.includes('request'), true);
  reset();
});

test('REMINDERS: on the day it comes up a task is a Needs Attention item and counts on the Overview (mine plus unassigned); done tasks and future dates are not; moving the date raises it again', async () => {
  reset();
  const mk = (o) => Number(db.prepare("INSERT INTO crm_tasks (opportunity_id, title, due_on, state, assigned_admin_id, created_by_admin_id, remind_on) VALUES (?, ?, ?, ?, ?, ?, ?)").run(myDeal, o.title, ymd(9), o.state || 'open', o.who === undefined ? sales : o.who, admin, o.remind).lastInsertRowid);
  const a = mk({ title: 'mine', remind: ymd(0) }), nobody = mk({ title: 'nobody', remind: ymd(-2), who: null }), theirs = mk({ title: 'theirs', remind: ymd(0), who: sales2 }); mk({ title: 'future', remind: ymd(3) }); mk({ title: 'done', remind: ymd(0), state: 'done' });
  const items = (await A.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === 'task_reminder');
  assert.deepEqual(items.map(i => i.subjectId).sort(), [a, nobody, theirs].sort());
  const mine = items.find(i => i.subjectId === a);
  assert.equal(mine.fingerprint, TODAY); assert.equal(mine.ownerAdminId, sales); assert.match(mine.why, /asked to be reminded/); assert.equal(mine.subjectType, 'task');
  assert.equal(Object.keys(A.RULES).length, 18); assert.ok(A.RULES.task_reminder.help);
  const ov = await call('GET', `/api/crm/overview?today=${TODAY}`, undefined, sales);
  assert.equal(ov.json.cards.remindersToday.count, 2, 'the one assigned to me and the one assigned to nobody');
  db.prepare("UPDATE crm_tasks SET remind_on = ? WHERE id = ?").run(ymd(0), nobody);
  assert.notEqual((await A.evaluate(pool, { today: TODAY })).find(i => i.ruleKey === 'task_reminder' && i.subjectId === nobody).fingerprint, ymd(-2), 'a new date is a new item');
  assert.ok(fs.readFileSync(path.join(env.SERVER, 'routes/crm-attention.js'), 'utf8').includes("'task_reminder'"));
});

test('NOTE HISTORY: an edit keeps the earlier text and says "edited" to everyone; only a CRM Admin can open the versions; a change to the words or kind counts, an unchanged save does not; deleting erases them', async () => {
  reset();
  const n = (await call('POST', '/api/crm/notes', { opportunityId: myDeal, body: 'first words', kind: 'note' }, sales)).json.id;
  const view = async (who) => (await call('GET', `/api/crm/notes?opportunityId=${myDeal}`, undefined, who)).json.notes[0];
  assert.equal((await view(sales)).editedAt, null);
  assert.equal((await call('PUT', `/api/crm/notes/${n}`, { body: 'first words' }, sales)).status, 200);
  assert.equal(all('SELECT * FROM crm_note_versions').length, 0, 'saving the same words keeps nothing');
  assert.equal((await call('PUT', `/api/crm/notes/${n}`, { body: 'second words' }, sales)).status, 200);
  assert.equal((await call('PUT', `/api/crm/notes/${n}`, { kind: 'call' }, admin)).status, 200);
  assert.equal((await call('PUT', `/api/crm/notes/${n}`, { body: '<b>third</b> words' }, sales)).status, 200);
  const versions = all('SELECT * FROM crm_note_versions ORDER BY id');
  assert.deepEqual(versions.map(v => v.body), ['first words', 'second words', 'second words']); assert.deepEqual(versions.map(v => v.kind), ['note', 'note', 'call']);
  for (const who of [sales, viewer, admin]) { const x = await view(who); assert.ok(x.editedAt, 'everyone sees that it was edited'); assert.equal(x.canSeeHistory, who === admin); }
  const h = await call('GET', `/api/crm/notes/${n}/history`, undefined, admin);
  assert.equal(h.status, 200); assert.deepEqual(h.json.versions.map(v => v.body), ['second words', 'second words', 'first words']); assert.equal(h.json.current.body, '<b>third</b> words'); assert.equal(h.json.versions[0].changedBy, 'g14rep');
  for (const who of [sales, viewer]) assert.equal((await call('GET', `/api/crm/notes/${n}/history`, undefined, who)).status, 403);
  assert.equal((await call('GET', `/api/crm/notes/${n}/history`)).status, 401); assert.equal((await call('GET', '/api/crm/notes/99999/history', undefined, admin)).status, 404);
  const log = all("SELECT * FROM school_audit_log WHERE entity_type = 'crm_note'"); assert.doesNotMatch(JSON.stringify(log), /words/, 'no note text is ever copied into the audit log');
  assert.ok(log.some(r => r.action === 'crm_note_history_viewed'));
  assert.equal((await call('DELETE', `/api/crm/notes/${n}`, undefined, sales)).status, 200);
  assert.equal(all('SELECT * FROM crm_note_versions').length, 0, 'the earlier versions go with the note');
});

test('BEFORE THE ALTER SCRIPT: tasks still list, save and sort, and a note still saves, when the new columns and table are not there', async () => {
  reset();
  const t = (await post({ dueOn: ymd(3) })).json.id;
  const n = (await call('POST', '/api/crm/notes', { opportunityId: myDeal, body: 'plain' }, sales)).json.id;
  db.exec('ALTER TABLE crm_tasks DROP COLUMN priority; ALTER TABLE crm_tasks DROP COLUMN source; ALTER TABLE crm_tasks DROP COLUMN remind_on; ALTER TABLE crm_tasks DROP COLUMN quote_id; DROP TABLE crm_note_versions; ALTER TABLE crm_notes DROP COLUMN edited_at; ALTER TABLE crm_notes DROP COLUMN edited_by_admin_id;');
  try {
    const l = await call('GET', `/api/crm/tasks?assignee=me&today=${TODAY}`, undefined, sales);
    assert.equal(l.status, 200); assert.equal(l.json.tasks[0].priority, 'normal'); assert.equal(l.json.tasks[0].source, 'manual'); assert.equal(l.json.summary.reminders, null);
    assert.equal((await post({ dueOn: ymd(4) })).status, 201);
    assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { title: 'renamed' }, sales)).status, 200);
    assert.equal((await call('PUT', `/api/crm/notes/${n}`, { body: 'changed' }, sales)).status, 200);
    assert.equal((await call('GET', `/api/crm/notes?opportunityId=${myDeal}`, undefined, sales)).json.notes[0].body, 'changed');
    assert.equal((await call('GET', `/api/crm/overview?today=${TODAY}`, undefined, sales)).json.cards.remindersToday, null, 'not zero: unknown');
    assert.ok((await A.evaluate(pool, { today: TODAY })), 'Needs Attention still evaluates');
  } finally {
    db.exec("ALTER TABLE crm_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'; ALTER TABLE crm_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'; ALTER TABLE crm_tasks ADD COLUMN remind_on TEXT; ALTER TABLE crm_tasks ADD COLUMN quote_id INTEGER; ALTER TABLE crm_notes ADD COLUMN edited_at TEXT; ALTER TABLE crm_notes ADD COLUMN edited_by_admin_id INTEGER; CREATE TABLE crm_note_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, body TEXT NOT NULL, kind TEXT, changed_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);");
  }
});

test('FILES AND PAGES: the alter script, schema, panels and tasks page carry the new fields, escape outside text, and show the history only through the admin route', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  for (const c of ['priority', 'source', 'remind_on', 'quote_id', 'edited_at', 'crm_note_versions']) { assert.match(read('scripts/alter-add-crm-task-note-fields.js'), new RegExp(c)); assert.match(read('db/schema.sql'), new RegExp(c)); }
  assert.match(read('scripts/alter-add-crm-task-note-fields.js'), /information_schema\.COLUMNS/);
  const panels = read('../crm-panels.js'), tasks = read('../admin-crm-tasks.html');
  for (const k of ['tPrio', 'tRemind', 'tQuote', 'Earlier versions', '/history']) assert.ok(panels.includes(k), k);
  assert.match(panels, /esc\(x\.body\)/); assert.match(panels, /esc\(r\.data\.current\.body\)/); assert.match(tasks, /remind: 'due'|p\.remind = 'due'/); assert.match(tasks, /esc\(t\.quote\.number/);
  assert.match(read('../admin-crm-overview.html'), /remindersToday/);
  for (const f of ['lib/crm-task-fields.js', 'routes/crm-tasks.js', 'routes/crm-notes.js', 'scripts/alter-add-crm-task-note-fields.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
