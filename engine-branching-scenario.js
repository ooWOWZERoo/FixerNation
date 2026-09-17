// Tune Your Brain, Phase 3 — the Branching Scenario engine. Implements
// FNE's Issues-to-Answers 5-step cycle as structured fields (per T9 in
// BLUEPRINT_TRACEABILITY_MATRIX.md), not free-form scenario text, so
// game-form and lesson-form delivery of the framework stay recognizably
// the same thing. Needed for the Phase 5 pilot's Decision Point.
//
// contentPack shape:
// { title, steps: [{
//     key: 'recognize' | 'impact' | 'consider' | 'choose' | 'reflect',
//     prompt: '...',
//     choices?: [{ id, text, type: 'unsafe'|'plausible_incomplete'|'responsible'|
//                  'multiple_defensible'|'context_dependent'|'seek_help', feedback: '...' }],
//     freeReflection?: true,   // 'reflect' step only — see note below
// }] }
//
// Per §6.6's scenario-scoring rule, feedback always explains impact/
// tradeoffs, never just "correct"/"wrong" — and per T20/§10.6, a
// freeReflection step's text is NEVER sent anywhere (no fetch call with its
// content) — it's shown locally to the learner only. A real Phase 6+
// build that persists reflections must route through
// server/lib/safety/gateway.js into student_reflections, like
// server.js's existing reflection paths — not through this demo engine.
(function () {
  const STEP_LABELS = {
    recognize: 'Recognize the Issue', impact: 'Understand the Impact',
    consider: 'Consider Possible Answers', choose: 'Choose a Responsible Response',
    reflect: 'Reflect and Reinforce',
  };

  function mount(container, { contentPack, onEvidence, onComplete }) {
    const steps = contentPack.steps;
    let stepIndex = 0;
    const responseTypes = [];

    const progressHolder = document.createElement('div');
    const stepLabel = document.createElement('div');
    stepLabel.style.cssText = 'text-align:center;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--coral);margin-bottom:8px;';
    const promptBox = document.createElement('p');
    promptBox.style.cssText = 'font-weight:700;margin-bottom:8px;font-size:calc(16px * var(--band-scale,1));';
    const bodyHolder = document.createElement('div');
    const feedbackHolder = document.createElement('div');

    container.append(progressHolder, stepLabel, promptBox, bodyHolder, feedbackHolder);
    renderStep();

    function renderStep() {
      feedbackHolder.innerHTML = '';
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(stepIndex + 1, steps.length));

      const step = steps[stepIndex];
      stepLabel.textContent = STEP_LABELS[step.key] || step.key;
      promptBox.textContent = step.prompt;
      onEvidence('item_presented', { stepKey: step.key });

      bodyHolder.innerHTML = '';
      if (step.freeReflection) {
        renderReflection(step);
      } else {
        renderChoices(step);
      }
    }

    function renderChoices(step) {
      const list = document.createElement('div');
      list.className = 'fn-choice-list';
      step.choices.forEach((choice) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target';
        btn.textContent = choice.text;
        btn.addEventListener('click', () => pickChoice(choice, btn, list, step));
        list.appendChild(btn);
      });
      bodyHolder.appendChild(list);
    }

    function pickChoice(choice, btnEl, listEl, step) {
      [...listEl.children].forEach((c) => { c.disabled = true; });
      btnEl.classList.add('selected');
      responseTypes.push(choice.type);
      onEvidence('response_submitted', { stepKey: step.key, choiceType: choice.type });

      // Never reduce this to correct/incorrect — the blueprint explicitly
      // prohibits treating SEL as a trivia contest. "unsafe" is the only
      // type that gets a corrective framing; everything else is explained
      // on its own terms (impact/tradeoffs), even "plausible_incomplete".
      const kind = choice.type === 'unsafe' ? 'incorrect' : 'correct';
      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback(kind, choice.feedback || 'Thanks for choosing.'));

      setTimeout(advance, 1600);
    }

    function renderReflection(step) {
      const textarea = document.createElement('textarea');
      textarea.setAttribute('aria-label', 'Your reflection (private — not saved in this demo)');
      textarea.style.cssText = 'width:100%;min-height:80px;padding:12px;border-radius:var(--band-radius,var(--radius-sm));border:2px solid var(--border);font-family:inherit;font-size:14px;margin-bottom:12px;';
      textarea.placeholder = 'Type a few words about what you\'d take away from this...';
      const note = document.createElement('p');
      note.className = 'sr-only';
      note.textContent = 'This reflection is private and is not sent anywhere in this demo.';
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-primary tap-target';
      doneBtn.textContent = 'Continue';
      doneBtn.addEventListener('click', () => {
        // Deliberately NOT reading textarea.value into any evidence/log
        // call — see file header. Only that the step was reached is logged.
        onEvidence('response_submitted', { stepKey: step.key, hasReflection: textarea.value.length > 0 });
        advance();
      });
      bodyHolder.append(textarea, note, doneBtn);
    }

    function advance() {
      stepIndex++;
      if (stepIndex >= steps.length) {
        const responsible = responseTypes.filter((t) => t === 'responsible' || t === 'multiple_defensible').length;
        onComplete([
          { value: steps.length, label: 'Steps completed' },
          { value: responsible, label: 'Responsible choices' },
        ]);
      } else {
        renderStep();
      }
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'branchingScenario', version: 1, mount });
})();
