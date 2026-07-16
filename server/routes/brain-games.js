const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('../lib/session');

const router = express.Router();

function describeBadgeCriteria(type, criteriaJson) {
  try {
    const c = typeof criteriaJson === 'string' ? JSON.parse(criteriaJson || '{}') : (criteriaJson || {});
    const ms = n => n >= 1000 ? (n / 1000).toFixed(1) + 's' : n + 'ms';
    switch (type) {
      case 'count':         return `Play ${c.count} session${c.count !== 1 ? 's' : ''}`;
      case 'memory_perfect': return 'Complete a Memory Match game with a perfect score (no mismatches)';
      case 'difficulty':    return `Complete a game on ${c.difficulty} difficulty`;
      case 'fast_avg':      return `Average reaction time ≤ ${ms(c.maxAvgMs)} over ${c.minAttempts || 5} rounds`;
      case 'consistent_reaction': return `Keep reaction time variance ≤ ${ms(c.maxVarianceMs)} across ${c.minAttempts || 5} rounds`;
      case 'simon_length':  return `Reach a sequence length of ${c.length} in Simon Sequence`;
      case 'long_streak':   return `Achieve a ${c.streak}-correct streak in a single game`;
      case 'quick_math_count': return `Answer ${c.count} Quick Math questions correctly in one session`;
      case 'quick_math_accuracy': return `Reach ${c.accuracy}% accuracy in Quick Math${c.difficulty ? ` on ${c.difficulty} difficulty` : ''}`;
      case 'fast_accurate': return `Score ${c.accuracy}% accuracy with avg speed ≤ ${ms(c.maxAvgMs)}`;
      case 'number_level':  return `Reach level ${c.level} in Number Sequence`;
      case 'login_streak':  return `Log in ${c.days} day${c.days !== 1 ? 's' : ''} in a row`;
      case 'cross_game':    return `Play ${c.count} different brain games`;
      default:              return null;
    }
  } catch { return null; }
}

// ── XP / Level system ─────────────────────────────────────────────────────────
const XP_LEVELS = [
  { level: 1, name: 'Beginner',   xpRequired: 0 },
  { level: 2, name: 'Learner',    xpRequired: 150 },
  { level: 3, name: 'Challenger', xpRequired: 400 },
  { level: 4, name: 'Skilled',    xpRequired: 800 },
  { level: 5, name: 'Advanced',   xpRequired: 1500 },
  { level: 6, name: 'Expert',     xpRequired: 2500 },
  { level: 7, name: 'Master',     xpRequired: 4000 },
];

function getLevelFromXP(xp) {
  let lvl = XP_LEVELS[0];
  for (const l of XP_LEVELS) { if (xp >= l.xpRequired) lvl = l; else break; }
  return lvl;
}

function getNextLevel(xp) {
  for (const l of XP_LEVELS) { if (xp < l.xpRequired) return l; }
  return null;
}

function calcXPForSession(difficulty, isPersonalBest, accuracy) {
  let xp = 25;
  if (difficulty === 'medium') xp += 15;
  if (difficulty === 'hard') xp += 30;
  if (isPersonalBest) xp += 50;
  if (accuracy != null && accuracy >= 90) xp += 20;
  return xp;
}

// ── Scoring (server-side recalculation) ───────────────────────────────────────
function calcScore(gameSlug, metrics, difficulty) {
  const diff = { easy: 0, medium: 1, hard: 2 }[difficulty] ?? 1;

  if (gameSlug === 'memory-match') {
    const { pairs = 8, moves = 16, mismatches = 0, durationMs = 60000 } = metrics;
    const movePenalty = Math.max(0, moves - pairs) * 12;
    const mismatchPenalty = mismatches * 25;
    const timePenalty = Math.min(300, Math.floor(durationMs / 1000) * 2);
    const diffBonus = diff * 100;
    return Math.max(0, 1000 - movePenalty - mismatchPenalty - timePenalty + diffBonus);
  }

  if (gameSlug === 'reaction-time') {
    const times = metrics.validTimes || [];
    if (!times.length) return 0;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return Math.max(0, Math.round(1000 - (avg - 150) * 2));
  }

  if (gameSlug === 'simon-sequence') {
    const { maxLength = 0, correctRounds = 0 } = metrics;
    const diffMult = [1, 1.2, 1.5][diff];
    return Math.round((maxLength * 80 + correctRounds * 20) * diffMult);
  }

  if (gameSlug === 'stroop-challenge') {
    const { correct = 0, incorrect = 0, avgResponseMs = 3000 } = metrics;
    const total = correct + incorrect;
    const acc = total > 0 ? correct / total : 0;
    const speedBonus = Math.max(0, 200 - Math.floor(avgResponseMs / 10));
    return Math.max(0, Math.round(acc * 800 + speedBonus + diff * 100));
  }

  if (gameSlug === 'quick-math') {
    const { correct = 0, incorrect = 0, avgAnswerMs = 5000 } = metrics;
    const total = correct + incorrect;
    const acc = total > 0 ? correct / total : 0;
    const speedBonus = Math.max(0, 300 - Math.floor(avgAnswerMs / 10));
    return Math.max(0, Math.round(acc * 800 + correct * 15 + speedBonus + diff * 100));
  }

  if (gameSlug === 'number-sequence') {
    const { correct = 0, incorrect = 0, avgResponseMs = 5000 } = metrics;
    const total = correct + incorrect;
    const acc = total > 0 ? correct / total : 0;
    const speedBonus = Math.max(0, 200 - Math.floor(avgResponseMs / 10));
    return Math.max(0, Math.round(acc * 700 + correct * 20 + speedBonus + diff * 100));
  }

  return 0;
}

function getAccuracy(gameSlug, metrics) {
  if (gameSlug === 'memory-match') {
    const { moves = 1, mismatches = 0 } = metrics;
    return Math.round(((moves - mismatches) / moves) * 100);
  }
  if (gameSlug === 'reaction-time') return 100; // accuracy doesn't apply
  if (gameSlug === 'simon-sequence') {
    const { correctRounds = 0, maxLength = 1 } = metrics;
    return Math.min(100, Math.round((correctRounds / Math.max(1, maxLength)) * 100));
  }
  const correct = metrics.correct ?? 0;
  const incorrect = metrics.incorrect ?? 0;
  const total = correct + incorrect;
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

// Validate that submitted metrics are plausible (anti-tamper)
function validateMetrics(gameSlug, metrics, durationMs) {
  if (!metrics || typeof metrics !== 'object') return false;
  if (!durationMs || durationMs < 1000) return false;

  if (gameSlug === 'memory-match') {
    const { pairs = 0, moves = 0 } = metrics;
    if (pairs < 4 || pairs > 30) return false;
    if (moves < pairs) return false; // can't match fewer moves than pairs
    if (durationMs < pairs * 500) return false; // too fast
  }

  if (gameSlug === 'reaction-time') {
    const times = metrics.validTimes;
    if (!Array.isArray(times)) return false;
    if (times.some(t => t < 80 || t > 10000)) return false; // physically impossible
  }

  if (gameSlug === 'simon-sequence') {
    const { maxLength = 0 } = metrics;
    if (durationMs < maxLength * 800) return false;
  }

  if (['stroop-challenge', 'quick-math', 'number-sequence'].includes(gameSlug)) {
    const total = (metrics.correct ?? 0) + (metrics.incorrect ?? 0);
    if (total > 0 && durationMs < total * 300) return false; // too fast per question
  }

  return true;
}

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getSiteUser(req) {
  const token = req.cookies?.[SITE_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [[user]] = await pool.query(
      'SELECT id, email, first_name, last_name FROM site_users WHERE id = ?', [payload.userId]
    );
    return user || null;
  } catch { return null; }
}

// ── Badge evaluation ──────────────────────────────────────────────────────────
async function evaluateBadgeCriteria(type, criteria, userId, gameId, metrics) {
  switch (type) {
    case 'sessions_completed': {
      const [r] = await pool.query(
        "SELECT COUNT(*) AS c FROM brain_game_sessions WHERE user_id=? AND game_id=? AND status='completed'",
        [userId, gameId]
      );
      return r[0].c >= criteria.count;
    }
    case 'moves_near_optimal': {
      const { pairs = 0, moves = 9999 } = metrics;
      return moves <= (pairs + (criteria.maxExtra ?? 4));
    }
    case 'zero_mismatches': {
      return (metrics.mismatches ?? 1) === 0 && metrics.completed;
    }
    case 'difficulty_completed': {
      return metrics._difficulty === criteria.difficulty && metrics.completed !== false;
    }
    case 'reaction_avg_max': {
      const times = metrics.validTimes || [];
      if (times.length < (criteria.minAttempts || 1)) return false;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return avg <= criteria.maxAvgMs;
    }
    case 'false_starts_zero': {
      return (metrics.falseStarts ?? 0) === 0;
    }
    case 'reaction_consistent': {
      const times = metrics.validTimes || [];
      if (!times.length) return false;
      return (Math.max(...times) - Math.min(...times)) <= criteria.maxVarianceMs;
    }
    case 'sequence_length_min': {
      return (metrics.maxLength ?? 0) >= criteria.length;
    }
    case 'correct_streak_min': {
      return (metrics.longestStreak ?? 0) >= criteria.streak;
    }
    case 'correct_count_min': {
      return (metrics.correct ?? 0) >= criteria.count;
    }
    case 'accuracy_min': {
      const correct = metrics.correct ?? 0;
      const incorrect = metrics.incorrect ?? 0;
      const total = correct + incorrect;
      if (total < (criteria.minQuestions ?? 1)) return false;
      const acc = total > 0 ? (correct / total) * 100 : 0;
      if (acc < criteria.accuracy) return false;
      if (criteria.difficulty && metrics._difficulty !== criteria.difficulty) return false;
      return true;
    }
    case 'accuracy_and_speed': {
      const correct = metrics.correct ?? 0;
      const incorrect = metrics.incorrect ?? 0;
      const total = correct + incorrect;
      if (!total) return false;
      const acc = (correct / total) * 100;
      const speed = metrics.avgResponseMs ?? metrics.avgAnswerMs ?? 9999;
      return acc >= criteria.accuracy && speed <= criteria.maxAvgMs;
    }
    case 'game_level': {
      const [r] = await pool.query(
        'SELECT level FROM brain_game_user_progress WHERE user_id=? AND game_id=?', [userId, gameId]
      );
      return r.length > 0 && r[0].level >= criteria.level;
    }
    case 'cross_all_games': {
      const [r] = await pool.query(
        "SELECT COUNT(DISTINCT game_id) AS c FROM brain_game_sessions WHERE user_id=? AND status='completed'",
        [userId]
      );
      return r[0].c >= 6;
    }
    case 'all_games_level_min': {
      const [r] = await pool.query(
        'SELECT COUNT(*) AS c FROM brain_game_user_progress WHERE user_id=? AND level>=?',
        [userId, criteria.level]
      );
      return r[0].c >= 6;
    }
    case 'streak_days_min': {
      const [r] = await pool.query(
        'SELECT current_streak FROM brain_user_streaks WHERE user_id=?', [userId]
      );
      return r.length > 0 && r[0].current_streak >= criteria.days;
    }
    case 'total_sessions_min': {
      const [r] = await pool.query(
        "SELECT COUNT(*) AS c FROM brain_game_sessions WHERE user_id=? AND status='completed'", [userId]
      );
      return r[0].c >= criteria.count;
    }
    case 'personal_best_all_games': {
      const [r] = await pool.query(
        'SELECT COUNT(*) AS c FROM brain_game_user_progress WHERE user_id=? AND best_raw_score IS NOT NULL', [userId]
      );
      return r[0].c >= 6;
    }
    case 'all_difficulties_all_games': {
      const [r] = await pool.query(
        "SELECT game_id FROM brain_game_sessions WHERE user_id=? AND status='completed' GROUP BY game_id HAVING COUNT(DISTINCT difficulty) >= 3",
        [userId]
      );
      return r.length >= 6;
    }
    case 'all_games_master': {
      const [r] = await pool.query(
        'SELECT COUNT(*) AS c FROM brain_game_user_progress WHERE user_id=? AND level>=7', [userId]
      );
      return r[0].c >= 6;
    }
    default: return false;
  }
}

async function awardBadges(userId, gameId, sessionId, metrics) {
  // Fetch badges for this game + cross-game badges
  const [allBadges] = await pool.query(
    'SELECT * FROM brain_badges WHERE active=1 AND (game_id=? OR game_id IS NULL)',
    [gameId]
  );
  if (!allBadges.length) return [];

  // Get already-earned badge IDs
  const [earnedRows] = await pool.query(
    'SELECT badge_id FROM user_brain_badges WHERE user_id=?', [userId]
  );
  const earned = new Set(earnedRows.map(r => r.badge_id));

  const newBadges = [];
  for (const badge of allBadges) {
    if (earned.has(badge.id)) continue;
    const criteria = JSON.parse(badge.criteria_json || '{}');
    let passes = false;
    try {
      passes = await evaluateBadgeCriteria(badge.criteria_type, criteria, userId, gameId, metrics);
    } catch { /* skip on error */ }

    if (passes) {
      await pool.query(
        'INSERT IGNORE INTO user_brain_badges (user_id, badge_id, earned_at, triggering_session_id) VALUES (?, ?, NOW(), ?)',
        [userId, badge.id, sessionId]
      );
      newBadges.push({
        id: badge.id, name: badge.name, slug: badge.slug,
        description: badge.description, rarity: badge.rarity,
        emoji: badge.emoji, xpReward: badge.xp_reward,
      });
    }
  }
  return newBadges;
}

// ── Streak update ─────────────────────────────────────────────────────────────
async function updateStreak(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query('SELECT * FROM brain_user_streaks WHERE user_id=?', [userId]);

  if (!rows.length) {
    await pool.query(
      'INSERT INTO brain_user_streaks (user_id, current_streak, longest_streak, last_qualifying_date) VALUES (?, 1, 1, ?)',
      [userId, today]
    );
    return;
  }

  const row = rows[0];
  const last = row.last_qualifying_date;
  if (last === today) return; // already played today

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  let newStreak = last === yStr ? row.current_streak + 1 : 1;
  const longest = Math.max(row.longest_streak, newStreak);
  await pool.query(
    'UPDATE brain_user_streaks SET current_streak=?, longest_streak=?, last_qualifying_date=? WHERE user_id=?',
    [newStreak, longest, today, userId]
  );
}

// ── Route helpers ─────────────────────────────────────────────────────────────
function progressRow(row) {
  const lvl = getLevelFromXP(row.xp);
  const next = getNextLevel(row.xp);
  return {
    gameId: row.game_id, level: lvl.level, levelName: lvl.name,
    xp: row.xp, xpToNext: next ? next.xpRequired - row.xp : 0,
    xpForNext: next ? next.xpRequired : null,
    totalSessions: row.total_sessions, totalCompleted: row.total_completed,
    bestRawScore: row.best_raw_score, bestNormalizedScore: row.best_normalized_score,
    lastPlayedAt: row.last_played_at,
  };
}

// ── GET /api/brain-games ──────────────────────────────────────────────────────
const STATIC_GAMES = [
  { id:0, name:'Memory Match',     slug:'memory-match',     description:'Flip cards and find all matching pairs as fast as possible.',           icon:'🃏', primarySkill:'Working Memory',      progress:null },
  { id:0, name:'Reaction Time',    slug:'reaction-time',    description:'Wait for the signal, then tap or click as quickly as you can.',         icon:'⚡', primarySkill:'Processing Speed',    progress:null },
  { id:0, name:'Simon Sequence',   slug:'simon-sequence',   description:'Watch a color pattern grow longer each round and repeat it perfectly.',  icon:'🎵', primarySkill:'Sequential Memory',   progress:null },
  { id:0, name:'Stroop Challenge', slug:'stroop-challenge', description:'Name the ink color of a word — resist reading what the word says.',     icon:'🎨', primarySkill:'Cognitive Flexibility',progress:null },
  { id:0, name:'Quick Math',       slug:'quick-math',       description:'Solve arithmetic problems against the clock before time runs out.',      icon:'➕', primarySkill:'Numerical Reasoning', progress:null },
  { id:0, name:'Number Sequence',  slug:'number-sequence',  description:'Identify the missing number in a mathematical pattern.',                 icon:'🔢', primarySkill:'Pattern Recognition', progress:null },
];

router.get('/', async (req, res) => {
  try {
    const [games] = await pool.query(
      'SELECT * FROM brain_games WHERE active=1 ORDER BY display_order'
    );
    const user = await getSiteUser(req);
    let progressMap = {};

    if (user) {
      const [progress] = await pool.query(
        'SELECT * FROM brain_game_user_progress WHERE user_id=?', [user.id]
      );
      for (const p of progress) progressMap[p.game_id] = progressRow(p);
    }

    const result = games.map(g => ({
      id: g.id, name: g.name, slug: g.slug,
      description: g.description, icon: g.icon,
      primarySkill: g.primary_skill,
      progress: progressMap[g.id] || null,
    }));

    res.json({ games: result });
  } catch {
    // DB tables may not exist yet (migration pending) — return static list
    res.json({ games: STATIC_GAMES });
  }
});

// ── POST /api/brain-games/sessions ───────────────────────────────────────────
router.post('/sessions', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required to save progress' });

  const { gameSlug, difficulty = 'medium' } = req.body || {};
  if (!gameSlug) return res.status(400).json({ error: 'gameSlug is required' });
  if (!['easy', 'medium', 'hard'].includes(difficulty)) return res.status(400).json({ error: 'Invalid difficulty' });

  const [[game]] = await pool.query('SELECT * FROM brain_games WHERE slug=? AND active=1', [gameSlug]);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const [result] = await pool.query(
    'INSERT INTO brain_game_sessions (user_id, game_id, session_token, difficulty) VALUES (?, ?, ?, ?)',
    [user.id, game.id, sessionToken, difficulty]
  );

  // Upsert progress row so it exists
  await pool.query(
    'INSERT IGNORE INTO brain_game_user_progress (user_id, game_id) VALUES (?, ?)',
    [user.id, game.id]
  );
  await pool.query(
    'UPDATE brain_game_user_progress SET total_sessions=total_sessions+1, last_played_at=NOW() WHERE user_id=? AND game_id=?',
    [user.id, game.id]
  );

  res.status(201).json({ sessionId: result.insertId, sessionToken });
});

// ── PUT /api/brain-games/sessions/:token/complete ────────────────────────────
router.put('/sessions/:token/complete', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const [[session]] = await pool.query(
    "SELECT s.*, g.slug AS game_slug, g.id AS game_id FROM brain_game_sessions s JOIN brain_games g ON g.id=s.game_id WHERE s.session_token=?",
    [req.params.token]
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.user_id !== user.id) return res.status(403).json({ error: 'Not your session' });
  if (session.status === 'completed') return res.status(409).json({ error: 'Session already completed' });

  const { metrics = {}, durationMs } = req.body || {};
  if (!durationMs || durationMs < 0) return res.status(400).json({ error: 'durationMs is required' });

  // Add difficulty to metrics for badge evaluation
  metrics._difficulty = session.difficulty;
  metrics.completed = true;

  const isValid = validateMetrics(session.game_slug, metrics, durationMs);
  const validationStatus = isValid ? 'valid' : 'suspicious';

  // Server-side score recalculation
  const normalizedScore = calcScore(session.game_slug, metrics, session.difficulty);
  const accuracy = getAccuracy(session.game_slug, metrics);

  // Check personal best
  const [[prog]] = await pool.query(
    'SELECT best_raw_score, best_normalized_score FROM brain_game_user_progress WHERE user_id=? AND game_id=?',
    [user.id, session.game_id]
  );
  const isPersonalBest = !prog?.best_normalized_score || normalizedScore > prog.best_normalized_score;

  // Award XP
  const xpEarned = isValid ? calcXPForSession(session.difficulty, isPersonalBest, accuracy) : 0;
  const currentXP = prog ? prog.xp || 0 : 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Complete the session
    await conn.query(
      `UPDATE brain_game_sessions SET status='completed', completed_at=NOW(), duration_ms=?,
       normalized_score=?, accuracy=?, metrics_json=?, validation_status=?, xp_earned=?,
       leaderboard_eligible=? WHERE id=?`,
      [durationMs, normalizedScore, accuracy, JSON.stringify(metrics), validationStatus, xpEarned, isValid ? 1 : 0, session.id]
    );

    // Update progress
    const newXP = currentXP + xpEarned;
    const newLevel = getLevelFromXP(newXP).level;
    const updates = [
      'total_completed = total_completed + 1',
      `xp = ${newXP}`,
      `level = ${newLevel}`,
      'last_played_at = NOW()',
    ];
    if (isPersonalBest) {
      updates.push(`best_normalized_score = ${normalizedScore}`);
      updates.push(`best_metrics_json = ${conn.escape(JSON.stringify(metrics))}`);
    }
    await conn.query(
      `UPDATE brain_game_user_progress SET ${updates.join(', ')} WHERE user_id=? AND game_id=?`,
      [user.id, session.game_id]
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    conn.release();
  }

  // Streak (non-blocking)
  updateStreak(user.id).catch(() => {});

  // Badge evaluation (non-blocking but we await for response)
  const newBadges = isValid ? await awardBadges(user.id, session.game_id, session.id, metrics) : [];

  // XP for badges
  if (newBadges.length) {
    const bonusXP = newBadges.reduce((sum, b) => sum + (b.xpReward || 0), 0);
    if (bonusXP > 0) {
      await pool.query(
        'UPDATE brain_game_user_progress SET xp=xp+? WHERE user_id=? AND game_id=?',
        [bonusXP, user.id, session.game_id]
      );
    }
  }

  const [[updatedProg]] = await pool.query(
    'SELECT xp, level FROM brain_game_user_progress WHERE user_id=? AND game_id=?',
    [user.id, session.game_id]
  );
  const finalLevel = getLevelFromXP(updatedProg?.xp || 0);
  const nextLevel = getNextLevel(updatedProg?.xp || 0);

  res.json({
    ok: true,
    normalizedScore,
    accuracy,
    isPersonalBest,
    isValid,
    xpEarned,
    level: finalLevel.level,
    levelName: finalLevel.name,
    xp: updatedProg?.xp || 0,
    xpToNext: nextLevel ? nextLevel.xpRequired - (updatedProg?.xp || 0) : 0,
    newBadges,
  });
});

// ── GET /api/brain-games/me/progress ─────────────────────────────────────────
router.get('/me/progress', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const [games] = await pool.query('SELECT * FROM brain_games WHERE active=1 ORDER BY display_order');
  const [progress] = await pool.query(
    'SELECT * FROM brain_game_user_progress WHERE user_id=?', [user.id]
  );
  const [streakRow] = await pool.query('SELECT * FROM brain_user_streaks WHERE user_id=?', [user.id]);
  const [badgeCount] = await pool.query('SELECT COUNT(*) AS c FROM user_brain_badges WHERE user_id=?', [user.id]);

  const progressMap = {};
  for (const p of progress) progressMap[p.game_id] = p;

  const gameProgress = games.map(g => {
    const p = progressMap[g.id] || {};
    const xp = p.xp || 0;
    const lvl = getLevelFromXP(xp);
    const next = getNextLevel(xp);
    return {
      gameId: g.id, gameSlug: g.slug, gameName: g.name, gameIcon: g.icon,
      primarySkill: g.primary_skill,
      level: lvl.level, levelName: lvl.name,
      xp, xpToNext: next ? next.xpRequired - xp : 0,
      xpForNext: next ? next.xpRequired : null,
      totalSessions: p.total_sessions || 0,
      totalCompleted: p.total_completed || 0,
      bestNormalizedScore: p.best_normalized_score || null,
      lastPlayedAt: p.last_played_at || null,
    };
  });

  const totalCompleted = gameProgress.reduce((s, g) => s + g.totalCompleted, 0);
  const totalXP = gameProgress.reduce((s, g) => s + g.xp, 0);

  res.json({
    games: gameProgress,
    totalCompleted,
    totalXP,
    badgeCount: badgeCount[0].c,
    currentStreak: streakRow[0]?.current_streak || 0,
    longestStreak: streakRow[0]?.longest_streak || 0,
    lastPlayedAt: streakRow[0]?.last_qualifying_date || null,
    firstName: user.first_name,
  });
});

// ── GET /api/brain-games/me/history ──────────────────────────────────────────
router.get('/me/history', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const { gameSlug, limit = 20, offset = 0 } = req.query;
  let where = "s.user_id=? AND s.status='completed'";
  const params = [user.id];

  if (gameSlug) {
    where += ' AND g.slug=?';
    params.push(gameSlug);
  }

  const [rows] = await pool.query(
    `SELECT s.id, s.started_at, s.completed_at, s.duration_ms, s.difficulty,
            s.normalized_score, s.accuracy, s.xp_earned, s.validation_status,
            g.name AS game_name, g.slug AS game_slug, g.icon AS game_icon
     FROM brain_game_sessions s JOIN brain_games g ON g.id=s.game_id
     WHERE ${where} ORDER BY s.completed_at DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  res.json({ sessions: rows.map(r => ({
    id: r.id, gameName: r.game_name, gameSlug: r.game_slug, gameIcon: r.game_icon,
    startedAt: r.started_at, completedAt: r.completed_at, durationMs: r.duration_ms,
    difficulty: r.difficulty, score: r.normalized_score, accuracy: r.accuracy,
    xpEarned: r.xp_earned, isValid: r.validation_status === 'valid',
  }))});
});

// ── GET /api/brain-games/me/badges ───────────────────────────────────────────
router.get('/me/badges', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const [allBadges] = await pool.query(
    `SELECT b.*, g.name AS game_name, g.slug AS game_slug, g.icon AS game_icon
     FROM brain_badges b LEFT JOIN brain_games g ON g.id=b.game_id
     WHERE b.active=1 ORDER BY b.display_order`
  );
  const [earnedRows] = await pool.query(
    'SELECT * FROM user_brain_badges WHERE user_id=?', [user.id]
  );
  const earnedMap = {};
  for (const e of earnedRows) earnedMap[e.badge_id] = e;

  const badges = allBadges.map(b => {
    const e = earnedMap[b.id];
    return {
      id: b.id, name: b.name, slug: b.slug, description: b.description,
      howToEarn: describeBadgeCriteria(b.criteria_type, b.criteria_json),
      gameName: b.game_name, gameSlug: b.game_slug, gameIcon: b.game_icon,
      category: b.category, rarity: b.rarity, emoji: b.emoji, xpReward: b.xp_reward,
      earned: !!e,
      earnedAt: e?.earned_at || null,
      featured: e?.featured === 1,
      featuredPosition: e?.featured_position || null,
      publiclyDisplayable: !!b.publicly_displayable,
    };
  });

  const featured = badges.filter(b => b.featured).sort((a, b) => a.featuredPosition - b.featuredPosition);
  res.json({ badges, featured });
});

// ── POST /api/brain-games/me/badges/:id/feature ──────────────────────────────
router.post('/me/badges/:id/feature', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const badgeId = Number(req.params.id);
  const [[ub]] = await pool.query(
    'SELECT * FROM user_brain_badges WHERE user_id=? AND badge_id=?', [user.id, badgeId]
  );
  if (!ub) return res.status(403).json({ error: 'Badge not earned' });
  if (ub.featured) return res.json({ ok: true });

  // Max 6 featured
  const [featured] = await pool.query(
    'SELECT COUNT(*) AS c FROM user_brain_badges WHERE user_id=? AND featured=1', [user.id]
  );
  if (featured[0].c >= 6) return res.status(400).json({ error: 'Maximum 6 featured badges' });

  const pos = (featured[0].c || 0) + 1;
  await pool.query(
    'UPDATE user_brain_badges SET featured=1, featured_position=? WHERE user_id=? AND badge_id=?',
    [pos, user.id, badgeId]
  );
  res.json({ ok: true });
});

// ── DELETE /api/brain-games/me/badges/:id/feature ────────────────────────────
router.delete('/me/badges/:id/feature', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  await pool.query(
    'UPDATE user_brain_badges SET featured=0, featured_position=NULL WHERE user_id=? AND badge_id=?',
    [user.id, Number(req.params.id)]
  );
  res.json({ ok: true });
});

// ── PATCH /api/brain-games/me/badges/featured-order ──────────────────────────
router.patch('/me/badges/featured-order', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array is required' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < order.length; i++) {
      await conn.query(
        'UPDATE user_brain_badges SET featured_position=? WHERE user_id=? AND badge_id=? AND featured=1',
        [i + 1, user.id, order[i]]
      );
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }

  res.json({ ok: true });
});

// ── GET /api/brain-games/me/streak ───────────────────────────────────────────
router.get('/me/streak', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const [rows] = await pool.query('SELECT * FROM brain_user_streaks WHERE user_id=?', [user.id]);
  res.json({
    current: rows[0]?.current_streak || 0,
    longest: rows[0]?.longest_streak || 0,
    lastDate: rows[0]?.last_qualifying_date || null,
  });
});

// ── GET /api/brain-games/me/privacy ──────────────────────────────────────────
router.get('/me/privacy', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const [[row]] = await pool.query('SELECT * FROM brain_game_privacy WHERE user_id=?', [user.id]);
  res.json({ showBadges: row ? !!row.show_badges : true });
});

// ── PATCH /api/brain-games/me/privacy ────────────────────────────────────────
router.patch('/me/privacy', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const showBadges = (req.body || {}).showBadges !== false ? 1 : 0;
  await pool.query(
    `INSERT INTO brain_game_privacy (user_id, show_badges) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE show_badges = VALUES(show_badges)`,
    [user.id, showBadges]
  );
  res.json({ ok: true });
});

module.exports = router;
