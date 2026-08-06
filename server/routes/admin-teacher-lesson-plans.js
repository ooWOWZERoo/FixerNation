const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getSetting } = require('../lib/settings');

const router = express.Router();

async function getLimit() {
  const raw = await getSetting('teacher_lesson_plan_limit');
  return Math.max(1, parseInt(raw || '40', 10));
}

// GET /api/admin/teacher-lesson-plans/:siteUserId
router.get('/:siteUserId', requireAuth, async (req, res) => {
  const siteUserId = parseInt(req.params.siteUserId, 10);
  const [rows] = await pool.query(
    `SELECT tlp.curriculum_id, tlp.selected_at, c.title, c.series
     FROM teacher_lesson_plans tlp
     JOIN curricula c ON c.id = tlp.curriculum_id
     WHERE tlp.site_user_id = ?
     ORDER BY tlp.selected_at`,
    [siteUserId]
  );
  const limit = await getLimit();
  res.json({
    selections: rows.map(r => ({
      curriculumId: r.curriculum_id,
      title: r.title,
      series: r.series,
      selectedAt: r.selected_at,
    })),
    count: rows.length,
    limit,
  });
});

// POST /api/admin/teacher-lesson-plans/:siteUserId
// Admin adds one curriculum for a teacher (bypasses limit).
router.post('/:siteUserId', requireAuth, async (req, res) => {
  const siteUserId = parseInt(req.params.siteUserId, 10);
  const curriculumId = parseInt(req.body && req.body.curriculumId, 10);
  if (!curriculumId) return res.status(400).json({ error: 'curriculumId is required' });

  try {
    await pool.query(
      'INSERT INTO teacher_lesson_plans (site_user_id, curriculum_id) VALUES (?, ?)',
      [siteUserId, curriculumId]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Already in library' });
    }
    throw err;
  }
  res.json({ ok: true });
});

// DELETE /api/admin/teacher-lesson-plans/:siteUserId/:curriculumId
// Admin removes one specific curriculum from a teacher's library.
router.delete('/:siteUserId/:curriculumId', requireAuth, async (req, res) => {
  const siteUserId = parseInt(req.params.siteUserId, 10);
  const curriculumId = parseInt(req.params.curriculumId, 10);
  await pool.query(
    'DELETE FROM teacher_lesson_plans WHERE site_user_id = ? AND curriculum_id = ?',
    [siteUserId, curriculumId]
  );
  res.json({ ok: true });
});

// DELETE /api/admin/teacher-lesson-plans/:siteUserId
// Admin resets all selections for a teacher.
router.delete('/:siteUserId', requireAuth, async (req, res) => {
  const siteUserId = parseInt(req.params.siteUserId, 10);
  await pool.query('DELETE FROM teacher_lesson_plans WHERE site_user_id = ?', [siteUserId]);
  res.json({ ok: true });
});

module.exports = router;
