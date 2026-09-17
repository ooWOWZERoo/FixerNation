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
// }] }
(function () {
  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {}
  }

  function mount(container, { contentPack, onEvidence, onComplete }) {
    const scenarios = contentPack.scenarios;
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

    function narrationFor(scenario) {
      if (stage === 'cues') {
        return [scenario.context, ...scenario.cues.map((c) => c.text)].join('. ');
      }
      return scenario.feelings.map((f) => f.text).join(', ');
    }

    function renderReplay(scenario) {
      replayRow.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-sm tap-target';
      btn.textContent = '▶ Replay';
      btn.addEventListener('click', () => {
        onEvidence('hint_requested', { scenarioIndex: index, kind: 'narration_replay', stage });
        speak(narrationFor(scenario));
      });
      replayRow.appendChild(btn);
    }

    function renderScenario() {
      stage = 'cues';
      selectedCues = new Set();
      const scenario = scenarios[index];
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(index + 1, scenarios.length));
      contextBox.innerHTML = `<span aria-hidden="true" style="font-size:2.5em;display:block;text-align:center;">${scenario.illustration || ''}</span><span class="sr-only">${scenario.context}</span>`;
      onEvidence('item_presented', { scenarioIndex: index, stage: 'cues' });
      renderCueStage(scenario);
    }

    function renderCueStage(scenario) {
      feedbackHolder.innerHTML = '';
      promptBox.textContent = 'Which of these do you notice in this moment?';
      renderReplay(scenario);
      speak(narrationFor(scenario));

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
      confirmBtn.textContent = "I've noticed these";
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
      feedbackHolder.appendChild(FnGameShell.renderFeedback('correct', `Good noticing — now let's think about how this might feel.`));
      setTimeout(() => renderFeelingsStage(scenario), 1200);
    }

    function renderFeelingsStage(scenario) {
      stage = 'feelings';
      selectedFeelings = new Set();
      feedbackHolder.innerHTML = '';
      promptBox.textContent = 'Which feeling(s) could this be? You can pick more than one.';
      onEvidence('item_presented', { scenarioIndex: index, stage: 'feelings' });
      renderReplay(scenario);
      speak(narrationFor(scenario));

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
      confirmBtn.textContent = "I've picked my feeling(s)";
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

      setTimeout(() => {
        if (scenario.seekHelp) {
          renderSeekHelp(scenario);
        } else {
          advance();
        }
      }, 1800);
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
          { value: scenarios.length, label: 'Scenarios explored' },
          { value: cuesNoticedTotal, label: 'Cues noticed' },
          { value: multiFeelingCount, label: 'Times you saw more than one feeling' },
        ]);
      } else {
        renderScenario();
      }
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'scenarioChoice', version: 1, mount });
})();
