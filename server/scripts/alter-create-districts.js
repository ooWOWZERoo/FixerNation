// Formalizes "district" as a first-class entity grouping schools, for the
// District-Level Branding Hierarchy follow-up to School-Level Branding.
// Creates `districts`, adds `schools.district_id` (nullable — most schools
// have no district), creates `district_branding` (identical column shape to
// school_branding, including the crop columns from
// alter-add-logo-crop-fields.js, since it's a new table and can start with
// them), and creates `district_license_admins` (the site_users join table
// for the new district_admin role — deliberately no permission-level tiers
// like school_license_admins has, since nothing in the district-branding
// spec calls for graded district-admin permissions; every active assignment
// gets full read/write on that district's branding).
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
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    // districts
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

    // schools.district_id
    if (!(await columnExists(conn, 'schools', 'district_id'))) {
      await conn.query('ALTER TABLE schools ADD COLUMN district_id INT UNSIGNED NULL AFTER domain');
      await conn.query(
        'ALTER TABLE schools ADD CONSTRAINT fk_schools_district_id FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE SET NULL'
      );
      console.log('schools: added district_id column + FK');
    } else {
      console.log('schools: district_id already exists, skipping');
    }

    // district_branding — same shape as school_branding (draft/published
    // snapshot pair + crop columns), keyed by district_id.
    if (!(await tableExists(conn, 'district_branding'))) {
      await conn.query(`
        CREATE TABLE district_branding (
          district_id INT UNSIGNED PRIMARY KEY,
          draft_logo_original_url VARCHAR(500) NULL,
          draft_logo_display_url VARCHAR(500) NULL,
          draft_logo_crop JSON NULL,
          draft_primary_color VARCHAR(7) NULL,
          draft_secondary_color VARCHAR(7) NULL,
          draft_accent_color VARCHAR(7) NULL,
          published_logo_original_url VARCHAR(500) NULL,
          published_logo_display_url VARCHAR(500) NULL,
          published_logo_crop JSON NULL,
          published_primary_color VARCHAR(7) NULL,
          published_secondary_color VARCHAR(7) NULL,
          published_accent_color VARCHAR(7) NULL,
          branding_status ENUM('DEFAULT','DRAFT','PUBLISHED') NOT NULL DEFAULT 'DEFAULT',
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          updated_by INT UNSIGNED NULL,
          published_at DATETIME NULL,
          CONSTRAINT fk_district_branding_district FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE,
          CONSTRAINT fk_district_branding_updated_by FOREIGN KEY (updated_by) REFERENCES site_users(id) ON DELETE SET NULL
        )
      `);
      console.log('Created table: district_branding');
    } else {
      console.log('district_branding: already exists, skipping create');
    }

    // district_license_admins — maps site_users to districts (their
    // district-admin scope). No permission_level column, unlike
    // school_license_admins — see file header.
    if (!(await tableExists(conn, 'district_license_admins'))) {
      await conn.query(`
        CREATE TABLE district_license_admins (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          site_user_id INT UNSIGNED NOT NULL,
          district_id INT UNSIGNED NOT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_by_admin_id INT UNSIGNED NULL,
          notes VARCHAR(500) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_user_district (site_user_id, district_id),
          FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
          FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE
        )
      `);
      console.log('Created table: district_license_admins');
    } else {
      console.log('district_license_admins: already exists, skipping create');
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
