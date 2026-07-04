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

  const [existing] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, 'campaign_sends']
  );
  if (existing.length) {
    console.log('Skipped (already exists): campaign_sends');
  } else {
    await connection.query(`
      CREATE TABLE campaign_sends (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        campaign_id INT UNSIGNED NOT NULL,
        contact_id INT UNSIGNED NULL,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        status VARCHAR(16) NOT NULL DEFAULT 'sent',
        error_message VARCHAR(500) NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        opened_at DATETIME NULL,
        open_count INT UNSIGNED NOT NULL DEFAULT 0,
        unsubscribed_at DATETIME NULL,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: campaign_sends');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
