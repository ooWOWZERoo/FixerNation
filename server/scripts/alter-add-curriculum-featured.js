// Adds curricula.is_featured — replaces the old hardcoded title-string match
// in education-portal.html's getFeaturedCurriculum() with a real admin toggle.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  if (await columnExists(connection, 'curricula', 'is_featured')) {
    console.log('Skipped (already exists): curricula.is_featured');
  } else {
    await connection.query('ALTER TABLE curricula ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER published');
    console.log('Added column: curricula.is_featured');

    // One-time backfill so the site doesn't lose its current spotlight the
    // moment this deploys — matches whatever getFeaturedCurriculum() would
    // have matched by title before this migration existed.
    const [result] = await connection.query(
      "UPDATE curricula SET is_featured = 1 WHERE title LIKE '%Take Responsibility for Your Growth%' LIMIT 1"
    );
    console.log(`Backfilled is_featured on ${result.affectedRows} existing curriculum (matched by the old hardcoded title).`);
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
