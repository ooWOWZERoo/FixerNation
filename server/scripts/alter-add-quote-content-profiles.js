require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { getSetting } = require('../lib/settings');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS quote_content_profiles (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL UNIQUE,
        section_annual_includes TEXT,
        section_lesson_package TEXT,
        section_video_access TEXT,
        section_license_terms TEXT,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured table: quote_content_profiles');

    const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM quote_content_profiles');
    let standardId;
    if (count === 0) {
      const [s1, s2, s3, s4] = await Promise.all([
        getSetting('quote_section_annual_includes'),
        getSetting('quote_section_lesson_package'),
        getSetting('quote_section_video_access'),
        getSetting('quote_section_license_terms'),
      ]);
      const [result] = await conn.query(
        `INSERT INTO quote_content_profiles
           (name, section_annual_includes, section_lesson_package, section_video_access, section_license_terms, is_default)
         VALUES ('Standard', ?, ?, ?, ?, 1)`,
        [s1 || '', s2 || '', s3 || '', s4 || '']
      );
      standardId = result.insertId;
      console.log(`Seeded default "Standard" profile (id ${standardId}) from existing quote settings.`);
    } else {
      const [[def]] = await conn.query('SELECT id FROM quote_content_profiles WHERE is_default = 1 LIMIT 1');
      standardId = def ? def.id : null;
      console.log('Skipped seeding: quote_content_profiles already has rows.');
    }

    if (!await columnExists(conn, 'quote_requests', 'content_profile_id')) {
      await conn.query('ALTER TABLE quote_requests ADD COLUMN content_profile_id INT UNSIGNED NULL AFTER quoted_school_domain');
      console.log('Added content_profile_id to quote_requests');
    }
    if (!await columnExists(conn, 'quote_requests', 'origin')) {
      await conn.query("ALTER TABLE quote_requests ADD COLUMN origin VARCHAR(10) NOT NULL DEFAULT 'inbound' AFTER content_profile_id");
      console.log('Added origin to quote_requests');
    }

    // Add the FK separately (guarded) so re-running this script is always safe.
    const [[fkExists]] = await conn.query(`
      SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_requests' AND CONSTRAINT_NAME = 'fk_quote_requests_content_profile'
    `);
    if (fkExists.n === 0) {
      await conn.query(`
        ALTER TABLE quote_requests
        ADD CONSTRAINT fk_quote_requests_content_profile
        FOREIGN KEY (content_profile_id) REFERENCES quote_content_profiles(id) ON DELETE SET NULL
      `);
      console.log('Added FK: quote_requests.content_profile_id -> quote_content_profiles.id');
    }

    if (standardId) {
      const [backfill] = await conn.query(
        'UPDATE quote_requests SET content_profile_id = ? WHERE content_profile_id IS NULL',
        [standardId]
      );
      console.log(`Backfilled content_profile_id on ${backfill.affectedRows} existing quote(s).`);
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('alter-add-quote-content-profiles failed:', err.message);
  process.exit(1);
});
