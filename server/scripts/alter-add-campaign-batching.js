// Adds campaigns.next_batch_at / .total_recipients_at_send — supports
// sending a large campaign in batches over time (campaign_batch_size /
// campaign_batch_interval_minutes settings) instead of firing the entire
// audience in one uninterrupted burst.
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
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  if (await columnExists(connection, 'campaigns', 'next_batch_at')) {
    console.log('Skipped (already exists): campaigns.next_batch_at');
  } else {
    await connection.query('ALTER TABLE campaigns ADD COLUMN next_batch_at DATETIME NULL AFTER scheduled_for');
    console.log('Added column: campaigns.next_batch_at');
  }

  if (await columnExists(connection, 'campaigns', 'total_recipients_at_send')) {
    console.log('Skipped (already exists): campaigns.total_recipients_at_send');
  } else {
    await connection.query('ALTER TABLE campaigns ADD COLUMN total_recipients_at_send INT UNSIGNED NULL AFTER recipient_count');
    console.log('Added column: campaigns.total_recipients_at_send');
  }

  await connection.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
