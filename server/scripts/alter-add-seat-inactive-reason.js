// Adds license_seats.inactive_reason so a license renewal can restore the seats that expiry switched off
// (and only those). Safe to re-run. Run it BEFORE restarting the Node app.
// It does not touch existing seats: seats switched off by an earlier expiry carry no reason, so after a renewal
// the school admin brings those teachers back with Reactivate on the roster page. The report below says how many.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, 'license_seats', 'inactive_reason']
  );
  if (cols.length) {
    console.log('Skipped (already exists): license_seats.inactive_reason');
  } else {
    try {
      await conn.query('ALTER TABLE license_seats ADD COLUMN inactive_reason VARCHAR(32) NULL AFTER status');
      console.log('Added column: license_seats.inactive_reason');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      console.log('Skipped (already exists): license_seats.inactive_reason');
    }
  }

  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id
     WHERE ls.status = 'inactive' AND p.license_status = 'expired'`
  );
  console.log(`${n} seat(s) under licenses that are already expired have no reason recorded; their school admin reactivates them by hand after a renewal.`);

  await conn.end();
  console.log('Done.');
}

main().catch((err) => { console.error('alter-add-seat-inactive-reason failed:', err.message); process.exit(1); });
