require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

const TIERS = [
  { name: 'Solo Educator',       seat_count: 1,   price_cents: 34900,  addon_rate_cents: null },
  { name: 'Small Team',          seat_count: 5,   price_cents: 54900,  addon_rate_cents: 9500 },
  { name: 'Department / Grade',  seat_count: 15,  price_cents: 84900,  addon_rate_cents: 5000 },
  { name: 'Small School',        seat_count: 35,  price_cents: 149900, addon_rate_cents: 3800 },
  { name: 'Standard School',     seat_count: 60,  price_cents: 199900, addon_rate_cents: 3000 },
  { name: 'Large School',        seat_count: 100, price_cents: 259900, addon_rate_cents: 2400 },
  { name: 'Small District',      seat_count: 150, price_cents: 349900, addon_rate_cents: null },
];

const PILOT = {
  name: '90-Day Classroom Pilot',
  seat_count: 1,
  price_cents: 14900,
  addon_rate_cents: null,
  active: 1,
  sort_order: 99,
};

(async () => {
  let updated = 0;
  let inserted = 0;

  for (const tier of TIERS) {
    const [rows] = await pool.query('SELECT id FROM license_products WHERE name = ?', [tier.name]);
    if (rows.length) {
      await pool.query(
        'UPDATE license_products SET seat_count = ?, price_cents = ?, addon_rate_cents = ? WHERE name = ?',
        [tier.seat_count, tier.price_cents, tier.addon_rate_cents, tier.name]
      );
      updated++;
    } else {
      console.log(`  Not found in DB, skipping: ${tier.name}`);
    }
  }

  // Pilot: insert if not present
  const [pilotRows] = await pool.query('SELECT id FROM license_products WHERE name = ?', [PILOT.name]);
  if (!pilotRows.length) {
    await pool.query(
      'INSERT INTO license_products (name, seat_count, price_cents, addon_rate_cents, active, sort_order, call_for_quote, variable_seats) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
      [PILOT.name, PILOT.seat_count, PILOT.price_cents, PILOT.addon_rate_cents, PILOT.active, PILOT.sort_order]
    );
    inserted++;
    console.log(`  Inserted pilot product.`);
  } else {
    await pool.query(
      'UPDATE license_products SET seat_count = ?, price_cents = ?, addon_rate_cents = ? WHERE name = ?',
      [PILOT.seat_count, PILOT.price_cents, PILOT.addon_rate_cents, PILOT.name]
    );
    updated++;
  }

  console.log(`Updated ${updated} products, inserted ${inserted}.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
