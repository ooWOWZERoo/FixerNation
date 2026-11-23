// Sales CRM tasks: the to-do list that hangs off a deal, an account or a contact (mounted at /api/crm/tasks).
// A task always belongs to exactly one subject (lib/crm-subjects.js), has one assignee and an optional due DATE (a day, not a time: "call on Tuesday").
// Who may do what is the phase 3 matrix in docs/reference/sales-crm-update-requirements.md: Read-only never writes; Sales write on deals they can edit and on any account
// or contact, and may always finish a task assigned to them; the CRM Admin does everything.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { text, posInt, dateOnly, oneOf, paging } = require('../lib/crm-common');
// How long a task's title and details may be. The crm_tasks columns are this wide (scripts/alter-widen-crm-task-text.js); doubled from 255 and 1000 on 2026-11-23. Keep the two page inputs (crm-panels.js, admin-crm-tasks.html) the same.
const TASK_TITLE_MAX = 510;
const TASK_DETAILS_MAX = 2000;
const S = require('../lib/crm-subjects');
const TF = require('../lib/crm-task-fields'); // G14: priority, source, reminder, quote link

const router = express.Router();

// The field sets to try, most complete first: all of them, then without the time-of-day columns, then none. (An install that has not run an alter script yet lacks those columns.)
function fallbacks(fields) {
  const noTime = Object.fromEntries(Object.entries(fields).filter(([k]) => !TF.TIME_COLUMNS.includes(k)));
  const out = [fields];
  if (Object.keys(noTime).length !== Object.keys(fields).length) out.push(noTime);
  if (Object.keys(noTime).length) out.push({});
  return out;
}

const TASK_SELECT = `SELECT t.*, ${S.SUBJECT_COLS}, au.username AS assignee_name, cu.username AS creator_name
  FROM crm_tasks t ${S.SUBJECT_JOIN('t')}
  LEFT JOIN admin_users au ON au.id = t.assigned_admin_id
  LEFT JOIN admin_users cu ON cu.id = t.created_by_admin_id`;

function taskView(t, req, today, quoteNumbers) {
  const mine = req.crm.role !== 'readonly' && Number(t.assigned_admin_id) === Number(req.crm.adminId);
  const writable = S.canWriteRow(req, t);
  return {
    id: t.id, title: t.title, details: t.details || null, dueOn: t.due_on || null, state: t.state,
    // G14: priority and where the task came from (never typed), the day to be reminded, and the quote it is about. Defaults when the columns are not there yet.
    priority: t.priority || 'normal', source: t.source || 'manual', remindOn: t.remind_on || null, remindTime: t.remind_time ? String(t.remind_time).slice(0, 5) : null, remindTz: t.remind_tz || null,
    quote: t.quote_id ? { id: Number(t.quote_id), number: (quoteNumbers && quoteNumbers.get(Number(t.quote_id))) || null } : null,
    overdue: t.state === 'open' && !!t.due_on && String(t.due_on).slice(0, 10) < today,
    assignedAdminId: t.assigned_admin_id || null, assigneeName: t.assignee_name || null, createdByName: t.creator_name || null,
    createdAt: t.created_at, completedAt: t.completed_at || null,
    subject: S.subjectView(t),
    canEdit: writable, canComplete: writable || mine,
  };
}

async function staffExists(id) {
  const [[a]] = await pool.query('SELECT id FROM admin_users WHERE id = ?', [id]);
  return !!a;
}

// The quote numbers for the tasks that name a quote (one lookup, never a join: the quote column may not exist yet).
async function quoteNumbersFor(rows) {
  const ids = [...new Set(rows.map(r => Number(r.quote_id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const [q] = await pool.query('SELECT id, quote_number FROM quote_requests WHERE id IN (?)', [ids]);
  return new Map(q.map(x => [Number(x.id), x.quote_number || null]));
}

// ---- List -------------------------------------------------------------------------------------------------------------------------

// ?assignee=me|none|me_or_none|<id>  ?state=open|done|all (default open)  ?due=overdue|today|week|none|upto (&days=N)  ?today=YYYY-MM-DD (the browser's own day)
// plus ONE of opportunityId / accountId / contactId to list a subject's tasks (an account's list includes its deals' tasks).
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const today = S.todayFrom(req.query.today);
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  const state = req.query.state === 'all' ? null : (oneOf(req.query.state, ['open', 'done']) || 'open');
  if (state) { where.push('t.state = ?'); params.push(state); }
  if (req.query.assignee === 'me') { where.push('t.assigned_admin_id = ?'); params.push(req.crm.adminId); }
  else if (req.query.assignee === 'none') where.push('t.assigned_admin_id IS NULL');
  else if (req.query.assignee === 'me_or_none') { where.push('(t.assigned_admin_id IS NULL OR t.assigned_admin_id = ?)'); params.push(req.crm.adminId); } // punch list B10: the Overview's box
  else if (posInt(req.query.assignee)) { where.push('t.assigned_admin_id = ?'); params.push(posInt(req.query.assignee)); }
  const prio = oneOf(req.query.priority, TF.PRIORITIES); if (prio) { where.push('t.priority = ?'); params.push(prio); }
  const src = oneOf(req.query.source, TF.SOURCES); if (src) { where.push('t.source = ?'); params.push(src); }
  if (req.query.remind === 'due') { where.push('t.remind_on IS NOT NULL AND t.remind_on <= ?'); params.push(today); } // G14: reminders that have come up
  const due = oneOf(req.query.due, ['overdue', 'today', 'week', 'none', 'upto']);
  if (due === 'overdue') { where.push('t.due_on IS NOT NULL AND t.due_on < ?'); params.push(today); }
  if (due === 'today') { where.push('t.due_on = ?'); params.push(today); }
  if (due === 'week') { where.push('t.due_on IS NOT NULL AND t.due_on >= ? AND t.due_on <= ?'); params.push(today, S.addDays(today, 7)); }
  if (due === 'none') where.push('t.due_on IS NULL');
  // ?due=upto&days=N: everything due by the end of day N from today (0 = today), overdue included. The "Today and overdue" and "This week" views.
  if (due === 'upto') { where.push('t.due_on IS NOT NULL AND t.due_on <= ?'); params.push(S.addDays(today, Math.min(60, Math.max(0, Number(posInt(req.query.days)) || 0)))); }
  if (req.query.opportunityId !== undefined || req.query.accountId !== undefined || req.query.contactId !== undefined) {
    const f = S.listFilter(req.query, 't');
    if (f.error) return res.status(400).json({ error: f.error });
    where.push(f.where); params.push(...f.params);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM crm_tasks t ${w}`, params);
  // Open tasks by due date (none last); finished ones newest first.
  // G14: within one due date, High comes first. A database without the priority column yet falls back to the old order.
  const orderOld = state === 'done' ? 't.completed_at DESC, t.id DESC' : '(t.due_on IS NULL), t.due_on ASC, t.id ASC';
  const orderNew = state === 'done' ? orderOld : "(t.due_on IS NULL), t.due_on ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END, t.id ASC";
  let rows;
  try { [rows] = await pool.query(`${TASK_SELECT} ${w} ORDER BY ${orderNew} LIMIT ? OFFSET ?`, [...params, size, offset]); }
  catch (err) { if (!TF.isMissing(err)) throw err; [rows] = await pool.query(`${TASK_SELECT} ${w} ORDER BY ${orderOld} LIMIT ? OFFSET ?`, [...params, size, offset]); }
  const qn = await quoteNumbersFor(rows);
  let reminders = null;
  try { const [[r]] = await pool.query("SELECT COUNT(*) AS n FROM crm_tasks WHERE state = 'open' AND assigned_admin_id = ? AND remind_on IS NOT NULL AND remind_on <= ?", [req.crm.adminId, today]); reminders = Number(r.n || 0); }
  catch (err) { if (!TF.isMissing(err)) throw err; }

  // The numbers on the queue header always describe MY open tasks, whatever filter is on screen.
  const [[mine]] = await pool.query(
    `SELECT COUNT(*) AS open_n,
       SUM(CASE WHEN due_on IS NOT NULL AND due_on < ? THEN 1 ELSE 0 END) AS overdue_n,
       SUM(CASE WHEN due_on = ? THEN 1 ELSE 0 END) AS today_n
     FROM crm_tasks WHERE state = 'open' AND assigned_admin_id = ?`, [today, today, req.crm.adminId]);
  res.json({
    tasks: rows.map(t => taskView(t, req, today, qn)), total: Number(total), page, pageSize: size, today,
    summary: { open: Number(mine.open_n || 0), overdue: Number(mine.overdue_n || 0), dueToday: Number(mine.today_n || 0), reminders },
  });
});

// ---- Create and change ------------------------------------------------------------------------------------------------------------

// G12: the open tasks due inside a window of days, for the Calendar page (?from=YYYY-MM-DD&to=YYYY-MM-DD, at most 62 days, ?mine=true for tasks assigned to me). Done tasks are not
// on the calendar. At most 300 come back, and `truncated` says when there were more. Declared before the routes that take an id.
router.get('/calendar', requireAuth, requireCrm('view'), async (req, res) => {
  const from = dateOnly(req.query.from), to = dateOnly(req.query.to);
  if (!from || !to || to < from || S.addDays(from, 62) < to) return res.status(400).json({ error: 'Pick a window of up to two months.' });
  const where = ["t.state = 'open'", 't.due_on >= ?', 't.due_on <= ?'];
  const params = [from, to];
  if (req.query.mine === 'true') { where.push('t.assigned_admin_id = ?'); params.push(req.crm.adminId); }
  const [rows] = await pool.query(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.due_on, t.id LIMIT 301`, params);
  const today = S.todayFrom(req.query.today);
  const qn = await quoteNumbersFor(rows);
  res.json({ tasks: rows.slice(0, 300).map(t => taskView(t, req, today, qn)), truncated: rows.length > 300 });
});

router.post('/', requireAuth, requireCrm('write'), async (req, res) => {
  const b = req.body || {};
  const r = await S.resolveSubject(b);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!S.canWriteResolved(req, r.subject)) return res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
  const title = text(b.title, TASK_TITLE_MAX);
  if (!title) return res.status(400).json({ error: 'Say what needs doing.' });
  let dueOn = null;
  if (b.dueOn !== undefined && b.dueOn !== null && b.dueOn !== '') { dueOn = dateOnly(b.dueOn); if (!dueOn) return res.status(400).json({ error: 'The due date must be a real date (YYYY-MM-DD).' }); }
  const assignee = b.assignedAdminId === undefined ? req.crm.adminId : posInt(b.assignedAdminId);
  if (!assignee || !(await staffExists(assignee))) return res.status(400).json({ error: 'Pick a staff member to do it.' });
  const extra = await TF.clean(pool, b, { dueOn, dealId: r.subject.kind === 'opportunity' ? r.subject.id : null });
  if (extra.error) return res.status(400).json({ error: extra.error });
  const c = r.subject.cols;
  const insertTask = (fields) => {
    const xcols = Object.keys(fields);
    return pool.query(
      `INSERT INTO crm_tasks (opportunity_id, account_id, contact_id, title, details, due_on, state, assigned_admin_id, created_by_admin_id, created_at${xcols.map(k => `, ${k}`).join('')})
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?${xcols.map(() => ', ?').join('')})`,
      [c.opportunity_id, c.account_id, c.contact_id, title, text(b.details, TASK_DETAILS_MAX), dueOn, assignee, req.crm.adminId, sqlNow(), ...xcols.map(k => fields[k])]);
  };
  // The screens always send priority and a reminder. Before the alter scripts have run those columns are not there, and the task must still save: first without the time of day (the newest
  // columns), then without any of the extras.
  const attempts = fallbacks(extra.fields);
  let ins, saved = extra.fields;
  for (let i = 0; i < attempts.length; i++) {
    try { [ins] = await insertTask(attempts[i]); saved = attempts[i]; break; }
    catch (err) { if (!TF.isMissing(err) || i === attempts.length - 1) throw err; }
  }
  await crmAudit(req, { action: 'crm_task_created', entityType: 'crm_task', entityId: ins.insertId, next: { subject: r.subject.kind, subjectId: r.subject.id, assignedAdminId: assignee, dueOn, ...saved } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const t = await S.loadItem('crm_tasks', req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (!S.canWriteRow(req, t)) return res.status(403).json({ code: 'not_your_deal', error: 'This task is on a deal that belongs to someone else.' });
  const b = req.body || {};
  let f = {};
  if (b.title !== undefined) { f.title = text(b.title, TASK_TITLE_MAX); if (!f.title) return res.status(400).json({ error: 'Say what needs doing.' }); }
  if (b.details !== undefined) f.details = text(b.details, TASK_DETAILS_MAX);
  if (b.dueOn !== undefined) {
    f.due_on = b.dueOn === null || b.dueOn === '' ? null : dateOnly(b.dueOn);
    if (b.dueOn !== null && b.dueOn !== '' && !f.due_on) return res.status(400).json({ error: 'The due date must be a real date (YYYY-MM-DD).' });
  }
  if (b.assignedAdminId !== undefined) {
    f.assigned_admin_id = posInt(b.assignedAdminId);
    if (!f.assigned_admin_id || !(await staffExists(f.assigned_admin_id))) return res.status(400).json({ error: 'Pick a staff member to do it.' });
  }
  // G14: priority, reminder and quote. The reminder is checked against the due date this change leaves the task with; moving the due date earlier than a reminder pulls the reminder in with it.
  const newDue = f.due_on !== undefined ? f.due_on : (t.due_on ? String(t.due_on).slice(0, 10) : null);
  const extra = await TF.clean(pool, b, { dueOn: newDue, dealId: t.opportunity_id || null, existing: t });
  if (extra.error) return res.status(400).json({ error: extra.error });
  Object.assign(f, extra.fields);
  if (f.due_on && f.remind_on === undefined && t.remind_on && String(t.remind_on).slice(0, 10) > f.due_on) f.remind_on = f.due_on;
  const updateTask = (fields) => { const cs = Object.keys(fields); return pool.query(`UPDATE crm_tasks SET ${cs.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cs.map(k => fields[k]), t.id]); };
  let cols = Object.keys(f);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  // Same as adding: the edit dialog always sends priority and the reminder. Without the newer columns, save the rest: first without the time of day, then without any extras.
  const extraKeys = Object.keys(extra.fields);
  const ladder = [extraKeys, extraKeys.filter(k => !TF.TIME_COLUMNS.includes(k)), []].filter((ks, i, a) => i === 0 || ks.length !== a[i - 1].length);
  let saved = false;
  for (let i = 0; i < ladder.length && !saved; i++) {
    const attempt = { ...f };
    for (const k of extraKeys) if (!ladder[i].includes(k)) delete attempt[k];
    if (!Object.keys(attempt).length) return res.status(400).json({ error: 'Priority and reminders are not available yet. Ask the person who runs the site to run the task update.' });
    try { await updateTask(attempt); f = attempt; saved = true; }
    catch (err) { if (!TF.isMissing(err) || i === ladder.length - 1) throw err; }
  }
  cols = Object.keys(f);
  await crmAudit(req, { action: 'crm_task_updated', entityType: 'crm_task', entityId: t.id, prev: Object.fromEntries(cols.map(k => [k, t[k]])), next: f });
  res.json({ ok: true });
});

// Finishing or reopening a task: the person who can write the subject, or whoever the task is assigned to (it is their to-do), but never Read-only.
async function setState(req, res, to) {
  const t = await S.loadItem('crm_tasks', req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const mine = Number(t.assigned_admin_id) === Number(req.crm.adminId);
  if (!S.canWriteRow(req, t) && !mine) return res.status(403).json({ code: 'not_yours', error: 'This task is not assigned to you, and it is on a deal that belongs to someone else.' });
  if (t.state === to) return res.json({ ok: true, unchanged: true });
  const done = to === 'done';
  // Compare-and-set, so a double click or two people finishing the same task is one change and one audit row.
  const [u] = await pool.query('UPDATE crm_tasks SET state = ?, completed_at = ?, completed_by_admin_id = ? WHERE id = ? AND state = ?',
    [to, done ? sqlNow() : null, done ? req.crm.adminId : null, t.id, t.state]);
  if (!u.affectedRows) return res.json({ ok: true, unchanged: true });
  await crmAudit(req, { action: done ? 'crm_task_completed' : 'crm_task_reopened', entityType: 'crm_task', entityId: t.id, prev: { state: t.state }, next: { state: to } });
  res.json({ ok: true });
}
router.post('/:id/complete', requireAuth, requireCrm('write'), (req, res) => setState(req, res, 'done'));
router.post('/:id/reopen', requireAuth, requireCrm('write'), (req, res) => setState(req, res, 'open'));

router.delete('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const t = await S.loadItem('crm_tasks', req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (!S.canWriteRow(req, t)) return res.status(403).json({ code: 'not_your_deal', error: 'This task is on a deal that belongs to someone else.' });
  await pool.query('DELETE FROM crm_tasks WHERE id = ?', [t.id]);
  await crmAudit(req, { action: 'crm_task_deleted', entityType: 'crm_task', entityId: t.id, prev: { title: t.title, state: t.state } });
  res.json({ ok: true });
});

module.exports = router;
