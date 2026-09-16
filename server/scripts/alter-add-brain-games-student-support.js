// Lets classroom-PIN students (classroom_students) earn real Brain Games
// progress/XP/badges/streaks, which the schema has never supported — every
// brain-games table only ever had a NOT NULL FK to site_users(id). Adds a
// parallel nullable student_id column (FK to classroom_students(id)) to each
// table, widens user_id to nullable, and adds the matching unique keys —
// same pattern already used for parent_classroom_links.student_id. Exactly
// one of user_id/student_id is populated per row; enforced at the
// application layer (server/routes/brain-games.js), not by a DB constraint.
//
// Safe to re-run: each table's block is skipped once its student_id column
// exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [r] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
    [process.env.DB_NAME, table, column]
  );
  return r.length > 0;
}

const TABLES = [
  { name: 'brain_game_sessions',     unique: false },
  { name: 'brain_game_user_progress', unique: true, uniqueCols: 'student_id, game_id', uniqueName: 'uniq_student_game' },
  { name: 'user_brain_badges',       unique: true, uniqueCols: 'student_id, badge_id', uniqueName: 'uniq_student_badge' },
  { name: 'brain_user_streaks',      unique: true, uniqueCols: 'student_id',           uniqueName: 'uniq_student' },
  { name: 'brain_game_privacy',      unique: true, uniqueCols: 'student_id',           uniqueName: 'uniq_student' },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  for (const t of TABLES) {
    if (await columnExists(conn, t.name, 'student_id')) {
      console.log(`Skipped (already has student_id): ${t.name}`);
      continue;
    }

    await conn.query(`ALTER TABLE ${t.name} MODIFY COLUMN user_id INT UNSIGNED NULL`);
    await conn.query(
      `ALTER TABLE ${t.name} ADD COLUMN student_id INT UNSIGNED NULL AFTER user_id`
    );
    await conn.query(
      `ALTER TABLE ${t.name} ADD CONSTRAINT fk_${t.name}_student
         FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE`
    );
    if (t.unique) {
      await conn.query(
        `ALTER TABLE ${t.name} ADD UNIQUE KEY ${t.uniqueName} (${t.uniqueCols})`
      );
    } else {
      // brain_game_sessions — mirror the existing idx_user_game (user_id, game_id) shape.
      await conn.query(
        `ALTER TABLE ${t.name} ADD INDEX idx_student_game (student_id, game_id)`
      );
    }
    console.log(`Widened for PIN-student support: ${t.name}`);
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
