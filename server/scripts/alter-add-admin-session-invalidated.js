require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Adds admin_users.session_invalidated_at, the admin counterpart of the column
// site_users already has: middleware/auth.js rejects any admin session token
// issued before this timestamp, and it's stamped whenever an admin's password
// changes or is reset. Idempotent -- safe to re-run.
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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'session_invalidated_at'`,
    [process.env.DB_NAME]
  );

  if (cols.length) {
    console.log('Skipped: admin_users.session_invalidated_at already exists.');
  } else {
    await connection.query('ALTER TABLE admin_users ADD COLUMN session_invalidated_at DATETIME NULL AFTER email_verified');
    console.log('Added session_invalidated_at to admin_users.');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
