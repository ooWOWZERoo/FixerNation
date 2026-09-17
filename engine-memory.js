// Tune Your Brain, Phase 3 — the Memory engine (covers Memory Match and
// Simon Sequence's "recall" mechanic per ENGINE_MAPPING_SPIKE.md). This is
// the pair-matching variant; a sequence-recall variant would register as
// a second content-pack shape on the same engine, not a separate engine.
//
// contentPack shape: { items: [{id, display}], pairCount? }
// Register with FnEngineSDK.registerEngine(...) — see engine-sdk.js.
//
// Deliberately uses real <button> elements (not the legacy games' <div
// onclick> pattern) so keyboard operability is free, not retrofitted.
(function () {
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function mount(container, { contentPack, onEvidence, onComplete }) {
    const pairCount = contentPack.pairCount || contentPack.items.length;
    const chosen = shuffle(contentPack.items).slice(0, pairCount);
    let cards = shuffle(chosen.concat(chosen)).map((it, i) => ({ ...it, uid: i, flipped: false, matched: false }));
    let flipped = [], moves = 0, mismatches = 0, matched = 0, lockBoard = false;

    const grid = document.createElement('div');
    grid.className = 'card-grid medium';
    container.appendChild(grid);

    onEvidence('item_presented', { pairCount });
    render();

    function render() {
      grid.innerHTML = cards.map((c, i) => `
        <div class="flip-card tap-target band-aware ${c.flipped || c.matched ? 'flipped' : ''} ${c.matched ? 'matched' : ''}"
          data-i="${i}" aria-label="Card ${i + 1}${c.matched ? ', matched' : c.flipped ? ', ' + c.display : ''}">
          <span class="flip-inner">
            <span class="flip-face flip-front">?</span>
            <span class="flip-face flip-back">${c.display}</span>
          </span>
        </div>`).join('');
      // A <div> here, not a <button> — 3D transform (backface-visibility +
      // preserve-3d) renders unreliably on <button> in at least headless
      // Chromium (confirmed by direct testing while building this). Keyboard
      // operability comes from FnA11y.makeKeyboardActivatable instead of
      // native button semantics.
      grid.querySelectorAll('.flip-card').forEach((el) => {
        const i = Number(el.dataset.i);
        el.addEventListener('click', () => flip(i));
        if (window.FnA11y) FnA11y.makeKeyboardActivatable(el, () => flip(i));
      });
    }

    function flip(i) {
      if (lockBoard || cards[i].flipped || cards[i].matched || flipped.length === 2) return;
      cards[i].flipped = true;
      flipped.push(i);
      render();
      if (flipped.length < 2) return;

      moves++;
      lockBoard = true;
      const [a, b] = flipped;
      onEvidence('response_submitted', { moves });

      if (cards[a].id === cards[b].id) {
        cards[a].matched = cards[b].matched = true;
        matched++;
        onEvidence('item_correct', { pairId: cards[a].id, moves });
        flipped = [];
        lockBoard = false;
        render();
        if (window.FnA11y) FnA11y.announce('Match found!');
        if (matched === pairCount) {
          setTimeout(() => onComplete([
            { value: moves, label: 'Moves' },
            { value: mismatches, label: 'Mismatches' },
            { value: matched, label: 'Pairs found' },
          ], { score: matched, maxScore: pairCount }), 500);
        }
      } else {
        mismatches++;
        onEvidence('item_incorrect', { moves });
        if (window.FnA11y) FnA11y.announce('Not a match — try again.');
        setTimeout(() => {
          cards[a].flipped = cards[b].flipped = false;
          flipped = [];
          lockBoard = false;
          render();
        }, 800);
      }
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'memory', version: 1, mount });
})();
