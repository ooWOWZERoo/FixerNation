// Run daily via cPanel Cron Job.
// Reminds a quote recipient 7 days before their quote's validity window
// (quote_valid_until) runs out, if they haven't accepted or been closed out.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { fireAutomation } = require('../lib/automations');

function formatDate(value) {
  const d = new Date(String(value) + 'T00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function main() {
  const [rows] = await pool.query(
    `SELECT id, quote_number, first_name, email, quoted_product_name, quote_valid_until, accept_token
     FROM quote_requests
     WHERE quote_valid_until IS NOT NULL
       AND quote_valid_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       AND accepted_at IS NULL
       AND status != 'closed'
       AND quote_sent_at IS NOT NULL
       AND expiring_reminder_sent_at IS NULL`
  );

  if (!rows.length) {
    console.log('No quote-expiring reminders to send.');
    await pool.end();
    return;
  }

  const siteUrl = process.env.SITE_URL || '';

  for (const row of rows) {
    await pool.query('UPDATE quote_requests SET expiring_reminder_sent_at = NOW() WHERE id = ?', [row.id]);

    await fireAutomation('quote_expiring_soon', {
      to: row.email,
      mergeFields: {
        firstName: row.first_name || 'there',
        quoteNumber: row.quote_number || '',
        productName: row.quoted_product_name || '',
        validUntil: formatDate(row.quote_valid_until),
        acceptUrl: row.accept_token ? `${siteUrl}/accept-quote.html?token=${row.accept_token}` : siteUrl,
      },
    });

    console.log(`Sent quote-expiring reminder for quote ${row.quote_number || row.id} (valid until ${row.quote_valid_until})`);
  }

  console.log(`Done. Sent ${rows.length} reminder(s).`);
  await pool.end();
}

main().catch(err => {
  console.error('quote-expiring-reminder failed:', err.message);
  process.exit(1);
});
