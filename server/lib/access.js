const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('./session');

// Resolves the requesting site_user from their session cookie, if any —
// never fails the request, callers decide what to do with a null result.
async function getSiteUser(req) {
  const token = req.cookies && req.cookies[SITE_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query('SELECT id, first_name, email, role FROM site_users WHERE id = ?', [payload.userId]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// True if this site_user has claimed at least one license seat (single or
// group) — the seat's registered_site_user_id is set at signup time, so
// this is a direct lookup with no email-matching involved.
// Also checks that the associated purchase's license_status is active and
// its expiration_date (if set) has not passed.
async function hasActiveLicense(siteUserId) {
  if (!siteUserId) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     WHERE ls.registered_site_user_id = ?
       AND ls.status = 'registered'
       AND p.license_status NOT IN ('pending', 'expired', 'cancelled', 'suspended')
       AND (p.expiration_date IS NULL OR p.expiration_date >= CURDATE())
     LIMIT 1`,
    [siteUserId]
  );
  return rows.length > 0;
}

// Returns all classroom+child links a parent has — one row per linked
// student, not per classroom, so a parent with two children in the same
// classroom gets two distinct rows. student_id is only NULL for a link
// created before per-child invites existed (the old parent_code self-join
// flow, now removed); nothing back-fills those automatically.
async function getParentClassrooms(siteUserId) {
  if (!siteUserId) return [];
  const [rows] = await pool.query(
    `SELECT c.id AS classroomId, c.name AS className,
            cs.id AS studentId, cs.display_name AS studentName
     FROM parent_classroom_links pcl
     JOIN classrooms c ON c.id = pcl.classroom_id
     LEFT JOIN classroom_students cs ON cs.id = pcl.student_id
     WHERE pcl.site_user_id = ?
     ORDER BY c.name, cs.display_name`,
    [siteUserId]
  );
  return rows;
}

// True if a parent user is linked to any classroom that has the given curriculum assigned.
async function hasParentAccessToCurriculum(siteUserId, curriculumId) {
  if (!siteUserId || !curriculumId) return false;
  const [rows] = await pool.query(
    `SELECT 1 FROM parent_classroom_links pcl
     JOIN classroom_assignments ca ON ca.classroom_id = pcl.classroom_id
     WHERE pcl.site_user_id = ? AND ca.curriculum_id = ? LIMIT 1`,
    [siteUserId, curriculumId]
  );
  return rows.length > 0;
}

module.exports = { getSiteUser, hasActiveLicense, getParentClassrooms, hasParentAccessToCurriculum };
