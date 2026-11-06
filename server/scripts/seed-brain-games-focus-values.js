// Release 137 - writes brain_games.focus for every game from lib/brain-game-focus.js, and the few related corrections the
// regroup needs: Number Sequence's domain executive -> math, Quick Math's band challenge -> explore, and the final
// casel_competencies list for the SEL games (The Post drops self_management and gains responsible_decision_making; Feelings Detective
// gains social_awareness; Values Compass, Idea Lab and Fix-It Workshop lose the competencies they do not train).
// Run alter-add-brain-games-focus.js first. Prints every active game that still has no focus and exits non-zero if there is one.
//
// Safe to re-run: it only writes rows that differ.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { applyFocus, gaps, FOCUS_LABELS } = require('../lib/brain-game-focus');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const r = await applyFocus(conn);
  await conn.end();

  console.log(`focus set on ${r.focus.length}: ${r.focus.join(', ') || '-'}`);
  console.log(`domain changed on ${r.domain.length}: ${r.domain.join(', ') || '-'}`);
  console.log(`band changed on ${r.band.length}: ${r.band.join(', ') || '-'}`);
  console.log(`competencies changed on ${r.casel.length}: ${r.casel.join(', ') || '-'}`);
  if (r.missing.length) console.warn(`WARNING: no brain_games row for: ${r.missing.join(', ')}`);
  if (r.noFocus.length) { console.warn(`WARNING: active games with NO focus: ${r.noFocus.join(', ')}`); process.exitCode = 1; }
  else console.log('Every active game has a focus.');

  const g = gaps();
  console.log(`\nCells under two games (pending games not counted): ${g.length}`);
  for (const c of g) console.log(`  ${c.band} / ${FOCUS_LABELS[c.focus]}: ${c.have} (+${c.pending} pending), missing ${c.missing}`);
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
