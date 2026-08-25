// Resolves school_domain for the various author contexts the safety gateway
// sees. Mirrors the school_id resolution helpers already in lib/branding.js
// (resolveSchoolIdForTeacher/resolveSchoolIdForClassroom) but returns
// purchases.school_domain directly, since safety_alert_recipients/safety_rules
// key on domain, not school_id.
const pool = require('../../db/pool');

async function resolveSchoolDomainForTeacher(siteUserId) {
  if (!siteUserId) return null;
  try {
    const [[row]] = await pool.query(
      `SELECT p.school_domain
       FROM license_seats ls
       JOIN purchases p ON p.id = ls.purchase_id
       WHERE ls.registered_site_user_id = ? AND ls.status = 'registered' AND p.school_domain IS NOT NULL
       ORDER BY ls.registered_at DESC
       LIMIT 1`,
      [siteUserId]
    );
    return row ? row.school_domain : null;
  } catch {
    return null;
  }
}

async function resolveSchoolDomainForClassroom(classroomId) {
  if (!classroomId) return null;
  try {
    const [[row]] = await pool.query('SELECT teacher_site_user_id FROM classrooms WHERE id = ?', [classroomId]);
    if (!row) return null;
    return resolveSchoolDomainForTeacher(row.teacher_site_user_id);
  } catch {
    return null;
  }
}

async function resolveTeacherForClassroom(classroomId) {
  if (!classroomId) return null;
  try {
    const [[row]] = await pool.query('SELECT teacher_site_user_id FROM classrooms WHERE id = ?', [classroomId]);
    return row ? row.teacher_site_user_id : null;
  } catch {
    return null;
  }
}

async function resolveSchoolDomainForSocialGroup(groupId) {
  if (!groupId) return null;
  try {
    const [[row]] = await pool.query('SELECT school_domain FROM social_groups WHERE id = ?', [groupId]);
    return row ? row.school_domain : null;
  } catch {
    return null;
  }
}

module.exports = {
  resolveSchoolDomainForTeacher,
  resolveSchoolDomainForClassroom,
  resolveTeacherForClassroom,
  resolveSchoolDomainForSocialGroup,
};
