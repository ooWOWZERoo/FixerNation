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

test('REAL GAMES: all 25 engine games are found and parse', () => {
  assert.equal(REAL.length, 25, REAL.map((g) => g.slug).join(', '));
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
for (const slug of ['choice-quest', 'team-pick', 'the-post', 'first-shift', 'perspective-swap', 'community-voice', 'peace-table']) {
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

// Money Moves (reworked 2026-11-01): a 14-event pool, 6 drawn per run, an affordability floor, and endings that use both counters.
test('MONEY MOVES: every event has a free choice, so a run can never get stuck on the affordability floor', () => {
  const g = REAL.find((x) => x.slug === 'money-moves');
  assert.equal(g.pack.events.length, 14);
  assert.equal(g.pack.roundsPerRun, 6);
  assert.equal(g.pack.floor, 0);
  g.pack.events.forEach((e, i) => {
    assert.ok(e.options.length >= 3, `event ${i + 1}: three or more choices`);
    assert.ok(e.options.some((o) => Object.values(o.delta || {}).every((v) => v >= 0)), `event ${i + 1}: at least one choice costs nothing`);
    assert.ok(!/[–—]/.test(e.prompt + e.options.map((o) => o.label).join(' ')), `event ${i + 1}: no dashes`);
  });
});

test('MONEY MOVES: simulated runs never go below zero, and every one of the five endings can be reached', () => {
  const g = REAL.find((x) => x.slug === 'money-moves');
  const pack = g.pack;
  let seedN = 1;
  const seen = new Set();
  for (let run = 0; run < 4000; run++) {
    const prepared = prep(pack, 'simulation', seedN++).pack;
    assert.equal(prepared.events.length, 6);
    const res = { ...pack.startingResources };
    // a different "player" each run: random affordable choice
    const pick = sdk.mulberry32(run + 77);
    for (const e of prepared.events) {
      const ok = e.options.filter((o) => Object.entries(o.delta || {}).every(([k, v]) => (res[k] || 0) + v >= 0));
      assert.ok(ok.length >= 1, 'a free choice is always available');
      const o = ok[Math.floor(pick() * ok.length)];
      Object.entries(o.delta || {}).forEach(([k, v]) => { res[k] = (res[k] || 0) + v; });
      assert.ok(Object.values(res).every((v) => v >= 0), 'no counter goes negative');
    }
    seen.add(pack.debrief(res).split('.')[0]);
  }
  assert.equal(seen.size, 5, `endings reached: ${[...seen].join(' | ')}`);
});

// Headline (reworked 2026-11-01, approved outline: docs/tune-your-brain/HEADLINE_OUTLINE.md): a 12-item pool, 6 drawn per run.
// Syllables are estimated by counting vowel groups; good enough for a Flesch-Kincaid grade check on short school-news snippets.
function fkGrade(sentences) {
  const words = sentences.join(' ').split(/\s+/).filter(Boolean);
  const syll = (w) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g) || []).length);
  const syllables = words.reduce((n, w) => n + syll(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
}

test('HEADLINE: twelve items, six per run, a full set of choices each', () => {
  const g = REAL.find((x) => x.slug === 'headline');
  assert.equal(g.pack.items.length, 12);
  assert.equal(g.pack.roundsPerRun, 6);
  g.pack.items.forEach((it, i) => {
    assert.equal(it.choices.length, 4, `item ${i + 1}: one right headline and three wrong ones`);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 4, `item ${i + 1}: unique ids`);
    assert.ok(it.choices.some((c) => c.id === it.correctChoiceId), `item ${i + 1}: right answer present`);
    assert.ok(it.passage.length >= 4 && it.passage.length <= 6, `item ${i + 1}: 4 to 6 sentences`);
    assert.ok(it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length, `item ${i + 1}: evidence index in range`);
    assert.ok(/\d/.test(it.passage[it.correctEvidenceIndex]), `item ${i + 1}: the proving sentence carries a number`);
    assert.ok(it.explanation && it.explanation.length > 60, `item ${i + 1}: explanation`);
    assert.ok(!/[–—]/.test(it.passage.join(' ') + it.choices.map((c) => c.text).join(' ') + it.explanation), `item ${i + 1}: no dashes`);
  });
});

test('HEADLINE: option lengths are balanced and the right headline is not usually the longest', () => {
  const g = REAL.find((x) => x.slug === 'headline');
  let longest = 0;
  g.pack.items.forEach((it, i) => {
    const lens = it.choices.map((c) => c.text.length);
    assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.4, `item ${i + 1}: lengths ${lens.join('/')} are more than 1.4 times apart`);
    const right = it.choices.find((c) => c.id === it.correctChoiceId).text.length;
    if (right === Math.max(...lens)) longest++;
  });
  assert.ok(longest <= 4, `the right headline is the longest in ${longest} of 12 items`);
});

test('HEADLINE: the proving sentence is spread across the first, second and third sentence', () => {
  const g = REAL.find((x) => x.slug === 'headline');
  const count = [0, 0, 0];
  g.pack.items.forEach((it) => { count[it.correctEvidenceIndex]++; });
  assert.equal(count.join(), '4,4,4');
});

test('HEADLINE: passages are written at about grades 6 to 8', () => {
  const g = REAL.find((x) => x.slug === 'headline');
  g.pack.items.forEach((it, i) => {
    const grade = fkGrade([...it.passage]);
    assert.ok(grade >= 5 && grade <= 9, `item ${i + 1}: Flesch-Kincaid grade ${grade.toFixed(1)}`);
  });
});

test('HEADLINE: runs draw different sets of items, and the right headline moves around', () => {
  const g = REAL.find((x) => x.slug === 'headline');
  const sets = new Set(), slots = [0, 0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const out = prep(g.pack, 'evidenceHunt', seed).pack;
    assert.equal(out.items.length, 6);
    sets.add(out.items.map((it) => it.correctChoiceId + it.passage[0].slice(0, 12)).sort().join('|'));
    out.items.forEach((it) => { slots[it.choices.findIndex((c) => c.id === it.correctChoiceId)]++; });
  }
  assert.ok(sets.size > 20, `only ${sets.size} different sets of items in 200 runs`);
  slots.forEach((n, s) => assert.ok(n / 1200 > 0.18 && n / 1200 < 0.32, `slot ${s} holds ${Math.round(n / 12)}% of right answers`));
});

// Say It Another Way (new 2026-11-01, approved outline: docs/tune-your-brain/SAY_IT_ANOTHER_WAY_OUTLINE.md): 12 situations, 6 per run.
test('SAY IT ANOTHER WAY: twelve situations, six per run, four drafts each', () => {
  const g = REAL.find((x) => x.slug === 'say-it-another-way');
  assert.equal(g.pack.items.length, 12);
  assert.equal(g.pack.roundsPerRun, 6);
  g.pack.items.forEach((it, i) => {
    assert.equal(it.choices.length, 4, `item ${i + 1}: one right draft and three wrong ones`);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 4, `item ${i + 1}: unique ids`);
    assert.ok(it.choices.some((c) => c.id === it.correctChoiceId), `item ${i + 1}: right answer present`);
    assert.ok(it.passage.length >= 4 && it.passage.length <= 6, `item ${i + 1}: 4 to 6 sentences`);
    assert.ok(it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length, `item ${i + 1}: evidence index in range`);
    assert.ok(it.explanation && it.explanation.length > 60, `item ${i + 1}: explanation`);
    assert.ok(!/[–—]/.test(it.passage.join(' ') + it.question + it.choices.map((c) => c.text).join(' ') + it.explanation), `item ${i + 1}: no dashes`);
  });
});

test('SAY IT ANOTHER WAY: draft lengths are balanced, the right draft is not usually the longest, the proving sentence is spread', () => {
  const g = REAL.find((x) => x.slug === 'say-it-another-way');
  let longest = 0;
  const count = [0, 0, 0, 0];
  g.pack.items.forEach((it, i) => {
    const lens = it.choices.map((c) => c.text.length);
    assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.4, `item ${i + 1}: lengths ${lens.join('/')} are more than 1.4 times apart`);
    if (it.choices.find((c) => c.id === it.correctChoiceId).text.length === Math.max(...lens)) longest++;
    count[it.correctEvidenceIndex]++;
  });
  assert.ok(longest <= 4, `the right draft is the longest in ${longest} of 12 items`);
  assert.equal(count.slice(0, 3).join(), '4,4,4');
  assert.equal(count[3], 0);
});

test('SAY IT ANOTHER WAY: passages read at about grades 5 to 9, and runs differ', () => {
  const g = REAL.find((x) => x.slug === 'say-it-another-way');
  g.pack.items.forEach((it, i) => {
    const grade = fkGrade([...it.passage]);
    assert.ok(grade >= 5 && grade <= 9, `item ${i + 1}: Flesch-Kincaid grade ${grade.toFixed(1)}`);
  });
  const sets = new Set(), slots = [0, 0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const out = prep(g.pack, 'evidenceHunt', seed).pack;
    assert.equal(out.items.length, 6);
    sets.add(out.items.map((it) => it.passage[0].slice(0, 14)).sort().join('|'));
    out.items.forEach((it) => { slots[it.choices.findIndex((c) => c.id === it.correctChoiceId)]++; });
  }
  assert.ok(sets.size > 20, `only ${sets.size} different sets of situations in 200 runs`);
  slots.forEach((n, s) => assert.ok(n / 1200 > 0.18 && n / 1200 < 0.32, `slot ${s} holds ${Math.round(n / 12)}% of right drafts`));
});

// Fix-It Workshop (new 2026-11-01, approved outline: docs/tune-your-brain/FIX_IT_WORKSHOP_OUTLINE.md): four school problems, one per run.
// The idea step (consider) deliberately has no single best answer: all three ideas are workable.
test('FIX-IT WORKSHOP: four problems, each a full five-step design cycle', () => {
  const g = REAL.find((x) => x.slug === 'fix-it-workshop');
  assert.equal(g.pack.variants.length, 4);
  g.pack.variants.forEach((v, i) => assert.equal(v.steps.map((s) => s.key).join(), CYCLE.join(), `problem ${i + 1}`));
  assert.equal(g.pack.variants[0].steps[0].prompt, g.pack.steps[0].prompt, 'problem 1 is the base pack');
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) seen.add(prep(g.pack, 'branchingScenario', seed).pack.steps[0].prompt);
  assert.equal(seen.size, 4);
});

test('FIX-IT WORKSHOP: every problem follows the writing rules', () => {
  const g = REAL.find((x) => x.slug === 'fix-it-workshop');
  g.pack.variants.forEach((v, n) => {
    const label = `fix-it problem ${n + 1}`;
    const ids = new Set();
    v.steps.forEach((step, i) => {
      const text = [step.prompt].concat((step.choices || []).flatMap((c) => [c.text, c.feedback])).join(' ');
      assert.ok(!/[–—]/.test(text), `${label} step ${i + 1}: no dashes`);
      if (step.key === 'reflect') { assert.equal(step.freeReflection, true); assert.ok(!step.choices); return; }
      const types = step.choices.map((c) => c.type);
      if (step.key === 'choose') {
        assert.equal(types.slice().sort().join(), ['multiple_defensible', 'responsible', 'seek_help', 'unsafe'].join(), `${label}: final step needs one of each`);
      } else if (step.key === 'consider') {
        assert.equal(types.join(), 'multiple_defensible,multiple_defensible,multiple_defensible', `${label}: the idea step has no single best idea`);
      } else {
        assert.equal(step.choices.length, 3, `${label} step ${i + 1}: three options`);
        assert.equal(types.filter((t) => t === 'responsible').length, 1);
        assert.equal(types.filter((t) => t === 'plausible_incomplete').length, 2);
      }
      step.choices.forEach((c) => {
        assert.ok(c.feedback && c.feedback.length > 20, `${label}: every option explains its effect`);
        assert.ok(!ids.has(c.id), `${label}: duplicate id ${c.id}`); ids.add(c.id);
      });
      const lens = step.choices.map((c) => c.text.length);
      assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.4, `${label} step ${i + 1}: option lengths too uneven`);
    });
    const judged = v.steps.filter((s) => s.choices && s.choices.some((c) => c.type === 'responsible'));
    const longest = judged.filter((s) => s.choices.find((c) => c.type === 'responsible').text.length === Math.max(...s.choices.map((c) => c.text.length))).length;
    assert.ok(longest <= 2, `${label}: the best answer is the longest in ${longest} of 3 steps`);
    const idea = v.steps.find((s) => s.key === 'consider');
    idea.choices.forEach((c) => assert.ok(/\b(needs?|costs?|only|takes?|not)\b/.test(c.feedback), `${label}: the idea feedback names a cost or limit: ${c.id}`));
  });
});


// Idea Lab (new 2026-11-01, approved outline: docs/tune-your-brain/IDEA_LAB_OUTLINE.md): four situations, one per run; like Fix-It Workshop the idea step has no single best answer.
test('IDEA LAB: four problems, each a full five-step idea cycle', () => {
  const g = REAL.find((x) => x.slug === 'idea-lab');
  assert.equal(g.pack.variants.length, 4);
  g.pack.variants.forEach((v, i) => assert.equal(v.steps.map((s) => s.key).join(), CYCLE.join(), `problem ${i + 1}`));
  assert.equal(g.pack.variants[0].steps[0].prompt, g.pack.steps[0].prompt, 'problem 1 is the base pack');
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) seen.add(prep(g.pack, 'branchingScenario', seed).pack.steps[0].prompt);
  assert.equal(seen.size, 4);
});

test('IDEA LAB: every problem follows the writing rules', () => {
  const g = REAL.find((x) => x.slug === 'idea-lab');
  g.pack.variants.forEach((v, n) => {
    const label = `idea lab problem ${n + 1}`;
    const ids = new Set();
    v.steps.forEach((step, i) => {
      const text = [step.prompt].concat((step.choices || []).flatMap((c) => [c.text, c.feedback])).join(' ');
      assert.ok(!/[–—]/.test(text), `${label} step ${i + 1}: no dashes`);
      if (step.key === 'reflect') { assert.equal(step.freeReflection, true); assert.ok(!step.choices); return; }
      const types = step.choices.map((c) => c.type);
      if (step.key === 'choose') {
        assert.equal(types.slice().sort().join(), ['multiple_defensible', 'responsible', 'seek_help', 'unsafe'].join(), `${label}: final step needs one of each`);
      } else if (step.key === 'consider') {
        assert.equal(types.join(), 'multiple_defensible,multiple_defensible,multiple_defensible', `${label}: the idea step has no single best idea`);
      } else {
        assert.equal(step.choices.length, 3, `${label} step ${i + 1}: three options`);
        assert.equal(types.filter((t) => t === 'responsible').length, 1);
        assert.equal(types.filter((t) => t === 'plausible_incomplete').length, 2);
      }
      step.choices.forEach((c) => {
        assert.ok(c.feedback && c.feedback.length > 20, `${label}: every option explains its effect`);
        assert.ok(!ids.has(c.id), `${label}: duplicate id ${c.id}`); ids.add(c.id);
      });
      const lens = step.choices.map((c) => c.text.length);
      assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.4, `${label} step ${i + 1}: option lengths too uneven`);
    });
    const judged = v.steps.filter((s) => s.choices && s.choices.some((c) => c.type === 'responsible'));
    const longest = judged.filter((s) => s.choices.find((c) => c.type === 'responsible').text.length === Math.max(...s.choices.map((c) => c.text.length))).length;
    assert.ok(longest <= 2, `${label}: the best answer is the longest in ${longest} of 3 steps`);
    const idea = v.steps.find((s) => s.key === 'consider');
    idea.choices.forEach((c) => assert.ok(/\b(needs?|costs?|only|takes?|not)\b/.test(c.feedback), `${label}: the idea feedback names a cost or limit: ${c.id}`));
  });
});

// Strength Spotter (new 2026-11-01, approved outline: docs/tune-your-brain/STRENGTH_SPOTTER_OUTLINE.md): 12 stories, 5 per run.
test('SCENARIO CHOICE PROMPTS: the wording override is optional, and Feelings Detective keeps its original wording', () => {
  const src = fs.readFileSync(path.join(ROOT, 'engine-scenario-choice.js'), 'utf8');
  assert.match(src, /Object\.assign\(\{[\s\S]*contentPack\.prompts \|\| \{\}\)/);
  ['Which of these do you notice in this moment?', "I've noticed these", 'Which feeling(s) could this be? You can pick more than one.', "I've picked my feeling(s)", 'Times you saw more than one feeling']
    .forEach((s) => assert.ok(src.includes(s), `default wording kept: ${s}`));
  const fd = REAL.find((x) => x.slug === 'feelings-detective');
  // Release 87: Feelings Detective now supplies its own short Discover prompts (the engine defaults above stay for any pack that does not).
  ['cues', 'afterCues', 'pick', 'confirmCues', 'confirmPick', 'multiLabel'].forEach((k) => assert.ok(fd.pack.prompts[k], `Feelings Detective prompts.${k}`));
});

test('STRENGTH SPOTTER: twelve stories, four per run (then Your turn), each with noticing cues and strengths', () => {
  const g = REAL.find((x) => x.slug === 'strength-spotter');
  assert.equal(g.pack.scenarios.length, 12);
  assert.equal(g.pack.roundsPerRun, 4);
  ['cues', 'afterCues', 'pick', 'confirmCues', 'confirmPick', 'multiLabel'].forEach((k) => assert.ok(g.pack.prompts[k], `prompts.${k}`));
  const sets = new Set(), ids = new Set();
  g.pack.scenarios.forEach((s, i) => {
    assert.equal(s.cues.length, 4, `story ${i + 1}: four cues`);
    assert.equal(s.cues.filter((c) => c.present).length, 3, `story ${i + 1}: three cues really happen`);
    assert.equal(s.feelings.length, 4, `story ${i + 1}: four strengths`);
    assert.equal(s.feelings.filter((f) => f.tag === 'plausible').length, 3, `story ${i + 1}: three strengths fit`);
    const less = s.feelings.filter((f) => f.tag === 'less_fitting');
    assert.equal(less.length, 1, `story ${i + 1}: one strength fits less`);
    assert.ok(less[0].note && less[0].note.length > 20, `story ${i + 1}: a gentle note explains it`);
    assert.ok(s.reinforcement && s.illustration && s.context.length > 60, `story ${i + 1}: context, picture and a closing line`);
    const text = [s.context, s.reinforcement].concat(s.cues.map((c) => c.text), s.feelings.map((f) => f.text + (f.note || ''))).join(' ');
    assert.ok(!/[–—]/.test(text), `story ${i + 1}: no dashes`);
    [...s.cues, ...s.feelings].forEach((x) => { assert.ok(!ids.has(x.id), `duplicate id ${x.id}`); ids.add(x.id); });
    sets.add(s.feelings.filter((f) => f.tag === 'plausible').map((f) => f.text).sort().join('|'));
  });
  assert.equal(sets.size, 12, 'no two stories share the same set of strengths');
});

test('STRENGTH SPOTTER: the one-tap check is present, in order, and never logged; runs differ', () => {
  const g = REAL.find((x) => x.slug === 'strength-spotter');
  const sc = g.pack.selfCheck;
  assert.ok(sc.prompt && sc.privateNote && sc.summaryLabel);
  assert.equal(sc.options.map((o) => o.id).join(), 'yes,little,not-yet');
  assert.ok(!sc.bodyPrompt && !sc.bodyOptions, 'Release 138: one tap per story, the second question moved to Your turn');
  assert.ok(!/[–—]/.test(JSON.stringify(sc)));
  const sets = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const out = prep(g.pack, 'scenarioChoice', seed).pack;
    assert.equal(out.scenarios.length, 4);
    assert.equal(JSON.stringify(out.selfCheck), JSON.stringify(sc), 'the private check keeps its order');
    sets.add(out.scenarios.map((s) => s.context.slice(0, 10)).sort().join('|'));
  }
  assert.ok(sets.size > 20, `only ${sets.size} different sets of stories in 100 runs`);
});

// Same and Different (new 2026-11-01, approved outline: docs/tune-your-brain/SAME_AND_DIFFERENT_OUTLINE.md): 24 rounds (12 at first, 12 more in Release 131), 5 per run.
test('SAME AND DIFFERENT: twenty-four rounds in three kinds, five per run, with a spoken line on every choice', () => {
  const g = REAL.find((x) => x.slug === 'same-and-different');
  assert.equal(g.pack.items.length, 24);
  assert.equal(g.pack.roundsPerRun, 5);
  const kinds = { same: 0, diff: 0, kind: 0 };
  let longest = 0;
  g.pack.items.forEach((it, i) => {
    assert.equal(it.choices.length, 3, `round ${i + 1}: three picture choices`);
    assert.ok(it.choices.some((c) => c.id === it.correctId), `round ${i + 1}: right answer present`);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 3, `round ${i + 1}: unique ids`);
    it.choices.forEach((c) => { assert.ok(c.feedback && c.feedback.length > 20 && c.aria && c.label && c.caption, `round ${i + 1}: feedback, picture, caption and aria on ${c.id}`); });
    assert.ok(it.explanation && it.explanation.length > 30, `round ${i + 1}: explanation`);
    assert.ok(/\?$/.test(it.stimulusText), `round ${i + 1}: the scene ends with the question, so it is read aloud`);
    assert.ok(it.stimulusText.length < 260, `round ${i + 1}: short enough to listen to`);
    assert.ok(!/[–—]/.test(it.stimulusText + it.explanation + it.choices.map((c) => c.label + c.feedback).join(' ')), `round ${i + 1}: no dashes`);
    kinds[(it.stimulusText.match(/What is the same|What is different|What could|What is a kind/) || [''])[0].replace(/What is the same/, 'same').replace(/What is different/, 'diff').replace(/What could|What is a kind/, 'kind')]++;
    const lens = it.choices.map((c) => c.caption.length);
    if (it.choices.find((c) => c.id === it.correctId).caption.length === Math.max(...lens)) longest++;
  });
  assert.equal(`${kinds.same},${kinds.diff},${kinds.kind}`, '8,8,8');
  assert.ok(longest <= 8, `the right label is the longest in ${longest} of 24 rounds`);
});

test('SAME AND DIFFERENT: a wrong answer in a same or different round is true of one child or of both, never a made-up fact', () => {
  const g = REAL.find((x) => x.slug === 'same-and-different');
  g.pack.items.filter((it) => /What is (the same|different)/.test(it.stimulusText)).forEach((it, i) => {
    it.choices.filter((c) => c.id !== it.correctId).forEach((c) => {
      assert.match(c.feedback, /(so that is the same|but |look for something|Look for something)/i, `round ${i + 1}: ${c.id} feedback says why it is not the answer`);
    });
  });
});

// Money Matters (reworked 2026-11-01): a 14-event pool, 7 drawn per run, an affordability floor, three counters (Checking,
// Savings, Card Debt) and endings that use all of them. The card can never be paid below zero.
test('MONEY MATTERS: fourteen events, each with a choice that needs no money, so a run can never get stuck', () => {
  const g = REAL.find((x) => x.slug === 'money-matters');
  assert.equal(g.pack.events.length, 14);
  assert.equal(g.pack.roundsPerRun, 7);
  assert.equal(g.pack.floor, 0);
  g.pack.events.forEach((e, i) => {
    assert.ok(e.options.length >= 2, `event ${i + 1}: at least two choices`);
    assert.ok(e.options.some((o) => Object.values(o.delta || {}).every((v) => v >= 0)), `event ${i + 1}: at least one choice needs no money`);
    assert.ok(!/[–—]/.test(e.prompt + e.options.map((o) => o.label).join(' ')), `event ${i + 1}: no dashes`);
  });
  const reductions = g.pack.events.map((e) => Math.max(0, ...e.options.map((o) => -(o.delta['Card Debt'] || 0))));
  assert.ok(reductions.reduce((a, b) => a + b, 0) < g.pack.startingResources['Card Debt'], 'the pay-down choices add up to less than the starting card balance');
});

test('MONEY MATTERS: simulated runs never go below zero, the card is never over-paid, and every one of the five endings can be reached', () => {
  const g = REAL.find((x) => x.slug === 'money-matters');
  const pack = g.pack;
  let seedN = 1;
  const seen = new Set();
  for (let run = 0; run < 4000; run++) {
    const prepared = prep(pack, 'simulation', seedN++).pack;
    assert.equal(prepared.events.length, 7);
    const res = { ...pack.startingResources };
    const pick = sdk.mulberry32(run + 91);
    for (const e of prepared.events) {
      const ok = e.options.filter((o) => Object.entries(o.delta || {}).every(([k, v]) => (res[k] || 0) + v >= 0));
      assert.ok(ok.length >= 1, 'a free choice is always available');
      e.options.forEach((o) => assert.ok((res['Card Debt'] || 0) + (o.delta['Card Debt'] || 0) >= 0, 'a choice is never greyed out for lack of card balance, only for lack of money'));
      const o = ok[Math.floor(pick() * ok.length)];
      Object.entries(o.delta || {}).forEach(([k, v]) => { res[k] = (res[k] || 0) + v; });
      assert.ok(Object.values(res).every((v) => v >= 0), 'no counter goes negative');
    }
    seen.add(pack.debrief(res).split('.')[0]);
  }
  assert.equal(seen.size, 5, `endings reached: ${[...seen].join(' | ')}`);
});

// Critical Read (reworked 2026-11-01, approved outline: docs/tune-your-brain/CRITICAL_READ_OUTLINE.md): a 12-item pool, 6 drawn per run.
test('CRITICAL READ: twelve items, six per run, five sentences, four conclusions each', () => {
  const g = REAL.find((x) => x.slug === 'critical-read');
  assert.equal(g.pack.items.length, 12);
  assert.equal(g.pack.roundsPerRun, 6);
  g.pack.items.forEach((it, i) => {
    assert.equal(it.choices.length, 4, `item ${i + 1}: one right conclusion and three wrong ones`);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 4, `item ${i + 1}: unique ids`);
    assert.ok(it.choices.some((c) => c.id === it.correctChoiceId), `item ${i + 1}: right answer present`);
    assert.ok(it.passage.length >= 5 && it.passage.length <= 7, `item ${i + 1}: 5 to 7 sentences`);
    assert.ok(it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length, `item ${i + 1}: evidence index in range`);
    assert.ok(it.explanation && it.explanation.length > 80, `item ${i + 1}: explanation`);
    assert.ok(!/[–—]/.test(it.passage.join(' ') + it.question + it.choices.map((c) => c.text).join(' ') + it.explanation), `item ${i + 1}: no dashes`);
  });
});

test('CRITICAL READ: conclusion lengths are balanced, the right one is not usually the longest, the proving sentence is spread 3/3/3/3', () => {
  const g = REAL.find((x) => x.slug === 'critical-read');
  let longest = 0;
  const count = [0, 0, 0, 0, 0, 0, 0];
  g.pack.items.forEach((it, i) => {
    const lens = it.choices.map((c) => c.text.length);
    assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.4, `item ${i + 1}: lengths ${lens.join('/')} are more than 1.4 times apart`);
    if (it.choices.find((c) => c.id === it.correctChoiceId).text.length === Math.max(...lens)) longest++;
    count[it.correctEvidenceIndex]++;
  });
  assert.ok(longest <= 4, `the right conclusion is the longest in ${longest} of 12 items`);
  assert.equal(count.slice(0, 4).join(), '3,3,3,3');
});

test('CRITICAL READ: passages read at about grades 6 to 13, and runs differ', () => {
  const g = REAL.find((x) => x.slug === 'critical-read');
  g.pack.items.forEach((it, i) => {
    const grade = fkGrade([...it.passage]);
    assert.ok(grade >= 6 && grade <= 13, `item ${i + 1}: Flesch-Kincaid grade ${grade.toFixed(1)}`);
  });
  const sets = new Set(), slots = [0, 0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const out = prep(g.pack, 'evidenceHunt', seed).pack;
    assert.equal(out.items.length, 6);
    sets.add(out.items.map((it) => it.passage[0].slice(0, 14)).sort().join('|'));
    out.items.forEach((it) => { slots[it.choices.findIndex((c) => c.id === it.correctChoiceId)]++; });
  }
  assert.ok(sets.size > 20, `only ${sets.size} different sets of items in 200 runs`);
  slots.forEach((n, s) => assert.ok(n / 1200 > 0.18 && n / 1200 < 0.32, `slot ${s} holds ${Math.round(n / 12)}% of right conclusions`));
});

// Values Compass (new 2026-11-01, approved outline: docs/tune-your-brain/VALUES_COMPASS_OUTLINE.md): 12 stories, 5 per run.
test('VALUES COMPASS: twelve stories, four per run (then Your turn), each with noticing cues and values', () => {
  const g = REAL.find((x) => x.slug === 'values-compass');
  assert.equal(g.pack.scenarios.length, 12);
  assert.equal(g.pack.roundsPerRun, 4);
  ['cues', 'afterCues', 'pick', 'confirmCues', 'confirmPick', 'multiLabel'].forEach((k) => assert.ok(g.pack.prompts[k], `prompts.${k}`));
  const sets = new Set(), ids = new Set();
  g.pack.scenarios.forEach((s, i) => {
    assert.equal(s.cues.length, 4, `story ${i + 1}: four cues`);
    assert.equal(s.cues.filter((c) => c.present).length, 3, `story ${i + 1}: three cues really happen`);
    assert.equal(s.feelings.length, 4, `story ${i + 1}: four values`);
    assert.equal(s.feelings.filter((f) => f.tag === 'plausible').length, 3, `story ${i + 1}: three values fit`);
    const less = s.feelings.filter((f) => f.tag === 'less_fitting');
    assert.equal(less.length, 1, `story ${i + 1}: one value fits less`);
    assert.ok(less[0].note && less[0].note.length > 20, `story ${i + 1}: a gentle note explains it`);
    assert.ok(s.reinforcement && s.illustration && s.context.length > 60, `story ${i + 1}: context, picture and a closing line`);
    const text = [s.context, s.reinforcement].concat(s.cues.map((c) => c.text), s.feelings.map((f) => f.text + (f.note || ''))).join(' ');
    assert.ok(!/[–—]/.test(text), `story ${i + 1}: no dashes`);
    [...s.cues, ...s.feelings].forEach((x) => { assert.ok(!ids.has(x.id), `duplicate id ${x.id}`); ids.add(x.id); });
    sets.add(s.feelings.filter((f) => f.tag === 'plausible').map((f) => f.text).sort().join('|'));
  });
  assert.equal(sets.size, 12, 'no two stories share the same set of values');
});

test('VALUES COMPASS: the one-tap check is present, in order, and never logged; runs differ', () => {
  const g = REAL.find((x) => x.slug === 'values-compass');
  const sc = g.pack.selfCheck;
  assert.ok(sc.prompt && sc.privateNote && sc.summaryLabel);
  assert.equal(sc.options.map((o) => o.id).join(), 'yes,little,not-sure');
  assert.ok(!sc.bodyPrompt && !sc.bodyOptions, 'Release 138: one tap per story, the second question moved to Your turn');
  assert.ok(!/[–—]/.test(JSON.stringify(sc)));
  const sets = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const out = prep(g.pack, 'scenarioChoice', seed).pack;
    assert.equal(out.scenarios.length, 4);
    assert.equal(JSON.stringify(out.selfCheck), JSON.stringify(sc), 'the private check keeps its order');
    sets.add(out.scenarios.map((s) => s.context.slice(0, 10)).sort().join('|'));
  }
  assert.ok(sets.size > 20, `only ${sets.size} different sets of stories in 100 runs`);
});
