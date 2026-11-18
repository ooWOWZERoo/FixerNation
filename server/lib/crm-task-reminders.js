// Customer Hub follow-up to G14: the separate reminder EMAIL at the time of day a task's reminder was set for.
//
// What it is: a task can carry a remind-me date, a time of day and the time zone that time is in (set from the browser, like a meeting's). When that moment arrives, the person the task is
// assigned to gets ONE short email from the system address. It is a nudge for staff, nothing more.
//
// Rules this file keeps (each has a test):
//  - STAFF ONLY. The one recipient is the assigned staff member's own address (admin_users.email). A task nobody is assigned to, or whose owner has no address, sends nothing (it is counted,
//    never sent to the sales inbox or anyone else). No customer, contact or quote address is ever read, and no customer is ever emailed.
//  - OFF until the owner has read a dry run (setting crm_task_reminder_emails, `--task-reminders on|off|status` on scripts/crm-task-reminders.js). With the switch off, or without --apply, it
//    only COUNTS what it would send.
//  - Once per moment. A row in crm_task_reminder_sends, unique on (task, exact moment in UTC), is CLAIMED before the email is written, so two runs at once, or the job run twice, send one email.
//    A failed send is marked failed and tried once more on a later run, then given up; moving the reminder to another time is a new moment and may email again.
//  - Only open tasks, only inside a window: it sends from the moment until WINDOW_MINUTES later, so a few missed 5-minute runs are caught up, but turning the switch on never sends a pile of old
//    reminders (a moment more than two hours ago is "missed" and left alone).
//  - A task with a reminder TIME is left out of the daily digest once this is switched on (lib/crm-attention.js), so nobody gets two emails about it. It still shows on the Needs Attention page.
//  - The email names the task, its due date and what it is about (staff-only text); it never contains a student, a score or a customer's address.
// `conn` is the pool in the cron script and any query-capable handle in tests. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters).
const { zonedDateTimeToUtc } = require('./campaign-recurrence');
const { audit } = require('./audit');
const { isMissing } = require('./crm-task-fields');

const SWITCH = 'crm_task_reminder_emails';
const WINDOW_MINUTES = 120;
const MAX_ATTEMPTS = 2;
const STUCK_MINUTES = 30; // a claim older than this with no result is a run that died: the next run may take it over (once)
const isDuplicate = (err) => err && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(String(err.message)));
const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const norm = (v) => String(v || '').slice(0, 19).replace('T', ' ');
const day10 = (v) => String(v || '').slice(0, 10);

// The exact UTC moment a reminder is due, or null when its parts are not usable (a bad zone or time is never guessed).
function fireAtOf(t) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day10(t.remind_on)), tm = /^(\d{2}):(\d{2})/.exec(String(t.remind_time || ''));
  if (!d || !tm || !t.remind_tz) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: t.remind_tz }); } catch { return null; }
  const at = zonedDateTimeToUtc(Number(d[1]), Number(d[2]), Number(d[3]), Number(tm[1]), Number(tm[2]), t.remind_tz);
  return Number.isNaN(at.getTime()) ? null : at;
}

async function aboutOf(conn, t) {
  try {
    if (t.opportunity_id) { const [[r]] = await conn.query('SELECT name FROM crm_opportunities WHERE id = ?', [t.opportunity_id]); return r ? { kind: 'deal', name: r.name } : null; }
    if (t.account_id) { const [[r]] = await conn.query('SELECT name FROM crm_accounts WHERE id = ?', [t.account_id]); return r ? { kind: 'account', name: r.name } : null; }
    if (t.contact_id) { const [[r]] = await conn.query('SELECT name FROM newsletter_contacts WHERE id = ?', [t.contact_id]); return r ? { kind: 'contact', name: r.name || 'a contact' } : null; } // never the contact\u2019s email address
  } catch (err) { if (!isMissing(err)) throw err; }
  return null;
}

// apply=false counts and writes nothing. `now` is a Date. `send({ to, task })` sends one email (the cron script passes the mailer; tests pass a fake).
// Returns { available, timed, due, early, missed, noOwner, noAddress, alreadySent, inFlight, gaveUp, wouldSend, sent, failed }.
async function sendDue(conn, { apply = false, now = new Date(), send } = {}) {
  const out = { available: true, timed: 0, due: 0, early: 0, missed: 0, noOwner: 0, noAddress: 0, alreadySent: 0, inFlight: 0, gaveUp: 0, wouldSend: 0, sent: 0, failed: 0 };
  let tasks;
  const from = new Date(now.getTime() - 36 * 3600000).toISOString().slice(0, 10), to = new Date(now.getTime() + 36 * 3600000).toISOString().slice(0, 10);
  try {
    [tasks] = await conn.query(
      `SELECT t.id, t.title, t.due_on, t.remind_on, t.remind_time, t.remind_tz, t.assigned_admin_id, t.opportunity_id, t.account_id, t.contact_id
       FROM crm_tasks t WHERE t.state = 'open' AND t.remind_on IS NOT NULL AND t.remind_time IS NOT NULL AND t.remind_tz IS NOT NULL AND t.remind_on >= ? AND t.remind_on <= ? ORDER BY t.id`, [from, to]);
  } catch (err) { if (isMissing(err)) return { ...out, available: false }; throw err; } // alter-add-crm-task-reminder-time.js has not been run
  let ledger;
  try { [ledger] = await conn.query('SELECT id, task_id, fire_at, status, attempts, claimed_at FROM crm_task_reminder_sends'); }
  catch (err) { if (isMissing(err)) return { ...out, available: false }; throw err; }
  out.timed = tasks.length;
  const nowMs = now.getTime();
  for (const t of tasks) {
    const at = fireAtOf(t);
    if (!at) continue;
    if (at.getTime() > nowMs) { out.early++; continue; }
    if (nowMs - at.getTime() > WINDOW_MINUTES * 60000) { out.missed++; continue; }
    out.due++;
    if (!t.assigned_admin_id) { out.noOwner++; continue; }
    const [[admin]] = await conn.query('SELECT id, email FROM admin_users WHERE id = ?', [t.assigned_admin_id]);
    if (!admin || !admin.email) { out.noAddress++; continue; }
    const fire = sqlTime(at);
    const row = ledger.find(r => Number(r.task_id) === Number(t.id) && norm(r.fire_at) === fire);
    let claimId = null;
    if (row) {
      if (row.status === 'sent') { out.alreadySent++; continue; }
      if (row.status === 'failed' && Number(row.attempts) >= MAX_ATTEMPTS) { out.gaveUp++; continue; }
      if (row.status === 'claimed' && nowMs - new Date(`${norm(row.claimed_at).replace(' ', 'T')}Z`).getTime() < STUCK_MINUTES * 60000) { out.inFlight++; continue; }
      if (row.status === 'claimed' && Number(row.attempts) >= MAX_ATTEMPTS) { out.gaveUp++; continue; }
    }
    if (!apply) { out.wouldSend++; continue; }
    // Claim first: whoever wins the claim owns this one email.
    if (row) {
      const [u] = await conn.query('UPDATE crm_task_reminder_sends SET status = ?, attempts = attempts + 1, claimed_at = ? WHERE id = ? AND status = ? AND attempts = ?', ['claimed', sqlTime(now), row.id, row.status, row.attempts]);
      if (!u.affectedRows) { out.inFlight++; continue; }
      claimId = row.id;
    } else {
      try { const [ins] = await conn.query('INSERT INTO crm_task_reminder_sends (task_id, fire_at, owner_admin_id, status, attempts, claimed_at) VALUES (?, ?, ?, ?, 1, ?)', [t.id, fire, admin.id, 'claimed', sqlTime(now)]); claimId = ins.insertId; }
      catch (err) { if (isDuplicate(err)) { out.inFlight++; continue; } throw err; }
    }
    try {
      await send({ to: admin.email, task: { id: Number(t.id), title: t.title, dueOn: t.due_on ? day10(t.due_on) : null, about: await aboutOf(conn, t) } });
    } catch (err) {
      await conn.query('UPDATE crm_task_reminder_sends SET status = ? WHERE id = ?', ['failed', claimId]);
      out.failed++;
      console.error(`A task reminder could not be sent: ${err && err.message ? err.message : err}`); // no address in the log: the mailer's message is not echoed with one
      continue;
    }
    await conn.query('UPDATE crm_task_reminder_sends SET status = ?, sent_at = ? WHERE id = ?', ['sent', sqlTime(now), claimId]);
    out.sent++;
    await audit(conn, { actorType: 'system', action: 'crm_task_reminder_emailed', entityType: 'crm_task', entityId: Number(t.id), newValue: { fireAtUtc: fire, assignedAdminId: Number(admin.id) }, reason: 'A reminder email went to the staff member the task is assigned to, at the time they asked for.' });
  }
  return out;
}

module.exports = { SWITCH, WINDOW_MINUTES, MAX_ATTEMPTS, STUCK_MINUTES, fireAtOf, sendDue };
