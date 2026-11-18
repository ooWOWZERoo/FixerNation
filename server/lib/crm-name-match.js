// Customer Hub follow-up: SUGGESTING accounts (and people) whose names are alike. Pure JavaScript, no database, no new dependency.
//
// THE ONE RULE: a name match only ever SUGGESTS to a person. Nothing is linked, merged, archived or added because two names look alike (the import still links an organization to an
// account only when the name is EXACT, or when a person picks one of the suggestions; a merge is still the CRM Admin's own action). A shared email domain is never a signal.
//
// What counts as "alike" for two organizations (each point has a test):
//  - Same account type (a school is never matched to a district), and the same state when both have one (PA and Pennsylvania are the same state; a blank state matches any).
//  - Same significant words: capitals, punctuation, accents, "the", "of", "and", "school", "schools", "district", "public", "unified", "independent" and word order are ignored, and
//    common short forms are spelled out first (ISD, SD, Sch Dist, Elem, HS, MS, St, Mt, Jr ...).
//  - A different school LEVEL is never alike: "Maple Elementary" and "Maple High" are two schools. A name with no level matches either. A district and a named school level
//    ("Maple School District" and "Maple High") are never alike.
//  - Or the same words with one small spelling slip (one letter in a short name, two in a long one). A number that differs ("Lincoln 2" and "Lincoln 3") is never a slip.
const STATES = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming' };
const SHORT = { isd: 'independent school district', sd: 'school district', usd: 'unified school district', sch: 'school', schl: 'school', dist: 'district', elem: 'elementary', jr: 'junior', sr: 'senior', hs: 'high school', ms: 'middle school', es: 'elementary school', st: 'saint', mt: 'mount', ft: 'fort', ctr: 'center', acad: 'academy', univ: 'university', intermed: 'intermediate', prim: 'primary', mid: 'middle' };
const LEVELS = new Set(['elementary', 'primary', 'intermediate', 'middle', 'junior', 'high', 'senior']);
const GENERIC = new Set(['the', 'of', 'and', 'for', 'in', 'school', 'schools', 'district', 'public', 'unified', 'independent', 'area']);
const MIN_KEY = 5; // a shorter set of significant letters is too thin to call alike

function normState(s) {
  const t = String(s || '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
  if (!t) return '';
  return STATES[t] || t;
}

// 'St. Mary\'s Elem. School' -> the significant words ('marys saint', sorted; and in their written order), the school levels ('elementary') and any numbers in the name.
function normalizeOrgName(name) {
  let t = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = [];
  for (const w of t.split(' ')) { if (!w) continue; for (const x of (SHORT[w] || w).split(' ')) words.push(x); }
  const levels = new Set(words.filter(w => LEVELS.has(w)));
  const sig = words.filter(w => !GENERIC.has(w) && !LEVELS.has(w));
  const numbers = sig.filter(w => /\d/.test(w)).sort().join(' ');
  const sorted = sig.slice().sort().join(' ');
  return { sorted, ordered: sig.join(' '), levels, numbers, district: words.includes('district') };
}

// Edit distance, giving up early once it is certain to pass `cap` (returns cap + 1).
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = cur[0];
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
const slipsAllowed = (len) => (len >= 12 ? 2 : 1);

// { name, accountType?, state? } -> something comparable. Build once, compare many times.
function prepare(rec) { return { rec, n: normalizeOrgName(rec.name), type: rec.accountType || rec.account_type || '', state: normState(rec.state) }; }

// null when the two are not alike, else { reason: 'same_words' | 'close_spelling' }.
function compare(p, q) {
  if (p.rec.id !== undefined && p.rec.id === q.rec.id) return null;
  if (p.type && q.type && p.type !== q.type) return null;
  if (p.state && q.state && p.state !== q.state) return null;
  if (p.n.sorted.length < MIN_KEY || q.n.sorted.length < MIN_KEY) return null;
  if (p.n.levels.size && q.n.levels.size && ![...p.n.levels].some(l => q.n.levels.has(l))) return null; // Maple Elementary and Maple High are two schools
  if (p.n.district !== q.n.district && (p.n.levels.size || q.n.levels.size)) return null; // "Maple School District" and "Maple High" are a district and one of its schools
  if (p.n.sorted === q.n.sorted) return { reason: 'same_words' };
  if (p.n.numbers !== q.n.numbers) return null;
  // One small spelling slip: the same number of significant words, and where a word differs both are real words of five letters or more ("Oak A" and "Oak B" are two schools, not a typo).
  const wp = p.n.sorted.split(' '), wq = q.n.sorted.split(' ');
  if (wp.length !== wq.length) return null;
  const cap = slipsAllowed(Math.max(p.n.ordered.length, q.n.ordered.length));
  let used = 0;
  for (let i = 0; i < wp.length; i++) {
    if (wp[i] === wq[i]) continue;
    if (wp[i].length < 5 || wq[i].length < 5 || /\d/.test(wp[i] + wq[i])) return null;
    used += editDistance(wp[i], wq[i], cap - used);
    if (used > cap) return null;
  }
  return used ? { reason: 'close_spelling' } : null;
}

// Accounts that look like `target` ({ name, accountType?, state? }), best first, at most `limit`. `prepared` is prepare() of each live account. Same words rank above a spelling slip.
function suggestFor(target, prepared, { limit = 3, excludeIds = [] } = {}) {
  const t = prepare(target);
  if (t.n.sorted.length < MIN_KEY) return [];
  const skip = new Set(excludeIds.map(Number));
  const out = [];
  for (const p of prepared) {
    if (skip.has(Number(p.rec.id))) continue;
    const m = compare(t, p);
    if (m) out.push({ id: Number(p.rec.id), name: p.rec.name, accountType: p.type || null, state: p.rec.state || null, reason: m.reason });
  }
  out.sort((a, b) => (a.reason === b.reason ? a.name.localeCompare(b.name) : a.reason === 'same_words' ? -1 : 1));
  return out.slice(0, limit);
}

// Groups of live accounts whose names are alike, for the Possible duplicates tab. `accounts` rows carry id, name, account_type, state (and whatever else the caller wants back);
// `skipPairs` is a Set of 'low-high' pairs already shown some other way (the same website). Each group carries `edges`, the pairs that really are alike, because "A like B" and
// "B like C" does not make A like C. Capped, and `truncated` says so.
const MAX_PAIRS = 3000;
function similarNameGroups(accounts, { skipPairs = new Set() } = {}) {
  const prepared = accounts.map(prepare).filter(p => p.n.sorted.length >= MIN_KEY);
  const byType = new Map();
  for (const p of prepared) (byType.get(p.type) || byType.set(p.type, []).get(p.type)).push(p);
  const edges = []; let truncated = false;
  const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (const list of byType.values()) {
    list.sort((a, b) => a.n.ordered.length - b.n.ordered.length);
    for (let i = 0; i < list.length && !truncated; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].n.ordered.length - list[i].n.ordered.length > 2) break; // sorted by length: nothing further along can be within two slips
        const m = compare(list[i], list[j]);
        if (!m) continue;
        const k = pairKey(Number(list[i].rec.id), Number(list[j].rec.id));
        if (skipPairs.has(k)) continue;
        edges.push([Number(list[i].rec.id), Number(list[j].rec.id), m.reason]);
        if (edges.length >= MAX_PAIRS) { truncated = true; break; }
      }
    }
  }
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const [a, b] of edges) parent.set(find(a), find(b));
  const recById = new Map(prepared.map(p => [Number(p.rec.id), p.rec]));
  const comps = new Map();
  for (const [a, b] of edges) { const r = find(a); if (!comps.has(r)) comps.set(r, { ids: new Set(), edges: new Set() }); const c = comps.get(r); c.ids.add(a); c.ids.add(b); c.edges.add(pairKey(a, b)); }
  const groups = [...comps.values()].map(c => ({ ids: [...c.ids].sort((x, y) => x - y), edges: c.edges }));
  groups.sort((x, y) => x.ids[0] - y.ids[0]);
  return { groups: groups.map(g => ({ accounts: g.ids.map(id => recById.get(id)), edges: g.edges })), truncated };
}

// People: two full names that differ by one letter in a name of eight or more letters, with the same last word ("Jon Smith" and "John Smith"). Used only to queue an import row
// for a person to look at; it never adds, merges or changes anyone.
function similarPersonName(a, b) {
  const x = String(a || '').trim().toLowerCase().replace(/\s+/g, ' '), y = String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (x.length < 8 || y.length < 8 || x === y) return false;
  const lx = x.split(' '), ly = y.split(' ');
  if (lx.length < 2 || ly.length < 2 || lx[lx.length - 1] !== ly[ly.length - 1]) return false;
  return editDistance(x, y, 1) <= 1;
}
const lastWord = (n) => { const w = String(n || '').trim().toLowerCase().replace(/\s+/g, ' ').split(' '); return w.length >= 2 ? w[w.length - 1] : null; };

module.exports = { normalizeOrgName, normState, editDistance, prepare, compare, suggestFor, similarNameGroups, similarPersonName, lastWord, MAX_PAIRS, MIN_KEY };
