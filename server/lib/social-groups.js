const pool = require('../db/pool');

async function ensureProfile(userId) {
  await pool.query(
    'INSERT IGNORE INTO social_profiles (user_id) VALUES (?)',
    [userId]
  );
}

async function ensureGroup(type, name, schoolDomain) {
  if (type === 'school' && schoolDomain) {
    const [rows] = await pool.query(
      'SELECT id FROM social_groups WHERE type = ? AND school_domain = ?',
      [type, schoolDomain]
    );
    if (rows[0]) return rows[0].id;
    const [result] = await pool.query(
      'INSERT INTO social_groups (name, type, school_domain) VALUES (?, ?, ?)',
      [name, type, schoolDomain]
    );
    return result.insertId;
  }
  const [rows] = await pool.query('SELECT id FROM social_groups WHERE type = ?', [type]);
  if (rows[0]) return rows[0].id;
  const [result] = await pool.query(
    'INSERT INTO social_groups (name, type) VALUES (?, ?)',
    [name, type]
  );
  return result.insertId;
}

async function joinGroup(groupId, userId) {
  await pool.query(
    'INSERT IGNORE INTO social_group_members (group_id, user_id) VALUES (?, ?)',
    [groupId, userId]
  );
}

async function addTeacherToSocialGroups(siteUserId) {
  await ensureProfile(siteUserId);

  const allTeachersId = await ensureGroup('all_teachers', 'All Teachers', null);
  await joinGroup(allTeachersId, siteUserId);

  const [seatRows] = await pool.query(
    `SELECT p.school_domain, su.email
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.registered_site_user_id = ? AND ls.status = 'registered'
     LIMIT 1`,
    [siteUserId]
  );
  if (seatRows[0] && seatRows[0].school_domain) {
    const domain = seatRows[0].school_domain;
    const schoolGroupId = await ensureGroup('school', domain, domain);
    await joinGroup(schoolGroupId, siteUserId);
  }
}

module.exports = { addTeacherToSocialGroups, ensureProfile, ensureGroup, joinGroup };
