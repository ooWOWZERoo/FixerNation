// Fixes: quote-accepted purchases stored the prospect's free-text "School or
// District Name" (quote_requests.school, e.g. "Lincoln Elementary") as
// purchases.school_domain — but self-service teacher registration
// (school-registration.js) does an EXACT match on the teacher's real email
// domain. Every teacher at a school that bought via a formal quote got
// rejected as "no school found," indistinguishable from never having
// purchased, despite an active paid license on file.
//
// Adds a real quoted_school_domain column the admin fills in on the quote
// builder (they're the one talking to the buyer and can verify the real
// domain, the same way admin-newsletter.html's manual purchase form already
// asks for one) — separate from `school` (the display name), which stays as
// free text.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query("SHOW COLUMNS FROM quote_requests LIKE 'quoted_school_domain'");
    if (!rows.length) {
      await conn.query('ALTER TABLE quote_requests ADD COLUMN quoted_school_domain VARCHAR(255) NULL AFTER school');
      console.log('quote_requests: added quoted_school_domain');
    } else {
      console.log('quote_requests: quoted_school_domain already exists, skipping');
    }
    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
