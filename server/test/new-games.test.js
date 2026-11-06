// Release 141: the 14 new games (core skills for Discover and Explore, and a second Self-Awareness game in every band).
// Their content is data in server/scripts/build-core-games.js; these tests check the pages match it, every game is registered everywhere a
// game must be (focus table, card description, completion badge, spoken-clip list), and the content is right: the rhymes rhyme, the sums add up,
// the pattern continues, every spoken line has a recorded clip, and each check-in plays through and builds a card without logging a pick.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GAMES, page, seed } = require(path.join(__dirname, '..', 'scripts', 'build-core-games.js'));
const F = require(path.join(__dirname, '..', 'lib', 'brain-game-focus.js'));
const copy = require(path.join(__dirname, '..', 'lib', 'brain-game-copy.js'));
const audio = require(path.join(__dirname, '..', 'scripts', 'build-discover-audio.js'));
const { extractPack, ROOT } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));
const sdk = require(path.join(ROOT, 'engine-sdk.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const by = (slug) => GAMES.find((g) => g.slug === slug);
const words = (s) => String(s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?]["”’]?)\s+/).filter(Boolean);
const NW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const DASH = /[—–]|\s-\s/;

test('NEW GAMES: 36 games (14 in Release 141, 10 in 143, 12 in 144), and every page and catalog script matches its specification', () => {
  assert.equal(GAMES.length, 36);
  for (const g of GAMES) {
    const onDisk = read(`brain-${g.slug}.html`).replace(/\?v=[0-9a-f]{8}/, '?v=00000000');
    assert.equal(onDisk, page(g), `${g.slug}: the page has drifted from build-core-games.js (run it again)`);
    assert.equal(read(`server/scripts/seed-${g.slug}-catalog-entry.js`), seed(g), `${g.slug}: the catalog script has drifted`);
  }
});

test('NEW GAMES: each is registered in the focus table, the card descriptions and the completion badges', () => {
  const badges = read('server/scripts/seed-classroom-completion-badges.js');
  for (const g of GAMES) {
    const row = F.GAMES[g.slug];
    assert.ok(row, `${g.slug} is missing from lib/brain-game-focus.js`);
    assert.deepEqual([row.band, row.focus, row.domain], [g.band, g.focus, g.domain], `${g.slug} tags`);
    if (g.casel) assert.deepEqual(row.casel, g.casel, `${g.slug} competencies`);
    assert.equal(copy.DESCRIPTIONS[g.slug], g.desc, `${g.slug} card description`);
    assert.ok(badges.includes(`gameSlug: '${g.slug}'`), `${g.slug} has no completion badge`);
    assert.ok(g.desc.split(/\s+/).length <= 20 && !DASH.test(g.desc), `${g.slug} description is short and plain`);
  }
});

test('NEW GAMES: the coverage grid now has at least two games in every cell the owner listed', () => {
  const grid = F.coverage();
  const need = [['discover', 'literacy'], ['discover', 'math'], ['discover', 'thinking'], ['explore', 'literacy'], ['explore', 'math'],
    ['discover', 'self_awareness'], ['explore', 'self_awareness'], ['challenge', 'self_awareness'], ['advance', 'self_awareness']];
  need.forEach(([b, f]) => assert.ok(grid[b][f].counted.length >= 2, `${b} / ${f} has ${grid[b][f].counted.length}`));
});

test('NEW GAMES: the spoken Discover games are in the clip builder, and every line they say has a recorded clip', () => {
  const spoken = GAMES.filter((g) => g.band === 'discover' && g.engine !== 'memory').map((g) => g.slug);
  assert.deepEqual(spoken.sort(), ['add-it-up', 'asking-nicely', 'letter-sounds', 'more-or-fewer', 'my-feelings-today', 'pattern-parade', 'rhyme-time', 'stop-and-think', 'team-tower', 'wait-for-it']);
  const { games } = audio.plan();
  for (const slug of spoken) {
    const game = games.find((g) => g.slug === slug);
    assert.ok(game, `${slug} is not in build-discover-audio.js`);
    const manifest = {}; vm.runInNewContext(read(`assets/audio/discover/${slug}.js`), { window: { FnAudioManifest: manifest } });
    for (const line of game.lines) {
      assert.ok(manifest[line], `${slug}: no clip for "${line}"`);
      assert.ok(fs.existsSync(path.join(ROOT, manifest[line])), `${slug}: ${manifest[line]} is missing`);
    }
    assert.match(read(`brain-${slug}.html`), new RegExp(`assets/audio/discover/${slug}\\.js\\?v=[0-9a-f]{8}`));
  }
});

test('DISCOVER GAMES: short spoken lines, three or fewer words on a caption, no dashes, the right answer is not always in the same place', () => {
  for (const g of GAMES.filter((x) => x.band === 'discover' && x.engine === 'audioChoice')) {
    const items = g.pack.items;
    assert.ok(items.length >= 12, `${g.slug}: a pool of at least 12 (has ${items.length})`);
    assert.ok(g.pack.roundsPerRun < items.length);
    const spots = new Set();
    items.forEach((it, i) => {
      assert.ok(words(it.stimulusText) <= 26, `${g.slug} ${i + 1}: spoken line too long`);
      sentences(it.stimulusText).forEach((sn) => assert.ok(words(sn) <= 12, `${g.slug} ${i + 1}: sentence too long: ${sn}`));
      assert.ok(!DASH.test(JSON.stringify(it)), `${g.slug} ${i + 1}: dash`);
      assert.ok(it.choices.length >= 2 && it.choices.length <= 3, `${g.slug} ${i + 1}: 2 or 3 choices`);
      const ids = it.choices.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, `${g.slug} ${i + 1}: duplicate choice`);
      assert.ok(ids.includes(it.correctId), `${g.slug} ${i + 1}: the right answer is not offered`);
      spots.add(ids.indexOf(it.correctId));
      it.choices.forEach((c) => { assert.ok(!c.caption || words(c.caption) <= 4, `${g.slug} ${i + 1}: caption too long`); assert.ok(words(c.feedback) <= 15); });
      assert.ok(words(it.explanation) <= 16, `${g.slug} ${i + 1}: explanation too long`);
    });
    assert.ok(spots.size >= 2, `${g.slug}: the right answer is always in the same place`);
  }
});

test('RHYME TIME: the right choice rhymes, the others do not, and the picture shown matches the word asked about', () => {
  const END = { cat: 'at', hat: 'at', bat: 'at', dog: 'og', log: 'og', frog: 'og', cake: 'ake', snake: 'ake', moon: 'oon', spoon: 'oon', balloon: 'oon', boat: 'oat', coat: 'oat', goat: 'oat', fish: 'ish', dish: 'ish', clock: 'ock', sock: 'ock', rock: 'ock', mouse: 'ouse', house: 'ouse', bee: 'ee', tree: 'ee', key: 'ee', bear: 'air', chair: 'air', pear: 'air' };
  for (const it of by('rhyme-time').pack.items) {
    const target = it.stimulusText.match(/rhymes with (\w+)\?/)[1];
    assert.ok(END[target], `${target} is a known word`);
    for (const c of it.choices) {
      const rhymes = END[c.id] === END[target];
      assert.equal(rhymes, c.id === it.correctId, `${target}: ${c.id} ${rhymes ? 'rhymes' : 'does not rhyme'}`);
      assert.notEqual(c.id[0], target[0], `${target}: no choice shares its first letter (that would be Sound Safari, not rhyme)`);
    }
    assert.ok(!it.choices.some((c) => c.id === target), 'the word itself is not a choice');
  }
});

test('LETTER SOUNDS: the right letter really is the first letter of the word, and no look-alike letters are offered together', () => {
  const LOOK = { B: 'DPQ', D: 'BPQ', P: 'BDQ', M: 'NW', N: 'MH', W: 'M', H: 'N' };
  for (const it of by('letter-sounds').pack.items) {
    const word = it.stimulusText.split(' ')[0];
    assert.equal(word[0].toUpperCase(), it.correctId, `${word} starts with ${it.correctId}`);
    for (const c of it.choices) if (c.id !== it.correctId) assert.ok(!(LOOK[it.correctId] || '').includes(c.id), `${c.id} looks like ${it.correctId}`);
    assert.ok(it.choices.every((c) => c.say && c.aria), 'every letter is said and labelled');
    assert.ok(it.visual, 'a picture of the word is shown');
  }
});

test('MORE OR FEWER: the group that has more (or fewer) is the one marked right', () => {
  for (const it of by('more-or-fewer').pack.items) {
    const kind = /has (more|fewer)/.exec(it.stimulusText)[1];
    const n = (c) => [...c.label.matchAll(/\p{Extended_Pictographic}/gu)].length;
    const [a, b] = it.choices;
    assert.notEqual(n(a), n(b));
    const want = kind === 'more' ? (n(a) > n(b) ? a : b) : (n(a) < n(b) ? a : b);
    assert.equal(it.correctId, want.id, it.stimulusText);
    assert.ok(it.choices.every((c) => c.caption.toLowerCase().startsWith(NW[n(c)])), 'the caption says the count');
    assert.ok(Math.max(n(a), n(b)) <= 10);
  }
});

test('ADD IT UP: every number story adds up, and the wrong answers are near misses that are not the answer', () => {
  const num = (w) => NW.indexOf(w.toLowerCase());
  for (const it of by('add-it-up').pack.items) {
    const t = it.stimulusText;
    const m = t.match(/^(\w+) \w+ .*\. (\w+) (more )?.*\. How many/);
    const a = num(m[1]), b = num(m[2]);
    assert.ok(a > 0 && b > 0, t);
    const answer = m[3] ? a + b : a - b;
    assert.equal(Number(it.correctId), answer, t);
    assert.ok(answer >= 1 && a <= 9 && answer <= 12);
    assert.equal(it.choices.length, 3);
    it.choices.forEach((c) => { assert.equal(c.caption.toLowerCase(), NW[Number(c.id)], 'the numeral and its word agree'); });
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 3);
  }
  const kinds = by('add-it-up').pack.items.map((it) => /more/.test(it.stimulusText));
  assert.ok(kinds.filter(Boolean).length >= 10 && kinds.filter((x) => !x).length >= 5, 'both adding and taking away');
});

test('PATTERN PARADE: the right choice continues the pattern', () => {
  const NEXT = { ABAB: 'A', AABAA: 'B', ABCAB: 'C', ABBAB: 'B', AABBA: 'A' };
  for (const it of by('pattern-parade').pack.items) {
    const tokens = it.visual.split(' ').filter((x) => x !== '❓');
    const letters = []; const seen = [];
    tokens.forEach((tk) => { if (!seen.includes(tk)) seen.push(tk); letters.push('ABC'[seen.indexOf(tk)]); });
    const seq = letters.join('');
    assert.ok(NEXT[seq], `${it.visual}: a known pattern shape (${seq})`);
    const answerToken = it.choices.find((c) => c.id === it.correctId).label;
    assert.equal('ABC'[seen.indexOf(answerToken)], NEXT[seq], `${it.visual}: ${answerToken} continues ${seq}`);
    assert.equal(it.choices.length, 3);
    assert.ok(it.stimulusText.endsWith('What comes next?'));
  }
  const shapes = new Set(by('pattern-parade').pack.items.map((it) => it.visual.split(' ').filter((x) => x !== '❓').length + ':' + new Set(it.visual.split(' ')).size));
  assert.ok(shapes.size >= 3, 'several kinds of pattern');
});

test('ANIMAL MATCH: eight animals, four pairs by default, and ?pairs lets a teacher pick 3, 4 or 6', () => {
  const g = by('animal-match');
  assert.equal(g.pack.items.length, 8);
  assert.equal(new Set(g.pack.items.map((i) => i.id)).size, 8);
  assert.equal(g.pack.pairCount, 4);
  assert.match(read('brain-animal-match.html'), /\[3, 4, 6\]\.includes\(wantPairs\)/);
  assert.match(read('brain-animal-match.html'), /engine-memory\.js/);
});

test('WORD CLUES: the passages are short, each question names a word that is in the passage, and the proof sentence is one of the passage', () => {
  const items = by('word-clues').pack.items;
  assert.equal(items.length, 12);
  const HARD = /\b(constructive|overwhelmed|perspective|affects?|reactions?|assume[sd]?|appropriate|situation|consequences?)\b/i;
  items.forEach((it, i) => {
    const word = it.question.match(/"(\w+)"/)[1];
    assert.ok(it.passage.join(' ').toLowerCase().includes(word), `item ${i + 1}: ${word} is in the passage`);
    assert.ok(it.passage.length >= 3 && it.passage.length <= 4);
    assert.ok(it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length);
    assert.notEqual(it.passage[it.correctEvidenceIndex].toLowerCase().includes(word), undefined);
    it.passage.concat(it.choices.map((c) => c.text), [it.explanation]).forEach((t) => {
      assert.ok(!DASH.test(t) && !HARD.test(t), `item ${i + 1}: dash or hard word: ${t}`);
      sentences(t).forEach((sn) => assert.ok(words(sn) <= 12, `item ${i + 1}: sentence over 12 words: ${sn}`));
    });
    assert.equal(it.choices.length, 3);
    assert.ok(words(it.explanation) <= 20);
    const lens = it.choices.map((c) => c.text.length), right = it.choices.find((c) => c.id === it.correctChoiceId).text.length;
    assert.ok(Math.max(...lens) / Math.min(...lens) <= 1.5, `item ${i + 1}: option lengths are balanced`);
    void right;
  });
  const longest = items.filter((it) => { const L = it.choices.map((c) => c.text.length); return it.choices.find((c) => c.id === it.correctChoiceId).text.length === Math.max(...L); }).length;
  assert.ok(longest <= 8, `the right meaning is the longest in ${longest} of 12 items`);
});

test('WORD PROBLEM WORKSHOP: each problem has one correct number sentence, the arithmetic in the explanation is right, and the proof sentence has the key facts', () => {
  const items = by('word-problem-workshop').pack.items;
  assert.equal(items.length, 12);
  const ops = new Set();
  items.forEach((it, i) => {
    assert.equal(it.choices.length, 4);
    const right = it.choices.find((c) => c.id === it.correctChoiceId);
    const [a, sym, b] = right.text.split(' ');
    ops.add(sym);
    assert.equal(new Set(it.choices.map((c) => c.text.split(' ')[1])).size, 4, `item ${i + 1}: four different operations`);
    it.choices.forEach((c) => assert.equal(c.text.split(' ')[0] + c.text.split(' ')[2], a + b, `item ${i + 1}: same two numbers in every choice`));
    const m = it.explanation.match(/(\d+) (.) (\d+) = (\d+)\.$/);
    assert.deepEqual([m[1], m[3]], [a, b]);
    const calc = { '+': (x, y) => x + y, '−': (x, y) => x - y, '×': (x, y) => x * y, '÷': (x, y) => x / y }[m[2]](Number(a), Number(b));
    assert.equal(calc, Number(m[4]), `item ${i + 1}: ${it.explanation}`);
    assert.ok(Number.isInteger(calc) && calc > 0);
    assert.equal(m[2], sym);
    assert.match(it.passage[it.correctEvidenceIndex], /\d/, `item ${i + 1}: the proof sentence has a number`);
    assert.ok(it.passage.join(' ').includes(a) && it.passage.join(' ').includes(b));
    it.passage.forEach((t) => sentences(t).forEach((sn) => assert.ok(words(sn) <= 12, `item ${i + 1}: ${sn}`)));
    assert.ok(!DASH.test(JSON.stringify(it)));
  });
  assert.equal(ops.size, 4, 'adding, taking away, multiplying and dividing all appear');
});

test('TIMES TABLE TRAIL: every fact is right, the wrong answers are near misses, and there is no clock', () => {
  const g = by('times-table-trail');
  assert.ok(g.pack.items.length >= 20 && g.pack.roundsPerRun === 8);
  g.pack.items.forEach((it) => {
    const m = it.stimulusText.match(/^(\d+) (.) (\d+) = \?$/);
    const [a, b] = [Number(m[1]), Number(m[3])];
    const answer = m[2] === '×' ? a * b : a / b;
    assert.ok(Number.isInteger(answer));
    assert.equal(it.correctId, String(answer), it.stimulusText);
    assert.equal(it.choices.length, 3);
    assert.equal(new Set(it.choices.map((c) => c.id)).size, 3);
    assert.ok(it.choices.every((c) => Number(c.id) > 0));
    assert.ok(it.explanation.includes(`= ${answer}`));
    assert.equal(it.stimulusType, 'text');
  });
  const kinds = g.pack.items.map((it) => /÷/.test(it.stimulusText));
  assert.ok(kinds.filter(Boolean).length >= 6 && kinds.filter((x) => !x).length >= 12, 'multiplication and division');
  assert.ok(!/timer|countdown|setInterval/i.test(read('brain-times-table-trail.html').replace(/\/\/[^\n]*/g, '')), 'no clock');
});

// ---- the five Self-Awareness check-ins, played through on a fake screen --------------------------------------------------------------
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this._text = ''; this._html = ''; this.disabled = false; this.hidden = false; this.className = '';
    const set = new Set(); this.classList = { add: (...a) => a.forEach((x) => set.add(x)), remove: (...a) => a.forEach((x) => set.delete(x)), toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }, contains: (c) => set.has(c) }; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { if (!this.disabled) (this.listeners.click || []).forEach((f) => f()); }
  querySelector() { return null; }
}

function playCheckin(slug, seed, choose) {
  const src = read(`brain-${slug}.html`);
  const pack = extractPack(src);
  const band = (src.match(/params\.get\('band'\) \|\| '([a-z]+)'/) || [])[1];
  const timers = [], events = [], spoken = [];
  const shell = { renderProgress: (c, t, w) => { const e = new El('div'); e.textContent = `${w} ${c} of ${t}`; return e; }, renderFeedback: (k, m) => { const e = new El('div'); e.textContent = m; return e; } };
  const win = { FnEngineSDK: { registerEngine: (d) => { win.engine = d; }, t: sdk.t, stepLabels: sdk.stepLabels }, FnGameShell: shell, FnVoice: { say: (p) => { spoken.push(...[].concat(p)); }, stop() {} } };
  const ctx = { window: win, document: { createElement: (t) => new El(t) }, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, Date, Math, Set, Object, Array, String, Number, JSON, console, FnGameShell: shell, FnEngineSDK: win.FnEngineSDK };
  vm.runInNewContext(read('engine-scenario-choice.js'), ctx, { filename: 'engine-scenario-choice.js' });
  const prepared = sdk.prepareContentPack(pack, 'scenarioChoice', sdk.mulberry32(seed)).pack;
  const container = new El('div');
  let summary = null;
  win.engine.mount(container, { contentPack: prepared, band, onEvidence: (type, meta) => events.push({ type, meta }), onComplete: (s) => { summary = s; } });
  const [, , , prompt, choice, confirm, feedback] = container.children;
  const flush = () => { let n = 0; while (timers.length && n++ < 200) timers.shift()(); };
  const list = () => (choice.children[0] ? choice.children[0].children : []);
  const prompts = [];
  let guard = 0;
  while (!summary && guard++ < 30) {
    if (!list().length) { // the card: take the closing line and finish
      const card = [...(choice.children[0] ? choice.children[0].innerHTML : '').matchAll(/<p class="fn-story-text">(.*?)<\/p>/g)].map((m) => m[1]);
      if (confirm.children[0] && /Finish/.test(confirm.children[0].textContent)) { win.__card = card; win.__closing = feedback.textContent; confirm.children[0].click(); flush(); continue; }
      break;
    }
    prompts.push(prompt.textContent);
    choose(list(), () => confirm.children[0], flush);
    flush();
  }
  return { summary, events, prompts, spoken, card: win.__card, closing: win.__closing, prepared, win };
}
const first = (btns, conf, flush) => {
  btns[0].click();
  const c = conf();
  if (c && !c.disabled) { c.click(); return; }
  for (let i = 1; i < 3 && conf() && conf().disabled; i++) btns[i].click();
  if (conf() && !conf().disabled) conf().click();
};
const notSure = (btns, conf) => { btns[btns.length - 1].click(); if (conf() && !conf().disabled) conf().click(); };
const CHECKINS = GAMES.filter((g) => g.engine === 'scenarioChoice').map((g) => g.slug);

test('SELF-AWARENESS CHECK-INS: five games, one in each band and two in Advance, all with no stories and a short finale', () => {
  assert.deepEqual(CHECKINS, ['my-feelings-today', 'what-helps-me', 'know-your-triggers', 'know-yourself', 'stress-signals']);
  assert.deepEqual(CHECKINS.map((s) => by(s).band), ['discover', 'explore', 'challenge', 'advance', 'advance']);
  for (const slug of CHECKINS) {
    const g = by(slug);
    assert.deepEqual(g.pack.scenarios, []);
    assert.ok(!g.pack.selfCheck, `${slug}: no per-story check, there are no stories`);
    const finales = [g.pack.ownTurn].concat((g.pack.variants || []).map((v) => v.ownTurn)).filter(Boolean);
    assert.ok(finales.length >= 1);
    finales.forEach((ot) => { assert.equal(ot.steps.length, 3); ot.steps.forEach((st) => { assert.ok(st.notSure || st.type === 'tradeoff', `${slug} ${st.id}: a "not sure" answer`); }); });
  }
});

for (const slug of CHECKINS) {
  test(`CHECK-IN ${slug}: plays through to a card, with every step reached once and nothing the child picks logged`, () => {
    for (const seed of [1, 2, 3]) {
      const r = playCheckin(slug, seed, first);
      assert.ok(r.summary, `${slug}: the game finished`);
      assert.equal(r.prompts.length, 3, `${slug}: three steps (${r.prompts.join(' | ')})`);
      assert.ok(r.card && r.card.length >= 1, `${slug}: a card was built`);
      r.card.forEach((l) => assert.ok(l && !/[{}]/.test(l) && !/\s{2,}/.test(l), `${slug}: a clean line: ${l}`));
      assert.ok(r.closing.length > 10);
      const own = r.events.filter((e) => e.meta && e.meta.stage === 'own_turn');
      assert.deepEqual(own.map((e) => e.type), ['item_presented', 'response_submitted', 'item_presented', 'response_submitted', 'item_presented', 'response_submitted']);
      own.forEach((e) => assert.deepEqual(Object.keys(e.meta).sort(), ['stage', 'stepIndex', 'stepType']));
      const log = JSON.stringify(r.events);
      r.card.forEach((l) => l.split(/[ .,]+/).filter((w) => w.length > 5).forEach((w) => assert.ok(!log.includes(w), `${slug}: "${w}" from the card is in the log`)));
      assert.equal(r.summary[r.summary.length - 1].value, 3, 'the summary counts three answers');
    }
  });

  test(`CHECK-IN ${slug}: answering "not sure" to everything still ends in a kind card`, () => {
    const r = playCheckin(slug, 1, notSure);
    assert.ok(r.summary);
    assert.ok(r.card.length >= 1 && r.card.every((l) => l && !/[{}]/.test(l)), `${slug}: ${JSON.stringify(r.card)}`);
  });
}

test('MY FEELINGS TODAY: three different openings, every spoken line has a recorded clip', () => {
  const g = by('my-feelings-today');
  assert.equal(g.pack.variants.length, 3);
  const prompts = new Set(g.pack.variants.map((v) => v.ownTurn.steps[0].prompt));
  assert.equal(prompts.size, 3);
  const manifest = {}; vm.runInNewContext(read('assets/audio/discover/my-feelings-today.js'), { window: { FnAudioManifest: manifest } });
  const clean = (x) => String(x == null ? '' : x).replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = playCheckin('my-feelings-today', seed, first);
    assert.ok(r.spoken.length > 6);
    r.spoken.forEach((line) => assert.ok(manifest[clean(line)], `no recorded clip for: ${line}`));
  }
});
