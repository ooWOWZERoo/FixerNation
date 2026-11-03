// Creates teacher_lesson_plan_swaps: one row each time a teacher removes (or swaps out) a lesson from My Lesson Plans.
// A teacher's swaps used = rows with voided_at NULL; an FNE admin's "reset swaps" sets voided_at instead of deleting, so the
// history stays. Safe to re-run. Run it BEFORE restarting the Node app: the new teacher routes read this table.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  if (await tableExists(conn, 'teacher_lesson_plan_swaps')) {
    console.log('Skipped (already exists): teacher_lesson_plan_swaps');
  } else {
    await conn.query(`
      CREATE TABLE teacher_lesson_plan_swaps (
        id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_user_id          INT UNSIGNED NOT NULL,
        removed_curriculum_id INT UNSIGNED NOT NULL,
        added_curriculum_id   INT UNSIGNED NULL,
        swapped_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        voided_at             DATETIME NULL,
        INDEX idx_user_voided (site_user_id, voided_at),
        FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: teacher_lesson_plan_swaps');
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => { console.error('alter-add-teacher-lesson-plan-swaps failed:', err.message); process.exit(1); });
