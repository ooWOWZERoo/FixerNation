require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'FixerNation2026!';

  const [existing] = await connection.query('SELECT id FROM admin_users WHERE username = ?', [username]);
  if (existing.length) {
    console.log(`Admin user "${username}" already exists, skipping.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.query('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    console.log(`Created admin user "${username}".`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('WARNING: using the default demo password. Set ADMIN_USERNAME/ADMIN_PASSWORD env vars before running this against production.');
    }
  }

  await connection.end();
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
