// Tune Your Brain, Phase 6 (extended in the Phase 7/8 catalog-scaling
// slice) — adds one "first classroom completion" badge per catalog game,
// using the blueprint's own proposed names (roadmap §12.3) where one
// fits: Sound Explorer, Context Detective, Responsible Responder,
// Budget Builder, Perspective Builder, Digital Citizen, Problem Solver,
// and now Leadership Builder (First Shift) — the 8th and last of the
// blueprint's own example names. Source Sleuth (Critical Read),
// Calm Explorer (Calm Down Corner), and Digital Ally (The Post) aren't
// among the blueprint's 8 examples — none of the remaining ones fit
// that content — but are kept in the same naming voice. Awarded by
// server/lib/rewards.js's
// awardClassroomCompletion() the first time a student completes that
// game through a real classroom assignment.
//
// Requires server/scripts/alter-add-reward-pipeline.js to have run first
// (this script only inserts brain_badges rows, it doesn't touch the
// reward_pipeline column).
//
// Safe to re-run: each badge is skipped if its slug already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const BADGES = [
  { gameSlug: 'sound-safari', slug: 'sound-explorer', name: 'Sound Explorer', emoji: '🦁',
    description: 'Completed Sound Safari through a classroom assignment.' },
  { gameSlug: 'reading-detective', slug: 'context-detective', name: 'Context Detective', emoji: '🔍',
    description: 'Completed Reading Detective through a classroom assignment.' },
  { gameSlug: 'decision-point', slug: 'responsible-responder', name: 'Responsible Responder', emoji: '🧭',
    description: 'Completed Decision Point through a classroom assignment.' },
  { gameSlug: 'money-matters', slug: 'budget-builder', name: 'Budget Builder', emoji: '💰',
    description: 'Completed Money Matters through a classroom assignment.' },
  { gameSlug: 'choice-quest', slug: 'perspective-builder', name: 'Perspective Builder', emoji: '🗺️',
    description: 'Completed Choice Quest through a classroom assignment.' },
  { gameSlug: 'headline', slug: 'digital-citizen', name: 'Digital Citizen', emoji: '📰',
    description: 'Completed Headline through a classroom assignment.' },
  { gameSlug: 'money-moves', slug: 'problem-solver', name: 'Problem Solver', emoji: '🚲',
    description: 'Completed Money Moves through a classroom assignment.' },
  { gameSlug: 'critical-read', slug: 'source-sleuth', name: 'Source Sleuth', emoji: '🧐',
    description: 'Completed Critical Read through a classroom assignment.' },
  { gameSlug: 'calm-down-corner', slug: 'calm-explorer', name: 'Calm Explorer', emoji: '🐢',
    description: 'Completed Calm Down Corner through a classroom assignment.' },
  { gameSlug: 'first-shift', slug: 'leadership-builder', name: 'Leadership Builder', emoji: '🧑‍💼',
    description: 'Completed First Shift through a classroom assignment.' },
  { gameSlug: 'the-post', slug: 'digital-ally', name: 'Digital Ally', emoji: '📱',
    description: 'Completed The Post through a classroom assignment.' },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  for (const b of BADGES) {
    const [[game]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', [b.gameSlug]);
    if (!game) {
      console.warn(`Skipped ${b.slug}: no brain_games row for slug '${b.gameSlug}' (run its catalog seed script first)`);
      continue;
    }

    const [[existing]] = await conn.query('SELECT id FROM brain_badges WHERE slug = ?', [b.slug]);
    if (existing) {
      console.log(`Skipped: ${b.slug} already exists (id=${existing.id})`);
      continue;
    }

    await conn.query(
      `INSERT INTO brain_badges (name, slug, description, game_id, category, rarity, criteria_type, criteria_json, xp_reward, emoji)
       VALUES (?, ?, ?, ?, 'achievement', 'common', 'first_classroom_completion', '{}', 15, ?)`,
      [b.name, b.slug, b.description, game.id, b.emoji]
    );
    console.log(`Added: ${b.slug}`);
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
