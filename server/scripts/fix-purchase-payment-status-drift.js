// One-time repair: createPurchaseFromQuote() (quote-accept.js) hardcoded
// paymentStatus:'pending' regardless of payment method, but acceptQuoteViaPO
// creates a $0 quote's invoice already 'paid' at creation time -- nothing
// ever went back to flip the matching purchase row to match, leaving it
// stuck at payment_status='pending' forever despite a genuinely paid
// invoice. That silently blocked inviteTeacherToSeat()'s payment gate
// ("School license is not yet active"), so a school license admin on one
// of these purchases could never invite a teacher. Fixed going forward in
// quote-accept.js; this backfills any purchase already stuck in that state.
// Safe to re-run -- the UPDATE only touches rows where the two are still
// out of sync.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

(async () => {
  const [result] = await pool.query(
    `UPDATE purchases p
     JOIN invoices i ON i.id = p.invoice_id
     SET p.payment_status = 'paid'
     WHERE i.status = 'paid' AND p.payment_status != 'paid'`
  );
  console.log(`Fixed ${result.affectedRows} purchase(s) whose invoice was paid but payment_status hadn't caught up.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
