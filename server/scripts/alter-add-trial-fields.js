require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const db = process.env.DB_NAME;
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [db, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    // license_products columns
    if (!await columnExists(conn, 'license_products', 'is_trial')) {
      await conn.query('ALTER TABLE license_products ADD COLUMN is_trial TINYINT(1) NOT NULL DEFAULT 0 AFTER variable_seats');
      console.log('Added is_trial to license_products');
    }
    if (!await columnExists(conn, 'license_products', 'trial_days')) {
      await conn.query('ALTER TABLE license_products ADD COLUMN trial_days INT UNSIGNED NULL AFTER is_trial');
      console.log('Added trial_days to license_products');
    }
    if (!await columnExists(conn, 'license_products', 'trial_lesson_limit')) {
      await conn.query('ALTER TABLE license_products ADD COLUMN trial_lesson_limit INT UNSIGNED NULL AFTER trial_days');
      console.log('Added trial_lesson_limit to license_products');
    }

    // purchases columns
    if (!await columnExists(conn, 'purchases', 'trial_expiration_date')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN trial_expiration_date DATETIME NULL AFTER expiration_date');
      console.log('Added trial_expiration_date to purchases');
    }
    if (!await columnExists(conn, 'purchases', 'trial_lesson_limit')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN trial_lesson_limit INT UNSIGNED NULL AFTER trial_expiration_date');
      console.log('Added trial_lesson_limit to purchases');
    }
    if (!await columnExists(conn, 'purchases', 'conversion_credit_cents')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN conversion_credit_cents INT UNSIGNED NULL AFTER trial_lesson_limit');
      console.log('Added conversion_credit_cents to purchases');
    }
    if (!await columnExists(conn, 'purchases', 'conversion_credit_redeemed_at')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN conversion_credit_redeemed_at DATETIME NULL AFTER conversion_credit_cents');
      console.log('Added conversion_credit_redeemed_at to purchases');
    }
    if (!await columnExists(conn, 'purchases', 'converted_to_purchase_id')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN converted_to_purchase_id INT UNSIGNED NULL AFTER conversion_credit_redeemed_at');
      console.log('Added converted_to_purchase_id to purchases');
    }

    // trial_curriculum_accesses table
    if (!await tableExists(conn, 'trial_curriculum_accesses')) {
      await conn.query(`
        CREATE TABLE trial_curriculum_accesses (
          purchase_id INT UNSIGNED NOT NULL,
          curriculum_id INT UNSIGNED NOT NULL,
          first_accessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (purchase_id, curriculum_id),
          FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created trial_curriculum_accesses table');
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('alter-add-trial-fields failed:', err.message);
  process.exit(1);
});
