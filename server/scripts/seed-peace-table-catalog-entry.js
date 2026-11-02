// Tune Your Brain: adds Peace Table as a real, assignable entry in the
// classroom game-assignment flow, by extending the existing brain_games
// catalog table. Explore band (grades 3-5); the second direct game for NY SEL
// 2D (resolving conflict) and the first below grade 6. See
// docs/tune-your-brain/NEW_GAMES_FOR_GAPS.md.
// reward_pipeline is left unset so it defaults to 'classroom_generic'; run
// seed-classroom-completion-badges.js separately to add its badge.
//
// Safe to re-run: skipped if a row with this slug already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['peace-table']);
  if (existing) {
    console.log('Skipped: peace-table already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Peace Table', 'peace-table',
        'Two kids disagree. Say what happened, listen, and find a fair plan together.',
        '🕊️', 'Conflict Resolution', (maxOrder?.m || 0) + 1,
        'explore', 'sel', 'relationship_skills,social_awareness',
      ]
    );
    console.log('Added: peace-table to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
