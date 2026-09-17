// Tune Your Brain, Phase 5 — adds Sound Safari as a real, assignable entry
// in the classroom game-assignment flow, by extending the existing
// brain_games catalog table rather than building a parallel one (the
// blueprint's own non-negotiable rule: extend, don't duplicate).
//
// IMPORTANT: this row exists ONLY so classroom_game_assignments.game_id has
// a valid, teacher-visible target (via the existing GET /api/brain-games ->
// teacher-classroom.html assign-dropdown -> student-game.html iframe-src
// convention, "brain-{slug}.html"). Sound Safari's actual gameplay does
// NOT use brain_game_sessions/XP/badges (the legacy reward tables this
// catalog table is normally paired with) — it logs through the new
// /api/learning-events + engine-sdk.js path built in Phase 3. A future
// Phase 6 Reward Service is what should unify these, not this script.
//
// Safe to re-run: skipped if a row with this slug already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['sound-safari']);
  if (existing) {
    console.log('Skipped: sound-safari already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'Sound Safari', 'sound-safari',
        'Listen for a sound, then find the picture that starts with the same sound. A Tune Your Brain pilot experience (Phase 5).',
        '🦁', 'Phonemic Awareness', (maxOrder?.m || 0) + 1,
      ]
    );
    console.log('Added: sound-safari to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
