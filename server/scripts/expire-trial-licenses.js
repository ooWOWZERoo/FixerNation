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
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE purchases SET license_status = 'expired' WHERE id = ?", [row.id]);
      await conn.query(
        "UPDATE license_seats SET status = 'inactive' WHERE purchase_id = ? AND status IN ('registered', 'pending', 'available')",
        [row.id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
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
