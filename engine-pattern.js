// Tune Your Brain, Phase 3 — the Pattern engine ("Infer and apply a rule").
// Covers Number Sequence per ENGINE_MAPPING_SPIKE.md.
//
// contentPack shape:
// { items: [{ display: ['2','4','6','?','10'], answer: '8', choices?: ['7','8','9'], label: 'Arithmetic pattern' }] }
//
// If an item has `choices`, renders as tap-to-select buttons (no typing
// required — a real accessibility alternative, not just a legacy-parity
// copy of the free-text input the original game forced on everyone).
// Otherwise falls back to a numeric text input, matching the legacy game's
// own interaction for content packs that want it.
(function () {
  function mount(container, { contentPack, onEvidence, onComplete }) {
    const items = contentPack.items;
    let index = 0, correctCount = 0, answered = false;

    const progressHolder = document.createElement('div');
    const typeTag = document.createElement('div');
    typeTag.style.textAlign = 'center';
    const displayBox = document.createElement('div');
    displayBox.className = 'fn-stimulus-box band-aware';
    const answerArea = document.createElement('div');
    const feedbackHolder = document.createElement('div');

    container.append(progressHolder, typeTag, displayBox, answerArea, feedbackHolder);

    renderItem();

    function renderItem() {
      answered = false;
      feedbackHolder.innerHTML = '';
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(index + 1, items.length));

      const item = items[index];
      typeTag.innerHTML = item.label ? `<span class="choice-tag">${item.label}</span>` : '';
      displayBox.textContent = item.display.join('  →  ');

      onEvidence('item_presented', { index });

      answerArea.innerHTML = '';
      if (Array.isArray(item.choices)) {
        const list = document.createElement('div');
        list.className = 'fn-choice-list';
        item.choices.forEach((choice) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'fn-choice-btn band-aware tap-target';
          btn.textContent = choice;
          btn.addEventListener('click', () => submit(choice, btn, list));
          list.appendChild(btn);
        });
        answerArea.appendChild(list);
      } else {
        const row = document.createElement('div');
        row.style.display = 'flex'; row.style.gap = '10px'; row.style.justifyContent = 'center'; row.style.margin = '16px 0';
        const input = document.createElement('input');
        input.type = 'number'; input.className = 'math-input tap-target';
        input.setAttribute('aria-label', 'Your answer');
        const submitBtn = document.createElement('button');
        submitBtn.type = 'button'; submitBtn.className = 'btn btn-primary tap-target';
        submitBtn.textContent = 'Submit';
        const doSubmit = () => { if (input.value !== '') submit(input.value, null, null); };
        submitBtn.addEventListener('click', doSubmit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
        row.append(input, submitBtn);
        answerArea.appendChild(row);
        setTimeout(() => input.focus(), 50);
      }
    }

    function submit(value, btnEl, listEl) {
      if (answered) return;
      answered = true;
      const item = items[index];
      const correct = String(value) === String(item.answer);
      if (correct) correctCount++;
      onEvidence('response_submitted', { index, value: String(value) });
      onEvidence(correct ? 'item_correct' : 'item_incorrect', { index });

      if (listEl) {
        [...listEl.children].forEach((c) => {
          c.disabled = true;
          if (c === btnEl) c.classList.add(correct ? 'correct-choice' : 'incorrect-choice');
          if (!correct && c.textContent === String(item.answer)) c.classList.add('correct-choice');
        });
      }

      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback(
        correct ? 'correct' : 'incorrect',
        correct ? 'Correct!' : `Not quite — the answer was ${item.answer}.`
      ));

      setTimeout(() => {
        index++;
        if (index >= items.length) {
          onComplete([
            { value: correctCount, label: 'Correct' },
            { value: items.length - correctCount, label: 'Missed' },
            { value: `${Math.round((correctCount / items.length) * 100)}%`, label: 'Accuracy' },
          ]);
        } else {
          renderItem();
        }
      }, correct ? 700 : 1400);
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'pattern', version: 1, mount });
})();
