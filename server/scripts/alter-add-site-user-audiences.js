require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
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

  if (await tableExists(conn, 'site_user_audiences')) {
    console.log('Skipped (already exists): site_user_audiences');
  } else {
    await conn.query(`
      CREATE TABLE site_user_audiences (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_user_id  INT UNSIGNED NOT NULL,
        audience      VARCHAR(64)  NOT NULL,
        UNIQUE KEY uniq_user_audience (site_user_id, audience),
        INDEX idx_site_user (site_user_id),
        FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: site_user_audiences');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
