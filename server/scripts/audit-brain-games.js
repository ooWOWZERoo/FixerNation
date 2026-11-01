// Read-only audit of every brain game page (Phase 0 of docs/tune-your-brain/GAME_REVERIFICATION_PLAN.md).
// Reads brain-*.html at the repo root, pulls out each engine game's `contentPack`, and reports what a
// student actually gets on every run: how many rounds, how much is randomized, how much text, what the
// default band is. It changes nothing and needs no database.
//   node server/scripts/audit-brain-games.js            readable table
//   node server/scripts/audit-brain-games.js --json     the same data as JSON
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const NOT_GAMES = new Set(['brain-badges.html', 'brain-games.html', 'brain-games-progress.html']);

// Match one bracket pair starting at src[open] (strings and comments respected); returns the index after the closer.
function matchPair(src, open) {
  const pairs = { '{': '}', '[': ']' };
  const opener = src[open], closer = pairs[opener];
  let depth = 0, str = null, i = open;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === opener) depth++;
    if (c === closer && --depth === 0) return i + 1;
  }
  return -1;
}

// Pull `const contentPack = { ... };` out of a page, plus a later `contentPack.variants = [ ... ];` if there is one.
function extractPack(src) {
  const start = src.indexOf('const contentPack');
  if (start < 0) return null;
  const from = src.indexOf('{', start);
  const end = matchPair(src, from);
  let pack;
  try { pack = vm.runInNewContext('(' + src.slice(from, end) + ')', { band: 'x', params: new URLSearchParams('') }); } catch { return null; }
  const v = src.indexOf('contentPack.variants', end);
  if (v >= 0) {
    const open = src.indexOf('[', src.indexOf('=', v));
    const close = matchPair(src, open);
    try { vm.runInNewContext('contentPack.variants = ' + src.slice(open, close), { contentPack: pack }); } catch { /* leave without variants */ }
  }
  return pack;
}

const words = (v) => JSON.stringify(v || '').replace(/[^A-Za-z' ]+/g, ' ').split(/\s+/).filter(Boolean).length;

function audit(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const slug = file.replace(/^brain-|\.html$/g, '');
  const engine = [...new Set((src.match(/engine-([a-z-]+)\.js/g) || []).filter((e) => !/sdk/.test(e)).map((e) => e.replace(/^engine-|\.js$/g, '')))];
  const band = (src.match(/params\.get\('band'\) \|\| '([a-z]+)'/) || [])[1] || null;
  const row = { slug, file, engine: engine.join('+') || 'legacy', band, randomized: /Math\.random|shuffle/.test(src), lines: src.split('\n').length, flags: [] };
  const pack = extractPack(src);
  if (!pack) { row.rounds = null; row.note = engine.length ? 'could not read contentPack' : 'legacy: content generated at runtime'; return row; }
  const list = pack.items || pack.steps || pack.events || pack.scenarios || pack.rounds || [];
  row.rounds = list.length;
  row.words = words(pack);
  row.wordsPerRound = list.length ? Math.round(row.words / (list.length * (1 + (pack.variants ? pack.variants.length - 1 : 0)))) : 0;
  const counts = list.map((x) => (x.choices || x.options || x.feelings || []).length).filter(Boolean);
  if (counts.length) row.choicesPerRound = counts.every((c) => c === counts[0]) ? String(counts[0]) : `${Math.min(...counts)}-${Math.max(...counts)}`;
  // Where the right answer sits in each round: if it is always the same slot, a student can learn the slot instead of the content.
  const positions = list.map((x) => (x.choices || []).findIndex((c) => c.id === (x.correctId || x.correctChoiceId))).filter((p) => p >= 0);
  if (positions.length > 1) row.correctSlots = positions.join(',');
  else {
    // Scenario games have no single right answer, but they tag the responsible choice; see which slot it sits in.
    const resp = list.map((x) => (x.choices || []).findIndex((c) => c.type === 'responsible')).filter((p) => p >= 0);
    if (resp.length > 1) row.correctSlots = resp.join(',') + ' (responsible)';
  }
  // Length balance: a choice list where the best answer is also the longest can be passed by length alone.
  const bestKey = (x) => x.correctId || x.correctChoiceId;
  const rounds = list.concat(...(pack.variants || []).map((v) => v.steps || v.items || v.events || v.scenarios || []));
  let spread = 0, longest = 0, judged = 0;
  rounds.forEach((x) => {
    const c = x.choices || x.options || []; if (c.length < 2) return;
    const lens = c.map((k) => String(k.text || k.label || '').length); if (!Math.max(...lens)) return;
    const best = c.find((k) => (bestKey(x) ? k.id === bestKey(x) : k.type === 'responsible')); if (!best) return;
    judged++; spread = Math.max(spread, Math.max(...lens) / Math.max(1, Math.min(...lens)));
    if (String(best.text || best.label || '').length === Math.max(...lens)) longest++;
  });
  if (judged) { row.lengthSpread = Math.round(spread * 100) / 100; row.bestIsLongest = `${longest}/${judged}`; if (spread > 1.4 && !/emoji|label/.test('')) row.flags.push(`uneven option lengths (x${row.lengthSpread})`); if (judged >= 4 && longest / judged > 0.6) row.flags.push(`best answer is the longest in ${longest}/${judged} rounds`); }
  row.stories = (pack.variants || []).length || 1;
  const types = new Set(); list.forEach((x) => (x.choices || []).forEach((c) => c.type && types.add(c.type)));
  if (types.size) row.choiceTypes = [...types].join('/');
  if (/placeholder/i.test(src)) row.flags.push('placeholder text/content');
  if (/speechSynthesis|browser text-to-speech|TTS/i.test(src)) row.flags.push('browser TTS audio');
  // Since Phase 1 the SDK shuffles choice order (and round order for independent-round engines) on every run, so
  // "never varies" now means: no larger pool to draw from and no variants, i.e. the same content every time.
  row.pool = pack.roundsPerRun ? `${list.length} rounds, ${pack.roundsPerRun} per run` : null;
  row.variants = Array.isArray(pack.variants) ? pack.variants.length : 0;
  row.randomized = row.randomized || (/engine-sdk\.js/.test(src) && pack.shuffleChoices !== false);
  if (!row.pool && !row.variants) row.flags.push('NO POOL: same content every run');
  if (row.variants) row.flags.push(`${row.variants} stories (one per run)`);
  if (row.rounds < 6) row.flags.push('under 6 rounds');
  return row;
}

function auditAll() {
  return fs.readdirSync(ROOT).filter((f) => /^brain-.*\.html$/.test(f) && !NOT_GAMES.has(f)).sort().map(audit);
}

function main() {
const rows = auditAll();
if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
console.log(`Audited ${rows.length} game pages\n`);
for (const r of rows) {
  console.log(`${r.slug.padEnd(20)} ${String(r.band || 'no band').padEnd(10)} ${r.engine.padEnd(16)} rounds=${String(r.rounds ?? '?').padEnd(3)} words/round=${String(r.wordsPerRound ?? '').padEnd(4)} choices=${String(r.choicesPerRound ?? '').padEnd(4)} answer slots=${r.correctSlots || '-'} best=longest ${r.bestIsLongest || '-'}`);
  if (r.flags.length || r.note) console.log(`${' '.repeat(20)} ! ${[...r.flags, r.note].filter(Boolean).join('; ')}`);
}
const same = rows.filter((r) => r.flags.includes('NO POOL: same content every run')).length;
console.log(`\n${same} of ${rows.length} pages have no content pool; ${rows.filter((r) => r.rounds !== null && r.rounds < 6).length} have under 6 rounds.`);
}

if (require.main === module) main();
module.exports = { extractPack, audit, auditAll, ROOT };
