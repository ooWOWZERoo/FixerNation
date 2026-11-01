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

// Pull `const contentPack = { ... };` out of a page by matching braces (strings and comments respected).
function extractPack(src) {
  const start = src.indexOf('const contentPack');
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  const from = i;
  let depth = 0, str = null;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) { i++; break; }
  }
  try { return vm.runInNewContext('(' + src.slice(from, i) + ')', { band: 'x', params: new URLSearchParams('') }); } catch { return null; }
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
  row.wordsPerRound = list.length ? Math.round(row.words / list.length) : 0;
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
  console.log(`${r.slug.padEnd(20)} ${String(r.band || 'no band').padEnd(10)} ${r.engine.padEnd(16)} rounds=${String(r.rounds ?? '?').padEnd(3)} words/round=${String(r.wordsPerRound ?? '').padEnd(4)} choices=${String(r.choicesPerRound ?? '').padEnd(4)} answer slots=${r.correctSlots || '-'}`);
  if (r.flags.length || r.note) console.log(`${' '.repeat(20)} ! ${[...r.flags, r.note].filter(Boolean).join('; ')}`);
}
const same = rows.filter((r) => r.flags.includes('NO POOL: same content every run')).length;
console.log(`\n${same} of ${rows.length} pages have no content pool; ${rows.filter((r) => r.rounds !== null && r.rounds < 6).length} have under 6 rounds.`);
}

if (require.main === module) main();
module.exports = { extractPack, audit, auditAll, ROOT };
