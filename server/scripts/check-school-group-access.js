// READ-ONLY check of a school's Community group, using the same rules the site uses, so you can see what each person there would
// get without asking any of them to sign in. Changes nothing.
//
//   node scripts/check-school-group-access.js --school=onboces.org
//
// For everyone who belongs to the school (a seat, a school administrator assignment, or a district administrator assignment for its
// district) it shows: whether they are a current Community member (a CRM contact AND a working license; otherwise they cannot
// open Community at all), whether they are in the school's group, and what follows: "sees it in Browse" (belongs, not yet in it)
// or "sees it in My groups" (in it). Anyone marked PROBLEM cannot see the group, and the reason is on the line.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { belongsToSchoolSql } = require('../lib/community-groups');
const { communityMemberSql } = require('../lib/community-members');

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--school='));
  const domain = arg ? arg.slice('--school='.length).trim().toLowerCase() : '';
  if (!domain) throw new Error('Give a school domain, for example --school=onboces.org');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const D = conn.escape(domain);
    const [[group]] = await conn.query(`SELECT id, name, is_public FROM social_groups WHERE type = 'school' AND LOWER(school_domain) = ${D}`);
    console.log(group ? `School group: "${group.name}" (id ${group.id}), ${group.is_public ? 'PUBLIC' : 'private'}` : `No school group exists yet for ${domain}. It is created when the first person from the school is added.`);

    const [people] = await conn.query(
      `SELECT su.id, su.email, su.first_name, su.last_name,
         EXISTS (SELECT 1 FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id WHERE ls.registered_site_user_id = su.id AND ls.status = 'registered' AND LOWER(p.school_domain) = ${D}) AS teacher,
         EXISTS (SELECT 1 FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id WHERE sla.site_user_id = su.id AND sla.is_active = 1 AND LOWER(p.school_domain) = ${D}) AS school_admin,
         EXISTS (SELECT 1 FROM district_license_admins dla JOIN schools s ON s.district_id = dla.district_id WHERE dla.site_user_id = su.id AND dla.is_active = 1 AND LOWER(s.domain) = ${D}) AS district_admin,
         ${communityMemberSql('su')} AS community_member,
         EXISTS (SELECT 1 FROM newsletter_contacts nc WHERE LOWER(nc.email) = LOWER(su.email)) AS has_contact,
         ${group ? `EXISTS (SELECT 1 FROM social_group_members m WHERE m.group_id = ${Number(group.id)} AND m.user_id = su.id)` : '0'} AS in_group
       FROM site_users su
       WHERE ${belongsToSchoolSql('su', D)}
       ORDER BY su.email`
    );
    console.log(`\nPeople who belong to ${domain}: ${people.length}\n`);
    let problems = 0;
    for (const p of people) {
      const roles = [p.teacher && 'teacher', p.school_admin && 'school admin', p.district_admin && 'district admin'].filter(Boolean).join(' + ');
      let result;
      if (!Number(p.community_member)) {
        problems += 1;
        result = `PROBLEM: cannot use Community at all (${Number(p.has_contact) ? 'no working license' : 'no CRM contact'})`;
      } else if (Number(p.in_group)) result = 'sees it in My groups';
      else if (group) result = 'sees it in Browse (can join)';
      else result = 'group does not exist yet';
      console.log(`  ${(p.first_name + ' ' + p.last_name).trim() || '(no name)'} <${p.email}>  [${roles}]  ->  ${result}`);
    }
    console.log(`\n${people.length - problems} of ${people.length} can see the group; ${problems} cannot.`);
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
