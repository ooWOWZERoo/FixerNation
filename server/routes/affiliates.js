// Sales-affiliate program — stage 2: applications and admin review.
// Design and confirmed decisions: docs/AFFILIATE_PROGRAM_SPIKE.md.
//
// One public endpoint (POST /apply, no auth — a prospect has no account yet)
// and the rest behind requireAuth. Referral capture at checkout (stage 3) and
// the affiliate's own portal (stage 4) are not built yet, so nothing here
// reads purchases.affiliate_id except the reporting columns, which stay at
// zero until stage 3 lands and then light up on their own.
//
// Route order matters: every literal /applications* path is declared before
// the bare /:id routes, or Express reads "applications" as an :id value.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createToken } = require('../lib/site-tokens');
const { fireAutomation } = require('../lib/automations');
const { sendSalesAlertEmail } = require('../lib/mailer');
const { getSetting } = require('../lib/settings');
const { LEDGER_TOTALS_SQL } = require('../lib/affiliate-attribution');
const {
  US_STATES, isValidStateCode, findOrCreateTerritory, activeHolder,
  assignTerritory, revokeTerritoryAssignment, territoriesForAffiliate, listTerritories,
} = require('../lib/territories');
const { audit } = require('../lib/audit');

const router = express.Router();

// Where a newly approved affiliate lands after setting their password.
// Stage 4 changes this one line to '/affiliate-dashboard.html'; until that
// page exists, sending them there would be a 404, so they go to the profile
// page every site_user already has.
const AFFILIATE_LANDING_PATH = '/my-profile.html';

// A role we refuse to overwrite when approving an application. site_users.role
// is a single column, so approving an email that already belongs to staff or a
// school/district admin would quietly demote a privileged account — the same
// overwrite school-admin-assignment.js performs, but in that direction it's an
// upgrade. Better to make the admin use a different address.
const PROTECTED_ROLES = ['admin', 'district_admin', 'school_license_admin'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Public application endpoint
// ---------------------------------------------------------------------------

// In-process, per-IP throttle for the public form. There is no rate-limit
// infrastructure anywhere in this codebase yet (contact.js has none either —
// a known gap), and this host runs a single Node process, so a plain Map is
// genuinely enough here. It resets on restart, which is acceptable for spam
// deterrence and deliberately not treated as a security control.
const APPLY_WINDOW_MS = 60 * 60 * 1000;
const APPLY_MAX_PER_WINDOW = 5;
const applyHits = new Map();

// req.ip is the proxy's address on this host, since 'trust proxy' is not set
// app-wide (setting it would change behaviour for every existing route, which
// isn't this stage's job). The forwarded header is the only per-visitor signal
// available, so the throttle reads that first and falls back to req.ip.
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || 'unknown';
}

function throttled(ip) {
  const now = Date.now();
  const recent = (applyHits.get(ip) || []).filter(t => now - t < APPLY_WINDOW_MS);
  if (recent.length >= APPLY_MAX_PER_WINDOW) {
    applyHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  applyHits.set(ip, recent);
  // Opportunistic cleanup so the Map can't grow without bound on a long uptime.
  if (applyHits.size > 5000) {
    for (const [key, times] of applyHits) {
      if (!times.some(t => now - t < APPLY_WINDOW_MS)) applyHits.delete(key);
    }
  }
  return false;
}

// POST /api/affiliates/apply — public. A rejected applicant may reapply at any
// time (confirmed decision), so this never checks for prior rows; the review
// queue surfaces earlier decisions instead.
router.post('/apply', async (req, res) => {
  const b = req.body || {};

  // Honeypot: a field no real person sees, hidden by CSS on the form. Anything
  // filled in here is a bot, and it gets a normal-looking success response
  // rather than an error that would tell it what to fix.
  if (b.website) {
    console.log(`[affiliate] Honeypot triggered from ${clientIp(req)} — application discarded`);
    return res.status(201).json({ ok: true });
  }

  if (throttled(clientIp(req))) {
    return res.status(429).json({ error: 'Too many applications from this connection. Please try again later.' });
  }

  const firstName = (b.firstName || '').trim();
  const lastName = (b.lastName || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const company = (b.company || '').trim();
  const phone = (b.phone || '').trim();
  const requestedTerritory = (b.requestedTerritory || '').trim();
  const pitch = (b.pitch || '').trim();

  if (!firstName || !lastName) return res.status(400).json({ error: 'First and last name are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email address is required' });
  if (firstName.length > 100 || lastName.length > 100) return res.status(400).json({ error: 'Name is too long' });
  if (company.length > 255) return res.status(400).json({ error: 'Company name is too long' });
  if (phone.length > 30) return res.status(400).json({ error: 'Phone number is too long' });
  if (requestedTerritory.length > 100) return res.status(400).json({ error: 'Territory is too long' });
  if (pitch.length > 4000) return res.status(400).json({ error: 'Please keep your background under 4,000 characters' });

  const [result] = await pool.query(
    `INSERT INTO affiliate_applications
       (first_name, last_name, email, company, phone, requested_territory, pitch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [firstName, lastName, email, company || null, phone || null, requestedTerritory || null, pitch || null]
  );

  try {
    await sendSalesAlertEmail({
      to: await getSetting('contact_email_sales_alerts'),
      subject: `New affiliate application — ${firstName} ${lastName}`,
      fields: {
        Name: `${firstName} ${lastName}`,
        Email: email,
        Company: company || '—',
        Phone: phone || '—',
        'Requested Territory': requestedTerritory || '—',
        Background: pitch || '—',
      },
      linkUrl: `${process.env.SITE_URL || ''}/admin-affiliates.html`,
      linkLabel: 'Review Applications',
    });
  } catch (e) {
    console.error('sales alert (affiliate application) failed:', e.message);
  }

  res.status(201).json({ ok: true, applicationId: result.insertId });
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Territory assignment and exclusivity now live in lib/territories.js
// (stage 3.5b) — territoryHolder() used to do this against a free-text
// column that no longer exists on `affiliates`.

function normalizeRate(raw) {
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return null;
  return Math.round(rate * 100) / 100;
}

const CODE_RE = /^[A-Z0-9-]{4,32}$/;

// Codes are shared by hand and read aloud, so the generated alphabet drops
// the characters that get misread (0/O, 1/I, 5/S).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(lastName) {
  const stem = (lastName || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return (stem ? `${stem}-${suffix}` : `FNE-${suffix}`).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Admin — applications
// ---------------------------------------------------------------------------

// GET /api/affiliates/applications?status=&q=
// priorDecisions counts earlier reviewed applications from the same email, so
// a reapplication after a rejection is visible in the queue rather than
// looking like a first-time applicant.
router.get('/applications', requireAuth, async (req, res) => {
  const status = (req.query.status || '').trim();
  const q = (req.query.q || '').trim();
  const where = [];
  const params = [];

  if (['pending', 'approved', 'rejected'].includes(status)) {
    where.push('aa.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(aa.email LIKE ? OR aa.first_name LIKE ? OR aa.last_name LIKE ? OR aa.company LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await pool.query(
    `SELECT aa.*,
            au.username AS reviewed_by_username,
            (SELECT COUNT(*) FROM affiliate_applications prior
              WHERE prior.email = aa.email AND prior.id < aa.id AND prior.status <> 'pending') AS prior_decisions
     FROM affiliate_applications aa
     LEFT JOIN admin_users au ON au.id = aa.reviewed_by_admin_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY aa.status = 'pending' DESC, aa.created_at DESC
     LIMIT 300`,
    params
  );

  const [[counts]] = await pool.query(
    `SELECT
       SUM(status = 'pending') AS pending,
       SUM(status = 'approved') AS approved,
       SUM(status = 'rejected') AS rejected
     FROM affiliate_applications`
  );

  res.json({
    applications: rows,
    counts: {
      pending: Number(counts.pending || 0),
      approved: Number(counts.approved || 0),
      rejected: Number(counts.rejected || 0),
    },
  });
});

// POST /api/affiliates/applications/:id/approve
// Creates (or promotes) the site_user, creates the affiliates row, and marks
// the application approved in one transaction. The welcome email and the sales
// alert are fired after the commit, best-effort — a mail failure must not roll
// back an approval that already happened.
router.post('/applications/:id/approve', requireAuth, async (req, res) => {
  const b = req.body || {};
  const rate = normalizeRate(b.commissionRate);
  if (rate === null) return res.status(400).json({ error: 'Commission rate must be a percentage between 0 and 100' });

  // Territory assignment at approval is optional — an admin can always add
  // one afterward from the Affiliates tab. When given, it must be a real US
  // state (fixed vocabulary, stage 3.5b); territoryCounty narrows it to a
  // county within that state.
  const territoryState = (b.territoryState || '').trim().toUpperCase();
  const territoryCounty = (b.territoryCounty || '').trim();
  if (territoryState && !isValidStateCode(territoryState)) {
    return res.status(400).json({ error: `"${territoryState}" is not a US state or DC` });
  }
  if (territoryCounty.length > 100) return res.status(400).json({ error: 'County name is too long' });

  let code = (b.referralCode || '').trim().toUpperCase();
  if (code && !CODE_RE.test(code)) {
    return res.status(400).json({ error: 'Referral code must be 4–32 characters, letters, numbers and dashes only' });
  }

  const conn = await pool.getConnection();
  let application, user, isNewUser = false, finalCode;
  try {
    await conn.beginTransaction();

    const [[app]] = await conn.query(
      'SELECT * FROM affiliate_applications WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!app) {
      await conn.rollback();
      return res.status(404).json({ error: 'Application not found' });
    }
    if (app.status !== 'pending') {
      await conn.rollback();
      return res.status(409).json({ error: `This application was already ${app.status}` });
    }
    application = app;

    const [userRows] = await conn.query('SELECT id, first_name, role, email_verified FROM site_users WHERE email = ?', [app.email]);
    user = userRows[0];

    if (user) {
      if (PROTECTED_ROLES.includes(user.role)) {
        await conn.rollback();
        return res.status(409).json({ error: `${app.email} already has a "${user.role}" account. Approving would replace that role — ask the applicant for a different email address.` });
      }
      const [[existingAffiliate]] = await conn.query('SELECT id FROM affiliates WHERE site_user_id = ? LIMIT 1', [user.id]);
      if (existingAffiliate) {
        await conn.rollback();
        return res.status(409).json({ error: `${app.email} is already an affiliate.` });
      }
      await conn.query("UPDATE site_users SET role = 'affiliate' WHERE id = ?", [user.id]);
    } else {
      // Unusable random password: the account exists so the affiliate can be
      // attached to it, but the only way in is the setup link below.
      const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
      const [inserted] = await conn.query(
        "INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role) VALUES (?, ?, ?, ?, 0, 'affiliate')",
        [app.first_name, app.last_name, app.email, randomHash]
      );
      user = { id: inserted.insertId, first_name: app.first_name, email_verified: 0 };
      isNewUser = true;

      const [[existingContact]] = await conn.query('SELECT id FROM newsletter_contacts WHERE email = ? LIMIT 1', [app.email]);
      if (!existingContact) {
        await conn.query(
          "INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'Affiliate Approval', 'Subscribed')",
          [`${app.first_name} ${app.last_name}`.trim(), app.email]
        );
      }
    }

    // An admin-supplied code is used as given (and fails loudly if taken); a
    // generated one retries, since its collision is our problem, not theirs.
    const attempts = code ? [code] : Array.from({ length: 5 }, () => generateCode(app.last_name));
    let affiliateId = null;
    for (const candidate of attempts) {
      try {
        const [inserted] = await conn.query(
          `INSERT INTO affiliates (site_user_id, application_id, referral_code, commission_rate, status, approved_by_admin_id, approved_at)
           VALUES (?, ?, ?, ?, 'active', ?, NOW())`,
          [user.id, app.id, candidate, rate, req.user.userId || null]
        );
        finalCode = candidate;
        affiliateId = inserted.insertId;
        break;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    if (!finalCode) {
      await conn.rollback();
      return res.status(409).json({
        error: code
          ? `Referral code ${code} is already in use.`
          : 'Could not generate a unique referral code. Please try again.',
      });
    }

    let assignedTerritoryName = null;
    if (territoryState) {
      try {
        const { territory } = await assignTerritory(conn, {
          affiliateId,
          scope: territoryCounty ? 'county' : 'state',
          state: territoryState,
          county: territoryCounty || undefined,
          adminId: req.user.userId,
        });
        assignedTerritoryName = territory.name;
      } catch (err) {
        await conn.rollback();
        if (err.status) return res.status(err.status).json({ error: err.message });
        throw err;
      }
    }

    await conn.query(
      `UPDATE affiliate_applications
         SET status = 'approved', reviewed_by_admin_id = ?, reviewed_at = NOW(), resulting_site_user_id = ?
       WHERE id = ?`,
      [req.user.userId || null, user.id, app.id]
    );

    await audit(conn, {
      actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
      action: 'affiliate.approved', entityType: 'affiliate', entityId: affiliateId,
      newValue: { email: app.email, referralCode: finalCode, commissionRate: rate, territory: assignedTerritoryName },
      ipAddress: req.ip,
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const siteUrl = process.env.SITE_URL || '';
  const referralLink = `${siteUrl}/school-licensing.html?ref=${finalCode}`;
  let setPasswordUrl = `${siteUrl}${AFFILIATE_LANDING_PATH}`;
  if (isNewUser || !user.email_verified) {
    try {
      const token = await createToken(user.id, 'reset', 7 * 24 * 60 * 60 * 1000);
      setPasswordUrl = `${siteUrl}/reset-password.html?token=${token}&next=${AFFILIATE_LANDING_PATH}`;
    } catch (e) {
      console.error('affiliate setup token failed:', e.message);
    }
  }

  await fireAutomation('affiliate_application_approved', {
    to: application.email,
    mergeFields: {
      firstName: application.first_name,
      referralCode: finalCode,
      referralLink,
      commissionRate: rate.toFixed(2).replace(/\.00$/, ''),
      territory: assignedTerritoryName || 'Not assigned yet',
      setPasswordUrl,
    },
  });

  try {
    await sendSalesAlertEmail({
      to: await getSetting('contact_email_sales_alerts'),
      subject: `Affiliate approved — ${application.first_name} ${application.last_name}`,
      fields: {
        Affiliate: `${application.first_name} ${application.last_name} <${application.email}>`,
        'Referral Code': finalCode,
        'Commission Rate': `${rate}%`,
        Territory: assignedTerritoryName || '—',
        'New Account': isNewUser ? 'Yes' : 'No',
      },
      linkUrl: `${siteUrl}/admin-affiliates.html`,
      linkLabel: 'View Affiliates',
    });
  } catch (e) {
    console.error('sales alert (affiliate approved) failed:', e.message);
  }

  res.status(201).json({ ok: true, referralCode: finalCode, siteUserId: user.id, isNewUser, territory: assignedTerritoryName });
});

// POST /api/affiliates/applications/:id/reject
router.post('/applications/:id/reject', requireAuth, async (req, res) => {
  const reason = ((req.body || {}).reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required — it goes into the email the applicant receives' });
  if (reason.length > 500) return res.status(400).json({ error: 'Please keep the reason under 500 characters' });

  const [[app]] = await pool.query('SELECT * FROM affiliate_applications WHERE id = ?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'pending') return res.status(409).json({ error: `This application was already ${app.status}` });

  await pool.query(
    `UPDATE affiliate_applications
       SET status = 'rejected', rejection_reason = ?, reviewed_by_admin_id = ?, reviewed_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [reason, req.user.userId || null, app.id]
  );

  await fireAutomation('affiliate_application_rejected', {
    to: app.email,
    mergeFields: { firstName: app.first_name, reason },
  });

  await audit(pool, {
    actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
    action: 'affiliate.rejected', entityType: 'affiliate_application', entityId: app.id,
    reason, ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin — commission ledger (stage 3.5a)
//
// Declared before the bare /:id routes below, same reason as /applications.
// ---------------------------------------------------------------------------

// Which statuses a transition is allowed to act on. 'paid' and 'reversed' are
// terminal: once money has moved or been clawed back, the row is history.
const TRANSITIONS = {
  approve: { from: ['pending', 'on_hold'], to: 'approved' },
  hold: { from: ['pending', 'approved'], to: 'on_hold' },
  release: { from: ['on_hold'], to: 'pending' },
  pay: { from: ['approved'], to: 'paid' },
  reverse: { from: ['pending', 'approved', 'on_hold'], to: 'reversed' },
};

// Past tense of each action, for the error message and the audit log.
// `${action}d` reads correctly for approve/release/reverse but produces
// "holdd" for hold — this map exists because that naive concatenation was
// already wrong once.
const TRANSITION_PAST_TENSE = { approve: 'approved', hold: 'held', release: 'released', pay: 'paid', reverse: 'reversed' };

// GET /api/affiliates/commissions?status=&affiliateId=
router.get('/commissions', requireAuth, async (req, res) => {
  const status = (req.query.status || '').trim();
  const affiliateId = Number(req.query.affiliateId) || null;
  const where = [];
  const params = [];

  if (['pending', 'approved', 'paid', 'on_hold', 'reversed'].includes(status)) {
    where.push('ac.status = ?');
    params.push(status);
  }
  if (affiliateId) {
    where.push('ac.affiliate_id = ?');
    params.push(affiliateId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT ac.*,
            su.first_name, su.last_name, su.email,
            a.referral_code,
            p.product_type, p.purchased_at, p.payment_method, p.payment_status, p.school_domain, p.invoice_id,
            lp.name AS plan_name,
            nc.name AS buyer_name, nc.email AS buyer_email,
            i.invoice_number, i.status AS invoice_status
     FROM affiliate_commissions ac
     JOIN affiliates a ON a.id = ac.affiliate_id
     JOIN site_users su ON su.id = a.site_user_id
     LEFT JOIN purchases p ON p.id = ac.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     LEFT JOIN newsletter_contacts nc ON nc.id = p.contact_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     ${whereSql}
     ORDER BY FIELD(ac.status, 'pending', 'approved', 'on_hold', 'paid', 'reversed'), ac.created_at DESC
     LIMIT 500`,
    params
  );

  // Program-wide totals, deliberately unfiltered by the status/affiliate
  // filters above — the header numbers shouldn't change as you filter the list.
  const [[totals]] = await pool.query(LEDGER_TOTALS_SQL);

  res.json({ commissions: rows, totals });
});

// POST /api/affiliates/commissions/:id/:action
// action: approve | hold | release | pay | reverse
router.post('/commissions/:id/:action', requireAuth, async (req, res) => {
  const action = req.params.action;
  const rule = TRANSITIONS[action];
  if (!rule) return res.status(400).json({ error: 'Unknown action' });

  const b = req.body || {};
  const reason = (b.reason || '').trim();
  const payoutReference = (b.payoutReference || '').trim();

  if (action === 'reverse' && !reason) {
    return res.status(400).json({ error: 'A reason is required to reverse a commission' });
  }
  if (reason.length > 500) return res.status(400).json({ error: 'Reason is too long' });
  if (payoutReference.length > 64) return res.status(400).json({ error: 'Payout reference is too long' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[entry]] = await conn.query('SELECT * FROM affiliate_commissions WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!entry) {
      await conn.rollback();
      return res.status(404).json({ error: 'Commission entry not found' });
    }
    if (!rule.from.includes(entry.status)) {
      await conn.rollback();
      return res.status(409).json({
        error: `A ${entry.status} entry can't be ${action === 'pay' ? 'marked paid' : TRANSITION_PAST_TENSE[action]}. Allowed from: ${rule.from.join(', ')}.`,
      });
    }

    const sets = ['status = ?'];
    const params = [rule.to];
    const adminId = (req.user && req.user.userId) || null;

    if (action === 'approve') {
      sets.push('approved_at = NOW()', 'approved_by_admin_id = ?');
      params.push(adminId);
    } else if (action === 'pay') {
      sets.push('paid_at = NOW()', 'payout_reference = ?');
      params.push(payoutReference || null);
    } else if (action === 'reverse') {
      sets.push('reversed_at = NOW()', 'reversed_by_admin_id = ?', 'reversal_reason = ?');
      params.push(adminId, reason);
    } else if (action === 'hold' && reason) {
      sets.push('notes = ?');
      params.push(reason);
    }

    await conn.query(`UPDATE affiliate_commissions SET ${sets.join(', ')} WHERE id = ?`, [...params, entry.id]);

    await audit(conn, {
      actorType: 'admin', actorId: adminId, actorEmail: req.user.username,
      action: `commission.${TRANSITION_PAST_TENSE[action]}`,
      entityType: 'affiliate_commission', entityId: entry.id, purchaseId: entry.purchase_id,
      prevValue: { status: entry.status },
      newValue: { status: rule.to, payoutReference: action === 'pay' ? (payoutReference || null) : undefined },
      reason: reason || null,
      ipAddress: req.ip,
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  res.json({ ok: true, status: rule.to });
});

// POST /api/affiliates/:id/commissions — a manual adjustment or a bonus, with
// no purchase behind it. A negative amount is allowed on purpose: correcting an
// over-credit is a different act from reversing a specific sale, which is what
// the reverse transition is for.
router.post('/:id/commissions', requireAuth, async (req, res) => {
  const b = req.body || {};
  const sourceType = ['manual', 'bonus'].includes(b.sourceType) ? b.sourceType : null;
  if (!sourceType) return res.status(400).json({ error: 'sourceType must be manual or bonus' });

  const description = (b.description || '').trim();
  if (!description) return res.status(400).json({ error: 'A description is required — nothing else explains this entry' });
  if (description.length > 300) return res.status(400).json({ error: 'Description is too long' });

  const dollars = Number(b.amount);
  if (!Number.isFinite(dollars) || dollars === 0) return res.status(400).json({ error: 'Amount must be a non-zero dollar figure' });
  const cents = Math.round(dollars * 100);
  if (Math.abs(cents) > 100000000) return res.status(400).json({ error: 'Amount is implausibly large' });

  const [[affiliate]] = await pool.query('SELECT id FROM affiliates WHERE id = ?', [req.params.id]);
  if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });

  // A manual entry has no payment to wait on, so it's approved on creation —
  // the admin typing it in *is* the approval.
  const [result] = await pool.query(
    `INSERT INTO affiliate_commissions
       (affiliate_id, purchase_id, status, source_type, description, commission_cents, approved_at, approved_by_admin_id, notes)
     VALUES (?, NULL, 'approved', ?, ?, ?, NOW(), ?, ?)`,
    [affiliate.id, sourceType, description, cents, (req.user && req.user.userId) || null, (b.notes || '').trim() || null]
  );

  await audit(pool, {
    actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
    action: `commission.${sourceType}_added`, entityType: 'affiliate_commission', entityId: result.insertId,
    newValue: { amountCents: cents, description }, ipAddress: req.ip,
  });

  res.status(201).json({ ok: true, id: result.insertId, commissionCents: cents });
});

// ---------------------------------------------------------------------------
// Admin — activity log (stage 3.5c)
//
// school_audit_log is the same table school-admin.js's audit() (now
// lib/audit.js) has written to since before this program existed — reused
// rather than duplicated into a second near-identical table, since its
// actor/action/entity columns are already generic. Filtered to the affiliate
// program's own entity_type values so this program's log doesn't pull in
// unrelated school-admin rows, and vice versa: nothing here is visible from
// admin-school-admins.html or any other consumer of that table.
// ---------------------------------------------------------------------------

const AFFILIATE_AUDIT_ENTITY_TYPES = ['affiliate', 'affiliate_application', 'affiliate_commission', 'affiliate_territory'];

// GET /api/affiliates/audit-log?entityType=&q=
router.get('/audit-log', requireAuth, async (req, res) => {
  const entityType = (req.query.entityType || '').trim();
  const q = (req.query.q || '').trim();
  const where = [`entity_type IN (${AFFILIATE_AUDIT_ENTITY_TYPES.map(() => '?').join(', ')})`];
  const params = [...AFFILIATE_AUDIT_ENTITY_TYPES];

  if (entityType && AFFILIATE_AUDIT_ENTITY_TYPES.includes(entityType)) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (q) {
    where.push('(actor_email LIKE ? OR action LIKE ? OR reason LIKE ? OR new_value LIKE ? OR prev_value LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await pool.query(
    `SELECT id, actor_type, actor_id, actor_email, action, entity_type, entity_id,
            purchase_id, prev_value, new_value, reason, ip_address, created_at
     FROM school_audit_log
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 300`,
    params
  );

  res.json({
    entries: rows.map(r => ({
      ...r,
      prev_value: r.prev_value ? JSON.parse(r.prev_value) : null,
      new_value: r.new_value ? JSON.parse(r.new_value) : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Admin — territories (stage 3.5b)
//
// Declared before the /:id routes below, same reason as everywhere else in
// this file: a literal path has to come first or Express reads it as an :id.
// ---------------------------------------------------------------------------

// GET /api/affiliates/states — the fixed dropdown list. A tiny, static
// payload; kept as a real endpoint rather than duplicated in every admin page
// that needs it, even though today only admin-affiliates.html does.
router.get('/states', requireAuth, (req, res) => {
  res.json({ states: US_STATES.map(([code, name]) => ({ code, name })) });
});

// GET /api/affiliates/territories?state=&q= — browse territory records and
// who (if anyone) currently holds each. Backs the assign picker, so it can
// show "already held by X" before the admin even tries.
router.get('/territories', requireAuth, async (req, res) => {
  const rows = await listTerritories({ state: req.query.state, q: req.query.q });
  res.json({
    territories: rows.map(r => ({
      id: r.id,
      scope: r.scope,
      state: r.state,
      county: r.county,
      name: r.name,
      status: r.status,
      holder: r.holder_affiliate_id
        ? { affiliateId: r.holder_affiliate_id, name: [r.holder_first_name, r.holder_last_name].filter(Boolean).join(' ') }
        : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Admin — affiliate directory
// ---------------------------------------------------------------------------

// GET /api/affiliates — directory with commission totals and active territories.
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const params = [];
  let where = '';
  if (q) {
    // Searching territory now means searching the joined territory names,
    // not a column on `affiliates` — matches "Florida" or "Orange County, FL"
    // for any affiliate currently holding that territory.
    where = `WHERE (su.email LIKE ? OR su.first_name LIKE ? OR su.last_name LIKE ? OR a.referral_code LIKE ?
              OR EXISTS (
                SELECT 1 FROM affiliate_territories at2 JOIN territories t2 ON t2.id = at2.territory_id
                WHERE at2.affiliate_id = a.id AND at2.status = 'active' AND t2.name LIKE ?
              ))`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  // Totals come from the ledger, filtered by status — never a bare SUM over
  // the table, which would fold reversed entries back into what's owed. See
  // docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md.
  const [rows] = await pool.query(
    `SELECT a.id, a.referral_code, a.commission_rate, a.status, a.approved_at, a.created_at,
            a.site_user_id, a.application_id,
            su.first_name, su.last_name, su.email, su.email_verified,
            (SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ') FROM affiliate_territories at
              JOIN territories t ON t.id = at.territory_id
              WHERE at.affiliate_id = a.id AND at.status = 'active') AS territories,
            (SELECT COUNT(*) FROM affiliate_commissions ac
              WHERE ac.affiliate_id = a.id AND ac.source_type = 'referral' AND ac.status <> 'reversed') AS sale_count,
            (SELECT COALESCE(SUM(ac.commission_cents), 0) FROM affiliate_commissions ac
              WHERE ac.affiliate_id = a.id AND ac.status = 'pending') AS pending_cents,
            (SELECT COALESCE(SUM(ac.commission_cents), 0) FROM affiliate_commissions ac
              WHERE ac.affiliate_id = a.id AND ac.status = 'approved') AS approved_cents,
            (SELECT COALESCE(SUM(ac.commission_cents), 0) FROM affiliate_commissions ac
              WHERE ac.affiliate_id = a.id AND ac.status = 'paid') AS paid_cents
     FROM affiliates a
     JOIN site_users su ON su.id = a.site_user_id
     ${where}
     ORDER BY a.status = 'active' DESC, a.created_at DESC`,
    params
  );

  res.json({ affiliates: rows });
});

// PUT /api/affiliates/:id — rate and suspend/reactivate. Territory moves
// through the dedicated /:id/territories endpoints below (stage 3.5b) —
// there's no single "territory" field to set here anymore.
//
// Changing the rate never touches commission already recorded on a
// purchase: that number is snapshotted at attribution time by design.
router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body || {};
  const updates = [];
  const params = [];

  if (b.commissionRate !== undefined) {
    const rate = normalizeRate(b.commissionRate);
    if (rate === null) return res.status(400).json({ error: 'Commission rate must be a percentage between 0 and 100' });
    updates.push('commission_rate = ?');
    params.push(rate);
  }

  let status;
  if (b.status !== undefined) {
    status = String(b.status);
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Status must be active or suspended' });
    updates.push('status = ?');
    params.push(status);
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[affiliate]] = await conn.query('SELECT * FROM affiliates WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!affiliate) {
      await conn.rollback();
      return res.status(404).json({ error: 'Affiliate not found' });
    }

    await conn.query(`UPDATE affiliates SET ${updates.join(', ')} WHERE id = ?`, [...params, affiliate.id]);

    // Suspending frees every territory this affiliate holds — a real,
    // auditable revoke (not a silent join-filter exception), matching the
    // original confirmed decision that a suspended affiliate's territory
    // becomes assignable again. Reactivating does NOT restore them
    // automatically: the territory may already belong to someone else by
    // then, so re-assignment after reactivating is a deliberate act.
    if (status === 'suspended') {
      const [revoked] = await conn.query(
        `UPDATE affiliate_territories
           SET status = 'revoked', revoked_at = NOW(), revoked_by_admin_id = ?, notes = 'Affiliate suspended'
         WHERE affiliate_id = ? AND status = 'active'`,
        [req.user.userId || null, affiliate.id]
      );
      if (revoked.affectedRows) {
        console.log(`[affiliate] Suspended affiliate ${affiliate.id} — freed ${revoked.affectedRows} territory assignment(s).`);
      }
    }

    await audit(conn, {
      actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
      action: status ? `affiliate.${status}` : 'affiliate.rate_changed',
      entityType: 'affiliate', entityId: affiliate.id,
      prevValue: { commissionRate: affiliate.commission_rate, status: affiliate.status },
      newValue: b,
      ipAddress: req.ip,
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  res.json({ ok: true });
});

// A GET /:id/sales endpoint lived here in stage 3, listing the purchases
// attributed to one affiliate. It was removed in 3.5a rather than left live
// and orphaned: GET /commissions?affiliateId=N answers the same question and
// more, since the ledger knows what's owed and what's already been paid, and
// purchases alone never did. Stage 4's portal reads the ledger too.

// GET /api/affiliates/:id/territories — one affiliate's full territory
// history, active and revoked.
router.get('/:id/territories', requireAuth, async (req, res) => {
  const [[affiliate]] = await pool.query('SELECT id FROM affiliates WHERE id = ?', [req.params.id]);
  if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });
  const rows = await territoriesForAffiliate(affiliate.id);
  res.json({ territories: rows });
});

// POST /api/affiliates/:id/territories — assign a territory. Body:
// { state, county? }. county is omitted for a state-level assignment.
router.post('/:id/territories', requireAuth, async (req, res) => {
  const b = req.body || {};
  const state = (b.state || '').trim().toUpperCase();
  const county = (b.county || '').trim();
  if (!isValidStateCode(state)) return res.status(400).json({ error: `"${b.state}" is not a US state or DC` });
  if (county.length > 100) return res.status(400).json({ error: 'County name is too long' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[affiliate]] = await conn.query('SELECT id FROM affiliates WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!affiliate) {
      await conn.rollback();
      return res.status(404).json({ error: 'Affiliate not found' });
    }

    let result;
    try {
      result = await assignTerritory(conn, {
        affiliateId: affiliate.id,
        scope: county ? 'county' : 'state',
        state,
        county: county || undefined,
        adminId: req.user.userId,
        notes: (b.notes || '').trim() || null,
      });
    } catch (err) {
      await conn.rollback();
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    await audit(conn, {
      actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
      action: 'affiliate.territory_assigned', entityType: 'affiliate_territory', entityId: result.assignmentId,
      newValue: { territory: result.territory.name, affiliateId: affiliate.id },
      ipAddress: req.ip,
    });

    await conn.commit();
    res.status(201).json({ ok: true, assignmentId: result.assignmentId, territory: result.territory });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// POST /api/affiliates/:id/territories/:assignmentId/revoke
router.post('/:id/territories/:assignmentId/revoke', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[assignment]] = await conn.query(
      'SELECT * FROM affiliate_territories WHERE id = ? AND affiliate_id = ? FOR UPDATE',
      [req.params.assignmentId, req.params.id]
    );
    if (!assignment) {
      await conn.rollback();
      return res.status(404).json({ error: 'Territory assignment not found for this affiliate' });
    }

    try {
      await revokeTerritoryAssignment(conn, assignment.id, req.user.userId, (req.body && req.body.notes || '').trim() || null);
    } catch (err) {
      await conn.rollback();
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    await audit(conn, {
      actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
      action: 'affiliate.territory_revoked', entityType: 'affiliate_territory', entityId: assignment.id,
      prevValue: { affiliateId: assignment.affiliate_id, territoryId: assignment.territory_id },
      ipAddress: req.ip,
    });

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = router;
