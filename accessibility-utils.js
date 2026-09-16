// Tune Your Brain, Phase 2 — shared accessibility utilities.
//
// This is new: no shared reduced-motion / keyboard / live-region helper
// existed anywhere in this codebase before (confirmed in the Phase 0 audit —
// only ad hoc aria-* attributes in nav.js's mobile menu). Load this on any
// Tune Your Brain game/shell page; it does not touch or require any
// existing page to change.
//
// Exposes window.FnA11y = { announce, isReducedMotion, init }.
(function () {
  const STORAGE_KEY = 'fn_a11y_prefs';

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }
  function savePrefs(prefs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
  }

  // An explicit in-app choice always wins over the OS default — a learner
  // may want less motion than their OS setting, or (less often) may have
  // enabled the OS setting for an unrelated reason and want animation back
  // on within this app specifically.
  function isReducedMotion() {
    const prefs = loadPrefs();
    if (typeof prefs.reducedMotion === 'boolean') return prefs.reducedMotion;
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function applyPrefsToDocument() {
    document.documentElement.dataset.reducedMotion = String(isReducedMotion());
    const prefs = loadPrefs();
    document.documentElement.dataset.largeText = String(!!prefs.largeText);
  }

  // Single shared live region for status announcements (score changes,
  // matches found, errors) — the kind of update that currently only ever
  // updates visually across every existing brain-game page.
  let liveRegion = null;
  function ensureLiveRegion() {
    if (liveRegion) return liveRegion;
    liveRegion = document.createElement('div');
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.id = 'fnA11yLiveRegion';
    document.body.appendChild(liveRegion);
    return liveRegion;
  }
  function announce(message) {
    const el = ensureLiveRegion();
    // Clearing first forces a re-announcement even if the text repeats
    // (e.g. "Incorrect, try again" twice in a row) — screen readers
    // otherwise treat identical live-region text as a no-op.
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 30);
  }

  // Makes any element (even a plain <div onclick>, the pattern every
  // existing game uses today) keyboard-operable without changing its
  // existing click behavior. Idempotent — safe to call more than once on
  // the same element.
  function makeKeyboardActivatable(el, handler, opts) {
    if (!el || el.dataset.fnA11yKeyboard === 'true') return;
    el.dataset.fnA11yKeyboard = 'true';
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (opts && opts.label) el.setAttribute('aria-label', opts.label);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handler(e);
      }
    });
  }

  function buildPanel() {
    if (document.getElementById('fnA11yToggle')) return;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'fnA11yToggle';
    toggleBtn.className = 'fn-a11y-toggle tap-target';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', 'Accessibility settings');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.textContent = '⚙';

    const panel = document.createElement('div');
    panel.id = 'fnA11yPanel';
    panel.className = 'fn-a11y-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Accessibility settings');
    const prefs = loadPrefs();
    panel.innerHTML = `
      <h4>Accessibility</h4>
      <label class="fn-a11y-row">
        <span>Reduced motion</span>
        <input type="checkbox" id="fnA11yReducedMotion" ${isReducedMotion() ? 'checked' : ''}>
      </label>
      <label class="fn-a11y-row">
        <span>Larger text</span>
        <input type="checkbox" id="fnA11yLargeText" ${prefs.largeText ? 'checked' : ''}>
      </label>
    `;

    toggleBtn.addEventListener('click', () => {
      const open = panel.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', String(open));
    });
    makeKeyboardActivatable(toggleBtn, () => toggleBtn.click());

    panel.querySelector('#fnA11yReducedMotion').addEventListener('change', (e) => {
      const p = loadPrefs();
      p.reducedMotion = e.target.checked;
      savePrefs(p);
      applyPrefsToDocument();
      announce(e.target.checked ? 'Reduced motion turned on' : 'Reduced motion turned off');
    });
    panel.querySelector('#fnA11yLargeText').addEventListener('change', (e) => {
      const p = loadPrefs();
      p.largeText = e.target.checked;
      savePrefs(p);
      applyPrefsToDocument();
      announce(e.target.checked ? 'Larger text turned on' : 'Larger text turned off');
    });

    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);
  }

  function init() {
    applyPrefsToDocument();
    ensureLiveRegion();
    buildPanel();
  }

  window.FnA11y = { announce, isReducedMotion, makeKeyboardActivatable, init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
