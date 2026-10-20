require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Adds site_users.is_sales_demo -- the explicit marker for sales-demo accounts
// (see lib/sales-demo.js for why it is a real column and not derived). Idempotent;
// safe to re-run. Must be run before scripts/seed-sales-demo-account.js.
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = 'is_sales_demo'`,
    [process.env.DB_NAME]
  );

  if (cols.length) {
    console.log('Skipped: site_users.is_sales_demo already exists.');
  } else {
    await connection.query('ALTER TABLE site_users ADD COLUMN is_sales_demo TINYINT(1) NOT NULL DEFAULT 0');
    console.log('Added is_sales_demo to site_users (every existing account defaults to 0 = not a demo account).');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
