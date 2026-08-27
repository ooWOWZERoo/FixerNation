// One-off, idempotent backfill: fills in purchases.license_duration_days for
// purchases still 'pending' (a PO order not yet marked "PO Received") whose
// license product now has a duration_days set — safe because a pending
// purchase hasn't had effective_date/expiration_date computed yet, so this
// only affects what happens the moment it's later marked received.
//
// Deliberately does NOT touch active/expired/scheduled purchases — those
// already had their license term start at some real point in the past, and
// backfilling a duration now would let po-received-style logic (elsewhere)
// invent a start date for something we don't actually know the answer to.
// Re-running is a no-op the second time (WHERE license_duration_days IS NULL).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const [rows] = await pool.query(
    `SELECT p.id, p.quote_id, lp.duration_days AS base_duration_days, qr.quoted_term_years
     FROM purchases p
     JOIN license_products lp ON lp.id = p.license_product_id
     LEFT JOIN quote_requests qr ON qr.id = p.quote_id
     WHERE p.license_status = 'pending'
       AND p.license_duration_days IS NULL
       AND p.trial_expiration_date IS NULL
       AND lp.duration_days IS NOT NULL`
  );

  if (!rows.length) {
    console.log('Nothing to backfill.');
    await pool.end();
    return;
  }

  for (const row of rows) {
    // Same scaling quote-accept.js applies at purchase time: a quoted
    // multi-year term multiplies the product's base duration.
    const licenseDurationDays = row.base_duration_days * (row.quoted_term_years || 1);
    await pool.query('UPDATE purchases SET license_duration_days = ? WHERE id = ?', [licenseDurationDays, row.id]);
    console.log(`Purchase ${row.id}: set license_duration_days = ${licenseDurationDays}`);
  }

  console.log(`Done. Backfilled ${rows.length} purchase(s).`);
  await pool.end();
}

main().catch(err => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
