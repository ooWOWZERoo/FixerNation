// Phase 0 of merging the older CRM page (admin-newsletter.html) into the Customer Hub contact pages: nothing may be orphaned, and nothing may be added to the older page
// without a decision. This test reads the REAL code and compares it with docs/reference/contact-pages-feature-map.json (and the feature rows of
// docs/reference/contact-pages-merge-requirements.md). If it fails, either something new appeared on the older page or its routes (decide where it will live, add it to the map),
// or something on the map was removed or moved (mark it `moved` with a proof, or `dropped` with a reason). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MAP = JSON.parse(read('docs/reference/contact-pages-feature-map.json'));
const DOC = read('docs/reference/contact-pages-merge-requirements.md');
const OLD = read(MAP.oldPage);
const ROUTES_SRC = read(MAP.routesFile);
const SELF = ['server/test/contact-pages-feature-map.test.js', 'docs/reference/contact-pages-feature-map.json'];

const SKIP = new Set(['node_modules', '.git', '.claude', 'docs', 'uploads', 'vendor', 'assets', 'playwright-report', 'test-results']);
function walk(dir, { skip = SKIP, exts, skipNames = [] } = {}) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(e.name)) out.push(...walk(full, { skip, exts, skipNames })); }
    else if (exts.test(e.name)) out.push(path.relative(ROOT, full));
  }
  return out.filter(f => !skipNames.includes(f)).sort();
}
const sorted = (iter) => [...new Set(iter)].sort();
const STATUSES = new Set(['planned', 'moved', 'internal', 'stays', 'none', 'dropped']);

// "moved" needs a proof: the file named must contain the text. "dropped" needs a reason. "planned" needs a phase from 2 to 6.
function checkEntry(label, e) {
  assert.ok(STATUSES.has(e.status), `${label}: unknown status ${e.status}`);
  if (e.status === 'planned') assert.ok(Number.isInteger(e.phase) && e.phase >= 2 && e.phase <= 6, `${label}: planned needs a phase from 2 to 6`);
  if (e.status === 'dropped') assert.ok(e.note && e.note.length > 10, `${label}: dropped needs a reason in note`);
  if (e.status === 'moved') {
    assert.ok(e.proof && e.proof.file && e.proof.includes, `${label}: moved needs proof {file, includes}`);
    assert.ok(read(e.proof.file).includes(e.proof.includes), `${label}: the proof text is not in ${e.proof.file}`);
  }
}
// Everything in the code must be on the map; anything on the map that is gone from the code must be moved or dropped.
function compare(kind, inCode, entries, { goneOk = ['moved', 'dropped'] } = {}) {
  const mapped = Object.keys(entries);
  assert.deepEqual(inCode.filter(n => !mapped.includes(n)), [], `${kind} in the code but not on the map: decide where they live and add them`);
  for (const [name, e] of Object.entries(entries)) {
    checkEntry(`${kind} ${name}`, e);
    if (!inCode.includes(name)) assert.ok(goneOk.includes(e.status), `${kind} ${name} is gone from the code but the map says "${e.status}" (it must be moved or dropped)`);
  }
}

const pageFunctions = sorted([...OLD.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)/gm)].map(m => m[1]).concat([...OLD.matchAll(/^(?:const|let|var) ([A-Za-z0-9_]+) *= *(?:async *)?(?:\([^)]*\)|[A-Za-z0-9_]+) *=>/gm)].map(m => m[1])));
const pageWiring = sorted([...OLD.matchAll(/document\.getElementById\('([A-Za-z0-9_]+)'\)\.addEventListener\(/g)].map(m => m[1]).concat(/^document\.addEventListener\(/m.test(OLD) ? ['document'] : []));
const routesInCode = sorted([...ROUTES_SRC.matchAll(/^router\.(get|post|put|delete|patch)\('([^']+)'/gm)].map(m => `${m[1].toUpperCase()} ${m[2]}`));
const exportsInCode = sorted(ROUTES_SRC.match(/module\.exports = \{([^}]*)\}/)[1].split(',').map(s => s.trim()).filter(Boolean));
const fetchCount = (OLD.match(/\bfetch\(/g) || []).length;
const pageUrls = [...OLD.matchAll(/\bfetch\((?:'([^']+)'|`([^`]+)`)/g)].map(m => (m[1] || m[2]).replace(/\$\{[^}]*\}/g, ':p'));

test('FUNCTIONS: every function on the older page is on the map, and one that disappears is marked moved or dropped', () => {
  assert.ok(pageFunctions.length > 50, 'the page was read');
  compare('functions', pageFunctions, MAP.functions);
});

test('EVENT WIRING: every control wired with addEventListener on the older page is on the map', () => {
  assert.ok(pageWiring.includes('searchInput') && pageWiring.includes('document'), 'the wiring was read');
  compare('wiring', pageWiring, MAP.wiring);
});

test('ROUTES: every route in routes/newsletter.js is on the map, and none is removed (they are shared with other pages)', () => {
  assert.ok(routesInCode.length >= 24, 'the routes were read');
  compare('routes', routesInCode, MAP.routes, { goneOk: ['dropped'] });
  for (const [key, r] of Object.entries(MAP.routes)) assert.equal(r.status, 'stays', `${key}: a route is never "moved"; only its callers move`);
});

test('PAGE CALLS: every URL the older page fetches is on the map, so no call can be forgotten', () => {
  assert.equal(pageUrls.length, fetchCount, 'every fetch() on the page has a literal URL (a computed URL would hide a call from this check)');
  const known = new Set(Object.values(MAP.routes).map(r => r.pageUrl).filter(Boolean).concat(Object.keys(MAP.externalCalls)));
  assert.deepEqual(sorted(pageUrls.filter(u => !known.has(u))), [], 'URLs the page calls that are not on the map');
  const used = new Set(pageUrls);
  for (const [key, r] of Object.entries(MAP.routes)) if (r.pageUrl) assert.ok(used.has(r.pageUrl), `${key}: the map says the older page calls ${r.pageUrl}, but it does not`);
  for (const [u, e] of Object.entries(MAP.externalCalls)) { checkEntry(`external ${u}`, e); if (!used.has(u)) assert.ok(['moved', 'dropped'].includes(e.status), `${u} is no longer called but is not marked moved or dropped`); }
});

test('EXPORTS AND REQUIRERS: the route file is also a library; whatever it exports and every file that imports it is on the map', () => {
  compare('exports', exportsInCode, MAP.exports, { goneOk: ['moved', 'dropped'] });
  const requirers = sorted(walk(path.join(ROOT, 'server'), { skip: new Set(['node_modules', 'test', 'uploads']), exts: /\.js$/ })
    .filter(f => /require\(['"](?:\.\/|\.\.\/routes\/|\.\/routes\/)newsletter['"]\)/.test(read(f))));
  assert.deepEqual(requirers, sorted(Object.keys(MAP.requirers)), 'files that import routes/newsletter.js must match the map');
  for (const [file, r] of Object.entries(MAP.requirers)) for (const u of r.uses) assert.ok(MAP.exports[u], `${file} uses ${u}, which is not an export on the map`);
  for (const [name, e] of Object.entries(MAP.exports)) {
    if (name === 'router') continue;
    const users = Object.entries(MAP.requirers).filter(([, r]) => r.uses.includes(name)).map(([f]) => f);
    for (const f of users) assert.match(read(f), new RegExp(`\\b${name}\\b`), `${f} should use ${name}`);
  }
});

test('CALLERS: every page or file outside the older page that calls /api/newsletter is on the map, and each route\'s listed callers really contain it', () => {
  const skipNames = [MAP.oldPage, MAP.routesFile, ...SELF];
  const callers = sorted(walk(ROOT, { skip: new Set([...SKIP, 'test', 'tests']), exts: /\.(html|js)$/, skipNames }).filter(f => read(f).includes('/api/newsletter')));
  assert.deepEqual(callers, sorted(Object.keys(MAP.callerFiles)), 'files that call /api/newsletter must match the map');
  for (const [key, r] of Object.entries(MAP.routes)) {
    const prefix = '/api/newsletter' + key.split(' ')[1].split(':')[0].replace(/\/$/, '');
    for (const f of r.callers) {
      assert.ok(MAP.callerFiles[f], `${key}: caller ${f} is not in callerFiles`);
      assert.ok(read(f).includes(prefix), `${key}: ${f} does not contain ${prefix}`);
    }
  }
});

test('REFERENCES: every file that links to or opens the older page is on the map', () => {
  const skipNames = [MAP.oldPage, ...SELF];
  const refs = sorted(walk(ROOT, { exts: /\.(html|js|ts|txt|json)$/, skipNames }).filter(f => read(f).includes('admin-newsletter')));
  assert.deepEqual(refs.filter(f => !MAP.references[f]), [], 'files that mention the older page but are not on the map');
  for (const [f, e] of Object.entries(MAP.references)) {
    checkEntry(`reference ${f}`, e);
    if (!refs.includes(f)) assert.ok(['moved', 'dropped'].includes(e.status), `${f} no longer mentions the older page but is not marked moved or dropped`);
  }
});

test('FEATURES: every row (L, T, E, R, P) of the requirements document is carried by something on the map, and the map names no row that is not in the document', () => {
  const docIds = sorted([...DOC.matchAll(/^\| ([LTERP]\d+) \|/gm)].map(m => m[1]));
  assert.ok(docIds.length >= 37, `the document's feature rows were read (${docIds.length})`);
  const used = [];
  for (const sect of ['functions', 'wiring', 'routes', 'externalCalls']) for (const e of Object.values(MAP[sect])) used.push(...(e.features || []));
  assert.deepEqual(docIds.filter(i => !used.includes(i)), [], 'document rows that nothing on the map carries (an orphan)');
  assert.deepEqual(sorted(used).filter(i => !docIds.includes(i)), [], 'map entries naming a row that is not in the document');
});
