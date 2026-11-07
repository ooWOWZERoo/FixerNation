// One-off clean-up: removes the disposable affiliate left in production by the September 2026 territory-request check
// (affiliates.id 3, referral code TESTAFFI-E6HN, a made-up @example.com address). Dry run by default; --apply deletes.
//   cd /home/fixernat/repositories/fixernation/server && node scripts/delete-test-affiliate.js           (shows what would go)
//   cd /home/fixernat/repositories/fixernation/server && node scripts/delete-test-affiliate.js --apply   (deletes it)
//
// Scoped to that one exact address. It refuses to run if the affiliate has ever earned a commission or been credited with a purchase,
// so a real affiliate can never be removed by this. Territories (county rows) are left alone: they are shared reference rows, and an
// unused one does no harm. Deleting the sign-in account cascades to the affiliate row, its territory assignments and its requests.
// Audit log entries are kept on purpose.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const EMAIL = 'verify-territory-1790519228989@example.com';
const APPLY = process.argv.includes('--apply');

(async () => {
  const [[user]] = await pool.query('SELECT id, email, first_name, last_name FROM site_users WHERE email = ?', [EMAIL]);
  const [[contact]] = await pool.query('SELECT COUNT(*) AS n FROM newsletter_contacts WHERE email = ?', [EMAIL]);
  const [[application]] = await pool.query('SELECT COUNT(*) AS n FROM affiliate_applications WHERE email = ?', [EMAIL]);
  if (!user) {
    console.log(`No sign-in account for ${EMAIL}. Nothing to delete from site_users.`);
  } else {
    const [[aff]] = await pool.query('SELECT id, referral_code, status FROM affiliates WHERE site_user_id = ?', [user.id]);
    console.log(`Account: id ${user.id}, ${user.email}`);
    if (aff) {
      const [[commissions]] = await pool.query('SELECT COUNT(*) AS n FROM affiliate_commissions WHERE affiliate_id = ?', [aff.id]);
      const [[credited]] = await pool.query('SELECT COUNT(*) AS n FROM purchases WHERE affiliate_id = ?', [aff.id]);
      const [[held]] = await pool.query('SELECT COUNT(*) AS n FROM affiliate_territories WHERE affiliate_id = ?', [aff.id]);
      console.log(`Affiliate: id ${aff.id}, code ${aff.referral_code}, status ${aff.status}; territory assignments ${held.n}; commissions ${commissions.n}; credited purchases ${credited.n}`);
      if (Number(commissions.n) || Number(credited.n)) {
        console.log('REFUSING: this affiliate has commissions or credited purchases, so it is not a disposable test row. Nothing was changed.');
        process.exit(1);
      }
    } else {
      console.log('No affiliate row on this account.');
    }
  }
  console.log(`CRM contacts with this address: ${contact.n}; affiliate applications: ${application.n}`);

  if (!APPLY) { console.log('Dry run. Nothing deleted. Run again with --apply to delete.'); process.exit(0); }

  const [c] = await pool.query('DELETE FROM newsletter_contacts WHERE email = ?', [EMAIL]);
  const [ap] = await pool.query('DELETE FROM affiliate_applications WHERE email = ?', [EMAIL]);
  const [u] = await pool.query('DELETE FROM site_users WHERE email = ?', [EMAIL]);
  console.log(`Deleted: ${u.affectedRows} account (with its affiliate row and assignments), ${c.affectedRows} CRM contact, ${ap.affectedRows} application.`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
