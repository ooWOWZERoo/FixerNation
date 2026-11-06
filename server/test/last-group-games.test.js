// Release 144: the last 12 games (content in server/scripts/core-games-last-group.js). With them every grade band x focus has at least two games.
// The sums, orders and statistics are recomputed here from the numbers in each item, so a wrong answer cannot ship. Page drift, registration and
// spoken-clip checks for every generated game are in new-games.test.js.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { GAMES } = require(path.join(__dirname, '..', 'scripts', 'build-core-games.js'));
const F = require(path.join(__dirname, '..', 'lib', 'brain-game-focus.js'));

const LAST = GAMES.filter((g) => g.release === 144);
const by = (slug) => LAST.find((g) => g.slug === slug);
const words = (s) => String(s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?]["”’]?)\s+/).filter(Boolean);
const HARD = /\b(constructive|overwhelmed|perspective|affects?|reactions?|assume[sd]?|appropriate|situation|consequences?)\b/i;
const DASH = /[—–]|\s-\s/;
const PRAISE = /^(good (catch|noticing|thinking|job)|great|nice (work|job|read)|well done|exactly|right[.,!])/i;
const SOOTHING = /\b(completely normal|that is normal|that's normal|totally normal|perfectly normal)\b/i;
const money = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));

test('LAST GROUP: twelve games, and now every grade band x focus cell has at least two games', () => {
  assert.equal(LAST.length, 12);
  assert.deepEqual(F.gaps(), [], 'cells still under two games');
  const grid = F.coverage();
  for (const b of F.BANDS) for (const f of F.FOCUSES) assert.ok(grid[b][f].counted.length >= 2, `${b} / ${f}`);
  assert.equal(Object.keys(F.GAMES).length, 67);
});

for (const slug of ['stuck-on-it', 'peer-pressure-pause', 'tone-detective', 'deadline-crunch', 'argument-check']) {
  test(`${slug.toUpperCase()}: ten items, the writing rules for its band, options of near length, and the right answer is not the longest`, () => {
    const g = by(slug), limit = g.band === 'explore' ? 12 : 20;
    assert.equal(g.pack.items.length, 10);
    assert.equal(g.pack.roundsPerRun, 5);
    const ids = new Set();
    let strictlyLongest = 0;
    g.pack.items.forEach((it, i) => {
      const at = `${slug} item ${i + 1}`;
      assert.ok(it.passage.length === 4, `${at}: four sentences`);
      assert.ok(it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length, `${at}: proof index`);
      assert.equal(it.choices.length, 3);
      it.choices.forEach((c) => { assert.ok(!ids.has(c.id), `${at}: duplicate id`); ids.add(c.id); });
      assert.ok(it.choices.some((c) => c.id === it.correctChoiceId));
      it.passage.concat([it.question, it.explanation], it.choices.map((c) => c.text)).forEach((t) => {
        assert.ok(!DASH.test(t) && !SOOTHING.test(t) && !PRAISE.test(t.trim()), `${at}: ${t}`);
        if (g.band === 'explore') assert.ok(!HARD.test(t), `${at}: hard word in "${t}"`);
        sentences(t).forEach((sn) => assert.ok(words(sn) <= limit, `${at}: ${words(sn)} words in "${sn}"`));
      });
      const len = it.choices.map((c) => c.text.length), right = it.choices.find((c) => c.id === it.correctChoiceId).text.length;
      assert.ok(Math.max(...len) / Math.min(...len) <= 1.7, `${at}: lengths ${len.join('/')}`);
      if (len.filter((x) => x >= right).length === 1) strictlyLongest++;
    });
    assert.ok(strictlyLongest <= 5, `the right answer is the longest in ${strictlyLongest} of 10 items`);
  });
}

test('SPOKEN DISCOVER GAMES (Wait for It, Stop and Think): 14 rounds, a short caption on every choice, and the right answer in every place', () => {
  for (const slug of ['wait-for-it', 'stop-and-think']) {
    const g = by(slug);
    assert.equal(g.pack.items.length, 14);
    const spots = new Set(g.pack.items.map((it) => it.choices.findIndex((c) => c.id === it.correctId)));
    assert.deepEqual([...spots].sort(), [0, 1, 2], `${slug}: right answer appears in every place`);
    g.pack.items.forEach((it) => { assert.equal(it.choices.length, 3); it.choices.forEach((c) => assert.ok(words(c.caption) <= 4, `${slug}: ${c.caption}`)); });
  }
});

test('RATIO SHOP: every price, percent and ratio answer is recomputed from the numbers in the question', () => {
  const items = by('ratio-shop').pack.items;
  assert.equal(items.length, 20);
  const kinds = { unit: 0, off: 0, ratio: 0, tip: 0 };
  items.forEach((it) => {
    const m = it.meta; kinds[m.kind]++;
    if (m.kind === 'unit') {
      assert.ok(it.stimulusText.includes(`${m.n1} `) && it.stimulusText.includes(money(m.p1)) && it.stimulusText.includes(money(m.p2)));
      const better = m.p1 / m.n1 < m.p2 / m.n2 ? 'a' : 'b';
      assert.equal(it.correctId, better, it.stimulusText);
      assert.notEqual(m.p1 / m.n1, m.p2 / m.n2, 'the two prices per item differ');
    }
    if (m.kind === 'off') { const sale = m.price * (100 - m.pct) / 100; assert.equal(it.correctId, String(sale)); assert.ok(it.stimulusText.includes(`${m.pct}%`)); }
    if (m.kind === 'ratio') { const ans = m.b * m.newA / m.a; assert.ok(Number.isInteger(ans)); assert.equal(it.correctId, String(ans)); }
    if (m.kind === 'tip') { assert.equal(it.correctId, String(m.amt * m.pct / 100)); }
    assert.equal(it.choices.length === 2 || it.choices.length === 3, true);
    assert.ok(it.choices.some((c) => c.id === it.correctId));
    assert.equal(new Set(it.choices.map((c) => c.id)).size, it.choices.length);
  });
  assert.deepEqual(kinds, { unit: 6, off: 6, ratio: 4, tip: 4 });
});

test('GRAPH MATCH: three different shapes in every round, the right one is among them, and every shape is the answer somewhere', () => {
  const items = by('graph-match').pack.items;
  assert.equal(items.length, 14);
  const answers = new Set();
  items.forEach((it) => {
    assert.equal(it.choices.length, 3);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 3);
    assert.ok(it.choices.some((c) => c.id === it.correctId));
    answers.add(it.correctId);
    assert.ok(it.explanation.length > 20 && !DASH.test(it.explanation));
  });
  assert.deepEqual([...answers].sort(), ['down', 'fall', 'fast', 'flat', 'slow', 'up']);
  // The doubling and tripling stories must be the speeding-up curve, and the steady-rate stories must be straight lines.
  items.forEach((it) => {
    if (/doubles|2 people, who each share|1 student knows, then 3|5 percent interest/.test(it.stimulusText)) assert.equal(it.correctId, 'fast', it.stimulusText);
    if (/steady|each year|each month|each minute/.test(it.stimulusText) && /\$100 of value|burns down|5 liters|\$30 each month|60 miles/.test(it.stimulusText)) assert.ok(['up', 'down'].includes(it.correctId), it.stimulusText);
    if (/flat \$5|fixed \$2/.test(it.stimulusText)) assert.equal(it.correctId, 'flat');
  });
});

test('STATS CHECK: the median, mean, mode and range are recomputed from the scores', () => {
  const items = by('stats-check').pack.items;
  assert.equal(items.length, 13);
  const calc = { mean: (a) => a.reduce((x, y) => x + y, 0) / a.length, median: (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; },
    mode: (a) => { const c = {}; a.forEach((v) => { c[v] = (c[v] || 0) + 1; }); const top = Math.max(...Object.values(c)); return Object.keys(c).filter((k) => c[k] === top).map(Number); }, range: (a) => Math.max(...a) - Math.min(...a) };
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  let stat = 0, claim = 0;
  items.forEach((it) => {
    const m = it.meta;
    if (m.kind === 'claim') { claim++; assert.equal(it.choices.length, 3); assert.ok(it.choices.some((c) => c.id === it.correctId)); return; }
    stat++;
    const nums = it.stimulusText.match(/Scores: ([\d, ]+)\./)[1].split(', ').map(Number);
    assert.deepEqual(nums, m.data);
    const asked = /median|mean|mode|range/.exec(it.stimulusText.split('What is the')[1])[0];
    assert.equal(asked, m.kind);
    const want = calc[m.kind](nums);
    if (m.kind === 'mode') { assert.equal(want.length, 1, 'one clear mode'); assert.equal(it.correctId, fmt(want[0])); } else assert.equal(it.correctId, fmt(want), it.stimulusText);
    assert.equal(it.choices.length, 3);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 3);
  });
  assert.equal(stat, 9); assert.equal(claim, 4);
});

test('PLAN IT: exactly one of the three offered orders finishes every job on time, it is the one marked right, and the proof is the earliest deadline', () => {
  const items = by('plan-it').pack.items;
  assert.equal(items.length, 10);
  items.forEach((it, i) => {
    const at = `plan-it item ${i + 1}`;
    const start = it.plan.start;
    const parsed = it.passage.slice(1).map((s) => { const m = s.match(/^(.+?) takes (\d) hours? and is due by (\d+) (am|pm)\.$/); const due = Number(m[3]) % 12 + (m[4] === 'pm' ? 12 : 0); return { name: m[1], h: Number(m[2]), due }; });
    parsed.forEach((t, k) => { assert.equal(t.h, it.plan.tasks[k].h); assert.equal(t.due, it.plan.tasks[k].due); });
    const meets = (order) => { let t = start; for (const k of order) { t += parsed[k].h; if (t > parsed[k].due) return false; } return true; };
    const offered = it.choices.map((c) => { const names = c.text.split(', then '); return names.map((n) => parsed.findIndex((p) => p.name === n)); });
    offered.forEach((o) => assert.ok(o.every((k) => k >= 0) && new Set(o).size === 3, `${at}: a real order`));
    const good = offered.filter(meets);
    assert.equal(good.length, 1, `${at}: exactly one offered order works`);
    assert.equal(it.choices[offered.indexOf(good[0])].id, it.correctChoiceId, `${at}: the right one is marked right`);
    const earliest = [0, 1, 2].sort((a, b) => parsed[a].due - parsed[b].due)[0];
    assert.equal(it.correctEvidenceIndex, 1 + earliest, `${at}: the proof is the earliest deadline`);
    assert.ok(good[0][0] === earliest, `${at}: the earliest deadline goes first`);
    assert.equal(new Set(it.choices.map((c) => c.text)).size, 3);
    assert.ok(!DASH.test(JSON.stringify(it)));
  });
});

test('SWITCH BOARD: every answer follows the rule shown, the rule changes often, and there is no clock', () => {
  const g = by('switch-board'), items = g.pack.items;
  assert.equal(items.length, 24);
  const rules = { ADD: (n) => n + 4, SUBTRACT: (n) => n - 3, DOUBLE: (n) => n * 2, HALVE: (n) => n / 2 };
  let changes = 0, prev = '';
  items.forEach((it) => {
    const m = it.stimulusText.match(/^Rule: (ADD|SUBTRACT|DOUBLE|HALVE)(?: \d)?\. Number: (\d+)$/);
    assert.ok(m, it.stimulusText);
    const n = Number(m[2]), ans = rules[m[1]](n);
    assert.ok(Number.isInteger(ans) && ans > 0);
    assert.equal(it.correctId, String(ans), it.stimulusText);
    assert.equal(it.choices.length, 3);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 3);
    if (m[1] !== prev) changes++;
    prev = m[1];
  });
  assert.ok(changes >= 14, `the rule changes ${changes} times in 24 items`);
  assert.equal(new Set(items.map((it) => it.stimulusText.split('.')[0])).size, 4, 'all four rules appear');
});
