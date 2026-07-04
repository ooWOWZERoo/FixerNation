require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

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

  if (await tableExists(connection, 'analytics_sessions')) {
    console.log('Skipped (already exists): analytics_sessions');
  } else {
    await connection.query(`
      CREATE TABLE analytics_sessions (
        id VARCHAR(36) PRIMARY KEY,
        entry_page VARCHAR(512),
        referrer VARCHAR(512),
        user_agent VARCHAR(255),
        first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: analytics_sessions');
  }

  if (await tableExists(connection, 'analytics_events')) {
    console.log('Skipped (already exists): analytics_events');
  } else {
    await connection.query(`
      CREATE TABLE analytics_events (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(36) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        page VARCHAR(512),
        label VARCHAR(255),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES analytics_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: analytics_events');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
