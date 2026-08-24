// Fixes group_license purchases whose school_domain was set (at creation or
// later edit) after the one-time alter-create-schools-and-branding.js
// migration ran, since no code path back-filled purchases.school_id going
// forward until server/routes/newsletter.js's createPurchase()/PUT
// /purchases/:id were fixed to do it themselves. Without school_id, school
// branding can't resolve a school for the purchase ("This school has no
// school record yet"). Idempotent — safe to re-run any time.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [domainRows] = await conn.query(
      "SELECT DISTINCT school_domain FROM purchases WHERE school_id IS NULL AND school_domain IS NOT NULL AND school_domain != ''"
    );
    for (const { school_domain } of domainRows) {
      await conn.query('INSERT IGNORE INTO schools (domain) VALUES (?)', [school_domain]);
    }
    console.log(`schools: ensured a row exists for ${domainRows.length} distinct domain(s)`);

    const [{ affectedRows }] = await conn.query(`
      UPDATE purchases p
      JOIN schools s ON s.domain = p.school_domain
      SET p.school_id = s.id
      WHERE p.school_id IS NULL AND p.school_domain IS NOT NULL
    `);
    console.log(`purchases: backfilled school_id on ${affectedRows} row(s)`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
