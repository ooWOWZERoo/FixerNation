// Sales-affiliate program — stage 4: the affiliate's own self-service view.
// Design and confirmed decisions: docs/AFFILIATE_PROGRAM_SPIKE.md,
// docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md.
//
// Separate mount (/api/affiliate-portal) and separate auth (requireSiteAuth,
// the fn_user_session cookie) from the admin-facing /api/affiliates/*
// (requireAuth, fn_session) — same split CLAUDE.md documents for every other
// self-service role (parent.js, school-admin.js). Never mix the two: an
// affiliate reading this router can only ever see their own row, joined on
// their own site_user id, never anyone else's — there is no :id in any path
// here for exactly that reason.
const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { LEDGER_TOTALS_SQL } = require('../lib/affiliate-attribution');
const { territoriesForAffiliate } = require('../lib/territories');

const router = express.Router();

// Every route below needs the caller's own `affiliates` row. Looked up once
// and attached to the request rather than repeating the same query in every
// handler.
//
// Deliberately does NOT gate on req.siteUser.role === 'affiliate'. A first
// cut did, and that was a real bug: role is a single column on site_users,
// and someone can be a district admin, a teacher, or a parent AND an
// affiliate at the same time — the same reason hasActiveSchoolAdminAssignment()
// checks school_license_admins directly instead of role (see its comment in
// lib/access.js). The affiliates row's existence is the actual entitlement,
// same as that table.
async function loadOwnAffiliate(req, res, next) {
  const [[affiliate]] = await pool.query('SELECT * FROM affiliates WHERE site_user_id = ?', [req.siteUser.id]);
  if (!affiliate) {
    return res.status(404).json({ error: 'No affiliate account found for this login.' });
  }
  req.affiliate = affiliate;
  next();
}

// GET /api/affiliate-portal/me — everything the dashboard's header needs.
router.get('/me', requireSiteAuth, loadOwnAffiliate, async (req, res) => {
  const affiliate = req.affiliate;
  const siteUrl = process.env.SITE_URL || '';

  const [territories, [totalsRows]] = await Promise.all([
    territoriesForAffiliate(affiliate.id),
    pool.query(`${LEDGER_TOTALS_SQL} WHERE affiliate_id = ?`, [affiliate.id]),
  ]);

  res.json({
    firstName: req.siteUser.first_name,
    lastName: req.siteUser.last_name,
    email: req.siteUser.email,
    referralCode: affiliate.referral_code,
    referralLink: `${siteUrl}/school-licensing.html?ref=${affiliate.referral_code}`,
    commissionRate: Number(affiliate.commission_rate),
    status: affiliate.status,
    approvedAt: affiliate.approved_at,
    territories: territories
      .filter(t => t.status === 'active')
      .map(t => ({ id: t.territory_id, name: t.name })),
    totals: totalsRows[0],
  });
});

// GET /api/affiliate-portal/commissions?status= — the affiliate's own ledger,
// never anyone else's. Same status vocabulary as the admin ledger, but this
// endpoint is read-only: an affiliate can see the state of their own
// commissions, not change it.
router.get('/commissions', requireSiteAuth, loadOwnAffiliate, async (req, res) => {
  const status = (req.query.status || '').trim();
  const where = ['ac.affiliate_id = ?'];
  const params = [req.affiliate.id];

  if (['pending', 'approved', 'paid', 'on_hold', 'reversed'].includes(status)) {
    where.push('ac.status = ?');
    params.push(status);
  }

  const [rows] = await pool.query(
    `SELECT ac.id, ac.status, ac.source_type, ac.description, ac.gross_amount_cents,
            ac.commission_rate, ac.commission_cents, ac.created_at, ac.approved_at, ac.paid_at,
            p.product_type, p.purchased_at, p.school_domain,
            lp.name AS plan_name
     FROM affiliate_commissions ac
     LEFT JOIN purchases p ON p.id = ac.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE ${where.join(' AND ')}
     ORDER BY ac.created_at DESC
     LIMIT 300`,
    params
  );

  res.json({ commissions: rows });
});

module.exports = router;
