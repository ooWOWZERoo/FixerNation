// Tune Your Brain, Phase 3 — Game Engine SDK / normalized session runtime.
//
// Drives any registered engine through the shared lifecycle (§9.4):
// initialize -> orient -> model -> startSession -> presentItem ->
// acceptResponse -> evaluate -> feedback -> retry/advance -> completeRound
// -> summarize -> closeSession. The stages an engine actually needs
// per-item control over (present/accept/evaluate/feedback) stay inside the
// engine module itself, since a board game like Memory and a per-question
// game like Pattern have very different per-item shapes; the SDK owns the
// parts that must be identical across every engine: shell chrome, session
// resume/idempotency, and evidence logging.
//
// Load accessibility-utils.js and game-shell.js first.
(function () {
  const registry = {};

  function registerEngine(def) {
    if (!def || !def.name || typeof def.mount !== 'function') {
      throw new Error('registerEngine requires {name, version, mount}');
    }
    registry[def.name] = def;
  }

  function getEngine(name) {
    return registry[name] || null;
  }

  // ---- Per-run content preparation (Phase 1 of GAME_REVERIFICATION_PLAN.md) --------------------------------
  // Authored content packs are fixed lists, so without this every run is identical and the right answer sits
  // wherever the author put it. Before an engine mounts, the SDK builds a fresh copy of the pack for THIS run:
  //   - choice order is shuffled in every round (opt out per pack or per round with shuffleChoices: false;
  //     put pinLast: true on a choice such as "None of these" to keep it at the bottom);
  //   - rounds are shuffled for the engines whose rounds are independent (audioChoice, evidenceHunt, scenarioChoice);
  //     the sequential engines (branchingScenario steps, simulation events) keep their order;
  //   - roundsPerRun: N draws N rounds at random from a larger pool, so a pool can be bigger than one run;
  //   - variants: [{ steps | events | items | scenarios, ... }] picks one whole variant per run (a scenario
  //     can have several versions); fields in the variant override the pack's own;
  //   - shuffleRounds: true|false overrides the per-engine default above.
  // Add ?seed=123 to a game's URL to replay the exact same run (for reviewers and tests). Learning events carry
  // sourceIndex (the round's place in the authored list) and variant, so analytics still know which content ran.
  // Engines are untouched: they receive an ordinary content pack.
  const SHAPES = {
    audioChoice: { list: 'items', arrays: ['choices'], ordered: false },
    evidenceHunt: { list: 'items', arrays: ['choices'], ordered: false },
    scenarioChoice: { list: 'scenarios', arrays: ['cues', 'feelings'], ordered: false },
    branchingScenario: { list: 'steps', arrays: ['choices'], ordered: true },
    simulation: { list: 'events', arrays: ['options'], ordered: true },
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRandom() {
    const m = typeof location !== 'undefined' && /[?&]seed=(\d+)/.exec(location.search || '');
    return m ? mulberry32(Number(m[1])) : Math.random;
  }

  function shuffled(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // Shuffles a choice list but keeps any pinLast choice at the end, in its original order.
  function shuffledChoices(list, rng) {
    const pinned = list.filter((c) => c && c.pinLast);
    return shuffled(list.filter((c) => !(c && c.pinLast)), rng).concat(pinned);
  }

  function prepareContentPack(pack, engineName, rng) {
    const shape = SHAPES[engineName];
    if (!shape || !pack) return { pack, order: null, variant: null };
    let src = pack, variant = null;
    if (Array.isArray(pack.variants) && pack.variants.length) {
      variant = Math.floor(rng() * pack.variants.length);
      src = Object.assign({}, pack, pack.variants[variant]);
    }
    const list = Array.isArray(src[shape.list]) ? src[shape.list] : [];
    const shuffleRounds = src.shuffleRounds !== undefined ? !!src.shuffleRounds : !shape.ordered;
    let order = list.map((_, i) => i);
    if (Number.isInteger(src.roundsPerRun) && src.roundsPerRun > 0 && src.roundsPerRun < order.length) {
      order = shuffled(order, rng).slice(0, src.roundsPerRun);
      if (!shuffleRounds) order.sort((a, b) => a - b);
    } else if (shuffleRounds) {
      order = shuffled(order, rng);
    }
    const doShuffleChoices = src.shuffleChoices !== false;
    const rounds = order.map((i) => {
      const round = Object.assign({}, list[i]);
      if (doShuffleChoices && round.shuffleChoices !== false) {
        shape.arrays.forEach((key) => { if (Array.isArray(round[key])) round[key] = shuffledChoices(round[key], rng); });
      }
      return round;
    });
    return { pack: Object.assign({}, src, { [shape.list]: rounds }), order, variant };
  }

  async function logEvent(eventType, metadata) {
    try {
      await fetch('/api/learning-events', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, metadata }),
      });
    } catch { /* best-effort — a failed log must never block gameplay */ }
  }

  // Runs one activity. `activityId` must be stable across reloads of the
  // same assigned activity (e.g. "memory-shapes-easy") — that's what makes
  // refresh/resume idempotent: reloading the page reuses the same session
  // token instead of minting a new one, and completing clears the stored
  // token so the NEXT run starts fresh rather than resuming a finished one.
  function run({ container, engineName, engineVersion, contentPack, band, activityId, header }) {
    const engine = getEngine(engineName);
    if (!engine) throw new Error(`Engine not registered: ${engineName}`);
    if (engineVersion && engine.version !== engineVersion) {
      console.warn(`[FnEngineSDK] requested v${engineVersion} but registered engine is v${engine.version} — using registered version.`);
    }

    const prepared = prepareContentPack(contentPack, engineName, makeRandom());

    FnGameShell.setBand(band);
    container.innerHTML = '';
    container.appendChild(FnGameShell.renderHeader(header || {}));
    if (header && header.instructions) {
      container.appendChild(FnGameShell.renderInstructions(header.instructions));
    }
    const playArea = document.createElement('div');
    container.appendChild(playArea);

    const storeKey = `fn_engine_session:${activityId}`;
    let sessionMeta;
    try { sessionMeta = JSON.parse(sessionStorage.getItem(storeKey) || 'null'); } catch { sessionMeta = null; }
    const resumed = !!sessionMeta;
    if (!sessionMeta) {
      sessionMeta = { sessionToken: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), startedAt: Date.now() };
      sessionStorage.setItem(storeKey, JSON.stringify(sessionMeta));
    }

    logEvent(resumed ? 'session_resumed' : 'session_started', {
      engineName, engineVersion: engine.version, sessionToken: sessionMeta.sessionToken, activityId,
    });

    return new Promise((resolve) => {
      engine.mount(playArea, {
        contentPack: prepared.pack, band,
        onEvidence: (eventType, payload) => {
          const extra = {};
          const data = payload || {};
          const pos = [data.index, data.scenarioIndex, data.eventIndex].find((v) => Number.isInteger(v));
          if (prepared.order && pos !== undefined && prepared.order[pos] !== undefined) extra.sourceIndex = prepared.order[pos];
          if (prepared.variant !== null) extra.variant = prepared.variant;
          return logEvent(eventType, { engineName, sessionToken: sessionMeta.sessionToken, activityId, ...data, ...extra });
        },
        // scoreInfo is optional — engines that don't have a single
        // meaningful numeric score (Branching Scenario, Simulation) just
        // omit it; completion/duration still gets reported either way.
        onComplete: (summaryLines, scoreInfo) => {
          const durationMs = Date.now() - sessionMeta.startedAt;
          logEvent('session_completed', { engineName, sessionToken: sessionMeta.sessionToken, activityId, durationMs });
          sessionStorage.removeItem(storeKey);
          container.appendChild(FnGameShell.renderSummary({
            title: 'Nice work!',
            lines: summaryLines || [],
            continueLabel: 'Play again',
            onContinue: () => location.reload(),
          }));

          // If this engine is running inside student-game.html's iframe
          // (the real classroom-assignment flow), report real completion
          // data instead of leaving the parent to fall back on a
          // student-clicked "Mark as Done" button with no score attached.
          if (window.parent && window.parent !== window) {
            try {
              window.parent.postMessage({
                type: 'fn-game-complete',
                rawScore: scoreInfo && typeof scoreInfo.score === 'number' ? scoreInfo.score : null,
                durationMs,
              }, location.origin);
            } catch { /* not embedded under this origin — ignore */ }
          }

          resolve(summaryLines);
        },
      });
    });
  }

  const api = { registerEngine, getEngine, run, prepareContentPack, mulberry32 };
  if (typeof window !== 'undefined') window.FnEngineSDK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // for server/test
})();
