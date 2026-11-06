// Release 137 - prints the grade band x focus grid from lib/brain-game-focus.js (no database needed) and lists every cell under
// the owner's minimum of two games. Run it after adding or changing a game; the same data feeds server/test/game-focus.test.js.
//   node server/scripts/focus-coverage.js
// A game marked `pending` is listed in brackets and not counted (its own-self step is not built yet).
const { coverage, gaps, FOCUSES, FOCUS_LABELS, BANDS, GAMES, MIN_PER_CELL } = require('../lib/brain-game-focus');

const grid = coverage();
console.log(`Games in the table: ${Object.keys(GAMES).length}. Minimum per cell: ${MIN_PER_CELL}.\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('', 11) + FOCUSES.map((f) => pad(FOCUS_LABELS[f].slice(0, 13), 15)).join(''));
for (const b of BANDS) {
  console.log(pad(b, 11) + FOCUSES.map((f) => {
    const c = grid[b][f];
    return pad(`${c.counted.length}${c.pending.length ? ` (+${c.pending.length})` : ''}`, 15);
  }).join(''));
}
const g = gaps();
console.log(`\nCells under ${MIN_PER_CELL}: ${g.length} (games missing: ${g.reduce((n, c) => n + c.missing, 0)})`);
for (const c of g) console.log(`  ${c.band} / ${FOCUS_LABELS[c.focus]}: have ${c.have}${c.pending ? `, ${c.pending} pending` : ''}, missing ${c.missing}`);
