require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 161: creates program_use_snapshots, the monthly school-level adoption totals behind the District Program Use Report's history and
// "last year" view (docs/reference/district-program-report-requirements.md section 8). Counts only: no student id, teacher id, name or text.
// Idempotent. Run it BEFORE restarting the Node app (the report reads the table for last year), then run
// `node scripts/snapshot-program-use.js --backfill --apply` once. db/schema.sql carries the same definition for fresh installs.
const TABLE = `CREATE TABLE IF NOT EXISTS program_use_snapshots (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_year_start SMALLINT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,
  school_id INT UNSIGNED NOT NULL,
  district_id INT UNSIGNED NULL,
  teachers_licensed INT UNSIGNED NOT NULL,
  teachers_activated INT UNSIGNED NOT NULL,
  teachers_teaching INT UNSIGNED NOT NULL,
  teachers_teaching_ytd INT UNSIGNED NOT NULL,
  classrooms INT UNSIGNED NOT NULL,
  classrooms_active INT UNSIGNED NOT NULL,
  classrooms_regular INT UNSIGNED NOT NULL,
  students_enrolled INT UNSIGNED NOT NULL,
  students_active INT UNSIGNED NOT NULL,
  students_active_ytd INT UNSIGNED NOT NULL,
  activities INT UNSIGNED NOT NULL,
  source VARCHAR(10) NOT NULL DEFAULT 'monthly',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snapshot (school_year_start, month, school_id),
  INDEX idx_district_year (district_id, school_year_start)
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
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'program_use_snapshots']);
  if (tables.length) console.log('Skipped: program_use_snapshots already exists.');
  else { await connection.query(TABLE); console.log('Created program_use_snapshots.'); }
  await connection.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
