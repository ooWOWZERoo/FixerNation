// Run daily via cPanel Cron Job.
// Sends a 30-day expiry reminder to the school's buyer contact and marks the
// license expiring_soon so the admin dashboard can surface it.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { fireAutomation } = require('../lib/automations');

function formatDate(value) {
  const d = new Date(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function main() {
  const [rows] = await pool.query(
    `SELECT p.id, p.school_domain, p.expiration_date, p.license_product_id,
            nc.email AS buyer_email, nc.name AS buyer_name,
            lp.name AS plan_name
     FROM purchases p
     LEFT JOIN newsletter_contacts nc ON nc.id = p.contact_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.expiration_date IS NOT NULL
       AND p.expiration_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       AND p.license_status = 'active'
       AND p.renewal_reminder_sent_at IS NULL
       AND p.product_type IN ('group_license', 'single_license')`
  );

  if (!rows.length) {
    console.log('No expiry reminders to send.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    await pool.query(
      "UPDATE purchases SET license_status = 'expiring_soon', renewal_reminder_sent_at = NOW() WHERE id = ?",
      [row.id]
    );

    if (row.buyer_email) {
      await fireAutomation('school_license_expiring_soon', {
        to: row.buyer_email,
        mergeFields: {
          firstName: (row.buyer_name || '').split(' ')[0] || 'there',
          schoolDomain: row.school_domain || '',
          planName: row.plan_name || 'School License',
          expirationDate: formatDate(row.expiration_date),
        },
      });
    }

    pool.query(
      `INSERT INTO school_audit_log (actor_type, action, entity_type, entity_id, school_domain)
       VALUES ('system', 'expiry_reminder_sent', 'purchase', ?, ?)`,
      [row.id, row.school_domain]
    ).catch(e => console.error('audit log error:', e.message));

    console.log(`Sent expiry reminder for ${row.school_domain || row.id} (expires ${row.expiration_date})`);
  }

  console.log(`Done. Sent ${rows.length} reminder(s).`);
  await pool.end();
}

main().catch(err => {
  console.error('school-license-expiry-reminder failed:', err.message);
  process.exit(1);
});
