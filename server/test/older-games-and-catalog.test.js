// Release 89: the 13 Challenge and Advance games keep to the line rules (no dashes, no praise openers, no soothing lines, distinct headers),
// the older games and the games page speak plainly, the catalog copy script is safe and idempotent, and the step count covers Challenge and Advance.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lines = require(path.join(__dirname, '..', 'scripts', 'older-games-lines.js'));
const copy = require(path.join(__dirname, '..', 'lib', 'brain-game-copy.js'));
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

for (const slug of lines.GAMES) {
  test(`OLDER GAMES ${slug}: no dashes, no praise openers, no soothing lines`, () => {
    const bad = lines.check(slug);
    assert.deepEqual(bad, [], bad.join('\n'));
  });
}

test('OLDER GAMES: every game has its own header and no header repeats the old template', () => {
  const heads = lines.GAMES.map((g) => lines.header(g));
  heads.forEach((h, i) => assert.ok(h && h.length > 20, `${lines.GAMES[i]} has a header`));
  assert.equal(new Set(heads).size, heads.length, 'headers are all different');
  heads.forEach((h) => assert.ok(!/^Work through what/.test(h), `old template header: ${h}`));
});

test('MONEY MOVES: the three young events now read for 11-13 with the same numbers', () => {
  const src = read('brain-money-moves.html');
  assert.ok(!/lunch box|cartoon one|toys and books|A \$20 toy/i.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
  assert.match(src, /phone case cracked/); assert.match(src, /pair of headphones is 30 percent off, so it costs \$14/); assert.match(src, /old clothes and games/);
  assert.match(src, /short of the goal/); assert.ok(!/that is normal/i.test(src));
  assert.ok(!/that is normal/i.test(read('brain-money-matters.html')));
});

test('VALUES COMPASS: the prompts sound like Challenge, not Explore', () => {
  const src = read('brain-values-compass.html');
  assert.ok(!/Good noticing|I've noticed these|I've picked my values/.test(src));
  assert.match(src, /These are my clues/); assert.match(src, /These are my values/);
});

test('STEP COUNT: Explore and Challenge show "Step 2 of 5", Advance a quiet "2 / 5", Discover nothing', () => {
  const shell = read('game-shell.js');
  assert.match(shell, /\['explore', 'challenge'\]\.includes\(getBand\(\)\)/);
  assert.match(shell, /getBand\(\) === 'advance' \? `<span class="fn-progress-count" aria-hidden="true">\$\{current\} \/ \$\{total\}/);
});

test('LEGACY GAMES: plain result lines, no dashes in their text, and "End game" instead of "Give Up"', () => {
  assert.ok(!/Wrong! Game over/.test(read('brain-simon-sequence.html')));
  assert.match(read('brain-simon-sequence.html'), /Not that one\. You reached round/);
  const rt = read('brain-reaction-time.html');
  assert.ok(!/Lightning fast|Nice!|🙂/.test(rt)); assert.match(rt, /'Top tier'/); assert.match(rt, /False start\. Wait for green\./);
  assert.match(read('brain-memory-match.html'), />End game</); assert.ok(!/>Give Up</.test(read('brain-memory-match.html')));
  for (const g of ['memory-match', 'simon-sequence', 'number-sequence', 'quick-math', 'reaction-time', 'stroop-challenge']) {
    const bad = lines.visibleStrings(read(`brain-${g}.html`)).filter((t) => /[—–]| - /.test(t));
    assert.deepEqual(bad, [], `${g} has dashed strings`);
  }
  const stroop = read('brain-stroop-challenge.html');
  assert.ok(!/word says —|— not what the word reads/.test(stroop));
});

test('CATALOG COPY: plain descriptions for all 25 games, nothing internal, nothing dashed', () => {
  const entries = Object.entries(copy.DESCRIPTIONS);
  assert.equal(entries.length, 25);
  entries.forEach(([slug, d]) => {
    assert.ok(d.length >= 40 && d.length <= 120, `${slug}: ${d.length} characters`);
    assert.ok(!/Tune Your Brain|Phase 5|pilot|experience|Issues-to-Answers/i.test(d), `${slug}: internal wording`);
    assert.ok(!/[—–]| - /.test(d), `${slug}: dash`);
    assert.ok(/[.?]$/.test(d), `${slug}: ends with a full stop`);
  });
  assert.deepEqual(copy.LEGACY_BANDS, { 'memory-match': 'explore', 'simon-sequence': 'explore', 'number-sequence': 'challenge', 'quick-math': 'challenge', 'reaction-time': 'challenge', 'stroop-challenge': 'challenge' });
});

test('CATALOG COPY: the seed scripts say the same thing, so a fresh install matches production', () => {
  for (const [slug, d] of Object.entries(copy.DESCRIPTIONS)) {
    const src = read(`server/scripts/seed-${slug}-catalog-entry.js`);
    assert.ok(src.includes(d.replace(/'/g, "\\'")), `seed-${slug}-catalog-entry.js has the new description`);
  }
  const bands = read('server/scripts/seed-brain-games-band-values.js');
  assert.match(bands, /\.\.\.LEGACY_BANDS/);
});

// A tiny stand-in database: rows keyed by slug, supporting only the three statements applyCopy uses.
function fakeDb(rows) {
  return {
    async query(sql, params) {
      if (/^UPDATE brain_games SET description/.test(sql)) { const [text, slug] = params; const r = rows[slug]; if (r && r.description !== text) { r.description = text; return [{ affectedRows: 1 }]; } return [{ affectedRows: 0 }]; }
      if (/^UPDATE brain_games SET band/.test(sql)) { const [band, slug] = params; const r = rows[slug]; if (r && r.band !== band) { r.band = band; return [{ affectedRows: 1 }]; } return [{ affectedRows: 0 }]; }
      if (/^SELECT id FROM brain_games/.test(sql)) return [rows[params[0]] ? [{ id: 1 }] : []];
      throw new Error('unexpected sql: ' + sql);
    },
  };
}

test('CATALOG COPY: applyCopy updates only listed games, sets legacy bands, and a second run changes nothing', async () => {
  const rows = {};
  for (const slug of Object.keys(copy.DESCRIPTIONS)) rows[slug] = { description: 'Old text. A Tune Your Brain SEL experience.', band: slug === 'team-pick' ? 'explore' : null };
  for (const slug of Object.keys(copy.LEGACY_BANDS)) rows[slug] = { description: 'Legacy text kept as is', band: null };
  rows['some-other-game'] = { description: 'Untouched', band: 'advance' };
  const first = await copy.applyCopy(fakeDb(rows));
  assert.equal(first.descriptions.length, 25);
  assert.deepEqual(first.bands.sort(), Object.keys(copy.LEGACY_BANDS).sort());
  assert.equal(rows['memory-match'].band, 'explore'); assert.equal(rows['quick-math'].band, 'challenge');
  assert.equal(rows['memory-match'].description, 'Legacy text kept as is', 'legacy descriptions are not rewritten');
  assert.deepEqual(rows['some-other-game'], { description: 'Untouched', band: 'advance' });
  assert.equal(rows['team-pick'].band, 'explore', 'bands of other games are not touched');
  const second = await copy.applyCopy(fakeDb(rows));
  assert.deepEqual([second.descriptions.length, second.bands.length], [0, 0]);
});

test('CATALOG COPY: a missing row is reported, not an error', async () => {
  const out = await copy.applyCopy(fakeDb({}));
  assert.equal(out.missing.length, 25 + 6);
});

test('GAMES PAGE: cards and tags carry the band class, and the tag colors pass contrast', () => {
  const html = read('brain-games.html');
  assert.match(html, /class="game-kind band-' \+ esc\(g\.band\)/);
  assert.match(html, /game-card\$\{g\.band \? ' band-' \+ esc\(g\.band\) : ''\}/);
  const css = read('brain-games.css');
  const lum = (h) => { const x = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [p, q] = [lum(a), lum(b)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
  for (const band of ['discover', 'explore', 'challenge', 'advance']) {
    const m = css.match(new RegExp(`\\.game-kind\\.band-${band} \\{ background: (#[0-9A-Fa-f]{6}); color: (#[0-9A-Fa-f]{6});`));
    assert.ok(m, `${band} tag colors`);
    assert.ok(ratio(m[1], m[2]) >= 4.5, `${band} tag ${ratio(m[1], m[2]).toFixed(2)}`);
    assert.match(css, new RegExp(`\\.game-card\\.band-${band} \\{ border-top-color`));
  }
});
