// Tune Your Brain: adds Idea Lab as a real, assignable entry in the
// classroom game-assignment flow, by extending the existing brain_games
// catalog table. Advance band (grades 9-12); the second direct game for the
// Creative Innovator attribute and the first for grades 9-12. See
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['idea-lab']);
  if (existing) {
    console.log('Skipped: idea-lab already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Idea Lab', 'idea-lab',
        'Find the real need, weigh three workable ideas, and test one small before you launch. A Tune Your Brain experience.',
        '💡', 'Creative Problem-Solving', (maxOrder?.m || 0) + 1,
        'advance', 'sel', 'responsible_decision_making,relationship_skills',
      ]
    );
    console.log('Added: idea-lab to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
