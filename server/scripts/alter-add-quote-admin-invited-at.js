require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'quote_requests' AND COLUMN_NAME = 'admin_invited_at'`,
    [process.env.DB_NAME]
  );

  if (cols.length) {
    console.log('Skipped: admin_invited_at already exists on quote_requests.');
  } else {
    await connection.query(
      'ALTER TABLE quote_requests ADD COLUMN admin_invited_at DATETIME NULL DEFAULT NULL'
    );
    console.log('Added admin_invited_at to quote_requests.');
  }

  await connection.end();
}

main().catch(err => { console.error(err); process.exit(1); });
