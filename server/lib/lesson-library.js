// Shared rules for a teacher's My Lesson Plans library: level matching and the swap counter.
// Plain portable SQL (selects, inserts, one UPDATE) so it runs on node:sqlite in tests as well as MariaDB.
// Rules and access matrix: docs/reference/lesson-plan-swaps-requirements.md
const { getSetting } = require('./settings');

// The grade levels a teacher is registered for (full names, e.g. 'Middle School').
async function getTeacherLevels(db, siteUserId) {
  const [rows] = await db.query('SELECT audience FROM site_user_audiences WHERE site_user_id = ?', [siteUserId]);
  return rows.map((r) => r.audience);
}

async function getLessonLevels(db, curriculumId) {
  const [rows] = await db.query('SELECT audience FROM curriculum_audiences WHERE curriculum_id = ?', [curriculumId]);
  return rows.map((r) => r.audience);
}

// A mismatch needs both sides to say something: a lesson with no levels, or a teacher with none, is never a mismatch.
function levelMismatch(lessonLevels, teacherLevels) {
  if (!lessonLevels.length || !teacherLevels.length) return false;
  return !lessonLevels.some((l) => teacherLevels.includes(l));
}

async function getSwapLimit() {
  const n = parseInt(await getSetting('teacher_lesson_plan_swap_limit'), 10);
  return Number.isNaN(n) ? 3 : Math.max(0, n);
}

async function getSwapsUsed(db, siteUserId) {
  const [[row]] = await db.query(
    'SELECT COUNT(*) AS n FROM teacher_lesson_plan_swaps WHERE site_user_id = ? AND voided_at IS NULL',
    [siteUserId]
  );
  return Number(row.n) || 0;
}

// { swapsUsed, swapLimit, swapsLeft } for one teacher.
async function getSwapStatus(db, siteUserId) {
  const [swapsUsed, swapLimit] = await Promise.all([getSwapsUsed(db, siteUserId), getSwapLimit()]);
  return { swapsUsed, swapLimit, swapsLeft: Math.max(0, swapLimit - swapsUsed) };
}

// FNE staff reset: the rows stay (history), they just stop counting. Returns how many swaps were given back.
async function resetSwaps(db, siteUserId) {
  const [r] = await db.query(
    'UPDATE teacher_lesson_plan_swaps SET voided_at = CURRENT_TIMESTAMP WHERE site_user_id = ? AND voided_at IS NULL',
    [siteUserId]
  );
  return r.affectedRows || 0;
}

module.exports = { getTeacherLevels, getLessonLevels, levelMismatch, getSwapLimit, getSwapsUsed, getSwapStatus, resetSwaps };
