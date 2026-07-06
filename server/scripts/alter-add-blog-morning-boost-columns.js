require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

const NEW_COLUMNS = [
  ['alt_text', 'ALTER TABLE blog_posts ADD COLUMN alt_text VARCHAR(255)'],
  ['meta_description', 'ALTER TABLE blog_posts ADD COLUMN meta_description VARCHAR(500)'],
  ['focus_keyword', 'ALTER TABLE blog_posts ADD COLUMN focus_keyword VARCHAR(255)'],
  ['requires_membership', 'ALTER TABLE blog_posts ADD COLUMN requires_membership TINYINT(1) NOT NULL DEFAULT 0'],
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // blog_post_categories/morning_boost_calendar are brand-new tables —
  // migrate.js's CREATE TABLE IF NOT EXISTS already handles those. This
  // script covers the new columns on the pre-existing blog_posts table,
  // plus backfilling blog_post_categories from each post's current single
  // `category` value so every existing post keeps showing up under its
  // category once the public blog page switches to the multi-category set.

  for (const [column, sql] of NEW_COLUMNS) {
    if (await columnExists(connection, 'blog_posts', column)) {
      console.log(`Skipped (already exists): blog_posts.${column}`);
    } else {
      await connection.query(sql);
      console.log(`Added column: blog_posts.${column}`);
    }
  }

  const [posts] = await connection.query('SELECT id, category FROM blog_posts');
  let backfilled = 0;
  for (const post of posts) {
    const [existing] = await connection.query(
      'SELECT id FROM blog_post_categories WHERE post_id = ? AND category = ?',
      [post.id, post.category]
    );
    if (existing.length) continue;
    await connection.query('INSERT INTO blog_post_categories (post_id, category) VALUES (?, ?)', [post.id, post.category]);
    backfilled++;
  }
  console.log(`Backfilled blog_post_categories for ${backfilled} post(s) (of ${posts.length} total).`);

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
