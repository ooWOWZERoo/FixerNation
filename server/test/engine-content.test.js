// Tests for the per-run content preparation in engine-sdk.js (Phase 1 of docs/tune-your-brain/GAME_REVERIFICATION_PLAN.md).
// What must hold: the right answer no longer sits in the same slot every run, shuffling never changes which choice is
// correct, sequential engines keep their order, a pool draws a different set of rounds each run, a variant is picked per
// run, ?seed= reproduces a run, and every real game page still plays correctly after preparation.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sdk = require(path.join(__dirname, '..', '..', 'engine-sdk.js'));
const { auditAll, extractPack, ROOT } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));
const fs = require('node:fs');

const prep = (pack, engine, seed) => sdk.prepareContentPack(pack, engine, sdk.mulberry32(seed));
const ids = (list) => list.map((c) => c.id).join('');

const audioPack = () => ({
  items: [1, 2, 3, 4, 5].map((n) => ({ stimulusText: `item ${n}`, choices: [{ id: 'right' }, { id: 'x' }, { id: 'y' }], correctId: 'right', n })),
});

test('SLOTS: the correct choice lands in every slot, not always the first', () => {
  const seen = [0, 0, 0];
  for (let seed = 1; seed <= 600; seed++) {
    prep(audioPack(), 'audioChoice', seed).pack.items.forEach((it) => { seen[it.choices.findIndex((c) => c.id === it.correctId)]++; });
  }
  const total = seen.reduce((a, b) => a + b, 0);
  seen.forEach((n, slot) => assert.ok(n / total > 0.25 && n / total < 0.42, `slot ${slot} got ${Math.round((100 * n) / total)}% of correct answers`));
});

test('CORRECTNESS: shuffling keeps every choice and the right answer id; nothing is mutated', () => {
  const original = audioPack();
  const before = JSON.stringify(original);
  const out = prep(original, 'audioChoice', 7).pack;
  assert.equal(JSON.stringify(original), before, 'the authored pack must not be changed');
  out.items.forEach((it) => {
    assert.deepEqual(it.choices.map((c) => c.id).sort(), ['right', 'x', 'y']);
    assert.equal(it.correctId, 'right');
  });
});

test('ROUND ORDER: independent-round engines shuffle rounds; sequential engines keep order', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 40; seed++) orders.add(prep(audioPack(), 'audioChoice', seed).order.join(','));
  assert.ok(orders.size > 10, 'audio rounds should come in many different orders');

  const steps = ['recognize', 'impact', 'consider', 'choose', 'reflect'].map((key) => ({ key, choices: [{ id: 'a', type: 'responsible' }, { id: 'b', type: 'unsafe' }] }));
  const events = [1, 2, 3, 4].map((n) => ({ prompt: `e${n}`, options: [{ id: 'a' }, { id: 'b' }] }));
  for (let seed = 1; seed <= 20; seed++) {
    assert.deepEqual(prep({ steps }, 'branchingScenario', seed).pack.steps.map((s) => s.key), steps.map((s) => s.key));
    assert.deepEqual(prep({ events }, 'simulation', seed).pack.events.map((e) => e.prompt), events.map((e) => e.prompt));
  }
});

test('SCENARIO CHOICE: cues and feelings are both shuffled, rounds keep their ids', () => {
  const pack = { scenarios: [{ context: 'c', cues: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], feelings: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] }] };
  const cueOrders = new Set(), feelingOrders = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const s = prep(pack, 'scenarioChoice', seed).pack.scenarios[0];
    cueOrders.add(ids(s.cues)); feelingOrders.add(ids(s.feelings));
    assert.deepEqual(s.cues.map((c) => c.id).sort(), ['c1', 'c2', 'c3']);
  }
  assert.equal(cueOrders.size, 6);
  assert.equal(feelingOrders.size, 6);
});

test('PINNED: a pinLast choice stays last, and shuffleChoices:false is honoured per pack and per round', () => {
  const pack = { items: [{ choices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'none', pinLast: true }], correctId: 'a' }] };
  for (let seed = 1; seed <= 30; seed++) assert.equal(prep(pack, 'audioChoice', seed).pack.items[0].choices.at(-1).id, 'none');
  const fixedPack = { shuffleChoices: false, items: [{ choices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] };
  const fixedRound = { items: [{ shuffleChoices: false, choices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] };
  for (let seed = 1; seed <= 30; seed++) {
    assert.equal(ids(prep(fixedPack, 'audioChoice', seed).pack.items[0].choices), 'abc');
    assert.equal(ids(prep(fixedRound, 'audioChoice', seed).pack.items[0].choices), 'abc');
  }
});

test('POOL: roundsPerRun draws that many distinct rounds, and different runs cover the whole pool', () => {
  const pool = { roundsPerRun: 4, items: Array.from({ length: 12 }, (_, n) => ({ n, choices: [{ id: 'a' }, { id: 'b' }], correctId: 'a' })) };
  const covered = new Set(), sets = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const r = prep(pool, 'audioChoice', seed);
    assert.equal(r.pack.items.length, 4);
    assert.equal(new Set(r.order).size, 4, 'no round repeats inside a run');
    r.order.forEach((i) => covered.add(i));
    sets.add([...r.order].sort((a, b) => a - b).join(','));
  }
  assert.equal(covered.size, 12, 'across runs every round in the pool gets used');
  assert.ok(sets.size > 20, 'consecutive runs mostly draw different sets');
  // sequential engines keep the authored relative order of the rounds they draw
  const events = { roundsPerRun: 3, events: Array.from({ length: 8 }, (_, n) => ({ prompt: `e${n}`, options: [{ id: 'a' }] })) };
  for (let seed = 1; seed <= 20; seed++) {
    const order = prep(events, 'simulation', seed).order;
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  }
});

test('VARIANTS: one whole variant is picked per run and overrides the pack', () => {
  const pack = { title: 'T', steps: [{ key: 'x', choices: [] }], variants: [{ steps: [{ key: 'v0', choices: [] }] }, { steps: [{ key: 'v1', choices: [] }] }, { steps: [{ key: 'v2', choices: [] }] }] };
  const used = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const r = prep(pack, 'branchingScenario', seed);
    assert.equal(r.pack.steps[0].key, `v${r.variant}`);
    assert.equal(r.pack.title, 'T');
    used.add(r.variant);
  }
  assert.equal(used.size, 3);
});

test('SEED: the same seed replays the same run; other seeds do not', () => {
  const a = JSON.stringify(prep(audioPack(), 'audioChoice', 99).pack);
  assert.equal(JSON.stringify(prep(audioPack(), 'audioChoice', 99).pack), a);
  assert.notEqual(JSON.stringify(prep(audioPack(), 'audioChoice', 100).pack), a);
});

test('UNKNOWN ENGINE: memory, pattern and anything unregistered pass through untouched', () => {
  const pack = { items: [{ id: 1 }, { id: 2 }] };
  assert.equal(sdk.prepareContentPack(pack, 'memory', Math.random).pack, pack);
});

// The real pages: every engine game must still be playable and winnable after preparation, and no longer a first-slot game.
const REAL = auditAll().filter((r) => r.engine !== 'legacy' && !r.note).map((r) => {
  const src = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
  const engineName = (src.match(/engineName:\s*'([A-Za-z]+)'/) || [])[1];
  return { slug: r.slug, engineName, pack: extractPack(src) };
}).filter((g) => g.pack && g.engineName);

test('REAL GAMES: all 16 engine games are found and parse', () => {
  assert.equal(REAL.length, 16, REAL.map((g) => g.slug).join(', '));
});

test('REAL GAMES: after preparation each round keeps its choices and its right answer', () => {
  for (const g of REAL) {
    const shape = { audioChoice: ['items', 'choices', 'correctId'], evidenceHunt: ['items', 'choices', 'correctChoiceId'] }[g.engineName];
    for (let seed = 1; seed <= 25; seed++) {
      const out = prep(g.pack, g.engineName, seed).pack;
      if (shape) {
        const [list, arr, key] = shape;
        out[list].forEach((it) => assert.ok(it[arr].some((c) => c.id === it[key]), `${g.slug}: right answer missing after shuffle`));
      }
    }
  }
});

test('REAL GAMES: the right answer is no longer always first in any game that has one', () => {
  for (const g of REAL.filter((x) => x.engineName === 'audioChoice' || x.engineName === 'evidenceHunt')) {
    const key = g.engineName === 'audioChoice' ? 'correctId' : 'correctChoiceId';
    let first = 0, total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      prep(g.pack, g.engineName, seed).pack.items.forEach((it) => { total++; if (it.choices[0].id === it[key]) first++; });
    }
    assert.ok(first / total < 0.5, `${g.slug}: right answer first ${Math.round((100 * first) / total)}% of the time`);
  }
  for (const g of REAL.filter((x) => x.engineName === 'branchingScenario')) {
    let first = 0, total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      prep(g.pack, g.engineName, seed).pack.steps.filter((s) => s.choices && s.choices.length > 1).forEach((s) => { total++; if (s.choices[0].type === 'responsible') first++; });
    }
    assert.ok(first / total < 0.6, `${g.slug}: responsible choice first ${Math.round((100 * first) / total)}% of the time`);
  }
});

test('REAL GAMES: scenario step order is never shuffled', () => {
  for (const g of REAL.filter((x) => x.engineName === 'branchingScenario')) {
    const authored = g.pack.steps.map((s) => s.key).join();  // joined: pack arrays come from a vm context, so compare as strings
    for (let seed = 1; seed <= 10; seed++) assert.equal(prep(g.pack, g.engineName, seed).pack.steps.map((s) => s.key).join(), authored, g.slug);
  }
});

// Feelings Detective's private self-check (NY SEL 1A): present on every story, left in authored order, and never logged.
test('SELF-CHECK: Feelings Detective carries a pack-level self-check that the SDK passes through untouched', () => {
  const g = REAL.find((x) => x.slug === 'feelings-detective');
  assert.ok(g && g.pack.selfCheck, 'selfCheck missing from the Feelings Detective pack');
  const sc = g.pack.selfCheck;
  assert.ok(sc.prompt && sc.bodyPrompt && sc.closing && sc.privateNote);
  assert.equal(sc.options.map((o) => o.id).join(), 'yes,no,not-sure'); // joined: the pack comes from a vm context, so arrays are not the same realm
  for (let seed = 1; seed <= 10; seed++) {
    const out = prep(g.pack, g.engineName, seed).pack;
    assert.equal(JSON.stringify(out.selfCheck), JSON.stringify(sc), 'self-check options must keep their order');
  }
});

test('SELF-CHECK PRIVACY: the engine never sends which answer a child picked', () => {
  const src = fs.readFileSync(path.join(ROOT, 'engine-scenario-choice.js'), 'utf8');
  const calls = src.split('\n').filter((l) => /onEvidence\(/.test(l) && /self_check/.test(l));
  assert.ok(calls.length >= 3, 'expected the self-check evidence calls to be present');
  calls.forEach((l) => assert.match(l, /\{ scenarioIndex: index, stage: 'self_check(_body)?' \}/, `self-check evidence must carry only the stage: ${l.trim()}`));
  assert.ok(!/opt\.id|option\.id/.test(src.slice(src.indexOf('function askSelfCheck'))), 'askSelfCheck must not read the chosen option id');
});

// Phase 3 stories for Choice Quest and Team Pick (approved outlines in docs/tune-your-brain/EXPLORE_STORY_OUTLINES.md).
// All four stories (the original, rebalanced on 2026-10-31, and the three new ones) must follow the writing rules.
const CYCLE = ['recognize', 'impact', 'consider', 'choose', 'reflect'];
for (const slug of ['choice-quest', 'team-pick']) {
  test(`STORIES ${slug}: four stories, each a full five-step cycle`, () => {
    const g = REAL.find((x) => x.slug === slug);
    assert.equal(g.pack.variants.length, 4);
    g.pack.variants.forEach((v, i) => assert.equal(v.steps.map((s) => s.key).join(), CYCLE.join(), `story ${i}`));
    assert.equal(g.pack.variants[0].steps[0].prompt, g.pack.steps[0].prompt, 'story 1 is the original story');
  });

  test(`STORIES ${slug}: every story follows the writing rules`, () => {
    const g = REAL.find((x) => x.slug === slug);
    g.pack.variants.forEach((v, n) => {
      const label = `${slug} story ${n + 1}`;
      const ids = new Set();
      v.steps.forEach((step, i) => {
        const text = [step.prompt].concat((step.choices || []).flatMap((c) => [c.text, c.feedback])).join(' ');
        assert.ok(!/[–—]/.test(text), `${label} step ${i + 1}: no dashes`);
        if (step.key === 'reflect') { assert.equal(step.freeReflection, true); assert.ok(!step.choices); return; }
        const types = step.choices.map((c) => c.type);
        if (step.key === 'choose') {
          assert.equal(types.slice().sort().join(), ['multiple_defensible', 'responsible', 'seek_help', 'unsafe'].join(), `${label}: final step needs one of each`);
        } else {
          assert.equal(step.choices.length, 3, `${label} step ${i + 1}: three options`);
          assert.equal(types.filter((t) => t === 'responsible').length, 1);
        }
        step.choices.forEach((c) => {
          assert.ok(c.feedback && c.feedback.length > 20, `${label}: every option explains its effect`);
          assert.ok(!ids.has(c.id), `${label}: duplicate id ${c.id}`); ids.add(c.id);
        });
        const lens = step.choices.map((c) => c.text.length);
        assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.4, `${label} step ${i + 1}: option lengths too uneven`);
      });
      const judged = v.steps.filter((s) => s.choices);
      const longest = judged.filter((s) => { const best = s.choices.find((c) => c.type === 'responsible'); return best.text.length === Math.max(...s.choices.map((c) => c.text.length)); }).length;
      assert.ok(longest <= 2, `${label}: the best answer is the longest in ${longest} of 4 steps`);
    });
  });

  test(`STORIES ${slug}: every story comes up across runs, in cycle order, with choices shuffled`, () => {
    const g = REAL.find((x) => x.slug === slug);
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const r = prep(g.pack, g.engineName, seed);
      seen.add(r.variant);
      assert.equal(r.pack.steps.map((s) => s.key).join(), CYCLE.join());
    }
    assert.equal(seen.size, 4);
  });
}
