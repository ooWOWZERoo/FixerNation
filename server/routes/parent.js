const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { getParentClassrooms, hasParentAccessToCurriculum } = require('../lib/access');

const router = express.Router();

// GET /api/parent/children
// Returns each child the parent is linked to (one entry per student, not
// per classroom — a parent with two children in the same classroom gets
// two entries), with that classroom's curriculum assignments. Replaces the
// old GET /api/parent/classrooms, which returned classroom-level data
// identically for every parent linked to that classroom regardless of
// which (or how many) children they had there — the old parent_code
// self-join flow that produced that shape has been removed; the only way
// to get linked now is a teacher-sent per-student invite
// (POST /api/classrooms/:id/students/:sid/invite-parent).
router.get('/children', requireSiteAuth, async (req, res) => {
  if (req.siteUser.role !== 'parent') {
    return res.status(403).json({ error: 'Parent access required' });
  }

  const linked = await getParentClassrooms(req.siteUser.id);
  if (!linked.length) return res.json({ children: [] });

  const classroomIds = [...new Set(linked.map(c => c.classroomId))];
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
    children: linked.map(c => ({
      studentId:   c.studentId,
      studentName: c.studentName,
      classroomId: c.classroomId,
      className:   c.className,
      assignments: assignmentsByClassroom[c.classroomId] || [],
    })),
  });
});

// GET /api/parent/students/:studentId/progress
// Lesson completion progress for one specific linked child — per the
// product decision, this shows completion status only (no quiz answers,
// no reflections; those stay teacher-only for now).
router.get('/students/:studentId/progress', requireSiteAuth, async (req, res) => {
  if (req.siteUser.role !== 'parent') {
    return res.status(403).json({ error: 'Parent access required' });
  }

  const studentId = Number(req.params.studentId);
  const [[link]] = await pool.query(
    'SELECT classroom_id FROM parent_classroom_links WHERE site_user_id = ? AND student_id = ?',
    [req.siteUser.id, studentId]
  );
  if (!link) return res.status(403).json({ error: 'You are not linked to this student' });

  const [rows] = await pool.query(
    `SELECT ca.curriculum_id, cur.title, ca.due_date,
            slp.started_at, slp.completed_at
     FROM classroom_assignments ca
     JOIN curricula cur ON cur.id = ca.curriculum_id AND cur.published = 1
     LEFT JOIN student_lesson_progress slp ON slp.student_id = ? AND slp.curriculum_id = ca.curriculum_id
     WHERE ca.classroom_id = ?
     ORDER BY ca.sort_order, ca.assigned_at`,
    [studentId, link.classroom_id]
  );

  res.json({
    progress: rows.map(r => ({
      curriculumId: r.curriculum_id,
      title: r.title,
      dueDate: r.due_date,
      startedAt: r.started_at,
      completedAt: r.completed_at,
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
  const [objectiveRows] = await pool.query(
    'SELECT objective FROM curriculum_objectives WHERE curriculum_id = ? ORDER BY sort_order',
    [curriculumId]
  );
  const [materialRows] = await pool.query(
    'SELECT material FROM curriculum_materials WHERE curriculum_id = ? ORDER BY sort_order',
    [curriculumId]
  );

  res.json({
    curriculum: {
      ...curRows[0],
      objectives: objectiveRows.map(r => r.objective),
      materials: materialRows.map(r => r.material),
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
