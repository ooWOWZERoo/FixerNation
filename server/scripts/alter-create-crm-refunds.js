require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G21 (PRD section 8 rule 7): the table that holds refund and dispute flags raised by Stripe events or by staff, waiting for a CRM Admin.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the Customer rule (lib/crm-classification.js) now reads this table, so new code against a server without it
// would fail the queries that decide who is a Customer. Everything is additive: no existing table, column or row is changed, and nothing is back-filled.
//
//   node scripts/alter-create-crm-refunds.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['purchases', 'admin_users']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_purchase_refunds')) console.log('Skipped: crm_purchase_refunds already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_purchase_refunds (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      purchase_id INT UNSIGNED NOT NULL,
      kind VARCHAR(12) NOT NULL,
      source VARCHAR(8) NOT NULL,
      stripe_event_id VARCHAR(255) NULL,
      amount_cents INT UNSIGNED NULL,
      is_full TINYINT(1) NULL,
      state VARCHAR(12) NOT NULL DEFAULT 'needs_review',
      note VARCHAR(500) NULL,
      raised_by_admin_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_by_admin_id INT UNSIGNED NULL,
      decided_at DATETIME NULL,
      UNIQUE KEY uq_crm_refund_event (stripe_event_id, purchase_id),
      KEY idx_crm_refund_purchase (purchase_id, state),
      KEY idx_crm_refund_state (state, created_at),
      CONSTRAINT fk_crm_refund_purchase FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_refund_raiser FOREIGN KEY (raised_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
      CONSTRAINT fk_crm_refund_decider FOREIGN KEY (decided_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_purchase_refunds.');
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
