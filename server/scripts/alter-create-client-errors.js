require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 122: creates the client_errors table (error capture; docs/reference/error-capture-requirements.md) and adds
// support_requests.client_session_id (so a support request can show that browser's recent errors). Idempotent. Run it BEFORE restarting
// the Node app: the new code reads and writes both. db/schema.sql carries the same definitions for fresh installs.
const TABLE = `CREATE TABLE IF NOT EXISTS client_errors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(24) NOT NULL,
  page_path VARCHAR(200) NOT NULL DEFAULT '',
  api_path VARCHAR(200) NOT NULL DEFAULT '',
  method VARCHAR(8) NOT NULL DEFAULT '',
  http_status SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  message VARCHAR(300) NOT NULL DEFAULT '',
  source VARCHAR(200) NOT NULL DEFAULT '',
  user_kind VARCHAR(12) NOT NULL DEFAULT 'visitor',
  site_user_id INT UNSIGNED NULL,
  client_session_id VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(300) NOT NULL DEFAULT '',
  occurrences INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_last_seen (last_seen),
  INDEX idx_kind (kind, last_seen),
  INDEX idx_user (site_user_id, last_seen),
  INDEX idx_session (client_session_id, last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [tables] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'client_errors']);
  if (tables.length) {
    console.log('Skipped: client_errors already exists.');
  } else {
    await connection.query(TABLE);
    console.log('Created client_errors.');
  }

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'support_requests' AND COLUMN_NAME = 'client_session_id'`,
    [process.env.DB_NAME]);
  if (cols.length) {
    console.log('Skipped: support_requests.client_session_id already exists.');
  } else {
    await connection.query('ALTER TABLE support_requests ADD COLUMN client_session_id VARCHAR(64) NULL');
    console.log('Added client_session_id to support_requests.');
  }
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
