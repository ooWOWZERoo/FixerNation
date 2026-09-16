// Run via cPanel Cron Jobs nightly. Deletes learning_events rows older than
// the configured retention window (settings.learning_events_retention_days
// — provisional default 400 days, see D3 in
// docs/tune-your-brain/LEADERSHIP_DECISIONS_REQUIRED.md). Self-contained
// like every other cron script in this project: loads .env, opens its own
// pool, does the work, closes it. Safe to run even before anything writes
// to learning_events — DELETE on an empty/nonexistent-row-range table is a
// no-op.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { getSetting } = require('../lib/settings');

async function main() {
  const days = Number(await getSetting('learning_events_retention_days')) || 400;
  const [result] = await pool.query(
    'DELETE FROM learning_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [days]
  );
  console.log(`[purge-learning-events] Deleted ${result.affectedRows} rows older than ${days} days.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
