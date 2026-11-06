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
// Team Pick (Explore) and Group Chat Meltdown (Challenge) also aren't
// among the blueprint's §12.3 examples — same as Source Sleuth/Calm
// Explorer/Digital Ally before them — but are kept in the same naming
// voice, themed around the self-management competency both games cover.
// Cue Spotter (Feelings Detective) follows the same pattern, themed
// around the cue-noticing mechanic rather than repeating the game's own
// "detective" name. Caring Friend (Sharing Circle) and Honest Helper
// (Helper's Choice) follow the same voice.
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
  { gameSlug: 'team-pick', slug: 'steady-player', name: 'Steady Player', emoji: '🙋',
    description: 'Completed Team Pick through a classroom assignment.' },
  { gameSlug: 'group-chat-meltdown', slug: 'clear-head', name: 'Clear Head', emoji: '💬',
    description: 'Completed Group Chat Meltdown through a classroom assignment.' },
  { gameSlug: 'feelings-detective', slug: 'cue-spotter', name: 'Cue Spotter', emoji: '🔍',
    description: 'Completed Feelings Detective through a classroom assignment.' },
  { gameSlug: 'sharing-circle', slug: 'caring-friend', name: 'Caring Friend', emoji: '🤗',
    description: 'Completed Sharing Circle through a classroom assignment.' },
  { gameSlug: 'helpers-choice', slug: 'honest-helper', name: 'Honest Helper', emoji: '✋',
    description: "Completed Helper's Choice through a classroom assignment." },
  { gameSlug: 'say-it-another-way', slug: 'clear-communicator', name: 'Clear Communicator', emoji: '💬',
    description: 'Completed Say It Another Way through a classroom assignment.' },
  { gameSlug: 'fix-it-workshop', slug: 'idea-builder', name: 'Idea Builder', emoji: '🛠️',
    description: 'Completed Fix-It Workshop through a classroom assignment.' },
  { gameSlug: 'strength-spotter', slug: 'strength-finder', name: 'Strength Finder', emoji: '🌟',
    description: 'Completed Strength Spotter through a classroom assignment.' },
  { gameSlug: 'same-and-different', slug: 'curious-friend', name: 'Curious Friend', emoji: '🤝',
    description: 'Completed Same and Different through a classroom assignment.' },
  { gameSlug: 'perspective-swap', slug: 'open-minded', name: 'Open Minded', emoji: '🔄',
    description: 'Completed Perspective Swap through a classroom assignment.' },
  { gameSlug: 'community-voice', slug: 'voice-for-change', name: 'Voice for Change', emoji: '📣',
    description: 'Completed Community Voice through a classroom assignment.' },
  { gameSlug: 'values-compass', slug: 'true-north', name: 'True North', emoji: '🧭',
    description: 'Completed Values Compass through a classroom assignment.' },
  { gameSlug: 'peace-table', slug: 'peacemaker', name: 'Peacemaker', emoji: '🕊️',
    description: 'Completed Peace Table through a classroom assignment.' },
  { gameSlug: 'idea-lab', slug: 'bright-idea', name: 'Bright Idea', emoji: '💡',
    description: 'Completed Idea Lab through a classroom assignment.' },
  { gameSlug: 'rhyme-time', slug: 'rhyme-finder', name: 'Rhyme Finder', emoji: '🎵',
    description: 'Completed Rhyme Time through a classroom assignment.' },
  { gameSlug: 'letter-sounds', slug: 'letter-hunter', name: 'Letter Hunter', emoji: '🔤',
    description: 'Completed Letter Sounds through a classroom assignment.' },
  { gameSlug: 'more-or-fewer', slug: 'number-judge', name: 'Number Judge', emoji: '⚖️',
    description: 'Completed More or Fewer through a classroom assignment.' },
  { gameSlug: 'add-it-up', slug: 'number-builder', name: 'Number Builder', emoji: '➕',
    description: 'Completed Add It Up through a classroom assignment.' },
  { gameSlug: 'pattern-parade', slug: 'pattern-spotter', name: 'Pattern Spotter', emoji: '🎨',
    description: 'Completed Pattern Parade through a classroom assignment.' },
  { gameSlug: 'animal-match', slug: 'sharp-memory', name: 'Sharp Memory', emoji: '🐱',
    description: 'Completed Animal Match through a classroom assignment.' },
  { gameSlug: 'my-feelings-today', slug: 'feelings-checker', name: 'Feelings Checker', emoji: '🪞',
    description: 'Completed My Feelings Today through a classroom assignment.' },
  { gameSlug: 'word-clues', slug: 'clue-finder', name: 'Clue Finder', emoji: '🔎',
    description: 'Completed Word Clues through a classroom assignment.' },
  { gameSlug: 'times-table-trail', slug: 'fact-finder', name: 'Fact Finder', emoji: '✖️',
    description: 'Completed Times Table Trail through a classroom assignment.' },
  { gameSlug: 'word-problem-workshop', slug: 'problem-picker', name: 'Problem Picker', emoji: '🧮',
    description: 'Completed Word Problem Workshop through a classroom assignment.' },
  { gameSlug: 'what-helps-me', slug: 'learning-guide', name: 'Learning Guide', emoji: '🧠',
    description: 'Completed What Helps Me through a classroom assignment.' },
  { gameSlug: 'know-your-triggers', slug: 'stress-spotter', name: 'Stress Spotter', emoji: '🧭',
    description: 'Completed Know Your Triggers through a classroom assignment.' },
  { gameSlug: 'know-yourself', slug: 'self-compass', name: 'Self Compass', emoji: '🔭',
    description: 'Completed Know Yourself through a classroom assignment.' },
  { gameSlug: 'stress-signals', slug: 'signal-reader', name: 'Signal Reader', emoji: '📡',
    description: 'Completed Stress Signals through a classroom assignment.' },
  { gameSlug: 'asking-nicely', slug: 'kind-words', name: 'Kind Words', emoji: '🙋',
    description: 'Completed Asking Nicely through a classroom assignment.' },
  { gameSlug: 'team-tower', slug: 'team-builder', name: 'Team Builder', emoji: '🧱',
    description: 'Completed Team Tower through a classroom assignment.' },
  { gameSlug: 'team-mission', slug: 'mission-mate', name: 'Mission Mate', emoji: '🚀',
    description: 'Completed Team Mission through a classroom assignment.' },
  { gameSlug: 'walk-in-my-shoes', slug: 'shoe-swapper', name: 'Shoe Swapper', emoji: '👟',
    description: 'Completed Walk in My Shoes through a classroom assignment.' },
  { gameSlug: 'many-ways-to-be', slug: 'rainbow-friend', name: 'Rainbow Friend', emoji: '🌈',
    description: 'Completed Many Ways to Be through a classroom assignment.' },
  { gameSlug: 'speak-up-kindly', slug: 'clear-and-kind', name: 'Clear and Kind', emoji: '🗣️',
    description: 'Completed Speak Up Kindly through a classroom assignment.' },
  { gameSlug: 'other-side-of-the-screen', slug: 'screen-empath', name: 'Screen Empath', emoji: '📱',
    description: 'Completed Other Side of the Screen through a classroom assignment.' },
  { gameSlug: 'walk-in-their-shoes', slug: 'both-sides', name: 'Both Sides', emoji: '🔀',
    description: 'Completed Walk in Their Shoes through a classroom assignment.' },
  { gameSlug: 'repair-it', slug: 'trust-fixer', name: 'Trust Fixer', emoji: '🔧',
    description: 'Completed Repair It through a classroom assignment.' },
  { gameSlug: 'many-voices', slug: 'every-voice', name: 'Every Voice', emoji: '📣',
    description: 'Completed Many Voices through a classroom assignment.' },
  { gameSlug: 'wait-for-it', slug: 'patient-player', name: 'Patient Player', emoji: '⏳',
    description: 'Completed Wait for It through a classroom assignment.' },
  { gameSlug: 'stop-and-think', slug: 'safe-chooser', name: 'Safe Chooser', emoji: '🛑',
    description: 'Completed Stop and Think through a classroom assignment.' },
  { gameSlug: 'stuck-on-it', slug: 'steady-climber', name: 'Steady Climber', emoji: '🧗',
    description: 'Completed Stuck on It through a classroom assignment.' },
  { gameSlug: 'peer-pressure-pause', slug: 'pause-pro', name: 'Pause Pro', emoji: '⏸️',
    description: 'Completed Peer Pressure Pause through a classroom assignment.' },
  { gameSlug: 'tone-detective', slug: 'tone-reader', name: 'Tone Reader', emoji: '🕵️',
    description: 'Completed Tone Detective through a classroom assignment.' },
  { gameSlug: 'ratio-shop', slug: 'smart-shopper', name: 'Smart Shopper', emoji: '🏷️',
    description: 'Completed Ratio Shop through a classroom assignment.' },
  { gameSlug: 'deadline-crunch', slug: 'deadline-keeper', name: 'Deadline Keeper', emoji: '⏰',
    description: 'Completed Deadline Crunch through a classroom assignment.' },
  { gameSlug: 'argument-check', slug: 'fair-judge', name: 'Fair Judge', emoji: '⚖️',
    description: 'Completed Argument Check through a classroom assignment.' },
  { gameSlug: 'graph-match', slug: 'shape-spotter', name: 'Shape Spotter', emoji: '📈',
    description: 'Completed Graph Match through a classroom assignment.' },
  { gameSlug: 'stats-check', slug: 'data-checker', name: 'Data Checker', emoji: '📊',
    description: 'Completed Stats Check through a classroom assignment.' },
  { gameSlug: 'plan-it', slug: 'master-planner', name: 'Master Planner', emoji: '🗓️',
    description: 'Completed Plan It through a classroom assignment.' },
  { gameSlug: 'switch-board', slug: 'quick-switcher', name: 'Quick Switcher', emoji: '🔀',
    description: 'Completed Switch Board through a classroom assignment.' },
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
