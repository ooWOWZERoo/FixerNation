require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Prospect demo invitations, phase 4 (docs/reference/shared-demo-workspaces-requirements.md, R8): tickets, quote requests and demo visits are tagged with the
// INVITATION (the group) they came from, so staff see "Demo: Springfield USD" and each group has its own counts. Idempotent; safe to re-run. Run it BEFORE
// restarting the Node app, because the new code writes these columns.
//
//   support_requests.demo_invitation_id  INT UNSIGNED NOT NULL DEFAULT 0   0 = not from a group's demo; N = sent by someone in invitation N's demo
//   quote_requests.demo_invitation_id    INT UNSIGNED NOT NULL DEFAULT 0   same
//   public_demo_events.invitation_id     INT UNSIGNED NOT NULL DEFAULT 0   0 = the original demo's event; N = an access-code entry or sign-in for invitation N
//
// Nothing changes for any row already stored: every one keeps 0, and the original demo's tags (demo_window) are untouched.
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const [table, column] of [['support_requests', 'demo_invitation_id'], ['quote_requests', 'demo_invitation_id'], ['public_demo_events', 'invitation_id']]) {
    const [tables] = await connection.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, table]);
    if (!tables.length) { console.log(`Skipped: ${table} does not exist here (run its own alter script first).`); continue; }
    const [cols] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [process.env.DB_NAME, table, column]);
    if (cols.length) {
      console.log(`Skipped: ${table}.${column} already exists.`);
      continue;
    }
    try {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} INT UNSIGNED NOT NULL DEFAULT 0`);
      await connection.query(`ALTER TABLE ${table} ADD INDEX idx_${table}_${column} (${column})`);
      console.log(`Added ${column} to ${table} (every existing row defaults to 0).`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_DUP_KEYNAME') throw err;
      console.log(`Skipped: ${table}.${column} already exists.`);
    }
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
