require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 114: adds site_users.closed_at and closed_reason -- a closed account cannot sign in or use the site
// (docs/reference/crm-record-of-truth-requirements.md, rules B and C). Idempotent. Run it BEFORE restarting the Node app:
// the session checks read closed_at.
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  async function addColumn(name, ddl) {
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = ?`,
      [process.env.DB_NAME, name]
    );
    if (cols.length) { console.log(`Skipped: site_users.${name} already exists.`); return; }
    await connection.query(`ALTER TABLE site_users ADD COLUMN ${name} ${ddl}`);
    console.log(`Added ${name} to site_users.`);
  }

  await addColumn('closed_at', 'DATETIME NULL');
  await addColumn('closed_reason', 'VARCHAR(64) NULL');
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
