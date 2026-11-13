// Prospect demo invitations, phase 2 (docs/reference/shared-demo-workspaces-requirements.md, R1, R3, R6, R7): each group has its own access code, password, PIN,
// end time and private workspace, and ending, extending, re-coding or pausing one group never touches another.
// The library runs against a real SQL engine (node:sqlite), and the REAL public-demo, site sign-in, classroom sign-in and gate code run on top of it.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
require('express-async-errors');
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-invitations';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const inv = require(path.join(SERVER, 'lib/public-demo-invitations.js'));
const A = require(path.join(SERVER, 'lib/public-demo-admin.js'));
const W = require(path.join(SERVER, 'lib/public-demo-workspaces.js'));
const F = require(path.join(SERVER, 'lib/public-demo-fixtures.js'));
const seedLib = require(path.join(SERVER, 'scripts/seed-public-demo.js'));
const { seedWorkspaces } = require(path.join(SERVER, 'scripts/seed-demo-workspaces.js'));
const cli = require(path.join(SERVER, 'scripts/demo-invitations.js'));
const sw = require(path.join(SERVER, 'scripts/set-public-demo.js'));

const ROUNDS = 4;

// ---- A real SQL engine with the tables the library, the seed, the reset and the routes touch ---------------------------------------------------
function buildDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, first_name TEXT, last_name TEXT, role TEXT, password_hash TEXT, email_verified INTEGER DEFAULT 0,
  is_sales_demo INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0, demo_workspace_id INTEGER, session_invalidated_at TEXT, closed_at TEXT, closed_reason TEXT);
CREATE TABLE site_user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT, type TEXT, expires_at TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE license_products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, seat_count INTEGER, price_cents INTEGER, call_for_quote INTEGER, variable_seats INTEGER, active INTEGER, sort_order INTEGER);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, source TEXT, status TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, product_type TEXT, license_product_id INTEGER, seat_count INTEGER, source TEXT, payment_method TEXT, payment_status TEXT, school_domain TEXT, school_id INTEGER,
  invoice_id INTEGER, purchased_at TEXT DEFAULT CURRENT_TIMESTAMP, notes TEXT, license_status TEXT DEFAULT 'active', expiration_date TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, status TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY AUTOINCREMENT, published INTEGER, title TEXT, series TEXT);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, teacher_site_user_id INTEGER, join_code TEXT, parent_code TEXT, grade_level TEXT, subject TEXT, academic_year TEXT, archived_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, display_name TEXT, username TEXT UNIQUE, password_hash TEXT, is_active INTEGER DEFAULT 1, student_number TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, curriculum_id INTEGER, assigned_by_id INTEGER, sort_order INTEGER DEFAULT 0, due_date TEXT, assigned_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, game_id INTEGER, due_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_assignment_id INTEGER, student_id INTEGER, completed_at TEXT);
CREATE TABLE affiliates (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, status TEXT, referral_code TEXT, commission_rate REAL);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE student_reflections (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, body TEXT);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, student_id INTEGER);
CREATE TABLE school_branding (school_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE district_branding (district_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER, name TEXT);
CREATE TABLE lesson_favorites (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE public_demo_workspaces (id INTEGER PRIMARY KEY, district_id INTEGER, school_id INTEGER, purchase_id INTEGER, status TEXT DEFAULT 'free', last_reset_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public_demo_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, workspace_id INTEGER NOT NULL, access_code TEXT NOT NULL UNIQUE, code_version INTEGER NOT NULL DEFAULT 1,
  password TEXT NOT NULL DEFAULT '', pin TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
  for (let i = 0; i < 5; i++) db.prepare('INSERT INTO curricula (published) VALUES (1)').run();
  // NOW() is the engine's local time, the way the real database's session time lines up with the server's clock; an array parameter becomes a list.
  const run = async (sql, rawParams = []) => {
    const params = [];
    let i = 0;
    const s = sql.trim().replace(/\bNOW\(\)/g, "datetime('now','localtime')").replace(/\bCURDATE\(\)/g, "date('now','localtime')").replace(/\?/g, () => {
      const p = rawParams[i++];
      if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(', '); }
      params.push(p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p);
      return '?';
    });
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const r = db.prepare(s).run(...params);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  };
  return { db, run, conn: { query: run }, count: (sql, ...p) => db.prepare(sql).get(...p).n };
}

// The world every test shares: the pool the library and the routes use is this database.
const world = buildDb();
const stubs = { [path.join(SERVER, 'db/pool.js')]: { query: world.run, getConnection: async () => ({ query: world.run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) } };
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
// (the stub stays installed: the library loads the pool when it is first used, not when it is required)

const express = require('express');
const cookieParser = require('cookie-parser');
const { sharedDemoGate } = require(path.join(SERVER, 'lib/public-demo.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', sharedDemoGate);
app.use('/api/demo', require(path.join(SERVER, 'routes/public-demo.js')));
app.use('/api/site-auth', require(path.join(SERVER, 'routes/site-auth.js')).router);
app.use('/api/classroom-auth', require(path.join(SERVER, 'routes/classroom-auth.js')).router);
// any page behind the real sign-in check (the one that also enforces a signed-out-by-password-change session)
app.get('/api/behind-sign-in', require(path.join(SERVER, 'routes/site-auth.js')).requireSiteAuth, (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => { if (process.env.DEBUG_DEMO_TEST) console.error(err); res.status(500).json({ error: String(err.message) }); });
let server, port;

const { db, conn, count } = world;
const T0 = new Date('2026-11-12T15:00:00Z');
const minutes = (n) => new Date(T0.getTime() + n * 60000);
const days = (n) => new Date(T0.getTime() + n * 86400000);

test.before(async () => {
  server = app.listen(0); port = server.address().port;
  inv.setCacheTtl(0); // every lookup reads the database, so a test sees each change at once
  await seedWorkspaces(conn, 3, { rounds: ROUNDS });
});
test.after(() => server.close());

const make = (label, o = {}) => inv.createInvitation(conn, { label, days: 7, rounds: ROUNDS, createdBy: 'test', ...o });
const accountId = (email) => db.prepare('SELECT id FROM site_users WHERE email = ?').get(email).id;
const hashOf = (email) => db.prepare('SELECT password_hash FROM site_users WHERE email = ?').get(email).password_hash;
const studentHash = (n) => db.prepare('SELECT password_hash FROM classroom_students WHERE username = ?').get(`demo-student-0${n}`).password_hash;
const joinCodeOf = (n) => db.prepare('SELECT join_code FROM classrooms WHERE teacher_site_user_id = ?').get(accountId(`demo-teacher-0${n}@public-demo.example.com`)).join_code;
const wsStatus = (n) => db.prepare('SELECT status FROM public_demo_workspaces WHERE id = ?').get(n).status;
const normalized = (code) => A.normalizeAccessCode(code);
async function endAll() { for (const i of await inv.listInvitations(conn, { includeEnded: false })) await inv.endInvitation(conn, i.id, { rounds: ROUNDS }); }

// ============================================================================================================================================
// The library
// ============================================================================================================================================

test('CREATE: two groups at once each get their own workspace, code, password and PIN', async () => {
  await endAll();
  const before = [1, 2, 3].map(joinCodeOf);
  const a = await make('Springfield USD');
  const b = await make('Shelbyville Schools');
  assert.deepEqual([a.workspaceId, b.workspaceId], [1, 2], 'the lowest free workspaces, one each');
  assert.notEqual(a.accessCode, b.accessCode);
  assert.notEqual(a.password, b.password);
  assert.notEqual(a.pin, b.pin);
  assert.match(a.accessCode, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.match(a.accessCodeFormatted, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(a.state, 'active'); assert.equal(a.open, true);
  assert.equal(a.endsAt.getTime() - a.startsAt.getTime() > 6.9 * 86400000, true);
  assert.equal(wsStatus(1), 'in_use'); assert.equal(wsStatus(2), 'in_use'); assert.equal(wsStatus(3), 'free');

  // each workspace signs in with ITS group's password and PIN, and with nobody else's
  for (const [x, other] of [[a, b], [b, a]]) {
    const n = x.workspaceId;
    for (const role of ['district', 'school', 'teacher', 'parent']) {
      const h = hashOf(`demo-${role}-0${n}@public-demo.example.com`);
      assert.ok(await bcrypt.compare(x.password, h), `${role} ${n} with its own password`);
      assert.ok(!(await bcrypt.compare(other.password, h)), `${role} ${n} refuses the other group's password`);
    }
    assert.ok(await bcrypt.compare(x.pin, studentHash(n)));
    assert.ok(!(await bcrypt.compare(other.pin, studentHash(n))));
  }
  // the free workspace is still locked to everyone
  for (const g of [a.password, b.password, a.pin, b.pin]) {
    assert.ok(!(await bcrypt.compare(g, hashOf('demo-teacher-03@public-demo.example.com'))));
    assert.ok(!(await bcrypt.compare(g, studentHash(3))));
  }
  // every group starts with join and parent codes nobody has seen
  const after = [1, 2, 3].map(joinCodeOf);
  assert.notEqual(after[0], before[0]); assert.notEqual(after[1], before[1]); assert.equal(after[2], before[2], 'a workspace nobody took is untouched');
  assert.equal(inv.loginsFor(1).length, 5);
  await endAll();
});

test('TIMES: a time is read the same whether the connection hands back text (the site) or a date built from local time (a script)', () => {
  assert.equal(inv.fromDb('2026-11-30 22:00:00').toISOString(), '2026-11-30T22:00:00.000Z');
  assert.equal(inv.fromDb(new Date(2026, 10, 30, 22, 0, 0)).toISOString(), '2026-11-30T22:00:00.000Z', 'local fields are the stored text, whatever this machine\'s time zone');
  assert.equal(inv.toDb(new Date('2026-11-30T22:00:00Z')), '2026-11-30 22:00:00');
  assert.equal(inv.fromDb(inv.toDb(new Date('2026-02-03T04:05:06Z'))).toISOString(), '2026-02-03T04:05:06.000Z');
  for (const v of [null, undefined, '', 'not a date', new Date('x')]) assert.equal(inv.fromDb(v), null, String(v));
});

test('LIST: the list never shows a password, a PIN or an access code', async () => {
  await endAll();
  await make('Springfield USD');
  const list = await inv.listInvitations(conn);
  assert.equal(list.length >= 1, true);
  for (const i of list) { assert.equal(i.password, undefined); assert.equal(i.pin, undefined); assert.equal(i.accessCode, undefined); }
  const one = await inv.getInvitation(conn, list[0].id, { secrets: true });
  assert.ok(one.password && one.pin && one.accessCode);
  assert.equal(await inv.getInvitation(conn, 424242), null);
  await endAll();
});

test('CREATE: it refuses clearly when the pool is full, when there are no workspaces, when paused, or when the request is wrong', async () => {
  await endAll();
  await make('One'); await make('Two'); await make('Three');
  await assert.rejects(make('Four'), (e) => e.status === 409 && e.code === 'pool_full' && /All 3 demo workspaces are in use/.test(e.message));
  await endAll();

  await assert.rejects(make(''), (e) => e.status === 400 && /name/.test(e.message));
  await assert.rejects(make('   '), (e) => e.status === 400);
  await assert.rejects(make('x'.repeat(121)), (e) => e.status === 400 && /120/.test(e.message));
  await assert.rejects(make('A', { days: 0 }), (e) => e.status === 400 && /above 0/.test(e.message));
  await assert.rejects(make('A', { days: 31 }), (e) => e.status === 400 && /30 days/.test(e.message));
  await assert.rejects(make('A', { days: undefined, until: '2099-01-01T00:00:00' }), (e) => e.status === 400 && /time zone/.test(e.message));
  await assert.rejects(make('A', { days: undefined, until: '2020-01-01T00:00:00Z' }), (e) => e.status === 400 && /past/.test(e.message));
  await assert.rejects(make('A', { days: undefined, until: 'nonsense+00:00' }), (e) => e.status === 400);
  assert.equal(count('SELECT COUNT(*) AS n FROM public_demo_workspaces WHERE status = ?', 'in_use'), 0, 'a refused request takes no workspace');
  const dflt = await inv.createInvitation(conn, { label: 'Default length', rounds: ROUNDS, now: T0 });
  assert.equal(dflt.endsAt.getTime() - T0.getTime(), 14 * 86400000, 'two weeks unless told otherwise');
  const exact = await inv.createInvitation(conn, { label: 'Exact end', until: '2026-11-20T12:00:00-05:00', rounds: ROUNDS, now: T0 });
  assert.equal(exact.endsAt.toISOString(), '2026-11-20T17:00:00.000Z');
  assert.match(exact.endsAtEastern, /November 20 at 12:00 PM EST/);
  await endAll();

  // a longer window needs the setting
  await A.putSettingRaw(conn, 'public_demo_max_days', '60');
  assert.equal((await make('Long', { days: 45 })).open, true);
  await A.putSettingRaw(conn, 'public_demo_max_days', '30');
  await endAll();

  await inv.setPaused(conn, true);
  await assert.rejects(make('While paused'), (e) => e.status === 409 && e.code === 'paused' && /paused/.test(e.message));
  await inv.setPaused(conn, false);
  assert.equal((await make('After resume')).open, true);
  await endAll();

  // no workspaces at all
  const empty = buildDb();
  await assert.rejects(inv.createInvitation(empty.conn, { label: 'X', days: 1, rounds: ROUNDS }), (e) => e.status === 409 && e.code === 'no_workspaces' && /seed-demo-workspaces/.test(e.message));
});

test('END: one group\'s workspace is wiped, locked and freed, and another group\'s is exactly as it was', async () => {
  await endAll();
  const a = await make('Springfield USD');
  const b = await make('Shelbyville Schools');
  // each group makes a mess in its own workspace
  for (const n of [1, 2]) {
    const teacher = accountId(`demo-teacher-0${n}@public-demo.example.com`);
    const room = Number(db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES (?, ?, ?)").run(`Group ${n} class`, teacher, `GROUP00${n}`).lastInsertRowid);
    db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Kid', ?, 'x')").run(room, `kid-${n}`);
  }
  const bSnap = () => JSON.stringify([db.prepare('SELECT id, password_hash, session_invalidated_at FROM site_users WHERE demo_workspace_id = 2 ORDER BY id').all(),
    db.prepare('SELECT c.id, c.name, c.join_code FROM classrooms c JOIN site_users u ON u.id = c.teacher_site_user_id WHERE u.demo_workspace_id = 2 ORDER BY c.id').all(),
    studentHash(2), db.prepare('SELECT * FROM public_demo_invitations WHERE id = ?').get(b.id)]);
  const bBefore = bSnap();
  const aJoin = joinCodeOf(1);

  const ended = await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  assert.equal(ended.status, 'ended'); assert.equal(ended.state, 'ended'); assert.equal(ended.open, false); assert.equal(ended.endReason, 'ended');
  assert.equal(wsStatus(1), 'free');
  const row = db.prepare('SELECT * FROM public_demo_invitations WHERE id = ?').get(a.id);
  assert.equal(row.password, ''); assert.equal(row.pin, ''); assert.ok(row.ended_at);
  assert.equal(count("SELECT COUNT(*) AS n FROM classrooms WHERE name = 'Group 1 class'"), 0, 'the group\'s own classroom is gone');
  assert.equal(count("SELECT COUNT(*) AS n FROM classroom_students WHERE username = 'kid-1'"), 0);
  assert.notEqual(joinCodeOf(1), aJoin, 'a new join code, so the last group cannot join the next group\'s classroom');
  for (const role of ['district', 'school', 'teacher', 'parent']) assert.ok(!(await bcrypt.compare(a.password, hashOf(`demo-${role}-01@public-demo.example.com`))), 'the old password is dead');
  assert.ok(!(await bcrypt.compare(a.pin, studentHash(1))));

  assert.equal(bSnap(), bBefore, 'group B\'s workspace, accounts, classroom and invitation are untouched');
  assert.equal((await inv.getInvitation(conn, b.id)).open, true);

  // ending twice changes nothing; ending something that is not there is "not found"
  const again = await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  assert.equal(again.status, 'ended');
  await assert.rejects(inv.endInvitation(conn, 999999), (e) => e.status === 404);
  await endAll();
});

test('REUSE: a freed workspace goes to the next group clean, with a new code (an old code is never reused)', async () => {
  await endAll();
  const first = await make('First group');
  await inv.endInvitation(conn, first.id, { rounds: ROUNDS });
  const second = await make('Second group');
  assert.equal(second.workspaceId, first.workspaceId, 'the same workspace comes back round');
  assert.notEqual(second.accessCode, first.accessCode);
  assert.notEqual(second.password, first.password);
  assert.ok(!(await bcrypt.compare(first.password, hashOf('demo-teacher-01@public-demo.example.com'))));
  assert.ok(await bcrypt.compare(second.password, hashOf('demo-teacher-01@public-demo.example.com')));
  // every code ever made stays unique
  const codes = db.prepare('SELECT access_code FROM public_demo_invitations').all().map(r => r.access_code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(await inv.findOpenInvitationByCode(first.accessCode), null, 'the first group\'s code opens nothing');
  await endAll();
});

test('EXTEND: moves the end time within the longest window, and not for an ended invitation', async () => {
  await endAll();
  const a = await inv.createInvitation(conn, { label: 'A', days: 7, rounds: ROUNDS, now: T0 });
  const longer = await inv.extendInvitation(conn, a.id, { days: 14, now: T0 });
  assert.equal(longer.endsAt.getTime(), days(14).getTime());
  const shorter = await inv.extendInvitation(conn, a.id, { days: 2, now: T0 });
  assert.equal(shorter.endsAt.getTime(), days(2).getTime());
  await assert.rejects(inv.extendInvitation(conn, a.id, { days: 31, now: T0 }), (e) => e.status === 400 && /30 days/.test(e.message));
  await assert.rejects(inv.extendInvitation(conn, a.id, { until: '2020-01-01T00:00:00Z', now: T0 }), (e) => e.status === 400 && /past/.test(e.message));
  await assert.rejects(inv.extendInvitation(conn, a.id, { now: T0 }), (e) => e.status === 400);
  const exact = await inv.extendInvitation(conn, a.id, { until: '2026-11-25T09:00:00-05:00', now: T0 });
  assert.equal(exact.endsAt.toISOString(), '2026-11-25T14:00:00.000Z');
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  await assert.rejects(inv.extendInvitation(conn, a.id, { days: 3 }), (e) => e.status === 409 && /already ended/.test(e.message));
  await assert.rejects(inv.extendInvitation(conn, 999999, { days: 3 }), (e) => e.status === 404);
  await endAll();
});

test('NEW CODE / NEW PASSWORD / NEW PIN: each changes one group only', async () => {
  await endAll();
  const a = await make('A');
  const b = await make('B');
  const bHash = hashOf('demo-teacher-02@public-demo.example.com');
  const oldCode = a.accessCode;

  const recoded = await inv.regenerateCode(conn, a.id);
  assert.notEqual(recoded.accessCode, oldCode);
  assert.equal(recoded.codeVersion, a.codeVersion + 1, 'the version goes up, so a visitor\'s cookie from the old code stops working');
  assert.equal(await inv.findOpenInvitationByCode(oldCode), null);
  assert.equal(Number((await inv.findOpenInvitationByCode(recoded.accessCode)).id), a.id);
  assert.equal(Number((await inv.findOpenInvitationByCode(b.accessCode)).id), b.id, 'B\'s code is unaffected');

  const sessionsBefore = db.prepare('SELECT session_invalidated_at FROM site_users WHERE email = ?').get('demo-teacher-02@public-demo.example.com').session_invalidated_at;
  const pw = await inv.regenerateSecret(conn, a.id, 'password', { rounds: ROUNDS });
  assert.notEqual(pw.password, a.password);
  assert.ok(await bcrypt.compare(pw.password, hashOf('demo-teacher-01@public-demo.example.com')));
  assert.ok(!(await bcrypt.compare(a.password, hashOf('demo-teacher-01@public-demo.example.com'))));
  assert.ok(await bcrypt.compare(a.pin, studentHash(1)), 'a new password leaves the PIN alone');
  const pin = await inv.regenerateSecret(conn, a.id, 'pin', { rounds: ROUNDS });
  assert.notEqual(pin.pin, a.pin);
  assert.ok(await bcrypt.compare(pin.pin, studentHash(1)));
  assert.ok(await bcrypt.compare(pw.password, hashOf('demo-teacher-01@public-demo.example.com')), 'a new PIN leaves the password alone');
  assert.equal(hashOf('demo-teacher-02@public-demo.example.com'), bHash, 'B\'s accounts are untouched');
  assert.equal(db.prepare('SELECT session_invalidated_at FROM site_users WHERE email = ?').get('demo-teacher-02@public-demo.example.com').session_invalidated_at, sessionsBefore, 'B is not signed out');
  await assert.rejects(inv.regenerateSecret(conn, a.id, 'nope'), (e) => e.status === 400);
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  await assert.rejects(inv.regenerateCode(conn, a.id), (e) => e.status === 409);
  await assert.rejects(inv.regenerateSecret(conn, a.id, 'pin'), (e) => e.status === 409);
  await endAll();
});

test('SWEEP: an invitation whose time has run out is ended and its workspace freed; one still running is left alone; a half-finished wipe is put right', async () => {
  await endAll();
  const old = await inv.createInvitation(conn, { label: 'Ran out', days: 1, rounds: ROUNDS, now: T0 });
  const live = await inv.createInvitation(conn, { label: 'Still running', days: 20, rounds: ROUNDS, now: T0 });
  const nothing = await inv.sweep(conn, { now: minutes(60), rounds: ROUNDS });
  assert.deepEqual(nothing, { ended: [], repaired: [] });
  const r = await inv.sweep(conn, { now: days(2), rounds: ROUNDS });
  assert.deepEqual(r.ended, [old.id]);
  const done = await inv.getInvitation(conn, old.id, { now: days(2) });
  assert.equal(done.status, 'ended'); assert.equal(done.endReason, 'expired');
  assert.equal(wsStatus(old.workspaceId), 'free');
  assert.equal((await inv.getInvitation(conn, live.id, { now: days(2) })).open, true);
  // a workspace marked in use with nobody holding it (an interrupted wipe) is wiped and freed
  db.prepare("UPDATE public_demo_workspaces SET status = 'in_use' WHERE id = 3").run();
  const room = Number(db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('Left behind', ?, 'LEFTBEHD')").run(accountId('demo-teacher-03@public-demo.example.com')).lastInsertRowid);
  const fixed = await inv.sweep(conn, { now: days(2), rounds: ROUNDS });
  assert.deepEqual(fixed.repaired, [3]);
  assert.equal(wsStatus(3), 'free');
  assert.equal(count('SELECT COUNT(*) AS n FROM classrooms WHERE id = ?', room), 0);
  // creating after a time-out frees the old workspace first, so a full pool of expired invitations never blocks a new one
  await endAll();
  await inv.createInvitation(conn, { label: 'x1', days: 1, rounds: ROUNDS, now: T0 });
  await inv.createInvitation(conn, { label: 'x2', days: 1, rounds: ROUNDS, now: T0 });
  await inv.createInvitation(conn, { label: 'x3', days: 1, rounds: ROUNDS, now: T0 });
  const fresh = await inv.createInvitation(conn, { label: 'Next day', days: 3, rounds: ROUNDS, now: days(2) });
  assert.equal(fresh.open, true);
  await endAll();
});

test('LOOKUPS: an invitation is open only while active, in time, and not paused; the code ignores case, spaces and hyphens; any failure means closed', async () => {
  await endAll();
  const a = await inv.createInvitation(conn, { label: 'A', days: 1, rounds: ROUNDS, now: T0 });
  const spelled = [a.accessCode, a.accessCode.toLowerCase(), a.accessCodeFormatted, ` ${a.accessCodeFormatted.toLowerCase()} `, a.accessCode.slice(0, 4) + ' ' + a.accessCode.slice(4)];
  for (const s of spelled) assert.equal(Number((await inv.findOpenInvitationByCode(s, T0)).id), a.id, s);
  for (const s of ['', 'ABC', 'x'.repeat(30), 'ZZZZZZZZ', null, undefined, 12345678]) assert.equal(await inv.findOpenInvitationByCode(s, T0), null, String(s));
  assert.equal(Number((await inv.getOpenInvitationForWorkspace(1, T0)).id), a.id);
  assert.equal(await inv.getOpenInvitationForWorkspace(2, T0), null, 'a workspace nobody holds');
  assert.equal(await inv.getOpenInvitationForWorkspace('x', T0), null);
  assert.equal(await inv.getOpenInvitationForWorkspace(null, T0), null);
  assert.equal(Number((await inv.getOpenInvitationById(a.id, T0)).id), a.id);
  assert.equal(await inv.anyOpenInvitation(T0), true);

  // the end time passes: closed at once, with no sweep needed
  const late = days(2);
  assert.equal(await inv.findOpenInvitationByCode(a.accessCode, late), null);
  assert.equal(await inv.getOpenInvitationForWorkspace(1, late), null);
  assert.equal(await inv.getOpenInvitationById(a.id, late), null);
  assert.equal(await inv.anyOpenInvitation(late), false);

  // paused: everything is closed, and nothing is lost
  await inv.setPaused(conn, true);
  assert.equal(await inv.findOpenInvitationByCode(a.accessCode, T0), null);
  assert.equal(await inv.getOpenInvitationForWorkspace(1, T0), null);
  assert.equal(await inv.getOpenInvitationById(a.id, T0), null);
  assert.equal(await inv.anyOpenInvitation(T0), false);
  await inv.setPaused(conn, false);
  assert.equal(Number((await inv.getOpenInvitationForWorkspace(1, T0)).id), a.id, 'resumed: the invitation is back, with its end time');

  // ended
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS, now: T0 });
  assert.equal(await inv.getOpenInvitationForWorkspace(1, T0), null);
  assert.equal(await inv.findOpenInvitationByCode(a.accessCode, T0), null);
  await endAll();
});

test('LOOKUPS: a change made here shows at once; one made elsewhere is seen within the cache time; a database that cannot be read means closed', async () => {
  await endAll();
  const a = await make('Cached');
  inv.setCacheTtl(60000);
  assert.ok(await inv.getOpenInvitationForWorkspace(a.workspaceId));
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  assert.equal(await inv.getOpenInvitationForWorkspace(a.workspaceId), null, 'ending it here clears the memory at once');
  const b = await make('Cached 2');
  assert.ok(await inv.getOpenInvitationForWorkspace(b.workspaceId));
  // the command-line tool is a different process: its change is only seen when the memory expires
  db.prepare("UPDATE public_demo_invitations SET status = 'ended' WHERE id = ?").run(b.id);
  assert.ok(await inv.getOpenInvitationForWorkspace(b.workspaceId), 'stale for at most the cache time');
  inv.setCacheTtl(0);
  assert.equal(await inv.getOpenInvitationForWorkspace(b.workspaceId), null);
  db.prepare("UPDATE public_demo_invitations SET status = 'active' WHERE id = ?").run(b.id);
  await endAll();

  // a table that is not there yet (code deployed before its alter script) is simply closed
  const keep = world.run;
  stubs[path.join(SERVER, 'db/pool.js')].query = async () => { const e = new Error("Table 'x.public_demo_invitations' doesn't exist"); e.code = 'ER_NO_SUCH_TABLE'; throw e; };
  assert.equal(await inv.getOpenInvitationForWorkspace(1), null);
  assert.equal(await inv.findOpenInvitationByCode('ABCD2345'), null);
  assert.equal(await inv.anyOpenInvitation(), false);
  // any other failure is closed too (and is logged)
  stubs[path.join(SERVER, 'db/pool.js')].query = async () => { throw new Error('the database went away'); };
  const log = console.error; console.error = () => {};
  try { assert.equal(await inv.getOpenInvitationForWorkspace(1), null); assert.equal(await inv.anyOpenInvitation(), false); } finally { console.error = log; }
  stubs[path.join(SERVER, 'db/pool.js')].query = keep;
});

// ============================================================================================================================================
// The command line
// ============================================================================================================================================

test('COMMAND LINE: it reads its arguments strictly, and prints the details staff need without leaking secrets into the list', async () => {
  assert.deepEqual(cli.parseArgs(['list']), { command: 'list', all: false });
  assert.deepEqual(cli.parseArgs(['list', '--all']), { command: 'list', all: true });
  assert.deepEqual(cli.parseArgs(['create', '--label', 'Springfield USD', '--days', '7']), { command: 'create', all: false, label: 'Springfield USD', days: '7' });
  assert.deepEqual(cli.parseArgs(['extend', '4', '--until', '2026-11-30T12:00:00Z']), { command: 'extend', all: false, id: 4, until: '2026-11-30T12:00:00Z' });
  for (const bad of [[], ['nope'], ['show'], ['end', 'abc'], ['create'], ['extend', '3'], ['list', '--what'], ['end', '3', '4']]) assert.throws(() => cli.parseArgs(bad), bad.join(' ') || '(nothing)');

  await endAll();
  const out = await cli.run(conn, cli.parseArgs(['create', '--label', 'Springfield USD', '--days', '7']), { siteUrl: 'https://example.test/', createdBy: 'cli test' });
  const id = db.prepare('SELECT id FROM public_demo_invitations ORDER BY id DESC').get().id;
  const row = db.prepare('SELECT * FROM public_demo_invitations WHERE id = ?').get(id);
  assert.match(out, /Invitation \d+: "Springfield USD"/);
  assert.ok(out.includes(row.password) && out.includes(row.pin) && out.includes(A.formatAccessCode(row.access_code)), 'the details are shown once');
  assert.match(out, /demo-teacher-01@public-demo\.example\.com/);
  assert.match(out, /https:\/\/example\.test\/demo-welcome\.html/);
  assert.equal(row.created_by, 'cli test');

  const list = await cli.run(conn, cli.parseArgs(['list']));
  assert.match(list, /Springfield USD/);
  assert.ok(!list.includes(row.password) && !list.includes(row.pin) && !list.includes(row.access_code));
  const shown = await cli.run(conn, cli.parseArgs(['show', String(id)]), { siteUrl: 'https://example.test' });
  assert.ok(shown.includes(row.password));

  assert.match(await cli.run(conn, cli.parseArgs(['extend', String(id), '--days', '10'])), /now runs until/);
  const recoded = await cli.run(conn, cli.parseArgs(['new-code', String(id)]));
  assert.ok(!recoded.includes(row.access_code) && /New access code for invitation/.test(recoded));
  assert.match(await cli.run(conn, cli.parseArgs(['new-password', String(id)])), /New password/);
  assert.match(await cli.run(conn, cli.parseArgs(['new-pin', String(id)])), /New student PIN/);
  assert.match(await cli.run(conn, cli.parseArgs(['end', String(id)])), /is ended/);
  assert.match(await cli.run(conn, cli.parseArgs(['show', String(id)])), /ended .* Its workspace is back in the pool/);
  assert.match(await cli.run(conn, cli.parseArgs(['list'])), /No invitations\./);
  assert.match(await cli.run(conn, cli.parseArgs(['list', '--all'])), /ended/);
  assert.match(await cli.run(conn, cli.parseArgs(['sweep'])), /Nothing to sweep/);
  await assert.rejects(cli.run(conn, cli.parseArgs(['show', '999999'])), (e) => e.status === 404);
});

test('PAUSE: --pause and --resume are accepted, and the one --off the admin page uses leaves invitations running', async () => {
  assert.equal(sw.parseArgs(['--pause']).action, 'pause');
  assert.equal(sw.parseArgs(['--resume']).action, 'resume');
  assert.throws(() => sw.parseArgs(['--pause', '--on']), /Choose one/);
  await endAll();
  const a = await make('Survives the original demo being turned off');
  await sw.turnOff(conn); // what the admin page's "Turn off" calls: it closes the original demo only
  assert.equal(await inv.isPaused(conn), false);
  assert.equal(Number((await inv.getOpenInvitationForWorkspace(a.workspaceId)).id), a.id);
  await endAll();
});

// ============================================================================================================================================
// The real routes, with two groups open at once (and the original demo beside them)
// ============================================================================================================================================

function call(method, p, { cookie = null, body = null, ip = '203.0.113.9' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'X-Forwarded-For': ip };
    if (cookie) headers.Cookie = cookie;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = {}; try { json = b ? JSON.parse(b) : {}; } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const setCookies = (res) => (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
const cookieHeader = (...pairs) => pairs.flat().filter(Boolean).join('; ');
async function enter(code, ip) { const r = await call('POST', '/api/demo/enter', { body: { code }, ip }); return { res: r, cookie: setCookies(r).find(c => c.startsWith('fn_demo_gate=')) || null }; }
const siteLogin = (email, password, ip) => call('POST', '/api/site-auth/login', { body: { email, password }, ip });
const studentLogin = (username, pin, ip) => call('POST', '/api/classroom-auth/login', { body: { username, pin }, ip });
const sessionOf = (res, name) => setCookies(res).find(c => c.startsWith(`${name}=`)) || null;
const me = (cookie) => call('GET', '/api/site-auth/me', { cookie });
const decode = (cookie) => JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString());

test('ROUTES: nothing is open until an invitation exists; the page then shows a code box and nothing else', async () => {
  await endAll();
  await A.putSettingRaw(conn, 'public_demo_enabled', 'false');
  assert.deepEqual((await call('GET', '/api/demo/state')).json, { open: false });
  assert.equal((await call('GET', '/api/demo/credentials')).status, 401);
  const a = await make('Springfield USD');
  const state = (await call('GET', '/api/demo/state')).json;
  assert.deepEqual(state, { open: true, unlocked: false }, 'a code box, with no end time and no names before the code');
  assert.equal((await call('GET', '/api/demo/credentials')).status, 401);
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  assert.deepEqual((await call('GET', '/api/demo/state')).json, { open: false });
});

test('ROUTES: each group enters its own code and sees its own workspace\'s sign-ins, password, PIN and end time, and no other group\'s', async () => {
  await endAll();
  const a = await make('Springfield USD', { days: 7 });
  const b = await make('Shelbyville Schools', { days: 3 });

  const wrong = await enter('ZZZZ-ZZZZ');
  assert.equal(wrong.res.status, 401); assert.equal(wrong.cookie, null);

  const ea = await enter(a.accessCodeFormatted.toLowerCase());
  const eb = await enter(b.accessCode);
  assert.equal(ea.res.status, 200); assert.equal(eb.res.status, 200);
  assert.ok(ea.cookie && eb.cookie);
  assert.notEqual(ea.cookie, eb.cookie);

  const ca = await call('GET', '/api/demo/credentials', { cookie: ea.cookie });
  const cb = await call('GET', '/api/demo/credentials', { cookie: eb.cookie });
  assert.equal(ca.status, 200); assert.equal(cb.status, 200);
  assert.equal(ca.json.password, a.password); assert.equal(ca.json.pin, a.pin);
  assert.equal(cb.json.password, b.password); assert.equal(cb.json.pin, b.pin);
  assert.deepEqual(ca.json.logins.map(l => l.userId), ['demo-district-01@public-demo.example.com', 'demo-school-01@public-demo.example.com', 'demo-teacher-01@public-demo.example.com', 'demo-parent-01@public-demo.example.com', 'demo-student-01']);
  assert.deepEqual(cb.json.logins.map(l => l.userId), ['demo-district-02@public-demo.example.com', 'demo-school-02@public-demo.example.com', 'demo-teacher-02@public-demo.example.com', 'demo-parent-02@public-demo.example.com', 'demo-student-02']);
  assert.deepEqual(ca.json.logins.map(l => l.secretKind), ['password', 'password', 'password', 'password', 'pin']);
  assert.equal(ca.json.privateCopy, true, 'the page tells a group its copy is private'); assert.equal(cb.json.privateCopy, true);
  assert.equal(ca.json.endsAt, a.endsAt.toISOString()); assert.equal(cb.json.endsAt, b.endsAt.toISOString());
  assert.notEqual(ca.json.endsAtEastern, cb.json.endsAtEastern, 'each group sees its own end time');
  const text = JSON.stringify(ca.json);
  assert.ok(!text.includes(b.password) && !text.includes(b.pin) && !text.includes('-02@') && !text.includes(b.accessCode), 'nothing of group B in group A\'s page');
  assert.ok(!text.includes('Springfield') && !text.includes('Shelbyville'), 'the group\'s name is for staff only');
  assert.ok(!text.includes(joinCodeOf(1)), 'never the join code');

  // the state of each browser
  const sa = (await call('GET', '/api/demo/state', { cookie: ea.cookie })).json;
  assert.equal(sa.unlocked, true); assert.equal(sa.endsAt, a.endsAt.toISOString());
  assert.deepEqual((await call('GET', '/api/demo/state')).json, { open: true, unlocked: false });

  // another browser with no cookie, a made-up cookie, and a cookie for the wrong audience get nothing
  assert.equal((await call('GET', '/api/demo/credentials')).status, 401);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: 'fn_demo_gate=not-a-token' })).status, 401);
  const claim = decode(ea.cookie);
  assert.equal(claim.inv, a.id); assert.equal(claim.v, '1');
  assert.ok(claim.exp - claim.iat <= 8 * 3600, 'a visit lasts at most 8 hours');
  await endAll();
});

test('ROUTES: a gate cookie never lasts past its own invitation, and the longest visit is eight hours', async () => {
  await endAll();
  const soon = await inv.createInvitation(conn, { label: 'Short', days: undefined, until: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), rounds: ROUNDS });
  const longer = await make('Long', { days: 7 });
  const s = await enter(soon.accessCode, '198.51.100.1'); const l = await enter(longer.accessCode, '198.51.100.2');
  const cs = decode(s.cookie), cl = decode(l.cookie);
  assert.ok(cs.exp - cs.iat <= 2 * 3600 + 2, 'ends with its invitation');
  assert.equal(cl.exp - cl.iat, 8 * 3600, 'otherwise eight hours');
  await endAll();
});

test('ROUTES: a wrong code, an ended invitation and a paused demo all get exactly the same answer', async () => {
  await endAll();
  const a = await make('Springfield USD');
  const wrong = await enter('QQQQ-QQQQ', '198.51.100.10');
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  const ended = await enter(a.accessCode, '198.51.100.11');
  const b = await make('Shelbyville Schools');
  await inv.setPaused(conn, true);
  const paused = await enter(b.accessCode, '198.51.100.12');
  await inv.setPaused(conn, false);
  for (const r of [wrong, ended, paused]) { assert.equal(r.res.status, 401); assert.equal(r.cookie, null); }
  assert.deepEqual(ended.res.json, wrong.res.json);
  assert.deepEqual(paused.res.json, wrong.res.json);
  assert.equal(JSON.stringify(ended.res.json).includes('ended'), false);
  await endAll();
});

test('ROUTES: sign-in works for a workspace only with its own group\'s password, only while its invitation is open', async () => {
  await endAll();
  const a = await make('A');
  const b = await make('B');
  const ip = (n) => `198.51.100.${n}`;

  const ok = await siteLogin('demo-teacher-01@public-demo.example.com', a.password, ip(20));
  assert.equal(ok.status, 200);
  const cookie = sessionOf(ok, 'fn_user_session');
  const claim = decode(cookie);
  assert.equal(claim.demo, true); assert.equal(claim.ws, 1, 'the session names its workspace');
  assert.ok(claim.exp - claim.iat <= 8 * 3600);
  assert.equal((await me(cookie)).json.loggedIn, true);

  // not the other group's password, not a free workspace, not an unknown address: all the same refusal
  const refusals = [
    await siteLogin('demo-teacher-01@public-demo.example.com', b.password, ip(21)),
    await siteLogin('demo-teacher-02@public-demo.example.com', a.password, ip(22)),
    await siteLogin('demo-teacher-03@public-demo.example.com', a.password, ip(23)),
    await siteLogin('demo-teacher-09@public-demo.example.com', a.password, ip(24)),
  ];
  for (const r of refusals) { assert.equal(r.status, 401); assert.deepEqual(r.json, { error: 'Invalid email or password' }); assert.equal(sessionOf(r, 'fn_user_session'), null); }
  assert.equal((await siteLogin('demo-teacher-02@public-demo.example.com', b.password, ip(25))).status, 200);

  // students
  const s = await studentLogin('demo-student-01', a.pin, ip(26));
  assert.equal(s.status, 200);
  const sCookie = sessionOf(s, 'fn_student_session');
  assert.equal(decode(sCookie).demo, true); assert.equal(decode(sCookie).ws, 1);
  assert.equal((await studentLogin('demo-student-01', b.pin, ip(27))).status, 401);
  assert.equal((await studentLogin('demo-student-02', a.pin, ip(28))).status, 401);
  assert.equal((await studentLogin('demo-student-03', a.pin, ip(29))).status, 401, 'a free workspace');

  // joining a group's classroom with its join code works while the group is open and for no one else's code
  const join = await call('POST', '/api/classroom-auth/join', { body: { joinCode: joinCodeOf(1), displayName: 'Visitor One', pin: '654321' }, ip: ip(30) });
  assert.equal(join.status, 200);
  assert.equal(decode(sessionOf(join, 'fn_student_session')).ws, 1);
  assert.equal((await call('POST', '/api/classroom-auth/join', { body: { joinCode: joinCodeOf(3), displayName: 'Visitor Two', pin: '654321' }, ip: ip(31) })).status, 404, 'the free workspace\'s join code finds nothing');
  await endAll();
});

test('ROUTES: ending one group signs that group out within the request and leaves the other group signed in', async () => {
  await endAll();
  const a = await make('A');
  const b = await make('B');
  const ta = sessionOf(await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.40'), 'fn_user_session');
  const tb = sessionOf(await siteLogin('demo-teacher-02@public-demo.example.com', b.password, '198.51.100.41'), 'fn_user_session');
  const sa = sessionOf(await studentLogin('demo-student-01', a.pin, '198.51.100.42'), 'fn_student_session');
  const sb = sessionOf(await studentLogin('demo-student-02', b.pin, '198.51.100.43'), 'fn_student_session');
  const ga = (await enter(a.accessCode, '198.51.100.44')).cookie, gb = (await enter(b.accessCode, '198.51.100.45')).cookie;
  assert.ok(ta && tb && sa && sb && ga && gb);
  const all = async () => ({
    ta: (await me(ta)).json.loggedIn, tb: (await me(tb)).json.loggedIn,
    sa: (await call('GET', '/api/classroom-auth/me', { cookie: sa })).status, sb: (await call('GET', '/api/classroom-auth/me', { cookie: sb })).status,
    ga: (await call('GET', '/api/demo/credentials', { cookie: ga })).status, gb: (await call('GET', '/api/demo/credentials', { cookie: gb })).status,
  });
  assert.deepEqual(await all(), { ta: true, tb: true, sa: 200, sb: 200, ga: 200, gb: 200 });

  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  assert.deepEqual(await all(), { ta: false, tb: true, sa: 401, sb: 200, ga: 401, gb: 200 }, 'only group A is closed');
  assert.equal((await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.46')).status, 401, 'its old password no longer works');
  assert.equal((await studentLogin('demo-student-01', a.pin, '198.51.100.47')).status, 401);
  assert.equal((await call('POST', '/api/classroom-auth/join', { body: { joinCode: joinCodeOf(1), displayName: 'Late', pin: '654321' }, ip: '198.51.100.48' })).status, 404, 'the closed workspace\'s join code finds nothing');
  await endAll();
});

test('ROUTES: a new code for one group ends that group\'s visits only; extending keeps everyone in place', async () => {
  await endAll();
  const a = await make('A');
  const b = await make('B');
  const ga = (await enter(a.accessCode, '198.51.100.50')).cookie, gb = (await enter(b.accessCode, '198.51.100.51')).cookie;
  const ta = sessionOf(await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.52'), 'fn_user_session');

  await inv.extendInvitation(conn, a.id, { days: 20 });
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: ga })).status, 200, 'extending does not sign anyone out');
  assert.equal((await me(ta)).json.loggedIn, true);

  const recoded = await inv.regenerateCode(conn, a.id);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: ga })).status, 401, 'the old visit stops');
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: gb })).status, 200, 'the other group is untouched');
  assert.equal((await enter(a.accessCode, '198.51.100.53')).res.status, 401, 'the old code is dead');
  const fresh = await enter(recoded.accessCode, '198.51.100.54');
  assert.equal(fresh.res.status, 200);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: fresh.cookie })).json.password, a.password);
  assert.equal((await me(ta)).json.loggedIn, true, 'a new code does not sign out people already in (a new password does)');

  await new Promise(r => setTimeout(r, 1100)); // sessions are revoked by whole seconds (the same rule a real password change uses), so let the clock tick over
  assert.equal((await call('GET', '/api/behind-sign-in', { cookie: ta })).status, 200, 'signed in, as the real revocation check sees it');
  await inv.regenerateSecret(conn, a.id, 'password', { rounds: ROUNDS });
  assert.equal((await call('GET', '/api/behind-sign-in', { cookie: ta })).status, 401, 'a new password signs the group out');
  await endAll();
});

test('ROUTES: pausing closes every group at once, and resuming opens them again with nothing lost', async () => {
  await endAll();
  const a = await make('A');
  const b = await make('B');
  const ta = sessionOf(await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.60'), 'fn_user_session');
  const gb = (await enter(b.accessCode, '198.51.100.61')).cookie;
  await inv.setPaused(conn, true);
  assert.equal((await me(ta)).json.loggedIn, false);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: gb })).status, 401);
  assert.deepEqual((await call('GET', '/api/demo/state')).json, { open: false });
  assert.equal((await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.62')).status, 401);
  assert.equal((await enter(b.accessCode, '198.51.100.63')).res.status, 401);
  await inv.setPaused(conn, false);
  assert.equal((await me(ta)).json.loggedIn, true, 'the session is still good once demos resume');
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: gb })).status, 200);
  assert.equal((await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.64')).status, 200);
  await endAll();
});

test('ROUTES: an invitation whose end time passes is closed at once, even before the sweep runs', async () => {
  await endAll();
  const a = await make('A');
  const ta = sessionOf(await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.70'), 'fn_user_session');
  const ga = (await enter(a.accessCode, '198.51.100.71')).cookie;
  db.prepare('UPDATE public_demo_invitations SET ends_at = ? WHERE id = ?').run(inv.toDb(new Date(Date.now() - 60000)), a.id);
  assert.equal((await me(ta)).json.loggedIn, false);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: ga })).status, 401);
  assert.equal((await enter(a.accessCode, '198.51.100.72')).res.status, 401);
  assert.equal((await siteLogin('demo-teacher-01@public-demo.example.com', a.password, '198.51.100.73')).status, 401);
  assert.deepEqual((await call('GET', '/api/demo/state')).json, { open: false });
  assert.equal(wsStatus(1), 'in_use', 'the workspace is still held until the sweep wipes it');
  await inv.sweep(conn, { rounds: ROUNDS });
  assert.equal(wsStatus(1), 'free');
  await endAll();
});

test('ROUTES: the original single demo works exactly as before, beside the groups', async () => {
  await endAll();
  const legacy = await seedLib.seed(conn, { password: 'original-demo-password-1', pin: '482915', rounds: ROUNDS }, seedLib.makeReport());
  await A.putSettingRaw(conn, 'public_demo_password', 'original-demo-password-1');
  await A.putSettingRaw(conn, 'public_demo_pin', '482915');
  const a = await make('A');
  const ip = (n) => `198.51.100.${n}`;

  // closed: its logins are refused, and the group is unaffected
  assert.equal((await siteLogin(F.ACCOUNTS.teacher.email, 'original-demo-password-1', ip(80))).status, 401);
  assert.equal((await siteLogin('demo-teacher-01@public-demo.example.com', a.password, ip(81))).status, 200);

  // open: both work, side by side, and neither session names the other's workspace
  await A.putSettingRaw(conn, 'public_demo_enabled', 'true');
  await A.putSettingRaw(conn, 'public_demo_ends_at', new Date(Date.now() + 3600000).toISOString());
  await A.putSettingRaw(conn, 'public_demo_access_code', 'ORIGINAL');
  await A.putSettingRaw(conn, 'public_demo_code_version', '3');
  const lg = await siteLogin(F.ACCOUNTS.teacher.email, 'original-demo-password-1', ip(82));
  assert.equal(lg.status, 200);
  const lc = sessionOf(lg, 'fn_user_session');
  assert.equal(decode(lc).demo, true); assert.equal(decode(lc).ws, undefined, 'the original demo has no workspace');
  const gl = await enter('ORIGINAL', ip(83));
  assert.equal(gl.res.status, 200);
  assert.equal(decode(gl.cookie).inv, undefined);
  const cr = await call('GET', '/api/demo/credentials', { cookie: gl.cookie });
  assert.equal(cr.json.password, 'original-demo-password-1');
  assert.equal(cr.json.privateCopy, undefined, 'the original demo is shared, and the page keeps saying so');
  assert.equal(cr.json.logins[0].userId, F.ACCOUNTS.district.email);
  const ga = await enter(a.accessCode, ip(84));
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: ga.cookie })).json.logins[0].userId, 'demo-district-01@public-demo.example.com');
  assert.equal((await studentLogin('demo-student', '482915', ip(85))).status, 200);
  // the original's code does not open a group's workspace, and a group's code does not open the original
  assert.equal((await siteLogin(F.ACCOUNTS.teacher.email, a.password, ip(86))).status, 401);
  assert.equal((await siteLogin('demo-teacher-01@public-demo.example.com', 'original-demo-password-1', ip(87))).status, 401);

  // turning the original off closes the original only
  const ta = sessionOf(await siteLogin('demo-teacher-01@public-demo.example.com', a.password, ip(88)), 'fn_user_session');
  await sw.turnOff(conn);
  assert.equal((await me(lc)).json.loggedIn, false);
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: gl.cookie })).status, 401);
  assert.equal((await me(ta)).json.loggedIn, true, 'the group is still in');
  assert.equal((await call('GET', '/api/demo/credentials', { cookie: ga.cookie })).status, 200);
  // and closing the group does not touch the original (turn it back on)
  await A.putSettingRaw(conn, 'public_demo_enabled', 'true');
  await A.putSettingRaw(conn, 'public_demo_ends_at', new Date(Date.now() + 3600000).toISOString());
  await inv.endInvitation(conn, a.id, { rounds: ROUNDS });
  assert.equal((await me(lc)).json.loggedIn, true);
  assert.equal((await me(ta)).json.loggedIn, false);
  void legacy;
  await A.putSettingRaw(conn, 'public_demo_enabled', 'false');
});

test('ROUTES: the new gate keeps the old safeguards: wrong tries are throttled, and a right code never counts against anyone', async () => {
  await endAll();
  const a = await make('A');
  const ip = '192.0.2.77';
  for (let i = 0; i < 10; i++) assert.equal((await enter(`WRONG${i}XY`, ip)).res.status, 401);
  assert.equal((await enter('WRONG-ONE', ip)).res.status, 429, 'ten wrong tries from one address and it waits');
  assert.equal((await enter(a.accessCode, ip)).res.status, 429, 'even the right code, from that address');
  assert.equal((await enter(a.accessCode, '192.0.2.78')).res.status, 200, 'another address is fine');
  await endAll();
});
