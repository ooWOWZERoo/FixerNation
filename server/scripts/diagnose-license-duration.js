// Read-only diagnostic — prints every license purchase's status, whether it
// already has a license_duration_days snapshot, and whether its product has
// a duration_days set, so we can see exactly why the backfill found nothing.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const [rows] = await pool.query(
    `SELECT p.id AS purchase_id, p.license_status, p.license_duration_days,
            p.trial_expiration_date, p.school_domain, p.invoice_id,
            lp.id AS license_product_id, lp.name AS product_name, lp.duration_days AS product_duration_days
     FROM purchases p
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.product_type IN ('single_license', 'group_license')
     ORDER BY p.id DESC
     LIMIT 25`
  );

  if (!rows.length) {
    console.log('No license purchases found at all.');
  } else {
    console.table(rows.map(r => ({
      purchase_id: r.purchase_id,
      status: r.license_status,
      duration_snapshot: r.license_duration_days,
      is_trial: !!r.trial_expiration_date,
      school: r.school_domain,
      invoice_id: r.invoice_id,
      product: r.product_name,
      product_duration_days: r.product_duration_days,
    })));
  }

  await pool.end();
}

main().catch(err => {
  console.error('Diagnostic failed:', err.message);
  process.exit(1);
});
