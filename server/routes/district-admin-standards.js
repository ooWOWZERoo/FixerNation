const express = require('express');
const ds = require('../lib/district-standards');
const { requireDistrictAdmin } = require('../middleware/districtAdminAuth');
const { limiter } = require('../lib/rate-limit');
const { getSetting } = require('../lib/settings');
const { DEMO_DISTRICT_NAME } = require('../lib/sales-demo');

// A district admin records their OWN district's Portrait of a Graduate / SEL framework.
// Mounted at /api/district-admin/standards. Every handler passes req.districtAdmin.districtIds
// to lib/district-standards.js, which resolves every id through the framework's district_id --
// this file never trusts a district or framework id from the URL or body on its own.
// Nothing here can verify or publish: that is the FNE-admin routes in admin-standards.js.
// See docs/standards-crosswalk/DISTRICT-FRAMEWORKS-REQUIREMENTS.md.
const router = express.Router();
router.use(requireDistrictAdmin);

const writes = limiter({ name: 'district-standards-write', windowMs: 60 * 1000, max: 40, key: (req) => 'u' + req.districtAdmin.siteUserId });
const reads = limiter({ name: 'district-standards-read', windowMs: 60 * 1000, max: 120, key: (req) => 'u' + req.districtAdmin.siteUserId });

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res) ?? { ok: true }); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); throw err; }
};
const ids = (req) => req.districtAdmin.districtIds;
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

router.get('/', reads, wrap((req) => ds.listOwn(ids(req), req.query.districtId ?? ids(req)[0])));
router.get('/targets', reads, wrap(() => ds.listTargets()));

router.post('/frameworks', writes, wrap((req) => ds.createOwn(ids(req), body(req).districtId, body(req), req.districtAdmin.siteUserId)));
router.put('/frameworks/:id', writes, wrap((req) => ds.updateOwn(ids(req), req.params.id, body(req))));
router.delete('/frameworks/:id', writes, wrap(async (req) => { await ds.deleteOwn(ids(req), req.params.id); }));
router.put('/frameworks/:id/items', writes, wrap((req) => ds.upsertItemsOwn(ids(req), req.params.id, body(req).items)));
router.delete('/items/:id', writes, wrap(async (req) => { await ds.deleteItemOwn(ids(req), req.params.id); }));

router.put('/connections', writes, wrap((req) => ds.suggestConnection(ids(req), req.districtAdmin.siteUserId, body(req))));
router.delete('/connections/:id', writes, wrap(async (req) => { await ds.removeSuggestion(ids(req), req.params.id); }));

router.post('/frameworks/:id/withdraw', writes, wrap(async (req) => { await ds.withdrawOwn(ids(req), req.params.id); }));
router.post('/frameworks/:id/submit', writes, wrap(async (req) => {
  const sub = await ds.submitOwn(ids(req), req.districtAdmin.siteUserId, req.params.id, body(req));
  // Short staff notice. The demo district never notifies anyone, and a failed email never fails the submit.
  if (sub.districtName !== DEMO_DISTRICT_NAME) {
    try {
      const { sendSalesAlertEmail } = require('../lib/mailer');
      const siteUrl = (process.env.SITE_URL || 'https://fixernationeducation.com').replace(/\/$/, '');
      await sendSalesAlertEmail({
        to: await getSetting('contact_email_sales_alerts'),
        subject: 'District framework submitted for review',
        fields: {
          District: sub.districtName, Framework: sub.name, State: sub.stateCode, Standards: String(sub.itemCount),
          'Submitted by': `${req.districtAdmin.firstName || ''} ${req.districtAdmin.lastName || ''} <${req.districtAdmin.email}>`.trim(),
        },
        linkUrl: siteUrl + '/admin-standards.html', linkLabel: 'Open the review queue',
      });
    } catch (err) { console.error('district-standards: submit notice failed:', err.message); }
  }
  return { ok: true, id: sub.id };
}));

module.exports = router;
