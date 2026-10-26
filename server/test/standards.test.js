// Tests for the state-standards / Portrait-of-a-Graduate crosswalk (docs/standards-crosswalk/DESIGN.md).
//
// Runs the REAL routes and lib/standards.js against a REAL SQL engine (Node's built-in SQLite) so the
// thing that matters most -- "a draft can never reach a public endpoint" -- is tested through the
// actual queries, not through mocks that merely agree with the code. Production is MariaDB; the
// statements in lib/standards.js are written to run on both. Only the table DDL below is SQLite-flavoured.
//
// Run:  cd server && npm test        (or: node --no-warnings --test test/)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');

// ---- SQLite-backed stand-in for db/pool.js ------------------------------------------
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email_verified INTEGER DEFAULT 1, session_invalidated_at TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, published INTEGER DEFAULT 0);
CREATE TABLE curriculum_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, curriculum_id INTEGER NOT NULL REFERENCES curricula(id) ON DELETE CASCADE, audience TEXT NOT NULL);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
CREATE TABLE standards_state_coverage (
  state_code TEXT PRIMARY KEY, sel_status TEXT NOT NULL DEFAULT 'unknown', pog_status TEXT NOT NULL DEFAULT 'unknown',
  sel_source_url TEXT, pog_source_url TEXT, source_accessed_on TEXT, notes TEXT,
  review_status TEXT NOT NULL DEFAULT 'draft', reviewed_by INTEGER, reviewed_at TEXT, updated_at TEXT);
CREATE TABLE standards_frameworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, state_code TEXT NOT NULL, framework_type TEXT NOT NULL, name TEXT NOT NULL,
  issuing_body TEXT NOT NULL, official_url TEXT NOT NULL, adopted_year INTEGER, grade_span TEXT, source_accessed_on TEXT NOT NULL,
  notes TEXT, review_status TEXT NOT NULL DEFAULT 'draft', reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT, updated_at TEXT,
  UNIQUE (state_code, framework_type, name));
CREATE TABLE standards_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, framework_id INTEGER NOT NULL REFERENCES standards_frameworks(id) ON DELETE CASCADE,
  code TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, grade_band TEXT, casel_competency TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (framework_id, code));
CREATE TABLE standards_alignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES standards_items(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id INTEGER NOT NULL DEFAULT 0, strength TEXT NOT NULL, rationale TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'draft', reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT, updated_at TEXT,
  UNIQUE (item_id, target_type, target_id));
`);
const pool = {
  async query(sql, params = []) {
    const s = sql.trim();
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const r = db.prepare(s).run(...params);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  },
};
const poolPath = path.join(SERVER, 'db/pool.js');
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { if (Module._resolveFilename(request, parent) === poolPath) return pool; } catch { /* not resolvable here -> default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signSession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const app = express();
app.use(express.json(), cookieParser());
app.use('/api/standards', require(path.join(SERVER, 'routes/standards.js')));
app.use('/api/admin/standards', require(path.join(SERVER, 'routes/admin-standards.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));

let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

const adminCookie = () => 'fn_session=' + signSession('admin', { userId: 1, username: 'admin' }, '1h');
const siteCookie = () => 'fn_user_session=' + signSession('site', { userId: 5, firstName: 'T', role: 'teacher' }, '1h');
function call(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      port, method, path: url,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let json = null; try { json = b ? JSON.parse(b) : null; } catch { /* e.g. Express's HTML 404 page */ } resolve({ status: res.statusCode, json, raw: b }); }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const admin = (method, url, body) => call(method, '/api/admin/standards' + url, { body, cookie: adminCookie() });
const pub = (url) => call('GET', '/api/standards' + url);

function reset() {
  db.exec('DELETE FROM standards_alignments; DELETE FROM standards_items; DELETE FROM standards_frameworks; DELETE FROM standards_state_coverage; DELETE FROM curriculum_audiences; DELETE FROM curricula; DELETE FROM brain_games; DELETE FROM admin_users;');
  db.exec(`INSERT INTO admin_users (id, username) VALUES (1, 'admin')`);
}
const today = new Date().toISOString().slice(0, 10);
const FW = { stateCode: 'IL', type: 'sel_standards', name: 'Illinois SEL Standards', issuingBody: 'Illinois State Board of Education', officialUrl: 'https://example.org/il-sel', gradeSpan: 'K-12', sourceAccessedOn: today, notes: 'reviewer-only-note (framework)' };
const ITEMS = [
  { code: '1A', title: 'Identify and manage emotions', summary: 'Short paraphrase', gradeBand: 'K-2', caselCompetency: 'self_awareness' },
  { code: '2B', title: 'Recognize others\' perspectives', caselCompetency: 'social_awareness' },
];
async function seedFramework({ verify = false } = {}) {
  const fw = (await admin('POST', '/frameworks', FW)).json;
  await admin('PUT', `/frameworks/${fw.id}/items`, { items: ITEMS });
  const full = (await admin('GET', `/frameworks/${fw.id}`)).json;
  if (verify) assert.equal((await admin('POST', `/frameworks/${fw.id}/verify`)).status, 200);
  return { fwId: fw.id, itemIds: full.items.map(i => i.id) };
}

// ====================================================================================
test('PUBLIC: nothing is visible until verified -- drafts never leak', async () => {
  reset();
  await admin('PUT', '/coverage/IL', { selStatus: 'k12_standards', pogStatus: 'district_led_only', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today });
  const { itemIds } = await seedFramework();
  await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', strength: 'direct', rationale: 'The Issues-to-Answers method builds emotion identification.' });

  const overview = (await pub('/overview')).json;
  assert.equal(overview.verifiedStates, 0, 'a draft coverage row must not count');
  assert.deepEqual(overview.states, []);
  assert.equal((await pub('/states/IL')).status, 404, 'a state with only drafts looks like a state with no data');
  assert.ok(!/Illinois SEL Standards|1A|Issues-to-Answers/.test((await pub('/overview')).raw), 'no draft text anywhere in the public overview');
});

test('PUBLIC: verified rows appear; draft alignments stay hidden; no reviewer ids exposed', async () => {
  reset();
  await admin('PUT', '/coverage/IL', { selStatus: 'k12_standards', pogStatus: 'district_led_only', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today, notes: 'reviewer-only-note (coverage)' });
  assert.equal((await admin('POST', '/coverage/IL/verify')).status, 200);
  const { fwId, itemIds } = await seedFramework({ verify: true });
  const a1 = (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', strength: 'direct', rationale: 'The Issues-to-Answers method builds emotion identification.' })).json;
  await admin('PUT', '/alignments', { itemId: itemIds[1], targetType: 'program', strength: 'supporting', rationale: 'Perspective-taking appears across the lesson series.' }); // stays draft
  assert.equal((await admin('POST', `/alignments/${a1.id}/verify`)).status, 200);

  const state = (await pub('/states/il')).json; // lower-case accepted
  assert.equal(state.state.name, 'Illinois');
  assert.equal(state.frameworks.length, 1);
  const byCode = Object.fromEntries(state.frameworks[0].items.map(i => [i.code, i]));
  assert.equal(byCode['1A'].alignments.length, 1, 'the verified alignment shows');
  assert.equal(byCode['2B'].alignments.length, 0, 'the draft alignment does not');
  assert.equal(byCode['1A'].alignments[0].targetTitle, 'Fixer Nation Education program');
  assert.ok(!/reviewedBy|reviewed_by/.test((await pub('/states/IL')).raw), 'reviewer identity is admin-only');
  assert.ok(!/reviewer-only-note/.test((await pub('/states/IL')).raw + (await pub('/overview')).raw), 'reviewer notes never reach a public response');
  assert.equal((await pub('/overview')).json.verifiedStates, 1);
  assert.equal((await pub('/overview')).json.states[0].verifiedFrameworks, 1);
  assert.ok(fwId);
});

test('PUBLIC: an alignment to an unpublished or deleted lesson is never shown', async () => {
  reset();
  const pubCur = db.prepare(`INSERT INTO curricula (title, published) VALUES ('Published Lesson', 1)`).run().lastInsertRowid;
  const draftCur = db.prepare(`INSERT INTO curricula (title, published) VALUES ('Unpublished Lesson', 0)`).run().lastInsertRowid;
  const { itemIds } = await seedFramework({ verify: true });
  for (const [id, label] of [[pubCur, 'visible'], [draftCur, 'hidden']]) {
    const a = (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'curriculum', targetId: Number(id), strength: 'direct', rationale: `Lesson content that is ${label} on the page.` })).json;
    await admin('POST', `/alignments/${a.id}/verify`);
  }
  let t = (await pub('/states/IL')).json.frameworks[0].items[0].alignments.map(a => a.targetTitle);
  assert.deepEqual(t, ['Published Lesson']);
  db.prepare('DELETE FROM curricula WHERE id = ?').run(pubCur);
  t = (await pub('/states/IL')).json.frameworks[0].items[0].alignments;
  assert.equal(t.length, 0, 'a lesson that no longer exists vanishes from the public page');
});

test('PUBLIC: a lesson connection lists its grade versions (K-12 only, published only)', async () => {
  reset();
  const mk = (title, audience, published = 1) => {
    const id = Number(db.prepare('INSERT INTO curricula (title, published) VALUES (?, ?)').run(title, published).lastInsertRowid);
    db.prepare('INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (?, ?)').run(id, audience);
    return id;
  };
  const stem = 'Pause Before You Escalate';
  const es = mk(`${stem} - Lesson Plan 10 - 19 - #151 - ES`, 'Elementary School');
  const ms = mk(`${stem} - Lesson Plan 10 - 19 - #151 - MS`, 'Middle School');
  const hs = mk(`${stem} - Lesson Plan 10 - 19 - #151 - HS`, 'High School');
  mk(`${stem} - Lesson Plan 10 - 19 - #151 - HE`, 'Higher Education');       // never listed: outside K-12
  mk(`${stem} Again - Lesson Plan 10 - 20 - #152 - ES`, 'Elementary School'); // a different lesson sharing a prefix
  const hsDraft = mk(`Other Lesson - Lesson Plan 1 - 1 - #1 - HS`, 'High School', 0);
  const { itemIds } = await seedFramework({ verify: true });
  const a = (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'curriculum', targetId: ms, strength: 'direct', rationale: 'The lesson teaches the same skill the standard names.' })).json;
  await admin('POST', `/alignments/${a.id}/verify`);

  const al = (await pub('/states/IL')).json.frameworks[0].items[0].alignments[0];
  assert.equal(al.targetTitle, stem, 'shown by lesson name, not by one grade\'s copy');
  assert.deepEqual(al.versions.map(v => [v.level, v.grades, v.id]), [['elementary', 'K-5', es], ['middle', '6-8', ms], ['high', '9-12', hs]]);
  assert.ok(!/Higher/.test(JSON.stringify(al)), 'higher education is never shown on a K-12 page');

  db.prepare('UPDATE curricula SET published = 0 WHERE id = ?').run(hs);
  assert.deepEqual((await pub('/states/IL')).json.frameworks[0].items[0].alignments[0].versions.map(v => v.level), ['elementary', 'middle'], 'an unpublished version drops off');
  assert.ok(hsDraft);
});

test('REVIEW GATE: verifying every draft connection under one standard', async () => {
  reset();
  const { fwId, itemIds } = await seedFramework();             // framework still a draft
  const mkAl = async (rationale, strength = 'direct') => (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', targetId: 0, strength, rationale })).json;
  await mkAl('First connection under this standard.');
  const gone = db.prepare("INSERT INTO curricula (title, published) VALUES ('Soon Removed', 1)").run().lastInsertRowid;
  await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'curriculum', targetId: Number(gone), strength: 'supporting', rationale: 'This lesson is deleted before the bulk verify.' });
  assert.equal((await admin('POST', `/items/${itemIds[0]}/verify-alignments`)).status, 400, 'the framework must be verified first');

  await admin('POST', `/frameworks/${fwId}/verify`);
  db.prepare('DELETE FROM curricula WHERE id = ?').run(gone);
  const r = await admin('POST', `/items/${itemIds[0]}/verify-alignments`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.verified, r.json.skipped], [1, 1], 'content that no longer exists is skipped, not verified');
  const states = (await admin('GET', `/frameworks/${fwId}`)).json.items[0].alignments.map(a => a.reviewStatus).sort();
  assert.deepEqual(states, ['draft', 'verified']);
  assert.equal((await admin('POST', '/items/99999/verify-alignments')).status, 404);
  assert.equal((await call('POST', `/api/admin/standards/items/${itemIds[0]}/verify-alignments`, {})).status, 401, 'admin only');
});

test('REVIEW GATE: what can and cannot be verified', async () => {
  reset();
  // coverage: unknown status can't be a verified fact; sources required even for "none"
  await admin('PUT', '/coverage/KS', { selStatus: 'k12_standards', pogStatus: 'unknown', selSourceUrl: 'https://example.org/a', sourceAccessedOn: today });
  assert.equal((await admin('POST', '/coverage/KS/verify')).status, 400);
  await admin('PUT', '/coverage/KS', { selStatus: 'k12_standards', pogStatus: 'none', selSourceUrl: 'https://example.org/a', sourceAccessedOn: today });
  assert.equal((await admin('POST', '/coverage/KS/verify')).status, 400, 'a finding of "none" still has to cite where it looked');
  await admin('PUT', '/coverage/KS', { selStatus: 'k12_standards', pogStatus: 'none', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today });
  assert.equal((await admin('POST', '/coverage/KS/verify')).status, 200);
  assert.equal((await admin('POST', '/coverage/ZZ/verify')).status, 400, 'invalid state code');

  // framework: needs items
  const fw = (await admin('POST', '/frameworks', FW)).json;
  assert.equal((await admin('POST', `/frameworks/${fw.id}/verify`)).status, 400, 'no items yet');
  await admin('PUT', `/frameworks/${fw.id}/items`, { items: ITEMS });
  const itemId = (await admin('GET', `/frameworks/${fw.id}`)).json.items[0].id;

  // alignment can't be verified while its framework is a draft
  const al = (await admin('PUT', '/alignments', { itemId, targetType: 'program', strength: 'direct', rationale: 'A rationale that is long enough to review.' })).json;
  const early = await admin('POST', `/alignments/${al.id}/verify`);
  assert.equal(early.status, 400);
  assert.match(early.json.error, /verify the framework first/i);
});

test('VALIDATION: sources must be https and dated; rationale must be real; targets must exist', async () => {
  reset();
  assert.equal((await admin('POST', '/frameworks', { ...FW, officialUrl: 'http://example.org/insecure' })).status, 400);
  assert.equal((await admin('POST', '/frameworks', { ...FW, officialUrl: 'not a url' })).status, 400);
  assert.equal((await admin('POST', '/frameworks', { ...FW, sourceAccessedOn: undefined })).status, 400, 'accessed date is required');
  assert.equal((await admin('POST', '/frameworks', { ...FW, sourceAccessedOn: '2999-01-01' })).status, 400, 'no future dates');
  assert.equal((await admin('POST', '/frameworks', { ...FW, type: 'academic_standards' })).status, 400);
  assert.equal((await admin('POST', '/frameworks', { ...FW, stateCode: 'XX' })).status, 400);
  const { itemIds } = await seedFramework();
  const base = { itemId: itemIds[0], targetType: 'program', strength: 'direct' };
  assert.equal((await admin('PUT', '/alignments', { ...base, rationale: 'too short' })).status, 400);
  assert.equal((await admin('PUT', '/alignments', { ...base, rationale: 'x'.repeat(1001) })).status, 400);
  assert.equal((await admin('PUT', '/alignments', { ...base, strength: 'strong', rationale: 'A rationale that is long enough.' })).status, 400);
  assert.equal((await admin('PUT', '/alignments', { ...base, targetType: 'curriculum', targetId: 9999, rationale: 'A rationale that is long enough.' })).status, 404, 'unknown lesson');
  assert.equal((await admin('PUT', '/alignments', { ...base, targetType: 'curriculum', rationale: 'A rationale that is long enough.' })).status, 400, 'lesson target needs an id');
  assert.equal((await admin('POST', '/frameworks', FW)).status, 409, 'duplicate framework');
});

test('EDITS: changing verified content sends it back to draft; identical re-imports do not', async () => {
  reset();
  const { fwId, itemIds } = await seedFramework({ verify: true });
  const al = (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', strength: 'direct', rationale: 'A rationale that is long enough to review.' })).json;
  await admin('POST', `/alignments/${al.id}/verify`);

  // re-sending identical items changes nothing -> verification survives
  const same = (await admin('PUT', `/frameworks/${fwId}/items`, { items: ITEMS })).json;
  assert.deepEqual(same, { added: 0, updated: 0, unchanged: 2 });
  assert.equal((await admin('GET', `/frameworks/${fwId}`)).json.reviewStatus, 'verified');
  // identical framework metadata -> still verified
  assert.equal((await admin('PUT', `/frameworks/${fwId}`, FW)).json.changed, false);
  assert.equal((await admin('GET', `/frameworks/${fwId}`)).json.reviewStatus, 'verified');

  // changing one item's text -> framework AND that item's alignment go back to draft
  const changed = (await admin('PUT', `/frameworks/${fwId}/items`, { items: [{ ...ITEMS[0], title: 'A different title' }] })).json;
  assert.equal(changed.updated, 1);
  const after = (await admin('GET', `/frameworks/${fwId}`)).json;
  assert.equal(after.reviewStatus, 'draft');
  assert.equal(after.items[0].alignments[0].reviewStatus, 'draft');
  assert.equal((await pub('/states/IL')).status, 404, 'edited -> disappears from the public page until re-reviewed');

  // editing framework metadata also re-drafts, and its alignments
  await admin('POST', `/frameworks/${fwId}/verify`);
  await admin('POST', `/alignments/${al.id}/verify`);
  await admin('PUT', `/frameworks/${fwId}`, { ...FW, officialUrl: 'https://example.org/moved' });
  assert.equal((await admin('GET', `/frameworks/${fwId}`)).json.reviewStatus, 'draft');
  assert.equal((await admin('GET', `/frameworks/${fwId}`)).json.items[0].alignments[0].reviewStatus, 'draft');

  // editing coverage re-drafts it
  await admin('PUT', '/coverage/IL', { selStatus: 'k12_standards', pogStatus: 'none', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today });
  await admin('POST', '/coverage/IL/verify');
  await admin('PUT', '/coverage/IL', { selStatus: 'k12_standards', pogStatus: 'none', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today, notes: 'new note' });
  assert.equal((await admin('GET', '/states/IL')).json.coverage.reviewStatus, 'draft');
});

test('EDITS: adding a NEW standard re-drafts the framework but keeps alignments on unchanged standards', async () => {
  reset();
  const { fwId, itemIds } = await seedFramework({ verify: true });
  const al = (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', strength: 'direct', rationale: 'A rationale that is long enough to review.' })).json;
  await admin('POST', `/alignments/${al.id}/verify`);
  const r = (await admin('PUT', `/frameworks/${fwId}/items`, { items: [...ITEMS, { code: '3C', title: 'A brand-new standard' }] })).json;
  assert.deepEqual([r.added, r.updated, r.unchanged], [1, 0, 2]);
  const after = (await admin('GET', `/frameworks/${fwId}`)).json;
  assert.equal(after.reviewStatus, 'draft', 'framework must be re-verified before anything is public again');
  assert.equal(after.items.find(i => i.code === '1A').alignments[0].reviewStatus, 'verified', 'the unchanged standard\'s alignment was reviewed against text that did not change');
  assert.equal((await pub('/states/IL')).status, 404, 'but nothing is public while the framework is a draft');
});

test('UNVERIFY: pulling a framework pulls everything under it off the public page', async () => {
  reset();
  const { fwId, itemIds } = await seedFramework({ verify: true });
  const al = (await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', strength: 'direct', rationale: 'A rationale that is long enough to review.' })).json;
  await admin('POST', `/alignments/${al.id}/verify`);
  assert.equal((await pub('/states/IL')).status, 200);
  await admin('POST', `/frameworks/${fwId}/unverify`);
  assert.equal((await pub('/states/IL')).status, 404);
  // re-verifying the framework does NOT silently bring the alignment back -- it needs its own review
  await admin('POST', `/frameworks/${fwId}/verify`);
  assert.equal((await pub('/states/IL')).json.frameworks[0].items[0].alignments.length, 0);
});

test('CASCADE: deleting a framework removes its items and alignments', async () => {
  reset();
  const { fwId, itemIds } = await seedFramework();
  await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'program', strength: 'direct', rationale: 'A rationale that is long enough to review.' });
  assert.equal((await admin('DELETE', `/frameworks/${fwId}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standards_items').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standards_alignments').get().n, 0);
  assert.equal((await admin('DELETE', `/frameworks/${fwId}`)).status, 404);
});

test('ACCESS: admin endpoints require an FNE admin session; public ones are read-only', async () => {
  reset();
  const adminUrls = [['GET', '/overview'], ['GET', '/states/IL'], ['PUT', '/coverage/IL'], ['POST', '/frameworks'], ['PUT', '/alignments'], ['POST', '/coverage/IL/verify'], ['POST', '/frameworks/1/verify'], ['POST', '/alignments/1/verify']];
  for (const [m, u] of adminUrls) {
    const anon = await call(m, '/api/admin/standards' + u, { body: {} });
    assert.equal(anon.status, 401, `anonymous ${m} ${u}`);
    const teacher = await call(m, '/api/admin/standards' + u, { body: {}, cookie: siteCookie() });
    assert.equal(teacher.status, 401, `a signed-in TEACHER must not pass: ${m} ${u}`);
  }
  // a site-user token pasted into the admin cookie is rejected too (session-type separation)
  assert.equal((await call('GET', '/api/admin/standards/overview', { cookie: 'fn_session=' + siteCookie().split('=')[1] })).status, 401);
  // public router has no write routes at all
  for (const m of ['POST', 'PUT', 'DELETE']) assert.equal((await call(m, '/api/standards/states/IL', { body: {} })).status, 404, `public ${m}`);
});

test('ADMIN OVERVIEW: all 51 jurisdictions with draft/verified tallies, including drafts', async () => {
  reset();
  await seedFramework();
  const o = (await admin('GET', '/overview')).json;
  assert.equal(o.length, 51);
  const il = o.find(s => s.stateCode === 'IL');
  assert.deepEqual(il.frameworks, { draft: 1, verified: 0 });
  assert.equal(o.find(s => s.stateCode === 'DC').stateName, 'District of Columbia');
  assert.equal((await pub('/states/ZZ')).status, 400);
});

// ====================================================================================
// import-standards.js  (research committed as JSON -> draft rows)
// ====================================================================================
const standardsLib = require(path.join(SERVER, 'lib/standards.js'));
const { importData, checkShape } = require(path.join(SERVER, 'scripts/import-standards.js'));
const importFile = (data) => importData(data, { standards: standardsLib, pool });
const sample = () => ({
  state: 'il',
  coverage: { selStatus: 'k12_standards', pogStatus: 'district_led_only', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today },
  frameworks: [{ type: 'sel_standards', name: 'Illinois SEL Standards', issuingBody: 'ISBE', officialUrl: 'https://example.org/il', sourceAccessedOn: today,
    items: [{ code: '1A', title: 'Identify emotions', caselCompetency: 'self_awareness' }, { code: '2B', title: 'Perspective taking', caselCompetency: 'social_awareness' }] }],
  alignments: [{ framework: 'Illinois SEL Standards', itemCode: '1A', strength: 'direct', rationale: 'The Issues-to-Answers method builds emotion identification.', target: { type: 'program' } }],
});

test('IMPORT: loads everything as DRAFT -- nothing becomes public', async () => {
  reset();
  const s = await importFile(sample());
  assert.equal(s.state, 'IL', 'state normalised');
  assert.equal(s.frameworks[0].added, 2);
  assert.equal(s.alignments.saved, 1);
  assert.equal((await pub('/overview')).json.verifiedStates, 0);
  assert.equal((await pub('/states/IL')).status, 404);
  const fw = (await admin('GET', '/states/IL')).json.frameworks[0];
  assert.equal(fw.reviewStatus, 'draft');
  assert.equal(fw.items[0].alignments[0].reviewStatus, 'draft');
});

test('IMPORT: re-importing IDENTICAL data does not undo a verification; changed data does', async () => {
  reset();
  await importFile(sample());
  await admin('POST', '/coverage/IL/verify');
  const fw = (await admin('GET', '/states/IL')).json.frameworks[0];
  await admin('POST', `/frameworks/${fw.id}/verify`);
  const al = fw.items.find(i => i.code === '1A').alignments[0];
  await admin('POST', `/alignments/${al.id}/verify`);
  assert.equal((await pub('/states/IL')).json.frameworks[0].items.find(i => i.code === '1A').alignments.length, 1);

  const again = await importFile(sample());
  assert.equal(again.coverage, 'unchanged');
  assert.deepEqual([again.frameworks[0].added, again.frameworks[0].updated, again.frameworks[0].unchanged], [0, 0, 2]);
  assert.equal(again.alignments.unchanged, 1);
  assert.equal((await pub('/states/IL')).status, 200, 'still public after an identical re-import');
  assert.equal((await pub('/states/IL')).json.frameworks[0].items.find(i => i.code === '1A').alignments.length, 1);

  const edited = sample(); edited.frameworks[0].items[0].title = 'Identify and name emotions';
  await importFile(edited);
  // the state's coverage is still verified, so the page exists -- but the edited framework is gone from it
  const afterEdit = await pub('/states/IL');
  assert.equal(afterEdit.status, 200);
  assert.deepEqual(afterEdit.json.frameworks, [], 'a changed standard goes back to draft and off the public page');
  assert.ok(!/Identify and name emotions|Identify emotions/.test(afterEdit.raw), 'neither the old nor the new text is public');
});

test('IMPORT: resolves lessons by exact title and fails loudly on a bad reference', async () => {
  reset();
  db.prepare(`INSERT INTO curricula (title, published) VALUES ('Calm Down Corner', 1)`).run();
  const withLesson = sample();
  withLesson.alignments.push({ framework: 'Illinois SEL Standards', itemCode: '2B', strength: 'supporting', rationale: 'The lesson practises noticing how others feel.', target: { type: 'curriculum', title: 'Calm Down Corner' } });
  const s = await importFile(withLesson);
  assert.equal(s.alignments.saved, 2);

  const missing = sample(); missing.alignments[0].target = { type: 'curriculum', title: 'No Such Lesson' };
  await assert.rejects(importFile(missing), /no lesson titled "No Such Lesson"/);
  const badItem = sample(); badItem.alignments[0].itemCode = 'ZZ9';
  await assert.rejects(importFile(badItem), /item "ZZ9" which is not in framework/);
  const badGame = sample(); badGame.alignments[0].target = { type: 'brain_game', slug: 'nope' };
  await assert.rejects(importFile(badGame), /no brain game with slug "nope"/);
});

test('IMPORT: file-shape checker catches mistakes before touching a database', () => {
  assert.deepEqual(checkShape(sample(), 'IL.json'), []);
  const problems = checkShape({ state: 'Illinois', frameworks: [{ name: 'X', items: [] }], alignments: [{ framework: 'Y', itemCode: '1A', target: { type: 'program' } }] }, 'bad.json');
  assert.ok(problems.some(p => /2-letter code/.test(p)));
  assert.ok(problems.some(p => /non-empty "items"/.test(p)));
  assert.ok(problems.some(p => /officialUrl/.test(p)));
  assert.ok(problems.some(p => /not in this file/.test(p)));
});
