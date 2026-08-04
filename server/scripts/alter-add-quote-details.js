require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const COLUMNS = [
  { name: 'quoted_product_id',   sql: 'ALTER TABLE quote_requests ADD COLUMN quoted_product_id INT UNSIGNED NULL AFTER notes' },
  { name: 'quoted_product_name', sql: 'ALTER TABLE quote_requests ADD COLUMN quoted_product_name VARCHAR(255) NULL AFTER quoted_product_id' },
  { name: 'quoted_seat_count',   sql: 'ALTER TABLE quote_requests ADD COLUMN quoted_seat_count INT UNSIGNED NULL AFTER quoted_product_name' },
  { name: 'quoted_amount_cents', sql: 'ALTER TABLE quote_requests ADD COLUMN quoted_amount_cents INT UNSIGNED NULL AFTER quoted_seat_count' },
  { name: 'quoted_at',           sql: 'ALTER TABLE quote_requests ADD COLUMN quoted_at DATETIME NULL AFTER quoted_amount_cents' },
  { name: 'quote_sent_at',       sql: 'ALTER TABLE quote_requests ADD COLUMN quote_sent_at DATETIME NULL AFTER quoted_at' },
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'quote_requests'`,
    [process.env.DB_NAME]
  );
  const existing = new Set(cols.map(c => c.COLUMN_NAME));

  for (const col of COLUMNS) {
    if (!existing.has(col.name)) {
      await connection.query(col.sql);
      console.log(`Added column: quote_requests.${col.name}`);
    } else {
      console.log(`Skipped (already exists): quote_requests.${col.name}`);
    }
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
