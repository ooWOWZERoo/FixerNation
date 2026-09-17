// Tune Your Brain catalog scaling — populates brain_games.band for the 8
// new games, using each game's own already-chosen default band (the
// `band = params.get('band') || 'X'` line in its brain-{slug}.html file)
// so the stored value matches what the page actually renders by default.
// The 6 legacy games are deliberately left NULL — see
// alter-add-brain-games-band.js's header comment.
//
// Safe to re-run: idempotent UPDATE, always sets the same values.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const BANDS = {
  'sound-safari': 'discover',
  'reading-detective': 'explore',
  'choice-quest': 'explore',
  'decision-point': 'challenge',
  'headline': 'challenge',
  'money-moves': 'challenge',
  'money-matters': 'advance',
  'critical-read': 'advance',
};

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  for (const [slug, band] of Object.entries(BANDS)) {
    const [result] = await conn.query('UPDATE brain_games SET band=? WHERE slug=?', [band, slug]);
    if (result.affectedRows) {
      console.log(`Set ${slug} -> ${band}`);
    } else {
      console.warn(`Warning: no brain_games row found for slug '${slug}'`);
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
