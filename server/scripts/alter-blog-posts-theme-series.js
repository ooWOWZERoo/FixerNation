const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function run() {
  const cols = [
    { name: 'theme',  def: 'VARCHAR(255) NULL AFTER title' },
    { name: 'series', def: 'VARCHAR(255) NULL AFTER theme' },
  ];
  for (const col of cols) {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = ?`,
      [col.name]
    );
    if (rows.length) {
      console.log(`blog_posts.${col.name} already exists — skipping`);
    } else {
      await pool.query(`ALTER TABLE blog_posts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`Added blog_posts.${col.name}`);
    }
  }
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
