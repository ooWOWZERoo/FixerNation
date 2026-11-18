// Sales CRM punch list G15 (PROC-01): the three steps the standard procurement checklist was missing (a certificate of insurance, board or committee approval, and the signed
// contract), and the rule for adding them to a checklist a CRM Admin already saved. Adding is one click per checklist (Hub Settings), never done behind anyone's back.
//
//  - A step counts as already there when a step with the same words (any capitals) is on the list. A checklist that says the same thing in other words will be offered the step; the
//    CRM Admin simply does not click, or removes the duplicate.
//  - The onboarding checklist (lib/crm-onboarding.js) is a different kind of list and is never offered these.
//  - A template keeps at most 30 steps (the route's own limit); the extra steps are added only as far as they fit.
const OB = require('./crm-onboarding');

const STANDARD_EXTRA_STEPS = [
  'Certificate of insurance (COI) sent',
  'Board or committee approval received',
  'Contract or master agreement signed',
];
const MAX_STEPS = 30;

const norm = (s) => String(s || '').trim().toLowerCase();
const isProcurement = (name) => norm(name) !== norm(OB.TEMPLATE_NAME);

// The standard steps a template does not have yet (none for the onboarding checklist).
function missingFor(name, steps) {
  if (!isProcurement(name)) return [];
  const have = new Set((steps || []).map(norm));
  return STANDARD_EXTRA_STEPS.filter(s => !have.has(norm(s)));
}

module.exports = { STANDARD_EXTRA_STEPS, MAX_STEPS, missingFor, isProcurement };
