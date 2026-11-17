// Sales CRM punch list G6 (PRD FR-QUAL-01 and FR-QUAL-03): what we know about a deal's need, and a plain list of what is still unknown.
//
// Rules this file keeps (each has a test):
//  - Every criterion is OPTIONAL. Nothing here blocks a save, a stage move, a quote or a close: a missing answer is only listed. (Owner, 2026-11-16: add every field now, trim
//    after real use; "missing shouldn't block anything".)
//  - There is NO score. The scored qualification model stays deferred (D9). The output is a list of answers and a list of gaps, never a number that ranks a deal.
//  - The champion and the decision maker are not typed here: they are the people on the buying committee with that role, so there is one place to say who they are.
//    "Start of use" (target_implementation_date) and "Competitor" are the deal's existing fields, shown in the same list.
//  - Counts are whole numbers (0 to 1,000,000) and text is cut to a length; anything else is refused with a plain message. A student count is a number, never a name.
const { text } = require('./crm-common');

const MAX_COUNT = 1000000;
// body key -> column, kind, max length (text only)
const FIELDS = [
  { key: 'schools', col: 'qual_schools', kind: 'count', label: 'Number of schools' },
  { key: 'teachers', col: 'qual_teachers', kind: 'count', label: 'Number of teachers' },
  { key: 'students', col: 'qual_students', kind: 'count', label: 'Number of students' },
  { key: 'grades', col: 'qual_grades', kind: 'text', max: 64, label: 'Grades served' },
  { key: 'need', col: 'qual_need', kind: 'text', max: 1000, label: 'What they need' },
  { key: 'funding', col: 'qual_funding', kind: 'text', max: 255, label: 'Funding' },
  { key: 'procurementPath', col: 'qual_procurement_path', kind: 'text', max: 255, label: 'How they buy (procurement path)' },
  { key: 'risks', col: 'qual_risks', kind: 'text', max: 1000, label: 'Risks' },
];

// What a person typed -> { fields } (column names, only the keys that were sent) or { error }.
function clean(b) {
  const f = {};
  const body = b || {};
  for (const d of FIELDS) {
    const v = body[d.key];
    if (v === undefined) continue;
    if (d.kind === 'count') {
      if (v === null || v === '') { f[d.col] = null; continue; }
      const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,7}$/.test(v.trim()) ? Number(v) : NaN);
      if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) return { error: `${d.label} must be a whole number from 0 to ${MAX_COUNT.toLocaleString('en-US')}, or blank.` };
      f[d.col] = n;
    } else {
      f[d.col] = v === null ? null : text(v, d.max);
    }
  }
  return { fields: f };
}

// The saved answers, as the page and API show them.
function view(o) {
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    schools: num(o.qual_schools), teachers: num(o.qual_teachers), students: num(o.qual_students),
    grades: o.qual_grades || null, need: o.qual_need || null, funding: o.qual_funding || null,
    procurementPath: o.qual_procurement_path || null, risks: o.qual_risks || null,
  };
}

// The full list of twelve criteria with what is known, and the gaps. `committee` is the deal's buying committee ({ role, name }). Never throws on a missing column: an
// old database simply has nothing filled in.
function assess(o, committee = []) {
  const v = view(o);
  const byRole = (role) => committee.filter(m => m.role === role);
  const people = (role) => byRole(role).map(m => m.name || m.email).filter(Boolean).slice(0, 5).join(', ') || null;
  const rows = [
    { key: 'schools', label: 'Number of schools', value: v.schools },
    { key: 'teachers', label: 'Number of teachers', value: v.teachers },
    { key: 'students', label: 'Number of students', value: v.students },
    { key: 'grades', label: 'Grades served', value: v.grades },
    { key: 'need', label: 'What they need', value: v.need },
    { key: 'funding', label: 'Funding', value: v.funding },
    { key: 'targetDate', label: 'Start of use', value: o.target_implementation_date || null, where: 'edit' },
    { key: 'champion', label: 'Champion', value: byRole('champion').length ? (people('champion') || 'Named') : null, where: 'committee' },
    { key: 'decisionMaker', label: 'Decision maker', value: byRole('decision_maker').length ? (people('decision_maker') || 'Named') : null, where: 'committee' },
    { key: 'procurementPath', label: 'How they buy (procurement path)', value: v.procurementPath },
    { key: 'risks', label: 'Risks', value: v.risks },
    { key: 'competitor', label: 'Competitors', value: o.competitor || null },
  ].map(r => ({ ...r, known: r.value !== null && r.value !== undefined && r.value !== '', where: r.where || 'edit' }));
  return {
    criteria: rows,
    known: rows.filter(r => r.known).length,
    total: rows.length,
    missing: rows.filter(r => !r.known).map(r => ({ key: r.key, label: r.label, where: r.where })),
  };
}

module.exports = { FIELDS, clean, view, assess, MAX_COUNT };
