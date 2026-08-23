// Adds an optional district layer above individual schools, per the School-
// Level Branding spec's section 17 (district defaults, schools can override).
// FNE-staff-managed (no self-service district-admin role exists) — see
// server/routes/admin-districts.js. Mirrors school_branding's draft/published
// snapshot-pair design exactly, for the same reason: an in-progress district
// branding edit must never affect what's currently live.
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
    if (!(await tableExists(conn, 'districts'))) {
      await conn.query(`
        CREATE TABLE districts (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Created table: districts');
    } else {
      console.log('districts: already exists, skipping create');
    }

    if (!(await columnExists(conn, 'schools', 'district_id'))) {
      await conn.query('ALTER TABLE schools ADD COLUMN district_id INT UNSIGNED NULL AFTER domain');
      await conn.query(
        'ALTER TABLE schools ADD CONSTRAINT fk_schools_district_id FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE SET NULL'
      );
      console.log('schools: added district_id column + FK');
    } else {
      console.log('schools: district_id already exists, skipping');
    }

    if (!(await tableExists(conn, 'district_branding'))) {
      await conn.query(`
        CREATE TABLE district_branding (
          district_id INT UNSIGNED PRIMARY KEY,
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
          CONSTRAINT fk_district_branding_district FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE,
          CONSTRAINT fk_district_branding_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
        )
      `);
      console.log('Created table: district_branding');
    } else {
      console.log('district_branding: already exists, skipping create');
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
