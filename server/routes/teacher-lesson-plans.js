const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { hasActiveLicense } = require('../lib/access');
const { getSetting } = require('../lib/settings');

const router = express.Router();

async function getLimit() {
  const raw = await getSetting('teacher_lesson_plan_limit');
  return Math.max(1, parseInt(raw || '40', 10));
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
  const limit = await getLimit();
  res.json({
    selections: rows.map(r => r.curriculum_id),
    count: rows.length,
    limit,
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
    'SELECT id, title, series, short_description FROM curricula WHERE published = 1 ORDER BY sort_order ASC, created_at DESC'
  );
  const [selected] = await pool.query(
    'SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ?',
    [req.siteUser.id]
  );
  const selectedSet = new Set(selected.map(r => r.curriculum_id));
  const limit = await getLimit();
  res.json({
    curricula: curricula.map(c => ({
      id: c.id,
      title: c.title,
      series: c.series,
      shortDescription: c.short_description,
      selected: selectedSet.has(c.id),
    })),
    count: selectedSet.size,
    limit,
  });
});

// POST /api/teacher/lesson-plans
// Permanently adds one curriculum to the teacher's library.
// 409 if already selected, 400 if at or over limit.
router.post('/', requireSiteAuth, async (req, res) => {
  if (!await hasActiveLicense(req.siteUser.id)) {
    return res.status(403).json({ error: 'Active license required' });
  }
  const curriculumId = parseInt(req.body && req.body.curriculumId, 10);
  if (!curriculumId) return res.status(400).json({ error: 'curriculumId is required' });

  const [curRows] = await pool.query('SELECT id FROM curricula WHERE id = ? AND published = 1', [curriculumId]);
  if (!curRows[0]) return res.status(404).json({ error: 'Curriculum not found' });

  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM teacher_lesson_plans WHERE site_user_id = ?',
    [req.siteUser.id]
  );
  const limit = await getLimit();
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

module.exports = router;
