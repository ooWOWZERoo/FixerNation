// Support requests, the staff inbox (Release 115). The person's side: routes/support.js.
// Requirements and access matrix: docs/reference/support-requests-requirements.md
//
//   GET  /api/admin/support?status=&category=&q=   list (with counts per status)
//   GET  /api/admin/support/admins                 admin accounts, for "assigned to"
//   GET  /api/admin/support/:id                    one request with every message, notes included
//   PUT  /api/admin/support/:id                    status and/or assigned admin
//   GET  /api/admin/support/summary                how many are new / open / waiting (the badge on the menu link)
//   POST /api/admin/support/:id/messages           a reply the person reads on the Get help page, or an internal note
//
// Every route is requireAuth (the admin account). Every change is written to the audit log by id only, never with the message text.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const { CATEGORIES, STATUSES, LIMITS, cleanText, addMessage } = require('../lib/support');
const { invitationLabels } = require('../lib/public-demo-admin');

const router = express.Router();

function auditStaff(req, action, row, extra = {}) {
  return audit(pool, {
    actorType: 'admin', actorId: req.user && req.user.userId, action,
    entityType: 'support_request', entityId: row.id, schoolDomain: row.school_domain || null,
    reason: row.ref, ipAddress: clientIp(req), ...extra,
  });
}

function validId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(404).json({ error: 'Not found' }); return null; }
  return id;
}

// GET /api/admin/support
router.get('/', requireAuth, async (req, res) => {
  const where = [];
  const params = [];
  const status = typeof req.query.status === 'string' ? req.query.status : 'active';
  if (STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }
  else if (status === 'active') where.push("r.status <> 'resolved'");
  if (typeof req.query.category === 'string' && CATEGORIES[req.query.category]) { where.push('r.category = ?'); params.push(req.query.category); }
  // Only the requests from one group's demo (the Demo page links here): ?demo=<invitation id>
  const demoId = /^\d{1,9}$/.test(String(req.query.demo || '')) ? Number(req.query.demo) : 0;
  if (demoId) { where.push('r.demo_invitation_id = ?'); params.push(demoId); }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    where.push('(r.ref LIKE ? OR r.requester_email LIKE ? OR r.requester_name LIKE ? OR r.subject LIKE ? OR r.school_domain LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT r.id, r.ref, r.status, r.category, r.subject, r.requester_name, r.requester_email, r.roles, r.school_domain,
            r.assigned_admin_id, a.username AS assigned_to, r.created_at, r.updated_at, r.demo_window, r.demo_invitation_id
     FROM support_requests r LEFT JOIN admin_users a ON a.id = r.assigned_admin_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.updated_at DESC, r.id DESC LIMIT 300`,
    params
  );
  // The status counts follow the one-group view when there is one.
  const [countRows] = await pool.query(`SELECT status, COUNT(*) AS n FROM support_requests ${demoId ? 'WHERE demo_invitation_id = ?' : ''} GROUP BY status`, demoId ? [demoId] : []);
  const counts = { new: 0, open: 0, waiting_on_user: 0, resolved: 0 };
  for (const c of countRows) if (c.status in counts) counts[c.status] = Number(c.n);
  // The group behind each request that came from a group's demo (staff only), for the "Demo: <name>" tag.
  const labels = await invitationLabels(pool, rows.map(r => r.demo_invitation_id));
  res.json({
    requests: rows.map(r => ({ ...r, categoryLabel: CATEGORIES[r.category] || CATEGORIES.other, demo_label: r.demo_invitation_id > 0 ? (labels[Number(r.demo_invitation_id)] || null) : null })),
    counts, categories: CATEGORIES,
    demoFilter: demoId ? { id: demoId, label: (await invitationLabels(pool, [demoId]))[demoId] || null } : null,
  });
});

// GET /api/admin/support/summary -- declared before '/:id' so "summary" is not read as an id
router.get('/summary', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT status, COUNT(*) AS n FROM support_requests GROUP BY status');
  const out = { new: 0, open: 0, waiting_on_user: 0, resolved: 0 };
  for (const r of rows) if (r.status in out) out[r.status] = Number(r.n);
  res.json(out);
});

// GET /api/admin/support/admins -- declared before '/:id' so "admins" is not read as an id
router.get('/admins', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username FROM admin_users ORDER BY username');
  res.json({ admins: rows });
});

// GET /api/admin/support/:id
router.get('/:id', requireAuth, async (req, res) => {
  const id = validId(req, res);
  if (!id) return;
  const [[row]] = await pool.query(
    `SELECT r.*, a.username AS assigned_to, d.name AS district_name
     FROM support_requests r
     LEFT JOIN admin_users a ON a.id = r.assigned_admin_id
     LEFT JOIN districts d ON d.id = r.district_id
     WHERE r.id = ?`, [id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const [messages] = await pool.query(
    `SELECT m.id, m.author_type, m.visibility, m.body, m.created_at, a.username AS admin_name
     FROM support_request_messages m LEFT JOIN admin_users a ON a.id = m.author_admin_id
     WHERE m.request_id = ? ORDER BY m.created_at, m.id`, [id]);
  const demoLabel = row.demo_invitation_id > 0 ? ((await invitationLabels(pool, [row.demo_invitation_id]))[Number(row.demo_invitation_id)] || null) : null;
  res.json({ request: { ...row, categoryLabel: CATEGORIES[row.category] || CATEGORIES.other, demo_label: demoLabel }, messages });
});

// PUT /api/admin/support/:id -- body: { status?, assignedAdminId? (number, or null to unassign) }
router.put('/:id', requireAuth, async (req, res) => {
  const id = validId(req, res);
  if (!id) return;
  const [[row]] = await pool.query('SELECT id, ref, status, assigned_admin_id, school_domain FROM support_requests WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) return res.status(400).json({ error: 'Unknown status' });
    if (body.status !== row.status) {
      await pool.query(
        `UPDATE support_requests SET status = ?, resolved_at = ${body.status === 'resolved' ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`,
        [body.status, id]
      );
      await auditStaff(req, 'support_status_changed', row, { prevValue: { status: row.status }, newValue: { status: body.status } });
    }
  }
  if (body.assignedAdminId !== undefined) {
    let adminId = null;
    if (body.assignedAdminId !== null) {
      adminId = Number(body.assignedAdminId);
      if (!Number.isInteger(adminId) || adminId < 1) return res.status(400).json({ error: 'Unknown admin' });
      const [[a]] = await pool.query('SELECT id FROM admin_users WHERE id = ?', [adminId]);
      if (!a) return res.status(400).json({ error: 'Unknown admin' });
    }
    if (adminId !== row.assigned_admin_id) {
      await pool.query('UPDATE support_requests SET assigned_admin_id = ? WHERE id = ?', [adminId, id]);
      await auditStaff(req, 'support_assigned', row, { prevValue: { adminId: row.assigned_admin_id }, newValue: { adminId } });
    }
  }
  res.json({ ok: true });
});

// POST /api/admin/support/:id/messages -- body: { body, visibility: 'public' | 'internal', status? }
// 'public' is shown to the person on the Get help page (signed-in people see a "New reply" tag; others look it up with their reference
// and email). Nothing is emailed: the owner prefers updates to be read on the page. 'internal' is a staff note nobody outside the admin sees.
router.post('/:id/messages', requireAuth, async (req, res) => {
  const id = validId(req, res);
  if (!id) return;
  const [[row]] = await pool.query('SELECT id, ref, status, school_domain FROM support_requests WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const body = req.body || {};
  const text = cleanText(body.body, LIMITS.message);
  if (!text) return res.status(400).json({ error: 'Write something first.' });
  const visibility = body.visibility === 'internal' ? 'internal' : 'public';
  let newStatus = null;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) return res.status(400).json({ error: 'Unknown status' });
    newStatus = body.status;
  }

  await addMessage(id, { authorType: 'staff', adminId: req.user && req.user.userId, visibility, body: text });

  // A reply the person can see waits on them unless staff chose another status; a note only moves a brand-new request to open.
  if (!newStatus) newStatus = visibility === 'public' ? 'waiting_on_user' : (row.status === 'new' ? 'open' : row.status);
  if (newStatus !== row.status) {
    await pool.query(
      `UPDATE support_requests SET status = ?, resolved_at = ${newStatus === 'resolved' ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`,
      [newStatus, id]
    );
  } else {
    await pool.query('UPDATE support_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  }
  await auditStaff(req, visibility === 'public' ? 'support_reply_sent' : 'support_note_added', row, { newValue: { status: newStatus } });
  res.json({ ok: true, status: newStatus });
});

module.exports = router;
