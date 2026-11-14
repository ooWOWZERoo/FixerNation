// Small shared helpers for the Sales CRM routes (routes/crm-*.js): input cleaning and paging. No database access here.

const ACCOUNT_TYPES = ['school', 'district', 'charter', 'nonprofit', 'other'];
const OPP_STATES = ['open', 'won', 'lost', 'inactive'];
const OPP_TYPES = ['new_business', 'expansion', 'renewal', 'cross_sell'];
const COMMITTEE_ROLES = ['champion', 'decision_maker', 'influencer', 'finance', 'procurement', 'end_user', 'other'];
const INFLUENCE = ['low', 'medium', 'high'];
const STANCE = ['supporter', 'neutral', 'skeptic', 'unknown'];

// typeof first: RegExp.test() and String() coerce undefined and objects (CLAUDE.md), so request input is checked before it is trusted.
function text(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function posInt(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Money is whole cents, never a float: 0 or more, and capped so a typo cannot overflow INT UNSIGNED.
function cents(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= 0 && n <= 4000000000 ? n : null;
}

// 'YYYY-MM-DD' that is a real calendar date, else null.
function dateOnly(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
  const d = new Date(`${v.trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v.trim() ? null : v.trim();
}

// A date or an ISO date-time, stored as UTC 'YYYY-MM-DD HH:MM:SS' (CLAUDE.md: UTC in storage, local in the page).
function utcDateTime(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

function oneOf(v, list) {
  return typeof v === 'string' && list.includes(v) ? v : null;
}

function paging(query, { defaultSize = 50, maxSize = 200 } = {}) {
  const page = Math.max(1, posInt(query.page) || 1);
  const size = Math.min(maxSize, posInt(query.pageSize) || defaultSize);
  return { page, size, offset: (page - 1) * size };
}

// A LIKE pattern from what a person typed, with the wildcard characters made literal. Use it as: col LIKE ? ESCAPE '!' (the same on MariaDB and SQLite).
function likeTerm(q) {
  const t = text(q, 100);
  return t ? `%${t.replace(/[!%_]/g, c => '!' + c)}%` : null;
}

function daysSince(sqlDateTime) {
  if (!sqlDateTime) return null;
  const t = new Date(String(sqlDateTime).replace(' ', 'T') + 'Z').getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

module.exports = {
  ACCOUNT_TYPES, OPP_STATES, OPP_TYPES, COMMITTEE_ROLES, INFLUENCE, STANCE,
  text, posInt, cents, dateOnly, utcDateTime, oneOf, paging, likeTerm, daysSince,
};
