/* Customer Hub status outlines (red, yellow, green) for the Overview boxes that report work status. Pure rules, no page code: the Overview asks "what level is this box?"
   and draws the outline and the chip with the answer. Rules and reasons: docs/reference/sales-crm-update-requirements.md, "Overview status outlines".

   Only boxes about WORK that can be late use this: my tasks, needs attention, overdue next steps, things waiting for a decision. It is never used on a person or a
   contact (Suspect, Prospect and Customer stay as they are: red, yellow and green on a contact would read like hot, warm and cold).

     red      something is late
     yellow   due today, or waiting for someone to decide
     green    nothing is waiting
     neutral  nothing set up yet (no tasks at all): not green, because there is nothing to be on time about

   Colour is never the only signal: each level has its own shape and its own word. */
(function (root) {
  'use strict';

  // The Needs Attention rules that mean "past a date or stuck". Every other rule is "worth a look". A test keeps this list in step with lib/crm-attention.js.
  var RED_RULES = ['next_step_overdue', 'task_overdue', 'checklist_overdue', 'won_no_purchase'];

  var SHAPE = { red: '▲', amber: '●', green: '✓', neutral: '–' }; // triangle, circle, check, dash: different shapes, not just different colours
  var LEGEND = 'Outline colours: red means something is late. Yellow means it is due today or waiting for a decision. Green means nothing is waiting. Grey means there is nothing to report yet.';

  function num(n) { n = Number(n); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }

  // My tasks today. `s` is the summary the tasks API returns: { open, overdue, dueToday }.
  function tasks(s) {
    s = s || {};
    var open = num(s.open), overdue = num(s.overdue), today = num(s.dueToday);
    if (overdue) return { level: 'red', word: overdue + ' overdue' };
    if (today) return { level: 'amber', word: today === 1 ? '1 due today' : today + ' due today' };
    if (open) return { level: 'green', word: 'On time' };
    return { level: 'neutral', word: 'No open tasks' };
  }

  // Needs attention. `counts` is the count of active items per rule from the attention API.
  function attention(counts) {
    counts = counts || {};
    var total = 0, red = 0;
    Object.keys(counts).forEach(function (k) { var n = num(counts[k]); total += n; if (RED_RULES.indexOf(k) !== -1) red += n; });
    if (red) return { level: 'red', word: red + ' late' };
    if (total) return { level: 'amber', word: total + ' to look at' };
    return { level: 'green', word: 'All clear' };
  }

  // Overdue next steps: late or not.
  function overdueDeals(total) {
    total = num(total);
    return total ? { level: 'red', word: total + ' overdue' } : { level: 'green', word: 'None late' };
  }

  // Anything that is waiting for a person to decide, or a gap to fill (quotes with no deal, deals with no next step).
  function waiting(total) {
    total = num(total);
    return total ? { level: 'amber', word: total + ' waiting' } : { level: 'green', word: 'Nothing waiting' };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The chip that goes in a box's header: the shape and the word, readable with no colour at all.
  function chip(status) {
    return '<span class="crm-status-chip crm-status-' + esc(status.level) + '"><span aria-hidden="true">' + SHAPE[status.level] + '</span> ' + esc(status.word) + '</span>';
  }
  // The class that draws the outline on the box.
  function boxClass(status) { return 'crm-status-box crm-status-' + status.level; }

  var api = { tasks: tasks, attention: attention, overdueDeals: overdueDeals, waiting: waiting, chip: chip, boxClass: boxClass, RED_RULES: RED_RULES, LEGEND: LEGEND };
  root.FnCrmStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
