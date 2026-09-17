// Tune Your Brain, Phase 3 — the Audio Choice engine ("Listen and select"),
// generalized to any stimulus modality per ENGINE_MAPPING_SPIKE.md — the
// blueprint's own name is audio-specific, but the actual mechanic
// ("perceive a stimulus, select from a small fixed set") is exactly what
// Stroop Challenge needs too, just with a visual stimulus instead of
// audio. Registered as 'audioChoice' to keep blueprint traceability;
// content packs decide the stimulus type.
//
// contentPack shape:
// { items: [{
//     stimulusType: 'text' | 'audio',
//     stimulusText: 'RED',              // shown for 'text', spoken via TTS if no audioUrl for 'audio'
//     stimulusColor: '#3b82f6',         // optional — e.g. Stroop's ink color
//     stimulusAudioUrl: null,           // optional real audio file
//     transcript: 'the word red in blue ink',  // required for 'audio' items — screen-reader/no-audio equivalent
//     choices: [{ id, label }],
//     correctId,
// }] }
//
// No countdown timer by design — per §5.5, speed shouldn't dominate
// scoring unless it's the explicit learning objective; response time is
// still logged in evidence for a content author who DOES want it, without
// visually pressuring every learner with a countdown by default.
(function () {
  function speak(text) {
    if (!window.speechSynthesis) return;
    try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
  }

  function mount(container, { contentPack, onEvidence, onComplete }) {
    const items = contentPack.items;
    let index = 0, correct = 0, incorrect = 0, answered = false, qStart = null;

    const progressHolder = document.createElement('div');
    const stimulusBox = document.createElement('div');
    stimulusBox.className = 'fn-stimulus-box band-aware';
    const replayRow = document.createElement('div');
    replayRow.style.textAlign = 'center'; replayRow.style.marginBottom = '8px';
    const choiceHolder = document.createElement('div');
    const feedbackHolder = document.createElement('div');

    container.append(progressHolder, stimulusBox, replayRow, choiceHolder, feedbackHolder);
    renderItem();

    function playStimulus(item) {
      if (item.stimulusType === 'audio') {
        if (item.stimulusAudioUrl) {
          const audio = new Audio(item.stimulusAudioUrl);
          audio.play().catch(() => {});
        } else {
          speak(item.stimulusText || item.transcript);
        }
      }
    }

    function renderItem() {
      answered = false;
      feedbackHolder.innerHTML = '';
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(index + 1, items.length));

      const item = items[index];
      qStart = Date.now();
      onEvidence('item_presented', { index, stimulusType: item.stimulusType });

      if (item.stimulusType === 'audio') {
        stimulusBox.innerHTML = `<span class="sr-only">${item.transcript || ''}</span><span aria-hidden="true">🔊</span>`;
        replayRow.innerHTML = '';
        const replayBtn = document.createElement('button');
        replayBtn.type = 'button';
        replayBtn.className = 'btn btn-outline btn-sm tap-target';
        replayBtn.textContent = '▶ Replay sound';
        replayBtn.addEventListener('click', () => playStimulus(item));
        replayRow.appendChild(replayBtn);
        playStimulus(item);
      } else {
        replayRow.innerHTML = '';
        stimulusBox.textContent = item.stimulusText;
        stimulusBox.style.color = item.stimulusColor || '';
      }

      choiceHolder.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'fn-choice-list';
      item.choices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target';
        if (choice.color) btn.style.borderLeftColor = choice.color;
        btn.textContent = choice.label;
        btn.addEventListener('click', () => submit(choice, btn, list));
        list.appendChild(btn);
      });
      choiceHolder.appendChild(list);
    }

    function submit(choice, btnEl, listEl) {
      if (answered) return;
      answered = true;
      const item = items[index];
      const isCorrect = choice.id === item.correctId;
      const rt = Date.now() - qStart;
      if (isCorrect) correct++; else incorrect++;
      onEvidence('response_submitted', { index, responseMs: rt });
      onEvidence(isCorrect ? 'item_correct' : 'item_incorrect', { index, responseMs: rt });

      [...listEl.children].forEach((c, i) => {
        c.disabled = true;
        if (c === btnEl) c.classList.add(isCorrect ? 'correct-choice' : 'incorrect-choice');
        if (!isCorrect && item.choices[i].id === item.correctId) c.classList.add('correct-choice');
      });

      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback(
        isCorrect ? 'correct' : 'incorrect',
        isCorrect ? 'Correct!' : 'Not quite — take another look.'
      ));

      setTimeout(() => {
        index++;
        if (index >= items.length) {
          const total = correct + incorrect;
          onComplete([
            { value: correct, label: 'Correct' },
            { value: incorrect, label: 'Incorrect' },
            { value: `${Math.round((correct / total) * 100)}%`, label: 'Accuracy' },
          ]);
        } else {
          renderItem();
        }
      }, isCorrect ? 600 : 1300);
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'audioChoice', version: 1, mount });
})();
