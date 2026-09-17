// Tune Your Brain — flips tune_your_brain_pilot_enabled to enabled
// globally, as a rollout-safety step paired with wiring the flag check
// into GET /api/brain-games (server/routes/brain-games.js). The flag was
// seeded disabled in Phase 1 with no code ever checking it, so every new
// Tune Your Brain game has been visible to every school by default since
// launch. This script preserves that exact visibility the moment the new
// check goes live — it does NOT scope the pilot down to specific schools.
// Deciding whether to later disable this and opt schools in individually
// via feature_flag_schools is a separate, explicit product decision.
//
// Safe to re-run: idempotent UPDATE.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [result] = await conn.query(
    "UPDATE feature_flags SET enabled_globally=1 WHERE flag_key='tune_your_brain_pilot_enabled'"
  );
  if (result.affectedRows) {
    console.log('tune_your_brain_pilot_enabled is now enabled globally');
  } else {
    console.warn("Warning: no feature_flags row found for flag_key='tune_your_brain_pilot_enabled'");
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
