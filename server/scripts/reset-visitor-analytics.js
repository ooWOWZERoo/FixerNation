// One-time pre-launch reset of anonymous visitor-path tracking data
// (analytics_sessions / analytics_events — the "Visitor Paths" admin page).
// Scoped to ONLY these two tables — does not touch campaigns, downloads,
// quotes, purchases, or any other data. Safe to run once, right before
// go-live cutover, so real launch-day traffic starts from a clean baseline
// instead of being mixed in with months of dev/QA sessions (confirmed via
// admin-analytics.html: top entry pages included blog.html/books.html,
// both removed from FNE's scope long ago, and top events included literal
// "[QA] Test License" add-to-cart entries).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [[{ sessionCount }]] = await connection.query('SELECT COUNT(*) AS sessionCount FROM analytics_sessions');
  const [[{ eventCount }]] = await connection.query('SELECT COUNT(*) AS eventCount FROM analytics_events');
  console.log(`Before: ${sessionCount} sessions, ${eventCount} events`);

  // Child table first — analytics_events.session_id has an ON DELETE CASCADE
  // FK to analytics_sessions, so this order is correct either way, but being
  // explicit avoids relying on the cascade for a script this consequential.
  await connection.query('DELETE FROM analytics_events');
  await connection.query('DELETE FROM analytics_sessions');

  const [[{ sessionCount: sessionsAfter }]] = await connection.query('SELECT COUNT(*) AS sessionCount FROM analytics_sessions');
  const [[{ eventCount: eventsAfter }]] = await connection.query('SELECT COUNT(*) AS eventCount FROM analytics_events');
  console.log(`After: ${sessionsAfter} sessions, ${eventsAfter} events`);

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
