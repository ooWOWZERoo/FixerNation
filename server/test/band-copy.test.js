// Tests for the band wording table in engine-sdk.js (Release 86): the words around the content (finished screen,
// evidence feedback, money-game feedback, branching step labels) differ by Learning Group, while a page with no
// band, or a key a band does not set, keeps today's wording exactly.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const sdk = require(path.join(ROOT, 'engine-sdk.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BANDS = ['discover', 'explore', 'challenge', 'advance'];
const STEPS = ['recognize', 'impact', 'consider', 'choose', 'reflect'];

test('DEFAULTS: no band, an unknown band or no pack plays with today\'s wording', () => {
  const today = {
    summaryTitle: 'Nice work!', summaryButton: 'Play again',
    evRight: 'Correct, and well-supported by the text!',
    evWeak: "Right answer, but that's not the strongest evidence.",
    evAsk: 'Which sentence best supports your answer?',
    evLabelSupported: 'Evidence-supported', evLabelWeak: 'Right answer, weak evidence', evLabelMissed: 'Missed',
    simNext: 'Logged. Moving to the next decision...', simNextKind: 'correct', brFallback: 'Thanks for choosing.',
  };
  for (const [k, v] of Object.entries(today)) {
    assert.equal(sdk.t(k, undefined, undefined), v, `${k} with no band`);
    assert.equal(sdk.t(k, 'not-a-band', {}), v, `${k} with an unknown band`);
  }
  assert.equal(sdk.stepLabels(undefined, undefined).recognize, 'Recognize the Issue');
  assert.equal(sdk.stepLabels('not-a-band', {}).reflect, 'Reflect and Reinforce');
});

test('BANDS: each group reads its own wording where it has one, and falls back where it does not', () => {
  assert.equal(sdk.t('summaryTitle', 'discover'), 'You did it!');
  assert.equal(sdk.t('summaryButton', 'discover'), 'Play again', 'Discover keeps the default button');
  assert.equal(sdk.t('evRight', 'explore'), 'Right, and you found the proof!');
  assert.equal(sdk.t('summaryTitle', 'challenge'), 'Run complete');
  assert.equal(sdk.t('evRight', 'advance'), 'Sound judgment. The passage supports it.');
  assert.equal(sdk.t('evAsk', 'challenge'), 'Which sentence best supports your answer?', 'Challenge keeps the default question');
  assert.notEqual(sdk.t('summaryTitle', 'advance'), 'Nice work!');
});

test('PACK OVERRIDE: a game\'s own copy and stepLabels win, key by key', () => {
  const pack = { copy: { summaryTitle: 'Custom title' }, stepLabels: { choose: 'Pick one' } };
  assert.equal(sdk.t('summaryTitle', 'advance', pack), 'Custom title');
  assert.equal(sdk.t('summaryButton', 'advance', pack), 'Try again', 'other keys still come from the band');
  const labels = sdk.stepLabels('advance', pack);
  assert.equal(labels.choose, 'Pick one');
  assert.equal(labels.recognize, 'Situation', 'labels the pack does not set come from the band');
});

test('STEP LABELS: every band has a label for all five steps, short and plain', () => {
  for (const band of BANDS) {
    const labels = sdk.stepLabels(band, {});
    for (const k of STEPS) {
      assert.ok(labels[k], `${band} is missing the ${k} label`);
      assert.ok(labels[k].split(/\s+/).length <= 5, `${band}/${k} label is too long: ${labels[k]}`);
    }
  }
});

test('BAND STRINGS: no dashes, short, nothing that mentions a demo', () => {
  for (const band of BANDS) {
    const own = sdk.COPY[band];
    const strings = Object.entries(own).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v])
      .concat(Object.entries(own.stepLabels || {}));
    for (const [k, v] of strings) {
      if (k === 'simNextKind') continue;
      assert.ok(!/[—–]| - /.test(v), `${band}/${k} has a dash: ${v}`);
      assert.ok(v.split(/\s+/).length <= 12, `${band}/${k} is too long: ${v}`);
      assert.ok(!/demo/i.test(v), `${band}/${k} mentions a demo`);
    }
  }
  for (const k of ['brReflectAria', 'brReflectNote', 'brReflectPlaceholder']) {
    assert.ok(!/demo/i.test(sdk.COPY.default[k]) && !/[—–]/.test(sdk.COPY.default[k]), `default ${k}`);
  }
});

test('MONEY GAMES: older groups get a neutral "decision recorded" look, not a green success box', () => {
  assert.equal(sdk.t('simNextKind', 'challenge'), 'neutral');
  assert.equal(sdk.t('simNextKind', 'advance'), 'neutral');
  assert.equal(sdk.t('simNextKind', undefined), 'correct', 'an unbanded page keeps the old look');
  assert.match(read('brain-money-moves.html'), /params\.get\('band'\) \|\| 'challenge'/);
  assert.match(read('brain-money-matters.html'), /params\.get\('band'\) \|\| 'advance'/);
});

test('ENGINES: wording comes from the table, not from strings left in the engine files', () => {
  const forbidden = {
    'engine-evidence-hunt.js': ['Correct, and well-supported', "Right answer, but that's not", 'Not quite', 'Which sentence best supports', "label: 'Missed'", "'Evidence-supported'"],
    'engine-simulation.js': ['Logged. Moving'],
    'engine-branching-scenario.js': ['Recognize the Issue', 'Thanks for choosing', 'this demo', "Type a few words"],
  };
  for (const [file, strings] of Object.entries(forbidden)) {
    const src = read(file).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // comments may still say "demo engine"
    for (const s of strings) assert.ok(!src.includes(s), `${file} still contains "${s}"`);
    assert.match(src, /FnEngineSDK\.t\(/, `${file} should read its wording from FnEngineSDK.t`);
  }
  assert.match(read('engine-branching-scenario.js'), /FnEngineSDK\.stepLabels\(band, contentPack\)/);
  assert.match(read('engine-sdk.js'), /t\('summaryTitle', band, contentPack\)/);
});

test('STEP LABEL OVERRIDES: the games whose flow does not fit the generic labels set all five', () => {
  for (const f of ['brain-idea-lab.html', 'brain-community-voice.html', 'brain-perspective-swap.html', 'brain-fix-it-workshop.html']) {
    const m = read(f).match(/stepLabels:\s*\{([^}]*)\}/);
    assert.ok(m, `${f} has no stepLabels`);
    for (const k of STEPS) assert.match(m[1], new RegExp(`${k}:`), `${f} stepLabels is missing ${k}`);
  }
});

test('STORY TEXT: readers see the scenario story on screen; Discover keeps it spoken only', () => {
  const src = read('engine-scenario-choice.js');
  assert.match(src, /showStory = band === 'explore' \|\| band === 'challenge' \|\| band === 'advance'/);
  assert.match(src, /showStory \? `<span class="fn-story-text">/);
  assert.match(src, /class="sr-only">\$\{scenario\.context\}/, 'Discover still gets the screen-reader copy');
  const css = read('brain-games.css');
  assert.match(css, /\.fn-stimulus-box \.fn-story-text/);
  assert.match(css, /\.fn-shell-feedback\.neutral/);
});

test('PAGES: every page that loads a changed script has the new version number', () => {
  const want = [[/engine-sdk\.js/, 'engine-sdk.js?v=5'], [/engine-simulation\.js/, 'engine-simulation.js?v=4'],
    [/engine-scenario-choice\.js/, 'engine-scenario-choice.js?v=6'], [/engine-evidence-hunt\.js/, 'engine-evidence-hunt.js?v=2']];
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const html = read(f);
    for (const [re, versioned] of want) {
      const tag = new RegExp(`<script[^>]+${re.source}[^>]*>`).exec(html);
      if (tag) assert.ok(tag[0].includes(versioned), `${f} loads ${re.source} without ${versioned}`);
    }
  }
});
