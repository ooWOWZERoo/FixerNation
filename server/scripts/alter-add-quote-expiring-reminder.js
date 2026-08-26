// Dedup flag for the new quote-expiring-reminder.js cron — mirrors
// purchases.renewal_reminder_sent_at's existing pattern so a quote isn't
// reminded every single day between the 7-day mark and its actual expiry.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  if (await columnExists(conn, 'quote_requests', 'expiring_reminder_sent_at')) {
    console.log('Skipped (already exists): quote_requests.expiring_reminder_sent_at');
  } else {
    await conn.query('ALTER TABLE quote_requests ADD COLUMN expiring_reminder_sent_at DATETIME NULL AFTER quote_valid_until');
    console.log('Added column: quote_requests.expiring_reminder_sent_at');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
