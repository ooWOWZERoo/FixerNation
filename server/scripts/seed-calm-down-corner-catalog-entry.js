// Tune Your Brain — adds Calm Down Corner as a real, assignable entry in
// the classroom game-assignment flow, by extending the existing
// brain_games catalog table rather than building a parallel one.
//
// First SEL & Character game for the Discover band (previously zero
// coverage — see docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's SEL x
// band table) and the first game targeting the Self-management CASEL
// competency in any band. Unlike the earlier catalog-scaling seed
// scripts, this one sets band/domain/casel_competencies directly at
// insert time, since those columns already exist in production —
// no separate retrofit seed script needed for a brand-new game.
//
// reward_pipeline is left unset so it defaults to 'classroom_generic'
// (server/scripts/alter-add-reward-pipeline.js) — real XP/streak rewards
// apply with no extra wiring; run seed-classroom-completion-badges.js
// separately to add its badge.
//
// Safe to re-run: skipped if a row with this slug already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['calm-down-corner']);
  if (existing) {
    console.log('Skipped: calm-down-corner already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Calm Down Corner', 'calm-down-corner',
        'Listen to a frustrating moment, then pick what would help you feel calm. A Tune Your Brain SEL experience.',
        '🐢', 'Self-Regulation', (maxOrder?.m || 0) + 1,
        'discover', 'sel', 'self_management',
      ]
    );
    console.log('Added: calm-down-corner to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
