// Fixes: handleMembershipPaymentFailed (server/routes/checkout.js) had no
// idempotency guard, unlike every sibling Stripe webhook handler
// (checkout.session.completed dedupes on stripe_session_id, invoice.paid
// dedupes on stripe_invoice_id) — Stripe explicitly documents that the same
// webhook event can be redelivered (slow/erroring endpoint on first
// attempt), so a redelivered invoice.payment_failed re-sent the past-due
// notice and re-ran the status update every time.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query("SHOW COLUMNS FROM contact_memberships LIKE 'last_failed_invoice_id'");
    if (!rows.length) {
      await conn.query('ALTER TABLE contact_memberships ADD COLUMN last_failed_invoice_id VARCHAR(255) NULL');
      console.log('contact_memberships: added last_failed_invoice_id');
    } else {
      console.log('contact_memberships: last_failed_invoice_id already exists, skipping');
    }
    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
