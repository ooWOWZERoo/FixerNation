// Sales CRM timeline: what has happened with a contact, an account or a deal, newest first, 50 at a time (mounted at /api/crm/timeline).
// Read-only and open to every CRM role (the matrix: "view timelines: all"). The rules about what it may show (no student-level data, a demo shown only as "Demo",
// a quote never called "viewed") are kept in lib/crm-timeline.js.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { paging, posInt } = require('../lib/crm-common');
const { buildTimeline } = require('../lib/crm-timeline');

const router = express.Router();

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const named = [['contact', req.query.contactId], ['account', req.query.accountId], ['opportunity', req.query.opportunityId]].filter(([, v]) => v !== undefined && v !== '');
  if (named.length !== 1 || !posInt(named[0][1])) return res.status(400).json({ error: 'Say whose timeline this is: one contact, one account or one deal.' });
  const { page, size } = paging(req.query, { defaultSize: 50, maxSize: 50 });
  const result = await buildTimeline(pool, named[0][0], posInt(named[0][1]), { page, size });
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

module.exports = router;
