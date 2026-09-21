// Tune Your Brain — adds Helper's Choice as a real, assignable entry in
// the classroom game-assignment flow, by extending the existing
// brain_games catalog table rather than building a parallel one.
//
// Discover's first Responsible decision-making game — closes the last
// of Discover's 3 missing CASEL competencies (the other two, Social
// awareness / Relationship skills, are closed by the companion game
// Sharing Circle). See docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's
// corrected CASEL x band matrix, 2026-09-21. band/domain/
// casel_competencies are set directly at insert time, same pattern as
// seed-sharing-circle-catalog-entry.js.
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['helpers-choice']);
  if (existing) {
    console.log("Skipped: helpers-choice already in brain_games catalog (id=" + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "Helper's Choice", 'helpers-choice',
        'Listen to what happened, then pick the responsible thing to do. A Tune Your Brain SEL experience.',
        '✋', 'Responsibility', (maxOrder?.m || 0) + 1,
        'discover', 'sel', 'responsible_decision_making',
      ]
    );
    console.log('Added: helpers-choice to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
