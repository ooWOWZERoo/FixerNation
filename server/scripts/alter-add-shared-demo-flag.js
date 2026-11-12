require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Adds site_users.is_shared_demo -- the explicit marker for the logins of the shared demo environment (see lib/public-demo.js and
// docs/reference/shared-demo-environment-requirements.md). A real column, not derived, for the same reason as is_sales_demo: a derived flag
// would switch off the moment someone edited the account's seat or assignments. Idempotent; safe to re-run. Must run before the shared demo's
// seed script (a later phase). Nothing changes for any existing account: every one defaults to 0 = not a shared demo account.
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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = 'is_shared_demo'`,
    [process.env.DB_NAME]
  );

  if (cols.length) {
    console.log('Skipped: site_users.is_shared_demo already exists.');
  } else {
    await connection.query('ALTER TABLE site_users ADD COLUMN is_shared_demo TINYINT(1) NOT NULL DEFAULT 0');
    console.log('Added is_shared_demo to site_users (every existing account defaults to 0 = not a shared demo account).');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
