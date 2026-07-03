require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// The 9 school license tiers that were previously hand-authored static HTML
// on education-portal.html — now a real, admin-editable catalog.
const PRODUCTS = [
  { name: 'Small Team Plan (Up to 5 Educators)', seatCount: 5, price: 699 },
  { name: 'Department / Grade Plan (Up to 15 Educators)', seatCount: 15, price: 1499 },
  { name: 'Small School Building Plan (Up to 35 Educators)', seatCount: 35, price: 2499 },
  { name: 'Standard School Building Plan (Up to 60 Educators)', seatCount: 60, price: 3499 },
  { name: 'Large School Building Plan (Up to 100 Educators)', seatCount: 100, price: 4499 },
  { name: 'Small District Plan (Up to 150 Educators)', seatCount: 150, price: 7499 },
  { name: 'Mid Size District Plan (Up to 400 Educators)', seatCount: 400, price: 14999 },
  { name: 'Large District Plan (Up to 1000 Educators)', seatCount: 1000, price: 29999 },
  { name: 'Enterprise District Plan (Custom Quote)', seatCount: 1000, price: 39999 },
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let created = 0, skipped = 0;
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const [existing] = await connection.query('SELECT id FROM license_products WHERE name = ?', [p.name]);
    if (existing.length) {
      console.log(`Skipped (already exists): ${p.name}`);
      skipped++;
      continue;
    }
    await connection.query(
      'INSERT INTO license_products (name, seat_count, price_cents, sort_order, active) VALUES (?, ?, ?, ?, 1)',
      [p.name, p.seatCount, Math.round(p.price * 100), i]
    );
    console.log(`Created: ${p.name}`);
    created++;
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
  await connection.end();
}

main().catch(err => {
  console.error('Seeding license products failed:', err.message);
  process.exit(1);
});
