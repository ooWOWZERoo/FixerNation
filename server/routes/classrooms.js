const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { hasActiveLicense } = require('../lib/access');

const router = express.Router();

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function uniqueJoinCode(conn) {
  let code, tries = 0;
  do {
    code = generateJoinCode();
    const [r] = await conn.query('SELECT id FROM classrooms WHERE join_code = ?', [code]);
    if (!r.length) return code;
  } while (++tries < 10);
  throw new Error('Failed to generate unique join code');
}

// Verify teacher owns classroom
async function ownedClassroom(req, res) {
  const [rows] = await pool.query(
    'SELECT * FROM classrooms WHERE id = ? AND teacher_site_user_id = ?',
    [req.params.id, req.siteUser.id]
  );
  if (!rows[0]) { res.status(404).json({ error: 'Classroom not found' }); return null; }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Classrooms list + create
// ---------------------------------------------------------------------------

router.get('/', requireSiteAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM classroom_students cs WHERE cs.classroom_id = c.id AND cs.is_active = 1) AS student_count,
       (SELECT COUNT(*) FROM classroom_assignments ca WHERE ca.classroom_id = c.id) AS assignment_count
     FROM classrooms c
     WHERE c.teacher_site_user_id = ?
     ORDER BY c.archived_at IS NOT NULL, c.created_at DESC`,
    [req.siteUser.id]
  );
  res.json(rows);
});

router.post('/', requireSiteAuth, async (req, res) => {
  const { name, gradeLevel, subject, academicYear } = req.body;
  if (!name) return res.status(400).json({ error: 'Classroom name required' });

  const conn = await pool.getConnection();
  try {
    const code = await uniqueJoinCode(conn);
    const [r] = await conn.query(
      'INSERT INTO classrooms (name, teacher_site_user_id, join_code, grade_level, subject, academic_year) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), req.siteUser.id, code, gradeLevel || null, subject || null, academicYear || null]
    );
    const [[classroom]] = await conn.query('SELECT * FROM classrooms WHERE id = ?', [r.insertId]);
    res.status(201).json(classroom);
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------------------
// Single classroom
// ---------------------------------------------------------------------------

router.get('/:id', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const [students] = await pool.query(
    'SELECT id, display_name, username, student_number, is_active, created_at FROM classroom_students WHERE classroom_id = ? ORDER BY display_name',
    [classroom.id]
  );
  const [assignments] = await pool.query(
    `SELECT ca.*, cur.title, cur.series AS grade_level,
       (SELECT COUNT(*) FROM student_lesson_progress slp WHERE slp.curriculum_id = ca.curriculum_id AND slp.student_id IN (SELECT id FROM classroom_students WHERE classroom_id = ca.classroom_id)) AS started_count,
       (SELECT COUNT(*) FROM student_lesson_progress slp WHERE slp.curriculum_id = ca.curriculum_id AND slp.completed_at IS NOT NULL AND slp.student_id IN (SELECT id FROM classroom_students WHERE classroom_id = ca.classroom_id)) AS completed_count
     FROM classroom_assignments ca
     JOIN curricula cur ON cur.id = ca.curriculum_id
     WHERE ca.classroom_id = ?
     ORDER BY ca.sort_order, ca.assigned_at`,
    [classroom.id]
  );
  const [gameAssignments] = await pool.query(
    `SELECT cga.*, bg.name AS game_title, bg.slug AS game_slug,
       (SELECT COUNT(*) FROM student_game_completions sgc WHERE sgc.game_assignment_id = cga.id) AS completion_count
     FROM classroom_game_assignments cga
     JOIN brain_games bg ON bg.id = cga.game_id
     WHERE cga.classroom_id = ?
     ORDER BY cga.created_at`,
    [classroom.id]
  );

  res.json({ ...classroom, students, assignments, gameAssignments });
});

router.put('/:id', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const { name, gradeLevel, subject, academicYear, archived } = req.body;
  await pool.query(
    `UPDATE classrooms SET
       name = COALESCE(?, name),
       grade_level = ?,
       subject = ?,
       academic_year = ?,
       archived_at = ?
     WHERE id = ?`,
    [
      name ? name.trim() : null,
      gradeLevel !== undefined ? (gradeLevel || null) : classroom.grade_level,
      subject !== undefined ? (subject || null) : classroom.subject,
      academicYear !== undefined ? (academicYear || null) : classroom.academic_year,
      archived === true ? (classroom.archived_at || new Date().toISOString().slice(0, 19)) : (archived === false ? null : classroom.archived_at),
      classroom.id,
    ]
  );
  const [[updated]] = await pool.query('SELECT * FROM classrooms WHERE id = ?', [classroom.id]);
  res.json(updated);
});

// PUT /:id/regen-code — regenerate join code
router.put('/:id/regen-code', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const conn = await pool.getConnection();
  try {
    const code = await uniqueJoinCode(conn);
    await conn.query('UPDATE classrooms SET join_code = ? WHERE id = ?', [code, classroom.id]);
    res.json({ joinCode: code });
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

router.get('/:id/students', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;
  const [rows] = await pool.query(
    'SELECT id, display_name, username, student_number, is_active, created_at FROM classroom_students WHERE classroom_id = ? ORDER BY display_name',
    [classroom.id]
  );
  res.json(rows);
});

// POST /:id/students — add single student, teacher sets PIN
router.post('/:id/students', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const { displayName, pin, studentNumber } = req.body;
  if (!displayName || !pin) return res.status(400).json({ error: 'displayName and pin required' });

  const base = displayName.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'student';
  const [existing] = await pool.query('SELECT username FROM classroom_students WHERE username LIKE ?', [base + '%']);
  const taken = new Set(existing.map(r => r.username));
  let username = base;
  let n = 2;
  while (taken.has(username)) { username = base + n; n++; }

  const passwordHash = await bcrypt.hash(String(pin), 10);
  const [r] = await pool.query(
    'INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, student_number) VALUES (?, ?, ?, ?, ?)',
    [classroom.id, displayName.trim(), username, passwordHash, studentNumber || null]
  );
  const [[student]] = await pool.query(
    'SELECT id, display_name, username, student_number, is_active, created_at FROM classroom_students WHERE id = ?',
    [r.insertId]
  );
  res.status(201).json({ ...student, username, pin });
});

// POST /:id/students/bulk — roster import (array of { displayName, studentNumber?, pin? })
router.post('/:id/students/bulk', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const { students } = req.body;
  if (!Array.isArray(students) || !students.length) return res.status(400).json({ error: 'students array required' });

  const [allUsernames] = await pool.query('SELECT username FROM classroom_students');
  const taken = new Set(allUsernames.map(r => r.username));
  const results = [];

  for (const s of students) {
    if (!s.displayName) { results.push({ error: 'displayName required', input: s }); continue; }
    const base = s.displayName.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'student';
    let username = base, n = 2;
    while (taken.has(username)) { username = base + n; n++; }
    taken.add(username);

    const rawPin = s.pin || String(Math.floor(100000 + Math.random() * 900000));
    const passwordHash = await bcrypt.hash(rawPin, 10);
    try {
      const [r] = await pool.query(
        'INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, student_number) VALUES (?, ?, ?, ?, ?)',
        [classroom.id, s.displayName.trim(), username, passwordHash, s.studentNumber || null]
      );
      results.push({ id: r.insertId, displayName: s.displayName.trim(), username, pin: rawPin });
    } catch (err) {
      results.push({ error: err.message, input: s });
    }
  }

  res.json({ results });
});

// PUT /:id/students/:sid
router.put('/:id/students/:sid', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const { displayName, studentNumber, isActive, pin } = req.body;
  const [[student]] = await pool.query(
    'SELECT * FROM classroom_students WHERE id = ? AND classroom_id = ?',
    [req.params.sid, classroom.id]
  );
  if (!student) return res.status(404).json({ error: 'Student not found' });

  let passwordHash = student.password_hash;
  let newPin;
  if (pin) {
    newPin = String(pin);
    passwordHash = await bcrypt.hash(newPin, 10);
  }

  await pool.query(
    `UPDATE classroom_students SET
       display_name = COALESCE(?, display_name),
       student_number = ?,
       is_active = COALESCE(?, is_active),
       password_hash = ?
     WHERE id = ?`,
    [
      displayName ? displayName.trim() : null,
      studentNumber !== undefined ? (studentNumber || null) : student.student_number,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      passwordHash,
      student.id,
    ]
  );
  const [[updated]] = await pool.query(
    'SELECT id, display_name, username, student_number, is_active, created_at FROM classroom_students WHERE id = ?',
    [student.id]
  );
  res.json(newPin ? { ...updated, pin: newPin } : updated);
});

// DELETE /:id/students/:sid — soft-deactivate (preserve progress data)
router.delete('/:id/students/:sid', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;
  await pool.query(
    'UPDATE classroom_students SET is_active = 0 WHERE id = ? AND classroom_id = ?',
    [req.params.sid, classroom.id]
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Lesson assignments
// ---------------------------------------------------------------------------

router.get('/:id/assignments', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;
  const [rows] = await pool.query(
    `SELECT ca.*, cur.title, cur.series AS grade_level
     FROM classroom_assignments ca
     JOIN curricula cur ON cur.id = ca.curriculum_id
     WHERE ca.classroom_id = ?
     ORDER BY ca.sort_order, ca.assigned_at`,
    [classroom.id]
  );
  res.json(rows);
});

router.post('/:id/assignments', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const hasLicense = await hasActiveLicense(req.siteUser.id);
  if (!hasLicense) return res.status(403).json({ error: 'An active license is required to assign lessons' });

  const { curriculumId, sortOrder, dueDate } = req.body;
  if (!curriculumId) return res.status(400).json({ error: 'curriculumId required' });

  try {
    const [r] = await pool.query(
      'INSERT INTO classroom_assignments (classroom_id, curriculum_id, assigned_by_id, sort_order, due_date) VALUES (?, ?, ?, ?, ?)',
      [classroom.id, curriculumId, req.siteUser.id, sortOrder || 0, dueDate || null]
    );
    const [[row]] = await pool.query(
      `SELECT ca.*, cur.title FROM classroom_assignments ca JOIN curricula cur ON cur.id = ca.curriculum_id WHERE ca.id = ?`,
      [r.insertId]
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Lesson already assigned to this classroom' });
    throw err;
  }
});

router.delete('/:id/assignments/:cid', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;
  await pool.query(
    'DELETE FROM classroom_assignments WHERE classroom_id = ? AND curriculum_id = ?',
    [classroom.id, req.params.cid]
  );
  res.json({ ok: true });
});

// GET /:id/assignments/:cid/progress — per-student progress + reflections
router.get('/:id/assignments/:cid/progress', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const [students] = await pool.query(
    `SELECT cs.id, cs.display_name,
       slp.started_at, slp.completed_at,
       (SELECT COUNT(*) FROM student_quiz_responses sqr WHERE sqr.student_id = cs.id AND sqr.curriculum_id = ?) AS quiz_answered,
       (SELECT COUNT(*) FROM student_quiz_responses sqr WHERE sqr.student_id = cs.id AND sqr.curriculum_id = ? AND sqr.is_correct = 1) AS quiz_correct,
       (SELECT COUNT(*) FROM curriculum_quiz_questions cqq WHERE cqq.curriculum_id = ?) AS quiz_total,
       (SELECT COUNT(*) FROM student_reflections sr WHERE sr.student_id = cs.id AND sr.curriculum_id = ?) AS reflection_count
     FROM classroom_students cs
     LEFT JOIN student_lesson_progress slp ON slp.student_id = cs.id AND slp.curriculum_id = ?
     WHERE cs.classroom_id = ? AND cs.is_active = 1
     ORDER BY cs.display_name`,
    [req.params.cid, req.params.cid, req.params.cid, req.params.cid, req.params.cid, classroom.id]
  );

  // Load reflections and mark teacher_seen_at
  const studentIds = students.map(s => s.id);
  let reflections = [];
  if (studentIds.length) {
    [reflections] = await pool.query(
      'SELECT * FROM student_reflections WHERE curriculum_id = ? AND student_id IN (?)',
      [req.params.cid, studentIds]
    );
    const unseenIds = reflections.filter(r => !r.teacher_seen_at).map(r => r.id);
    if (unseenIds.length) {
      await pool.query(
        'UPDATE student_reflections SET teacher_seen_at = NOW() WHERE id IN (?)',
        [unseenIds]
      );
    }
  }

  res.json({ students, reflections });
});

// ---------------------------------------------------------------------------
// Brain game assignments
// ---------------------------------------------------------------------------

router.post('/:id/game-assignments', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;

  const { gameId, dueDate } = req.body;
  if (!gameId) return res.status(400).json({ error: 'gameId required' });

  const [r] = await pool.query(
    'INSERT INTO classroom_game_assignments (classroom_id, game_id, assigned_by_id, due_date) VALUES (?, ?, ?, ?)',
    [classroom.id, gameId, req.siteUser.id, dueDate || null]
  );
  const [[row]] = await pool.query(
    `SELECT cga.*, bg.name AS game_title, bg.slug AS game_slug
     FROM classroom_game_assignments cga JOIN brain_games bg ON bg.id = cga.game_id WHERE cga.id = ?`,
    [r.insertId]
  );
  res.status(201).json(row);
});

router.delete('/:id/game-assignments/:gaid', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;
  await pool.query(
    'DELETE FROM classroom_game_assignments WHERE id = ? AND classroom_id = ?',
    [req.params.gaid, classroom.id]
  );
  res.json({ ok: true });
});

router.get('/:id/game-assignments/:gaid/completions', requireSiteAuth, async (req, res) => {
  const classroom = await ownedClassroom(req, res);
  if (!classroom) return;
  const [rows] = await pool.query(
    `SELECT sgc.*, cs.display_name
     FROM student_game_completions sgc
     JOIN classroom_students cs ON cs.id = sgc.student_id
     WHERE sgc.game_assignment_id = ? AND cs.classroom_id = ?
     ORDER BY sgc.completed_at DESC`,
    [req.params.gaid, classroom.id]
  );
  res.json(rows);
});

module.exports = router;
