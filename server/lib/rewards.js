const pool = require('../db/pool');

// ── XP / Level system ─────────────────────────────────────────────────────────
// Extracted from routes/brain-games.js (Tune Your Brain Phase 6) so a second
// reward path — awardClassroomCompletion() below — can reuse the exact same
// level ladder and streak logic instead of duplicating it. brain-games.js's
// own behavior is unchanged; it now requires these from here.
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

// ── Streak update ─────────────────────────────────────────────────────────────
async function updateStreak(principal) {
  const idCol = principal.idCol;
  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query(`SELECT * FROM brain_user_streaks WHERE ${idCol}=?`, [principal.id]);

  if (!rows.length) {
    await pool.query(
      `INSERT INTO brain_user_streaks (${idCol}, current_streak, longest_streak, last_qualifying_date) VALUES (?, 1, 1, ?)`,
      [principal.id, today]
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
    `UPDATE brain_user_streaks SET current_streak=?, longest_streak=?, last_qualifying_date=? WHERE ${idCol}=?`,
    [newStreak, longest, today, principal.id]
  );
}

// ── Classroom-assignment reward path (Tune Your Brain Phase 6) ───────────────
// For games on brain_games.reward_pipeline='classroom_generic' (the 4 engine-
// based pilot games, and any future game that doesn't opt into the legacy
// per-slug scoring pipeline above). Unlike the legacy PUT /sessions/:token/
// complete path, there is no brain_game_sessions lifecycle here — this is
// called directly from student.js's POST /games/:gaid/complete, keyed only
// by student_id (classroom_game_assignments/student_game_completions are
// PIN-classroom-only, so there's no dual user_id/student_id identity to
// resolve here, unlike brain-games.js's getPrincipal()).
//
// Flat completion XP only in this first slice (no accuracy/personal-best
// bonus — student.js doesn't yet know a maxScore to compute accuracy from).
// Rewards real assignment completion, not click-grinding, per the
// blueprint's §12.1 reward principle.
const CLASSROOM_COMPLETION_XP = 25;

async function awardClassroomCompletion({ studentId, gameId }) {
  await pool.query(
    `INSERT INTO brain_game_user_progress (student_id, game_id, xp, total_sessions, total_completed, last_played_at)
     VALUES (?, ?, ?, 1, 1, NOW())
     ON DUPLICATE KEY UPDATE
       xp = xp + ?,
       total_sessions = total_sessions + 1,
       total_completed = total_completed + 1,
       last_played_at = NOW()`,
    [studentId, gameId, CLASSROOM_COMPLETION_XP, CLASSROOM_COMPLETION_XP]
  );

  const principal = { idCol: 'student_id', id: studentId };
  updateStreak(principal).catch(() => {});

  const newBadges = await awardFirstCompletionBadge(principal, gameId);

  const [[prog]] = await pool.query(
    'SELECT xp FROM brain_game_user_progress WHERE student_id=? AND game_id=?',
    [studentId, gameId]
  );
  const xp = prog?.xp || 0;
  const level = getLevelFromXP(xp);

  return { xpEarned: CLASSROOM_COMPLETION_XP, xp, level: level.level, levelName: level.name, newBadges };
}

// Awards a badge whose criteria_type='first_classroom_completion' for this
// game, the first time (and only the first time) this student completes it
// via a classroom assignment. Simple existence check rather than a generic
// criteria evaluator, since this slice only has the one criteria type.
async function awardFirstCompletionBadge(principal, gameId) {
  const idCol = principal.idCol;
  const [badges] = await pool.query(
    "SELECT * FROM brain_badges WHERE active=1 AND game_id=? AND criteria_type='first_classroom_completion'",
    [gameId]
  );
  if (!badges.length) return [];

  const [[prog]] = await pool.query(
    'SELECT total_completed FROM brain_game_user_progress WHERE student_id=? AND game_id=?',
    [principal.id, gameId]
  );
  if ((prog?.total_completed || 0) !== 1) return []; // only on the very first completion

  const newBadges = [];
  for (const badge of badges) {
    const [result] = await pool.query(
      `INSERT IGNORE INTO user_brain_badges (${idCol}, badge_id, earned_at) VALUES (?, ?, NOW())`,
      [principal.id, badge.id]
    );
    if (result.affectedRows > 0) {
      if (badge.xp_reward) {
        await pool.query(
          `UPDATE brain_game_user_progress SET xp = xp + ? WHERE ${idCol}=? AND game_id=?`,
          [badge.xp_reward, principal.id, gameId]
        );
      }
      newBadges.push({
        id: badge.id, name: badge.name, slug: badge.slug,
        description: badge.description, rarity: badge.rarity,
        emoji: badge.emoji, xpReward: badge.xp_reward,
      });
    }
  }
  return newBadges;
}

module.exports = { XP_LEVELS, getLevelFromXP, getNextLevel, updateStreak, awardClassroomCompletion };
