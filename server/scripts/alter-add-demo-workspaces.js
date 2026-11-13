require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Prospect demo WORKSPACES, phase 1 (docs/reference/shared-demo-workspaces-requirements.md). Adds:
//   - site_users.demo_workspace_id: which private demo workspace (1..99) a demo login belongs to. A real column, not derived from the account's
//     assignments, for the same reason as is_sales_demo and is_shared_demo: a derived value would change the moment someone edited an assignment.
//     NULL for every existing account, so nothing changes for anyone today.
//   - public_demo_workspaces: one row per workspace (its number, the district, school and purchase that make it up, its status and when it was last
//     reset). Idempotent; safe to re-run. Run it before scripts/seed-demo-workspaces.js, and before restarting the Node app on the release that needs it.
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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = 'demo_workspace_id'`,
    [process.env.DB_NAME]
  );
  if (cols.length) {
    console.log('Skipped: site_users.demo_workspace_id already exists.');
  } else {
    try {
      await connection.query('ALTER TABLE site_users ADD COLUMN demo_workspace_id INT NULL DEFAULT NULL');
      await connection.query('ALTER TABLE site_users ADD INDEX idx_site_users_demo_workspace (demo_workspace_id)');
      console.log('Added demo_workspace_id to site_users (every existing account is NULL = not in a demo workspace).');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_DUP_KEYNAME') throw err;
      console.log('Skipped: site_users.demo_workspace_id already exists.');
    }
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS public_demo_workspaces (
      id INT NOT NULL PRIMARY KEY,                         -- the workspace number (1..99); also the number in its district, school and logins
      district_id INT NULL,
      school_id INT NULL,
      purchase_id INT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'free',          -- 'free' or 'in_use' (an invitation holds it; phase 2)
      last_reset_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('public_demo_workspaces is in place.');

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
