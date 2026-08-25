// FNE Content Safety System — Phase 1 tables. See
// CONTENT_SAFETY_IMPLEMENTATION_PLAN.md for the full design. Idempotent —
// safe to re-run (mirrors the columnExists/CREATE TABLE IF NOT EXISTS
// pattern used throughout server/scripts/alter-*.js).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_terms (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        scope ENUM('fne','school') NOT NULL DEFAULT 'school',
        school_domain VARCHAR(255) NULL,
        term VARCHAR(255) NOT NULL,
        category VARCHAR(64) NOT NULL,
        severity TINYINT UNSIGNED NOT NULL DEFAULT 2,
        is_allowlist TINYINT(1) NOT NULL DEFAULT 0,
        created_by_admin_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_school (school_domain)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_terms');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_scans (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        content_context VARCHAR(64) NOT NULL,
        author_site_user_id INT UNSIGNED NULL,
        author_student_id INT UNSIGNED NULL,
        school_domain VARCHAR(255) NULL,
        classroom_id INT UNSIGNED NULL,
        decision VARCHAR(32) NOT NULL,
        matched_rule_snapshot JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_author (author_site_user_id, author_student_id),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_scans');

    // Covers an install that ran an earlier draft of this migration without
    // matched_rule_snapshot.
    if (!await columnExists(conn, 'safety_scans', 'matched_rule_snapshot')) {
      await conn.query('ALTER TABLE safety_scans ADD COLUMN matched_rule_snapshot JSON NULL');
      console.log('Added matched_rule_snapshot to safety_scans');
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_findings (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        scan_id INT UNSIGNED NOT NULL,
        category VARCHAR(64) NOT NULL,
        severity TINYINT UNSIGNED NOT NULL,
        source ENUM('lexical','contextual','image') NOT NULL,
        confidence FLOAT NULL,
        rationale VARCHAR(500) NULL,
        FOREIGN KEY (scan_id) REFERENCES safety_scans(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_findings');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_rules (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        scope ENUM('fne','school') NOT NULL DEFAULT 'fne',
        school_domain VARCHAR(255) NULL,
        category VARCHAR(64) NOT NULL,
        min_severity TINYINT UNSIGNED NOT NULL,
        action ENUM('allow','allow_log','block','block_alert','critical_block_alert') NOT NULL,
        is_locked TINYINT(1) NOT NULL DEFAULT 0,
        created_by_admin_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category, school_domain)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_rules');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_alert_recipients (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        school_domain VARCHAR(255) NOT NULL,
        category VARCHAR(64) NULL,
        email VARCHAR(255) NOT NULL,
        label VARCHAR(100) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by_admin_id INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_school_category (school_domain, category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_alert_recipients');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_incidents (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        scan_id INT UNSIGNED NOT NULL,
        school_domain VARCHAR(255) NULL,
        classroom_id INT UNSIGNED NULL,
        category VARCHAR(64) NOT NULL,
        severity TINYINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (scan_id) REFERENCES safety_scans(id) ON DELETE CASCADE,
        INDEX idx_school (school_domain)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_incidents');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS safety_alerts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        incident_id INT UNSIGNED NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        recipient_kind ENUM('configured_recipient','classroom_teacher','fallback') NOT NULL,
        sent_at DATETIME NULL,
        FOREIGN KEY (incident_id) REFERENCES safety_incidents(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Ensured safety_alerts');

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('alter-add-content-safety failed:', err.message);
  process.exit(1);
});
