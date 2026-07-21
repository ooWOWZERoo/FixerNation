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

  await connection.query(`
    CREATE TABLE IF NOT EXISTS curriculum_downloads (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      curriculum_id INT UNSIGNED NOT NULL,
      teacher_email VARCHAR(255) NOT NULL,
      count INT UNSIGNED NOT NULL DEFAULT 0,
      last_download DATETIME NULL,
      FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_curriculum_teacher (curriculum_id, teacher_email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('curriculum_downloads table created (or already existed).');
  await connection.end();
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
