// Stage 1 of the sales-affiliate program — see docs/AFFILIATE_PROGRAM_SPIKE.md.
// Creates affiliate_applications + affiliates and adds the two attribution
// columns to purchases. Schema only: nothing reads or writes these tables until
// stage 2 (application form + admin review) ships, so this is safe to run
// ahead of the code that uses it.
//
// purchases.affiliate_id carries a real FK into affiliates rather than being a
// loose integer like school_domain, because an orphaned id here would be worse
// than a missing one: InnoDB recomputes AUTO_INCREMENT from max(id) on restart,
// so a recycled affiliate id could silently re-attribute someone else's old
// sale. ON DELETE SET NULL keeps the sale itself intact if an affiliate's
// account is ever deleted outright (not a designed flow — the admin UI
// suspends instead).
//
// Idempotent, per the alter-*.js convention: every step checks
// information_schema first, so re-running prints "Skipped" instead of failing.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
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

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await tableExists(conn, 'affiliate_applications'))) {
      await conn.query(`
        CREATE TABLE affiliate_applications (
          id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          first_name             VARCHAR(100) NOT NULL,
          last_name              VARCHAR(100) NOT NULL,
          email                  VARCHAR(255) NOT NULL,
          company                VARCHAR(255) NULL,
          phone                  VARCHAR(30) NULL,
          requested_territory    VARCHAR(100) NULL,
          pitch                  TEXT NULL,
          status                 VARCHAR(16) NOT NULL DEFAULT 'pending',
          reviewed_by_admin_id   INT UNSIGNED NULL,
          reviewed_at            DATETIME NULL,
          rejection_reason       VARCHAR(500) NULL,
          resulting_site_user_id INT UNSIGNED NULL,
          created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_status_created (status, created_at),
          INDEX idx_email (email),
          FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
          FOREIGN KEY (resulting_site_user_id) REFERENCES site_users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: affiliate_applications');
    } else {
      console.log('Skipped (already exists): affiliate_applications');
    }

    if (!(await tableExists(conn, 'affiliates'))) {
      await conn.query(`
        CREATE TABLE affiliates (
          id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          site_user_id         INT UNSIGNED NOT NULL UNIQUE,
          application_id       INT UNSIGNED NULL,
          referral_code        VARCHAR(32) NOT NULL UNIQUE,
          commission_rate      DECIMAL(5,2) NOT NULL,
          territory            VARCHAR(100) NULL,
          status               VARCHAR(16) NOT NULL DEFAULT 'active',
          approved_by_admin_id INT UNSIGNED NULL,
          approved_at          DATETIME NULL,
          created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_territory_status (territory, status),
          FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
          FOREIGN KEY (application_id) REFERENCES affiliate_applications(id) ON DELETE SET NULL,
          FOREIGN KEY (approved_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: affiliates');
    } else {
      console.log('Skipped (already exists): affiliates');
    }

    if (!(await columnExists(conn, 'purchases', 'affiliate_id'))) {
      await conn.query(
        'ALTER TABLE purchases ADD COLUMN affiliate_id INT UNSIGNED NULL AFTER license_duration_days, ' +
        'ADD FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE SET NULL'
      );
      console.log('Added column: purchases.affiliate_id');
    } else {
      console.log('Skipped (already exists): purchases.affiliate_id');
    }

    if (!(await columnExists(conn, 'purchases', 'affiliate_commission_cents'))) {
      await conn.query(
        'ALTER TABLE purchases ADD COLUMN affiliate_commission_cents INT UNSIGNED NULL AFTER affiliate_id'
      );
      console.log('Added column: purchases.affiliate_commission_cents');
    } else {
      console.log('Skipped (already exists): purchases.affiliate_commission_cents');
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
