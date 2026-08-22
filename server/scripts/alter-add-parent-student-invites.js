// Adds per-child differentiation to the parent portal, which previously
// only linked a parent to a whole classroom (parent_classroom_links had no
// student column at all) — every parent saw identical classroom-level
// content regardless of which child, or how many children, they had there.
//
// student_id is nullable and additive: existing rows keep student_id=NULL
// (today's classroom-level access, unchanged) rather than being touched or
// migrated. Only NEW links going forward carry a real student_id, created
// exclusively through the new teacher-sent per-student invite flow — the
// old parent_code self-join flow is being removed in the same release, so
// no new NULL-student rows will be created after this ships.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, 'parent_classroom_links', 'student_id'))) {
      await conn.query(
        'ALTER TABLE parent_classroom_links ADD COLUMN student_id INT UNSIGNED NULL AFTER classroom_id, ' +
        'ADD FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE SET NULL'
      );
      console.log('Added column: parent_classroom_links.student_id');

      // The old unique key (site_user_id, classroom_id) allowed only one
      // link per parent per classroom at all — which would make a second
      // child in the same classroom silently overwrite the first child's
      // link instead of adding a new one. Widening it to include
      // student_id lets one parent hold a separate row per sibling.
      await conn.query('ALTER TABLE parent_classroom_links DROP INDEX uniq_parent_classroom');
      await conn.query('ALTER TABLE parent_classroom_links ADD UNIQUE KEY uniq_parent_classroom_student (site_user_id, classroom_id, student_id)');
      console.log('Widened unique key: parent_classroom_links.uniq_parent_classroom -> (site_user_id, classroom_id, student_id)');
    } else {
      console.log('Skipped (already exists): parent_classroom_links.student_id');
    }

    if (!(await tableExists(conn, 'parent_student_invitations'))) {
      await conn.query(`
        CREATE TABLE parent_student_invitations (
          id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          classroom_id      INT UNSIGNED NOT NULL,
          student_id        INT UNSIGNED NOT NULL,
          invited_email     VARCHAR(255) NOT NULL,
          invited_name      VARCHAR(150) NULL,
          token             VARCHAR(128) NOT NULL UNIQUE,
          status            VARCHAR(16) NOT NULL DEFAULT 'pending',
          invited_by_site_user_id INT UNSIGNED NULL,
          personal_message  TEXT NULL,
          expires_at        DATETIME NOT NULL,
          revoked_at        DATETIME NULL,
          created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_classroom (classroom_id),
          KEY idx_student (student_id),
          FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
          FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: parent_student_invitations');
    } else {
      console.log('Skipped (already exists): parent_student_invitations');
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
