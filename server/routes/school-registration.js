const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { sendContactFormEmail } = require('../lib/mailer');

function domainFromEmail(email) {
  const at = (email || '').lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : '';
}

// POST /api/school-registration/check
// Atomically validates teacher eligibility and reserves a license seat.
// Returns { eligible, reason?, seatId?, purchaseId?, totalSeats?, usedSeats? }
router.post('/check', async (req, res) => {
  const { email, firstName, lastName } = req.body || {};
  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'email, firstName, and lastName are required' });
  }

  const domain = domainFromEmail(email);
  if (!domain) return res.status(400).json({ error: 'Invalid email address' });

  // Find the most relevant group_license purchase for this domain —
  // prefer active licenses first, then expiring-soon, then scheduled,
  // then any other status (pending/expired). Most recent within each tier.
  const [[schoolPurchase]] = await pool.query(
    `SELECT id, seat_count, payment_status, license_status, contact_id
     FROM purchases
     WHERE product_type = 'group_license' AND school_domain = ?
     ORDER BY
       CASE license_status
         WHEN 'active'        THEN 0
         WHEN 'expiring_soon' THEN 1
         WHEN 'scheduled'     THEN 2
         WHEN 'pending'       THEN 3
         ELSE 4
       END,
       purchased_at DESC
     LIMIT 1`,
    [domain]
  );

  if (!schoolPurchase) {
    return res.json({ eligible: false, reason: 'no_school' });
  }

  // PO submitted but hard-copy not yet received by FNE — license inactive
  if (schoolPurchase.license_status === 'pending') {
    return res.json({
      eligible: false,
      reason: 'license_pending',
      purchaseId: schoolPurchase.id,
      adminContactId: schoolPurchase.contact_id,
    });
  }

  if (!['active', 'expiring_soon'].includes(schoolPurchase.license_status)) {
    return res.json({
      eligible: false,
      reason: 'no_plan',
      purchaseId: schoolPurchase.id,
      adminContactId: schoolPurchase.contact_id,
    });
  }

  // Atomically count used seats and reserve one if available
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[locked]] = await conn.query(
      'SELECT seat_count FROM purchases WHERE id = ? FOR UPDATE',
      [schoolPurchase.id]
    );

    const [[{ used }]] = await conn.query(
      'SELECT COUNT(*) AS used FROM license_seats WHERE purchase_id = ?',
      [schoolPurchase.id]
    );

    if (used >= locked.seat_count) {
      await conn.rollback();
      conn.release();
      return res.json({
        eligible: false,
        reason: 'no_seats',
        purchaseId: schoolPurchase.id,
        adminContactId: schoolPurchase.contact_id,
        totalSeats: locked.seat_count,
        usedSeats: used,
      });
    }

    const [result] = await conn.query(
      "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
      [schoolPurchase.id, email.toLowerCase()]
    );

    await conn.commit();
    conn.release();

    // Fire-and-forget audit log
    pool.query(
      `INSERT INTO school_audit_log (actor_type, actor_email, action, entity_type, entity_id, purchase_id, school_domain)
       VALUES ('teacher', ?, 'teacher_self_registered', 'seat', ?, ?, ?)`,
      [email.toLowerCase(), result.insertId, schoolPurchase.id, domain]
    ).catch(e => console.error('audit log error:', e.message));

    return res.json({
      eligible: true,
      seatId: result.insertId,
      purchaseId: schoolPurchase.id,
      domain,
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
});

// POST /api/school-registration/notify-admin
// Sends the school's license admin a notification email with 24-hour dedup.
// Returns { sent, reason? }
router.post('/notify-admin', async (req, res) => {
  const { email, firstName, lastName, reason } = req.body || {};
  if (!email || !reason) {
    return res.status(400).json({ error: 'email and reason are required' });
  }

  const domain = domainFromEmail(email);
  if (!domain) return res.status(400).json({ error: 'Invalid email address' });

  // Find the paid school license (most recent)
  const [[schoolPurchase]] = await pool.query(
    `SELECT id, contact_id
     FROM purchases
     WHERE product_type = 'group_license'
       AND school_domain = ?
       AND payment_status = 'paid'
     ORDER BY purchased_at DESC
     LIMIT 1`,
    [domain]
  );

  if (!schoolPurchase) {
    return res.status(404).json({ error: 'No active school license found for this domain' });
  }

  // 24-hour dedup: one notification per domain+reason per day
  const [[recent]] = await pool.query(
    `SELECT id FROM school_admin_notifications
     WHERE school_domain = ? AND reason = ?
       AND sent_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
     LIMIT 1`,
    [domain, reason]
  );

  if (recent) {
    return res.json({ sent: false, reason: 'already_notified_recently' });
  }

  // Look up admin contact's email and name
  const [[adminContact]] = await pool.query(
    'SELECT email, first_name FROM newsletter_contacts WHERE id = ?',
    [schoolPurchase.contact_id]
  );

  if (adminContact) {
    const reasonLabel =
      reason === 'no_seats' ? 'No available seats remaining on the license' :
      reason === 'no_plan'  ? 'License payment is pending — not yet active' :
      reason;

    await sendContactFormEmail({
      to: adminContact.email,
      formName: 'Teacher License Request',
      fields: {
        'Teacher Name': [firstName, lastName].filter(Boolean).join(' ') || '(not provided)',
        'Teacher Email': email,
        'School Domain': domain,
        'Issue': reasonLabel,
        'Action Needed': 'Log in to the admin dashboard and either add available seats or mark the invoice as paid to allow teacher registration.',
      },
      replyTo: email,
    });
  }

  // Record so the 24-hour window takes effect
  await pool.query(
    `INSERT INTO school_admin_notifications (school_domain, reason, teacher_email, admin_contact_id)
     VALUES (?, ?, ?, ?)`,
    [domain, reason, email.toLowerCase(), schoolPurchase.contact_id]
  );

  return res.json({ sent: !!adminContact });
});

module.exports = router;
