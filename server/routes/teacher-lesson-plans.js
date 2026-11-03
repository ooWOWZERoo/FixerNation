const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { hasActiveLicense } = require('../lib/access');
const { getSetting } = require('../lib/settings');
const { getTeacherLevels, getLessonLevels, levelMismatch, getSwapStatus } = require('../lib/lesson-library');

const router = express.Router();

// A trial purchase's own trial_library_limit (snapshotted at purchase time
// from license_products.trial_library_limit — see server/routes/newsletter.js's
// createPurchase()) always wins when present. If the teacher's active seat
// belongs to a trial purchase with no snapshot of its own (e.g. one created
// before this field existed), the trial-specific default setting applies
// instead of silently falling through to the full-license default of 40 —
// a trial should never accidentally get the same cap as a paid license.
async function getLimit(siteUserId) {
  const [[trial]] = await pool.query(
    `SELECT p.trial_library_limit, p.trial_lesson_limit
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     WHERE ls.registered_site_user_id = ? AND ls.status = 'registered'
       AND (p.trial_library_limit IS NOT NULL OR p.trial_lesson_limit IS NOT NULL)
     LIMIT 1`,
    [siteUserId]
  );
  if (trial) {
    if (trial.trial_library_limit != null) return Math.max(1, trial.trial_library_limit);
    const rawTrial = await getSetting('teacher_lesson_plan_limit_trial');
    return Math.max(1, parseInt(rawTrial || '10', 10));
  }
  const raw = await getSetting('teacher_lesson_plan_limit');
  return Math.max(1, parseInt(raw || '40', 10));
}

// A typed failure from inside a transaction: the route answers with `status` and `body`.
class LibraryError extends Error {
  constructor(status, body) { super(body.error || body.code || 'Library error'); this.status = status; this.body = body; }
}
function sendFailure(res, err) {
  if (err instanceof LibraryError) return res.status(err.status).json(err.body);
  throw err;
}

// Every library route: an active license, and (for writes) at least one registered grade level, because the
// level-mismatch check compares each lesson against the teacher's levels. Returns the teacher's levels, or null after
// answering the request itself.
async function guard(req, res, { needLevels }) {
  if (!await hasActiveLicense(req.siteUser.id)) {
    res.status(403).json({ error: 'Active license required' });
    return null;
  }
  const levels = await getTeacherLevels(pool, req.siteUser.id);
  if (needLevels && !levels.length) {
    res.status(409).json({ code: 'levels_required', error: 'Choose your grade levels first.' });
    return null;
  }
  return levels;
}

function mismatchBody(lessonLevels, teacherLevels) {
  return { code: 'level_mismatch', error: 'Curriculum level mismatch', lessonLevels, teacherLevels };
}

// Runs fn(conn) in a transaction with this teacher's row locked, so two clicks cannot spend the same swap twice.
async function withLockedTeacher(siteUserId, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM site_users WHERE id = ? FOR UPDATE', [siteUserId]);
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function libraryCount(db, siteUserId) {
  const [[row]] = await db.query('SELECT COUNT(*) AS n FROM teacher_lesson_plans WHERE site_user_id = ?', [siteUserId]);
  return Number(row.n) || 0;
}

// GET /api/teacher/lesson-plans
// Returns the teacher's current selections, count, and limit.
router.get('/', requireSiteAuth, async (req, res) => {
  if (!await hasActiveLicense(req.siteUser.id)) {
    return res.status(403).json({ error: 'Active license required' });
  }
  const [rows] = await pool.query(
    'SELECT curriculum_id, selected_at FROM teacher_lesson_plans WHERE site_user_id = ? ORDER BY selected_at',
    [req.siteUser.id]
  );
  const limit = await getLimit(req.siteUser.id);
  res.json({
    selections: rows.map(r => r.curriculum_id),
    count: rows.length,
    limit,
    ...(await getSwapStatus(pool, req.siteUser.id)),
    myAudiences: await getTeacherLevels(pool, req.siteUser.id),
  });
});

// GET /api/teacher/lesson-plans/browse
// Full published curriculum list decorated with selected:true/false — used only by
// teacher-lesson-plans.html so teachers can always see the full library for adding.
router.get('/browse', requireSiteAuth, async (req, res) => {
  if (!await hasActiveLicense(req.siteUser.id)) {
    return res.status(403).json({ error: 'Active license required' });
  }
  const [curricula] = await pool.query(
    'SELECT id, title, series, short_description, overview FROM curricula WHERE published = 1 ORDER BY sort_order ASC, created_at DESC'
  );
  const [selected] = await pool.query(
    'SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ?',
    [req.siteUser.id]
  );
  const selectedSet = new Set(selected.map(r => r.curriculum_id));
  const limit = await getLimit(req.siteUser.id);

  const ids = curricula.map(c => c.id);
  const [audienceRows] = ids.length
    ? await pool.query('SELECT curriculum_id, audience FROM curriculum_audiences WHERE curriculum_id IN (?)', [ids])
    : [[]];
  const audiencesByC = audienceRows.reduce((acc, r) => {
    (acc[r.curriculum_id] = acc[r.curriculum_id] || []).push(r.audience);
    return acc;
  }, {});

  res.json({
    curricula: curricula.map(c => ({
      id: c.id,
      title: c.title,
      series: c.series,
      shortDescription: c.short_description,
      overview: c.overview,
      audiences: audiencesByC[c.id] || [],
      selected: selectedSet.has(c.id),
    })),
    count: selectedSet.size,
    limit,
    ...(await getSwapStatus(pool, req.siteUser.id)),
    myAudiences: await getTeacherLevels(pool, req.siteUser.id),
  });
});

// POST /api/teacher/lesson-plans
// Adds one curriculum to the teacher's library. 409 level_mismatch (unless confirmMismatch: true), 409 if already
// selected, 400 if at or over the library limit.
router.post('/', requireSiteAuth, async (req, res) => {
  const teacherLevels = await guard(req, res, { needLevels: true });
  if (!teacherLevels) return;
  const curriculumId = parseInt(req.body && req.body.curriculumId, 10);
  if (!curriculumId) return res.status(400).json({ error: 'curriculumId is required' });

  const [curRows] = await pool.query('SELECT id FROM curricula WHERE id = ? AND published = 1', [curriculumId]);
  if (!curRows[0]) return res.status(404).json({ error: 'Curriculum not found' });

  const lessonLevels = await getLessonLevels(pool, curriculumId);
  if (levelMismatch(lessonLevels, teacherLevels) && !(req.body && req.body.confirmMismatch === true)) {
    return res.status(409).json(mismatchBody(lessonLevels, teacherLevels));
  }

  const count = await libraryCount(pool, req.siteUser.id);
  const limit = await getLimit(req.siteUser.id);
  if (count >= limit) {
    return res.status(400).json({ error: 'Lesson plan library is full', count, limit });
  }

  try {
    await pool.query(
      'INSERT INTO teacher_lesson_plans (site_user_id, curriculum_id) VALUES (?, ?)',
      [req.siteUser.id, curriculumId]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Already in library' });
    }
    throw err;
  }

  res.json({ ok: true, count: count + 1, limit });
});

// DELETE /api/teacher/lesson-plans/:curriculumId
// Takes one lesson out of the teacher's library. Costs one swap whether or not it is replaced later.
router.delete('/:curriculumId', requireSiteAuth, async (req, res) => {
  if (!await guard(req, res, { needLevels: true })) return;
  const curriculumId = parseInt(req.params.curriculumId, 10);
  if (!curriculumId) return res.status(400).json({ error: 'curriculumId is required' });
  const siteUserId = req.siteUser.id;

  try {
    const out = await withLockedTeacher(siteUserId, async (conn) => {
      const [[have]] = await conn.query(
        'SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ? AND curriculum_id = ?', [siteUserId, curriculumId]
      );
      if (!have) throw new LibraryError(404, { error: 'That lesson is not in your library' });
      const status = await getSwapStatus(conn, siteUserId);
      if (status.swapsLeft <= 0) throw new LibraryError(403, { code: 'no_swaps_left', error: 'You have no swaps left.', ...status });
      await conn.query('DELETE FROM teacher_lesson_plans WHERE site_user_id = ? AND curriculum_id = ?', [siteUserId, curriculumId]);
      await conn.query(
        'INSERT INTO teacher_lesson_plan_swaps (site_user_id, removed_curriculum_id, added_curriculum_id) VALUES (?, ?, NULL)',
        [siteUserId, curriculumId]
      );
      return { count: await libraryCount(conn, siteUserId), ...(await getSwapStatus(conn, siteUserId)) };
    });
    res.json({ ok: true, ...out, limit: await getLimit(siteUserId) });
  } catch (err) { sendFailure(res, err); }
});

// POST /api/teacher/lesson-plans/swap  { removeCurriculumId, addCurriculumId, confirmMismatch }
// Replaces one library lesson with another in a single step: the removal, the addition and the swap are one transaction.
router.post('/swap', requireSiteAuth, async (req, res) => {
  const teacherLevels = await guard(req, res, { needLevels: true });
  if (!teacherLevels) return;
  const removeId = parseInt(req.body && req.body.removeCurriculumId, 10);
  const addId = parseInt(req.body && req.body.addCurriculumId, 10);
  if (!removeId || !addId) return res.status(400).json({ error: 'removeCurriculumId and addCurriculumId are required' });
  if (removeId === addId) return res.status(400).json({ error: 'Choose a different lesson to swap in' });
  const confirmed = !!req.body && req.body.confirmMismatch === true;
  const siteUserId = req.siteUser.id;

  try {
    const out = await withLockedTeacher(siteUserId, async (conn) => {
      const [[have]] = await conn.query(
        'SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ? AND curriculum_id = ?', [siteUserId, removeId]
      );
      if (!have) throw new LibraryError(404, { error: 'That lesson is not in your library' });
      const [[already]] = await conn.query(
        'SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ? AND curriculum_id = ?', [siteUserId, addId]
      );
      if (already) throw new LibraryError(409, { error: 'Already in library' });
      const [[cur]] = await conn.query('SELECT id FROM curricula WHERE id = ? AND published = 1', [addId]);
      if (!cur) throw new LibraryError(404, { error: 'Curriculum not found' });

      const lessonLevels = await getLessonLevels(conn, addId);
      if (levelMismatch(lessonLevels, teacherLevels) && !confirmed) throw new LibraryError(409, mismatchBody(lessonLevels, teacherLevels));

      const status = await getSwapStatus(conn, siteUserId);
      if (status.swapsLeft <= 0) throw new LibraryError(403, { code: 'no_swaps_left', error: 'You have no swaps left.', ...status });

      await conn.query('DELETE FROM teacher_lesson_plans WHERE site_user_id = ? AND curriculum_id = ?', [siteUserId, removeId]);
      await conn.query('INSERT INTO teacher_lesson_plans (site_user_id, curriculum_id) VALUES (?, ?)', [siteUserId, addId]);
      await conn.query(
        'INSERT INTO teacher_lesson_plan_swaps (site_user_id, removed_curriculum_id, added_curriculum_id) VALUES (?, ?, ?)',
        [siteUserId, removeId, addId]
      );
      return { count: await libraryCount(conn, siteUserId), ...(await getSwapStatus(conn, siteUserId)) };
    });
    res.json({ ok: true, ...out, limit: await getLimit(siteUserId) });
  } catch (err) { sendFailure(res, err); }
});

module.exports = router;
