// Run daily via cPanel Cron Job.
// Expires school licenses whose expiration_date has passed and marks their
// registered seats inactive so hasActiveLicense() returns false immediately.
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
     WHERE p.expiration_date < CURDATE()
       AND p.license_status IN ('active', 'expiring_soon', 'scheduled')
       AND p.product_type IN ('group_license', 'single_license')`
  );

  if (!rows.length) {
    console.log('No licenses to expire.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    const conn = await pool.getConnection();
    let expired = false;
    try {
      await conn.beginTransaction();
      // Re-check the SELECT's own conditions at write time — guards against
      // an admin manually renewing the license in the window between the
      // SELECT above and this UPDATE.
      const [result] = await conn.query(
        "UPDATE purchases SET license_status = 'expired' WHERE id = ? AND license_status IN ('active', 'expiring_soon', 'scheduled')",
        [row.id]
      );
      expired = result.affectedRows > 0;
      if (expired) {
        const [seats] = await conn.query(
          "SELECT registered_site_user_id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id IS NOT NULL AND status IN ('registered', 'pending', 'available')",
          [row.id]
        );
        await conn.query(
          "UPDATE license_seats SET status = 'inactive' WHERE purchase_id = ? AND status IN ('registered', 'pending', 'available')",
          [row.id]
        );
        // hasActiveLicense() denies access immediately either way, but the
        // registered teachers' existing session cookies would otherwise
        // stay valid for non-license-gated features until they naturally
        // expire (up to 30 days).
        const registeredTeachers = seats.map(s => s.registered_site_user_id);
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
      console.log(`Skipped purchase ${row.id} — already renewed/changed concurrently, not expiring.`);
      continue;
    }

    pool.query(
      `INSERT INTO school_audit_log (actor_type, action, entity_type, entity_id, school_domain)
       VALUES ('system', 'license_expired', 'purchase', ?, ?)`,
      [row.id, row.school_domain]
    ).catch(e => console.error('audit log error:', e.message));

    if (row.buyer_email) {
      await fireAutomation('school_license_expired', {
        to: row.buyer_email,
        mergeFields: {
          firstName: (row.buyer_name || '').split(' ')[0] || 'there',
          schoolDomain: row.school_domain || '',
          planName: row.plan_name || 'School License',
          expirationDate: formatDate(row.expiration_date),
        },
      });
    }

    console.log(`Expired license for ${row.school_domain || row.id} (purchase ${row.id})`);
  }

  console.log(`Done. Expired ${rows.length} license(s).`);
  await pool.end();
}

main().catch(err => {
  console.error('expire-school-licenses failed:', err.message);
  process.exit(1);
});
