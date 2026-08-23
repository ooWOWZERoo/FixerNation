// Adds non-destructive crop/reposition storage to school_branding AND
// district_branding — a crop rect (pixel {x,y,width,height} within the
// ORIGINAL uploaded image) is kept separately for draft/published, mirroring
// the existing draft/published snapshot-pair pattern both tables already
// use. Re-running the crop tool always starts from the untouched original;
// these columns are what lets that be re-opened and re-edited rather than
// being a one-shot client-side crop.
//
// district_branding is included here (not just covered by its own CREATE
// TABLE in alter-create-districts.js) because a district_branding table
// created by an EARLIER, different implementation of the district-branding
// feature may already exist without these columns — this script's
// columnExists guard means re-running it is always safe either way.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    for (const table of ['school_branding', 'district_branding']) {
      if (!(await tableExists(conn, table))) {
        console.log(`${table}: table doesn't exist yet, skipping (will get these columns from its own CREATE TABLE)`);
        continue;
      }
      for (const col of ['draft_logo_crop', 'published_logo_crop']) {
        if (await columnExists(conn, table, col)) {
          console.log(`${table}.${col}: already exists, skipping`);
        } else {
          await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} JSON NULL`);
          console.log(`${table}: added column ${col}`);
        }
      }
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
