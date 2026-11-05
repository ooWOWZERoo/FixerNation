// Support requests, the staff inbox (Release 115). The person's side: routes/support.js.
// Requirements and access matrix: docs/reference/support-requests-requirements.md
//
//   GET  /api/admin/support?status=&category=&q=   list (with counts per status)
//   GET  /api/admin/support/admins                 admin accounts, for "assigned to"
//   GET  /api/admin/support/:id                    one request with every message, notes included
//   PUT  /api/admin/support/:id                    status and/or assigned admin
//   POST /api/admin/support/:id/messages           a reply to the person (emailed) or an internal note
//
// Every route is requireAuth (the admin account). Every change is written to the audit log by id only, never with the message text.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const { getSetting } = require('../lib/settings');
const { sendSupportEmail } = require('../lib/mailer');
const { CATEGORIES, STATUSES, LIMITS, cleanText, addMessage } = require('../lib/support');

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
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    where.push('(r.ref LIKE ? OR r.requester_email LIKE ? OR r.requester_name LIKE ? OR r.subject LIKE ? OR r.school_domain LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT r.id, r.ref, r.status, r.category, r.subject, r.requester_name, r.requester_email, r.roles, r.school_domain,
            r.assigned_admin_id, a.username AS assigned_to, r.created_at, r.updated_at
     FROM support_requests r LEFT JOIN admin_users a ON a.id = r.assigned_admin_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.updated_at DESC, r.id DESC LIMIT 300`,
    params
  );
  const [countRows] = await pool.query('SELECT status, COUNT(*) AS n FROM support_requests GROUP BY status');
  const counts = { new: 0, open: 0, waiting_on_user: 0, resolved: 0 };
  for (const c of countRows) if (c.status in counts) counts[c.status] = Number(c.n);
  res.json({ requests: rows.map(r => ({ ...r, categoryLabel: CATEGORIES[r.category] || CATEGORIES.other })), counts, categories: CATEGORIES });
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
  res.json({ request: { ...row, categoryLabel: CATEGORIES[row.category] || CATEGORIES.other }, messages });
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
// 'public' is emailed to the person (and shown in their "My requests"); 'internal' is a staff note nobody outside the admin sees.
router.post('/:id/messages', requireAuth, async (req, res) => {
  const id = validId(req, res);
  if (!id) return;
  const [[row]] = await pool.query(
    'SELECT id, ref, status, subject, requester_name, requester_email, site_user_id, school_domain FROM support_requests WHERE id = ?', [id]);
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

  let emailed = false;
  let emailError = null;
  if (visibility === 'public') {
    try {
      await sendSupportEmail({
        to: row.requester_email, name: row.requester_name, ref: row.ref, subject: `Re: ${row.subject}`,
        intro: 'Fixer Nation support replied to your request:',
        body: text,
        replyTo: await getSetting('contact_email_support'),
        linkUrl: row.site_user_id ? `${process.env.SITE_URL || ''}/support.html` : null,
        linkLabel: 'See your requests',
      });
      emailed = true;
    } catch (err) {
      console.error('support: reply email failed:', err.message);
      emailError = 'The reply is saved, but the email could not be sent. Check the mail settings.';
    }
  }
  res.json({ ok: true, emailed, emailError, status: newStatus });
});

module.exports = router;
