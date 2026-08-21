const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { STUDENT_COOKIE_NAME } = require('../lib/session');

async function requireStudentAuth(req, res, next) {
  const token = req.cookies[STUDENT_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query(
      'SELECT cs.*, c.name AS classroom_name, c.teacher_site_user_id FROM classroom_students cs JOIN classrooms c ON c.id = cs.classroom_id WHERE cs.id = ? AND cs.is_active = 1 AND c.archived_at IS NULL',
      [payload.studentId]
    );
    // Archiving a classroom is meant to fully cut off student access, not
    // just stop new joins — this is the single gate every student-facing
    // route goes through, so checking it here closes access everywhere at
    // once rather than needing a per-route archived_at check.
    if (!rows[0]) return res.status(401).json({ error: 'Not logged in' });
    req.student = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Not logged in' });
  }
}

module.exports = { requireStudentAuth };
