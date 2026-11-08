require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 155: creates pog_evidence_snapshots, the de-identified year totals for Graduate Evidence
// (docs/reference/pog-evidence-requirements.md section 14). Counts only: no student id, name or text. Idempotent. Run it before
// the first `node scripts/snapshot-pog-evidence.js --apply`; nothing in the running app reads the table, so no restart is needed.
// db/schema.sql carries the same definition for fresh installs.
const TABLE = `CREATE TABLE IF NOT EXISTS pog_evidence_snapshots (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  state_code CHAR(2) NOT NULL,
  school_year_start SMALLINT UNSIGNED NOT NULL,
  classroom_id INT UNSIGNED NOT NULL,
  framework_id INT UNSIGNED NOT NULL,
  framework_name VARCHAR(255) NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  item_code VARCHAR(40) NOT NULL,
  item_title VARCHAR(255) NOT NULL,
  students_counted INT UNSIGNED NOT NULL,
  practiced INT UNSIGNED NOT NULL,
  touched INT UNSIGNED NOT NULL,
  activities_finished INT UNSIGNED NOT NULL,
  direct_activities SMALLINT UNSIGNED NOT NULL,
  supporting_activities SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snapshot (state_code, school_year_start, classroom_id, item_id),
  INDEX idx_classroom_year (classroom_id, school_year_start)
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
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'pog_evidence_snapshots']);
  if (tables.length) console.log('Skipped: pog_evidence_snapshots already exists.');
  else { await connection.query(TABLE); console.log('Created pog_evidence_snapshots.'); }
  await connection.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
