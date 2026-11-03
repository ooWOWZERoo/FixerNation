// Adds school_invitations.audiences: the grade levels (Elementary School, Middle School, High School, Higher Education,
// comma-joined) a school admin chose when inviting a teacher. When the teacher accepts, these are merged into
// site_user_audiences. The older free-text school_invitations.grade_level column stays; new invites fill it with a short
// code summary such as "ES, MS" so exports and reports keep showing something. Safe to re-run.
// Run it BEFORE restarting the Node app: the new invite code writes this column.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, 'school_invitations', 'audiences']
  );
  if (cols.length) {
    console.log('Skipped (already exists): school_invitations.audiences');
  } else {
    try {
      await conn.query('ALTER TABLE school_invitations ADD COLUMN audiences VARCHAR(255) NULL AFTER grade_level');
      console.log('Added column: school_invitations.audiences');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      console.log('Skipped (already exists): school_invitations.audiences');
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => { console.error('alter-add-invitation-audiences failed:', err.message); process.exit(1); });
