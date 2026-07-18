/**
 * One-time migration: strips the "Series: " prefix from curriculum titles
 * and moves it into the series column.
 *
 * Before: title="2D Identity: Who Am I?"  series=""
 * After:  title="Who Am I?"               series="2D Identity"
 *
 * Rules:
 *   - Only processes rows whose title contains ":"
 *   - If series is already populated, keeps it (does not overwrite)
 *   - Always strips the prefix from title regardless of series state
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');

async function main() {
  const [rows] = await pool.query('SELECT id, title, series FROM curricula ORDER BY id');
  console.log(`Found ${rows.length} curricula rows.\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const m = row.title.match(/^([^:]+):\s*(.+)$/s);
    if (!m) {
      console.log(`[skip]   id=${row.id} — no colon: "${row.title}"`);
      skipped++;
      continue;
    }

    const prefix    = m[1].trim();
    const remainder = m[2].trim();
    const newSeries = (row.series && row.series.trim()) ? row.series.trim() : prefix;
    const newTitle  = remainder;

    console.log(`[update] id=${row.id}`);
    console.log(`         title:  "${row.title}" → "${newTitle}"`);
    console.log(`         series: "${row.series || ''}" → "${newSeries}"`);

    await pool.query('UPDATE curricula SET title = ?, series = ? WHERE id = ?', [newTitle, newSeries, row.id]);
    updated++;
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped} (no colon in title).`);
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
