// The four grade levels a teacher can be registered for. The full names are what the database stores
// (site_user_audiences.audience, curriculum_audiences.audience, school_invitations.audiences); the two-letter
// codes are only for people: invite forms, CSV files, CRM pills.
const GRADE_LEVELS = [
  { code: 'ES', name: 'Elementary School' },
  { code: 'MS', name: 'Middle School' },
  { code: 'HS', name: 'High School' },
  { code: 'HE', name: 'Higher Education' },
];

const BY_KEY = new Map();
for (const g of GRADE_LEVELS) {
  BY_KEY.set(g.code.toLowerCase(), g.name);
  BY_KEY.set(g.name.toLowerCase(), g.name);
}

const codeOf = (name) => (GRADE_LEVELS.find((g) => g.name === name) || {}).code || null;

// Accepts an array, or a string separated by ; , or | (CSV cells use ; because the page splits rows on commas), of codes
// or full names in any letter case. Returns the full names, in the fixed ES, MS, HS, HE order, no duplicates.
// Throws a { status: 400 } error for an empty list or anything that is not one of the four levels, so a typo
// like "4th grade" is refused rather than silently stored.
function parseGradeLevels(input) {
  let parts;
  if (Array.isArray(input)) parts = input;
  else if (typeof input === 'string') parts = input.split(/[;,|]/);
  else parts = [];
  const wanted = new Set();
  for (const raw of parts) {
    if (typeof raw !== 'string') throw gradeError('Grade levels must be ES, MS, HS or HE.');
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const name = BY_KEY.get(key);
    if (!name) throw gradeError(`"${raw.trim()}" is not a grade level. Use ES, MS, HS or HE.`);
    wanted.add(name);
  }
  if (!wanted.size) throw gradeError('Choose at least one grade level (ES, MS, HS or HE).');
  return GRADE_LEVELS.map((g) => g.name).filter((n) => wanted.has(n));
}

function gradeError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// "ES, MS" for display and for the older free-text grade_level column; unknown names are skipped.
function summarize(names) {
  return (names || []).map(codeOf).filter(Boolean).join(', ');
}

// Stored in school_invitations.audiences. Full names never contain a comma.
const toStored = (names) => names.join(',');
const fromStored = (text) => (text ? String(text).split(',').map((s) => s.trim()).filter((s) => BY_KEY.has(s.toLowerCase())).map((s) => BY_KEY.get(s.toLowerCase())) : []);

module.exports = { GRADE_LEVELS, parseGradeLevels, summarize, toStored, fromStored, codeOf };
