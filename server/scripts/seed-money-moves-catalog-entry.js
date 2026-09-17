// Catalog scaling slice (Phase 7/8) — adds Money Moves as a real,
// assignable entry in the classroom game-assignment flow, by extending
// the existing brain_games catalog table rather than building a parallel
// one.
//
// See seed-choice-quest-catalog-entry.js's header comment for the general
// pattern (reward_pipeline defaults to 'classroom_generic' automatically;
// run seed-classroom-completion-badges.js separately for its badge).
//
// Safe to re-run: skipped if a row with this slug already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['money-moves']);
  if (existing) {
    console.log('Skipped: money-moves already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'Money Moves', 'money-moves',
        'Manage allowance and chore money toward a savings goal, with real tradeoffs along the way. A Tune Your Brain catalog experience.',
        '🚲', 'Budgeting & Percentages', (maxOrder?.m || 0) + 1,
      ]
    );
    console.log('Added: money-moves to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
