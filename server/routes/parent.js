const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { getParentClassrooms, hasParentAccessToCurriculum } = require('../lib/access');

const router = express.Router();

// POST /api/parent/join
// Authenticated site_user joins a classroom via parent code.
// Sets role='parent' on their account and creates a parent_classroom_links row.
router.post('/join', requireSiteAuth, async (req, res) => {
  const parentCode = ((req.body && req.body.parentCode) || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!parentCode) return res.status(400).json({ error: 'parentCode is required' });

  const [classRows] = await pool.query('SELECT id, name FROM classrooms WHERE parent_code = ?', [parentCode]);
  if (!classRows[0]) return res.status(404).json({ error: 'No classroom found with that parent code' });

  const classroom = classRows[0];

  // Set role to 'parent' if not already
  if (req.siteUser.role !== 'parent') {
    await pool.query("UPDATE site_users SET role = 'parent' WHERE id = ?", [req.siteUser.id]);
  }

  // Link parent to classroom (ignore duplicate)
  await pool.query(
    'INSERT IGNORE INTO parent_classroom_links (site_user_id, classroom_id) VALUES (?, ?)',
    [req.siteUser.id, classroom.id]
  );

  res.json({ ok: true, classroom: { id: classroom.id, name: classroom.name } });
});

// GET /api/parent/classrooms
// Returns all classrooms the parent is linked to, with their curriculum assignments.
router.get('/classrooms', requireSiteAuth, async (req, res) => {
  if (req.siteUser.role !== 'parent') {
    return res.status(403).json({ error: 'Parent access required' });
  }

  const linked = await getParentClassrooms(req.siteUser.id);
  if (!linked.length) return res.json({ classrooms: [] });

  const classroomIds = linked.map(c => c.classroomId);
  const [assignments] = await pool.query(
    `SELECT ca.classroom_id, ca.curriculum_id, cur.title, cur.short_description AS shortDescription, cur.series
     FROM classroom_assignments ca
     JOIN curricula cur ON cur.id = ca.curriculum_id AND cur.published = 1
     WHERE ca.classroom_id IN (?)
     ORDER BY ca.sort_order, ca.assigned_at`,
    [classroomIds]
  );

  const assignmentsByClassroom = assignments.reduce((acc, a) => {
    (acc[a.classroom_id] = acc[a.classroom_id] || []).push({
      curriculumId:     a.curriculum_id,
      title:            a.title,
      shortDescription: a.shortDescription,
      series:           a.series,
    });
    return acc;
  }, {});

  res.json({
    classrooms: linked.map(c => ({
      id:          c.classroomId,
      name:        c.className,
      assignments: assignmentsByClassroom[c.classroomId] || [],
    })),
  });
});

// GET /api/parent/lesson/:curriculumId
// Returns curriculum details for parents — resources, videos (no quiz, no lesson plan docs).
router.get('/lesson/:curriculumId', requireSiteAuth, async (req, res) => {
  if (req.siteUser.role !== 'parent') {
    return res.status(403).json({ error: 'Parent access required' });
  }

  const curriculumId = req.params.curriculumId;
  const hasAccess = await hasParentAccessToCurriculum(req.siteUser.id, curriculumId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this lesson' });
  }

  const [curRows] = await pool.query(
    'SELECT id, title, overview, short_description AS shortDescription, series FROM curricula WHERE id = ? AND published = 1',
    [curriculumId]
  );
  if (!curRows[0]) return res.status(404).json({ error: 'Lesson not found' });

  const PARENT_ACCESSIBLE = ['Teacher Copy', 'Student Handout', 'Classroom Poster'];
  const [resourceRows] = await pool.query(
    'SELECT resource, file_path, file_name, download_limit FROM curriculum_resources WHERE curriculum_id = ? AND resource IN (?)',
    [curriculumId, PARENT_ACCESSIBLE]
  );
  const [videoRows] = await pool.query(
    'SELECT name, url, size_label AS sizeLabel FROM curriculum_videos WHERE curriculum_id = ? ORDER BY sort_order',
    [curriculumId]
  );

  res.json({
    curriculum: {
      ...curRows[0],
      resources: resourceRows.map(r => ({
        resource:      r.resource,
        filePath:      r.file_path || '',
        fileName:      r.file_name || '',
        downloadLimit: r.download_limit || 0,
      })),
      videos: videoRows,
    },
  });
});

module.exports = router;
