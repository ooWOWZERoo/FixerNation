require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 159: adds classrooms.keepsake_enabled (My Graduate Portrait tier 2; docs/reference/graduate-portrait-requirements.md section 5).
// 1 = students and linked parents may open and print the end-of-year Graduate Portrait keepsake (the default), 0 = the teacher turned it
// off for this class. Idempotent. Run it BEFORE restarting the Node app: the keepsake routes read the column.
// (classrooms is created by alter-classroom.js, not schema.sql, so there is no schema.sql change.)
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'classrooms' AND COLUMN_NAME = 'keepsake_enabled'`,
    [process.env.DB_NAME]);
  if (cols.length) console.log('Skipped: classrooms.keepsake_enabled already exists.');
  else {
    try {
      await connection.query('ALTER TABLE classrooms ADD COLUMN keepsake_enabled TINYINT(1) NOT NULL DEFAULT 1');
      console.log('Added classrooms.keepsake_enabled (default 1).');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') console.log('Skipped: classrooms.keepsake_enabled already exists.');
      else throw err;
    }
  }
  await connection.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
