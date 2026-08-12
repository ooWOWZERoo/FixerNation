require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
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

  // purchases: license lifecycle columns
  for (const [col, def] of [
    ['license_status', "VARCHAR(16) NOT NULL DEFAULT 'active' AFTER payment_status"],
    ['effective_date', 'DATE NULL AFTER license_status'],
    ['expiration_date', 'DATE NULL AFTER effective_date'],
    ['renewal_reminder_sent_at', 'DATETIME NULL AFTER expiration_date'],
  ]) {
    if (await columnExists(conn, 'purchases', col)) {
      console.log(`Skipped (already exists): purchases.${col}`);
    } else {
      await conn.query(`ALTER TABLE purchases ADD COLUMN ${col} ${def}`);
      console.log(`Added column: purchases.${col}`);
    }
  }

  // Backfill license_status for existing purchases:
  // - paid purchases (stripe or manual) → active
  // - PO purchases still pending payment → pending
  const [backfillResult] = await conn.query(`
    UPDATE purchases
    SET license_status =
      CASE
        WHEN payment_status = 'paid' THEN 'active'
        WHEN payment_method = 'po' AND payment_status = 'pending' THEN 'pending'
        ELSE 'active'
      END
    WHERE product_type IN ('group_license', 'single_license')
  `);
  console.log(`Backfilled license_status on ${backfillResult.affectedRows} license purchases`);

  // invoices: po_received_date
  if (await columnExists(conn, 'invoices', 'po_received_date')) {
    console.log('Skipped (already exists): invoices.po_received_date');
  } else {
    await conn.query('ALTER TABLE invoices ADD COLUMN po_received_date DATETIME NULL AFTER po_number');
    console.log('Added column: invoices.po_received_date');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
