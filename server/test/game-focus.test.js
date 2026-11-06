// Release 137: every game has exactly one focus (five SEL competencies, or literacy / math / thinking), the list is complete,
// the tags agree with the seed scripts and the pages, the games page and the teacher's assign list offer the same eight focuses,
// the one-off scripts are safe to run twice, and Reaction Time's STOP rounds follow their rules.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require(path.join(__dirname, '..', 'lib', 'brain-game-focus.js'));
const copy = require(path.join(__dirname, '..', 'lib', 'brain-game-copy.js'));
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOT_GAMES = new Set(['games', 'games-progress', 'badges']);

const pages = fs.readdirSync(ROOT).filter((f) => /^brain-.+\.html$/.test(f)).map((f) => f.slice(6, -5)).filter((s) => !NOT_GAMES.has(s));
const seedDir = path.join(__dirname, '..', 'scripts');
const seeded = fs.readdirSync(seedDir).filter((f) => /^seed-.+-catalog-entry\.js$/.test(f)).map((f) => f.slice(5, -'-catalog-entry.js'.length));
const LEGACY = ['memory-match', 'reaction-time', 'simon-sequence', 'stroop-challenge', 'quick-math', 'number-sequence'];
const slugs = Object.keys(F.GAMES);

test('FOCUS: no game is left out (focus table = game pages = catalog scripts)', () => {
  assert.equal(slugs.length, 31);
  assert.deepEqual([...slugs].sort(), [...pages].sort(), 'every brain-*.html game page has a focus, and every focus row has a page');
  assert.deepEqual([...slugs].sort(), [...seeded, ...LEGACY].sort(), 'every catalog entry has a focus');
});

test('FOCUS: every game has one valid focus, band and domain, and the domain agrees with the focus', () => {
  const DOMAIN_FOR_SKILL = { literacy: 'literacy', math: 'math', thinking: 'executive' };
  for (const [slug, g] of Object.entries(F.GAMES)) {
    assert.ok(F.FOCUSES.includes(g.focus), `${slug} focus ${g.focus}`);
    assert.ok(F.BANDS.includes(g.band), `${slug} band ${g.band}`);
    if (F.SEL_FOCUSES.includes(g.focus)) {
      assert.equal(g.domain, 'sel', `${slug} is an SEL game, so domain sel`);
      assert.ok(Array.isArray(g.casel) && g.casel.length >= 1, `${slug} lists its competencies`);
      assert.ok(g.casel.includes(g.focus), `${slug}: the focus ${g.focus} is one of its competencies`);
      g.casel.forEach((c) => assert.ok(F.SEL_FOCUSES.includes(c), `${slug} competency ${c}`));
    } else {
      assert.equal(g.domain, DOMAIN_FOR_SKILL[g.focus], `${slug} domain for focus ${g.focus}`);
      assert.equal(g.casel, undefined, `${slug} is a skills game and has no competencies`);
    }
  }
  assert.equal(Object.values(F.GAMES).filter((g) => F.SKILL_FOCUSES.includes(g.focus)).length, 10);
});

test('FOCUS: the bands and domains agree with the catalog seed scripts and the page defaults', () => {
  for (const slug of seeded) {
    const src = read(`server/scripts/seed-${slug}-catalog-entry.js`);
    const m = src.match(/'(discover|explore|challenge|advance)', '(sel|literacy|math|executive|wellness)', '([a-z_,]+)'/);
    if (m) {
      assert.equal(F.GAMES[slug].band, m[1], `${slug} band`);
      assert.equal(F.GAMES[slug].domain, m[2], `${slug} domain`);
    }
  }
  for (const slug of slugs) {
    const page = read(`brain-${slug}.html`);
    const d = page.match(/params\.get\('band'\) \|\| '([a-z]+)'/);
    if (d) assert.equal(d[1], F.GAMES[slug].band, `${slug} page default band`);
  }
  // The six older games take their band from LEGACY_BANDS, and Quick Math moved to Explore in Release 137.
  for (const slug of LEGACY) assert.equal(F.GAMES[slug].band, copy.LEGACY_BANDS[slug], `${slug} legacy band`);
  assert.equal(copy.LEGACY_BANDS['quick-math'], 'explore');
  assert.equal(F.GAMES['number-sequence'].focus, 'math');
  assert.match(read('server/scripts/seed-brain-games-domain-values.js'), /'number-sequence': 'math'/);
});

test('FOCUS: the owner\'s decisions are in the table', () => {
  assert.equal(F.GAMES['the-post'].focus, 'responsible_decision_making');
  assert.ok(!F.GAMES['the-post'].casel.includes('self_management'), 'The Post does not train self-management');
  assert.ok(F.GAMES['feelings-detective'].casel.includes('social_awareness'));
  assert.ok(!F.GAMES['values-compass'].casel.includes('responsible_decision_making'));
  assert.deepEqual(F.GAMES['idea-lab'].casel, ['responsible_decision_making']);
  assert.deepEqual(F.GAMES['fix-it-workshop'].casel, ['responsible_decision_making']);
  assert.equal(F.GAMES['money-moves'].focus, 'self_management');
  assert.equal(F.GAMES['money-matters'].focus, 'self_management');
  // Strict counting: only the game whose own-self step is not built yet is pending (Feelings Detective).
  assert.deepEqual(Object.keys(F.GAMES).filter((s) => F.GAMES[s].pending).sort(), ['feelings-detective']); // Strength Spotter and Values Compass got their Your turn finale in Release 138
});

test('FOCUS: the coverage grid counts every game once and leaves pending games out', () => {
  const grid = F.coverage();
  let counted = 0, pending = 0;
  for (const b of F.BANDS) for (const f of F.FOCUSES) { counted += grid[b][f].counted.length; pending += grid[b][f].pending.length; }
  assert.equal(counted + pending, 31);
  assert.equal(pending, 1);
  assert.deepEqual(grid.challenge.thinking.counted.sort(), ['reaction-time', 'stroop-challenge']);
  assert.deepEqual(grid.explore.math.counted, ['quick-math']);
  assert.deepEqual(grid.challenge.math.counted, ['number-sequence']);
  for (const c of F.gaps()) assert.ok(c.missing >= 1 && c.missing <= F.MIN_PER_CELL && c.have + c.missing === F.MIN_PER_CELL);
});

test('FOCUS: the games page and the teacher assign list offer the same eight focuses as the table', () => {
  const page = read('brain-games.html');
  for (const f of F.FOCUSES) {
    assert.ok(page.includes(`${f}: '${F.FOCUS_LABELS[f]}'`), `games page label for ${f}`);
    assert.ok(page.includes(F.FOCUS_HELP[f].replace(/'/g, "'")), `games page help for ${f}`);
  }
  assert.ok(!/wellness|Wellness/.test(page), 'no Wellness chip or badge');
  assert.match(page, /g\.focus === activeFocus/);
  assert.match(page, /id="selChips"/); assert.match(page, /id="skillChips"/);
  const teacher = read('teacher-classroom.html');
  for (const f of F.FOCUSES) assert.match(teacher, new RegExp(`<option value="${f}">${F.FOCUS_LABELS[f].replace(/[-]/g, '\\-')}</option>`), `teacher option ${f}`);
  assert.match(teacher, /games\.filter\(function\(g\)\{ return g\.focus === focus; \}\)/);
});

test('FOCUS: the catalog API returns focus, the static fallback has it, and the schema and alter script define the column', () => {
  const route = read('server/routes/brain-games.js');
  assert.match(route, /focus: g\.focus \|\| null/);
  for (const slug of LEGACY) assert.match(route, new RegExp(`slug:'${slug}', band:'${F.GAMES[slug].band}', focus:'${F.GAMES[slug].focus}'`), `static ${slug}`);
  const enumList = F.FOCUSES.map((f) => `'${f}'`).join(',');
  assert.ok(read('server/db/schema.sql').includes(`focus ENUM(${enumList}) NULL`), 'schema.sql');
  const alter = read('server/scripts/alter-add-brain-games-focus.js');
  assert.ok(alter.includes(`ADD COLUMN focus ENUM(${enumList}) NULL`));
  assert.match(alter, /ER_DUP_FIELDNAME/); assert.match(alter, /information_schema\.COLUMNS/);
});

// A tiny in-memory stand-in for the brain_games table.
function fakeDb(rows) {
  return {
    async query(sql, p) {
      if (/^SELECT id FROM brain_games WHERE slug/.test(sql)) return [rows[p[0]] ? [{ id: 1 }] : []];
      if (/^SELECT slug FROM brain_games WHERE active = 1 AND focus IS NULL/.test(sql)) return [Object.keys(rows).filter((s) => rows[s].active !== 0 && !rows[s].focus).map((slug) => ({ slug }))];
      const m = sql.match(/^UPDATE brain_games SET (focus|domain|band|casel_competencies) = \?/);
      if (m) { const [val, slug] = p, r = rows[slug], col = m[1]; if (r && r[col] !== val) { r[col] = val; return [{ affectedRows: 1 }]; } return [{ affectedRows: 0 }]; }
      throw new Error('unexpected sql ' + sql);
    },
  };
}

test('FOCUS: the seed script logic sets every game, changes nothing on a second run, and reports a game with no focus', async () => {
  const rows = {};
  for (const slug of slugs) rows[slug] = { focus: null, domain: slug === 'number-sequence' ? 'executive' : F.GAMES[slug].domain, band: slug === 'quick-math' ? 'challenge' : F.GAMES[slug].band, casel_competencies: null };
  rows['hand-added-game'] = { focus: null, domain: 'sel', band: 'explore' };
  const first = await F.applyFocus(fakeDb(rows));
  assert.equal(first.focus.length, 31);
  assert.deepEqual(first.domain, ['number-sequence']);
  assert.deepEqual(first.band, ['quick-math']);
  assert.equal(first.casel.length, 21);
  assert.deepEqual(first.noFocus, ['hand-added-game'], 'a game added by hand with no focus is reported');
  assert.equal(rows['the-post'].casel_competencies, 'social_awareness,relationship_skills,responsible_decision_making');
  delete rows['hand-added-game'];
  const second = await F.applyFocus(fakeDb(rows));
  assert.deepEqual([second.focus, second.domain, second.band, second.casel, second.missing, second.noFocus], [[], [], [], [], [], []]);
  const script = read('server/scripts/seed-brain-games-focus-values.js');
  assert.match(script, /process\.exitCode = 1/);
});

test('REACTION TIME: STOP rounds are extra, never first, never back to back, and only go times are scored', () => {
  const src = read('brain-reaction-time.html');
  const fn = src.match(/function buildTrials\(diff\) \{[\s\S]*?\n\}\n/)[0];
  const ctx = vm.createContext({ Math, GO_ROUNDS: 5, NOGO_COUNT: { easy: 1, medium: 2, hard: 3 }, out: null });
  vm.runInContext(fn + '\nout = buildTrials;', ctx);
  for (const [diff, n] of [['easy', 1], ['medium', 2], ['hard', 3]]) {
    for (let i = 0; i < 300; i++) {
      const t = ctx.out(diff);
      assert.equal(t.length, 5 + n);
      assert.equal(t.filter((x) => x === 'go').length, 5, 'always 5 green rounds');
      assert.equal(t.filter((x) => x === 'stop').length, n);
      assert.equal(t[0], 'go', 'first round is never a STOP sign');
      for (let k = 1; k < t.length; k++) assert.ok(!(t[k] === 'stop' && t[k - 1] === 'stop'), 'no two STOP signs in a row');
    }
  }
  // Scoring and badges still read only the green-round times and the false starts; the new counts are extra metrics.
  assert.match(src, /validTimes\.push\(rt\)/);
  assert.match(src, /metrics: \{ validTimes, falseStarts, noGoTrials: noGoHeld \+ noGoErrors, noGoErrors \}/);
  assert.match(src, /'Top tier'/); assert.match(src, /False start\. Wait for green\./);
  // The STOP sign differs by word and shape, not only colour.
  assert.match(src, /STOP: do not tap/); assert.match(src, /\.rt-target\.stop\s*\{[^}]*border-radius: 28px/);
  assert.ok(!/TOTAL_ROUNDS/.test(src));
  const calc = read('server/routes/brain-games.js');
  assert.match(calc, /const times = metrics\.validTimes \|\| \[\];/);
});
