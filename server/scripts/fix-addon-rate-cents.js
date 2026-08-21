// One-off data fix: update-license-product-pricing.js set addon_rate_cents
// using an older short-form naming scheme ('Small Team', 'Department / Grade',
// etc.) that never matched the license_products actually live in production
// (full names like 'Small Team Plan (Up to 5 Educators)'), so every "Not
// found in DB, skipping" silently left addon_rate_cents NULL everywhere.
// Result: the quote builder's Add-On Seats tab has had zero selectable
// tiers since it shipped. This re-applies the same intended per-seat rates
// against the real, current product names.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

const ADDON_RATES_CENTS = {
  'Small Team Plan (Up to 5 Educators)': 9500,
  'Department / Grade Plan (Up to 15 Educators)': 5000,
  'Small School Building Plan (Up to 35 Educators)': 3800,
  'Standard School Building Plan (Up to 60 Educators)': 3000,
  'Large School Building Plan (Up to 100 Educators)': 2400,
};

(async () => {
  let updated = 0;
  for (const [name, rateCents] of Object.entries(ADDON_RATES_CENTS)) {
    const [result] = await pool.query(
      'UPDATE license_products SET addon_rate_cents = ? WHERE name = ? AND (addon_rate_cents IS NULL OR addon_rate_cents != ?)',
      [rateCents, name, rateCents]
    );
    if (result.affectedRows) { updated++; console.log(`Set addon_rate_cents=${rateCents} on "${name}"`); }
    else console.log(`No change needed (or not found): "${name}"`);
  }
  console.log(`Done. ${updated} product(s) updated.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
