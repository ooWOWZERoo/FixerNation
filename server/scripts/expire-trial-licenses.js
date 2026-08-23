// Run daily via cPanel Cron Job.
// Expires trial licenses whose trial_expiration_date has passed and deactivates
// their seat so hasActiveLicense() returns false immediately.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { fireAutomation } = require('../lib/automations');

async function main() {
  const [rows] = await pool.query(
    `SELECT p.id, p.trial_lesson_limit,
            nc.email AS buyer_email, nc.name AS buyer_name,
            lp.name AS plan_name
     FROM purchases p
     LEFT JOIN newsletter_contacts nc ON nc.id = p.contact_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.trial_expiration_date IS NOT NULL
       AND p.trial_expiration_date < NOW()
       AND p.license_status = 'active'
       AND p.trial_lesson_limit IS NOT NULL
       AND p.conversion_credit_redeemed_at IS NULL`
  );

  if (!rows.length) {
    console.log('No trial licenses to expire.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    const conn = await pool.getConnection();
    let expired = false;
    let registeredTeachers = [];
    try {
      await conn.beginTransaction();
      // Re-check the same conditions the SELECT above used, right at write
      // time — the initial SELECT and this UPDATE aren't otherwise atomic,
      // so a trial-to-paid Stripe webhook (handleTrialConversionCompleted in
      // checkout.js, which sets license_status='converted' and
      // conversion_credit_redeemed_at) landing in that window would
      // otherwise get silently clobbered back to 'expired' by this cron.
      const [result] = await conn.query(
        `UPDATE purchases SET license_status = 'expired'
         WHERE id = ? AND license_status = 'active' AND conversion_credit_redeemed_at IS NULL`,
        [row.id]
      );
      expired = result.affectedRows > 0;
      if (expired) {
        const [seats] = await conn.query(
          "SELECT registered_site_user_id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id IS NOT NULL AND status IN ('registered', 'pending', 'available')",
          [row.id]
        );
        registeredTeachers = seats.map(s => s.registered_site_user_id);
        await conn.query(
          "UPDATE license_seats SET status = 'inactive' WHERE purchase_id = ? AND status IN ('registered', 'pending', 'available')",
          [row.id]
        );
        // Same reasoning as the manual admin revoke routes: hasActiveLicense()
        // denies access immediately either way, but the teacher's existing
        // session cookie would otherwise stay valid for non-license-gated
        // features until it naturally expires (up to 30 days).
        if (registeredTeachers.length) {
          await conn.query('UPDATE site_users SET session_invalidated_at = NOW() WHERE id IN (?)', [registeredTeachers]);
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    if (!expired) {
      console.log(`Skipped purchase ${row.id} — already converted/changed concurrently, not expiring.`);
      continue;
    }

    if (row.buyer_email) {
      await fireAutomation('trial_expired', {
        to: row.buyer_email,
        mergeFields: {
          firstName: (row.buyer_name || '').split(' ')[0] || 'there',
          planName: row.plan_name || '30-Day Trial',
        },
      });
    }

    console.log(`Expired trial for purchase ${row.id}`);
  }

  console.log(`Done. Expired ${rows.length} trial(s).`);
  await pool.end();
}

main().catch(err => {
  console.error('expire-trial-licenses failed:', err.message);
  process.exit(1);
});
