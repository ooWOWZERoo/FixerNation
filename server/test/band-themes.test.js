// Contrast checks for the four Learning Group color themes in brain-games.css (Release 85).
// Reads the html[data-band="..."] .game-frame blocks and checks every text pair at 4.5 to 1 and every outline,
// button and accent pair at 3 to 1 (WCAG 2.2 AA), so a later edit cannot quietly make a band unreadable.
// Also proves the page without a band keeps its original colors.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'brain-games.css'), 'utf8');
const BANDS = ['discover', 'explore', 'challenge', 'advance'];

function block(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i >= 0, `missing block ${selector}`);
  return css.slice(i + selector.length + 2, css.indexOf('}', i));
}
function vars(text) {
  const out = {};
  for (const m of text.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const root = vars(block(':root'));
function theme(band) { return Object.assign({}, root, vars(block(`html[data-band="${band}"] .game-frame`))); }

function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hexes = (value) => (value.match(/#[0-9a-fA-F]{6}/g) || []);

test('every band sets every color hook explicitly (no reliance on a default that resolves at :root)', () => {
  const hooks = Object.keys(root).filter((k) => k.startsWith('--g-'));
  assert.ok(hooks.length >= 30, 'expected the full set of --g- hooks');
  for (const band of BANDS) {
    const own = vars(block(`html[data-band="${band}"] .game-frame`));
    for (const h of hooks) assert.ok(own[h] !== undefined, `${band} does not set ${h}`);
  }
});

for (const band of BANDS) {
  test(`${band}: text pairs reach 4.5 to 1`, () => {
    const t = theme(band);
    const pairs = [
      ['ink on panel', t['--ink'] || root['--ink'], t['--g-panel']],
      ['muted on panel', t['--ink-soft'], t['--g-panel']],
      ['muted on page', t['--ink-soft'], t['--g-page']],
      ['muted on soft surface', t['--ink-soft'], t['--cream-soft']],
      ['ink on soft surface', t['--ink'], t['--cream-soft']],
      ['button text on button', t['--g-btn-fg'], t['--g-btn-bg']],
      ['button text on hover', t['--g-btn-fg'], t['--g-btn-bg-hover']],
      ['step label (accent) on panel', t['--g-accent'], t['--g-panel']],
      ['selected text on selected tile', t['--g-sel-text'], t['--g-sel-bg']],
      ['correct text on correct bg', t['--g-ok-text'], t['--g-ok-bg']],
      ['partial text on partial bg', t['--g-partial-text'], t['--g-partial-bg']],
      ['wrong text on wrong bg', t['--g-bad-text'], t['--g-bad-bg']],
      ['banner text on banner', t['--g-banner-fg'], hexes(t['--g-banner-bg'])[0]],
      ['disabled text on disabled tile', t['--g-disabled-text'], t['--g-disabled-bg']],
      ['evidence highlight text on gold', '#2A2420', '#EBA657'],
      ['outline-button hover text', t['--g-outline-btn-hover-fg'], t['--g-outline-btn-hover-bg']],
    ];
    for (const [name, fg, bg] of pairs) {
      assert.ok(fg && bg, `${band}: missing color for ${name}`);
      const r = ratio(fg, bg);
      assert.ok(r >= 4.5, `${band}: ${name} is ${r.toFixed(2)} (${fg} on ${bg}), needs 4.5`);
    }
  });

  test(`${band}: outlines, accents and score reach 3 to 1`, () => {
    const t = theme(band);
    const pairs = [
      ['idle outline on tile', t['--g-outline'], t['--g-choice-bg']],
      ['idle outline on panel', t['--g-outline'], t['--g-panel']],
      ['selected outline on panel', t['--g-sel-border'], t['--g-panel']],
      ['correct outline on panel', t['--g-ok-border'], t['--g-panel']],
      ['partial outline on panel', t['--g-partial-border'], t['--g-panel']],
      ['wrong outline on panel', t['--g-bad-border'], t['--g-panel']],
      ['hover outline on panel', t['--g-outline-hover'], t['--g-panel']],
      ['button on panel (or its own border)', t['--g-btn-border'] === 'none' ? t['--g-btn-bg'] : hexes(t['--g-btn-border'])[0], t['--g-panel']],
      ['progress fill start on soft track', hexes(t['--g-progress'])[0], t['--cream-soft']],
    ];
    for (const [name, a, b] of pairs) {
      assert.ok(a && b, `${band}: missing color for ${name}`);
      const r = ratio(a, b);
      assert.ok(r >= 3, `${band}: ${name} is ${r.toFixed(2)} (${a} on ${b}), needs 3`);
    }
    for (const stop of hexes(t['--g-score'])) {
      const r = ratio(stop, t['--g-panel']);
      assert.ok(r >= 3, `${band}: score gradient stop ${stop} is ${r.toFixed(2)} on the panel, needs 3`);
    }
  });
}

test('the page without a band keeps the original colors (legacy games and the catalog are unchanged)', () => {
  assert.equal(root['--g-panel'], '#fff');
  assert.equal(root['--g-btn-bg'], '#F26B4D');
  assert.equal(root['--g-btn-fg'], '#fff');
  assert.equal(root['--g-ok-bg'], '#f0fdf4');
  assert.equal(root['--g-bad-bg'], '#fef2f2');
  assert.equal(root['--g-outline'], 'rgba(22,79,74,0.15)');
  // no band theme rule leaks outside .game-frame under a band attribute
  assert.ok(!/html\[data-band="[a-z]+"\] \.btn-primary/.test(css.slice(css.indexOf('Band color themes'))));
});

test('only the four bands have a theme, and only on .game-frame', () => {
  const found = [...css.matchAll(/html\[data-band="(\w+)"\] \.game-frame \{/g)].map((m) => m[1]).sort();
  assert.deepEqual(found, [...BANDS].sort());
});

test('the branching engine step label follows the band accent, and every page that loads it has the new version', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'engine-branching-scenario.js'), 'utf8');
  assert.match(engine, /color:var\(--g-accent, var\(--coral\)\)/);
  const root2 = path.join(__dirname, '..', '..');
  for (const f of fs.readdirSync(root2).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root2, f), 'utf8');
    if (/<script[^>]+engine-branching-scenario\.js/.test(html)) assert.match(html, /engine-branching-scenario\.js\?v=4/, `${f} still loads an old engine version`);
    if (/<link[^>]+brain-games\.css/.test(html)) assert.match(html, /brain-games\.css\?v=3/, `${f} still loads the old stylesheet`);
  }
});
