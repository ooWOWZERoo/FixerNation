// Tune Your Brain catalog scaling — adds brain_games.band so the assign-
// game UI (teacher-classroom.html) can filter the catalog to a classroom's
// grade level by default, per roadmap §6.3 ("grade bands are defaults, not
// ability labels — teachers may override presentation when appropriate").
//
// Nullable: the 6 legacy games were designed band-agnostic (no single
// experience band was ever chosen for them), so they stay NULL, meaning
// "show for every band" rather than forcing a false default. Values for
// the 8 new games are populated separately by
// seed-brain-games-band-values.js.
//
// Safe to re-run: skipped if the column already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [existing] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
    [process.env.DB_NAME, 'brain_games', 'band']
  );

  if (existing.length) {
    console.log('Skipped: brain_games.band already exists');
  } else {
    await conn.query(
      `ALTER TABLE brain_games
         ADD COLUMN band ENUM('discover','explore','challenge','advance') NULL`
    );
    console.log('Added: brain_games.band');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
