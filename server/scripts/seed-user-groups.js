require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const SYSTEM_GROUPS = [
  { name: 'Consumer',         systemKey: 'consumer' },
  { name: 'Service Providers', systemKey: 'service_provider' },
  { name: 'Brand Ambassadors', systemKey: 'brand_ambassador' },
  { name: 'Teachers',          systemKey: 'teachers' },
];

const ED_PRODUCT = {
  name: 'Registration — 2D Education Program',
  description: 'Complete your registration for the 2D Education Program. For all school-purchased tier plans this price is comped at checkout — be sure to use your school email address. Valid for 12 months.',
  seatCount: 1,
  priceCents: 14900,
  sortOrder: -1,
};

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // --- Add system_key column to contact_groups if missing ---
  try {
    await connection.query('ALTER TABLE contact_groups ADD COLUMN system_key VARCHAR(50) NULL');
    await connection.query('ALTER TABLE contact_groups ADD UNIQUE KEY idx_system_key (system_key)');
    console.log('Added system_key column to contact_groups');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate column')) {
      console.log('system_key column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Upsert 4 system groups ---
  for (const g of SYSTEM_GROUPS) {
    const [existing] = await connection.query('SELECT id FROM contact_groups WHERE system_key = ?', [g.systemKey]);
    if (existing.length) {
      console.log(`Group already exists by system_key: ${g.name} (${g.systemKey})`);
      continue;
    }
    const [byName] = await connection.query('SELECT id FROM contact_groups WHERE name = ?', [g.name]);
    if (byName.length) {
      await connection.query('UPDATE contact_groups SET system_key = ? WHERE id = ?', [g.systemKey, byName[0].id]);
      console.log(`Updated existing group "${g.name}" with system_key="${g.systemKey}"`);
    } else {
      await connection.query('INSERT INTO contact_groups (name, system_key) VALUES (?, ?)', [g.name, g.systemKey]);
      console.log(`Created group: ${g.name} (${g.systemKey})`);
    }
  }

  // --- Create "Registration — 2D Education Program" license product ---
  const [existingProd] = await connection.query('SELECT id FROM license_products WHERE name = ?', [ED_PRODUCT.name]);
  if (existingProd.length) {
    console.log(`License product already exists: ${ED_PRODUCT.name}`);
  } else {
    await connection.query(
      'INSERT INTO license_products (name, description, seat_count, price_cents, sort_order, active) VALUES (?, ?, ?, ?, ?, 1)',
      [ED_PRODUCT.name, ED_PRODUCT.description, ED_PRODUCT.seatCount, ED_PRODUCT.priceCents, ED_PRODUCT.sortOrder]
    );
    console.log(`Created license product: ${ED_PRODUCT.name}`);
  }

  // --- Deactivate "Registration 2D Education Program" membership plan ---
  const [planResult] = await connection.query(
    "UPDATE membership_plans SET active = 0 WHERE name = 'Registration 2D Education Program' AND active = 1"
  );
  if (planResult.affectedRows) {
    console.log('Deactivated membership plan: Registration 2D Education Program');
  } else {
    console.log('Membership plan already inactive or not found — skipping');
  }

  console.log('\nDone.');
  await connection.end();
}

main().catch(err => {
  console.error('Seeding user groups failed:', err.message);
  process.exit(1);
});
