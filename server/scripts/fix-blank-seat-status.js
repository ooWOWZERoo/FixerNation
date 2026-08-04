// One-time migration: convert blank placeholder seats from 'pending' to 'available'.
// Safe to re-run — UPDATE affects 0 rows if already migrated.
// Real pending invitations always have invited_email set, so this only touches blanks.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

(async () => {
  const [result] = await pool.query(
    "UPDATE license_seats SET status = 'available' WHERE status = 'pending' AND invited_email IS NULL"
  );
  console.log(`Updated ${result.affectedRows} blank seats from 'pending' to 'available'.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
