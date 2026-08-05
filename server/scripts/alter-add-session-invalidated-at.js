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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = 'session_invalidated_at'`,
    [process.env.DB_NAME]
  );

  if (cols.length) {
    console.log('Skipped: session_invalidated_at already exists on site_users.');
  } else {
    await connection.query(
      'ALTER TABLE site_users ADD COLUMN session_invalidated_at DATETIME NULL DEFAULT NULL'
    );
    console.log('Added session_invalidated_at to site_users.');
  }

  await connection.end();
}

main().catch(err => { console.error(err); process.exit(1); });
