const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { STUDENT_COOKIE_NAME, STUDENT_COOKIE_MAX_AGE_MS } = require('../lib/session');
const { requireStudentAuth } = require('../middleware/studentAuth');

const router = express.Router();

function setStudentCookie(res, student) {
  const token = jwt.sign(
    { studentId: student.id, classroomId: student.classroom_id },
    process.env.SESSION_SECRET,
    { expiresIn: '8h' }
  );
  res.cookie(STUDENT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: STUDENT_COOKIE_MAX_AGE_MS,
  });
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function generateUsername(conn, firstName) {
  const base = firstName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'student';
  const [existing] = await conn.query(
    'SELECT username FROM classroom_students WHERE username LIKE ? ORDER BY username',
    [base + '%']
  );
  const taken = new Set(existing.map(r => r.username));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + n)) n++;
  return base + n;
}

// POST /api/classroom-auth/join
// Body: { joinCode, displayName, pin? }
// If returning: also pass { username, pin } to re-authenticate existing student
router.post('/join', async (req, res) => {
  const { joinCode, displayName, pin } = req.body;
  if (!joinCode) return res.status(400).json({ error: 'Join code required' });

  const [classrooms] = await pool.query(
    'SELECT * FROM classrooms WHERE join_code = ? AND archived_at IS NULL',
    [String(joinCode).toUpperCase().trim()]
  );
  if (!classrooms[0]) return res.status(404).json({ error: 'Classroom not found — check your join code' });
  const classroom = classrooms[0];

  if (!displayName) return res.status(400).json({ error: 'Display name required', classroomName: classroom.name });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const username = await generateUsername(conn, displayName.split(' ')[0] || displayName);
    const rawPin = pin || generatePin();
    const passwordHash = await bcrypt.hash(rawPin, 10);

    await conn.query(
      'INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, ?, ?, ?)',
      [classroom.id, displayName.trim(), username, passwordHash]
    );
    const [[student]] = await conn.query(
      'SELECT * FROM classroom_students WHERE username = ?',
      [username]
    );

    await conn.commit();

    setStudentCookie(res, student);
    res.json({
      classroomName: classroom.name,
      displayName: student.display_name,
      username: student.username,
      pin: rawPin,
      isNew: true,
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already taken — try a slightly different display name' });
    }
    throw err;
  } finally {
    conn.release();
  }
});

// POST /api/classroom-auth/login
// Body: { username, pin }
router.post('/login', async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Username and PIN required' });

  const [rows] = await pool.query(
    'SELECT cs.*, c.name AS classroom_name FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id WHERE cs.username = ? AND cs.is_active = 1',
    [String(username).toLowerCase().trim()]
  );
  const student = rows[0];
  if (!student) return res.status(401).json({ error: 'Invalid username or PIN' });

  const ok = await bcrypt.compare(String(pin), student.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or PIN' });

  setStudentCookie(res, student);
  res.json({ classroomName: student.classroom_name, displayName: student.display_name, username: student.username });
});

// POST /api/classroom-auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(STUDENT_COOKIE_NAME);
  res.json({ ok: true });
});

// GET /api/classroom-auth/me
router.get('/me', requireStudentAuth, async (req, res) => {
  const s = req.student;
  const [assignments] = await pool.query(
    `SELECT ca.id, ca.curriculum_id, ca.sort_order, ca.due_date,
            cur.title, cur.grade_level,
            slp.started_at, slp.completed_at
     FROM classroom_assignments ca
     JOIN curricula cur ON cur.id = ca.curriculum_id
     LEFT JOIN student_lesson_progress slp ON slp.curriculum_id = ca.curriculum_id AND slp.student_id = ?
     WHERE ca.classroom_id = ?
     ORDER BY ca.sort_order, ca.assigned_at`,
    [s.id, s.classroom_id]
  );
  const [games] = await pool.query(
    `SELECT cga.id AS assignment_id, cga.game_id, cga.due_date,
            bg.title AS game_title, bg.slug AS game_slug,
            MAX(sgc.completed_at) AS last_completed_at
     FROM classroom_game_assignments cga
     JOIN brain_games bg ON bg.id = cga.game_id
     LEFT JOIN student_game_completions sgc ON sgc.game_assignment_id = cga.id AND sgc.student_id = ?
     WHERE cga.classroom_id = ?
     GROUP BY cga.id, cga.game_id, cga.due_date, bg.title, bg.slug`,
    [s.id, s.classroom_id]
  );
  res.json({
    student: { id: s.id, displayName: s.display_name, username: s.username },
    classroom: { id: s.classroom_id, name: s.classroom_name },
    assignments,
    games,
  });
});

module.exports = { router };
