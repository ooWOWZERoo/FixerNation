// Tune Your Brain: adds Strength Spotter as a real, assignable entry in the
// classroom game-assignment flow, by extending the existing brain_games
// catalog table. Explore band (grades 3-5); the first game for NY SEL 1B
// (identity and agency). See docs/tune-your-brain/NEW_GAMES_FOR_GAPS.md.
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['strength-spotter']);
  if (existing) {
    console.log('Skipped: strength-spotter already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Strength Spotter', 'strength-spotter',
        'Notice what someone does, spot the strengths it shows, then think about your own. A Tune Your Brain SEL experience.',
        '🌟', 'Self-awareness', (maxOrder?.m || 0) + 1,
        'explore', 'sel', 'self_awareness',
      ]
    );
    console.log('Added: strength-spotter to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
