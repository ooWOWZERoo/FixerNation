// Staff "view as", the admin side (phase C of docs/reference/help-support-tools-requirements.md, section C).
//
//   POST /api/admin/view-as/start             { siteUserId, reason }  start a view of a teacher, school administrator or district administrator
//   POST /api/admin/view-as/end               end this admin's open view
//   GET  /api/admin/view-as/history/:userId   who viewed this account, when, and why (CRM Admin)
//
// Every route is requireAuth plus requireCrmRole('view_as') (CRM Admin only). The viewing tab itself talks to routes/view-as.js. The reason is kept in
// view_as_sessions, never in the audit log; the audit log gets ids only (view_as_started, view_as_ended).
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrmRole } = require('../lib/crm-permissions');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const V = require('../lib/view-as');

const router = express.Router();

function auditView(req, action, siteUserId, extra = {}) {
  return audit(pool, { actorType: 'admin', actorId: req.user && req.user.userId, action, entityType: 'site_user', entityId: siteUserId || null, ipAddress: clientIp(req), ...extra });
}

router.post('/start', requireAuth, requireCrmRole('view_as'), async (req, res) => {
  const b = req.body || {};
  const siteUserId = Number(b.siteUserId);
  if (!Number.isInteger(siteUserId) || siteUserId < 1) return res.status(400).json({ error: 'Pick the account to view.' });
  const reason = V.cleanReason(b.reason);
  if (reason.length < V.REASON_MIN) return res.status(400).json({ error: `Write a reason of at least ${V.REASON_MIN} characters (for example the support request number).` });
  const adminId = req.user.userId;
  const [[adminRow]] = await pool.query('SELECT email FROM admin_users WHERE id = ?', [adminId]);
  const [[user]] = await pool.query('SELECT * FROM site_users WHERE id = ?', [siteUserId]);
  const target = await V.describeTarget(user, adminRow && adminRow.email);
  if (!target.ok) return res.status(400).json({ error: target.why });
  const { token, expiresAt } = await V.startSession({ adminId, user, reason });
  await auditView(req, 'view_as_started', user.id);
  res.json({ token, expiresAt, landing: target.landing, person: { firstName: user.first_name, roles: target.roles }, minutes: V.SESSION_MINUTES });
});

router.post('/end', requireAuth, requireCrmRole('view_as'), async (req, res) => {
  const n = await V.endSessionsFor(req.user.userId, 'stop');
  if (n) await auditView(req, 'view_as_ended', null, { reason: 'stop' });
  res.json({ ok: true, ended: n });
});

router.get('/history/:userId', requireAuth, requireCrmRole('view_as'), async (req, res) => {
  const id = Number(req.params.userId);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Not found' });
  const [rows] = await pool.query(
    `SELECT v.id, v.reason, v.started_at, v.ended_at, v.ended_by, a.username AS staff
     FROM view_as_sessions v LEFT JOIN admin_users a ON a.id = v.admin_id
     WHERE v.target_site_user_id = ? ORDER BY v.id DESC LIMIT 20`, [id]);
  res.json({ views: rows.map(r => ({ id: r.id, staff: r.staff || 'removed admin', reason: r.reason, startedAt: r.started_at, endedAt: r.ended_at, endedBy: r.ended_by })) });
});

module.exports = router;
