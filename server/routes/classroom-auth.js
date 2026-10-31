const express = require('express');
const bcrypt = require('bcryptjs');
const { signSession } = require('../lib/session-tokens');
const pool = require('../db/pool');
const { STUDENT_COOKIE_NAME, STUDENT_COOKIE_MAX_AGE_MS } = require('../lib/session');
const { requireStudentAuth } = require('../middleware/studentAuth');
const crypto = require('crypto');

const { limiter, FailureTracker, rejectIfBlocked, clientIp } = require('../lib/rate-limit');

const { isValidPin, PIN_ERROR } = require('../lib/pin');
const router = express.Router();

// Student PINs are 6 digits (1,000,000 possibilities) and usernames are guessable
// (firstname, firstname2, ...), so the PIN is only as strong as the lockout in
// front of it. Failures are tracked per STUDENT (what actually protects an
// account, and works even when IP can't be resolved) and per IP. The IP limit is
// deliberately generous: a whole class logs in from one school address, and
// correct PINs never count against it.
const PIN_WINDOW = 15 * 60 * 1000;
const pinFailsByStudent = new FailureTracker({ name: 'pin-student', windowMs: PIN_WINDOW, max: 5 });
const pinFailsByIp = new FailureTracker({ name: 'pin-ip', windowMs: PIN_WINDOW, max: 100 });
const joinCodeMissesByIp = new FailureTracker({ name: 'join-code-miss-ip', windowMs: PIN_WINDOW, max: 30 });
const joinLimit = limiter({ name: 'student-join', windowMs: 60 * 60 * 1000, max: 150 });

function setStudentCookie(res, student) {
  const token = signSession('student', { studentId: student.id, classroomId: student.classroom_id }, '8h');
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
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
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
// Body: { joinCode, displayName, pin }
//
// If a classroom_students row with this exact display name already exists
// in this classroom, this is treated as a possible returning student rather
// than blindly creating a duplicate: the submitted pin is checked against
// that existing account first. A match logs them into the existing account
// (all prior progress/history intact) instead of registering anything new.
// If it doesn't match (or the name is new), falls through to the original
// create-a-new-account behavior — this was the one documented-but-never-
// implemented behavior this route claimed to have.
router.post('/join', joinLimit, async (req, res) => {
  const { joinCode, displayName, pin } = req.body || {};
  if (!joinCode) return res.status(400).json({ error: 'Join code required' });
  if (typeof joinCode !== 'string' || (displayName != null && typeof displayName !== 'string') || (pin != null && typeof pin !== 'string' && typeof pin !== 'number')) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const ip = clientIp(req);
  if (rejectIfBlocked(res, [[joinCodeMissesByIp, ip]])) return;

  const [classrooms] = await pool.query(
    'SELECT * FROM classrooms WHERE join_code = ? AND archived_at IS NULL',
    [String(joinCode).toUpperCase().trim()]
  );
  if (!classrooms[0]) {
    joinCodeMissesByIp.fail(ip);
    return res.status(404).json({ error: 'Classroom not found — check your join code' });
  }
  const classroom = classrooms[0];

  if (!displayName) return res.status(400).json({ error: 'Display name required', classroomName: classroom.name });
  if (pin && !isValidPin(pin)) return res.status(400).json({ error: PIN_ERROR, classroomName: classroom.name });

  let nameCollision = false;
  if (pin) {
    const [existingByName] = await pool.query(
      'SELECT * FROM classroom_students WHERE classroom_id = ? AND display_name = ? AND is_active = 1',
      [classroom.id, displayName.trim()]
    );
    if (existingByName[0]) {
      // A returning student re-authenticating by name + PIN is a PIN guess like
      // any other, so it shares the per-student lockout with /login.
      const studentKey = 'username:' + String(existingByName[0].username).toLowerCase().trim(); // same key /login uses, so guesses can't be split across the two routes
      if (rejectIfBlocked(res, [[pinFailsByStudent, studentKey], [pinFailsByIp, ip]])) return;
      const matches = await bcrypt.compare(String(pin), existingByName[0].password_hash);
      if (matches) {
        pinFailsByStudent.clear(studentKey);
        setStudentCookie(res, existingByName[0]);
        return res.json({
          classroomName: classroom.name,
          displayName: existingByName[0].display_name,
          username: existingByName[0].username,
          isNew: false,
          reauthenticated: true,
        });
      }
      pinFailsByStudent.fail(studentKey);
      pinFailsByIp.fail(ip);
      nameCollision = true;
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const username = await generateUsername(conn, displayName.split(' ')[0] || displayName);
    const rawPin = pin ? String(pin) : generatePin();
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
      nameCollision,
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
  const { username, pin } = req.body || {};
  if (!username || !pin) return res.status(400).json({ error: 'Username and PIN required' });
  if (typeof username !== 'string' || (typeof pin !== 'string' && typeof pin !== 'number')) {
    return res.status(400).json({ error: 'Invalid username or PIN' });
  }

  const ip = clientIp(req);
  const usernameKey = 'username:' + username.toLowerCase().trim();
  if (rejectIfBlocked(res, [[pinFailsByStudent, usernameKey], [pinFailsByIp, ip]])) return;

  const [rows] = await pool.query(
    'SELECT cs.*, c.name AS classroom_name, c.archived_at FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id WHERE cs.username = ? AND cs.is_active = 1',
    [String(username).toLowerCase().trim()]
  );
  const student = rows[0];
  if (!student) {
    pinFailsByStudent.fail(usernameKey);
    pinFailsByIp.fail(ip);
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }
  if (student.archived_at) {
    return res.status(401).json({ error: 'This classroom has been archived. Ask your teacher for help.' });
  }

  const ok = await bcrypt.compare(String(pin), student.password_hash);
  if (!ok) {
    pinFailsByStudent.fail(usernameKey);
    pinFailsByIp.fail(ip);
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }
  pinFailsByStudent.clear(usernameKey);

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
            cur.title, cur.series AS grade_level,
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
            bg.name AS game_title, bg.slug AS game_slug,
            MAX(sgc.completed_at) AS last_completed_at
     FROM classroom_game_assignments cga
     JOIN brain_games bg ON bg.id = cga.game_id
     LEFT JOIN student_game_completions sgc ON sgc.game_assignment_id = cga.id AND sgc.student_id = ?
     WHERE cga.classroom_id = ?
     GROUP BY cga.id, cga.game_id, cga.due_date, bg.name, bg.slug`,
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
