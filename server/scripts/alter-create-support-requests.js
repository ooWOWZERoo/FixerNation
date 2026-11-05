require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 115: creates the support-request tables (docs/reference/support-requests-requirements.md). New tables only -- nothing existing
// is altered. Idempotent: each table is created only if it is not already there. db/schema.sql carries the same definitions for fresh
// installs. Order matters (foreign keys): requests first, then their messages.
const TABLES = {
  support_requests: `CREATE TABLE IF NOT EXISTS support_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref VARCHAR(16) NOT NULL UNIQUE, -- short code the person quotes, e.g. SR-4F7K2
  status VARCHAR(24) NOT NULL DEFAULT 'new', -- 'new' | 'open' | 'waiting_on_user' | 'resolved'
  category VARCHAR(32) NOT NULL DEFAULT 'other',
  subject VARCHAR(200) NOT NULL,
  requester_name VARCHAR(120) NOT NULL,
  requester_email VARCHAR(255) NOT NULL,
  site_user_id INT UNSIGNED NULL, -- set only when the person was signed in; never taken from the form
  roles VARCHAR(160) NULL, -- worked out on the server from the account (e.g. 'School license admin, Teacher'); never taken from the form
  school_domain VARCHAR(255) NULL, -- from the account, not the form
  district_id INT UNSIGNED NULL, -- from the account, not the form
  page_url VARCHAR(500) NULL, -- sent by the browser; untrusted text
  user_agent VARCHAR(300) NULL, -- sent by the browser; untrusted text
  assigned_admin_id INT UNSIGNED NULL,
  requester_seen_message_id INT UNSIGNED NOT NULL DEFAULT 0, -- the newest staff reply the person has opened (drives the New reply tag)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  INDEX idx_status (status, updated_at),
  INDEX idx_user (site_user_id),
  INDEX idx_email (requester_email),
  FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  support_request_messages: `CREATE TABLE IF NOT EXISTS support_request_messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  author_type VARCHAR(16) NOT NULL, -- 'requester' | 'staff'
  author_admin_id INT UNSIGNED NULL,
  visibility VARCHAR(16) NOT NULL DEFAULT 'public', -- 'public' (the person sees it) | 'internal' (staff notes; never leaves the admin side)
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_request (request_id, created_at),
  FOREIGN KEY (request_id) REFERENCES support_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (author_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const [name, ddl] of Object.entries(TABLES)) {
    const [rows] = await connection.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [process.env.DB_NAME, name]
    );
    if (rows.length) { console.log(`Skipped: ${name} already exists.`); continue; }
    await connection.query(ddl);
    console.log(`Created ${name}.`);
  }
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
