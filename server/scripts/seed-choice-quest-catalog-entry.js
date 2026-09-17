// Catalog scaling slice (Phase 7/8) — adds Choice Quest as a real,
// assignable entry in the classroom game-assignment flow, by extending
// the existing brain_games catalog table rather than building a parallel
// one (the blueprint's own non-negotiable rule: extend, don't duplicate).
//
// IMPORTANT: this row exists ONLY so classroom_game_assignments.game_id has
// a valid, teacher-visible target (via the existing GET /api/brain-games ->
// teacher-classroom.html assign-dropdown -> student-game.html iframe-src
// convention, "brain-{slug}.html"). Choice Quest's gameplay logs through
// /api/learning-events + engine-sdk.js, same as every other Tune Your
// Brain pilot game. reward_pipeline is left unset so it defaults to
// 'classroom_generic' (server/scripts/alter-add-reward-pipeline.js) —
// real XP/streak rewards apply with no extra wiring; run
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['choice-quest']);
  if (existing) {
    console.log('Skipped: choice-quest already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'Choice Quest', 'choice-quest',
        'Work through a real Issues-to-Answers cycle on a team-project situation. A Tune Your Brain catalog experience.',
        '🗺️', 'Empathy & Responsible Decision-Making', (maxOrder?.m || 0) + 1,
      ]
    );
    console.log('Added: choice-quest to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
