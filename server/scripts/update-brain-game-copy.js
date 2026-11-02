// Release 89: replaces the internal-sounding card descriptions on the games page with plain ones, and gives the six older
// games a grade band (Memory Match and Simon Sequence = Explore; Number Sequence, Quick Math, Reaction Time and Stroop
// Challenge = Challenge). Wording and bands live in server/lib/brain-game-copy.js.
// Safe to run twice: it only writes rows whose description or band differs, and prints what it changed.
// Run (cPanel Terminal, nodevenv active, from /home/fixernat/repositories/fixernation/server):  node scripts/update-brain-game-copy.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { applyCopy } = require('../lib/brain-game-copy');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const changed = await applyCopy(conn);
  console.log(`Descriptions updated: ${changed.descriptions.length}${changed.descriptions.length ? ' (' + changed.descriptions.join(', ') + ')' : ''}`);
  console.log(`Bands set: ${changed.bands.length}${changed.bands.length ? ' (' + changed.bands.join(', ') + ')' : ''}`);
  if (changed.missing.length) console.warn('No catalog row for: ' + changed.missing.join(', '));
  await conn.end();
  console.log('Done.');
}
main().catch((e) => { console.error(e); process.exit(1); });
