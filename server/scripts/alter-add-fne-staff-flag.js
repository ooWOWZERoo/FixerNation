require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 113: adds site_users.is_fne_staff -- marks a sign-in account that belongs to Fixer Nation staff, who may join and see every
// Community group, including a school's private group (docs/reference/community-group-privacy-requirements.md, rule A4). It grants
// nothing else, and it is not the staff login (admin_users). Set per account with scripts/set-fne-staff-account.js. Idempotent. Run it
// BEFORE restarting the Node app: the Community group queries read the column.
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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = 'is_fne_staff'`,
    [process.env.DB_NAME]
  );

  if (cols.length) {
    console.log('Skipped: site_users.is_fne_staff already exists.');
  } else {
    await connection.query('ALTER TABLE site_users ADD COLUMN is_fne_staff TINYINT(1) NOT NULL DEFAULT 0');
    console.log('Added is_fne_staff to site_users (every existing account defaults to 0 = not staff).');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
