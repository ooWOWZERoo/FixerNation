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
//     choices: [{ id, label, feedback? }],   // feedback: optional, shown when THIS choice is picked
//     correctId,
//     explanation?,                           // optional, shown after any answer
// }] }
//
// Release 87 (Discover): the whole item is read aloud in one go (stimulusText, which already ends with the question,
// then each choice by its `say`, `caption` or `aria` text, left to right), replay plays all of it, feedback is always spoken,
// a choice can carry a short `caption` shown under its picture, and an item can give separate on-screen `words`
// (default: stimulusText) behind a "Show the words" button. A pack with none of these plays as before.
//
// Feedback that teaches: when a round supplies a choice's feedback and/or an explanation, that text replaces the
// generic "Correct!" / "Not quite" line, is read aloud for audio rounds (so non-readers get it too), and stays on
// screen a little longer. Rounds without either behave exactly as before.
//
// No countdown timer by design — per §5.5, speed shouldn't dominate
// scoring unless it's the explicit learning objective; response time is
// still logged in evidence for a content author who DOES want it, without
// visually pressuring every learner with a countdown by default.
(function () {
  // Pictures are not read by the voice, so strip emoji and joiner characters from anything spoken.
  const stripEmoji = (s) => String(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  function speak(text, cancel) {
    if (!window.speechSynthesis || !text) return;
    try {
      if (cancel) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(stripEmoji(text)));
    } catch {}
  }

  function mount(container, { contentPack, band, onEvidence, onComplete }) {
    const t = (key) => window.FnEngineSDK.t(key, band, contentPack);
    const items = contentPack.items;
    let index = 0, correct = 0, incorrect = 0, answered = false, qStart = null, replayCount = 0;

    const progressHolder = document.createElement('div');
    const stimulusBox = document.createElement('div');
    stimulusBox.className = 'fn-stimulus-box band-aware';
    const replayRow = document.createElement('div');
    replayRow.style.textAlign = 'center'; replayRow.style.marginBottom = '8px';
    const wordsBox = document.createElement('div');
    wordsBox.className = 'fn-words-box band-aware';
    wordsBox.hidden = true;
    const choiceHolder = document.createElement('div');
    const feedbackHolder = document.createElement('div');

    container.append(progressHolder, stimulusBox, replayRow, wordsBox, choiceHolder, feedbackHolder);
    renderItem();

    function playStimulus(item) {
      if (item.stimulusType === 'audio') {
        if (item.stimulusAudioUrl) {
          const audio = new Audio(item.stimulusAudioUrl);
          audio.play().catch(() => {});
        } else {
          // The story and its question, then each answer in order, so a child who cannot read the pictures hears them.
          const answers = item.speakChoices === false ? [] : item.choices.map((c) => c.say || c.caption || c.aria).filter(Boolean);
          speak([item.stimulusText || item.transcript].concat(answers).map((x) => (/[.?!]$/.test(x) ? x : x + '.')).join(' '), true);
        }
      }
    }
    function wordsFor(item) { return item.words || item.stimulusText || item.transcript || ''; } // a declaration, so renderItem() above can call it on first paint

    function renderItem() {
      answered = false;
      feedbackHolder.innerHTML = '';
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(index + 1, items.length, 'Question'));

      const item = items[index];
      qStart = Date.now();
      replayCount = 0;
      onEvidence('item_presented', { index, stimulusType: item.stimulusType });

      if (item.stimulusType === 'audio') {
        stimulusBox.innerHTML = `<span class="sr-only">${wordsFor(item)}</span><span aria-hidden="true">🔊</span>`;
        replayRow.innerHTML = '';
        wordsBox.hidden = true; wordsBox.textContent = '';
        const replayBtn = document.createElement('button');
        replayBtn.type = 'button';
        replayBtn.className = 'btn btn-outline btn-sm tap-target';
        replayBtn.textContent = '▶ Replay sound';
        // Replaying is a real support the learner used — recorded as
        // evidence (§14.1's "replay count" acceptance criterion), never
        // penalized in scoring. Recording it here, once, in the shared
        // engine, means every future audio-stimulus content pack gets this
        // for free instead of each one having to remember to add it.
        replayBtn.addEventListener('click', () => {
          replayCount++;
          onEvidence('hint_requested', { index, kind: 'audio_replay', replayCount });
          playStimulus(item);
        });
        replayRow.appendChild(replayBtn);
        if (item.showWords !== false && wordsFor(item)) {
          const wordsBtn = document.createElement('button');
          wordsBtn.type = 'button';
          wordsBtn.className = 'btn btn-outline btn-sm tap-target';
          wordsBtn.style.marginLeft = '8px';
          wordsBtn.textContent = t('showWords');
          wordsBtn.setAttribute('aria-expanded', 'false');
          wordsBtn.addEventListener('click', () => {
            const show = wordsBox.hidden;
            wordsBox.hidden = !show;
            wordsBox.textContent = show ? wordsFor(item) : '';
            wordsBtn.textContent = show ? t('hideWords') : t('showWords');
            wordsBtn.setAttribute('aria-expanded', String(show));
            if (show) onEvidence('hint_requested', { index, kind: 'show_words' });
          });
          replayRow.appendChild(wordsBtn);
        }
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
        if (choice.caption) {
          const pic = document.createElement('span'); pic.className = 'choice-pic'; pic.setAttribute('aria-hidden', 'true'); pic.textContent = choice.label;
          const cap = document.createElement('span'); cap.className = 'choice-caption'; cap.textContent = choice.caption;
          btn.append(pic, cap);
          btn.classList.add('has-caption');
        } else {
          btn.textContent = choice.label;
        }
        // choice.aria lets a content pack give an emoji-only choice (no
        // reading required, per the Discover band's own design rule, §7.2)
        // a real text alternative instead of relying on the emoji glyph's
        // own accessible name, which screen readers render inconsistently.
        if (choice.aria) btn.setAttribute('aria-label', choice.aria);
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
      // supported:true distinguishes a response that used the replay hint
      // from a fully independent one, per §14.1's evidence requirement.
      onEvidence('response_submitted', { index, responseMs: rt, supported: replayCount > 0 });
      onEvidence(isCorrect ? 'item_correct' : 'item_incorrect', { index, responseMs: rt, supported: replayCount > 0 });

      [...listEl.children].forEach((c, i) => {
        c.disabled = true;
        if (c === btnEl) c.classList.add(isCorrect ? 'correct-choice' : 'incorrect-choice');
        if (!isCorrect && item.choices[i].id === item.correctId) c.classList.add('correct-choice');
      });

      const custom = [choice.feedback, item.explanation].filter(Boolean).join(' ');
      const message = custom || (isCorrect ? t('audRight') : t('audMiss'));
      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback(isCorrect ? 'correct' : 'incorrect', message));
      // Audio rounds speak every outcome (and stop the story if the child answered early), so non-readers always hear it.
      if (item.stimulusType === 'audio') speak(message, true);

      setTimeout(() => {
        index++;
        if (index >= items.length) {
          const total = correct + incorrect;
          onComplete([
            { value: correct, label: t('audLabelRight') },
            { value: incorrect, label: t('audLabelWrong') },
            { value: `${Math.round((correct / total) * 100)}%`, label: t('audLabelScore') },
          ], { score: correct, maxScore: total });
        } else {
          renderItem();
        }
      }, (custom || item.stimulusType === 'audio') ? Math.min(7000, 2200 + message.length * 45) : (isCorrect ? 600 : 1300));
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'audioChoice', version: 1, mount });
})();
