const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { limiter } = require('../lib/rate-limit');
const keepsake = require('../lib/portrait-keepsake');

// My Graduate Portrait, tier 2: the end-of-year keepsake for a PARENT (docs/reference/graduate-portrait-requirements.md section 5, D1, D3).
// A parent sees only their own linked child, only which skills the child has practiced and the games and lessons behind them. Pinned
// words are NEVER included: they belong to the student alone. Built now from live records, never stored. A student id that is not the
// parent's own confirmed link answers 404, never 403 (and never says whether the student exists). The student session has no route here.
const router = express.Router();
const keepsakeLimit = limiter({ name: 'parent-keepsake', windowMs: 60 * 60 * 1000, max: 60, key: (req) => (req.siteUser ? `u${req.siteUser.id}` : null) });
const notFound = (res) => res.status(404).json({ error: 'We could not find that.' });
const MESSAGES = { off: 'This child\'s teacher has turned the keepsake off for the class.', not_open: 'The keepsake isn\'t open yet.', closed: 'The keepsake isn\'t available any more.' };

router.get('/students/:studentId', requireSiteAuth, keepsakeLimit, async (req, res) => {
  const studentId = typeof req.params.studentId === 'string' && /^\d{1,10}$/.test(req.params.studentId) ? Number(req.params.studentId) : null;
  if (!studentId) return notFound(res);
  const [rows] = await pool.query(
    `SELECT cs.id, cs.display_name, cs.classroom_id FROM parent_classroom_links pcl
     JOIN classroom_students cs ON cs.id = pcl.student_id AND cs.is_active = 1
     WHERE pcl.site_user_id = ? AND pcl.student_id = ? LIMIT 1`, [req.siteUser.id, studentId]);
  if (!rows[0]) return notFound(res);
  const classroom = await keepsake.loadClassroom(rows[0].classroom_id);
  if (!classroom) return notFound(res);
  const k = await keepsake.buildKeepsake({ studentId, displayName: rows[0].display_name, classroom, includePins: false });
  if (!k.ok) return res.status(403).json({ error: MESSAGES[k.reason] || MESSAGES.closed, reason: k.reason });
  res.json(k);
});

module.exports = router;
