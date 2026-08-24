// Adds the "trial library limit" — a separate cap from the existing
// trial_lesson_limit (which gates how many curricula a trial user can even
// PREVIEW, via trial_curriculum_accesses). This new field caps how many
// curricula a trial teacher can permanently ADD to their personal
// "Teacher Lesson Plan Library" (server/routes/teacher-lesson-plans.js),
// which previously used one flat global limit for every teacher regardless
// of trial status. Snapshotted onto purchases at creation time, same
// pattern as trial_lesson_limit/trial_expiration_date, so a later change to
// a product's default doesn't retroactively alter an already-granted trial.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!await columnExists(conn, 'license_products', 'trial_library_limit')) {
      await conn.query('ALTER TABLE license_products ADD COLUMN trial_library_limit INT UNSIGNED NULL AFTER trial_lesson_limit');
      console.log('Added trial_library_limit to license_products');
    }
    if (!await columnExists(conn, 'purchases', 'trial_library_limit')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN trial_library_limit INT UNSIGNED NULL AFTER trial_lesson_limit');
      console.log('Added trial_library_limit to purchases');
    }
    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('alter-add-trial-library-limit failed:', err.message);
  process.exit(1);
});
