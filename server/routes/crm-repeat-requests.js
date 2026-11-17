// Sales CRM: district reorder and seat-change requests (punch list G5, mounted at /api/crm/repeat-requests). Staff side only; the district administrator's side is routes/district-admin-repeat.js.
// Who may do what (matrix in docs/reference/crm-g5-repeat-order-requirements.md): everyone with a CRM role sees the list (Read-only gets no asker name); a CRM Admin, or the Sales user who owns the
// request's deal, approves or declines. Approving makes a task to draft the quote; it never prices, sends or creates a quote, purchase, invoice or license (lib/crm-repeat-requests.js).
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const R = require('../lib/crm-repeat-requests');
const { sqlNow } = require('../lib/crm-classification');
const { oneOf, paging } = require('../lib/crm-common');
const mailer = require('../lib/mailer');

const router = express.Router();
const today = () => sqlNow().slice(0, 10);
const fail = (res, err) => {
  if (err instanceof R.Refusal) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  throw err;
};

// ?state=waiting (default)|approved|declined|cancelled|all
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size } = paging(req.query);
  const state = req.query.state === 'all' ? null : (oneOf(req.query.state, R.STATES) || 'waiting');
  try {
    const out = await R.listForStaff(pool, { state, page, pageSize: size, role: req.crm.role, today: today() });
    res.json({ ...out, page, pageSize: size, canDecide: req.crm.role === 'admin' || req.crm.role === 'sales', adminId: req.crm.adminId, role: req.crm.role });
  } catch (err) { fail(res, err); }
});

async function decide(req, res, action) {
  try {
    const out = await R.decide(pool, req.params.id, action, { adminId: req.crm.adminId, role: req.crm.role, note: (req.body || {}).note, now: sqlNow(), today: today() });
    // A decline is told to the person who asked (counts and the staff note only). A failed email never undoes the decision.
    if (action === 'decline' && out.askerEmail) {
      try {
        const siteUrl = (process.env.SITE_URL || 'https://fixernationeducation.com').replace(/\/$/, '');
        await mailer.sendRepeatRequestDeclinedEmail({ to: out.askerEmail, firstName: out.askerFirst, districtName: out.districtName, schoolName: out.schoolName, note: out.decisionNote, portalUrl: siteUrl + '/district-admin-renew.html' });
      } catch (err) { console.error('repeat request: decline email failed:', err.message); }
    }
    res.json({ ok: true, id: out.id, state: out.state, taskId: out.taskId });
  } catch (err) { fail(res, err); }
}
router.post('/:id/approve', requireAuth, requireCrm('decide_repeat'), (req, res) => decide(req, res, 'approve'));
router.post('/:id/decline', requireAuth, requireCrm('decide_repeat'), (req, res) => decide(req, res, 'decline'));

module.exports = router;
