require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Creates view_as_sessions (staff "view as", phase C of docs/reference/help-support-tools-requirements.md). Idempotent. Run it BEFORE restarting the Node
// app: the gate that now runs before every route reads it only when a request carries X-View-As, but the Account Lookup button needs it.
// db/schema.sql carries the same definition for fresh installs.
const TABLE = `CREATE TABLE IF NOT EXISTS view_as_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id INT UNSIGNED NOT NULL,
  target_site_user_id INT UNSIGNED NOT NULL,
  reason VARCHAR(200) NOT NULL DEFAULT '',
  jti CHAR(32) NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  ended_by VARCHAR(16) NULL,
  UNIQUE KEY uq_jti (jti),
  INDEX idx_target (target_site_user_id, id),
  INDEX idx_admin (admin_id, ended_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [found] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'view_as_sessions']);
  if (found.length) console.log('Skipped: view_as_sessions already exists.');
  else { await connection.query(TABLE); console.log('Created view_as_sessions.'); }
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
