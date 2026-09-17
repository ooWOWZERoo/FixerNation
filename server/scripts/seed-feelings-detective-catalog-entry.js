// Tune Your Brain — adds Feelings Detective as a real, assignable entry
// in the classroom game-assignment flow, by extending the existing
// brain_games catalog table rather than building a parallel one.
//
// The first Self-awareness game in any band — closes the last CASEL gap
// left after Team Pick/Group Chat Meltdown closed Self-management. Runs
// on the new Scenario Choice engine (multi-select) — see
// docs/tune-your-brain/SCENARIO_CHOICE_ENGINE_SPIKE.md. band/domain/
// casel_competencies are set directly at insert time, same pattern as
// seed-team-pick-catalog-entry.js.
//
// reward_pipeline is left unset so it defaults to 'classroom_generic' —
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['feelings-detective']);
  if (existing) {
    console.log('Skipped: feelings-detective already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Feelings Detective', 'feelings-detective',
        'Notice real cues in a scene, then pick every feeling that plausibly fits. A Tune Your Brain SEL experience.',
        '🕵️', 'Self-Awareness', (maxOrder?.m || 0) + 1,
        'discover', 'sel', 'self_awareness',
      ]
    );
    console.log('Added: feelings-detective to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
