// Formalizes "school" as a first-class entity. Today a school is just a
// free-form school_domain string repeated on purchases (no index/FK) — this
// creates a real `schools` table backfilled from those distinct domains,
// adds `purchases.school_id` alongside (not replacing) `school_domain`, and
// creates `school_branding` for the School-Level Branding feature.
//
// school_branding keeps a draft/published SNAPSHOT PAIR rather than one
// column set: "Save Draft" must never affect the live (published) experience
// even when a previous publish already exists, which a single column set
// can't represent.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    // schools
    if (!(await tableExists(conn, 'schools'))) {
      await conn.query(`
        CREATE TABLE schools (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          domain VARCHAR(255) NOT NULL UNIQUE,
          display_name VARCHAR(255) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created table: schools');
    } else {
      console.log('schools: already exists, skipping create');
    }

    // Backfill schools from distinct purchases.school_domain
    const [domainRows] = await conn.query(
      "SELECT DISTINCT school_domain FROM purchases WHERE school_domain IS NOT NULL AND school_domain != ''"
    );
    for (const { school_domain } of domainRows) {
      await conn.query('INSERT IGNORE INTO schools (domain) VALUES (?)', [school_domain]);
    }
    console.log(`schools: backfilled from ${domainRows.length} distinct purchase domain(s)`);

    // purchases.school_id
    if (!(await columnExists(conn, 'purchases', 'school_id'))) {
      await conn.query('ALTER TABLE purchases ADD COLUMN school_id INT UNSIGNED NULL AFTER school_domain');
      await conn.query(
        'ALTER TABLE purchases ADD CONSTRAINT fk_purchases_school_id FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL'
      );
      console.log('purchases: added school_id column + FK');
    } else {
      console.log('purchases: school_id already exists, skipping');
    }

    const [{ affectedRows }] = await conn.query(`
      UPDATE purchases p
      JOIN schools s ON s.domain = p.school_domain
      SET p.school_id = s.id
      WHERE p.school_id IS NULL AND p.school_domain IS NOT NULL
    `);
    console.log(`purchases: backfilled school_id on ${affectedRows} row(s)`);

    // school_branding
    if (!(await tableExists(conn, 'school_branding'))) {
      await conn.query(`
        CREATE TABLE school_branding (
          school_id INT UNSIGNED PRIMARY KEY,
          draft_logo_original_url VARCHAR(500) NULL,
          draft_logo_display_url VARCHAR(500) NULL,
          draft_primary_color VARCHAR(7) NULL,
          draft_secondary_color VARCHAR(7) NULL,
          draft_accent_color VARCHAR(7) NULL,
          published_logo_original_url VARCHAR(500) NULL,
          published_logo_display_url VARCHAR(500) NULL,
          published_primary_color VARCHAR(7) NULL,
          published_secondary_color VARCHAR(7) NULL,
          published_accent_color VARCHAR(7) NULL,
          branding_status ENUM('DEFAULT','DRAFT','PUBLISHED') NOT NULL DEFAULT 'DEFAULT',
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          updated_by INT UNSIGNED NULL,
          published_at DATETIME NULL,
          CONSTRAINT fk_school_branding_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
          CONSTRAINT fk_school_branding_updated_by FOREIGN KEY (updated_by) REFERENCES site_users(id) ON DELETE SET NULL
        )
      `);
      console.log('Created table: school_branding');
    } else {
      console.log('school_branding: already exists, skipping create');
    }

    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
