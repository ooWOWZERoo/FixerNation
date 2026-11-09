const pool = require('../db/pool');
const standards = require('./standards');
const { FOCUS_LABELS, FOCUS_HELP, SEL_FOCUSES } = require('./brain-game-focus');

// The public page for one game (Release 163, game.html). Everything returned here is public catalog text plus the verified
// standards connections; nothing about any player. Access rules: docs/reference/game-pages-parent-view-favorites-requirements.md.
const BAND_LABELS = { discover: 'Discover', explore: 'Explore', challenge: 'Challenge', advance: 'Advance' };
const BAND_GRADES = { discover: 'K-2', explore: '3-5', challenge: '6-8', advance: '9-12' };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// slug is request input: typeof first, then the pattern (RegExp.test() coerces undefined to "undefined").
function validSlug(slug) { return typeof slug === 'string' && slug.length <= 50 && SLUG.test(slug); }

// pilotEnabled mirrors GET /api/brain-games: a Tune Your Brain pilot game (reward_pipeline classroom_generic) is hidden
// when the pilot flag is off, so a hidden game has no public page either.
async function getGamePage(slug, { pilotEnabled = true } = {}) {
  if (!validSlug(slug)) return null;
  const [rows] = await pool.query('SELECT * FROM brain_games WHERE slug = ? AND active = 1', [slug]);
  const g = rows[0];
  if (!g) return null;
  if (!pilotEnabled && g.reward_pipeline === 'classroom_generic') return null;

  const competencies = String(g.casel_competencies || '').split(',').map((c) => c.trim()).filter((c) => SEL_FOCUSES.includes(c));
  return {
    game: {
      id: g.id, slug: g.slug, name: g.name, icon: g.icon || '', description: g.description || '',
      primarySkill: g.primary_skill || '',
      band: g.band || null, bandLabel: g.band ? BAND_LABELS[g.band] : null, grades: g.band ? BAND_GRADES[g.band] : null,
      focus: g.focus || null, focusLabel: g.focus ? FOCUS_LABELS[g.focus] : null, focusHelp: g.focus ? FOCUS_HELP[g.focus] : null,
      competencies: competencies.map((c) => ({ key: c, label: FOCUS_LABELS[c] })),
      playUrl: 'brain-' + g.slug + '.html',
    },
    connections: await standards.getPublicGameConnections(g.id),
  };
}

// The games a teacher assigned to a classroom, with whether ONE child has played each (parent portal, Release 164).
// Completion only: no score, no time, no date. classroomId and studentId come from the parent's own links
// (getParentClassrooms), never from the request, and the completion join is limited to this one student.
async function getChildGames(classroomId, studentId) {
  const [rows] = await pool.query(
    `SELECT cga.id AS assignment_id, cga.due_date, bg.name, bg.slug, bg.icon, bg.band, bg.focus, bg.primary_skill,
            MAX(sgc.completed_at) AS last_completed_at
     FROM classroom_game_assignments cga
     JOIN brain_games bg ON bg.id = cga.game_id AND bg.active = 1
     LEFT JOIN student_game_completions sgc ON sgc.game_assignment_id = cga.id AND sgc.student_id = ?
     WHERE cga.classroom_id = ?
     GROUP BY cga.id, cga.due_date, bg.name, bg.slug, bg.icon, bg.band, bg.focus, bg.primary_skill
     ORDER BY cga.id`, [studentId, classroomId]);
  return rows.map((r) => ({
    slug: r.slug, name: r.name, icon: r.icon || '', primarySkill: r.primary_skill || '',
    band: r.band || null, bandLabel: r.band ? BAND_LABELS[r.band] : null, grades: r.band ? BAND_GRADES[r.band] : null,
    focusLabel: r.focus ? FOCUS_LABELS[r.focus] : null,
    dueDate: r.due_date || null,
    played: !!r.last_completed_at,
  }));
}

module.exports = { getGamePage, getChildGames, validSlug, BAND_LABELS, BAND_GRADES };
