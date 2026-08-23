// Fixes: DELETE /api/blog/posts/:id doesn't cascade to
// morning_boost_calendar.blog_post_id, leaving a dangling reference on that
// calendar day if a linked post is ever deleted via admin-blogs.html.
//
// server/db/schema.sql already declares the correct constraint —
// `FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE SET NULL`
// — but schema.sql only ever creates brand-new tables (CREATE TABLE IF NOT
// EXISTS is a no-op on an existing table), so the live morning_boost_calendar
// table almost certainly predates that line and never actually got the
// constraint. This adds it directly, so the database itself keeps this
// consistent going forward — not just the one DELETE route, but any future
// code path that deletes a blog_posts row.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function fkExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (await fkExists(conn, 'morning_boost_calendar', 'blog_post_id')) {
      console.log('Skipped (already exists): FK on morning_boost_calendar.blog_post_id');
      return;
    }
    await conn.query(
      'ALTER TABLE morning_boost_calendar ADD FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE SET NULL'
    );
    console.log('Added FK: morning_boost_calendar.blog_post_id -> blog_posts(id) ON DELETE SET NULL');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
