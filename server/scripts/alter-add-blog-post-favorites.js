// Release 91: creates blog_post_favorites, the posts a signed-in site user has starred on the Morning Boost (and any future blog) page.
// Safe to run twice: skips if the table already exists. Run it BEFORE restarting the Node app, because the new route reads the table.
// Run (cPanel Terminal, nodevenv active, from /home/fixernat/repositories/fixernation/server):  node scripts/alter-add-blog-post-favorites.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  if (await tableExists(conn, 'blog_post_favorites')) {
    console.log('Skipped (already exists): blog_post_favorites');
  } else {
    await conn.query(`
      CREATE TABLE blog_post_favorites (
        site_user_id INT UNSIGNED NOT NULL,
        post_id INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (site_user_id, post_id),
        KEY idx_blog_fav_post (post_id),
        FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: blog_post_favorites');
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
