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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'quote_requests' AND COLUMN_NAME = 'quote_sent_via'`,
    [process.env.DB_NAME]
  );

  if (!cols.length) {
    await connection.query(
      `ALTER TABLE quote_requests
       ADD COLUMN quote_sent_via ENUM('email','phone') NULL AFTER quote_sent_at`
    );
    console.log('Added column: quote_requests.quote_sent_via');
  } else {
    console.log('Skipped (already exists): quote_requests.quote_sent_via');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
