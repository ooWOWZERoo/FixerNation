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
        contentPack, band,
        onEvidence: (eventType, payload) => logEvent(eventType, {
          engineName, sessionToken: sessionMeta.sessionToken, activityId, ...payload,
        }),
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

  window.FnEngineSDK = { registerEngine, getEngine, run };
})();
