// One-off data cleanup following the school-admin.js fix that stopped
// /teachers/:id/deactivate and /reactivate from touching the GLOBAL
// site_users.role column (it used to set 'inactive_teacher'/'teacher',
// conflating one school's per-purchase deactivation with the person's
// entire account). role is never used for access control anywhere in the
// codebase (confirmed by grep before this fix shipped) — this is purely a
// stale-data correction, not a security-relevant change. Anyone left
// sitting at role='inactive_teacher' from before this fix would otherwise
// never get reset, since nothing writes that value going forward.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const conn = await pool.getConnection();
  try {
    const [before] = await conn.query(
      "SELECT id, email FROM site_users WHERE role = 'inactive_teacher'"
    );
    if (!before.length) {
      console.log("No site_users rows with role='inactive_teacher'. Nothing to do.");
      return;
    }
    console.log(`Found ${before.length} account(s) stuck at role='inactive_teacher':`);
    before.forEach(r => console.log(`  ${r.email} (id ${r.id})`));

    const [result] = await conn.query("UPDATE site_users SET role = 'teacher' WHERE role = 'inactive_teacher'");
    console.log(`Reset ${result.affectedRows} account(s) to role='teacher'.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
