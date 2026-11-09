// Release 165: creates lesson_favorites and game_favorites, the lessons and games a signed-in site user has starred.
// Safe to run twice: skips a table that already exists. Run it BEFORE restarting the Node app, because the new route reads both tables.
// Run (cPanel Terminal, nodevenv active, from /home/fixernat/repositories/fixernation/server):  node scripts/alter-add-lesson-game-favorites.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

const TABLES = {
  lesson_favorites: `
    CREATE TABLE lesson_favorites (
      site_user_id INT UNSIGNED NOT NULL,
      curriculum_id INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (site_user_id, curriculum_id),
      KEY idx_lesson_fav_curriculum (curriculum_id),
      FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
      FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  game_favorites: `
    CREATE TABLE game_favorites (
      site_user_id INT UNSIGNED NOT NULL,
      game_id INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (site_user_id, game_id),
      KEY idx_game_fav_game (game_id),
      FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES brain_games(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const [name, ddl] of Object.entries(TABLES)) {
    if (await tableExists(conn, name)) {
      console.log(`Skipped (already exists): ${name}`);
    } else {
      await conn.query(ddl);
      console.log(`Created table: ${name}`);
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
