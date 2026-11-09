// Release 138: the "Your turn" finale of Strength Spotter and Values Compass. Plays whole runs of the real engine and the real packs on a
// small fake DOM: one story, the one-tap check, then the three finale steps and the result card. Checks the card is built from the
// child's own picks, that nothing the child picks is ever logged, and that "not sure" paths still end with a sensible card.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractPack, ROOT } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));
const sdk = require(path.join(ROOT, 'engine-sdk.js'));

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this._text = ''; this._html = ''; this.disabled = false; this.hidden = false; this.className = ''; this.type = '';
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

function play(slug, bandFallback) {
  const src = fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8');
  const pack = extractPack(src);
  const band = (src.match(/params\.get\('band'\) \|\| '([a-z]+)'/) || [])[1] || bandFallback;
  const timers = [], events = [], spoken = [];
  const shell = {
    renderProgress: (c, t, w) => { const e = new El('div'); e.textContent = `${w} ${c} of ${t}`; return e; },
    renderFeedback: (k, m) => { const e = new El('div'); e.textContent = m; return e; },
  };
  const win = { FnEngineSDK: { registerEngine: (d) => { win.engine = d; }, t: sdk.t, stepLabels: sdk.stepLabels }, FnGameShell: shell, FnVoice: { say: (p) => { spoken.push(...[].concat(p)); }, stop() {} } };
  const ctx = { window: win, document: { createElement: (t) => new El(t) }, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, Date, Math, Set, Object, Array, String, Number, JSON, console, FnGameShell: shell, FnEngineSDK: win.FnEngineSDK };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'engine-scenario-choice.js'), 'utf8'), ctx, { filename: 'engine-scenario-choice.js' });
  const prepared = sdk.prepareContentPack(Object.assign({}, pack, { roundsPerRun: 1 }), 'scenarioChoice', sdk.mulberry32(3)).pack;
  const container = new El('div');
  let summary = null;
  win.engine.mount(container, { contentPack: prepared, band, onEvidence: (type, meta) => events.push({ type, meta }), onComplete: (s) => { summary = s; } });
  const [progress, context, , prompt, choice, confirm, feedback] = container.children;
  const flush = () => { let guard = 0; while (timers.length && guard++ < 200) timers.shift()(); };
  const list = () => choice.children[0].children;
  const buttons = () => list().map((b) => b.textContent);
  const pick = (...i) => i.forEach((n) => list()[n].click());
  const ok = () => { confirm.children[0].click(); flush(); };
  // One story: clue, strength or value, the one-tap check.
  const story = () => {
    pick(0); ok(); pick(0); ok(); list()[0].click(); flush();
    // Some Discover stories end with a "tell a grown-up" screen and a Continue button.
    if (confirm.children[0] && /Continue/.test(confirm.children[0].textContent)) { confirm.children[0].click(); flush(); }
  };
  return { prepared, events, spoken, story, list, buttons, pick, ok, flush, prompt: () => prompt.textContent, progress: () => progress.textContent,
    card: () => [...choice.children[0].innerHTML.matchAll(/<p class="fn-story-text">(.*?)<\/p>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&amp;/g, '&')), feedback: () => feedback.textContent, finishBtn: () => confirm.children[0], confirmBtn: () => confirm.children[0], summary: () => summary, pack };
}

test('STRENGTH SPOTTER: one story, the one-tap check, then three finale steps and a card built from the picks', () => {
  const g = play('strength-spotter');
  assert.equal(g.prepared.scenarios.length, 1);
  g.story();
  assert.match(g.prompt(), /Pick up to two strengths/);
  assert.equal(g.progress(), 'Your turn 1 of 3');
  const names = g.buttons();
  assert.deepEqual(names.slice(0, 8), ['Patience', 'Persistence', 'Kindness', 'Courage', 'Curiosity', 'Responsibility', 'Listening', 'Creativity']);
  assert.equal(names[8], "I'm not sure yet");
  g.pick(0, 6); g.ok();                                                  // Patience and Listening
  assert.match(g.prompt(), /Where have you used it lately\?/);
  g.pick(0); g.flush();                                                  // At school
  assert.equal(g.prompt(), 'Pick one small way to grow your patience.');
  assert.equal(g.buttons().length, 3);
  assert.equal(g.buttons()[0], 'Count to five before you answer someone.');
  g.pick(0); g.flush();
  assert.deepEqual(g.card(), ['My strength: patience and listening.', 'I use patience at school.', 'My next step: count to five before you answer someone.']);
  assert.match(g.feedback(), /Only you see this card/);
  assert.equal(g.summary(), null);
  g.finishBtn().click();
  const labels = g.summary().map((s) => s.label);
  assert.ok(labels.includes('Questions you answered about yourself'));
  assert.equal(g.summary().find((s) => s.label === 'Questions you answered about yourself').value, 3);
});

test('STRENGTH SPOTTER: "not sure" still ends in a kind card, and a limit of two picks is held', () => {
  const g = play('strength-spotter');
  g.story();
  g.pick(0, 1, 2);                                                       // third pick must not register
  assert.equal(g.list()[2].disabled, true);
  g.pick(8);                                                             // "I'm not sure yet" replaces the picks
  g.ok();
  g.pick(5); g.flush();                                                  // "I'm not sure" where
  assert.equal(g.prompt(), 'Pick one small step you could try.');
  g.pick(1); g.flush();
  assert.deepEqual(g.card(), ['My next step: ask someone what they think you are good at.']);
});

test('VALUES COMPASS: rank three values, face a tradeoff between two of them, and get a compass card', () => {
  const g = play('values-compass');
  g.story();
  assert.match(g.prompt(), /three values that matter most to you right now/);
  g.pick(0, 2, 5);                                                       // honesty, loyalty, courage in that order
  assert.deepEqual(g.buttons().slice(0, 1), ['1. Honesty']);
  assert.equal(g.buttons()[2], '2. Loyalty');
  assert.equal(g.buttons()[5], '3. Courage');
  g.ok();
  assert.match(g.prompt(), /A friend broke a school rule/, 'the pair that best overlaps the ranked values (honesty and loyalty)');
  assert.equal(g.buttons().length, 3);
  assert.equal(g.buttons()[2], 'It depends');
  g.pick(0); g.flush();
  assert.equal(g.prompt(), 'Where did you act on honesty this week?');
  g.pick(0); g.flush();
  assert.deepEqual(g.card(), ['My top three: honesty, loyalty and courage.', 'When honesty and loyalty pulled apart, I leaned toward honesty.', 'This week I acted on honesty at school.']);
  assert.match(g.feedback(), /Values can change as you grow/);
});

test('VALUES COMPASS: an unranked start still gets a tradeoff and a card with no empty sentences', () => {
  const g = play('values-compass');
  g.story();
  g.pick(8); g.ok();                                                     // "I'm not sure yet"
  assert.ok(g.prompt().length > 40, 'the first tradeoff is used');
  g.pick(2); g.flush();                                                  // It depends
  assert.equal(g.prompt(), 'Where did you act on something you care about this week?');
  g.pick(5); g.flush();                                                  // I'm not sure
  const lines = g.card();
  assert.deepEqual(lines, ['When honesty and loyalty pulled apart, I said it depends.']);
  lines.forEach((l) => assert.ok(!/\{|\}|  /.test(l)));
});

const MANIFEST = (() => { const m = {}; const ctx = { window: { FnAudioManifest: m } }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/audio/discover/feelings-detective.js'), 'utf8'), ctx); return m; })();
const clean = (x) => String(x == null ? '' : x).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();

test('FEELINGS DETECTIVE: three stories, one tap each, then my feelings, where I feel it and what helps, ending in a spoken feeling card', () => {
  const g = play('feelings-detective');
  assert.equal(g.prepared.scenarios.length, 1);
  g.story();
  assert.equal(g.prompt(), 'How do you feel right now? Pick one or two.');
  assert.deepEqual(g.buttons().map((b) => b.replace(/\p{Extended_Pictographic}/gu, '').trim()), ['Happy', 'Sad', 'Angry', 'Scared', 'Nervous', 'Excited', 'Proud', 'Calm', "I'm not sure"]);
  g.pick(0, 4); g.ok();                                                  // Happy and Nervous
  assert.equal(g.prompt(), 'Where do you feel it in your body?');
  g.pick(0); g.flush();                                                  // My tummy
  assert.equal(g.prompt(), 'What helps you with this feeling? Pick one.');
  assert.equal(g.buttons().length, 5);
  g.pick(0); g.flush();                                                  // Slow breaths
  assert.deepEqual(g.card(), ['I feel happy.', 'I feel nervous.', 'I feel it in my tummy.', 'Slow breaths help me.']);
  assert.match(g.feedback(), /Only you see this card/);
  g.finishBtn().click();
  assert.equal(g.summary().find((x) => x.label === 'Questions about you').value, 3);
});

test('FEELINGS DETECTIVE: "not sure" answers still end in a kind card', () => {
  const g = play('feelings-detective');
  g.story();
  g.pick(8); g.ok();                                                     // I'm not sure
  g.pick(5); g.flush();                                                  // not sure where
  g.pick(4); g.flush();                                                  // not sure what helps
  assert.deepEqual(g.card(), ['That is okay. Feelings can be hard to name.']);
  const h = play('feelings-detective');
  h.story(); h.pick(8); h.ok(); h.pick(5); h.flush(); h.pick(1); h.flush();
  assert.deepEqual(h.card(), ['Telling a grown-up helps me.']);
});

test('FEELINGS DETECTIVE: every line the child hears, in the stories and in Your turn, has a recorded clip', () => {
  const g = play('feelings-detective');
  g.story(); g.pick(0, 4); g.ok(); g.pick(0); g.flush(); g.pick(1); g.flush();
  assert.ok(g.spoken.length > 12);
  for (const line of g.spoken) assert.ok(MANIFEST[clean(line)], `no recorded clip for: ${line}`);
  for (const f of new Set(Object.values(MANIFEST))) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
});

test('YOUR TURN: nothing the child picks is ever logged, and the old second question is gone', () => {
  for (const slug of ['feelings-detective', 'strength-spotter', 'values-compass']) {
    const g = play(slug);
    g.story();
    if (slug === 'feelings-detective') { g.pick(0, 4); g.ok(); g.pick(0); g.flush(); g.pick(0); g.flush(); } else if (slug === 'strength-spotter') { g.pick(0, 6); g.ok(); g.pick(1); g.flush(); g.pick(0); g.flush(); } else { g.pick(0, 2, 5); g.ok(); g.pick(1); g.flush(); g.pick(1); g.flush(); }
    const log = JSON.stringify(g.events);
    ['Patience', 'Listening', 'Honesty', 'Loyalty', 'Courage', 'honesty', 'loyalty', 'school', 'home', 'Count to five', 'pulled apart', 'Happy', 'Nervous', 'tummy', 'Slow breaths'].forEach((w) => assert.ok(!log.includes(w), `${slug}: ${w} is in the log`));
    const own = g.events.filter((e) => e.meta && e.meta.stage === 'own_turn');
    assert.deepEqual(own.map((e) => e.type), ['item_presented', 'response_submitted', 'item_presented', 'response_submitted', 'item_presented', 'response_submitted']);
    own.forEach((e) => assert.deepEqual(Object.keys(e.meta).sort(), ['stage', 'stepIndex', 'stepType'], 'only the step number and type are recorded'));
    assert.ok(g.events.every((e) => !e.meta || e.meta.stage !== 'self_check_body'), 'no second self-check question');
  }
});

test('YOUR TURN: all three packs hold to the writing rules; Strength Spotter and Values Compass keep four stories per run, Feelings Detective three', () => {
  const { check } = require(path.join(__dirname, '..', 'scripts', 'own-turn-lines.js'));
  assert.equal(extractPack(fs.readFileSync(path.join(ROOT, 'brain-feelings-detective.html'), 'utf8')).roundsPerRun, 3);
  assert.deepEqual(check('feelings-detective'), []);
  for (const slug of ['strength-spotter', 'values-compass']) {
    const bad = check(slug);
    assert.deepEqual(bad, [], bad.join('\n'));
    const pack = extractPack(fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8'));
    assert.equal(pack.roundsPerRun, 4);
    assert.equal(pack.ownTurn.steps.length, 3);
    assert.ok(!pack.selfCheck.bodyPrompt && !pack.selfCheck.bodyOptions, 'the per-story check is one tap');
    assert.equal(pack.selfCheck.options.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(pack.ownTurn.steps.map((s) => s.type))), slug === 'strength-spotter' ? ['pickMany', 'pickOne', 'pickOne'] : ['rank', 'tradeoff', 'pickOne']);
  }
  const load = (f) => JSON.parse(JSON.stringify(extractPack(fs.readFileSync(path.join(ROOT, f), 'utf8')).ownTurn));
  const strength = load('brain-strength-spotter.html');
  const map = strength.steps[2].optionsBy.map;
  assert.deepEqual(Object.keys(map).sort(), strength.steps[0].options.map((o) => o.id).sort(), 'every strength has its own growth steps');
  Object.values(map).forEach((opts) => assert.equal(opts.length, 3));
  const values = load('brain-values-compass.html');
  const ids = values.steps[0].options.map((o) => o.id);
  assert.equal(values.steps[1].pairs.length, 6);
  values.steps[1].pairs.forEach((p) => { assert.ok(ids.includes(p.a) && ids.includes(p.b), `${p.a} and ${p.b} are among the ranked values`); assert.notEqual(p.a, p.b); });
  ids.forEach((id) => assert.ok(values.steps[1].pairs.some((p) => p.a === id || p.b === id), `${id} appears in a tradeoff`));
});

test('YOUR TURN: the page versions and the engine contract are in place', () => {
  for (const f of ['brain-strength-spotter.html', 'brain-values-compass.html', 'brain-feelings-detective.html']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /engine-scenario-choice\.js\?v=10/);
  const eng = fs.readFileSync(path.join(ROOT, 'engine-scenario-choice.js'), 'utf8');
  assert.match(eng, /Deliberately NOT logging what was picked/);
  assert.ok(!/onEvidence\([^)]*(picks|chosen|opt\.text)/.test(eng), 'the engine never passes a pick to onEvidence');
});

test('DOUBLE TAP: tapping a confirm or Continue button twice does not run a screen twice or break Your turn', () => {
  const g = play('feelings-detective');
  // Clue stage: tap "I see these" twice, then the feelings stage: tap "I picked these" twice.
  g.pick(0); g.confirmBtn().click(); g.confirmBtn().click(); g.flush();
  g.pick(0); g.confirmBtn().click(); g.confirmBtn().click(); g.flush();
  g.list()[0].click(); g.list()[0].click(); g.flush();
  if (g.confirmBtn() && /Continue/.test(g.confirmBtn().textContent)) { g.confirmBtn().click(); g.confirmBtn().click(); g.flush(); }
  assert.equal(g.prompt(), 'How do you feel right now? Pick one or two.', 'Your turn starts once and is not overwritten by a leftover screen');
  const presented = g.events.filter((e) => e.type === 'item_presented' && e.meta.stage === 'cues').length;
  assert.equal(presented, 1, 'the one story was presented once');
  assert.equal(g.events.filter((e) => e.meta && e.meta.stage === 'feelings' && e.type === 'response_submitted').length, 1, 'the feelings were submitted once');
  g.pick(0); g.ok(); g.pick(0); g.flush(); g.pick(0); g.flush();
  const fin = g.finishBtn(); fin.click(); fin.click(); // the same button, tapped twice
  assert.equal(g.summary().find((x) => x.label === 'Questions about you').value, 3, 'the summary counts three answers');
});
