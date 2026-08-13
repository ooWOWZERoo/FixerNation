require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query('SHOW COLUMNS FROM ?? LIKE ?', [table, column]);
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!await columnExists(conn, 'quote_requests', 'quote_number')) {
      await conn.query('ALTER TABLE quote_requests ADD COLUMN quote_number VARCHAR(6) NULL UNIQUE AFTER id');
      console.log('Added quote_number to quote_requests');
    }
    if (!await columnExists(conn, 'quote_requests', 'quote_valid_until')) {
      await conn.query('ALTER TABLE quote_requests ADD COLUMN quote_valid_until DATE NULL AFTER quote_number');
      console.log('Added quote_valid_until to quote_requests');
    }
    if (!await columnExists(conn, 'quote_requests', 'accept_token')) {
      await conn.query('ALTER TABLE quote_requests ADD COLUMN accept_token VARCHAR(64) NULL UNIQUE AFTER quote_valid_until');
      console.log('Added accept_token to quote_requests');
    }
    if (!await columnExists(conn, 'quote_requests', 'accepted_at')) {
      await conn.query('ALTER TABLE quote_requests ADD COLUMN accepted_at DATETIME NULL AFTER accept_token');
      console.log('Added accepted_at to quote_requests');
    }
    if (!await columnExists(conn, 'quote_requests', 'accepted_payment_method')) {
      await conn.query("ALTER TABLE quote_requests ADD COLUMN accepted_payment_method VARCHAR(8) NULL AFTER accepted_at");
      console.log('Added accepted_payment_method to quote_requests');
    }
    if (!await columnExists(conn, 'purchases', 'quote_id')) {
      await conn.query('ALTER TABLE purchases ADD COLUMN quote_id INT UNSIGNED NULL AFTER converted_to_purchase_id');
      console.log('Added quote_id to purchases');
    }
    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('alter-add-quote-upgrades failed:', err.message);
  process.exit(1);
});
