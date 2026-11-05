// READ-ONLY report: where sign-in accounts and the CRM disagree (docs/reference/crm-record-of-truth-requirements.md). Changes nothing.
//
//   node scripts/report-accounts-vs-crm.js
//
// 1. Accounts with NO CRM contact. From Release 110 these people are not Community members (no contact, no Community), so run this
//    BEFORE restarting the Node app and fix any real person on the list (add their contact in the CRM) first.
// 2. Everyone Community lists today (an account with a Community profile), and whether each is a current member under the new rule.
// 3. Names that appear on more than one account.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { communityMemberSql } = require('../lib/community-members');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const show = (title, rows) => { console.log(`\n== ${title} (${rows.length})`); rows.forEach((r) => console.log('  ', JSON.stringify(r))); };
  try {
    const [noContact] = await conn.query(
      `SELECT su.id, su.email, su.first_name, su.last_name, su.role, su.is_sales_demo AS demo,
              (SELECT COUNT(*) FROM license_seats ls WHERE ls.registered_site_user_id = su.id AND ls.status = 'registered') AS seats
       FROM site_users su
       WHERE NOT EXISTS (SELECT 1 FROM newsletter_contacts nc WHERE LOWER(nc.email) = LOWER(su.email))
       ORDER BY su.id`);
    show('Accounts with NO CRM contact (not Community members from Release 110; "seats" > 0 means a real teacher to fix)', noContact);

    const [listed] = await conn.query(
      `SELECT su.id, su.email, su.first_name, su.last_name, ${communityMemberSql('su')} AS member_under_new_rule
       FROM site_users su JOIN social_profiles sp ON sp.user_id = su.id ORDER BY su.first_name, su.last_name`);
    show('Everyone Community lists today (member_under_new_rule 0 = will disappear)', listed);

    const [dupes] = await conn.query(
      `SELECT su.first_name, su.last_name, COUNT(*) AS accounts, GROUP_CONCAT(su.email SEPARATOR ', ') AS emails
       FROM site_users su GROUP BY su.first_name, su.last_name HAVING COUNT(*) > 1 ORDER BY accounts DESC`);
    show('Names on more than one account', dupes);
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
