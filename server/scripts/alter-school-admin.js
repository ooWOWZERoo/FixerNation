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

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // site_users: add role column
  if (await columnExists(conn, 'site_users', 'role')) {
    console.log('Skipped (already exists): site_users.role');
  } else {
    await conn.query("ALTER TABLE site_users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'teacher' AFTER email_verified");
    console.log('Added column: site_users.role');
  }

  // license_seats: add revocation and invitation linkage columns
  for (const [col, def] of [
    ['invitation_id', 'INT UNSIGNED NULL'],
    ['revoked_at', 'DATETIME NULL'],
    ['revoked_by', 'INT UNSIGNED NULL'],
    ['revocation_reason', 'VARCHAR(255) NULL'],
    ['notes', 'VARCHAR(500) NULL'],
  ]) {
    if (await columnExists(conn, 'license_seats', col)) {
      console.log(`Skipped (already exists): license_seats.${col}`);
    } else {
      await conn.query(`ALTER TABLE license_seats ADD COLUMN ${col} ${def}`);
      console.log(`Added column: license_seats.${col}`);
    }
  }

  // school_license_admins: maps site_users to purchases (their school scope)
  if (await tableExists(conn, 'school_license_admins')) {
    console.log('Skipped (already exists): school_license_admins');
  } else {
    await conn.query(`
      CREATE TABLE school_license_admins (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_user_id INT UNSIGNED NOT NULL,
        purchase_id INT UNSIGNED NOT NULL,
        permission_level VARCHAR(16) NOT NULL DEFAULT 'primary',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by_admin_id INT UNSIGNED NULL,
        notes VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_purchase (site_user_id, purchase_id),
        FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: school_license_admins');
  }

  // school_invitations: teacher invitation records
  if (await tableExists(conn, 'school_invitations')) {
    console.log('Skipped (already exists): school_invitations');
  } else {
    await conn.query(`
      CREATE TABLE school_invitations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        purchase_id INT UNSIGNED NOT NULL,
        seat_id INT UNSIGNED NULL,
        invited_email VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NULL,
        last_name VARCHAR(100) NULL,
        token VARCHAR(128) NOT NULL UNIQUE,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        grade_level VARCHAR(64) NULL,
        role_title VARCHAR(128) NULL,
        department VARCHAR(128) NULL,
        subject_area VARCHAR(128) NULL,
        personal_message TEXT NULL,
        invited_by_site_user_id INT UNSIGNED NULL,
        expires_at DATETIME NOT NULL,
        resend_count INT UNSIGNED NOT NULL DEFAULT 0,
        last_resent_at DATETIME NULL,
        revoked_at DATETIME NULL,
        revoked_by_site_user_id INT UNSIGNED NULL,
        revocation_reason VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_token (token),
        INDEX idx_purchase (purchase_id),
        INDEX idx_email (invited_email),
        INDEX idx_status (status),
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
        FOREIGN KEY (seat_id) REFERENCES license_seats(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: school_invitations');
  }

  // school_audit_log: immutable audit trail
  if (await tableExists(conn, 'school_audit_log')) {
    console.log('Skipped (already exists): school_audit_log');
  } else {
    await conn.query(`
      CREATE TABLE school_audit_log (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        actor_type VARCHAR(16) NOT NULL,
        actor_id INT UNSIGNED NULL,
        actor_email VARCHAR(255) NULL,
        action VARCHAR(64) NOT NULL,
        entity_type VARCHAR(32) NULL,
        entity_id INT UNSIGNED NULL,
        purchase_id INT UNSIGNED NULL,
        school_domain VARCHAR(255) NULL,
        prev_value TEXT NULL,
        new_value TEXT NULL,
        reason VARCHAR(255) NULL,
        ip_address VARCHAR(64) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_purchase (purchase_id),
        INDEX idx_actor (actor_type, actor_id),
        INDEX idx_entity (entity_type, entity_id),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: school_audit_log');
  }

  // license_utilization_alerts: throttle duplicate threshold email alerts
  if (await tableExists(conn, 'license_utilization_alerts')) {
    console.log('Skipped (already exists): license_utilization_alerts');
  } else {
    await conn.query(`
      CREATE TABLE license_utilization_alerts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        purchase_id INT UNSIGNED NOT NULL,
        threshold_pct INT UNSIGNED NOT NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_purchase_threshold (purchase_id, threshold_pct, sent_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: license_utilization_alerts');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
