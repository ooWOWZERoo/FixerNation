require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, t) {
  const [r] = await conn.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [process.env.DB_NAME, t]);
  return r.length > 0;
}

const GAMES = [
  { name: 'Memory Match',    slug: 'memory-match',    description: 'Flip cards and find all matching pairs as fast as possible.',            icon: '🃏', primary_skill: 'Working Memory',      display_order: 1 },
  { name: 'Reaction Time',   slug: 'reaction-time',   description: 'Wait for the signal, then tap or click as quickly as you can.',          icon: '⚡', primary_skill: 'Processing Speed',    display_order: 2 },
  { name: 'Simon Sequence',  slug: 'simon-sequence',  description: 'Watch a color pattern grow longer each round and repeat it perfectly.',   icon: '🎵', primary_skill: 'Sequential Memory',   display_order: 3 },
  { name: 'Stroop Challenge',slug: 'stroop-challenge', description: 'Name the ink color of a word — resist reading what the word says.',      icon: '🎨', primary_skill: 'Cognitive Flexibility', display_order: 4 },
  { name: 'Quick Math',      slug: 'quick-math',      description: 'Solve arithmetic problems against the clock before time runs out.',       icon: '➕', primary_skill: 'Numerical Reasoning', display_order: 5 },
  { name: 'Number Sequence', slug: 'number-sequence', description: 'Identify the missing number in a mathematical pattern.',                  icon: '🔢', primary_skill: 'Pattern Recognition', display_order: 6 },
];

// Badge list: each references a game slug (null = cross-game)
const BADGES = [
  // ── Memory Match ──────────────────────────────────────────────────────────────
  { name: 'First Pair',        slug: 'memory-first-game',   game: 'memory-match',    category: 'completion',   rarity: 'common',    emoji: '🃏', xp:  25, display_order:  1, description: 'Complete your first Memory Match game.',                                                      criteria_type: 'sessions_completed',   criteria_json: '{"count":1}' },
  { name: 'Memory Starter',    slug: 'memory-starter',      game: 'memory-match',    category: 'completion',   rarity: 'common',    emoji: '🧠', xp:  50, display_order:  2, description: 'Complete five Memory Match games.',                                                           criteria_type: 'sessions_completed',   criteria_json: '{"count":5}' },
  { name: 'Efficient Flipper', slug: 'memory-efficient',    game: 'memory-match',    category: 'skill',        rarity: 'uncommon',  emoji: '✨', xp:  75, display_order:  3, description: 'Complete a Memory Match game with nearly optimal moves.',                                     criteria_type: 'moves_near_optimal',   criteria_json: '{"maxExtra":4}' },
  { name: 'Perfect Recall',    slug: 'memory-perfect',      game: 'memory-match',    category: 'skill',        rarity: 'rare',      emoji: '💎', xp: 150, display_order:  4, description: 'Complete a Memory Match game without any mismatches.',                                        criteria_type: 'zero_mismatches',      criteria_json: '{}' },
  { name: 'Big Board Champion',slug: 'memory-big-board',    game: 'memory-match',    category: 'achievement',  rarity: 'rare',      emoji: '🏆', xp: 125, display_order:  5, description: 'Complete the largest Memory Match board on hard difficulty.',                                  criteria_type: 'difficulty_completed', criteria_json: '{"difficulty":"hard"}' },
  { name: 'Memory Maestro',    slug: 'memory-master',       game: 'memory-match',    category: 'mastery',      rarity: 'legendary', emoji: '👑', xp: 500, display_order:  6, description: 'Reach Master level in Memory Match.',                                                         criteria_type: 'game_level',           criteria_json: '{"level":7}' },
  // ── Reaction Time ─────────────────────────────────────────────────────────────
  { name: 'Ready, Set, Tap',   slug: 'reaction-first',      game: 'reaction-time',   category: 'completion',   rarity: 'common',    emoji: '⚡', xp:  25, display_order:  7, description: 'Complete your first Reaction Time session.',                                                  criteria_type: 'sessions_completed',   criteria_json: '{"count":1}' },
  { name: 'Quick Draw',        slug: 'reaction-quick',      game: 'reaction-time',   category: 'skill',        rarity: 'uncommon',  emoji: '🎯', xp:  75, display_order:  8, description: 'Record a session average under 350 ms.',                                                      criteria_type: 'reaction_avg_max',     criteria_json: '{"maxAvgMs":350,"minAttempts":5}' },
  { name: 'Steady Hands',      slug: 'reaction-steady',     game: 'reaction-time',   category: 'skill',        rarity: 'common',    emoji: '🤲', xp:  50, display_order:  9, description: 'Complete a full session without a false start.',                                               criteria_type: 'false_starts_zero',    criteria_json: '{}' },
  { name: 'Lightning Reflexes',slug: 'reaction-lightning',  game: 'reaction-time',   category: 'achievement',  rarity: 'rare',      emoji: '⚡', xp: 150, display_order: 10, description: 'Average under 250 ms across five valid attempts.',                                             criteria_type: 'reaction_avg_max',     criteria_json: '{"maxAvgMs":250,"minAttempts":5}' },
  { name: 'Consistency Counts',slug: 'reaction-consistent', game: 'reaction-time',   category: 'skill',        rarity: 'rare',      emoji: '📊', xp: 125, display_order: 11, description: 'Keep all reaction times within 80 ms of each other.',                                         criteria_type: 'reaction_consistent',  criteria_json: '{"maxVarianceMs":80}' },
  { name: 'Reaction Master',   slug: 'reaction-master',     game: 'reaction-time',   category: 'mastery',      rarity: 'legendary', emoji: '👑', xp: 500, display_order: 12, description: 'Reach Master level in Reaction Time.',                                                        criteria_type: 'game_level',           criteria_json: '{"level":7}' },
  // ── Simon Sequence ────────────────────────────────────────────────────────────
  { name: 'Follow the Beat',   slug: 'simon-first',         game: 'simon-sequence',  category: 'completion',   rarity: 'common',    emoji: '🎵', xp:  25, display_order: 13, description: 'Complete your first Simon Sequence game.',                                                    criteria_type: 'sessions_completed',   criteria_json: '{"count":1}' },
  { name: 'Sequence Six',      slug: 'simon-six',           game: 'simon-sequence',  category: 'skill',        rarity: 'common',    emoji: '6️⃣', xp:  50, display_order: 14, description: 'Successfully repeat a sequence of 6.',                                                        criteria_type: 'sequence_length_min',  criteria_json: '{"length":6}' },
  { name: 'Double Digits',     slug: 'simon-ten',           game: 'simon-sequence',  category: 'achievement',  rarity: 'uncommon',  emoji: '🔟', xp:  75, display_order: 15, description: 'Successfully repeat a sequence of 10.',                                                       criteria_type: 'sequence_length_min',  criteria_json: '{"length":10}' },
  { name: 'In the Zone',       slug: 'simon-zone',          game: 'simon-sequence',  category: 'skill',        rarity: 'rare',      emoji: '🌊', xp: 150, display_order: 16, description: 'Complete 5 consecutive Simon rounds without an error.',                                        criteria_type: 'correct_streak_min',   criteria_json: '{"streak":5}' },
  { name: 'Pattern Performer', slug: 'simon-performer',     game: 'simon-sequence',  category: 'achievement',  rarity: 'epic',      emoji: '🎭', xp: 250, display_order: 17, description: 'Reach a sequence length of 15.',                                                              criteria_type: 'sequence_length_min',  criteria_json: '{"length":15}' },
  { name: 'Simon Master',      slug: 'simon-master',        game: 'simon-sequence',  category: 'mastery',      rarity: 'legendary', emoji: '👑', xp: 500, display_order: 18, description: 'Reach Master level in Simon Sequence.',                                                       criteria_type: 'game_level',           criteria_json: '{"level":7}' },
  // ── Stroop Challenge ──────────────────────────────────────────────────────────
  { name: 'Color Curious',     slug: 'stroop-first',        game: 'stroop-challenge',category: 'completion',   rarity: 'common',    emoji: '🎨', xp:  25, display_order: 19, description: 'Complete your first Stroop Challenge.',                                                       criteria_type: 'sessions_completed',   criteria_json: '{"count":1}' },
  { name: 'Focused Mind',      slug: 'stroop-focused',      game: 'stroop-challenge',category: 'skill',        rarity: 'uncommon',  emoji: '🔍', xp:  75, display_order: 20, description: 'Achieve at least 90% accuracy in a Stroop Challenge.',                                        criteria_type: 'accuracy_min',         criteria_json: '{"accuracy":90,"minQuestions":10}' },
  { name: 'Fast Focus',        slug: 'stroop-fast',         game: 'stroop-challenge',category: 'achievement',  rarity: 'rare',      emoji: '⚡', xp: 150, display_order: 21, description: 'Hit 90% accuracy while averaging under 2 seconds per answer.',                               criteria_type: 'accuracy_and_speed',   criteria_json: '{"accuracy":90,"maxAvgMs":2000}' },
  { name: 'Distraction Defeater', slug: 'stroop-defeater', game: 'stroop-challenge',category: 'achievement',  rarity: 'epic',      emoji: '🛡️', xp: 250, display_order: 22, description: 'Complete a hard round with less than 5% errors.',                                             criteria_type: 'accuracy_min',         criteria_json: '{"accuracy":95,"minQuestions":15,"difficulty":"hard"}' },
  { name: 'Perfect Focus',     slug: 'stroop-perfect',      game: 'stroop-challenge',category: 'skill',        rarity: 'epic',      emoji: '💯', xp: 250, display_order: 23, description: 'Complete a round with 100% accuracy.',                                                        criteria_type: 'accuracy_min',         criteria_json: '{"accuracy":100,"minQuestions":10}' },
  { name: 'Stroop Master',     slug: 'stroop-master',       game: 'stroop-challenge',category: 'mastery',      rarity: 'legendary', emoji: '👑', xp: 500, display_order: 24, description: 'Reach Master level in Stroop Challenge.',                                                     criteria_type: 'game_level',           criteria_json: '{"level":7}' },
  // ── Quick Math ────────────────────────────────────────────────────────────────
  { name: 'First Equation',    slug: 'math-first',          game: 'quick-math',      category: 'completion',   rarity: 'common',    emoji: '➕', xp:  25, display_order: 25, description: 'Complete your first Quick Math game.',                                                        criteria_type: 'sessions_completed',   criteria_json: '{"count":1}' },
  { name: 'Ten in a Row',      slug: 'math-streak',         game: 'quick-math',      category: 'skill',        rarity: 'uncommon',  emoji: '🔥', xp:  75, display_order: 26, description: 'Answer 10 Quick Math questions in a row without an error.',                                  criteria_type: 'correct_streak_min',   criteria_json: '{"streak":10}' },
  { name: 'Number Sprinter',   slug: 'math-sprinter',       game: 'quick-math',      category: 'achievement',  rarity: 'rare',      emoji: '🏃', xp: 150, display_order: 27, description: 'Answer 15 or more problems correctly in a single session.',                                  criteria_type: 'correct_count_min',    criteria_json: '{"count":15}' },
  { name: 'Mixed Math Mind',   slug: 'math-mixed',          game: 'quick-math',      category: 'achievement',  rarity: 'rare',      emoji: '🧮', xp: 125, display_order: 28, description: 'Complete a hard Quick Math session.',                                                         criteria_type: 'difficulty_completed', criteria_json: '{"difficulty":"hard"}' },
  { name: 'Perfect Calculation',slug:'math-perfect',        game: 'quick-math',      category: 'skill',        rarity: 'epic',      emoji: '💯', xp: 250, display_order: 29, description: 'Complete a session with 100% accuracy on at least 10 problems.',                             criteria_type: 'accuracy_min',         criteria_json: '{"accuracy":100,"minQuestions":10}' },
  { name: 'Math Master',       slug: 'math-master',         game: 'quick-math',      category: 'mastery',      rarity: 'legendary', emoji: '👑', xp: 500, display_order: 30, description: 'Reach Master level in Quick Math.',                                                          criteria_type: 'game_level',           criteria_json: '{"level":7}' },
  // ── Number Sequence ───────────────────────────────────────────────────────────
  { name: 'Pattern Finder',    slug: 'sequence-first',      game: 'number-sequence', category: 'completion',   rarity: 'common',    emoji: '🔢', xp:  25, display_order: 31, description: 'Complete your first Number Sequence game.',                                                   criteria_type: 'sessions_completed',   criteria_json: '{"count":1}' },
  { name: 'Sequence Solver',   slug: 'sequence-solver',     game: 'number-sequence', category: 'skill',        rarity: 'common',    emoji: '🧩', xp:  50, display_order: 32, description: 'Answer 5 Number Sequence questions correctly.',                                               criteria_type: 'correct_count_min',    criteria_json: '{"count":5}' },
  { name: 'Pattern Streak',    slug: 'sequence-streak',     game: 'number-sequence', category: 'skill',        rarity: 'uncommon',  emoji: '🔥', xp:  75, display_order: 33, description: 'Answer 8 Number Sequence questions in a row correctly.',                                      criteria_type: 'correct_streak_min',   criteria_json: '{"streak":8}' },
  { name: 'Rule Breaker',      slug: 'sequence-rule',       game: 'number-sequence', category: 'achievement',  rarity: 'rare',      emoji: '💥', xp: 150, display_order: 34, description: 'Complete a hard Number Sequence session.',                                                    criteria_type: 'difficulty_completed', criteria_json: '{"difficulty":"hard"}' },
  { name: 'Sequence Savant',   slug: 'sequence-savant',     game: 'number-sequence', category: 'achievement',  rarity: 'epic',      emoji: '🎓', xp: 250, display_order: 35, description: 'Hit 90% accuracy across a hard Number Sequence session.',                                    criteria_type: 'accuracy_min',         criteria_json: '{"accuracy":90,"minQuestions":10,"difficulty":"hard"}' },
  { name: 'Sequence Master',   slug: 'sequence-master',     game: 'number-sequence', category: 'mastery',      rarity: 'legendary', emoji: '👑', xp: 500, display_order: 36, description: 'Reach Master level in Number Sequence.',                                                      criteria_type: 'game_level',           criteria_json: '{"level":7}' },
  // ── Cross-game ────────────────────────────────────────────────────────────────
  { name: 'Brain Games Beginner',slug:'cross-beginner',     game: null,              category: 'cross_game',   rarity: 'uncommon',  emoji: '🌱', xp: 100, display_order: 37, description: 'Complete at least one game in all six brain-game categories.',                               criteria_type: 'cross_all_games',      criteria_json: '{}' },
  { name: 'Well Rounded',      slug: 'cross-rounded',       game: null,              category: 'cross_game',   rarity: 'rare',      emoji: '⭐', xp: 200, display_order: 38, description: 'Reach Skilled level (level 4) or higher in all six games.',                                  criteria_type: 'all_games_level_min',  criteria_json: '{"level":4}' },
  { name: 'Daily Tune-Up',     slug: 'cross-daily',         game: null,              category: 'consistency',  rarity: 'common',    emoji: '📅', xp:  75, display_order: 39, description: 'Play brain games on three consecutive days.',                                                  criteria_type: 'streak_days_min',      criteria_json: '{"days":3}' },
  { name: 'Weekly Rhythm',     slug: 'cross-weekly',        game: null,              category: 'consistency',  rarity: 'rare',      emoji: '📆', xp: 200, display_order: 40, description: 'Play brain games on seven consecutive days.',                                                  criteria_type: 'streak_days_min',      criteria_json: '{"days":7}' },
  { name: 'Dedicated Player',  slug: 'cross-dedicated',     game: null,              category: 'cross_game',   rarity: 'epic',      emoji: '🏅', xp: 300, display_order: 41, description: 'Complete 100 valid game sessions.',                                                           criteria_type: 'total_sessions_min',   criteria_json: '{"count":100}' },
  { name: 'Personal Best Collector', slug:'cross-pb-all',   game: null,              category: 'achievement',  rarity: 'rare',      emoji: '🌟', xp: 200, display_order: 42, description: 'Set a personal best in all six games.',                                                       criteria_type: 'personal_best_all_games',criteria_json:'{}' },
  { name: 'Brain Game Explorer',slug:'cross-explorer',      game: null,              category: 'cross_game',   rarity: 'rare',      emoji: '🗺️', xp: 200, display_order: 43, description: 'Play every difficulty level in all six games.',                                               criteria_type: 'all_difficulties_all_games', criteria_json: '{}' },
  { name: 'Tune Your Brain Master',slug:'cross-ultimate',   game: null,              category: 'mastery',      rarity: 'legendary', emoji: '🧠', xp: 1000,display_order: 44, description: 'Reach Master level in all six games.',                                                        criteria_type: 'all_games_master',     criteria_json: '{}' },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  // 1. brain_games
  if (await tableExists(conn, 'brain_games')) {
    console.log('Skipped: brain_games');
  } else {
    await conn.query(`CREATE TABLE brain_games (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(50) NOT NULL UNIQUE,
      description TEXT NULL,
      icon VARCHAR(10) NULL,
      primary_skill VARCHAR(100) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    for (const g of GAMES) {
      await conn.query(
        'INSERT INTO brain_games (name,slug,description,icon,primary_skill,display_order) VALUES (?,?,?,?,?,?)',
        [g.name, g.slug, g.description, g.icon, g.primary_skill, g.display_order]
      );
    }
    console.log('Created + seeded: brain_games (6 games)');
  }

  // 2. brain_game_sessions
  if (await tableExists(conn, 'brain_game_sessions')) {
    console.log('Skipped: brain_game_sessions');
  } else {
    await conn.query(`CREATE TABLE brain_game_sessions (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      game_id INT UNSIGNED NOT NULL,
      session_token VARCHAR(64) NOT NULL UNIQUE,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      duration_ms INT UNSIGNED NULL,
      difficulty VARCHAR(16) NOT NULL DEFAULT 'medium',
      raw_score INT UNSIGNED NULL,
      normalized_score INT UNSIGNED NULL,
      accuracy DECIMAL(5,2) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'started',
      metrics_json TEXT NULL,
      scoring_version INT UNSIGNED NOT NULL DEFAULT 1,
      validation_status VARCHAR(16) NOT NULL DEFAULT 'valid',
      leaderboard_eligible TINYINT(1) NOT NULL DEFAULT 1,
      xp_earned INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_game (user_id, game_id),
      INDEX idx_user (user_id),
      INDEX idx_token (session_token),
      FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES brain_games(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: brain_game_sessions');
  }

  // 3. brain_game_user_progress
  if (await tableExists(conn, 'brain_game_user_progress')) {
    console.log('Skipped: brain_game_user_progress');
  } else {
    await conn.query(`CREATE TABLE brain_game_user_progress (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      game_id INT UNSIGNED NOT NULL,
      level INT UNSIGNED NOT NULL DEFAULT 1,
      xp INT UNSIGNED NOT NULL DEFAULT 0,
      total_sessions INT UNSIGNED NOT NULL DEFAULT 0,
      total_completed INT UNSIGNED NOT NULL DEFAULT 0,
      best_raw_score INT UNSIGNED NULL,
      best_normalized_score INT UNSIGNED NULL,
      best_metrics_json TEXT NULL,
      last_played_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_game (user_id, game_id),
      FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES brain_games(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: brain_game_user_progress');
  }

  // 4. brain_badges
  if (await tableExists(conn, 'brain_badges')) {
    console.log('Skipped: brain_badges');
  } else {
    await conn.query(`CREATE TABLE brain_badges (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      description TEXT NULL,
      game_id INT UNSIGNED NULL,
      category VARCHAR(32) NOT NULL DEFAULT 'achievement',
      rarity VARCHAR(16) NOT NULL DEFAULT 'common',
      criteria_type VARCHAR(50) NOT NULL,
      criteria_json TEXT NOT NULL,
      xp_reward INT UNSIGNED NOT NULL DEFAULT 50,
      emoji VARCHAR(10) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      publicly_displayable TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES brain_games(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Build slug → game_id map
    const [gameRows] = await conn.query('SELECT id, slug FROM brain_games');
    const gameMap = {};
    for (const g of gameRows) gameMap[g.slug] = g.id;

    for (const b of BADGES) {
      const gameId = b.game ? (gameMap[b.game] || null) : null;
      await conn.query(
        'INSERT INTO brain_badges (name,slug,description,game_id,category,rarity,criteria_type,criteria_json,xp_reward,emoji,display_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [b.name, b.slug, b.description, gameId, b.category, b.rarity, b.criteria_type, b.criteria_json, b.xp, b.emoji, b.display_order]
      );
    }
    console.log(`Created + seeded: brain_badges (${BADGES.length} badges)`);
  }

  // 5. user_brain_badges
  if (await tableExists(conn, 'user_brain_badges')) {
    console.log('Skipped: user_brain_badges');
  } else {
    await conn.query(`CREATE TABLE user_brain_badges (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      badge_id INT UNSIGNED NOT NULL,
      earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      triggering_session_id INT UNSIGNED NULL,
      featured TINYINT(1) NOT NULL DEFAULT 0,
      featured_position INT UNSIGNED NULL,
      visibility VARCHAR(16) NOT NULL DEFAULT 'public',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_badge (user_id, badge_id),
      INDEX idx_user (user_id),
      FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE,
      FOREIGN KEY (badge_id) REFERENCES brain_badges(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: user_brain_badges');
  }

  // 6. brain_user_streaks
  if (await tableExists(conn, 'brain_user_streaks')) {
    console.log('Skipped: brain_user_streaks');
  } else {
    await conn.query(`CREATE TABLE brain_user_streaks (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      current_streak INT UNSIGNED NOT NULL DEFAULT 0,
      longest_streak INT UNSIGNED NOT NULL DEFAULT 0,
      last_qualifying_date DATE NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: brain_user_streaks');
  }

  // 7. brain_game_privacy
  if (await tableExists(conn, 'brain_game_privacy')) {
    console.log('Skipped: brain_game_privacy');
  } else {
    await conn.query(`CREATE TABLE brain_game_privacy (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      show_activity TINYINT(1) NOT NULL DEFAULT 0,
      show_score TINYINT(1) NOT NULL DEFAULT 0,
      show_streaks TINYINT(1) NOT NULL DEFAULT 0,
      show_badges TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: brain_game_privacy');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
