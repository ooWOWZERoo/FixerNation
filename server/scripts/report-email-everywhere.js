// READ-ONLY report: everywhere an email address (or two, such as a typo and its correction) appears, and who the school and
// district administrators are for a school, shown the way the concierge page sees them and the way the School Admins page sees them.
// This script changes nothing.
//
//   node scripts/report-email-everywhere.js ccherman@onboces.org cherman@onboces.org
//   node scripts/report-email-everywhere.js ccherman@onboces.org cherman@onboces.org --school=orleans
//
// --school=TEXT also lists the administrators of every license whose school domain or district name contains TEXT.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const emails = process.argv.slice(2).filter((a) => a.includes('@')).map((e) => e.trim().toLowerCase());
  const schoolArg = process.argv.find((a) => a.startsWith('--school='));
  const school = schoolArg ? schoolArg.slice('--school='.length).trim() : '';
  if (!emails.length && !school) throw new Error('Give at least one email address or --school=TEXT');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const show = (title, rows) => { console.log(`\n== ${title} (${rows.length})`); rows.forEach((r) => console.log('  ', JSON.stringify(r))); };

  try {
    for (const email of emails) {
      console.log(`\n################ ${email}`);
      const [users] = await conn.query('SELECT id, email, first_name, last_name, role, email_verified, microsoft_oid IS NOT NULL AS microsoft, created_at FROM site_users WHERE LOWER(email) = ?', [email]);
      show('site_users (sign-in accounts)', users);
      const [contacts] = await conn.query('SELECT id, email, name, company, source, status, signup_date FROM newsletter_contacts WHERE LOWER(email) = ?', [email]);
      show('newsletter_contacts (CRM)', contacts);
      const [sla] = await conn.query(
        `SELECT sla.id, sla.is_active, sla.permission_level, p.id AS purchase_id, p.school_domain, p.payment_status, p.license_status
         FROM school_license_admins sla JOIN site_users su ON su.id = sla.site_user_id JOIN purchases p ON p.id = sla.purchase_id WHERE LOWER(su.email) = ?`, [email]);
      show('school_license_admins (school admin assignments)', sla);
      const [dla] = await conn.query(
        `SELECT dla.id, dla.is_active, d.id AS district_id, d.name AS district FROM district_license_admins dla
         JOIN site_users su ON su.id = dla.site_user_id JOIN districts d ON d.id = dla.district_id WHERE LOWER(su.email) = ?`, [email]);
      show('district_license_admins (district admin assignments)', dla);
      const [seats] = await conn.query('SELECT id, purchase_id, status, invited_email FROM license_seats WHERE LOWER(invited_email) = ?', [email]);
      show('license_seats', seats);
      const [inv] = await conn.query('SELECT id, purchase_id, status, expires_at, invited_email FROM school_invitations WHERE LOWER(invited_email) = ?', [email]);
      show('school_invitations', inv);
      const [quotes] = await conn.query('SELECT id, quote_number, school, quoted_school_domain, accepted_at FROM quote_requests WHERE LOWER(email) = ?', [email]);
      show('quote_requests', quotes);
    }

    if (school) {
      const like = `%${school}%`;
      console.log(`\n################ licenses matching "${school}"`);
      const [purchases] = await conn.query(
        `SELECT p.id, p.school_domain, p.seat_count, p.payment_status, p.payment_method, p.license_status, p.school_id, s.district_id, d.name AS district
         FROM purchases p LEFT JOIN schools s ON s.id = p.school_id LEFT JOIN districts d ON d.id = s.district_id
         WHERE p.product_type = 'group_license' AND (p.school_domain LIKE ? OR d.name LIKE ? OR s.display_name LIKE ? OR s.domain LIKE ?)`, [like, like, like, like]);
      show('purchases', purchases);
      for (const p of purchases) {
        const [concierge] = await conn.query(
          `SELECT sla.id, su.email, sla.permission_level FROM school_license_admins sla JOIN site_users su ON su.id = sla.site_user_id
           WHERE sla.purchase_id = ? AND sla.is_active = 1`, [p.id]);
        show(`purchase ${p.id}: school admins the CONCIERGE page lists`, concierge);
        const [page] = await conn.query(
          `SELECT sla.id, su.email FROM school_license_admins sla JOIN site_users su ON su.id = sla.site_user_id
           WHERE sla.purchase_id = ? AND sla.is_active = 1
             AND NOT EXISTS (SELECT 1 FROM district_license_admins dla WHERE dla.site_user_id = sla.site_user_id AND dla.is_active = 1)`, [p.id]);
        show(`purchase ${p.id}: school admins the SCHOOL ADMINS page lists (anyone who is also a district admin is left out)`, page);
        if (p.district_id) {
          const [d] = await conn.query(
            `SELECT dla.id, su.email FROM district_license_admins dla JOIN site_users su ON su.id = dla.site_user_id
             WHERE dla.district_id = ? AND dla.is_active = 1`, [p.district_id]);
          show(`district ${p.district_id} (${p.district}): district admins`, d);
        }
      }
    }
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
