// A district administrator asks to RENEW a license as it is or CHANGE its seat count (punch list G5, mounted at /api/district-admin/repeat, before the general district-admin router).
// Matrix and rules: docs/reference/crm-g5-repeat-order-requirements.md. Every handler resolves the district from req.districtAdmin.districts, never from a bare id; another district's
// license or request is 404. The request only asks: it never buys, prices, sends a quote or changes a license (lib/crm-repeat-requests.js has the rules). Staff are told by email.
const express = require('express');
const { requireDistrictAdmin } = require('../middleware/districtAdminAuth');
const { limiter } = require('../lib/rate-limit');
const { getSetting } = require('../lib/settings');
const R = require('../lib/crm-repeat-requests');
const mailer = require('../lib/mailer');
const pool = require('../db/pool');

const router = express.Router();
router.use(requireDistrictAdmin);

const writes = limiter({ name: 'district-repeat-write', windowMs: 60 * 1000, max: 10, key: (req) => 'u' + req.districtAdmin.siteUserId });
const reads = limiter({ name: 'district-repeat-read', windowMs: 60 * 1000, max: 60, key: (req) => 'u' + req.districtAdmin.siteUserId });

const nowText = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const todayText = () => new Date().toISOString().slice(0, 10);
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const fail = (res, err) => {
  if (err instanceof R.Refusal) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  throw err;
};

// GET /api/district-admin/repeat?districtId=  (the first district when none is given)
router.get('/', reads, async (req, res) => {
  const wanted = req.query.districtId === undefined ? req.districtAdmin.districtIds[0] : Number(req.query.districtId);
  const district = req.districtAdmin.districts.find(d => Number(d.district_id) === Number(wanted));
  if (!district) return res.status(404).json({ error: 'Not found.' });
  try {
    const data = await R.overview(pool, Number(district.district_id), todayText());
    res.json({ districtId: Number(district.district_id), districtName: district.district_name, ...data });
  } catch (err) { fail(res, err); }
});

router.post('/', writes, async (req, res) => {
  let made;
  try {
    const b = body(req);
    made = await R.createRequest(pool, req.districtAdmin, { ...b, districtId: b.districtId === undefined ? req.districtAdmin.districtIds[0] : b.districtId }, { now: nowText(), today: todayText() });
  } catch (err) { return fail(res, err); }
  // Tell staff. A failed email never fails the request: it is also on the Needs Attention page.
  try {
    const siteUrl = (process.env.SITE_URL || 'https://fixernationeducation.com').replace(/\/$/, '');
    await mailer.sendSalesAlertEmail({
      to: await getSetting('contact_email_sales_alerts'),
      subject: made.kind === 'renew' ? 'A district asked to renew a license' : 'A district asked to change seats',
      fields: {
        District: made.districtName, School: made.schoolName,
        Request: made.kind === 'renew' ? 'Renew as it is' : `Change from ${made.currentSeats === null ? 'an unknown number of' : made.currentSeats} to ${made.requestedSeats} seats`,
      },
      linkUrl: siteUrl + '/admin-crm-repeat-requests.html', linkLabel: 'Open Reorder requests',
    });
  } catch (err) { console.error('repeat request: staff notice failed:', err.message); }
  res.status(201).json({ ok: true, id: made.id });
});

router.post('/:id/cancel', writes, async (req, res) => {
  try { res.json({ ok: true, ...(await R.cancelRequest(pool, req.districtAdmin, req.params.id, { now: nowText() })) }); } catch (err) { fail(res, err); }
});

module.exports = router;
