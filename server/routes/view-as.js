// The staff "view as" tab's own two routes (phase C of docs/reference/help-support-tools-requirements.md, section C). They are reachable only through
// lib/view-as.js, which has already checked the token, the same admin's live session, the CRM role and the person; anything else gets 401 here.
//
//   GET  /api/view-as/status   who is being viewed and how long is left (the banner)
//   POST /api/view-as/end      end this view (the only write a view may make)
const express = require('express');
const pool = require('../db/pool');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');

const router = express.Router();

router.get('/status', (req, res) => {
  if (!req.viewAs) return res.status(401).json({ active: false });
  res.json({ active: true, firstName: req.viewAs.firstName, roles: req.viewAs.roles, expiresAt: req.viewAs.expiresAt });
});

router.post('/end', async (req, res) => {
  if (!req.viewAs) return res.status(401).json({ active: false });
  await pool.query('UPDATE view_as_sessions SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL', [new Date(), 'stop', req.viewAs.sessionId]);
  await audit(pool, { actorType: 'admin', actorId: req.viewAs.adminId, action: 'view_as_ended', entityType: 'site_user', entityId: req.viewAs.siteUserId, reason: 'stop', ipAddress: clientIp(req) });
  res.json({ ok: true });
});

module.exports = router;
