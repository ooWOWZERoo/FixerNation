require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');

async function run() {
  const [[col]] = await pool.query(
    `SELECT DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'setting_value'`
  );
  if (col && col.DATA_TYPE === 'text') {
    console.log('Already TEXT — nothing to do.');
    process.exit(0);
  }
  await pool.query('ALTER TABLE settings MODIFY COLUMN setting_value TEXT NOT NULL');
  console.log('Altered settings.setting_value to TEXT.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
