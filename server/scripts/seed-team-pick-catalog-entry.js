// Tune Your Brain — adds Team Pick as a real, assignable entry in the
// classroom game-assignment flow, by extending the existing brain_games
// catalog table rather than building a parallel one.
//
// Explore band's second SEL & Character game (already had Choice Quest)
// and the first Self-management game in any band — see
// docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's SEL x band table,
// which flagged Self-management as having zero coverage anywhere.
// band/domain/casel_competencies are set directly at insert time, same
// pattern as seed-first-shift-catalog-entry.js.
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['team-pick']);
  if (existing) {
    console.log('Skipped: team-pick already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Team Pick', 'team-pick',
        'Work through a real Issues-to-Answers cycle on being picked last for a team. A Tune Your Brain SEL experience.',
        '🙋', 'Self-Management', (maxOrder?.m || 0) + 1,
        'explore', 'sel', 'self_management,relationship_skills',
      ]
    );
    console.log('Added: team-pick to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
