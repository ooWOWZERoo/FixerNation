// Sales CRM phase 3: tasks, notes, procurement checklists, meetings with calendar invitations, and the role matrix for each. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
const sent = [];
let failMail = false;
const mailerStub = new Proxy({
  sendMeetingInviteEmail: async (m) => { if (failMail) throw new Error('smtp down'); sent.push(m); },
}, { get: (t, k) => (k in t ? t[k] : async () => {}) });
env.install(pool, { [path.join(env.SERVER, 'lib/mailer.js')]: mailerStub });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([
  ['/api/crm/accounts', R('crm-accounts.js')], ['/api/crm/contacts', R('crm-contacts.js')], ['/api/crm/opportunities', R('crm-opportunities.js')],
  ['/api/crm/tasks', R('crm-tasks.js')], ['/api/crm/notes', R('crm-notes.js')], ['/api/crm/meetings', R('crm-meetings.js')], ['/api/crm/checklists', R('crm-checklists.js')],
]);
test.after(() => server.close());

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const sales2 = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const noEmail = env.addAdmin(db, 'noemail', 'sales', { email: null });
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

const account = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Test District', 'district')").run().lastInsertRowid);
const dealOf = (owner) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id) VALUES (?, 'Deal', 1, ?)").run(account, owner).lastInsertRowid);
const salesDeal = dealOf(sales);       // sales owns it
const otherDeal = dealOf(sales2);      // sales2 owns it, so `sales` may not edit it
const openDeal = dealOf(null);         // nobody owns it: any Sales may pick it up
const person = env.addContact(db, 'pat@school-a.test', 'Pat Example');
const outsider = env.addContact(db, 'out@school-b.test', 'Out Sider');
db.prepare('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, ?)').run(salesDeal, person, 'champion');

test('OFF SWITCH: every new route answers 404 while the Hub is off, and 401 when signed out', async () => {
  env.enable(db, false);
  for (const [m, p] of [['GET', '/api/crm/tasks'], ['POST', '/api/crm/tasks'], ['GET', '/api/crm/notes?accountId=1'], ['POST', '/api/crm/notes'], ['GET', '/api/crm/meetings?upcoming=true'],
    ['POST', '/api/crm/meetings'], ['GET', '/api/crm/checklists?opportunityId=1'], ['GET', '/api/crm/checklists/templates']]) {
    const r = await call(m, p, m === 'GET' ? undefined : {}, admin);
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  env.enable(db, true);
  assert.equal((await call('GET', '/api/crm/tasks')).status, 401);
  assert.equal((await call('GET', '/api/crm/tasks', undefined, admin)).status, 200);
});

// ---- Tasks ------------------------------------------------------------------------------------------------------------------------

test('TASKS: a task belongs to exactly one subject, so none can be orphaned or double-booked', async () => {
  for (const body of [{ title: 'No subject' }, { title: 'Two', accountId: account, contactId: person }, { title: 'Bad id', accountId: 'x' }, { title: 'Ghost', accountId: 99999 }]) {
    const r = await call('POST', '/api/crm/tasks', body, admin);
    assert.ok([400, 404].includes(r.status), JSON.stringify(body) + ' -> ' + r.status);
  }
  assert.equal(all('SELECT * FROM crm_tasks').length, 0);
  assert.equal((await call('POST', '/api/crm/tasks', { accountId: account }, admin)).status, 400, 'a title is required');
  assert.equal((await call('POST', '/api/crm/tasks', { accountId: account, title: 'Call', dueOn: '2026-02-30' }, admin)).status, 400, 'a due date must be a real date');
});

test('TASKS: a deal task also stores the deal\'s account, an account task and a contact task store only their own', async () => {
  const a = await call('POST', '/api/crm/tasks', { opportunityId: salesDeal, title: 'Send the quote', dueOn: '2026-12-01' }, sales);
  const b = await call('POST', '/api/crm/tasks', { accountId: account, title: 'Account chore' }, sales);
  const c = await call('POST', '/api/crm/tasks', { contactId: person, title: 'Contact chore' }, admin);
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(c.status, 201);
  const ra = get('SELECT * FROM crm_tasks WHERE id = ?', a.json.id);
  assert.deepEqual([ra.opportunity_id, ra.account_id, ra.contact_id], [salesDeal, account, null]);
  assert.equal(ra.assigned_admin_id, sales, 'the creator is the default assignee');
  const rb = get('SELECT * FROM crm_tasks WHERE id = ?', b.json.id);
  assert.deepEqual([rb.opportunity_id, rb.account_id, rb.contact_id], [null, account, null]);
  const rc = get('SELECT * FROM crm_tasks WHERE id = ?', c.json.id);
  assert.deepEqual([rc.opportunity_id, rc.account_id, rc.contact_id], [null, null, person]);
  assert.ok(get("SELECT 1 AS x FROM school_audit_log WHERE action = 'crm_task_created' AND entity_type = 'crm_task' AND purchase_id IS NULL"));
});

test('TASKS ROLES: Read-only never writes; Sales write only on deals they can edit; the CRM Admin writes anywhere', async () => {
  assert.equal((await call('POST', '/api/crm/tasks', { accountId: account, title: 'x' }, viewer)).status, 403);
  assert.equal((await call('GET', '/api/crm/tasks', undefined, viewer)).status, 200);
  assert.equal((await call('POST', '/api/crm/tasks', { opportunityId: otherDeal, title: 'Not mine' }, sales)).status, 403);
  assert.equal((await call('POST', '/api/crm/tasks', { opportunityId: openDeal, title: 'Unowned, so open to Sales' }, sales)).status, 201);
  assert.equal((await call('POST', '/api/crm/tasks', { opportunityId: otherDeal, title: 'Admin may' }, admin)).status, 201);
  const t = get("SELECT id FROM crm_tasks WHERE title = 'Admin may'").id;
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { title: 'Edited' }, sales)).status, 403, 'Sales cannot edit a task on someone else\'s deal');
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { title: 'Edited' }, viewer)).status, 403);
  assert.equal((await call('DELETE', `/api/crm/tasks/${t}`, undefined, viewer)).status, 403);
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { title: 'Edited' }, admin)).status, 200);
});

test('TASKS: whoever a task is assigned to can finish it, even on a deal that is not theirs; nobody else on that deal can', async () => {
  const mk = await call('POST', '/api/crm/tasks', { opportunityId: otherDeal, title: 'For rep', assignedAdminId: sales }, admin);
  const id = mk.json.id;
  assert.equal((await call('POST', `/api/crm/tasks/${id}/complete`, {}, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/tasks/${id}/complete`, {}, noEmail)).status, 403, 'a different Sales user cannot finish it');
  const done = await call('POST', `/api/crm/tasks/${id}/complete`, {}, sales);
  assert.equal(done.status, 200);
  const row = get('SELECT * FROM crm_tasks WHERE id = ?', id);
  assert.equal(row.state, 'done'); assert.ok(row.completed_at); assert.equal(row.completed_by_admin_id, sales);
  const again = await call('POST', `/api/crm/tasks/${id}/complete`, {}, sales);
  assert.equal(again.json.unchanged, true, 'finishing twice changes nothing');
  assert.equal(all("SELECT * FROM school_audit_log WHERE action = 'crm_task_completed' AND entity_id = ?", id).length, 1, 'one audit row, not two');
  assert.equal((await call('POST', `/api/crm/tasks/${id}/reopen`, {}, sales)).status, 200);
  assert.equal(get('SELECT state FROM crm_tasks WHERE id = ?', id).state, 'open');
});

test('TASKS QUEUE: my open tasks by day (the browser sends its own date), overdue and today counts, subject filters, paging', async () => {
  db.prepare('DELETE FROM crm_tasks').run();
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const today = day(0);
  const mk = (title, dueOn, extra = {}) => call('POST', '/api/crm/tasks', { accountId: account, title, dueOn, assignedAdminId: admin, ...extra }, admin);
  await mk('late', day(-9)); await mk('today', today); await mk('soon', day(4)); await mk('someday', undefined); await mk('theirs', day(-9), { assignedAdminId: sales });
  const q = await call('GET', `/api/crm/tasks?assignee=me&today=${today}`, undefined, admin);
  assert.deepEqual(q.json.tasks.map(t => t.title), ['late', 'today', 'soon', 'someday'], 'by due date, none last, only mine');
  assert.deepEqual(q.json.summary, { open: 4, overdue: 1, dueToday: 1 });
  assert.equal(q.json.tasks[0].overdue, true);
  assert.deepEqual((await call('GET', `/api/crm/tasks?assignee=me&due=overdue&today=${today}`, undefined, admin)).json.tasks.map(t => t.title), ['late']);
  assert.deepEqual((await call('GET', `/api/crm/tasks?assignee=me&due=today&today=${today}`, undefined, admin)).json.tasks.map(t => t.title), ['today']);
  assert.deepEqual((await call('GET', `/api/crm/tasks?assignee=me&due=week&today=${today}`, undefined, admin)).json.tasks.map(t => t.title), ['today', 'soon']);
  assert.equal((await call('GET', `/api/crm/tasks?accountId=${account}&state=all`, undefined, viewer)).json.total, 5);
  assert.equal((await call('GET', '/api/crm/tasks?accountId=1&contactId=2', undefined, viewer)).status, 400, 'one subject at a time');
  assert.equal((await call('GET', `/api/crm/tasks?assignee=me&pageSize=2&page=2&today=${today}`, undefined, admin)).json.tasks.length, 2);
  // A wildly wrong "today" from a client cannot move the line by more than a day or two.
  const far = await call('GET', '/api/crm/tasks?assignee=me&today=2099-01-01', undefined, admin);
  assert.equal(far.json.today, today);
  // The browser's own day (one day ahead of the server, as in Sydney) is believed.
  assert.equal((await call('GET', `/api/crm/tasks?assignee=me&today=${day(1)}`, undefined, admin)).json.today, day(1));
});

// ---- Notes ------------------------------------------------------------------------------------------------------------------------

test('NOTES: written on one subject, listed newest first, and only the author or a CRM Admin can change them', async () => {
  const n1 = await call('POST', '/api/crm/notes', { opportunityId: salesDeal, body: 'Spoke with the superintendent <b>today</b>.', kind: 'call' }, sales);
  assert.equal(n1.status, 201);
  assert.equal((await call('POST', '/api/crm/notes', { opportunityId: salesDeal, body: '   ' }, sales)).status, 400);
  assert.equal((await call('POST', '/api/crm/notes', { body: 'No subject' }, sales)).status, 400);
  assert.equal((await call('POST', '/api/crm/notes', { opportunityId: salesDeal, body: 'x', kind: 'tweet' }, sales)).status, 400);
  assert.equal((await call('POST', '/api/crm/notes', { opportunityId: salesDeal, body: 'viewer note' }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/crm/notes', { opportunityId: otherDeal, body: 'not mine' }, sales)).status, 403);
  const list = await call('GET', `/api/crm/notes?opportunityId=${salesDeal}`, undefined, viewer);
  assert.equal(list.status, 200);
  assert.equal(list.json.notes[0].body, 'Spoke with the superintendent <b>today</b>.', 'stored as typed; the page escapes it');
  assert.equal(list.json.notes[0].canEdit, false, 'Read-only is shown no edit button');
  const id = n1.json.id;
  assert.equal((await call('PUT', `/api/crm/notes/${id}`, { body: 'changed' }, sales2)).status, 403);
  assert.equal((await call('PUT', `/api/crm/notes/${id}`, { body: 'changed' }, viewer)).status, 403);
  assert.equal((await call('PUT', `/api/crm/notes/${id}`, { body: 'changed by author' }, sales)).status, 200);
  assert.equal((await call('PUT', `/api/crm/notes/${id}`, { body: 'changed by admin' }, admin)).status, 200);
  // The audit trail says a note was added, never what it said.
  assert.ok(!all('SELECT new_value FROM school_audit_log').some(r => String(r.new_value).includes('superintendent')));
  assert.equal((await call('DELETE', `/api/crm/notes/${id}`, undefined, sales2)).status, 403);
  assert.equal((await call('DELETE', `/api/crm/notes/${id}`, undefined, sales)).status, 200);
  assert.equal(all('SELECT * FROM crm_notes WHERE id = ?', id).length, 0);
});

test('NOTES: an account list includes its deals\' notes, and a contact has its own', async () => {
  await call('POST', '/api/crm/notes', { accountId: account, body: 'Account-level note' }, admin);
  await call('POST', '/api/crm/notes', { contactId: person, body: 'Contact-level note' }, admin);
  await call('POST', '/api/crm/notes', { opportunityId: openDeal, body: 'Deal-level note' }, admin);
  const a = await call('GET', `/api/crm/notes?accountId=${account}`, undefined, viewer);
  assert.ok(a.json.notes.some(n => n.body === 'Deal-level note') && a.json.notes.some(n => n.body === 'Account-level note'));
  assert.ok(!a.json.notes.some(n => n.body === 'Contact-level note'));
  assert.deepEqual((await call('GET', `/api/crm/notes?contactId=${person}`, undefined, viewer)).json.notes.map(n => n.body), ['Contact-level note']);
});

// ---- Checklists -------------------------------------------------------------------------------------------------------------------

test('CHECKLISTS: only the CRM Admin edits templates; applying one copies its steps once; Sales change only deals they can edit; everyone can read', async () => {
  const mk = await call('POST', '/api/crm/checklists/templates', { name: 'District purchase', steps: ['Send W-9', 'PO received', 'send w-9', '  '] }, admin);
  assert.equal(mk.status, 201);
  assert.equal((await call('POST', '/api/crm/checklists/templates', { name: 'X', steps: ['a'] }, sales)).status, 403);
  assert.equal((await call('PUT', `/api/crm/checklists/templates/${mk.json.id}`, { steps: ['a'] }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/crm/checklists/templates', { name: 'District purchase', steps: ['a'] }, admin)).status, 409);
  assert.equal((await call('POST', '/api/crm/checklists/templates', { name: 'Empty', steps: [] }, admin)).status, 400);
  const t = (await call('GET', '/api/crm/checklists/templates', undefined, viewer)).json.templates.find(x => x.name === 'District purchase');
  assert.deepEqual(t.steps, ['Send W-9', 'PO received'], 'blanks and repeats are dropped');

  const ap = await call('POST', '/api/crm/checklists/apply', { opportunityId: salesDeal, templateId: t.id }, sales);
  assert.equal(ap.status, 200); assert.equal(ap.json.added, 2);
  assert.equal((await call('POST', '/api/crm/checklists/apply', { opportunityId: salesDeal, templateId: t.id }, sales)).json.added, 0, 'applying twice adds nothing');
  assert.equal((await call('POST', '/api/crm/checklists/apply', { opportunityId: otherDeal, templateId: t.id }, sales)).status, 403);
  assert.equal((await call('POST', '/api/crm/checklists/apply', { opportunityId: salesDeal, templateId: t.id }, viewer)).status, 403);

  const list = await call('GET', `/api/crm/checklists?opportunityId=${salesDeal}`, undefined, viewer);
  assert.equal(list.json.items.length, 2); assert.equal(list.json.canEdit, false);
  assert.deepEqual(list.json.progress, { done: 0, needed: 2, total: 2 });
  const item = list.json.items[0].id;
  assert.equal((await call('PUT', `/api/crm/checklists/${item}`, { status: 'done' }, viewer)).status, 403);
  assert.equal((await call('PUT', `/api/crm/checklists/${item}`, { status: 'done' }, sales2)).status, 403, 'not their deal');
  assert.equal((await call('PUT', `/api/crm/checklists/${item}`, { status: 'done' }, sales)).status, 200);
  assert.equal((await call('PUT', `/api/crm/checklists/${item}`, { status: 'sideways' }, sales)).status, 400);
  const after = await call('GET', `/api/crm/checklists?opportunityId=${salesDeal}`, undefined, sales);
  assert.equal(after.json.progress.done, 1); assert.equal(after.json.canEdit, true);
  assert.ok(after.json.items[0].completedAt);
  assert.equal((await call('POST', '/api/crm/checklists', { opportunityId: salesDeal, label: 'Extra step', dueOn: '2026-03-01' }, sales)).status, 201);
  assert.equal((await call('DELETE', `/api/crm/checklists/${item}`, undefined, sales)).status, 200);
});

// ---- Meetings and the calendar invitation -------------------------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 5 * 86400000);
const startIso = FUTURE.toISOString();
const endIso = new Date(FUTURE.getTime() + 45 * 60000).toISOString();

test('MEETINGS: invitees are checked (staff with an email, contacts on THIS deal), times must state their zone, Read-only and other people\'s deals are refused', async () => {
  const base = { opportunityId: salesDeal, title: 'Demo, with Q&A; bring questions', startsAt: startIso, endsAt: endIso, location: 'Zoom' };
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, contactIds: [outsider] }, sales)).status, 400, 'a contact who is not on the deal cannot be invited');
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, staffIds: [noEmail] }, admin)).status, 400, 'staff with no email cannot be invited');
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, contactIds: ['a@b.com'] }, sales)).status, 400, 'a typed address is never accepted');
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, startsAt: '2026-12-03T15:00:00' }, sales)).status, 400, 'a time with no zone is refused');
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, endsAt: startIso }, sales)).status, 400, 'it must end after it starts');
  assert.equal((await call('POST', '/api/crm/meetings', { ...base }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, opportunityId: otherDeal }, sales)).status, 403);
  assert.equal(all('SELECT * FROM crm_appointments').length, 0);
});

test('MEETINGS: send builds a real .ics (escaped, SEQUENCE, organizer, attendees), an update raises SEQUENCE, a cancel sends METHOD:CANCEL, a mail failure marks nothing as sent', async () => {
  const mk = await call('POST', '/api/crm/meetings', { opportunityId: salesDeal, title: 'Demo, with Q&A; bring questions', details: 'Line one\nLine two', startsAt: startIso, endsAt: endIso, location: 'Zoom', contactIds: [person], staffIds: [sales] }, sales);
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const id = mk.json.id;
  const list = await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, viewer);
  assert.equal(list.json.meetings[0].attendees.length, 2);
  assert.equal(list.json.meetings[0].inviteSentAt, null);

  failMail = true;
  const bad = await call('POST', `/api/crm/meetings/${id}/send`, {}, sales);
  failMail = false;
  assert.equal(bad.status, 502);
  assert.equal(get('SELECT invite_sent_at FROM crm_appointments WHERE id = ?', id).invite_sent_at, null, 'a failed send is not recorded as sent');
  assert.equal((await call('POST', `/api/crm/meetings/${id}/send`, {}, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/meetings/${id}/send`, {}, sales2)).status, 403);

  const ok = await call('POST', `/api/crm/meetings/${id}/send`, {}, sales);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.method, 'REQUEST');
  assert.deepEqual(m.to.sort(), ['pat@school-a.test', 'rep@example.com'].sort(), 'only the invited contact and staff, each once');
  assert.equal(m.replyTo, 'rep@example.com');
  assert.match(m.ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(m.ics, /METHOD:REQUEST\r\n/);
  assert.match(m.ics, /SEQUENCE:0\r\n/);
  assert.match(m.ics, /SUMMARY:Demo\\, with Q&A\\; bring questions\r\n/, 'comma and semicolon are escaped');
  assert.match(m.ics, /DESCRIPTION:Line one\\nLine two\r\n/, 'a new line becomes \\n');
  const flat = m.ics.replace(/\r\n /g, '');
  assert.match(flat, /ORGANIZER;CN="rep":mailto:rep@example.com/);
  assert.match(flat, /ATTENDEE;CN="Pat Example".*mailto:pat@school-a\.test/);
  assert.ok(m.ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75), 'every line is folded to 75 bytes');
  assert.ok(get('SELECT invite_sent_at FROM crm_appointments WHERE id = ?', id).invite_sent_at);

  // Change the time: the page is told the invitation is out of date, and a re-send raises the sequence number.
  const later = new Date(FUTURE.getTime() + 3600000).toISOString();
  const up = await call('PUT', `/api/crm/meetings/${id}`, { startsAt: later, endsAt: new Date(FUTURE.getTime() + 2 * 3600000).toISOString() }, sales);
  assert.equal(up.json.inviteOutOfDate, true);
  assert.equal((await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, sales)).json.meetings[0].inviteOutOfDate, true);
  await call('POST', `/api/crm/meetings/${id}/send`, {}, sales);
  assert.match(sent[1].ics, /SEQUENCE:1\r\n/);
  assert.match(sent[1].subject, /^Updated: /);
  assert.equal((await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, sales)).json.meetings[0].inviteOutOfDate, false);

  const cancel = await call('POST', `/api/crm/meetings/${id}/cancel`, {}, sales);
  assert.equal(cancel.json.noticeSent, true);
  assert.equal(sent[2].method, 'CANCEL');
  assert.match(sent[2].ics, /METHOD:CANCEL\r\n/);
  assert.match(sent[2].ics, /STATUS:CANCELLED\r\n/);
  assert.match(sent[2].ics, /SEQUENCE:2\r\n/);
  assert.match(sent[2].subject, /^Cancelled: /);
  assert.equal((await call('POST', `/api/crm/meetings/${id}/send`, {}, sales)).status, 409, 'a cancelled meeting cannot be sent');
  assert.equal((await call('PUT', `/api/crm/meetings/${id}`, { title: 'x' }, sales)).status, 409);
  assert.equal((await call('POST', `/api/crm/meetings/${id}/cancel`, {}, sales)).json.unchanged, true);
});

test('MEETINGS: a meeting nobody was invited to cancels with no email; one with only the organizer cannot be sent; upcoming lists scheduled ones only', async () => {
  const before = sent.length;
  const mk = await call('POST', '/api/crm/meetings', { accountId: account, title: 'Internal prep', startsAt: startIso, endsAt: endIso }, admin);
  assert.equal((await call('POST', `/api/crm/meetings/${mk.json.id}/send`, {}, admin)).status, 409, 'there is nobody to invite');
  assert.equal((await call('POST', `/api/crm/meetings/${mk.json.id}/cancel`, {}, admin)).json.noticeSent, null);
  assert.equal(sent.length, before, 'no email was sent');
  const up = await call('GET', '/api/crm/meetings?upcoming=true', undefined, viewer);
  assert.ok(up.json.meetings.every(m => m.status === 'scheduled'));
  assert.equal((await call('GET', '/api/crm/meetings', undefined, viewer)).status, 400, 'a list needs a subject or upcoming');
});

// ---- The calendar file itself -------------------------------------------------------------------------------------------------------

test('ICS: text is escaped per RFC 5545, lines fold at 75 bytes without splitting a character, and an address with a line break can never reach a header', () => {
  const ics = require(path.join(env.SERVER, 'lib/crm-ics.js'));
  assert.equal(ics.icsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.equal(ics.icsParam('He said "hi"\r\nBcc: x'), 'He said hiBcc: x');
  const out = ics.buildInvite({ method: 'REQUEST', uid: 'u1', sequence: 3, title: 'é'.repeat(100), startsAt: '2026-12-03 15:00:00', endsAt: '2026-12-03 16:00:00',
    organizer: { name: 'Org', email: 'org@example.com' }, attendees: [{ name: 'Good', email: 'good@example.com' }, { name: 'Evil', email: 'evil@example.com\r\nBcc: spy@example.com' }, { name: 'No at', email: 'nope' }] });
  assert.ok(out.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
  assert.ok(!out.includes('spy@example.com') && !out.includes('nope'));
  assert.ok(out.replace(/\r\n /g, '').includes('mailto:good@example.com'));
  assert.ok(out.replace(/\r\n /g, '').includes('SUMMARY:' + 'é'.repeat(100)), 'unfolding gives back the full text');
  assert.match(out, /DTSTART:20261203T150000Z/);
  assert.throws(() => ics.buildInvite({ method: 'PUBLISH', uid: 'u', title: 't', startsAt: 'x', endsAt: 'y', organizer: { email: 'a@b.co' } }));
  assert.throws(() => ics.buildInvite({ method: 'REQUEST', uid: 'u', title: 't', startsAt: '2026-01-01 00:00:00', endsAt: '2026-01-01 01:00:00', organizer: { email: 'bad' } }));
  assert.equal(ics.validEmail('a@b.co'), true); assert.equal(ics.validEmail('a@b.co\n'), false); assert.equal(ics.validEmail('a b@c.co'), false);
});

// ---- Merges and deletes keep the new records ------------------------------------------------------------------------------------------

test('MERGE: a merged contact\'s notes, tasks and meetings move to the contact you keep; a merged account takes its items along; delete is refused while items exist', async () => {
  const dup = env.addContact(db, 'dup@school-a.test', 'Dup Person');
  const keep = env.addContact(db, 'keep@school-a.test', 'Keep Person');
  await call('POST', '/api/crm/notes', { contactId: dup, body: 'About dup' }, admin);
  await call('POST', '/api/crm/tasks', { contactId: dup, title: 'Dup task' }, admin);
  const { workItemCountForContact } = require(path.join(env.SERVER, 'lib/crm-ownership.js'));
  assert.equal(await workItemCountForContact(pool, dup), 2, 'the delete route would refuse this contact');
  const merged = await call('POST', `/api/crm/contacts/${dup}/merge`, { intoId: keep }, admin);
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(all('SELECT * FROM crm_notes WHERE contact_id = ?', keep).length, 1);
  assert.equal(all('SELECT * FROM crm_tasks WHERE contact_id = ?', keep).length, 1);
  assert.equal(await workItemCountForContact(pool, keep), 2);
  assert.equal(await workItemCountForContact(pool, dup), 0);

  const small = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Duplicate School', 'school')").run().lastInsertRowid);
  await call('POST', '/api/crm/notes', { accountId: small, body: 'About the duplicate school' }, admin);
  const m = await call('POST', `/api/crm/accounts/${small}/merge`, { intoId: account }, admin);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal(all('SELECT * FROM crm_notes WHERE account_id = ? AND body = ?', account, 'About the duplicate school').length, 1);
});

test('VOCABULARY: the new files only ever say Suspect, Prospect and Customer, and never call a quote "viewed"', () => {
  const fs = require('node:fs');
  for (const f of ['routes/crm-tasks.js', 'routes/crm-notes.js', 'routes/crm-files.js', 'routes/crm-meetings.js', 'routes/crm-checklists.js', 'routes/crm-attention.js', 'routes/crm-timeline.js',
    'lib/crm-subjects.js', 'lib/crm-files.js', 'lib/crm-ics.js', 'lib/crm-attention.js', 'lib/crm-timeline.js']) {
    const src = fs.readFileSync(path.join(env.SERVER, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/\s\/\/ .*$/gm, ''); // code only; comments may name the rule
    assert.doesNotMatch(src, /\b(hot|warm|cold)\b\s*(lead|label|prospect|contact|deal)|'(hot|warm|cold)'/i, f);
    assert.doesNotMatch(src, /\bviewed\b/i, `${f} must not claim a quote was viewed`);
    assert.doesNotMatch(src, /jwt\.(sign|verify)|createTransport/, `${f} signs no tokens and opens no mail transport`);
  }
});
