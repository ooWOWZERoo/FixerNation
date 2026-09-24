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

// Territory exclusivity is checked here rather than by a UNIQUE key, because
// the rule is "unique among ACTIVE affiliates only" — a suspended affiliate's
// territory has to become assignable again. Same query-level shape as the
// existing admin-seat exclusion in school-admin.js.
async function territoryHolder(conn, territory, excludeAffiliateId) {
  if (!territory) return null;
  const params = [territory];
  let sql = `SELECT a.id, su.first_name, su.last_name, su.email
             FROM affiliates a JOIN site_users su ON su.id = a.site_user_id
             WHERE a.territory = ? AND a.status = 'active'`;
  if (excludeAffiliateId) {
    sql += ' AND a.id != ?';
    params.push(excludeAffiliateId);
  }
  const [rows] = await conn.query(`${sql} LIMIT 1`, params);
  return rows[0] || null;
}

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

  const territory = (b.territory || '').trim();
  if (territory.length > 100) return res.status(400).json({ error: 'Territory is too long' });

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

    if (territory) {
      const holder = await territoryHolder(conn, territory, null);
      if (holder) {
        await conn.rollback();
        const name = [holder.first_name, holder.last_name].filter(Boolean).join(' ') || holder.email;
        return res.status(409).json({ error: `${territory} is already held by ${name}. Suspend them first, or pick a different territory.` });
      }
    }

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
    let lastErr = null;
    for (const candidate of attempts) {
      try {
        await conn.query(
          `INSERT INTO affiliates (site_user_id, application_id, referral_code, commission_rate, territory, status, approved_by_admin_id, approved_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, NOW())`,
          [user.id, app.id, candidate, rate, territory || null, req.user.userId || null]
        );
        finalCode = candidate;
        lastErr = null;
        break;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        lastErr = err;
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

    await conn.query(
      `UPDATE affiliate_applications
         SET status = 'approved', reviewed_by_admin_id = ?, reviewed_at = NOW(), resulting_site_user_id = ?
       WHERE id = ?`,
      [req.user.userId || null, user.id, app.id]
    );

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
      territory: territory || 'Not assigned',
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
        Territory: territory || '—',
        'New Account': isNewUser ? 'Yes' : 'No',
      },
      linkUrl: `${siteUrl}/admin-affiliates.html`,
      linkLabel: 'View Affiliates',
    });
  } catch (e) {
    console.error('sales alert (affiliate approved) failed:', e.message);
  }

  res.status(201).json({ ok: true, referralCode: finalCode, siteUserId: user.id, isNewUser });
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

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin — affiliate directory
// ---------------------------------------------------------------------------

// GET /api/affiliates — directory with attributed-sales totals. Those totals
// read zero until stage 3 starts writing purchases.affiliate_id.
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const params = [];
  let where = '';
  if (q) {
    where = 'WHERE (su.email LIKE ? OR su.first_name LIKE ? OR su.last_name LIKE ? OR a.referral_code LIKE ? OR a.territory LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await pool.query(
    `SELECT a.id, a.referral_code, a.commission_rate, a.territory, a.status, a.approved_at, a.created_at,
            a.site_user_id, a.application_id,
            su.first_name, su.last_name, su.email, su.email_verified,
            (SELECT COUNT(*) FROM purchases p WHERE p.affiliate_id = a.id) AS sale_count,
            (SELECT COALESCE(SUM(p.affiliate_commission_cents), 0) FROM purchases p WHERE p.affiliate_id = a.id) AS commission_cents
     FROM affiliates a
     JOIN site_users su ON su.id = a.site_user_id
     ${where}
     ORDER BY a.status = 'active' DESC, a.created_at DESC`,
    params
  );

  res.json({ affiliates: rows });
});

// PUT /api/affiliates/:id — rate, territory, suspend/reactivate.
// Changing the rate never touches commission already recorded on a purchase:
// that number is snapshotted at attribution time by design.
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

  let territory;
  if (b.territory !== undefined) {
    territory = String(b.territory).trim();
    if (territory.length > 100) return res.status(400).json({ error: 'Territory is too long' });
    updates.push('territory = ?');
    params.push(territory || null);
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

    // Re-check exclusivity whenever the result would be an active affiliate
    // holding a territory — that covers both "change the territory" and
    // "reactivate someone whose old territory was reassigned while they were
    // suspended", which is exactly the case a UNIQUE key would have blocked
    // at suspension time instead.
    const nextTerritory = territory !== undefined ? territory : affiliate.territory;
    const nextStatus = status !== undefined ? status : affiliate.status;
    if (nextTerritory && nextStatus === 'active') {
      const holder = await territoryHolder(conn, nextTerritory, affiliate.id);
      if (holder) {
        await conn.rollback();
        const name = [holder.first_name, holder.last_name].filter(Boolean).join(' ') || holder.email;
        return res.status(409).json({ error: `${nextTerritory} is already held by ${name}.` });
      }
    }

    await conn.query(`UPDATE affiliates SET ${updates.join(', ')} WHERE id = ?`, [...params, affiliate.id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  res.json({ ok: true });
});

// GET /api/affiliates/:id/sales — the purchases attributed to one affiliate.
// Empty for every affiliate until stage 3 ships.
router.get('/:id/sales', requireAuth, async (req, res) => {
  const [[affiliate]] = await pool.query('SELECT id FROM affiliates WHERE id = ?', [req.params.id]);
  if (!affiliate) return res.status(404).json({ error: 'Affiliate not found' });

  const [rows] = await pool.query(
    `SELECT p.id, p.product_type, p.purchased_at, p.amount_cents, p.affiliate_commission_cents,
            p.payment_method, p.payment_status, p.school_domain,
            nc.name AS buyer_name, nc.email AS buyer_email,
            lp.name AS plan_name
     FROM purchases p
     LEFT JOIN newsletter_contacts nc ON nc.id = p.contact_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.affiliate_id = ?
     ORDER BY p.purchased_at DESC
     LIMIT 500`,
    [req.params.id]
  );

  res.json({ sales: rows });
});

module.exports = router;
