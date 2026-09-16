// Tune Your Brain, Phase 2 — shared game shell.
//
// Reusable builders for the structural pieces every future engine needs
// (header, instructions, progress, feedback, hint, pause/exit, summary),
// plus the band-switching mechanism. Nothing here is wired into the 6
// existing brain-*.html games — this is groundwork for Phase 3's Engine SDK
// and the Phase 5 pilot slice, not a retrofit of what already ships.
//
// Load accessibility-utils.js first (setBand/renderInstructions etc. rely
// on it for announcements).
(function () {
  const BANDS = ['discover', 'explore', 'challenge', 'advance'];

  // Writes data-band onto <html> so every band-aware CSS rule (brain-games.css)
  // and any element using the .band-aware class responds immediately. Does
  // NOT persist a choice server-side — band is presentation context
  // supplied by whatever assigns/launches the activity (teacher assignment,
  // student profile default), not a stored preference here.
  function setBand(bandKey) {
    const band = BANDS.includes(bandKey) ? bandKey : 'challenge';
    document.documentElement.dataset.band = band;
    return band;
  }

  function getBand() {
    return document.documentElement.dataset.band || 'challenge';
  }

  function renderHeader({ icon, title, description }) {
    const el = document.createElement('div');
    el.className = 'game-page-header band-aware';
    el.innerHTML = `
      <span class="game-icon" aria-hidden="true">${icon || ''}</span>
      <h1>${title || ''}</h1>
      <p>${description || ''}</p>
    `;
    return el;
  }

  function renderInstructions(text) {
    const el = document.createElement('div');
    el.className = 'fn-shell-instructions band-aware';
    el.setAttribute('role', 'note');
    el.textContent = text;
    return el;
  }

  // current/total are 1-indexed for the visible label ("Item 2 of 5") but
  // the fill percentage is computed from the raw values.
  function renderProgress(current, total) {
    const el = document.createElement('div');
    el.className = 'fn-shell-progress';
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    el.innerHTML = `
      <span class="fn-shell-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${current}">
        <span class="fn-shell-progress-fill" style="width:${pct}%"></span>
      </span>
      <span class="sr-only">Item ${current} of ${total}</span>
    `;
    return el;
  }

  // kind: 'correct' | 'incorrect'. Announces via FnA11y so the outcome
  // isn't visual-only — every existing game today updates a score number
  // on screen with nothing spoken to assistive tech.
  function renderFeedback(kind, message) {
    const el = document.createElement('div');
    el.className = `fn-shell-feedback band-aware ${kind}`;
    el.textContent = message;
    if (window.FnA11y) window.FnA11y.announce(message);
    return el;
  }

  // Hints never penalize score by themselves here — callers decide how to
  // record hint usage in their own evidence/metrics payload (per the
  // blueprint's §6.8 feedback hierarchy: hint use should be recorded, not
  // silently either free or punished).
  function renderHintButton(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fn-shell-hint-btn tap-target band-aware';
    btn.textContent = text || 'Hint';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderControls({ onPause, onExit } = {}) {
    const el = document.createElement('div');
    el.className = 'fn-shell-controls';
    if (onPause) {
      const pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'btn btn-outline btn-sm tap-target';
      pauseBtn.textContent = 'Pause';
      pauseBtn.addEventListener('click', onPause);
      el.appendChild(pauseBtn);
    }
    if (onExit) {
      const exitBtn = document.createElement('button');
      exitBtn.type = 'button';
      exitBtn.className = 'btn btn-outline btn-sm tap-target';
      exitBtn.textContent = 'Exit';
      exitBtn.addEventListener('click', onExit);
      el.appendChild(exitBtn);
    }
    return el;
  }

  // A natural stopping point, per the blueprint's §6.7/§16 requirement that
  // every game closes with a summary rather than looping indefinitely.
  function renderSummary({ title, lines, onContinue, continueLabel }) {
    const el = document.createElement('div');
    el.className = 'game-card-panel results-panel band-aware';
    const linesHtml = (lines || []).map(l => `
      <div class="results-stat"><div class="val">${l.value}</div><div class="lbl">${l.label}</div></div>
    `).join('');
    el.innerHTML = `
      <h3 style="font-family:'Fraunces',serif;color:var(--teal-dark);margin-bottom:16px;">${title || 'Nice work!'}</h3>
      <div class="results-stats">${linesHtml}</div>
    `;
    if (onContinue) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary tap-target';
      btn.textContent = continueLabel || 'Continue';
      btn.addEventListener('click', onContinue);
      el.appendChild(btn);
    }
    return el;
  }

  window.FnGameShell = {
    setBand, getBand,
    renderHeader, renderInstructions, renderProgress,
    renderFeedback, renderHintButton, renderControls, renderSummary,
  };
})();
