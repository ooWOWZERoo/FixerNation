require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Shared demo environment, phase 4 (docs/reference/shared-demo-environment-requirements.md, R8 and R9). Idempotent; safe to re-run. Run it BEFORE restarting
// the Node app, because the new code writes these columns and this table.
//
//   support_requests.demo_window  INT NOT NULL DEFAULT 0   0 = an ordinary request; N = sent by someone using the shared demo during its Nth window
//   quote_requests.demo_window    INT NOT NULL DEFAULT 0   same
//   public_demo_events            one row per access-code entry or demo sign-in (counts only: no IP address, name or email)
//
// Nothing changes for any existing row: every request already stored keeps demo_window = 0.
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const table of ['support_requests', 'quote_requests']) {
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'demo_window'`,
      [process.env.DB_NAME, table]
    );
    if (cols.length) {
      console.log(`Skipped: ${table}.demo_window already exists.`);
    } else {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN demo_window INT UNSIGNED NOT NULL DEFAULT 0`);
      console.log(`Added demo_window to ${table} (every existing row defaults to 0 = not from the demo).`);
    }
  }

  const [tables] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'public_demo_events'`,
    [process.env.DB_NAME]
  );
  if (tables.length) {
    console.log('Skipped: public_demo_events already exists.');
  } else {
    await connection.query(`CREATE TABLE public_demo_events (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      window_id INT UNSIGNED NOT NULL,
      kind VARCHAR(24) NOT NULL,
      detail VARCHAR(40) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_window_kind (window_id, kind)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created public_demo_events.');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
