// Tune Your Brain, Phase 3 — the Evidence Hunt engine ("Identify support
// in text/media... Highlight, select, cite, explain"). Needed for the
// Phase 5 pilot's Reading Detective.
//
// Implements the blueprint's explicit acceptance rule (§14.2): "a correct
// guess without evidence is recorded differently from evidence-supported
// success." Two-step per item: pick an answer, THEN pick which sentence
// from the passage actually supports it. Both are evaluated together.
//
// contentPack shape:
// { items: [{
//     passage: ['Sentence one.', 'Sentence two.', 'Sentence three.'],
//     question: 'What is the main idea?',
//     choices: [{id, text}], correctChoiceId,
//     correctEvidenceIndex,      // index into passage[]
//     explanation: '...'         // shown after, regardless of correctness
// }] }
(function () {
  function mount(container, { contentPack, onEvidence, onComplete }) {
    const items = contentPack.items;
    let index = 0, stage = 'answer', selectedAnswer = null;
    let evidenceSupported = 0, correctNoEvidence = 0, incorrectCount = 0;

    const progressHolder = document.createElement('div');
    const passageBox = document.createElement('div');
    passageBox.className = 'fn-passage-box band-aware';
    const promptBox = document.createElement('p');
    promptBox.style.fontWeight = '700'; promptBox.style.margin = '12px 0';
    const choiceHolder = document.createElement('div');
    const feedbackHolder = document.createElement('div');

    container.append(progressHolder, passageBox, promptBox, choiceHolder, feedbackHolder);
    renderItem();

    function renderPassage(item) {
      passageBox.innerHTML = item.passage.map((s, i) =>
        `<span class="evidence-line" data-i="${i}" tabindex="${stage === 'evidence' ? '0' : '-1'}" role="${stage === 'evidence' ? 'button' : 'text'}">${s}</span>`
      ).join(' ');
    }

    function renderItem() {
      stage = 'answer'; selectedAnswer = null;
      feedbackHolder.innerHTML = '';
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(index + 1, items.length));

      const item = items[index];
      onEvidence('item_presented', { index });
      renderPassage(item);
      promptBox.textContent = item.question;

      choiceHolder.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'fn-choice-list';
      item.choices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target';
        btn.textContent = choice.text;
        btn.addEventListener('click', () => pickAnswer(choice, btn, list, item));
        list.appendChild(btn);
      });
      choiceHolder.appendChild(list);
    }

    function pickAnswer(choice, btnEl, listEl, item) {
      if (stage !== 'answer') return;
      selectedAnswer = choice;
      [...listEl.children].forEach((c) => { c.disabled = true; });
      btnEl.classList.add('selected');
      onEvidence('response_submitted', { index, stage: 'answer' });

      stage = 'evidence';
      renderPassage(item);
      promptBox.textContent = 'Which sentence best supports your answer?';
      choiceHolder.innerHTML = '';
      if (window.FnA11y) FnA11y.announce('Now select the sentence that supports your answer.');

      passageBox.querySelectorAll('.evidence-line').forEach((el) => {
        el.addEventListener('click', () => pickEvidence(Number(el.dataset.i), item));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickEvidence(Number(el.dataset.i), item); }
        });
      });
    }

    function pickEvidence(evidenceIndex, item) {
      if (stage !== 'evidence') return;
      stage = 'done';
      const answerCorrect = selectedAnswer.id === item.correctChoiceId;
      const evidenceCorrect = evidenceIndex === item.correctEvidenceIndex;
      onEvidence('response_submitted', { index, stage: 'evidence' });

      let resultKind, message;
      if (answerCorrect && evidenceCorrect) {
        evidenceSupported++;
        resultKind = 'correct';
        message = 'Correct, and well-supported by the text!';
        onEvidence('item_correct', { index, evidenceSupported: true });
      } else if (answerCorrect && !evidenceCorrect) {
        correctNoEvidence++;
        resultKind = 'incorrect';
        message = `Right answer, but that's not the strongest evidence. ${item.explanation || ''}`;
        onEvidence('item_correct', { index, evidenceSupported: false });
      } else {
        incorrectCount++;
        resultKind = 'incorrect';
        message = item.explanation || 'Not quite — take another look at the passage.';
        onEvidence('item_incorrect', { index });
      }

      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback(resultKind, message));

      setTimeout(() => {
        index++;
        if (index >= items.length) {
          onComplete([
            { value: evidenceSupported, label: 'Evidence-supported' },
            { value: correctNoEvidence, label: 'Right answer, weak evidence' },
            { value: incorrectCount, label: 'Missed' },
          ], { score: evidenceSupported, maxScore: items.length });
        } else {
          renderItem();
        }
      }, 1800);
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'evidenceHunt', version: 1, mount });
})();
