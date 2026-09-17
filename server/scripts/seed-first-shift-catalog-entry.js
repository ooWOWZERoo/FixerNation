// Tune Your Brain — adds First Shift as a real, assignable entry in the
// classroom game-assignment flow, by extending the existing brain_games
// catalog table rather than building a parallel one.
//
// First SEL & Character game for the Advance band (previously zero
// coverage — see docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's SEL x
// band table). band/domain/casel_competencies are set directly at insert
// time, same pattern as seed-calm-down-corner-catalog-entry.js.
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['first-shift']);
  if (existing) {
    console.log('Skipped: first-shift already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'First Shift', 'first-shift',
        'Work through a real Issues-to-Answers cycle on a workplace integrity situation. A Tune Your Brain SEL experience.',
        '🧑‍💼', 'Workplace Ethics', (maxOrder?.m || 0) + 1,
        'advance', 'sel', 'responsible_decision_making,relationship_skills',
      ]
    );
    console.log('Added: first-shift to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
