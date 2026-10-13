require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME IN ('microsoft_oid', 'password_hash')`,
    [process.env.DB_NAME]
  );
  const existing = Object.fromEntries(cols.map(c => [c.COLUMN_NAME, c]));

  if (existing.microsoft_oid) {
    console.log('Skipped: microsoft_oid already exists on site_users.');
  } else {
    await connection.query(
      'ALTER TABLE site_users ADD COLUMN microsoft_oid VARCHAR(255) NULL UNIQUE AFTER password_hash'
    );
    console.log('Added microsoft_oid to site_users.');
  }

  if (existing.password_hash && existing.password_hash.IS_NULLABLE === 'NO') {
    await connection.query('ALTER TABLE site_users MODIFY COLUMN password_hash VARCHAR(255) NULL');
    console.log('Made site_users.password_hash nullable (Microsoft-only accounts have no password).');
  } else {
    console.log('Skipped: site_users.password_hash is already nullable.');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
