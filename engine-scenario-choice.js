// Tune Your Brain — the Scenario Choice engine (§14.1's "Feelings
// Detective" concept). Closes the last CASEL gap: Self-awareness had zero
// coverage in any band because every existing choice-based engine locks
// in a single choice on first click, and Feelings Detective's own
// acceptance rule explicitly allows more than one plausible feeling per
// scenario. See docs/tune-your-brain/SCENARIO_CHOICE_ENGINE_SPIKE.md for
// the full design rationale.
//
// Two-stage per scenario, reusing engine-evidence-hunt.js's proven
// two-stage-per-item shape but with BOTH stages multi-select instead of
// single-select: (1) notice which cues are actually present, (2) pick
// every feeling that plausibly fits. Per §5.6's evidence-discipline rule,
// this never claims to diagnose or score an emotion as correct/incorrect
// — onComplete is deliberately scoreless (same choice
// engine-branching-scenario.js already made for the same reason).
//
// Narration is built in from day one, not retrofitted — Feelings
// Detective is a Discover-band game, and Discover's own "no reading
// required" rule (§7.2) already forced Calm Down Corner onto Audio
// Choice instead of Branching Scenario for the exact same reason. Reuses
// Audio Choice's speak()/replay pattern.
//
// contentPack shape:
// { title, scenarios: [{
//     context: 'Maya's friend didn't save her a seat at lunch.', // narrated
//     illustration: '🍽️',
//     cues: [{ id, text, present: true|false }],   // 3-4 candidates, mix of present/absent
//     feelings: [{ id, text, tag: 'plausible'|'less_fitting', note? }], // note shown only for less_fitting picks
//     reinforcement: '...',               // shown when every pick is plausible
//     seekHelp?: { prompt: '...', text: '...' },  // omitted when a scenario doesn't need it
//     selfCheck?: null | {...},           // overrides (or, when null, turns off) the pack-level selfCheck below
// }],
//   prompts?: {                           // optional wording for games that are not about feelings (e.g. Strength Spotter)
//     cues, afterCues, pick, confirmCues, confirmPick, multiLabel   // each falls back to the Feelings Detective wording
//   },
//   selfCheck?: {                         // optional private self-check after the feelings stage, every scenario
//     prompt: 'Has something like this ever happened to you?',
//     options: [{ id, text }],            // e.g. Yes / No / Not sure
//     bodyPrompt: 'Where in your body would you notice it?',
//     bodyOptions: [{ id, text }],
//     closing: '...',                     // shown after the second answer
//     privateNote: '...',                 // screen-reader note
//     summaryLabel: '...',                // label for the count on the summary screen
//   } }
//
// The self-check is what makes a game about OTHER people's feelings also practise the child's own (NY SEL 1A).
// It is private by design, exactly like Branching Scenario's reflection step: the child's answers are never
// logged, sent or stored; the only thing recorded is that the step was reached.
(function () {
  // Pictures are not read by the voice, so strip emoji and joiner characters from anything spoken.
  const stripEmoji = (s) => String(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  // Joins lines into one spoken run without doubling the full stops.
  const sentenceJoin = (parts) => parts.map((x) => (/[.?!]$/.test(String(x).trim()) ? String(x).trim() : String(x).trim() + '.')).join(' ');
  function speak(text, cancel) {
    if (!window.speechSynthesis || !text) return;
    try {
      if (cancel) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(stripEmoji(text)));
    } catch {}
  }

  function mount(container, { contentPack, band, onEvidence, onComplete }) {
    // Readers (Explore and up) see the story as text; Discover is audio-led, so its story stays spoken (and screen-reader) only.
    const showStory = band === 'explore' || band === 'challenge' || band === 'advance';
    // Discover (Release 87) is audio-led: the prompts and feedback are spoken too, and a button shows the story words.
    const voiced = band === 'discover';
    const t = (key) => window.FnEngineSDK.t(key, band, contentPack);
    const holdFor = (msg, base) => (voiced ? Math.min(6500, 1500 + String(msg).length * 55) : base);
    const scenarios = contentPack.scenarios;
    // Wording defaults are the Feelings Detective ones, so a pack with no `prompts` plays exactly as before.
    const P = Object.assign({
      cues: 'Which of these do you notice in this moment?',
      afterCues: "Good noticing — now let's think about how this might feel.",
      pick: 'Which feeling(s) could this be? You can pick more than one.',
      confirmCues: "I've noticed these",
      confirmPick: "I've picked my feeling(s)",
      multiLabel: 'Times you saw more than one feeling',
    }, contentPack.prompts || {});
    let index = 0, stage = 'cues', selectedCues = new Set(), selectedFeelings = new Set();
    let cuesNoticedTotal = 0, multiFeelingCount = 0;

    const progressHolder = document.createElement('div');
    const contextBox = document.createElement('div');
    contextBox.className = 'fn-stimulus-box band-aware';
    const replayRow = document.createElement('div');
    replayRow.style.textAlign = 'center'; replayRow.style.marginBottom = '8px';
    const promptBox = document.createElement('p');
    promptBox.style.cssText = 'font-weight:700;margin:8px 0;font-size:calc(16px * var(--band-scale,1));';
    const choiceHolder = document.createElement('div');
    const confirmRow = document.createElement('div');
    confirmRow.style.textAlign = 'center'; confirmRow.style.margin = '12px 0';
    const feedbackHolder = document.createElement('div');

    container.append(progressHolder, contextBox, replayRow, promptBox, choiceHolder, confirmRow, feedbackHolder);
    renderScenario();

    let selfNarration = '', selfChecks = 0;

    function narrationFor(scenario) {
      if (stage === 'self_check') return selfNarration;
      if (stage === 'cues') {
        return voiced ? sentenceJoin([scenario.context, P.cues, ...scenario.cues.map((c) => c.text)]) : [scenario.context, ...scenario.cues.map((c) => c.text)].join('. ');
      }
      return voiced ? sentenceJoin([P.pick, ...scenario.feelings.map((f) => f.text)]) : scenario.feelings.map((f) => f.text).join(', ');
    }

    function renderReplay(scenario) {
      replayRow.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-sm tap-target';
      btn.textContent = '▶ Replay';
      btn.addEventListener('click', () => {
        onEvidence('hint_requested', { scenarioIndex: index, kind: 'narration_replay', stage });
        speak(narrationFor(scenario), voiced);
      });
      replayRow.appendChild(btn);
      if (voiced && scenario) {
        const words = document.createElement('button');
        words.type = 'button';
        words.className = 'btn btn-outline btn-sm tap-target';
        words.style.marginLeft = '8px';
        words.textContent = t('showWords');
        words.setAttribute('aria-expanded', 'false');
        words.addEventListener('click', () => {
          const story = contextBox.querySelector('.fn-story-text');
          if (!story) return;
          const show = story.hidden;
          story.hidden = !show;
          words.textContent = show ? t('hideWords') : t('showWords');
          words.setAttribute('aria-expanded', String(show));
          if (show) onEvidence('hint_requested', { scenarioIndex: index, kind: 'show_words', stage });
        });
        replayRow.appendChild(words);
      }
    }

    function renderScenario() {
      stage = 'cues';
      selectedCues = new Set();
      const scenario = scenarios[index];
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(index + 1, scenarios.length));
      contextBox.innerHTML = `<span aria-hidden="true" style="font-size:2.5em;display:block;text-align:center;">${scenario.illustration || ''}</span>` +
        (showStory ? `<span class="fn-story-text">${scenario.context}</span>`
          : voiced ? `<span class="sr-only">${scenario.context}</span><span class="fn-story-text" aria-hidden="true" hidden>${scenario.context}</span>`
          : `<span class="sr-only">${scenario.context}</span>`);
      onEvidence('item_presented', { scenarioIndex: index, stage: 'cues' });
      renderCueStage(scenario);
    }

    function renderCueStage(scenario) {
      feedbackHolder.innerHTML = '';
      promptBox.textContent = P.cues;
      renderReplay(scenario);
      speak(narrationFor(scenario), voiced);

      choiceHolder.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'fn-choice-list long-text-list';
      scenario.cues.forEach((cue) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target long-text';
        btn.textContent = cue.text;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
          const on = !btn.classList.contains('selected');
          btn.classList.toggle('selected', on);
          btn.setAttribute('aria-pressed', String(on));
          if (on) selectedCues.add(cue.id); else selectedCues.delete(cue.id);
          confirmBtn.disabled = selectedCues.size === 0;
        });
        list.appendChild(btn);
      });
      choiceHolder.appendChild(list);

      confirmRow.innerHTML = '';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary tap-target';
      confirmBtn.textContent = P.confirmCues;
      confirmBtn.disabled = true;
      confirmBtn.addEventListener('click', () => submitCues(scenario));
      confirmRow.appendChild(confirmBtn);
    }

    function submitCues(scenario) {
      const presentIds = scenario.cues.filter((c) => c.present).map((c) => c.id);
      const matched = presentIds.filter((id) => selectedCues.has(id));
      cuesNoticedTotal += matched.length;
      onEvidence('response_submitted', {
        scenarioIndex: index, stage: 'cues',
        selectedCount: selectedCues.size, matchedPresentCount: matched.length, totalPresentCount: presentIds.length,
      });

      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback('correct', P.afterCues));
      if (voiced) speak(P.afterCues, true);
      setTimeout(() => renderFeelingsStage(scenario), holdFor(P.afterCues, 1200));
    }

    function renderFeelingsStage(scenario) {
      stage = 'feelings';
      selectedFeelings = new Set();
      feedbackHolder.innerHTML = '';
      promptBox.textContent = P.pick;
      onEvidence('item_presented', { scenarioIndex: index, stage: 'feelings' });
      renderReplay(scenario);
      speak(narrationFor(scenario), voiced);

      choiceHolder.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'fn-choice-list long-text-list';
      scenario.feelings.forEach((feeling) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target long-text';
        btn.textContent = feeling.text;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
          const on = !btn.classList.contains('selected');
          btn.classList.toggle('selected', on);
          btn.setAttribute('aria-pressed', String(on));
          if (on) selectedFeelings.add(feeling.id); else selectedFeelings.delete(feeling.id);
          confirmBtn.disabled = selectedFeelings.size === 0;
        });
        list.appendChild(btn);
      });
      choiceHolder.appendChild(list);

      confirmRow.innerHTML = '';
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary tap-target';
      confirmBtn.textContent = P.confirmPick;
      confirmBtn.disabled = true;
      confirmBtn.addEventListener('click', () => submitFeelings(scenario));
      confirmRow.appendChild(confirmBtn);
    }

    function submitFeelings(scenario) {
      const plausibleIds = scenario.feelings.filter((f) => f.tag === 'plausible').map((f) => f.id);
      const selectedPlausible = plausibleIds.filter((id) => selectedFeelings.has(id));
      const selectedLessFitting = scenario.feelings.filter((f) => f.tag === 'less_fitting' && selectedFeelings.has(f.id));
      if (selectedPlausible.length >= 2) multiFeelingCount++;

      // Never scored correct/incorrect — per §5.6, this can't claim to
      // diagnose an emotion. selectedLessFitting only gets a gentle
      // cue-based redirect, never a "wrong" framing.
      onEvidence('response_submitted', {
        scenarioIndex: index, stage: 'feelings',
        selectedCount: selectedFeelings.size, plausibleCount: selectedPlausible.length, lessFittingCount: selectedLessFitting.length,
      });

      let message;
      if (selectedLessFitting.length > 0) {
        message = selectedLessFitting.map((f) => f.note).filter(Boolean).join(' ') || 'Take another look at the cues — some of them point somewhere else.';
      } else {
        message = scenario.reinforcement || 'That fits what is happening here.';
      }

      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback('correct', message));
      if (voiced) speak(message, true);

      setTimeout(() => {
        const check = selfCheckFor(scenario);
        if (check) renderSelfCheck(scenario, check); else afterFeelings(scenario);
      }, holdFor(message, 1800));
    }

    function afterFeelings(scenario) {
      if (scenario.seekHelp) {
        renderSeekHelp(scenario);
      } else {
        advance();
      }
    }

    // A scenario's own selfCheck wins; null switches it off for that scenario; otherwise the pack's applies.
    function selfCheckFor(scenario) {
      if (scenario.selfCheck === null) return null;
      return scenario.selfCheck || contentPack.selfCheck || null;
    }

    function renderSelfCheck(scenario, check) {
      stage = 'self_check';
      feedbackHolder.innerHTML = '';
      confirmRow.innerHTML = '';
      onEvidence('item_presented', { scenarioIndex: index, stage: 'self_check' });
      askSelfCheck(check.prompt, check.options, () => {
        // Deliberately NOT logging which option was picked: a young child's answer about their own life stays
        // on the screen. Only the fact that the step was reached is recorded.
        onEvidence('response_submitted', { scenarioIndex: index, stage: 'self_check' });
        setTimeout(() => {
          askSelfCheck(check.bodyPrompt, check.bodyOptions, () => {
            selfChecks++;
            onEvidence('response_submitted', { scenarioIndex: index, stage: 'self_check_body' });
            feedbackHolder.innerHTML = '';
            const closing = check.closing || 'Nice job checking in with yourself.';
            feedbackHolder.appendChild(FnGameShell.renderFeedback('correct', closing));
            if (voiced) speak(closing, true);
            setTimeout(() => afterFeelings(scenario), holdFor(closing, 2200));
          }, check.privateNote);
        }, 500);
      }, check.privateNote);
    }

    function askSelfCheck(prompt, options, onPick, privateNote) {
      promptBox.textContent = prompt;
      selfNarration = voiced ? sentenceJoin([prompt].concat(options.map((o) => o.text))) : [prompt].concat(options.map((o) => o.text)).join('. ');
      renderReplay(null);
      speak(selfNarration, voiced);
      choiceHolder.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'fn-choice-list long-text-list';
      options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target long-text';
        btn.textContent = opt.text;
        btn.addEventListener('click', () => {
          [...list.children].forEach((c) => { c.disabled = true; });
          btn.classList.add('selected');
          onPick();
        });
        list.appendChild(btn);
      });
      choiceHolder.appendChild(list);
      if (privateNote) {
        const note = document.createElement('p');
        note.className = 'sr-only';
        note.textContent = privateNote;
        choiceHolder.appendChild(note);
      }
    }

    function renderSeekHelp(scenario) {
      feedbackHolder.innerHTML = '';
      promptBox.textContent = scenario.seekHelp.prompt;
      onEvidence('item_presented', { scenarioIndex: index, stage: 'seek_help' });
      choiceHolder.innerHTML = '';
      const note = document.createElement('p');
      note.className = 'fn-shell-feedback band-aware correct';
      note.textContent = scenario.seekHelp.text;
      choiceHolder.appendChild(note);

      confirmRow.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary tap-target';
      btn.textContent = 'Continue';
      btn.addEventListener('click', () => {
        onEvidence('response_submitted', { scenarioIndex: index, stage: 'seek_help' });
        advance();
      });
      confirmRow.appendChild(btn);
    }

    function advance() {
      index++;
      replayRow.innerHTML = '';
      confirmRow.innerHTML = '';
      if (index >= scenarios.length) {
        onComplete([
          { value: scenarios.length, label: t('scLabelScenarios') },
          { value: cuesNoticedTotal, label: t('scLabelCues') },
          { value: multiFeelingCount, label: P.multiLabel },
        ].concat(contentPack.selfCheck ? [{ value: selfChecks, label: contentPack.selfCheck.summaryLabel || 'Times you checked in with yourself' }] : []));
      } else {
        renderScenario();
      }
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'scenarioChoice', version: 1, mount });
})();
