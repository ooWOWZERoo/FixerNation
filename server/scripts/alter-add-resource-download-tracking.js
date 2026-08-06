require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [process.env.DB_NAME, table, indexName]
  );
  return rows.length > 0;
}

function generateParentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function uniqueParentCode(conn) {
  let code, tries = 0;
  do {
    code = generateParentCode();
    const [r] = await conn.query('SELECT id FROM classrooms WHERE parent_code = ?', [code]);
    if (!r.length) return code;
  } while (++tries < 20);
  throw new Error('Failed to generate unique parent code');
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // ── Step A: Alter curriculum_downloads ──────────────────────────────────

  // Rename teacher_email → user_email (only if user_email absent AND teacher_email present)
  const hasUserEmail = await columnExists(conn, 'curriculum_downloads', 'user_email');
  const hasTeacherEmail = await columnExists(conn, 'curriculum_downloads', 'teacher_email');

  if (!hasUserEmail && hasTeacherEmail) {
    await conn.query('ALTER TABLE curriculum_downloads CHANGE COLUMN teacher_email user_email VARCHAR(255) NOT NULL');
    console.log('Renamed column: curriculum_downloads.teacher_email → user_email');
  } else if (hasUserEmail) {
    console.log('Skipped (already exists): curriculum_downloads.user_email');
  } else {
    console.log('WARNING: curriculum_downloads has neither teacher_email nor user_email — skipping rename');
  }

  if (await columnExists(conn, 'curriculum_downloads', 'user_type')) {
    console.log('Skipped (already exists): curriculum_downloads.user_type');
  } else {
    await conn.query("ALTER TABLE curriculum_downloads ADD COLUMN user_type VARCHAR(16) NOT NULL DEFAULT 'teacher' AFTER user_email");
    console.log('Added column: curriculum_downloads.user_type');
  }

  if (await columnExists(conn, 'curriculum_downloads', 'resource_type')) {
    console.log('Skipped (already exists): curriculum_downloads.resource_type');
  } else {
    await conn.query("ALTER TABLE curriculum_downloads ADD COLUMN resource_type VARCHAR(64) NOT NULL DEFAULT 'any' AFTER user_type");
    console.log('Added column: curriculum_downloads.resource_type');
  }

  // Drop old unique key if present
  if (await indexExists(conn, 'curriculum_downloads', 'uniq_curriculum_teacher')) {
    await conn.query('ALTER TABLE curriculum_downloads DROP INDEX uniq_curriculum_teacher');
    console.log('Dropped index: uniq_curriculum_teacher');
  } else {
    console.log('Skipped (not found): index uniq_curriculum_teacher');
  }

  // Add new 4-column unique key
  if (await indexExists(conn, 'curriculum_downloads', 'uniq_resource_download')) {
    console.log('Skipped (already exists): index uniq_resource_download');
  } else {
    await conn.query('ALTER TABLE curriculum_downloads ADD UNIQUE KEY uniq_resource_download (curriculum_id, user_email, user_type, resource_type)');
    console.log('Added unique key: uniq_resource_download');
  }

  // ── Step B: Alter curriculum_resources ──────────────────────────────────

  if (await columnExists(conn, 'curriculum_resources', 'download_limit')) {
    console.log('Skipped (already exists): curriculum_resources.download_limit');
  } else {
    await conn.query('ALTER TABLE curriculum_resources ADD COLUMN download_limit INT UNSIGNED NOT NULL DEFAULT 0 AFTER file_name');
    console.log('Added column: curriculum_resources.download_limit');
  }

  // ── Step C: Alter classrooms (parent_code) + backfill ───────────────────

  if (await columnExists(conn, 'classrooms', 'parent_code')) {
    console.log('Skipped (already exists): classrooms.parent_code');
  } else {
    await conn.query('ALTER TABLE classrooms ADD COLUMN parent_code VARCHAR(32) NULL UNIQUE AFTER join_code');
    console.log('Added column: classrooms.parent_code');
  }

  // Backfill parent_code for existing classrooms
  const [nullRows] = await conn.query('SELECT id FROM classrooms WHERE parent_code IS NULL');
  let backfilled = 0;
  for (const row of nullRows) {
    const code = await uniqueParentCode(conn);
    await conn.query('UPDATE classrooms SET parent_code = ? WHERE id = ?', [code, row.id]);
    backfilled++;
  }
  if (backfilled > 0) {
    console.log(`Backfilled parent_code for ${backfilled} classroom(s)`);
  } else {
    console.log('No classrooms needed parent_code backfill');
  }

  // ── Step D: Create parent_classroom_links ────────────────────────────────

  if (await tableExists(conn, 'parent_classroom_links')) {
    console.log('Skipped (already exists): parent_classroom_links');
  } else {
    await conn.query(`
      CREATE TABLE parent_classroom_links (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_user_id  INT UNSIGNED NOT NULL,
        classroom_id  INT UNSIGNED NOT NULL,
        linked_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_parent_classroom (site_user_id, classroom_id),
        FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: parent_classroom_links');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
