// Adds structured license-length tracking, replacing the old free-text
// footer_note ("Valid for 12 months") convention with a real field the
// system can compute expiration dates from.
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

  // license_products.duration_days — admin-set catalog default (30/60/90/180/365
  // days, via a dropdown in admin-licenses.html). NULL means "no fixed length" —
  // existing products are unaffected until an admin explicitly sets one.
  if (await columnExists(conn, 'license_products', 'duration_days')) {
    console.log('Skipped (already exists): license_products.duration_days');
  } else {
    await conn.query('ALTER TABLE license_products ADD COLUMN duration_days INT UNSIGNED NULL AFTER trial_library_limit');
    console.log('Added column: license_products.duration_days');
  }

  // purchases.license_duration_days — snapshot of the intended license length
  // (in days) taken at purchase-creation time, same pattern already used for
  // amount_cents/trial_lesson_limit so a later catalog price/duration change
  // never retroactively alters an already-created purchase. For a quote-
  // accepted purchase this is the product's duration_days scaled by the
  // quote's own quoted_term_years, not the raw catalog value.
  if (await columnExists(conn, 'purchases', 'license_duration_days')) {
    console.log('Skipped (already exists): purchases.license_duration_days');
  } else {
    await conn.query('ALTER TABLE purchases ADD COLUMN license_duration_days INT UNSIGNED NULL AFTER expiration_date');
    console.log('Added column: purchases.license_duration_days');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
