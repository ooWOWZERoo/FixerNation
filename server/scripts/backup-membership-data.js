// Dumps membership_plans + contact_memberships to a timestamped JSON file
// before drop-membership-tables.js removes them, per the user's explicit
// request to remove the membership feature from FNE (2026-08-23). Run this
// first, confirm the row counts look right, THEN run drop-membership-tables.js.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [plans] = await conn.query('SELECT * FROM membership_plans');
    const [memberships] = await conn.query('SELECT * FROM contact_memberships');

    const backupDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(backupDir, `membership-backup-${timestamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ membership_plans: plans, contact_memberships: memberships }, null, 2));

    console.log(`Backed up ${plans.length} membership_plans row(s) and ${memberships.length} contact_memberships row(s).`);
    console.log(`Written to: ${outPath}`);
    console.log('Review this file, then run: node scripts/drop-membership-tables.js');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
