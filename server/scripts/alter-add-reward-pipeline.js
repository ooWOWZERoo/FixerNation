// Tune Your Brain, Phase 6 — adds brain_games.reward_pipeline so the new
// server-authoritative reward path (server/lib/rewards.js's
// awardClassroomCompletion(), called from student.js's game-completion
// route) knows which games it's allowed to award XP/badges for.
//
// The 6 legacy games already have their own detailed, per-slug XP/badge
// pipeline (routes/brain-games.js's PUT /sessions/:token/complete) —
// they're marked 'legacy' here so the new generic path never double-awards
// them. Every other game (the 4 Tune Your Brain pilot games, and any
// future one) defaults to 'classroom_generic' with no extra wiring needed.
//
// Safe to re-run: skipped if the column already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const LEGACY_SLUGS = [
  'memory-match', 'simon-sequence', 'number-sequence',
  'stroop-challenge', 'quick-math', 'reaction-time',
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [existing] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
    [process.env.DB_NAME, 'brain_games', 'reward_pipeline']
  );

  if (existing.length) {
    console.log('Skipped: brain_games.reward_pipeline already exists');
  } else {
    await conn.query(
      `ALTER TABLE brain_games
         ADD COLUMN reward_pipeline ENUM('legacy','classroom_generic') NOT NULL DEFAULT 'classroom_generic'`
    );
    console.log('Added: brain_games.reward_pipeline');
  }

  const [result] = await conn.query(
    `UPDATE brain_games SET reward_pipeline='legacy' WHERE slug IN (?)`,
    [LEGACY_SLUGS]
  );
  console.log(`Marked ${result.affectedRows} legacy game(s) as reward_pipeline='legacy'`);

  const [rows] = await conn.query('SELECT slug FROM brain_games WHERE slug IN (?)', [LEGACY_SLUGS]);
  const found = new Set(rows.map(r => r.slug));
  for (const slug of LEGACY_SLUGS) {
    if (!found.has(slug)) console.warn(`Warning: expected legacy slug not found in brain_games: ${slug}`);
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
