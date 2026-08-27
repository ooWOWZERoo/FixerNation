// Adds real execution logging for automated emails — admin-automations.html's
// "Execution History" tab has shipped as a static "coming soon" placeholder
// since it launched because fireAutomation() (server/lib/automations.js) has
// never written a row anywhere recording that a send happened, succeeded, or
// failed. Modeled on the existing campaign_sends logging pattern.
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

  if (await tableExists(conn, 'automation_executions')) {
    console.log('Skipped (already exists): automation_executions');
  } else {
    await conn.query(`
      CREATE TABLE automation_executions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event_key VARCHAR(64) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        status VARCHAR(16) NOT NULL, -- 'success' | 'failed' | 'skipped' (automation disabled/missing at fire time)
        error_message VARCHAR(500) NULL,
        duration_ms INT UNSIGNED NULL,
        fired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_event_key (event_key),
        INDEX idx_fired_at (fired_at),
        INDEX idx_recipient_email (recipient_email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: automation_executions');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
