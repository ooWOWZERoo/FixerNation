require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

// One-off cleanup for quote_requests rows left behind by manual e2e
// verification of the outbound-quoting feature (2026-08-23) — every one of
// these was created by admin-quotes-outbound-and-profiles.spec.ts hitting
// the real "+ New Quote" flow with a disposable @example.com contact.
// Scoped tightly (both name fields AND the email pattern must match) so
// this can never touch a real quote. Confirmed beforehand that none of
// these rows are referenced by any purchases.quote_id — plain DELETE is
// safe, no cascade cleanup needed.

async function main() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT id, first_name, last_name, email, status, origin FROM quote_requests
       WHERE first_name = 'QA' AND last_name = 'OutboundQuoteTest'
         AND email LIKE 'qa-outbound-quote-%@example.com'`
    );
    if (!rows.length) {
      console.log('No matching test quote rows found — nothing to clean up.');
      return;
    }
    console.log(`Found ${rows.length} test quote row(s) to delete:`);
    rows.forEach(r => console.log(`  id=${r.id} ${r.email} status=${r.status} origin=${r.origin}`));

    const [result] = await conn.query(
      `DELETE FROM quote_requests
       WHERE first_name = 'QA' AND last_name = 'OutboundQuoteTest'
         AND email LIKE 'qa-outbound-quote-%@example.com'`
    );
    console.log(`Deleted ${result.affectedRows} row(s).`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('cleanup-qa-outbound-quote-test-rows failed:', err.message);
  process.exit(1);
});
