// Release 136: game defects found in the games audit (docs/reference/game-defects-fix-requirements.md).
// Memory Match is usable by keyboard and screen reader, and Same and Different's header comment matches its pool.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('MEMORY MATCH: every card is a real button with a spoken label, and the result of a flip is announced', () => {
  const page = read('brain-memory-match.html');
  assert.match(page, /<button type="button" class="flip-card" id="card-\$\{i\}"/);
  assert.ok(!/<div class="flip-card"/.test(page), 'no card is a bare div any more');
  assert.match(page, /aria-label="\$\{cardLabel\(i, 'down'\)\}"/);
  assert.match(page, /id="mmStatus" class="sr-only" role="status" aria-live="polite"/);
  assert.match(page, /aria-hidden="true">\?<\/div>/); assert.match(page, /flip-back" aria-hidden="true"/);
  assert.match(page, /\.flip-card:focus-visible/);
  // every emoji in the deck has a spoken name
  const emojis = [...page.match(/const EMOJIS = \[(.*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const names = page.match(/const EMOJI_NAMES = \{(.*?)\};/s)[1];
  assert.equal(emojis.length, 15);
  for (const e of emojis) assert.ok(names.includes(`'${e}':`), `${e} has a spoken name`);
  // the game logic that scores a run is untouched
  assert.match(page, /cards\[a\]\.emoji === cards\[b\]\.emoji/);
});

test('SAME AND DIFFERENT: the header comment says how many rounds are drawn, and it is the number the pack uses', () => {
  const page = read('brain-same-and-different.html');
  const perRun = Number(page.match(/"roundsPerRun": (\d+)/)[1]);
  const pool = (page.match(/"stimulusType"/g) || []).length;
  const comment = page.match(/A pool of (\d+) rounds; (\d+) are drawn per run/);
  assert.ok(comment, 'the comment states the pool and the draw');
  assert.equal(Number(comment[1]), pool); assert.equal(Number(comment[2]), perRun);
});

// ---- Number Sequence, the money games, the story tally (Release 136, owner confirmed 2026-11-06) ----
const vm = require('node:vm');
const sdk = require(path.join(ROOT, 'engine-sdk.js'));
const { extractPack } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));

test('NUMBER SEQUENCE: every quadratic sequence follows one rule (a constant second difference), so it can be solved', () => {
  const src = read('brain-number-sequence.html');
  const fn = src.slice(src.indexOf('function rand('), src.indexOf('let currentQ = null;'));
  const ctx = { difficulty: 'hard', Math };
  vm.createContext(ctx); vm.runInContext(fn, ctx);
  let quadratic = 0;
  for (let n = 0; n < 4000; n++) {
    const q = vm.runInContext('generateSequence()', ctx);
    if (q.label !== 'Quadratic pattern') continue;
    quadratic++;
    const d1 = q.nums.slice(1).map((v, i) => v - q.nums[i]);
    const d2 = d1.slice(1).map((v, i) => v - d1[i]);
    assert.ok(d2.every((x) => x === d2[0]), `second differences are constant: ${q.nums.join(',')}`);
    assert.ok(d2[0] >= 2 && d2[0] % 2 === 0, 'the rule is 2a');
  }
  assert.ok(quadratic > 400, 'the hard level still draws quadratic questions');
});

test('ALWAYS INCLUDE: a pinned round is in every run, the run keeps its length and story order, and a pack with no pin draws exactly as before', () => {
  const events = Array.from({ length: 10 }, (_, n) => ({ prompt: `e${n}`, options: [{ id: 'a' }], ...(n === 0 || n === 4 ? { alwaysInclude: true } : {}) }));
  for (let seed = 1; seed <= 300; seed++) {
    const out = sdk.prepareContentPack({ roundsPerRun: 6, events }, 'simulation', sdk.mulberry32(seed));
    assert.equal(out.order.length, 6); assert.equal(new Set(out.order).size, 6);
    assert.ok(out.order.includes(0) && out.order.includes(4), 'both pinned events are in the run');
    assert.deepEqual(out.order, out.order.slice().sort((a, b) => a - b), 'story order kept for the simulation engine');
  }
  // an engine whose rounds are shuffled still keeps the pinned round
  const items = Array.from({ length: 8 }, (_, n) => ({ n, choices: [{ id: 'a' }, { id: 'b' }], correctId: 'a', ...(n === 3 ? { alwaysInclude: true } : {}) }));
  for (let seed = 1; seed <= 100; seed++) assert.ok(sdk.prepareContentPack({ roundsPerRun: 3, items }, 'audioChoice', sdk.mulberry32(seed)).order.includes(3));
  // no pin: the same rounds as the old draw (shuffle the whole list, take the first N, sort for ordered engines)
  const plain = Array.from({ length: 12 }, (_, n) => ({ prompt: `e${n}`, options: [{ id: 'a' }] }));
  for (let seed = 1; seed <= 50; seed++) {
    const rng = sdk.mulberry32(seed);
    const all = plain.map((_, i) => i);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const old = all.slice(0, 5).sort((a, b) => a - b);
    assert.deepEqual(sdk.prepareContentPack({ roundsPerRun: 5, events: plain }, 'simulation', sdk.mulberry32(seed)).order, old);
  }
});

function canReach(pack, order, ok) {
  let states = new Map([[JSON.stringify(pack.startingResources), pack.startingResources]]);
  for (const i of order) {
    const next = new Map();
    for (const st of states.values()) {
      for (const o of pack.events[i].options) {
        const n = { ...st }; let bad = false;
        for (const [k, v] of Object.entries(o.delta || {})) { n[k] = (n[k] || 0) + v; if (n[k] < 0) bad = true; }
        if (!bad) next.set(JSON.stringify(n), n);
      }
    }
    states = next;
  }
  return [...states.values()].some(ok);
}
function combinations(n, k) {
  const out = []; (function rec(s, c) { if (c.length === k) { out.push(c.slice()); return; } for (let i = s; i < n; i++) { c.push(i); rec(i + 1, c); c.pop(); } })(0, []);
  return out;
}

test('MONEY GAMES: every possible run can reach the goal (it was 65% and 57% of runs before), and the pinned events are the income events', () => {
  const games = [
    ['brain-money-moves.html', (s) => s.Savings >= 60 && s['Spending Money'] >= 10, ['allowance']],
    ['brain-money-matters.html', (s) => s.Savings >= 800 && s['Card Debt'] <= 400 && s.Checking >= 300, ['paycheck', 'tax refund']],
  ];
  for (const [file, ok, pinnedNames] of games) {
    const pack = extractPack(read(file));
    const pinned = pack.events.map((e, i) => (e.alwaysInclude ? i : -1)).filter((i) => i >= 0);
    assert.equal(pinned.length, pinnedNames.length, `${file} pins ${pinnedNames.join(' and ')}`);
    pinned.forEach((i, n) => assert.match(pack.events[i].prompt.toLowerCase(), new RegExp(pinnedNames[n].split(' ')[pinnedNames[n].split(' ').length - 1])));
    const rest = pack.events.map((_, i) => i).filter((i) => !pinned.includes(i));
    let draws = 0;
    for (const c of combinations(rest.length, pack.roundsPerRun - pinned.length)) {
      const order = pinned.concat(c.map((i) => rest[i])).sort((a, b) => a - b);
      draws++;
      assert.ok(canReach(pack, order, ok), `${file}: a run with events ${order.join(',')} cannot reach the goal`);
    }
    assert.ok(draws > 500, `${file}: every one of its ${draws} possible runs was tried`);
    // the real draw (the SDK) never leaves a pinned event out
    for (let seed = 1; seed <= 200; seed++) {
      const out = sdk.prepareContentPack(pack, 'simulation', sdk.mulberry32(seed));
      pinned.forEach((i) => assert.ok(out.order.includes(i)));
      assert.ok(canReach(pack, out.order, ok));
    }
  }
});

test('STORY GAMES: asking a trusted adult counts as a smart choice; unsafe and plausible-but-incomplete answers still do not', () => {
  const src = read('engine-branching-scenario.js');
  const fn = src.match(/const responsible = responseTypes\.filter\(\(t\) => ([^;]*)\)\.length;/);
  assert.ok(fn, 'the tally line is there');
  const counts = new Function('responseTypes', `return responseTypes.filter((t) => ${fn[1]}).length;`);
  assert.equal(counts(['responsible', 'multiple_defensible', 'seek_help']), 3);
  assert.equal(counts(['unsafe', 'plausible_incomplete']), 0);
  assert.equal(counts(['seek_help', 'unsafe']), 1);
});

test('CACHE VERSIONS: engine-sdk.js v6 and engine-branching-scenario.js v7 on every page that loads them', () => {
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const s = read(f);
    const a = s.match(/engine-sdk\.js\?v=(\d+)/); if (a) assert.equal(a[1], '6', f);
    const b = s.match(/engine-branching-scenario\.js\?v=(\d+)/); if (b) assert.equal(b[1], '7', f);
  }
});

test('READING DETECTIVE: 12 passages, 5 per run, three answers of similar length, and the right answer is not the giveaway', () => {
  const pack = extractPack(read('brain-reading-detective.html'));
  assert.equal(pack.items.length, 12); assert.equal(pack.roundsPerRun, 5);
  const ids = new Set(); let longest = 0;
  for (const [n, it] of pack.items.entries()) {
    const label = `item ${n + 1}`;
    assert.ok(it.passage.length >= 3 && it.passage.length <= 6, `${label}: 3 to 6 sentences`);
    assert.equal(it.choices.length, 3, label);
    assert.equal(it.choices.filter((c) => c.id === it.correctChoiceId).length, 1, `${label}: one right answer`);
    assert.ok(Number.isInteger(it.correctEvidenceIndex) && it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length, `${label}: the proving sentence exists`);
    const lens = it.choices.map((c) => c.text.length);
    assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.3, `${label}: answers within 1.3 times in length (${lens.join('/')})`);
    const right = it.choices.find((c) => c.id === it.correctChoiceId).text.length;
    if (right === Math.max(...lens) && lens.filter((l) => l === right).length === 1) longest++;
    it.choices.forEach((c) => { assert.ok(!ids.has(n + c.id), `${label}: unique ids`); ids.add(n + c.id); });
    assert.ok(!/—/.test(JSON.stringify(it)), `${label}: no em dash`);
  }
  assert.ok(longest <= 4, `the right answer is the single longest in ${longest} of 12 (at most 4)`);
  // the draw: 5 different passages each run, the whole pool gets used, and the choices are shuffled
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const out = sdk.prepareContentPack(pack, 'evidenceHunt', sdk.mulberry32(seed));
    assert.equal(out.pack.items.length, 5); assert.equal(new Set(out.order).size, 5);
    out.order.forEach((i) => seen.add(i));
  }
  assert.equal(seen.size, 12);
  // it is still the same engine, band and activity
  const page = read('brain-reading-detective.html');
  assert.match(page, /engineName: 'evidenceHunt'/); assert.match(page, /band = params\.get\('band'\) \|\| 'explore'/); assert.match(page, /activityId: 'reading-detective-clues'/);
});
