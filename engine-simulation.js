// Tune Your Brain, Phase 3 — the Simulation engine ("Manage a system over
// time... decision log, debrief"). Needed for the Phase 5 pilot's Money
// Matters.
//
// contentPack shape:
// { title, goal, startingResources: {label: value, ...},
//   events: [{ prompt, options: [{ id, label, delta: {label: number} }] }],
//   debrief: (finalResources) => string }   // plain function — no server
//   round-trip needed since this is a bounded, deterministic scenario
//
// Per §14.3's acceptance rule, more than one path can succeed — the
// debrief function decides that from the content pack's own logic, not a
// hardcoded pass/fail the engine imposes.
(function () {
  function mount(container, { contentPack, onEvidence, onComplete }) {
    const resources = { ...contentPack.startingResources };
    const decisionLog = [];
    let eventIndex = 0;

    const goalBox = document.createElement('p');
    goalBox.style.cssText = 'font-size:14px;color:var(--ink-soft);margin-bottom:12px;';
    goalBox.textContent = contentPack.goal || '';
    const resourceRow = document.createElement('div');
    resourceRow.className = 'fn-sim-resource-row';
    const progressHolder = document.createElement('div');
    const promptBox = document.createElement('p');
    promptBox.style.cssText = 'font-weight:700;margin:12px 0;font-size:calc(16px * var(--band-scale,1));';
    const choiceHolder = document.createElement('div');
    const feedbackHolder = document.createElement('div');

    container.append(goalBox, resourceRow, progressHolder, promptBox, choiceHolder, feedbackHolder);
    renderResources();
    renderEvent();

    function renderResources() {
      resourceRow.innerHTML = Object.entries(resources).map(([label, val]) => `
        <div class="fn-sim-resource band-aware"><div class="val">${val}</div><div class="lbl">${label}</div></div>
      `).join('');
    }

    function renderEvent() {
      feedbackHolder.innerHTML = '';
      progressHolder.innerHTML = '';
      progressHolder.appendChild(FnGameShell.renderProgress(eventIndex + 1, contentPack.events.length));

      const event = contentPack.events[eventIndex];
      promptBox.textContent = event.prompt;
      onEvidence('item_presented', { eventIndex });

      choiceHolder.innerHTML = '';
      const list = document.createElement('div');
      list.className = 'fn-choice-list';
      event.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fn-choice-btn band-aware tap-target';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => pickOption(opt, btn, list, event));
        list.appendChild(btn);
      });
      choiceHolder.appendChild(list);
    }

    function pickOption(opt, btnEl, listEl, event) {
      [...listEl.children].forEach((c) => { c.disabled = true; });
      btnEl.classList.add('selected');

      Object.entries(opt.delta || {}).forEach(([label, change]) => {
        resources[label] = (resources[label] || 0) + change;
      });
      renderResources();
      decisionLog.push(`${event.prompt} → ${opt.label}`);
      onEvidence('response_submitted', { eventIndex, optionId: opt.id, delta: opt.delta });

      feedbackHolder.innerHTML = '';
      feedbackHolder.appendChild(FnGameShell.renderFeedback('correct', 'Logged. Moving to the next decision...'));

      setTimeout(() => {
        eventIndex++;
        if (eventIndex >= contentPack.events.length) {
          finish();
        } else {
          renderEvent();
        }
      }, 900);
    }

    function finish() {
      const debriefMessage = typeof contentPack.debrief === 'function'
        ? contentPack.debrief(resources)
        : 'Simulation complete.';
      const logBox = document.createElement('div');
      logBox.className = 'fn-sim-log';
      logBox.innerHTML = `<strong>${debriefMessage}</strong>` + decisionLog.map((l) => `<div>• ${l}</div>`).join('');
      container.appendChild(logBox);

      onComplete(
        Object.entries(resources).map(([label, val]) => ({ value: val, label }))
      );
    }
  }

  window.FnEngineSDK.registerEngine({ name: 'simulation', version: 1, mount });
})();
