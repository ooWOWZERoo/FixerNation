const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function run() {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'license_products' AND COLUMN_NAME = 'variable_seats'`
  );
  if (rows.length) {
    console.log('license_products.variable_seats already exists — skipping');
  } else {
    await pool.query(
      'ALTER TABLE license_products ADD COLUMN variable_seats TINYINT(1) NOT NULL DEFAULT 0 AFTER footer_note'
    );
    console.log('Added license_products.variable_seats');
  }
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
