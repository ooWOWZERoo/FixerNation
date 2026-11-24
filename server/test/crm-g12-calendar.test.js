// Sales CRM punch list G12 (ACT-03): a Calendar of tasks and meetings with drag to reschedule, a time zone and a join link on meetings, and attendance marked by staff.
// Real routes and real SQL (node:sqlite) from test/helpers/crm-env.js. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
const sent = [];
const mailerStub = new Proxy({ sendMeetingInviteEmail: async (m) => { sent.push(m); } }, { get: (t, k) => (k in t ? t[k] : async () => {}) });
env.install(pool, { [path.join(env.SERVER, 'lib/mailer.js')]: mailerStub });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/tasks', R('crm-tasks.js')], ['/api/crm/meetings', R('crm-meetings.js')], ['/api/crm/opportunities', R('crm-opportunities.js')]]);
test.after(() => server.close());
const MD = require(path.join(env.SERVER, 'lib/crm-meeting-details.js'));
const ICS = require(path.join(env.SERVER, 'lib/crm-ics.js'));

const admin = env.addAdmin(db, 'g12boss', 'admin'), sales = env.addAdmin(db, 'g12rep', 'sales'), sales2 = env.addAdmin(db, 'g12rep2', 'sales'), viewer = env.addAdmin(db, 'g12viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('G12 District', 'district')").run().lastInsertRowid);
const dealOf = (owner) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id) VALUES (?, 'G12 deal', 1, ?)").run(acct, owner).lastInsertRowid);
const salesDeal = dealOf(sales), otherDeal = dealOf(sales2);
const champ = env.addContact(db, 'champ@g12.test', 'Chris Champ');
db.prepare("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'champion')").run(salesDeal, champ);
const outsider = env.addContact(db, 'out@g12.test', 'Olive Outsider');
const iso = (d, h = 15) => { const x = new Date(Date.now() + d * 86400000); x.setUTCHours(h, 0, 0, 0); return x.toISOString(); };
const sql = (iso8601) => iso8601.slice(0, 19).replace('T', ' ');
const day = (d) => iso(d).slice(0, 10);
const mk = (f = {}) => Number(db.prepare(`INSERT INTO crm_appointments (opportunity_id, title, starts_at, ends_at, status, uid, sequence_no, attendees_json, organizer_admin_id, invite_sent_at, invite_sequence, time_zone, join_url)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`).run(f.deal || salesDeal, f.title || 'G12 meeting', sql(iso(f.start === undefined ? 3 : f.start)), sql(iso(f.start === undefined ? 3 : f.start, 16)), f.status || 'scheduled',
  `uid-${Math.random().toString(16).slice(2)}`, JSON.stringify({ staffIds: f.staff || [], contactIds: f.contacts === undefined ? [champ] : f.contacts }), f.organizer === undefined ? sales : f.organizer, f.invited ? '2026-11-01 10:00:00' : null, f.invited ? 0 : null, f.zone || null, f.url || null).lastInsertRowid);
const task = (f = {}) => Number(db.prepare("INSERT INTO crm_tasks (opportunity_id, title, due_on, state, assigned_admin_id, created_by_admin_id) VALUES (?, ?, ?, ?, ?, ?)").run(f.deal || salesDeal, f.title || 'G12 task', f.due || day(2), f.state || 'open', f.assignee === undefined ? sales : f.assignee, admin).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_appointments; DELETE FROM crm_tasks; DELETE FROM school_audit_log');

test('THE LINK AND THE ZONE ARE CHECKED: https only, no user name, no spaces, a real host; the zone must be a real IANA zone; blank clears', () => {
  for (const ok of ['https://zoom.us/j/123456?pwd=abc', 'https://teams.microsoft.com/l/meetup-join/x', ' https://meet.google.com/abc-defg-hij ']) assert.ok(MD.cleanUrl(ok).value, ok);
  assert.equal(MD.cleanUrl('https://meet.google.com/abc-defg-hij ').value, 'https://meet.google.com/abc-defg-hij');
  for (const bad of ['javascript:alert(1)', 'http://zoom.us/j/1', 'data:text/html,hi', 'mailto:a@b.com', 'ftp://x.test/y', 'https://user:pw@zoom.us/j/1', 'https://zoom.us/j/1 2', 'https://zoom/j/1', 'zoom.us/j/1', 'https://x.test/<script>', 'https://x.test/"a"', 'https://' + 'a'.repeat(500) + '.com', 123, {}, []])
    assert.ok(MD.cleanUrl(bad).error, String(bad).slice(0, 30));
  assert.equal(MD.cleanUrl('').value, null); assert.equal(MD.cleanUrl(null).value, null);
  for (const ok of ['America/New_York', 'UTC', 'Pacific/Honolulu', 'America/Argentina/Buenos_Aires']) assert.equal(MD.cleanZone(ok).value, ok);
  for (const bad of ['Mars/Olympus', '../etc/passwd', 'America/New York', '<b>x</b>', 'x'.repeat(65), 5, {}]) assert.ok(MD.cleanZone(bad).error, String(bad));
  assert.equal(MD.cleanZone('').value, null); assert.equal(MD.cleanZone(null).value, null);
});

test('A MEETING CARRIES A ZONE AND A JOIN LINK: saved, shown, changed, cleared; a bad one is refused and nothing is saved', async () => {
  reset();
  const base = { opportunityId: salesDeal, title: 'Demo', startsAt: iso(5), endsAt: iso(5, 16), contactIds: [champ] };
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, joinUrl: 'javascript:alert(1)' }, sales)).status, 400);
  assert.equal((await call('POST', '/api/crm/meetings', { ...base, timeZone: 'Mars/Olympus' }, sales)).status, 400);
  assert.equal(all('SELECT * FROM crm_appointments').length, 0);
  const r = await call('POST', '/api/crm/meetings', { ...base, timeZone: 'America/Chicago', joinUrl: 'https://zoom.us/j/99' }, sales);
  assert.equal(r.status, 201);
  const m = (await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, sales)).json.meetings[0];
  assert.equal(m.timeZone, 'America/Chicago'); assert.equal(m.joinUrl, 'https://zoom.us/j/99');
  const plain = await call('POST', '/api/crm/meetings', base, sales);
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  assert.equal(get('SELECT time_zone, join_url FROM crm_appointments WHERE id = ?', plain.json.id).join_url, null, 'both are optional');
  db.prepare('UPDATE crm_appointments SET invite_sent_at = ?, invite_sequence = 0 WHERE id = ?').run('2026-11-01 10:00:00', m.id);
  const same = await call('PUT', `/api/crm/meetings/${m.id}`, { joinUrl: 'https://zoom.us/j/99' }, sales);
  assert.equal(same.json.inviteOutOfDate, false, 'the same link is not a change');
  const ch = await call('PUT', `/api/crm/meetings/${m.id}`, { joinUrl: 'https://zoom.us/j/100', timeZone: 'America/Denver' }, sales);
  assert.equal(ch.status, 200); assert.equal(ch.json.inviteOutOfDate, true, 'a new link means the invitation needs an update');
  assert.equal(get('SELECT sequence_no FROM crm_appointments WHERE id = ?', m.id).sequence_no, 1);
  assert.equal((await call('PUT', `/api/crm/meetings/${m.id}`, { joinUrl: 'http://zoom.us/j/1' }, sales)).status, 400);
  assert.equal(get('SELECT join_url FROM crm_appointments WHERE id = ?', m.id).join_url, 'https://zoom.us/j/100');
  await call('PUT', `/api/crm/meetings/${m.id}`, { joinUrl: '', timeZone: '' }, sales);
  const cleared = get('SELECT time_zone, join_url FROM crm_appointments WHERE id = ?', m.id); assert.equal(cleared.join_url, null); assert.equal(cleared.time_zone, null);
});

test('THE INVITATION: the join link is in the calendar file (URL and description) and the email, the time is spelled out in the meeting\'s zone, and a cancellation has no link', async () => {
  reset(); sent.length = 0;
  const id = mk({ staff: [sales], contacts: [champ], zone: 'America/New_York', url: 'https://zoom.us/j/55', start: 4 });
  const r = await call('POST', `/api/crm/meetings/${id}/send`, {}, sales);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const m = { ...sent[0], ics: sent[0].ics.replace(/\r\n /g, '') }; // calendar files fold long lines; read them unfolded
  assert.match(m.ics, /URL:https:\/\/zoom\.us\/j\/55/); assert.match(m.ics, /DESCRIPTION:Join: https:\/\/zoom\.us\/j\/55/); assert.match(m.ics, /Set up in the America\/New_York time zone/);
  assert.match(m.text, /Join: https:\/\/zoom\.us\/j\/55/); assert.match(m.html, /href="https:\/\/zoom\.us\/j\/55"/); assert.match(m.text, /E[SD]T/, 'the time is in Eastern time');
  const noZone = ICS.inviteEmail({ method: 'REQUEST', title: 'T', startsAt: '2026-12-03 15:00:00', endsAt: '2026-12-03 16:00:00', organizerName: 'Sam' });
  assert.match(noZone.text, /UTC/);
  const cancel = ICS.inviteEmail({ method: 'CANCEL', title: 'T', startsAt: '2026-12-03 15:00:00', endsAt: '2026-12-03 16:00:00', organizerName: 'Sam', joinUrl: 'https://zoom.us/j/55' });
  assert.doesNotMatch(cancel.text + cancel.html, /zoom/);
  const bad = ICS.inviteEmail({ method: 'REQUEST', title: 'T', startsAt: '2026-12-03 15:00:00', endsAt: '2026-12-03 16:00:00', organizerName: 'Sam', timeZone: 'Not/AZone' });
  assert.match(bad.text, /UTC/, 'an unknown zone falls back to UTC rather than failing');
  const hostile = ICS.inviteEmail({ method: 'REQUEST', title: 'T', startsAt: '2026-12-03 15:00:00', endsAt: '2026-12-03 16:00:00', organizerName: 'Sam', joinUrl: 'https://x.test/"><script>' });
  assert.doesNotMatch(hostile.html, /<script>/);
});

test('ATTENDANCE: the organizer or a CRM Admin marks who came, after it starts, only for people invited; Read-only, another rep and a cancelled or future meeting are refused; the log has counts only', async () => {
  reset();
  const past = mk({ start: -2, staff: [admin], contacts: [champ] });
  const future = mk({ start: 3 }); const cancelled = mk({ start: -2, status: 'cancelled' });
  const marks = [{ type: 'contact', id: champ, attended: true }, { type: 'staff', id: admin, attended: false }];
  assert.equal((await call('POST', `/api/crm/meetings/${future}/attendance`, { marks }, sales)).status, 409, 'not started');
  assert.equal((await call('POST', `/api/crm/meetings/${cancelled}/attendance`, { marks }, sales)).status, 409);
  assert.equal((await call('POST', `/api/crm/meetings/${past}/attendance`, { marks }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/meetings/${past}/attendance`, { marks }, sales2)).status, 403, 'not their deal');
  assert.equal((await call('POST', `/api/crm/meetings/${past}/attendance`, { marks: [{ type: 'contact', id: outsider, attended: true }] }, sales)).status, 400, 'not invited');
  for (const bad of [undefined, [], 'x', [{ type: 'bogus', id: 1, attended: true }], [{ type: 'contact', id: champ, attended: 'yes' }], [null]]) assert.equal((await call('POST', `/api/crm/meetings/${past}/attendance`, { marks: bad }, sales)).status, 400, JSON.stringify(bad));
  assert.equal(get('SELECT attendance_json a FROM crm_appointments WHERE id = ?', past).a, null, 'nothing refused was saved');
  const ok = await call('POST', `/api/crm/meetings/${past}/attendance`, { marks }, sales);
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.attended, 1); assert.equal(ok.json.didNotAttend, 1);
  const m = (await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, sales)).json.meetings.find(x => x.id === past);
  assert.deepEqual(m.attendance.map(a => `${a.type}:${a.attended}`).sort(), [`contact:true`, `staff:false`]); assert.equal(m.canMarkAttendance, true);
  const v = (await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, viewer)).json.meetings.find(x => x.id === past);
  assert.equal(v.canMarkAttendance, false);
  const log = get("SELECT * FROM school_audit_log WHERE action = 'crm_meeting_attendance'");
  assert.deepEqual(JSON.parse(log.new_value), { attended: 1, didNotAttend: 1 }); assert.doesNotMatch(JSON.stringify(log), /Chris|champ@/);
  assert.equal((await call('POST', `/api/crm/meetings/${past}/attendance`, { marks: [{ type: 'contact', id: champ, attended: null }] }, admin)).status, 200, 'a CRM Admin may change it; null un-marks');
  assert.deepEqual((await call('GET', `/api/crm/meetings?opportunityId=${salesDeal}`, undefined, admin)).json.meetings.find(x => x.id === past).attendance.map(a => a.type), ['staff']);
});

test('THE CALENDAR WINDOWS: open tasks by due date and scheduled meetings by start, inside the window only; Mine and Everyone\'s; every role can read; bad windows are refused', async () => {
  reset();
  const t1 = task({ due: day(2), assignee: sales }), t2 = task({ due: day(2), assignee: sales2, deal: otherDeal }), tDone = task({ state: 'done' }), tFar = task({ due: day(90) });
  const m1 = mk({ start: 3, organizer: sales }), m2 = mk({ start: 3, organizer: sales2, deal: otherDeal }), mCancelled = mk({ start: 3, status: 'cancelled' }), mFar = mk({ start: 90 });
  const tq = (p, who = sales) => call('GET', `/api/crm/tasks/calendar?${p}`, undefined, who);
  const mq = (p, who = sales) => call('GET', `/api/crm/meetings/calendar?${p}`, undefined, who);
  const w = `from=${day(0)}&to=${day(10)}`, wm = `fromAt=${encodeURIComponent(iso(0, 0))}&toAt=${encodeURIComponent(iso(10, 0))}`;
  assert.deepEqual((await tq(`${w}&mine=true`)).json.tasks.map(t => t.id), [t1]);
  assert.deepEqual((await tq(w)).json.tasks.map(t => t.id).sort(), [t1, t2].sort());
  assert.deepEqual((await mq(`${wm}&mine=true`)).json.meetings.map(m => m.id), [m1]);
  assert.deepEqual((await mq(wm)).json.meetings.map(m => m.id).sort(), [m1, m2].sort());
  assert.ok(![tDone, tFar].some(id => (all('SELECT 1')[0], false)), 'noop');
  const viewerView = await tq(w, viewer); assert.equal(viewerView.status, 200); assert.ok(viewerView.json.tasks.every(t => t.canEdit === false));
  const mine = (await tq(w)).json.tasks; assert.equal(mine.find(t => t.id === t1).canEdit, true); assert.equal(mine.find(t => t.id === t2).canEdit, false, 'another rep\'s deal is not draggable');
  assert.equal((await tq('from=2026-01-01&to=2026-06-01')).status, 400, 'more than two months');
  assert.equal((await tq('from=nope&to=nope')).status, 400); assert.equal((await tq(`from=${day(5)}&to=${day(1)}`)).status, 400);
  assert.equal((await mq(`fromAt=2026-01-01T00:00:00&toAt=2026-01-02T00:00:00`)).status, 400, 'a time with no zone is refused');
  assert.equal((await mq(`fromAt=${encodeURIComponent(iso(0))}&toAt=${encodeURIComponent(iso(70))}`)).status, 400);
  assert.equal((await call('GET', '/api/crm/tasks/calendar?' + w)).status, 401); assert.equal((await call('GET', '/api/crm/meetings/calendar?' + wm)).status, 401);
  assert.ok(mCancelled && mFar);
});

test('THE CALENDAR IS CAPPED: more than 300 items come back as 300 with truncated true', async () => {
  reset();
  const ins = db.prepare("INSERT INTO crm_tasks (opportunity_id, title, due_on, state, assigned_admin_id, created_by_admin_id) VALUES (?, 'bulk', ?, 'open', ?, ?)");
  for (let i = 0; i < 305; i++) ins.run(salesDeal, day(2), sales, admin);
  const r = await call('GET', `/api/crm/tasks/calendar?from=${day(0)}&to=${day(10)}`, undefined, sales);
  assert.equal(r.json.tasks.length, 300); assert.equal(r.json.truncated, true);
  reset();
});

test('DRAG TO RESCHEDULE uses the existing change routes, so the same rules apply: a task\'s due date, a meeting\'s time and length, owner or CRM Admin only, and the invitation is not sent by itself', async () => {
  reset(); sent.length = 0;
  const t = task({ due: day(2), assignee: sales }), tOther = task({ deal: otherDeal, assignee: sales2 });
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { dueOn: day(6) }, sales)).status, 200); assert.equal(get('SELECT due_on FROM crm_tasks WHERE id = ?', t).due_on, day(6));
  assert.equal((await call('PUT', `/api/crm/tasks/${tOther}`, { dueOn: day(6) }, sales)).status, 403); assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { dueOn: day(7) }, viewer)).status, 403);
  assert.equal((await call('PUT', `/api/crm/tasks/${t}`, { dueOn: 'next tuesday' }, sales)).status, 400);
  const m = mk({ start: 3, invited: true, staff: [sales], contacts: [champ] });
  const before = get('SELECT * FROM crm_appointments WHERE id = ?', m);
  const len = new Date(before.ends_at.replace(' ', 'T') + 'Z') - new Date(before.starts_at.replace(' ', 'T') + 'Z');
  const ns = iso(6), ne = new Date(new Date(ns).getTime() + len).toISOString();
  const r = await call('PUT', `/api/crm/meetings/${m}`, { startsAt: ns, endsAt: ne }, sales);
  assert.equal(r.status, 200); assert.equal(r.json.inviteOutOfDate, true, 'the page offers to send the update');
  const after = get('SELECT * FROM crm_appointments WHERE id = ?', m);
  assert.equal(new Date(after.ends_at.replace(' ', 'T') + 'Z') - new Date(after.starts_at.replace(' ', 'T') + 'Z'), len); assert.equal(after.sequence_no, 1); assert.equal(sent.length, 0, 'nothing was emailed by the move');
  assert.equal((await call('PUT', `/api/crm/meetings/${m}`, { startsAt: ns, endsAt: ne }, sales2)).status, 403);
  assert.equal((await call('PUT', `/api/crm/meetings/${m}`, { startsAt: ns, endsAt: ne }, viewer)).status, 403);
});

test('THE PAGES: the calendar escapes outside text, only uses a join link that starts https, wires the menu and shell, and the meeting panel offers zone, link and attendance', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
  const page = read('admin-crm-calendar.html');
  assert.match(page, /esc\(m\.title\)/); assert.match(page, /esc\(t\.title\)/); assert.match(page, /\^https:\\\/\\\//); assert.match(page, /noopener noreferrer/);
  assert.doesNotMatch(page, /C\.api\('(POST|DELETE)', '\/api\/crm\/(tasks|meetings)\/' \+ [^)]*\/(complete|cancel)/, 'it only moves things; finishing and cancelling stay where they were');
  assert.match(page, /\/api\/crm\/tasks\/calendar/); assert.match(page, /\/api\/crm\/meetings\/calendar/); assert.match(page, /sendUpdate/);
  assert.match(page, /name="robots" content="noindex"/); assert.match(page, /admin-nav\.js\?v=41/); assert.match(page, /admin-shell\.js\?v=13/); assert.doesNotMatch(page, /fonts\.googleapis|cdn\./i);
  assert.match(read('admin-nav.js'), /admin-crm-calendar\.html/); assert.match(read('admin-nav.js'), /"crm-calendar": "</); assert.match(read('admin-shell.js'), /'crm-calendar':/);
  const panels = read('crm-panels.js');
  for (const k of ['mZone', 'mUrl', 'Who came', '/attendance']) assert.ok(panels.includes(k), k);
  assert.match(panels, /noopener noreferrer/); assert.match(panels, /esc\(m\.joinUrl\)/);
  assert.match(read('scripts/alter-add-crm-meeting-details.js'.replace('scripts', 'server/scripts')), /join_url/); assert.match(fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8'), /join_url VARCHAR\(500\)/);
});
