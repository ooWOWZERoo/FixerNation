// Adds non-destructive crop/reposition storage to school_branding — a crop
// rect (pixel {x,y,width,height} within the ORIGINAL uploaded image) is kept
// separately for draft/published, mirroring the existing draft/published
// snapshot-pair pattern the rest of this table already uses. Re-running the
// crop tool always starts from the untouched original; these columns are
// what lets that be re-opened and re-edited rather than being a one-shot
// client-side crop.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

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
    for (const col of ['draft_logo_crop', 'published_logo_crop']) {
      if (await columnExists(conn, 'school_branding', col)) {
        console.log(`school_branding.${col}: already exists, skipping`);
      } else {
        await conn.query(`ALTER TABLE school_branding ADD COLUMN ${col} JSON NULL`);
        console.log(`school_branding: added column ${col}`);
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
