// Release 112: school Community groups are private (docs/reference/community-group-privacy-requirements.md). Sets every existing
// school group private. New ones are created private by lib/social-groups.js. Idempotent: safe to run again.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const [[before]] = await pool.query("SELECT COUNT(*) AS n FROM social_groups WHERE type = 'school' AND is_public = 1");
  const [r] = await pool.query("UPDATE social_groups SET is_public = 0 WHERE type = 'school' AND is_public = 1");
  console.log(`School groups that were public: ${before.n}. Made private: ${r.affectedRows}.`);
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
