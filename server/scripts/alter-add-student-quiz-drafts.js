// Lets a student save partial quiz progress and resume later. Deliberately a
// SEPARATE table from student_quiz_responses rather than new columns there —
// the existing "any row exists for this student+curriculum" check in
// server/routes/student.js is the entire mechanism enforcing "one attempt
// per quiz" (mirrored client-side by student-lesson.html's quizSubmitted
// derivation). Writing partial answers into that same table would make an
// in-progress attempt indistinguishable from a completed one. Keeping drafts
// here means the one-attempt lock and the results/grading view never need
// to change at all.
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

  if (await tableExists(conn, 'student_quiz_drafts')) {
    console.log('Skipped (already exists): student_quiz_drafts');
  } else {
    await conn.query(`
      CREATE TABLE student_quiz_drafts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id INT UNSIGNED NOT NULL,
        curriculum_id INT UNSIGNED NOT NULL,
        question_id INT UNSIGNED NOT NULL,
        selected_option_index INT UNSIGNED NOT NULL,
        saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_curriculum_question (student_id, curriculum_id, question_id),
        INDEX idx_student_curriculum (student_id, curriculum_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: student_quiz_drafts');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
