require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 157: creates student_portrait_pins (My Graduate Portrait, tier 1; docs/reference/graduate-portrait-requirements.md section 5).
// A pin points at one of the student's own reflections or goals; it is deleted with the student (ON DELETE CASCADE), so the
// student-data purge needs no change. Idempotent. Run it BEFORE restarting the Node app: the new routes read the table.
// db/schema.sql carries the same definition for fresh installs.
const TABLE = `CREATE TABLE IF NOT EXISTS student_portrait_pins (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  kind VARCHAR(12) NOT NULL,
  source_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NULL,
  school_year_start SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pin (student_id, kind, source_id),
  KEY idx_student_year (student_id, school_year_start),
  FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE
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
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'student_portrait_pins']);
  if (tables.length) console.log('Skipped: student_portrait_pins already exists.');
  else { await connection.query(TABLE); console.log('Created student_portrait_pins.'); }
  await connection.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
