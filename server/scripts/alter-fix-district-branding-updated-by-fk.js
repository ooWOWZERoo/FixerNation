// A district_branding table created by an EARLIER, different implementation
// of the district-branding feature (FNE-admin-managed only) had
// updated_by -> admin_users(id), since only an FNE admin ever wrote to it.
// This session's implementation has a self-service district_admin role
// (a site_users row, not an admin_users row) writing updated_by instead —
// server/lib/branding-editor.js passes req.districtAdmin.siteUserId, a
// site_users.id, into every UPDATE district_branding ... SET updated_by = ?
// call. Left pointed at admin_users, that insert/update fails its foreign
// key check the first time a district admin actually saves/publishes/resets
// branding. Fixes the constraint to reference site_users(id), matching
// school_branding's updated_by exactly. A district_branding table created
// fresh by alter-create-districts.js already has the correct FK from the
// start, so this script is a no-op there.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function fkReferencedTable(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT REFERENCED_TABLE_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [process.env.DB_NAME, table, column]
  );
  return rows[0] || null;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    if (!(await tableExists(conn, 'district_branding'))) {
      console.log('district_branding: table doesn\'t exist yet, nothing to fix.');
      process.exit(0);
    }

    const fk = await fkReferencedTable(conn, 'district_branding', 'updated_by');
    if (!fk) {
      console.log('district_branding.updated_by: no foreign key found, leaving as-is.');
    } else if (fk.REFERENCED_TABLE_NAME === 'site_users') {
      console.log('district_branding.updated_by: already references site_users, skipping.');
    } else {
      console.log(`district_branding.updated_by: currently references ${fk.REFERENCED_TABLE_NAME} (constraint ${fk.CONSTRAINT_NAME}) — fixing to site_users.`);
      // The feature hasn't been used yet on this install, but clear any
      // existing values defensively so the new constraint can never fail to
      // apply due to leftover data from the old FK target.
      await conn.query('UPDATE district_branding SET updated_by = NULL');
      await conn.query(`ALTER TABLE district_branding DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
      await conn.query(
        'ALTER TABLE district_branding ADD CONSTRAINT fk_district_branding_updated_by FOREIGN KEY (updated_by) REFERENCES site_users(id) ON DELETE SET NULL'
      );
      console.log('district_branding.updated_by: now references site_users.');
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
