// Tune Your Brain — adds Group Chat Meltdown as a real, assignable entry
// in the classroom game-assignment flow, by extending the existing
// brain_games catalog table rather than building a parallel one.
//
// Challenge band's second SEL & Character game (already had Decision
// Point), and the second Self-management game overall — see
// docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's SEL x band table,
// which flagged Self-management as having zero coverage anywhere.
// band/domain/casel_competencies are set directly at insert time, same
// pattern as seed-team-pick-catalog-entry.js.
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

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['group-chat-meltdown']);
  if (existing) {
    console.log('Skipped: group-chat-meltdown already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      `INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Group Chat Meltdown', 'group-chat-meltdown',
        'Work through a real Issues-to-Answers cycle on an online group-chat conflict. A Tune Your Brain SEL experience.',
        '💬', 'Self-Management', (maxOrder?.m || 0) + 1,
        'challenge', 'sel', 'self_management,responsible_decision_making',
      ]
    );
    console.log('Added: group-chat-meltdown to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
