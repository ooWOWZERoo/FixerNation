require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const [existing] = await pool.query('SELECT id FROM license_products WHERE is_trial = 1 LIMIT 1');
  if (existing.length) {
    console.log('Trial product already exists — skipping.');
    await pool.end();
    return;
  }

  await pool.query(
    `INSERT INTO license_products
       (name, description, seat_count, price_cents, variable_seats, is_trial, trial_days, trial_lesson_limit, footer_note, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      '30-Day Trial',
      'Try Fixer Nation Education for 30 days with access to 4 lessons.',
      1, 7450, 0, 1, 30, 4,
      'Access 4 lessons during your trial. A $74.50 credit applies to an annual license if you convert within 30 days.',
      1, 0,
    ]
  );
  console.log('Trial product created.');
  await pool.end();
}

main().catch(err => {
  console.error('seed-trial-product failed:', err.message);
  process.exit(1);
});
