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
const S = require('../lib/crm-subjects');

const router = express.Router();

const TASK_SELECT = `SELECT t.*, ${S.SUBJECT_COLS}, au.username AS assignee_name, cu.username AS creator_name
  FROM crm_tasks t ${S.SUBJECT_JOIN('t')}
  LEFT JOIN admin_users au ON au.id = t.assigned_admin_id
  LEFT JOIN admin_users cu ON cu.id = t.created_by_admin_id`;

function taskView(t, req, today) {
  const mine = req.crm.role !== 'readonly' && Number(t.assigned_admin_id) === Number(req.crm.adminId);
  const writable = S.canWriteRow(req, t);
  return {
    id: t.id, title: t.title, details: t.details || null, dueOn: t.due_on || null, state: t.state,
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
  const order = state === 'done' ? 't.completed_at DESC, t.id DESC' : '(t.due_on IS NULL), t.due_on ASC, t.id ASC';
  const [rows] = await pool.query(`${TASK_SELECT} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, size, offset]);

  // The numbers on the queue header always describe MY open tasks, whatever filter is on screen.
  const [[mine]] = await pool.query(
    `SELECT COUNT(*) AS open_n,
       SUM(CASE WHEN due_on IS NOT NULL AND due_on < ? THEN 1 ELSE 0 END) AS overdue_n,
       SUM(CASE WHEN due_on = ? THEN 1 ELSE 0 END) AS today_n
     FROM crm_tasks WHERE state = 'open' AND assigned_admin_id = ?`, [today, today, req.crm.adminId]);
  res.json({
    tasks: rows.map(t => taskView(t, req, today)), total: Number(total), page, pageSize: size, today,
    summary: { open: Number(mine.open_n || 0), overdue: Number(mine.overdue_n || 0), dueToday: Number(mine.today_n || 0) },
  });
});

// ---- Create and change ------------------------------------------------------------------------------------------------------------

router.post('/', requireAuth, requireCrm('write'), async (req, res) => {
  const b = req.body || {};
  const r = await S.resolveSubject(b);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!S.canWriteResolved(req, r.subject)) return res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
  const title = text(b.title, 255);
  if (!title) return res.status(400).json({ error: 'Say what needs doing.' });
  let dueOn = null;
  if (b.dueOn !== undefined && b.dueOn !== null && b.dueOn !== '') { dueOn = dateOnly(b.dueOn); if (!dueOn) return res.status(400).json({ error: 'The due date must be a real date (YYYY-MM-DD).' }); }
  const assignee = b.assignedAdminId === undefined ? req.crm.adminId : posInt(b.assignedAdminId);
  if (!assignee || !(await staffExists(assignee))) return res.status(400).json({ error: 'Pick a staff member to do it.' });
  const c = r.subject.cols;
  const [ins] = await pool.query(
    `INSERT INTO crm_tasks (opportunity_id, account_id, contact_id, title, details, due_on, state, assigned_admin_id, created_by_admin_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [c.opportunity_id, c.account_id, c.contact_id, title, text(b.details, 1000), dueOn, assignee, req.crm.adminId, sqlNow()]);
  await crmAudit(req, { action: 'crm_task_created', entityType: 'crm_task', entityId: ins.insertId, next: { subject: r.subject.kind, subjectId: r.subject.id, assignedAdminId: assignee, dueOn } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const t = await S.loadItem('crm_tasks', req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (!S.canWriteRow(req, t)) return res.status(403).json({ code: 'not_your_deal', error: 'This task is on a deal that belongs to someone else.' });
  const b = req.body || {};
  const f = {};
  if (b.title !== undefined) { f.title = text(b.title, 255); if (!f.title) return res.status(400).json({ error: 'Say what needs doing.' }); }
  if (b.details !== undefined) f.details = text(b.details, 1000);
  if (b.dueOn !== undefined) {
    f.due_on = b.dueOn === null || b.dueOn === '' ? null : dateOnly(b.dueOn);
    if (b.dueOn !== null && b.dueOn !== '' && !f.due_on) return res.status(400).json({ error: 'The due date must be a real date (YYYY-MM-DD).' });
  }
  if (b.assignedAdminId !== undefined) {
    f.assigned_admin_id = posInt(b.assignedAdminId);
    if (!f.assigned_admin_id || !(await staffExists(f.assigned_admin_id))) return res.status(400).json({ error: 'Pick a staff member to do it.' });
  }
  const cols = Object.keys(f);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  await pool.query(`UPDATE crm_tasks SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map(k => f[k]), t.id]);
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
