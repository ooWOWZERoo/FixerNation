// Who belongs to a school, for private school groups (docs/reference/community-group-privacy-requirements.md, rule A).
// A person belongs to the school with domain D when they hold a registered seat on a purchase for D, or an active school
// license administrator assignment on a purchase for D, or an active district administrator assignment for the district that
// contains the school D. Plain portable SQL (EXISTS, LOWER) so it runs on MariaDB and in the node:sqlite tests.
const pool = require('../db/pool');

// SQL: this site_users row (userAlias) belongs to the school whose domain is the SQL expression domainExpr.
function belongsToSchoolSql(userAlias, domainExpr) {
  return `(EXISTS (SELECT 1 FROM license_seats bls JOIN purchases bp ON bp.id = bls.purchase_id
                   WHERE bls.registered_site_user_id = ${userAlias}.id AND bls.status = 'registered' AND LOWER(bp.school_domain) = LOWER(${domainExpr}))
    OR EXISTS (SELECT 1 FROM school_license_admins bsla JOIN purchases bpa ON bpa.id = bsla.purchase_id
               WHERE bsla.site_user_id = ${userAlias}.id AND bsla.is_active = 1 AND LOWER(bpa.school_domain) = LOWER(${domainExpr}))
    OR EXISTS (SELECT 1 FROM district_license_admins bdla JOIN schools bs ON bs.district_id = bdla.district_id
               WHERE bdla.site_user_id = ${userAlias}.id AND bdla.is_active = 1 AND LOWER(bs.domain) = LOWER(${domainExpr})))`;
}

async function belongsToSchool(db, siteUserId, domain) {
  if (!siteUserId || !domain) return false;
  const [rows] = await db.query(`SELECT 1 AS yes FROM site_users bu WHERE bu.id = ? AND ${belongsToSchoolSql('bu', '?')}`, [siteUserId, domain, domain, domain]); // the domain appears once in each of the three ways of belonging
  return rows.length > 0;
}

// Everyone sitting in a school group who does not belong to that school: [{ groupId, schoolDomain, userId, email, name }].
async function findStrangersInSchoolGroups(db = pool) {
  const [rows] = await db.query(
    `SELECT g.id AS group_id, g.school_domain, su.id AS user_id, su.email, su.first_name, su.last_name
     FROM social_groups g
     JOIN social_group_members m ON m.group_id = g.id
     JOIN site_users su ON su.id = m.user_id
     WHERE g.type = 'school' AND NOT ${belongsToSchoolSql('su', 'g.school_domain')}
     ORDER BY g.school_domain, su.email`
  );
  return rows.map((r) => ({ groupId: r.group_id, schoolDomain: r.school_domain, userId: r.user_id, email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(' ') }));
}

async function removeStrangersFromSchoolGroups(db = pool) {
  const strangers = await findStrangersInSchoolGroups(db);
  for (const s of strangers) await db.query('DELETE FROM social_group_members WHERE group_id = ? AND user_id = ?', [s.groupId, s.userId]);
  return strangers.length;
}

module.exports = { belongsToSchoolSql, belongsToSchool, findStrangersInSchoolGroups, removeStrangersFromSchoolGroups };
