require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Creates error_alerts (error spike alerts, phase B of docs/reference/help-support-tools-requirements.md). Idempotent. Run it BEFORE restarting the Node
// app: the new Errors page card and test button read and write it. db/schema.sql carries the same definition for fresh installs.
const TABLE = `CREATE TABLE IF NOT EXISTS error_alerts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_key CHAR(40) NOT NULL DEFAULT '',
  kind VARCHAR(24) NOT NULL DEFAULT '',
  summary VARCHAR(300) NOT NULL DEFAULT '',
  reports INT UNSIGNED NOT NULL DEFAULT 0,
  browsers INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(8) NOT NULL DEFAULT 'sent',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_group (group_key, created_at),
  INDEX idx_created (created_at)
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
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'error_alerts']);
  if (found.length) console.log('Skipped: error_alerts already exists.');
  else { await connection.query(TABLE); console.log('Created error_alerts.'); }
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
