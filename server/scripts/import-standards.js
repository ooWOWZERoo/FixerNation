require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

// Loads state-standards research from server/data/standards/*.json into the crosswalk
// tables as DRAFT rows. Nothing it loads is public: an FNE admin still has to review and
// verify each record in the admin UI (docs/standards-crosswalk/DESIGN.md).
//
//   node scripts/import-standards.js --check        validate the JSON files only; touches no database
//   node scripts/import-standards.js                load every file in server/data/standards/
//   node scripts/import-standards.js IL NY          load only those states' files
//
// Safe to re-run: records are matched by (state, type, name) / item code, and re-importing
// IDENTICAL data changes nothing -- in particular it does not undo an existing verification.
// A file that differs from what's stored resets the affected records to draft (that is the
// point: the review no longer describes what's in the database).
//
// File format -- one file per state, named <STATE>.json:
// {
//   "state": "IL",
//   "coverage": {                                   // what kind of framework this state has
//     "selStatus": "k12_standards" | "prek_only" | "guidance_only" | "none" | "unknown",
//     "pogStatus": "statewide" | "state_led_in_progress" | "district_led_only" | "none" | "unknown",
//     "selSourceUrl": "https://...", "pogSourceUrl": "https://...",   // cite where you looked, even for "none"
//     "sourceAccessedOn": "2026-10-26", "notes": "..."
//   },
//   "frameworks": [{
//     "type": "sel_standards" | "portrait_of_graduate", "name": "...", "issuingBody": "...",
//     "officialUrl": "https://...", "adoptedYear": 2004, "gradeSpan": "K-12", "sourceAccessedOn": "2026-10-26",
//     "items": [{ "code": "...", "title": "...", "summary": "short paraphrase", "gradeBand": "K-2",
//                 "caselCompetency": "self_awareness" | ... }]
//   }],
//   "alignments": [{
//     "framework": "<framework name>", "itemCode": "...", "strength": "direct" | "supporting", "rationale": "...",
//     "target": { "type": "program" } | { "type": "curriculum", "title": "<exact lesson title>" } | { "type": "brain_game", "slug": "..." }
//   }]
// }

const DATA_DIR = path.join(__dirname, '..', 'data', 'standards');

// ---- structural validation (no database needed) ------------------------------------
function checkShape(data, label) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(`${label}: ${msg}`); };
  need(data && typeof data === 'object', 'file must contain a JSON object');
  if (!data || typeof data !== 'object') return problems;
  need(typeof data.state === 'string' && /^[A-Za-z]{2}$/.test(data.state), '"state" must be a 2-letter code');
  need(data.coverage === undefined || (data.coverage && typeof data.coverage === 'object'), '"coverage" must be an object');
  need(data.frameworks === undefined || Array.isArray(data.frameworks), '"frameworks" must be an array');
  need(data.alignments === undefined || Array.isArray(data.alignments), '"alignments" must be an array');
  (data.frameworks || []).forEach((f, i) => {
    need(f && typeof f.name === 'string' && f.name, `frameworks[${i}] needs a "name"`);
    need(Array.isArray(f && f.items) && f.items.length > 0, `frameworks[${i}] ("${f && f.name}") needs a non-empty "items" array`);
    need(f && f.officialUrl && f.sourceAccessedOn, `frameworks[${i}] ("${f && f.name}") needs "officialUrl" and "sourceAccessedOn"`);
  });
  const names = new Set((data.frameworks || []).map(f => f && f.name));
  (data.alignments || []).forEach((a, i) => {
    need(a && names.has(a.framework), `alignments[${i}] refers to framework "${a && a.framework}" which is not in this file`);
    need(a && a.itemCode && a.target && a.target.type, `alignments[${i}] needs "itemCode" and "target.type"`);
  });
  return problems;
}

// ---- load one parsed file ------------------------------------------------------------
// `standards` and `pool` are injected so tests can run this against a throwaway database.
async function importData(data, { standards, pool }) {
  const state = String(data.state).toUpperCase();
  const summary = { state, coverage: null, frameworks: [], alignments: { saved: 0, unchanged: 0 } };

  if (data.coverage) summary.coverage = (await standards.upsertCoverage(state, data.coverage)).changed ? 'saved' : 'unchanged';

  const frameworkIds = {};
  for (const f of data.frameworks || []) {
    const [[existing]] = await pool.query('SELECT id FROM standards_frameworks WHERE state_code = ? AND framework_type = ? AND name = ?', [state, f.type, f.name]);
    const meta = { ...f, stateCode: state };
    delete meta.items;
    const res = existing ? await standards.updateFramework(existing.id, meta) : await standards.createFramework(meta);
    const id = existing ? existing.id : res.id;
    frameworkIds[f.name] = id;
    const items = await standards.upsertItems(id, f.items);
    summary.frameworks.push({ name: f.name, created: !existing, metadataChanged: !!existing && res.changed, ...items });
  }

  for (const a of data.alignments || []) {
    const [[item]] = await pool.query('SELECT id FROM standards_items WHERE framework_id = ? AND code = ?', [frameworkIds[a.framework], a.itemCode]);
    if (!item) throw new Error(`${state}: alignment refers to item "${a.itemCode}" which is not in framework "${a.framework}"`);
    let targetId = 0;
    if (a.target.type === 'curriculum') {
      const [rows] = await pool.query('SELECT id FROM curricula WHERE title = ?', [a.target.title]);
      if (rows.length !== 1) throw new Error(`${state}: ${rows.length ? 'more than one' : 'no'} lesson titled "${a.target.title}" -- use the exact title`);
      targetId = rows[0].id;
    } else if (a.target.type === 'brain_game') {
      const [rows] = await pool.query('SELECT id FROM brain_games WHERE slug = ?', [a.target.slug]);
      if (rows.length !== 1) throw new Error(`${state}: no brain game with slug "${a.target.slug}"`);
      targetId = rows[0].id;
    }
    const res = await standards.upsertAlignment({ itemId: item.id, targetType: a.target.type, targetId, strength: a.strength, rationale: a.rationale });
    summary.alignments[res.changed ? 'saved' : 'unchanged']++;
  }
  return summary;
}

function readFiles(only) {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'))
    .filter(f => !only.length || only.includes(path.basename(f, '.json').toUpperCase()))
    .sort().map(f => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) }));
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const only = args.filter(a => !a.startsWith('--')).map(a => a.toUpperCase());
  let files;
  try { files = readFiles(only); } catch (err) { console.error('Could not read the data files:', err.message); process.exit(1); }
  if (!files.length) { console.log(`No data files found in ${DATA_DIR}${only.length ? ' for ' + only.join(', ') : ''}.`); return; }

  const problems = files.flatMap(({ file, data }) => checkShape(data, file));
  if (problems.length) { console.error('Problems found:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log(`${files.length} file(s) look structurally valid.`);
  if (checkOnly) return;

  const standards = require('../lib/standards');
  const pool = require('../db/pool');
  try {
    for (const { file, data } of files) {
      const s = await importData(data, { standards, pool });
      console.log(`${file}: coverage ${s.coverage || 'n/a'}; ${s.frameworks.length} framework(s); alignments ${s.alignments.saved} saved / ${s.alignments.unchanged} unchanged`);
      for (const f of s.frameworks) console.log(`   ${f.created ? 'created' : 'matched'} "${f.name}": items +${f.added} ~${f.updated} =${f.unchanged}`);
    }
    console.log('\nEverything loaded as DRAFT. Review and verify in the admin standards page; nothing is public until then.');
  } finally {
    await pool.end();
  }
}

module.exports = { checkShape, importData };
if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });
