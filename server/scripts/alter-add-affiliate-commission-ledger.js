// Stage 3.5a of the sales-affiliate program — the commission ledger.
// Design and confirmed decisions: docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md.
//
// Why this exists: stage 3 wrote the commission straight onto the purchase at
// attribution time, including for PO orders, which are created with
// payment_status='pending' because a school gets access before its business
// office pays. So an affiliate's total could include invoices that were never
// paid, with no way to take it back. This table gives every earning a status
// that follows the money, and a reversal path.
//
// The backfill is a no-op on today's data — nothing has been sold through an
// affiliate link yet — but it's written properly anyway so this script stays
// correct if it's run later than intended.
//
// Idempotent, per the alter-*.js convention.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    // Guard: this builds on stage 1's tables. Running it against a database
    // that never got alter-add-affiliate-program.js would fail on the foreign
    // key with a far less obvious error than this.
    if (!(await tableExists(conn, 'affiliates'))) {
      console.error('Missing table: affiliates. Run scripts/alter-add-affiliate-program.js first.');
      process.exitCode = 1;
      return;
    }

    if (!(await tableExists(conn, 'affiliate_commissions'))) {
      await conn.query(`
        CREATE TABLE affiliate_commissions (
          id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          affiliate_id         INT UNSIGNED NOT NULL,
          purchase_id          INT UNSIGNED NULL,
          status               VARCHAR(16) NOT NULL DEFAULT 'pending',
          source_type          VARCHAR(16) NOT NULL DEFAULT 'referral',
          description          VARCHAR(300) NULL,
          gross_amount_cents   INT UNSIGNED NULL,
          commission_rate      DECIMAL(5,2) NULL,
          commission_cents     INT NOT NULL,
          approved_at          DATETIME NULL,
          approved_by_admin_id INT UNSIGNED NULL,
          paid_at              DATETIME NULL,
          payout_reference     VARCHAR(64) NULL,
          reversed_at          DATETIME NULL,
          reversed_by_admin_id INT UNSIGNED NULL,
          reversal_reason      VARCHAR(500) NULL,
          notes                VARCHAR(1000) NULL,
          created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_affiliate_status (affiliate_id, status),
          INDEX idx_status_created (status, created_at),
          INDEX idx_purchase (purchase_id),
          FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
          FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
          FOREIGN KEY (approved_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
          FOREIGN KEY (reversed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: affiliate_commissions');
    } else {
      console.log('Skipped (already exists): affiliate_commissions');
    }

    // Backfill one ledger row per already-attributed purchase. Keyed on
    // NOT EXISTS rather than a flag column, so re-running can't duplicate a
    // row, and a purchase attributed between two runs still gets picked up.
    //
    // Status is derived from the purchase's own payment_status: a paid
    // purchase's commission is payable now, a pending one waits. Rows whose
    // commission was never calculated (no known sale amount) are skipped —
    // there's no figure to owe anyone.
    const [backfill] = await conn.query(
      `INSERT INTO affiliate_commissions
         (affiliate_id, purchase_id, status, source_type, gross_amount_cents, commission_rate, commission_cents, approved_at, notes)
       SELECT p.affiliate_id,
              p.id,
              CASE WHEN p.payment_status = 'paid' THEN 'approved' ELSE 'pending' END,
              'referral',
              p.amount_cents,
              a.commission_rate,
              p.affiliate_commission_cents,
              CASE WHEN p.payment_status = 'paid' THEN NOW() ELSE NULL END,
              'Backfilled from purchases by alter-add-affiliate-commission-ledger.js'
         FROM purchases p
         JOIN affiliates a ON a.id = p.affiliate_id
        WHERE p.affiliate_id IS NOT NULL
          AND p.affiliate_commission_cents IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM affiliate_commissions ac WHERE ac.purchase_id = p.id
          )`
    );
    console.log(backfill.affectedRows
      ? `Backfilled ${backfill.affectedRows} ledger row(s) from existing attributed purchases.`
      : 'Backfill: nothing to do (no attributed purchases with a calculated commission).');

    // The commission_rate written above is the affiliate's CURRENT rate, not
    // necessarily the one in force when that sale happened — the old snapshot
    // only ever existed as an amount, not a rate. Called out loudly rather
    // than left as a silent inaccuracy in a money table.
    if (backfill.affectedRows) {
      console.log('NOTE: backfilled rows carry each affiliate\'s current commission_rate.');
      console.log('      The original rate at sale time was never recorded as a rate, only as an amount.');
      console.log('      commission_cents is the real historical figure; treat commission_rate on those rows as indicative.');
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
