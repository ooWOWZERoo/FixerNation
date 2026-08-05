require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

const DEFAULTS = [
  ['quote_from_email',      'sales@fixernationeducation.com'],
  ['quote_2yr_discount_pct', '5'],
  ['quote_3yr_discount_pct', '8'],
];

(async () => {
  for (const [key, value] of DEFAULTS) {
    await pool.query(
      'INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE key_name = key_name',
      [key, value]
    );
  }
  console.log('Quote settings seeded (skipped if already present).');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
