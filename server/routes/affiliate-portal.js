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
const { territoriesForAffiliate, isValidStateCode, canonicalCountyName, stateName } = require('../lib/territories');
const { audit } = require('../lib/audit');
const { fireAutomation } = require('../lib/automations');

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

  const [territories, [totalsRows], [pendingRows]] = await Promise.all([
    territoriesForAffiliate(affiliate.id),
    pool.query(`${LEDGER_TOTALS_SQL} WHERE affiliate_id = ?`, [affiliate.id]),
    pool.query(`SELECT * FROM territory_requests WHERE affiliate_id = ? AND status = 'pending' LIMIT 1`, [affiliate.id]),
  ]);
  const pending = pendingRows[0];

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
      .map(t => ({ id: t.territory_id, assignmentId: t.assignment_id, name: t.name })),
    totals: totalsRows[0],
    pendingTerritoryRequest: pending ? {
      id: pending.id,
      requestType: pending.request_type,
      requestedState: pending.requested_state,
      requestedCounty: pending.requested_county,
    } : null,
  });
});

// GET /api/affiliate-portal/territories/requests — the affiliate's own
// request history (not just the pending one — includes past approvals and
// rejections, so they can see what happened to a decided request).
router.get('/territories/requests', requireSiteAuth, loadOwnAffiliate, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM territory_requests WHERE affiliate_id = ? ORDER BY created_at DESC`,
    [req.affiliate.id]
  );
  res.json({
    requests: rows.map(r => ({
      id: r.id,
      requestType: r.request_type,
      requestedState: r.requested_state,
      requestedCounty: r.requested_county,
      status: r.status,
      rejectionReason: r.rejection_reason,
      createdAt: r.created_at,
    })),
  });
});

// POST /api/affiliate-portal/territories/request — submit a new territory
// request. Never touches affiliate_territories itself; every request needs
// admin approval (POST /api/affiliates/territory-requests/:id/approve),
// including a first-ever ("initial") territory.
router.post('/territories/request', requireSiteAuth, loadOwnAffiliate, async (req, res) => {
  // Not an explicit business rule from the spec — a suspended affiliate
  // already has every territory revoked (see the suspend cascade in
  // affiliates.js), so blocking a new request here is the conservative
  // default rather than letting one gain a fresh territory while suspended.
  if (req.affiliate.status !== 'active') {
    return res.status(403).json({ error: 'Your affiliate account is currently suspended.' });
  }

  const b = req.body || {};
  const state = (b.state || '').trim().toUpperCase();
  const requestedType = (b.requestType || '').trim();

  if (!isValidStateCode(state)) return res.status(400).json({ error: `"${b.state}" is not a US state or DC` });
  const county = canonicalCountyName(state, b.county);
  if (!county) return res.status(400).json({ error: `"${b.county}" is not a real county in ${stateName(state) || state}` });

  const [[pending]] = await pool.query(
    `SELECT id FROM territory_requests WHERE affiliate_id = ? AND status = 'pending' LIMIT 1`,
    [req.affiliate.id]
  );
  if (pending) {
    return res.status(409).json({ error: 'You already have a territory request pending review. Wait for a decision on that one before submitting another.' });
  }

  const currentTerritories = (await territoriesForAffiliate(req.affiliate.id)).filter(t => t.status === 'active');

  let requestType, previousAssignmentId = null;
  if (requestedType === 'change') {
    const assignmentId = Number(b.previousAssignmentId);
    const target = currentTerritories.find(t => t.assignment_id === assignmentId);
    if (!target) {
      return res.status(400).json({ error: 'That is not one of your current approved territories.' });
    }
    requestType = 'change';
    previousAssignmentId = assignmentId;
  } else {
    // "initial" vs "addition" is computed here, not trusted from the
    // client — it reflects a fact about the affiliate's own record, not a
    // choice the request form needs to get right.
    requestType = currentTerritories.length === 0 ? 'initial' : 'addition';
  }

  const [result] = await pool.query(
    `INSERT INTO territory_requests (affiliate_id, request_type, requested_state, requested_county, previous_assignment_id)
     VALUES (?, ?, ?, ?, ?)`,
    [req.affiliate.id, requestType, state, county, previousAssignmentId]
  );

  await audit(pool, {
    actorType: 'affiliate', actorId: req.affiliate.id, actorEmail: req.siteUser.email,
    action: 'affiliate.territory_requested', entityType: 'affiliate_territory', entityId: result.insertId,
    newValue: { requestType, state, county },
    ipAddress: req.ip,
  });

  await fireAutomation('affiliate_territory_request_submitted', {
    to: req.siteUser.email,
    mergeFields: { firstName: req.siteUser.first_name, territory: `${county}, ${state}`, requestType },
  });

  res.status(201).json({ ok: true, requestId: result.insertId, requestType });
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
