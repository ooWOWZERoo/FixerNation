require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Prospect demo INVITATIONS, phase 2 (docs/reference/shared-demo-workspaces-requirements.md). Creates public_demo_invitations: one row per group's visit,
// holding its label (typed by staff, the group's name), its private access code (and the code's version, which goes up when a new one is made), the
// shared password and PIN of its workspace, its start and end time, and whether it is still active. Times are stored in UTC.
// Idempotent; safe to re-run. Run it after scripts/alter-add-demo-workspaces.js and before restarting the Node app on the release that needs it.
// Nothing changes for any existing visitor: with no invitations the new code behaves exactly as before.
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await connection.query(`
    CREATE TABLE IF NOT EXISTS public_demo_invitations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      label VARCHAR(120) NOT NULL,                       -- the group's name, typed by staff; shown to staff only
      workspace_id INT NOT NULL,                         -- which private workspace (public_demo_workspaces.id) this group uses
      access_code VARCHAR(20) NOT NULL,                  -- 8 letters and digits, no hyphen; never reused, even after the invitation ends
      code_version INT NOT NULL DEFAULT 1,               -- goes up with each new code, so a visitor's gate cookie from the old code stops working
      password VARCHAR(100) NOT NULL DEFAULT '',         -- the workspace's shared password while active; emptied when the invitation ends
      pin VARCHAR(20) NOT NULL DEFAULT '',               -- the workspace's student PIN while active; emptied when the invitation ends
      status VARCHAR(12) NOT NULL DEFAULT 'active',      -- 'active' or 'ended'
      starts_at DATETIME NOT NULL,                       -- UTC
      ends_at DATETIME NOT NULL,                         -- UTC
      ended_at DATETIME NULL,                            -- UTC
      end_reason VARCHAR(20) NULL,                       -- 'ended' (by staff), 'expired' (end time passed) or 'repaired'
      created_by VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_public_demo_invitation_code (access_code),
      INDEX idx_public_demo_invitation_ws (workspace_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('public_demo_invitations is in place.');

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
