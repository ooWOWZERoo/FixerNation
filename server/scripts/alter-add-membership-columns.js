require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // membership_plans/contact_memberships are brand-new tables — migrate.js's
  // CREATE TABLE IF NOT EXISTS already handles those. This script only
  // covers the two new columns on the pre-existing purchases table.

  if (await columnExists(connection, 'purchases', 'membership_plan_id')) {
    console.log('Skipped (already exists): purchases.membership_plan_id');
  } else {
    await connection.query(
      'ALTER TABLE purchases ADD COLUMN membership_plan_id INT UNSIGNED NULL, ADD FOREIGN KEY (membership_plan_id) REFERENCES membership_plans(id) ON DELETE SET NULL'
    );
    console.log('Added column: purchases.membership_plan_id');
  }

  if (await columnExists(connection, 'purchases', 'stripe_invoice_id')) {
    console.log('Skipped (already exists): purchases.stripe_invoice_id');
  } else {
    await connection.query('ALTER TABLE purchases ADD COLUMN stripe_invoice_id VARCHAR(255) NULL UNIQUE');
    console.log('Added column: purchases.stripe_invoice_id');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
