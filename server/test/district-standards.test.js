// Tests for per-district frameworks (docs/standards-crosswalk/DISTRICT-FRAMEWORKS-REQUIREMENTS.md).
//
// Same approach as standards.test.js: the REAL routes, middleware and lib code against a REAL SQL engine
// (node:sqlite). The things that must never break are the ones tested hardest:
//   - a district admin can only ever touch their OWN district (every id taken from the URL or body),
//   - nothing a district writes is public until an FNE admin verifies it, and a district's private note
//     or blank connection never reaches a public response,
//   - district rows never leak into STATE pages/counts (and the other way round),
//   - the sales-demo district is never public.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

process.env.SESSION_SECRET = 'test-secret';
const SERVER = path.join(__dirname, '..');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, email_verified INTEGER DEFAULT 1, session_invalidated_at TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, email TEXT, session_invalidated_at TEXT, is_sales_demo INTEGER NOT NULL DEFAULT 0);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
  district_id INTEGER NOT NULL REFERENCES districts(id) ON DELETE CASCADE, is_active INTEGER NOT NULL DEFAULT 1);
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
  district_id INTEGER REFERENCES districts(id) ON DELETE CASCADE, owner_key INTEGER NOT NULL DEFAULT 0, submitted_at TEXT, submitted_by_site_user_id INTEGER,
  attested_at TEXT, attested_by_site_user_id INTEGER,
  UNIQUE (state_code, framework_type, name, owner_key));
CREATE TABLE standards_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, framework_id INTEGER NOT NULL REFERENCES standards_frameworks(id) ON DELETE CASCADE,
  code TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, grade_band TEXT, casel_competency TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (framework_id, code));
CREATE TABLE standards_alignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES standards_items(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id INTEGER NOT NULL DEFAULT 0, strength TEXT NOT NULL, rationale TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'draft', reviewed_by INTEGER, reviewed_at TEXT, created_at TEXT, updated_at TEXT,
  suggested_by_site_user_id INTEGER, district_note TEXT,
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
const emails = [];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'lib/mailer.js')]: { sendSalesAlertEmail: async (m) => { emails.push(m); } },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => 'ops@example.com' },
};
const origLoad = Module._load;
// The real rate limiter, switched on only by the one test that exercises it (the rest of the suite makes
// far more than 40 writes as the same user inside a minute).
const RATE = path.join(SERVER, 'lib/rate-limit.js');
let enforceLimits = false;
stubs[RATE] = new Proxy({}, { get(_, name) {
  const real = origLoad.call(Module, RATE, module);
  if (name !== 'limiter') return real[name];
  return (opts) => { const l = real.limiter(opts); return (req, res, next) => (enforceLimits ? l(req, res, next) : next()); };
} });
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signSession } = require(path.join(SERVER, 'lib/session-tokens.js'));
const { DEMO_DISTRICT_NAME } = require(path.join(SERVER, 'lib/sales-demo.js'));
const app = express();
app.use(express.json(), cookieParser());
app.use('/api/standards', require(path.join(SERVER, 'routes/standards.js')));
app.use('/api/admin/standards', require(path.join(SERVER, 'routes/admin-standards.js')));
app.use('/api/district-admin/standards', require(path.join(SERVER, 'routes/district-admin-standards.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));

let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

const adminCookie = () => 'fn_session=' + signSession('admin', { userId: 1, username: 'admin' }, '1h');
const siteCookie = (userId) => 'fn_user_session=' + signSession('site', { userId, firstName: 'T', role: 'teacher' }, '1h');
function call(method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      port, method, path: url,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let json = null; try { json = b ? JSON.parse(b) : null; } catch { /* html */ } resolve({ status: res.statusCode, json, raw: b }); }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const admin = (method, url, body) => call(method, '/api/admin/standards' + url, { body, cookie: adminCookie() });
const pub = (url) => call('GET', '/api/standards' + url);
const dist = (user, method, url, body) => call(method, '/api/district-admin/standards' + url, { body, cookie: siteCookie(user) });

// Fixture: users 11 (admin of district A), 12 (admin of district B), 13 (teacher, no assignment),
// 14 (sales-demo account: assigned to the demo district AND, wrongly, to real district A).
let A, B, DEMO;
function reset() {
  db.exec(`DELETE FROM standards_alignments; DELETE FROM standards_items; DELETE FROM standards_frameworks; DELETE FROM standards_state_coverage;
    DELETE FROM district_license_admins; DELETE FROM districts; DELETE FROM site_users; DELETE FROM curriculum_audiences; DELETE FROM curricula; DELETE FROM brain_games; DELETE FROM admin_users;`);
  emails.length = 0;
  db.exec(`INSERT INTO admin_users (id, username) VALUES (1, 'admin')`);
  db.exec(`INSERT INTO site_users (id, first_name, last_name, email, is_sales_demo) VALUES
    (11,'Ann','A','ann@district-a.example.com',0),(12,'Bo','B','bo@district-b.example.com',0),(13,'Tess','T','tess@example.com',0),(14,'Sal','S','sal@example.com',1)`);
  A = Number(db.prepare(`INSERT INTO districts (name) VALUES ('Alpha Public Schools')`).run().lastInsertRowid);
  B = Number(db.prepare(`INSERT INTO districts (name) VALUES ('Beta Unified')`).run().lastInsertRowid);
  DEMO = Number(db.prepare(`INSERT INTO districts (name) VALUES (?)`).run(DEMO_DISTRICT_NAME).lastInsertRowid);
  db.exec(`INSERT INTO district_license_admins (site_user_id, district_id) VALUES (11, ${A}), (12, ${B}), (14, ${DEMO}), (14, ${A})`);
}
const today = new Date().toISOString().slice(0, 10);
const FW = (over = {}) => ({ stateCode: 'NY', type: 'portrait_of_graduate', name: 'Portrait of a Graduate', issuingBody: 'Alpha Public Schools', officialUrl: 'https://alpha.example.org/portrait', sourceAccessedOn: today, ...over });
const ITEMS = [{ code: 'C1', title: 'Collaborator', summary: 'Works well with others' }, { code: 'C2', title: 'Resilient thinker' }];
const NOTE = 'private-district-note-xyz';

async function seed({ user = 11, district = A, over = {}, submit = false, verify = false } = {}) {
  const fw = (await dist(user, 'POST', '/frameworks', { districtId: district, ...FW(over) })).json;
  assert.ok(fw && fw.id, 'framework created');
  assert.equal((await dist(user, 'PUT', `/frameworks/${fw.id}/items`, { items: ITEMS })).status, 200);
  const view = (await dist(user, 'GET', `/?districtId=${district}`)).json.frameworks.find(f => f.id === fw.id);
  const itemIds = view.items.map(i => i.id);
  if (submit) assert.equal((await dist(user, 'POST', `/frameworks/${fw.id}/submit`, { attest: true })).status, 200);
  if (verify) assert.equal((await admin('POST', `/frameworks/${fw.id}/verify`)).status, 200);
  return { fwId: fw.id, itemIds };
}
async function verifiedNY() {
  await admin('PUT', '/coverage/NY', { selStatus: 'k12_standards', pogStatus: 'district_led_only', selSourceUrl: 'https://example.org/a', pogSourceUrl: 'https://example.org/b', sourceAccessedOn: today });
  assert.equal((await admin('POST', '/coverage/NY/verify')).status, 200);
}
const lesson = (title, published = 1) => Number(db.prepare(`INSERT INTO curricula (title, published) VALUES (?, ?)`).run(title, published).lastInsertRowid);

// ====================================================================================
test('ACCESS: district routes need a district-admin session; the two session types never cross', async () => {
  reset();
  assert.equal((await call('GET', '/api/district-admin/standards/')).status, 401, 'anonymous');
  assert.equal((await dist(13, 'GET', '/')).status, 403, 'teacher with no district assignment');
  assert.equal((await call('GET', '/api/district-admin/standards/', { cookie: adminCookie() })).status, 401, 'FNE-admin cookie is not a district-admin session');
  const { fwId } = await seed();
  // A district admin's cookie never works on the FNE-admin routes, so a district can never verify.
  const asDistrict = (m, u, b) => call(m, '/api/admin/standards' + u, { body: b, cookie: siteCookie(11) });
  assert.equal((await asDistrict('POST', `/frameworks/${fwId}/verify`)).status, 401);
  assert.equal((await asDistrict('GET', '/districts')).status, 401);
  assert.equal((await asDistrict('PUT', `/frameworks/${fwId}`, FW())).status, 401);
  // Public endpoints are read-only.
  assert.equal((await call('POST', `/api/standards/districts/${A}`, { body: {} })).status, 404);
});

test('SCOPE: a district admin can never read or change another district\'s records (every id is checked)', async () => {
  reset();
  const b = await seed({ user: 12, district: B, over: { name: 'Beta Portrait', issuingBody: 'Beta Unified' }, submit: true });
  const gameId = Number(db.prepare(`INSERT INTO brain_games (name, slug) VALUES ('Pause', 'pause')`).run().lastInsertRowid);
  // Beta has a draft suggestion of its own.
  assert.equal((await dist(12, 'PUT', '/connections', { itemId: b.itemIds[0], targetType: 'brain_game', targetId: gameId, note: NOTE })).status, 200);
  const alignId = db.prepare('SELECT id FROM standards_alignments').get().id;
  const snapshot = () => JSON.stringify([db.prepare('SELECT * FROM standards_frameworks').all(), db.prepare('SELECT * FROM standards_items').all(), db.prepare('SELECT * FROM standards_alignments').all()]);
  const before = snapshot();

  const attacks = [
    ['GET',    `/?districtId=${B}`],
    ['POST',   '/frameworks', { districtId: B, ...FW({ name: 'Injected' }) }],
    ['PUT',    `/frameworks/${b.fwId}`, FW({ name: 'Hijacked' })],
    ['DELETE', `/frameworks/${b.fwId}`],
    ['PUT',    `/frameworks/${b.fwId}/items`, { items: [{ code: 'X9', title: 'Injected standard' }] }],
    ['DELETE', `/items/${b.itemIds[0]}`],
    ['PUT',    '/connections', { itemId: b.itemIds[1], targetType: 'program', note: 'x' }],
    ['DELETE', `/connections/${alignId}`],
    ['POST',   `/frameworks/${b.fwId}/submit`, { attest: true }],
    ['POST',   `/frameworks/${b.fwId}/withdraw`, {}],
  ];
  for (const [m, u, body] of attacks) {
    const r = await dist(11, m, u, body);
    assert.equal(r.status, 404, `${m} ${u} must be 404 for another district's admin, got ${r.status}`);
  }
  assert.equal(snapshot(), before, 'nothing about Beta changed');
  // Ann's own list never mentions Beta; ids that don't exist answer the same way.
  const mine = (await dist(11, 'GET', '/')).json;
  assert.equal(mine.districtId, A); assert.equal(mine.frameworks.length, 0);
  assert.equal((await dist(11, 'DELETE', '/items/99999')).status, 404);
  // The reverse direction too.
  assert.equal((await dist(12, 'GET', `/?districtId=${A}`)).status, 404);
});

test('LEAK: nothing a district writes is public until FNE verifies; private notes never leak', async () => {
  reset();
  const lessonId = lesson('Pause Before You Escalate - Lesson Plan (Middle School)');
  db.prepare(`INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (?, 'Middle School')`).run(lessonId);
  const { fwId, itemIds } = await seed({ submit: true });
  assert.equal((await dist(11, 'PUT', '/connections', { itemId: itemIds[0], targetType: 'curriculum', targetId: lessonId, note: NOTE })).status, 200);
  await verifiedNY();

  // Draft + submitted: invisible everywhere public.
  assert.equal((await pub(`/districts/${A}`)).status, 404);
  const st = (await pub('/states/NY')).json;
  assert.deepEqual(st.districts, []);
  assert.equal(JSON.stringify(st).includes('Alpha'), false);
  assert.equal((await pub('/overview')).json.states[0].verifiedDistricts, 0);

  // FNE verifies the framework. The district's blank-rationale suggestion still must not show.
  assert.equal((await admin('POST', `/frameworks/${fwId}/verify`)).status, 200);
  let page = (await pub(`/districts/${A}`)).json;
  assert.equal(page.district.name, 'Alpha Public Schools');
  assert.equal(page.frameworks[0].items.every(i => i.alignments.length === 0), true, 'unwritten suggestion is not shown');
  // Even if someone force-verifies a blank-rationale row straight in the DB, the public SQL refuses it.
  db.prepare(`UPDATE standards_alignments SET review_status = 'verified'`).run();
  page = (await pub(`/districts/${A}`)).json;
  assert.equal(page.frameworks[0].items.every(i => i.alignments.length === 0), true, 'blank rationale never public');
  db.prepare(`UPDATE standards_alignments SET review_status = 'draft'`).run();

  // FNE writes the rationale and verifies it: now it shows -- but the district's note never does.
  const alignId = db.prepare('SELECT id FROM standards_alignments').get().id;
  assert.equal((await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'curriculum', targetId: lessonId, strength: 'supporting', rationale: 'The lesson practises pausing before reacting, which supports collaboration.' })).status, 200);
  assert.equal((await admin('POST', `/alignments/${alignId}/verify`)).status, 200);
  page = (await pub(`/districts/${A}`)).json;
  assert.equal(page.frameworks[0].items[0].alignments.length, 1);
  const allPublic = JSON.stringify([page, (await pub('/states/NY')).json, (await pub('/overview')).json]);
  assert.equal(allPublic.includes(NOTE), false, 'district note never public');
  assert.equal(/district_note|districtNote|submitted|attested|reviewedBy|"notes"/.test(allPublic), false, 'no internal fields in public JSON');
  const st2 = (await pub('/states/NY')).json;
  assert.equal(st2.districts.length, 1); assert.equal(st2.districts[0].name, 'Alpha Public Schools');
  assert.equal((await pub('/overview')).json.states[0].verifiedDistricts, 1);
});

test('ISOLATION: district frameworks never appear as STATE frameworks, in state counts, or the other way round', async () => {
  reset();
  await verifiedNY();
  // A state framework and a district framework with the SAME name in the same state.
  const sf = (await admin('POST', '/frameworks', FW({ issuingBody: 'NYSED' }))).json;
  assert.ok(sf.id);
  await admin('PUT', `/frameworks/${sf.id}/items`, { items: [{ code: 'S1', title: 'State standard' }] });
  await admin('POST', `/frameworks/${sf.id}/verify`);
  const { fwId } = await seed({ verify: true });
  assert.notEqual(fwId, sf.id);

  const st = (await pub('/states/NY')).json;
  assert.equal(st.frameworks.length, 1, 'only the state framework is a state framework');
  assert.equal(st.frameworks[0].issuingBody, 'NYSED');
  assert.equal((await pub('/overview')).json.states[0].verifiedFrameworks, 1, 'district framework not counted as a state one');
  const adminOv = (await admin('GET', '/overview')).json.find(s => s.stateCode === 'NY');
  assert.deepEqual(adminOv.frameworks, { draft: 0, verified: 1 });
  const adminState = (await admin('GET', '/states/NY')).json;
  assert.equal(adminState.frameworks.length, 1);
  const prev = (await admin('GET', '/preview/states/NY')).json;
  assert.equal(prev.frameworks.length, 1);
  const district = (await pub(`/districts/${A}`)).json;
  assert.equal(district.frameworks.length, 1);
  assert.equal(district.frameworks[0].issuingBody, 'Alpha Public Schools', 'the state framework is not on the district page');
  // Two districts can each have a "Portrait of a Graduate" in one state.
  const b = await seed({ user: 12, district: B, over: { issuingBody: 'Beta Unified' } });
  assert.ok(b.fwId);
});

test('RE-DRAFT: editing a published district framework, its standards or its details takes it off the public site', async () => {
  reset();
  const verifiedAgain = async (fwId) => { assert.equal((await admin('POST', `/frameworks/${fwId}/verify`)).status, 200); assert.equal((await pub(`/districts/${A}`)).status, 200); };
  const { fwId, itemIds } = await seed({ submit: true, verify: true });
  assert.equal((await pub(`/districts/${A}`)).status, 200);

  assert.equal((await dist(11, 'PUT', `/frameworks/${fwId}`, FW({ officialUrl: 'https://alpha.example.org/new' }))).status, 200);
  assert.equal((await pub(`/districts/${A}`)).status, 404, 'details edit re-drafts');
  let row = db.prepare('SELECT * FROM standards_frameworks WHERE id = ?').get(fwId);
  assert.equal(row.review_status, 'draft'); assert.equal(row.submitted_at, null, 'edit takes it off the review queue');
  await verifiedAgain(fwId);

  assert.equal((await dist(11, 'PUT', `/frameworks/${fwId}/items`, { items: [{ code: 'C1', title: 'Collaborator (reworded)' }] })).status, 200);
  assert.equal((await pub(`/districts/${A}`)).status, 404, 'standard text edit re-drafts');
  await verifiedAgain(fwId);

  assert.equal((await dist(11, 'DELETE', `/items/${itemIds[1]}`)).status, 200);
  assert.equal((await pub(`/districts/${A}`)).status, 404, 'removing a standard re-drafts');
  await verifiedAgain(fwId);

  // Withdraw: always allowed, takes it down and off the queue.
  assert.equal((await dist(11, 'POST', `/frameworks/${fwId}/withdraw`, {})).status, 200);
  assert.equal((await pub(`/districts/${A}`)).status, 404);
  // Re-sending identical data changes nothing (no accidental un-verify).
  await verifiedAgain(fwId);
  assert.equal((await dist(11, 'PUT', `/frameworks/${fwId}`, FW({ officialUrl: 'https://alpha.example.org/new' }))).status, 200);
  assert.equal((await pub(`/districts/${A}`)).status, 200, 'identical edit leaves it verified');
});

test('UNSUBMIT: any district edit takes a framework off the review queue; it must be resubmitted', async () => {
  reset();
  const { fwId, itemIds } = await seed({ submit: true });
  const submitted = () => db.prepare('SELECT submitted_at AS s FROM standards_frameworks WHERE id = ?').get(fwId).s;
  const resubmit = async () => { assert.equal((await dist(11, 'POST', `/frameworks/${fwId}/submit`, { attest: true })).status, 200); assert.ok(submitted()); };
  assert.ok(submitted());
  await dist(11, 'PUT', `/frameworks/${fwId}/items`, { items: [{ code: 'C1', title: 'Collaborator, reworded' }] });
  assert.equal(submitted(), null, 'a standards edit un-submits'); await resubmit();
  await dist(11, 'PUT', `/frameworks/${fwId}/items`, { items: [{ code: 'C1', title: 'Collaborator, reworded' }] });
  assert.ok(submitted(), 're-sending identical standards changes nothing');
  await dist(11, 'DELETE', `/items/${itemIds[1]}`);
  assert.equal(submitted(), null, 'deleting a standard un-submits'); await resubmit();
  await dist(11, 'POST', `/frameworks/${fwId}/withdraw`, {});
  assert.equal(submitted(), null, 'withdraw un-submits');
});

test('SUBMIT: needs attestation and a standard; notifies FNE once; refuses an already-published framework', async () => {
  reset();
  const fw = (await dist(11, 'POST', '/frameworks', { districtId: A, ...FW() })).json;
  assert.equal((await dist(11, 'POST', `/frameworks/${fw.id}/submit`, { attest: true })).status, 400, 'no standards yet');
  await dist(11, 'PUT', `/frameworks/${fw.id}/items`, { items: ITEMS });
  assert.equal((await dist(11, 'POST', `/frameworks/${fw.id}/submit`, {})).status, 400, 'no attestation');
  assert.equal((await dist(11, 'POST', `/frameworks/${fw.id}/submit`, { attest: 'yes' })).status, 400, 'truthy string is not attestation');
  assert.equal(emails.length, 0);
  assert.equal((await dist(11, 'POST', `/frameworks/${fw.id}/submit`, { attest: true })).status, 200);
  assert.equal(emails.length, 1); assert.equal(emails[0].to, 'ops@example.com');
  assert.equal(emails[0].fields.District, 'Alpha Public Schools');
  const q = (await admin('GET', '/districts')).json;
  assert.equal(q[0].awaitingReview, true); assert.equal(q[0].districtName, 'Alpha Public Schools');
  await admin('POST', `/frameworks/${fw.id}/verify`);
  assert.equal((await dist(11, 'POST', `/frameworks/${fw.id}/submit`, { attest: true })).status, 409);
  assert.equal(emails.length, 1);
});

test('LIMITS and INPUT: caps, https only, reviewer notes and type are not district-writable', async () => {
  reset();
  for (let i = 1; i <= 3; i++) assert.equal((await dist(11, 'POST', '/frameworks', { districtId: A, ...FW({ name: 'FW ' + i }) })).status, 200);
  assert.equal((await dist(11, 'POST', '/frameworks', { districtId: A, ...FW({ name: 'FW 4' }) })).status, 409, '4th framework');
  assert.equal((await dist(12, 'POST', '/frameworks', { districtId: B, ...FW({ officialUrl: 'http://insecure.example.org' }) })).status, 400, 'https only');
  assert.equal((await dist(12, 'POST', '/frameworks', { districtId: B, ...FW({ sourceAccessedOn: '' }) })).status, 400, 'date required');
  assert.equal((await dist(12, 'POST', '/frameworks', { districtId: B, ...FW({ name: '' }) })).status, 400);
  assert.equal((await dist(12, 'POST', '/frameworks', { districtId: B, ...FW({ name: 'Dup' }) })).status, 200);
  assert.equal((await dist(12, 'POST', '/frameworks', { districtId: B, ...FW({ name: 'Dup' }) })).status, 409, 'duplicate in own district');
  // reviewer-only notes and the owner are not settable by a district
  const n = (await dist(12, 'POST', '/frameworks', { districtId: B, ...FW({ name: 'Notes', notes: 'sneaky', owner_key: 0, district_id: null }) })).json;
  const row = db.prepare('SELECT * FROM standards_frameworks WHERE id = ?').get(n.id);
  assert.equal(row.notes, null); assert.equal(row.district_id, B); assert.equal(row.owner_key, B);
  // type cannot be changed on update
  await dist(12, 'PUT', `/frameworks/${n.id}`, FW({ name: 'Notes', type: 'sel_standards' }));
  assert.equal(db.prepare('SELECT framework_type AS t FROM standards_frameworks WHERE id = ?').get(n.id).t, 'portrait_of_graduate');
  // 60 standards max
  const many = Array.from({ length: 61 }, (_, i) => ({ code: 'P' + i, title: 'Standard ' + i }));
  assert.equal((await dist(12, 'PUT', `/frameworks/${n.id}/items`, { items: many })).status, 400);
  assert.equal((await dist(12, 'PUT', `/frameworks/${n.id}/items`, { items: many.slice(0, 60) })).status, 200);
  assert.equal((await dist(12, 'PUT', `/frameworks/${n.id}/items`, { items: [{ code: 'EXTRA', title: 'One too many' }] })).status, 400, 'cap counts existing standards');
  assert.equal((await dist(12, 'PUT', `/frameworks/${n.id}/items`, { items: 'nope' })).status, 400);
});

test('CONNECTIONS: a district only suggests; FNE writes the rationale; verified connections are FNE\'s', async () => {
  reset();
  const live = lesson('Live Lesson - Lesson Plan (Middle School)');
  const hidden = lesson('Hidden Lesson - Lesson Plan (Middle School)', 0);
  const { fwId, itemIds } = await seed({ verify: true });
  const sug = (body) => dist(11, 'PUT', '/connections', { itemId: itemIds[0], ...body });
  assert.equal((await sug({ targetType: 'curriculum', targetId: hidden })).status, 404, 'unpublished lesson');
  assert.equal((await sug({ targetType: 'curriculum', targetId: 99999 })).status, 404);
  assert.equal((await sug({ targetType: 'bogus', targetId: 1 })).status, 400);
  assert.equal((await sug({ targetType: 'curriculum' })).status, 400, 'targetId required');
  assert.equal((await sug({ targetType: 'curriculum', targetId: live, note: 'x'.repeat(501) })).status, 400);
  const r = await sug({ targetType: 'curriculum', targetId: live, note: NOTE, rationale: 'district-written rationale that must be ignored', strength: 'direct' });
  assert.equal(r.status, 200);
  let a = db.prepare('SELECT * FROM standards_alignments WHERE id = ?').get(r.json.id);
  assert.equal(a.rationale, ''); assert.equal(a.strength, 'supporting'); assert.equal(a.review_status, 'draft'); assert.equal(a.suggested_by_site_user_id, 11);
  // FNE cannot verify it until the rationale is written
  assert.equal((await admin('POST', `/alignments/${a.id}/verify`)).status, 400);
  assert.deepEqual((await admin('POST', `/items/${itemIds[0]}/verify-alignments`)).json, { verified: 0, skipped: 1 });
  // the district sees its own suggestion (with its note) but no FNE wording yet
  let view = (await dist(11, 'GET', '/')).json.frameworks[0].items[0].alignments[0];
  assert.equal(view.status, 'suggested'); assert.equal(view.yourNote, NOTE); assert.equal(view.rationale, null);
  // FNE writes + verifies; the district can no longer remove it, and can't overwrite it
  await admin('PUT', '/alignments', { itemId: itemIds[0], targetType: 'curriculum', targetId: live, strength: 'direct', rationale: 'FNE explanation that is long enough to be a real rationale.' });
  assert.equal((await admin('POST', `/alignments/${a.id}/verify`)).status, 200);
  view = (await dist(11, 'GET', '/')).json.frameworks[0].items[0].alignments[0];
  assert.equal(view.status, 'verified'); assert.match(view.rationale, /^FNE explanation/);
  assert.equal((await dist(11, 'DELETE', `/connections/${a.id}`)).status, 404, 'verified connection is FNE\'s');
  const again = await sug({ targetType: 'curriculum', targetId: live, note: 'changed' });
  assert.equal(again.json.changed, false);
  a = db.prepare('SELECT * FROM standards_alignments WHERE id = ?').get(a.id);
  assert.equal(a.district_note, NOTE); assert.equal(a.strength, 'direct');
  // an FNE-made connection (no suggested_by) is never touched or removable by the district
  await admin('PUT', '/alignments', { itemId: itemIds[1], targetType: 'program', strength: 'supporting', rationale: 'FNE made this connection itself, no district input.' });
  const fneRow = db.prepare('SELECT id FROM standards_alignments WHERE item_id = ?').get(itemIds[1]);
  assert.equal((await dist(11, 'PUT', '/connections', { itemId: itemIds[1], targetType: 'program', note: 'overwrite?' })).json.changed, false);
  assert.equal((await dist(11, 'DELETE', `/connections/${fneRow.id}`)).status, 404);
  // suggestions can be taken back while still a draft
  const p = await dist(11, 'PUT', '/connections', { itemId: itemIds[0], targetType: 'program', note: 'program fit' });
  assert.equal((await dist(11, 'DELETE', `/connections/${p.json.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standards_alignments WHERE id = ?').get(p.json.id).n, 0);
});

test('DEMO: a sales-demo account stays in the demo district, and the demo district is never public', async () => {
  reset();
  // The demo account is (wrongly) also assigned to real district A. The server confines it anyway.
  assert.equal((await dist(14, 'GET', `/?districtId=${A}`)).status, 404, 'real district is off limits');
  const realFw = await seed({ user: 11, district: A, over: { name: 'Real Alpha Portrait' } });
  assert.equal((await dist(14, 'PUT', `/frameworks/${realFw.fwId}`, FW({ name: 'Demo hijack' }))).status, 404);
  assert.equal((await dist(14, 'DELETE', `/frameworks/${realFw.fwId}`)).status, 404);
  assert.equal((await dist(14, 'POST', '/frameworks', { districtId: A, ...FW({ name: 'x' }) })).status, 404);
  // In the demo district it can do the whole flow.
  const d = await seed({ user: 14, district: DEMO, over: { name: 'Demo Portrait', issuingBody: DEMO_DISTRICT_NAME }, submit: true });
  assert.equal(emails.length, 0, 'demo submissions never email FNE');
  // FNE can verify it, but it is still invisible publicly.
  await verifiedNY();
  assert.equal((await admin('POST', `/frameworks/${d.fwId}/verify`)).status, 200);
  assert.equal((await pub(`/districts/${DEMO}`)).status, 404);
  const st = (await pub('/states/NY')).json;
  assert.equal(st.districts.length, 0); assert.equal(JSON.stringify(st).includes('Demo'), false);
  assert.equal((await pub('/overview')).json.states[0].verifiedDistricts, 0);
  // FNE-only preview still shows it, marked as demo.
  const prev = (await admin('GET', `/preview/districts/${DEMO}`)).json;
  assert.equal(prev.district.demo, true);
  // The real district's framework was untouched.
  assert.equal(db.prepare('SELECT name FROM standards_frameworks WHERE id = ?').get(realFw.fwId).name, 'Real Alpha Portrait');
});

test('ADMIN: FNE can record a framework on a district\'s behalf and sees submissions first', async () => {
  reset();
  assert.equal((await admin('POST', '/frameworks', FW({ districtId: 99999 }))).status, 404, 'unknown district');
  assert.equal((await admin('POST', '/frameworks', FW({ districtId: 'abc' }))).status, 400);
  const mine = (await admin('POST', '/frameworks', FW({ districtId: B, name: 'Beta working draft', issuingBody: 'Beta Unified' }))).json;
  assert.equal(db.prepare('SELECT district_id AS d FROM standards_frameworks WHERE id = ?').get(mine.id).d, B);
  const s = await seed({ user: 11, district: A, submit: true });
  const q = (await admin('GET', '/districts')).json;
  assert.equal(q.length, 2);
  assert.equal(q[0].id, s.fwId, 'awaiting review comes first'); assert.equal(q[0].awaitingReview, true);
  assert.equal(q[1].awaitingReview, false);
  // A rename is scoped to its owner: a district framework may take a name a STATE framework already uses.
  await admin('POST', '/frameworks', FW({ issuingBody: 'NYSED' }));
  assert.equal((await admin('PUT', `/frameworks/${mine.id}`, FW({ name: 'Portrait of a Graduate', issuingBody: 'Beta Unified', officialUrl: 'https://beta.example.org/p' }))).status, 200);
  // The admin framework view exposes the district note to FNE only.
  const itemId = s.itemIds[0];
  await dist(11, 'PUT', '/connections', { itemId, targetType: 'program', note: NOTE });
  const full = (await admin('GET', `/frameworks/${s.fwId}`)).json;
  assert.equal(full.districtId, A); assert.equal(full.items[0].alignments[0].districtNote, NOTE); assert.equal(full.items[0].alignments[0].suggestedByDistrict, true);
});

test('RATE LIMIT: district writes are limited per account, not per address', async () => {
  reset();
  db.exec(`INSERT INTO site_users (id, first_name, last_name, email) VALUES (15,'Rae','R','rae@district-a.example.com')`);
  db.exec(`INSERT INTO district_license_admins (site_user_id, district_id) VALUES (15, ${A})`);
  enforceLimits = true;
  try {
    const statuses = [];
    for (let i = 0; i < 45; i++) statuses.push((await dist(15, 'DELETE', '/items/99999')).status);
    assert.equal(statuses.slice(0, 40).every(s => s === 404), true);
    assert.equal(statuses.slice(40).every(s => s === 429), true, 'the 41st write in a minute is refused');
    assert.equal((await dist(11, 'DELETE', '/items/99999')).status, 404, 'another account is unaffected');
  } finally { enforceLimits = false; }
});

test('CASCADE: removing a district removes its frameworks, items and connections', async () => {
  reset();
  const s = await seed({ user: 11, district: A });
  await dist(11, 'PUT', '/connections', { itemId: s.itemIds[0], targetType: 'program' });
  db.prepare('DELETE FROM districts WHERE id = ?').run(A);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standards_frameworks').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standards_alignments').get().n, 0);
});
