require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Customer Hub follow-up to G17: the "not a duplicate" memory. One small table holding the pairs of accounts a person has said are separate organizations, so the pair stops being
// listed on Accounts > Possible duplicates. Idempotent; safe to re-run. Run it BEFORE restarting the Node app: until it has run the duplicates list still works, and the "Not a duplicate"
// buttons say it is not available yet. Additive only: no existing table, column or row is changed.
//
//   node scripts/alter-create-crm-not-duplicates.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['crm_accounts', 'admin_users']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_account_not_duplicates')) console.log('Skipped: crm_account_not_duplicates already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_account_not_duplicates (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      account_a_id INT UNSIGNED NOT NULL,
      account_b_id INT UNSIGNED NOT NULL,
      decided_by_admin_id INT UNSIGNED NULL,
      decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_not_dup_pair (account_a_id, account_b_id),
      KEY idx_crm_not_dup_b (account_b_id),
      CONSTRAINT fk_crm_not_dup_a FOREIGN KEY (account_a_id) REFERENCES crm_accounts (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_not_dup_b FOREIGN KEY (account_b_id) REFERENCES crm_accounts (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_not_dup_admin FOREIGN KEY (decided_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_account_not_duplicates.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
