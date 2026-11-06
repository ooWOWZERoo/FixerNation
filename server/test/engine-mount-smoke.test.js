// Smoke test: every engine file mounts every real game's prepared pack on a fake DOM without throwing.
// The content tests read the engine source as text, so a broken engine (for example a function used before it is
// defined, which crashed Discover games during Release 87 development) could pass them all. This runs the first
// paint of each engine for real, in a vm, with a chainable stand-in for the browser.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { auditAll, extractPack, ROOT } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));
const sdk = require(path.join(ROOT, 'engine-sdk.js'));

// A stand-in for any DOM object: every property is another stand-in, calls return one, writes are ignored.
function fake() {
  const target = function () {};
  const store = { style: {}, dataset: {}, children: [], childNodes: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
  const proxy = new Proxy(target, {
    get(_, prop) {
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop in store) return store[prop];
      if (prop === 'then') return undefined;
      if (['textContent', 'innerHTML', 'value', 'className', 'innerText'].includes(prop)) return '';
      if (prop === 'length') return 0;
      if (prop === 'hidden' || prop === 'disabled') return false;
      return proxy;
    },
    set(_, prop, val) { store[prop] = val; return true; },
    apply() { return proxy; },
  });
  return proxy;
}

const ENGINE_FILES = ['engine-audio-choice.js', 'engine-evidence-hunt.js', 'engine-scenario-choice.js', 'engine-branching-scenario.js', 'engine-simulation.js', 'engine-memory.js'];
const engines = {};
const shell = new Proxy({}, { get: () => () => fake() });
for (const file of ENGINE_FILES) {
  const win = {
    FnEngineSDK: { registerEngine: (d) => { engines[d.name] = d; }, t: sdk.t, stepLabels: sdk.stepLabels },
    FnGameShell: shell, FnA11y: { announce() {} },
    speechSynthesis: { speak() {}, cancel() {} },
  };
  const ctx = { window: win, document: { createElement: () => fake() }, SpeechSynthesisUtterance: function (t) { this.text = t; },
    setTimeout: () => 0, clearTimeout() {}, Date, Math, Set, Object, Array, String, Number, JSON, console, FnGameShell: shell, FnEngineSDK: win.FnEngineSDK };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const games = auditAll().filter((r) => r.engine !== 'legacy' && !r.note).map((r) => {
  const src = fs.readFileSync(path.join(ROOT, r.file), 'utf8');
  return {
    slug: r.slug,
    engineName: (src.match(/engineName:\s*'([A-Za-z]+)'/) || [])[1],
    band: (src.match(/params\.get\('band'\) \|\| '([a-z]+)'/) || [])[1],
    pack: extractPack(src),
  };
}).filter((g) => g.pack && g.engineName);

test('SMOKE: all six engines registered', () => {
  assert.deepEqual(Object.keys(engines).sort(), ['audioChoice', 'branchingScenario', 'evidenceHunt', 'memory', 'scenarioChoice', 'simulation']);
});

for (const g of games) {
  test(`SMOKE: ${g.slug} (${g.engineName}, ${g.band}) paints its first screen`, () => {
    const prepared = sdk.prepareContentPack(g.pack, g.engineName, sdk.mulberry32(7)).pack;
    assert.doesNotThrow(() => engines[g.engineName].mount(fake(), {
      contentPack: prepared, band: g.band, onEvidence() {}, onComplete() {},
    }), `${g.slug} threw while mounting`);
  });
}
