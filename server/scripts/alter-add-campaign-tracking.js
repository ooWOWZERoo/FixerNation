require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
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

  if (await columnExists(connection, 'campaign_sends', 'clicked_at')) {
    console.log('Skipped (already exists): campaign_sends.clicked_at');
  } else {
    await connection.query('ALTER TABLE campaign_sends ADD COLUMN clicked_at DATETIME NULL');
    console.log('Added column: campaign_sends.clicked_at');
  }

  if (await columnExists(connection, 'campaign_sends', 'click_count')) {
    console.log('Skipped (already exists): campaign_sends.click_count');
  } else {
    await connection.query('ALTER TABLE campaign_sends ADD COLUMN click_count INT UNSIGNED NOT NULL DEFAULT 0');
    console.log('Added column: campaign_sends.click_count');
  }

  if (await tableExists(connection, 'campaign_link_targets')) {
    console.log('Skipped (already exists): campaign_link_targets');
  } else {
    await connection.query(`
      CREATE TABLE campaign_link_targets (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        send_id INT UNSIGNED NOT NULL,
        link_id VARCHAR(32) NOT NULL UNIQUE,
        destination_url VARCHAR(2048) NOT NULL,
        click_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (send_id) REFERENCES campaign_sends(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: campaign_link_targets');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
