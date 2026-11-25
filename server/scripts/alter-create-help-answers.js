require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Creates help_answers and help_answer_versions (the Help center editor, Support > Help Content;
// docs/reference/help-support-tools-requirements.md section A). Idempotent. Run it BEFORE restarting the Node app: the new routes read
// both tables (the public Help center falls back to help-center.js if they are missing, but the editor needs them).
// db/schema.sql carries the same definitions for fresh installs.
const TABLES = {
  help_answers: `CREATE TABLE IF NOT EXISTS help_answers (
  id VARCHAR(60) NOT NULL PRIMARY KEY,
  status VARCHAR(12) NOT NULL DEFAULT 'draft',
  audiences VARCHAR(120) NOT NULL DEFAULT 'everyone',
  topic VARCHAR(60) NOT NULL DEFAULT '',
  help_topic VARCHAR(40) NOT NULL DEFAULT 'other',
  video VARCHAR(8) NOT NULL DEFAULT '',
  question VARCHAR(300) NOT NULL DEFAULT '',
  answer TEXT NOT NULL,
  steps TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  help_answer_versions: `CREATE TABLE IF NOT EXISTS help_answer_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  answer_id VARCHAR(60) NOT NULL,
  snapshot TEXT NOT NULL,
  saved_by INT UNSIGNED NULL,
  saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_answer (answer_id, id)
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
    const [found] = await connection.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, name]);
    if (found.length) { console.log(`Skipped: ${name} already exists.`); continue; }
    await connection.query(ddl);
    console.log(`Created ${name}.`);
  }
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
