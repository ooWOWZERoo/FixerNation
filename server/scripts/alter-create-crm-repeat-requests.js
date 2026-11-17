require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G5 (FR-RENEW-02): the table of reorder and seat-change requests that a district administrator makes from the District Admin portal and staff
// approve or decline. Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the portal page and the Customer Hub page read it (both say "not available yet" while it
// is missing). Additive only: no existing table, column or row is changed, and nothing is back-filled.
//
//   node scripts/alter-create-crm-repeat-requests.js
//
// Creates crm_repeat_requests. `open_flag` is 1 while a request is Waiting and NULL after, and (purchase_id, open_flag) is unique, so a license can have only one Waiting request
// (NULLs never collide, so any number of finished ones are fine). The purchase is only read; nothing here changes a purchase, invoice, license or seat.

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['purchases', 'districts', 'site_users', 'crm_opportunities', 'admin_users']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here (run the earlier CRM scripts first). Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_repeat_requests')) console.log('Skipped: crm_repeat_requests already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_repeat_requests (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      district_id INT UNSIGNED NOT NULL,
      school_id INT UNSIGNED NULL,
      purchase_id INT UNSIGNED NOT NULL,
      kind VARCHAR(16) NOT NULL,
      current_seats INT UNSIGNED NULL,
      requested_seats INT UNSIGNED NULL,
      note VARCHAR(500) NULL,
      state VARCHAR(12) NOT NULL DEFAULT 'waiting',
      open_flag TINYINT NULL,
      opportunity_id INT UNSIGNED NULL,
      requested_by_site_user_id INT UNSIGNED NOT NULL,
      decided_by_admin_id INT UNSIGNED NULL,
      decision_note VARCHAR(500) NULL,
      decided_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_repeat_open (purchase_id, open_flag),
      KEY idx_crm_repeat_district (district_id, state),
      KEY idx_crm_repeat_state (state, created_at),
      CONSTRAINT fk_crm_repeat_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_repeat_requests.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
