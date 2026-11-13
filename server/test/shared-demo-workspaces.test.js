// Prospect demo workspaces, phase 1 (docs/reference/shared-demo-workspaces-requirements.md): every group gets a private copy of the demo, and one
// workspace's logins can never reach another workspace, the original shared demo, a salesperson's demo or a real school.
// The seed and reset scripts run against a real SQL engine (node:sqlite) and the REAL school-admin, district-admin and classroom routes run on top of
// what the seed made. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
require('express-async-errors');
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-workspaces';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const sales = require(path.join(SERVER, 'lib/sales-demo.js'));
const W = require(path.join(SERVER, 'lib/public-demo-workspaces.js'));
const F = require(path.join(SERVER, 'lib/public-demo-fixtures.js'));
const seedLib = require(path.join(SERVER, 'scripts/seed-public-demo.js'));
const { seedWorkspaces, parseArgs: seedArgs } = require(path.join(SERVER, 'scripts/seed-demo-workspaces.js'));
const { resetWorkspaces, parseArgs: resetArgs } = require(path.join(SERVER, 'scripts/reset-demo-workspace.js'));
const { resetDemo } = require(path.join(SERVER, 'scripts/reset-public-demo.js'));
const { signSession } = require(path.join(SERVER, 'lib/session-tokens.js'));

// ---- A real SQL engine with the tables the seed, the reset and the routes under test touch ------------------------------------------------------
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
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, curriculum_id INTEGER, assigned_by_id INTEGER, sort_order INTEGER DEFAULT 0, assigned_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE brain_games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT);
CREATE TABLE classroom_game_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, game_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE student_game_completions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_assignment_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE student_reflections (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, body TEXT);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, student_id INTEGER);
CREATE TABLE school_branding (school_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE district_branding (district_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER, name TEXT);
CREATE TABLE lesson_favorites (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE public_demo_workspaces (id INTEGER PRIMARY KEY, district_id INTEGER, school_id INTEGER, purchase_id INTEGER, status TEXT DEFAULT 'free', last_reset_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
  for (let i = 0; i < 5; i++) db.prepare('INSERT INTO curricula (published) VALUES (1)').run();
  // A query's array parameter ("IN (?)") becomes a list of placeholders, the way mysql2 does it.
  const run = async (sql, rawParams = []) => {
    const params = [];
    let i = 0;
    const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => {
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

const seedLegacy = (conn) => seedLib.seed(conn, { password: 'demo-shared-test-password-1', pin: '482915', rounds: 4 }, seedLib.makeReport());
const seedPool = (conn, count) => seedWorkspaces(conn, count, { rounds: 4 });
const kinds = (report) => report.lines.map(l => l[0].trim());

// ============================================================================================================================================
// The names and the kinds (pure, no database)
// ============================================================================================================================================

test('NAMES: a workspace is named by its two-digit number everywhere, and the name says which workspace it is', () => {
  assert.equal(sales.workspaceDistrictName(7), 'FNE Demo District 07');
  assert.equal(sales.workspaceSchoolDomain(7), 'w07.public-demo.example.com');
  assert.equal(sales.workspaceOfDistrictName('FNE Demo District 07'), 7);
  assert.equal(sales.workspaceOfSchoolDomain('w07.public-demo.example.com'), 7);
  assert.equal(sales.demoKindOfDistrict('FNE Demo District 07'), 'public:07');
  assert.equal(sales.demoKindOfSchool('w07.public-demo.example.com'), 'public:07');
  // the older kinds are unchanged
  assert.equal(sales.demoKindOfDistrict('FNE Demo District'), 'public');
  assert.equal(sales.demoKindOfSchool('public-demo.example.com'), 'public');
  assert.equal(sales.demoKindOfDistrict('FNE Sales Demo District'), 'sales');
  assert.equal(sales.demoKindOfSchool('sales-demo.example.com'), 'sales');
  // things that only look like a workspace are not one, and a real name is never a demo
  for (const n of ['FNE Demo District 7', 'FNE Demo District 007', 'FNE Demo District 00', 'FNE Demo District AB', 'fne demo district 07', 'Springfield USD', '', null, undefined]) {
    assert.equal(sales.demoKindOfDistrict(n), null, String(n));
    assert.equal(sales.isDemoDistrictName(n), false, String(n));
  }
  for (const d of ['w7.public-demo.example.com', 'w07.public-demo.example.com.evil.org', 'xw07.public-demo.example.com', 'w00.public-demo.example.com', 'lincoln.k12.us', '', null]) {
    assert.equal(sales.demoKindOfSchool(d), null, String(d));
    assert.equal(sales.isDemoSchoolDomain(d), false, String(d));
  }
  // every two-digit name is reserved, even beyond the pool, so a stray one is never mistaken for a real district
  assert.equal(sales.isDemoDistrictName('FNE Demo District 99'), true);
  assert.equal(sales.isDemoSchoolDomain('w99.public-demo.example.com'), true);
  assert.equal(sales.isDemoDistrictName('FNE Demo District 25'), true);
  assert.equal(sales.MAX_DEMO_WORKSPACES, 40);
  assert.equal(sales.WORKSPACE_DISTRICT_NAME_LIKE, 'FNE Demo District %');
});

test('NAMES: an account belongs to the demo its three explicit columns say, never to one its assignments suggest', () => {
  assert.equal(sales.demoKindOfAccount({ is_sales_demo: 1, is_shared_demo: 1, demo_workspace_id: 3 }), 'public:03');
  assert.equal(sales.demoKindOfAccount({ is_sales_demo: 1, is_shared_demo: 1, demo_workspace_id: null }), 'public');
  assert.equal(sales.demoKindOfAccount({ is_sales_demo: 1, is_shared_demo: 0, demo_workspace_id: null }), 'sales');
  assert.equal(sales.demoKindOfAccount({ is_sales_demo: 0, is_shared_demo: 0, demo_workspace_id: null }), null);
  assert.equal(sales.demoKindOfAccount(undefined), null);
  assert.equal(sales.demoKindOfAccount({ is_sales_demo: 1 }), 'sales', 'a database from before the newer columns');
  // a workspace number that cannot exist matches no school or district at all
  const bad = sales.demoKindOfAccount({ is_sales_demo: 1, is_shared_demo: 1, demo_workspace_id: 100 });
  assert.equal(bad, 'public:invalid');
  assert.notEqual(bad, sales.demoKindOfSchool('w99.public-demo.example.com'));
});

test('FIXTURES: every name in workspace n carries n, and two workspaces share no name, login or username', () => {
  const a = W.workspaceFixtures(1), b = W.workspaceFixtures(2);
  assert.equal(a.districtName, 'FNE Demo District 01');
  assert.equal(a.domain, 'w01.public-demo.example.com');
  assert.equal(a.accounts.teacher.email, 'demo-teacher-01@public-demo.example.com');
  assert.deepEqual(a.students.map(s => s.username), ['demo-student-01', 'demo-student-01-b', 'demo-student-01-c']);
  const names = (f) => [f.districtName, f.domain, f.schoolName, ...Object.values(f.accounts).map(x => x.email), ...f.students.map(s => s.username)];
  for (const n of names(a)) assert.ok(!names(b).includes(n), `${n} is in both`);
  // and none collides with the original single demo
  const legacy = W.legacyFixtures();
  for (const n of names(a)) assert.ok(!names(legacy).includes(n), `${n} collides with the original demo`);
  assert.equal(legacy.number, null);
  assert.equal(legacy.accounts.teacher.email, F.ACCOUNTS.teacher.email);
  assert.throws(() => W.workspaceFixtures(0), /1 to 99/);
  assert.throws(() => W.workspaceFixtures(100), /1 to 99/);
  assert.throws(() => W.workspaceFixtures('3'), /1 to 99/);
  assert.deepEqual(W.workspaceLoginOf('demo-teacher-07@public-demo.example.com'), { number: 7, role: 'teacher' });
  assert.deepEqual(W.workspaceLoginOf('DEMO-STUDENT-12'), { number: 12, role: 'student' });
  assert.equal(W.workspaceLoginOf('demo-teacher@public-demo.example.com'), null, 'the original demo is not a workspace');
  assert.equal(W.workspaceLoginOf('demo-student'), null);
  assert.equal(W.workspaceLoginOf('demo-teacher-07@evil.example.com'), null);
  assert.equal(W.workspaceLogins(3).length, 5);
  const wl = require(path.join(SERVER, 'lib/public-demo-admin.js'));
  assert.equal(wl.demoRoleKeyForEmail('demo-teacher-07@public-demo.example.com'), 'teacher');
  assert.equal(wl.demoRoleKeyForEmail('demo-teacher@public-demo.example.com'), 'teacher');
  assert.equal(wl.demoRoleKeyForEmail('someone@real.org'), null);
});

test('PUBLIC PAGES: the standards queries leave out every workspace district, not just the two named ones', () => {
  const { db } = buildDb();
  db.exec('CREATE TABLE d (name TEXT)');
  for (const n of ['Springfield USD', 'FNE Demo District', 'FNE Sales Demo District', 'FNE Demo District 01', 'FNE Demo District 40']) db.prepare('INSERT INTO d VALUES (?)').run(n);
  const shown = db.prepare('SELECT name FROM d WHERE name NOT IN (?, ?) AND name NOT LIKE ?').all(...sales.DEMO_DISTRICT_NAMES, sales.WORKSPACE_DISTRICT_NAME_LIKE).map(r => r.name);
  assert.deepEqual(shown, ['Springfield USD']);
  const src = fs.readFileSync(path.join(SERVER, 'lib/standards.js'), 'utf8');
  assert.equal((src.match(/WORKSPACE_DISTRICT_NAME_LIKE/g) || []).length, 3, 'imported once, used in both public queries');
});

test('CONFINEMENT CODE: nothing outside the demo libraries compares against one named demo district or school any more', () => {
  const allowed = new Set(['lib/sales-demo.js', 'lib/public-demo-fixtures.js', 'lib/public-demo-workspaces.js', 'lib/public-demo.js']);
  const bad = /\b(DEMO_DISTRICT_NAME|DEMO_SCHOOL_DOMAIN|PUBLIC_DEMO_DISTRICT_NAME|PUBLIC_DEMO_SCHOOL_DOMAIN)\b|'FNE Demo District'|'FNE Sales Demo District'|'public-demo\.example\.com'|'sales-demo\.example\.com'/;
  const hits = [];
  for (const dir of ['routes', 'middleware', 'lib']) {
    for (const f of fs.readdirSync(path.join(SERVER, dir))) {
      if (!f.endsWith('.js') || allowed.has(`${dir}/${f}`)) continue;
      fs.readFileSync(path.join(SERVER, dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (bad.test(line)) hits.push(`${dir}/${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
  assert.deepEqual(hits, [], 'compare kinds (demoKindOfDistrict / demoKindOfSchool / demoKindOfAccountId), not one demo\'s name');
});

// ============================================================================================================================================
// The seed
// ============================================================================================================================================

test('SEED: two workspaces are two complete, separate demos, each login flagged with its own workspace', async () => {
  const { db, conn, count } = buildDb();
  const { out, report } = await seedPool(conn, 2);
  assert.equal(out.length, 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM districts'), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM schools'), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM purchases'), 2, 'one $0 purchase each');
  assert.equal(count('SELECT COUNT(*) AS n FROM license_products'), 1, 'the $0 product and the CRM contact are shared');
  assert.equal(count('SELECT COUNT(*) AS n FROM newsletter_contacts'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM classrooms'), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM classroom_students'), 6);
  assert.equal(count('SELECT COUNT(*) AS n FROM site_users'), 8);
  for (const n of [1, 2]) {
    const fx = W.workspaceFixtures(n);
    const district = db.prepare('SELECT * FROM districts WHERE name = ?').get(fx.districtName);
    const school = db.prepare('SELECT * FROM schools WHERE domain = ?').get(fx.domain);
    assert.equal(school.district_id, district.id, 'the school is in its own workspace district');
    const purchase = db.prepare('SELECT * FROM purchases WHERE school_domain = ?').get(fx.domain);
    assert.equal(purchase.school_id, school.id);
    assert.equal(purchase.source, 'Sales Demo', 'excluded from the revenue and CRM reports like every demo');
    const row = db.prepare('SELECT * FROM public_demo_workspaces WHERE id = ?').get(n);
    assert.deepEqual([row.district_id, row.school_id, row.purchase_id, row.status], [district.id, school.id, purchase.id, 'free']);
    for (const key of Object.keys(fx.accounts)) {
      const u = db.prepare('SELECT * FROM site_users WHERE email = ?').get(fx.accounts[key].email);
      assert.equal(u.demo_workspace_id, n, `${key} belongs to workspace ${n}`);
      assert.equal(u.is_shared_demo, 1); assert.equal(u.is_sales_demo, 1); assert.equal(u.email_verified, 1);
    }
    const teacher = db.prepare('SELECT id FROM site_users WHERE email = ?').get(fx.accounts.teacher.email).id;
    const room = db.prepare('SELECT * FROM classrooms WHERE teacher_site_user_id = ?').get(teacher);
    assert.deepEqual(db.prepare('SELECT username FROM classroom_students WHERE classroom_id = ? ORDER BY username').all(room.id).map(r => r.username), fx.students.map(s => s.username).sort());
    assert.equal(count('SELECT COUNT(*) AS n FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?', purchase.id, teacher), 1);
    const sa = db.prepare('SELECT purchase_id FROM school_license_admins WHERE site_user_id = (SELECT id FROM site_users WHERE email = ?)').all(fx.accounts.school.email);
    assert.deepEqual(sa.map(r => r.purchase_id), [purchase.id], 'the school admin holds only its own workspace school');
    const da = db.prepare('SELECT district_id FROM district_license_admins WHERE site_user_id = (SELECT id FROM site_users WHERE email = ?)').all(fx.accounts.district.email);
    assert.deepEqual(da.map(r => r.district_id), [district.id], 'the district admin holds only its own workspace district');
    const link = db.prepare('SELECT * FROM parent_classroom_links WHERE site_user_id = (SELECT id FROM site_users WHERE email = ?)').all(fx.accounts.parent.email);
    assert.equal(link.length, 1);
    assert.equal(link[0].classroom_id, room.id, 'the parent is linked to this workspace\'s classroom only');
  }
  // no two workspaces share a join code, and no student login works yet
  const codes = db.prepare('SELECT join_code FROM classrooms').all().map(r => r.join_code);
  assert.equal(new Set(codes).size, 2);
  assert.ok(kinds(report).includes('create'));
});

test('SEED: nobody can sign in to a new workspace until an invitation gives it a password (every login has a random one nobody knows)', async () => {
  const { db, conn } = buildDb();
  await seedPool(conn, 2);
  const hashes = db.prepare('SELECT password_hash FROM site_users').all().map(r => r.password_hash);
  assert.equal(new Set(hashes).size, hashes.length, 'every login has its own random password');
  const guesses = ['', 'password', 'demo-shared-test-password-1', F.ACCOUNTS.teacher.email, 'demo-teacher-01@public-demo.example.com'];
  for (const h of hashes) for (const g of guesses) assert.ok(!(await bcrypt.compare(g, h)));
  for (const s of db.prepare('SELECT password_hash FROM classroom_students').all()) for (const g of ['123456', '000000', '482915']) assert.ok(!(await bcrypt.compare(g, s.password_hash)));
});

test('SEED: running it again changes nothing, and a bigger count only adds the new workspaces (nobody is signed out, no password changes)', async () => {
  const { db, conn, count } = buildDb();
  await seedPool(conn, 2);
  const tables = ['site_users', 'classroom_students', 'classroom_assignments', 'license_seats', 'school_license_admins', 'district_license_admins', 'parent_classroom_links', 'purchases', 'districts', 'schools', 'classrooms', 'public_demo_workspaces'];
  const snapshot = () => tables.map(t => count(`SELECT COUNT(*) AS n FROM ${t}`));
  const before = snapshot();
  const hashes = db.prepare('SELECT id, password_hash, session_invalidated_at FROM site_users ORDER BY id').all();
  const codes = db.prepare('SELECT join_code FROM classrooms ORDER BY id').all();
  const again = await seedPool(conn, 2);
  assert.ok(!kinds(again.report).includes('create') && !kinds(again.report).includes('update'), 'only reuse and note lines: ' + JSON.stringify(again.report.lines.filter(l => l[0].trim() === 'create' || l[0].trim() === 'update')));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(db.prepare('SELECT id, password_hash, session_invalidated_at FROM site_users ORDER BY id').all(), hashes);

  await seedPool(conn, 3);
  assert.equal(count('SELECT COUNT(*) AS n FROM public_demo_workspaces'), 3);
  assert.equal(count('SELECT COUNT(*) AS n FROM site_users'), 12);
  assert.deepEqual(db.prepare('SELECT id, password_hash, session_invalidated_at FROM site_users ORDER BY id LIMIT 8').all(), hashes, 'workspaces 1 and 2 are exactly as they were');
  assert.deepEqual(db.prepare('SELECT join_code FROM classrooms ORDER BY id LIMIT 2').all(), codes);
});

test('SEED: workspaces and the original demo live side by side, and neither is changed by the other', async () => {
  const { db, conn, count } = buildDb();
  const legacy = await seedLegacy(conn);
  const legacyBefore = db.prepare('SELECT id, email, password_hash, demo_workspace_id FROM site_users ORDER BY id').all();
  assert.ok(legacyBefore.every(u => u.demo_workspace_id === null), 'the original demo logins belong to no workspace');
  await seedPool(conn, 3);
  assert.deepEqual(db.prepare('SELECT id, email, password_hash, demo_workspace_id FROM site_users ORDER BY id LIMIT 4').all(), legacyBefore);
  assert.equal(count('SELECT COUNT(*) AS n FROM site_users'), 16);
  assert.equal(count('SELECT COUNT(*) AS n FROM districts'), 4);
  assert.equal(count('SELECT COUNT(*) AS n FROM classroom_students'), 12);
  assert.equal(count('SELECT COUNT(*) AS n FROM site_users WHERE demo_workspace_id IS NULL'), 4);
  assert.equal(db.prepare("SELECT district_id FROM public_demo_workspaces WHERE id = 1").get().district_id !== legacy.districtId, true);
  // the original demo's own re-run is unaffected by the workspaces (and sets no workspace on its logins)
  const rerun = await seedLib.seed(conn, { password: 'demo-shared-test-password-1', pin: '482915', rounds: 4 }, seedLib.makeReport());
  assert.ok(rerun.ids.teacher === legacy.ids.teacher);
  assert.equal(count('SELECT COUNT(*) AS n FROM site_users WHERE demo_workspace_id IS NULL'), 4);
});

test('SEED: refuses to take over a real account that has a workspace login\'s address', async () => {
  const { db, conn } = buildDb();
  db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('demo-teacher-02@public-demo.example.com', 'Real', 'Person', 'teacher', 'x')").run();
  await assert.rejects(seedPool(conn, 2), /not a shared demo account/);
});

test('SEED SCRIPT: the dry run is the default, the count is limited to the pool, and nothing else is accepted', () => {
  assert.deepEqual(seedArgs([]), { apply: false, count: 10 });
  assert.deepEqual(seedArgs(['--apply', '--count', '25']), { apply: true, count: 25 });
  for (const bad of [['--count', '0'], ['--count', '41'], ['--count', 'x'], ['--count', '2.5'], ['--password', 'x'], ['--workspace', '3']]) assert.throws(() => seedArgs(bad), bad.join(' '));
  assert.deepEqual(resetArgs(['--workspace', '7']), { apply: false, workspace: 7, all: false });
  assert.deepEqual(resetArgs(['--all', '--apply']), { apply: true, workspace: null, all: true });
  for (const bad of [[], ['--all', '--workspace', '2'], ['--workspace', '0'], ['--workspace', '41'], ['--workspace', 'x'], ['--force']]) assert.throws(() => resetArgs(bad), bad.join(' ') || '(nothing)');
});

// ============================================================================================================================================
// The reset
// ============================================================================================================================================

// Two workspaces, each left in a mess by a group of visitors.
async function twoMessyWorkspaces() {
  const t = buildDb();
  const { db, conn } = t;
  const { out } = await seedPool(conn, 2);
  // a PIN the group was given: workspace 1's shared student has a known PIN
  db.prepare("UPDATE classroom_students SET password_hash = ? WHERE username = 'demo-student-01'").run(bcrypt.hashSync('246810', 4));
  const mess = {};
  for (const [i, o] of out.entries()) {
    const n = i + 1, tag = `0${n}`;
    const ids = o.ids;
    const room2 = Number(db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES (?, ?, ?)").run(`Visitor class ${n}`, ids.teacher, `VISIT00${n}`).lastInsertRowid);
    const kid = Number(db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Visitor Kid', ?, 'x')").run(room2, `visitor-kid-${n}`).lastInsertRowid);
    db.prepare("INSERT INTO student_reflections (student_id, body) VALUES (?, 'private')").run(kid);
    const fakeTeacher = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES (?, 'T', 'Two', 'teacher', 'x')").run(`teacher2-${n}@example.com`).lastInsertRowid);
    db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id) VALUES (?, ?, 'registered', ?)").run(o.purchaseId, `teacher2-${n}@example.com`, fakeTeacher);
    const fakeAdmin = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES (?, 'A', 'Two', 'school_license_admin', 'x')").run(`admin2-${n}@example.com`).lastInsertRowid);
    db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level) VALUES (?, ?, ?)').run(fakeAdmin, o.purchaseId, 'primary');
    db.prepare("INSERT INTO school_branding (school_id, draft_primary_color) VALUES (?, '#ff0000')").run(o.schoolId);
    db.prepare("INSERT INTO district_branding (district_id, draft_primary_color) VALUES (?, '#00ff00')").run(o.districtId);
    db.prepare("INSERT INTO standards_frameworks (district_id, name) VALUES (?, 'Visitor framework')").run(o.districtId);
    db.prepare('INSERT INTO lesson_favorites VALUES (?, 1)').run(ids.teacher);
    db.prepare("INSERT INTO site_user_tokens (user_id, token, type, expires_at) VALUES (?, ?, 'reset', '2999-01-01')").run(ids.school, `tok${n}`);
    mess[n] = { o, room2, kid, fakeTeacher, fakeAdmin, tag };
  }
  return { ...t, out, mess };
}

test('RESET: resetting one workspace clears that group\'s work and leaves the other workspace exactly as it was', async () => {
  const m = await twoMessyWorkspaces();
  const { db, conn, count, out, mess } = m;
  const w1 = out[0], w2 = out[1];
  const snap = (o, n) => ({
    classrooms: db.prepare('SELECT id, name, join_code FROM classrooms WHERE teacher_site_user_id = ? ORDER BY id').all(o.ids.teacher),
    students: db.prepare('SELECT s.id, s.username FROM classroom_students s JOIN classrooms c ON c.id = s.classroom_id WHERE c.teacher_site_user_id = ? ORDER BY s.id').all(o.ids.teacher),
    seats: count('SELECT COUNT(*) AS n FROM license_seats WHERE purchase_id = ?', o.purchaseId),
    admins: count('SELECT COUNT(*) AS n FROM school_license_admins WHERE purchase_id = ?', o.purchaseId),
    sb: count('SELECT COUNT(*) AS n FROM school_branding WHERE school_id = ?', o.schoolId),
    db_: count('SELECT COUNT(*) AS n FROM district_branding WHERE district_id = ?', o.districtId),
    fw: count('SELECT COUNT(*) AS n FROM standards_frameworks WHERE district_id = ?', o.districtId),
    fav: count('SELECT COUNT(*) AS n FROM lesson_favorites WHERE site_user_id = ?', o.ids.teacher),
    tok: count('SELECT COUNT(*) AS n FROM site_user_tokens WHERE user_id = ?', o.ids.school),
    fake: count('SELECT COUNT(*) AS n FROM site_users WHERE email LIKE ?', `%2-${n}@example.com`),
  });
  const before1 = snap(w1, 1), before2 = snap(w2, 2);
  assert.equal(before1.classrooms.length, 2); assert.equal(before1.seats, 2); assert.equal(before1.admins, 2);
  const w2Accounts = db.prepare('SELECT id, password_hash, demo_workspace_id, session_invalidated_at FROM site_users WHERE demo_workspace_id = 2 ORDER BY id').all();

  const report = await resetWorkspaces(conn, [1], { rounds: 4 });
  assert.ok(report.lines.some(l => /cleared 2 classroom/.test(l[1])));

  // workspace 1 is clean
  const after1 = snap(w1, 1);
  assert.equal(after1.classrooms.length, 1);
  assert.equal(after1.classrooms[0].join_code, before1.classrooms[0].join_code, 'the seeded classroom keeps its join code');
  assert.notEqual(after1.classrooms[0].id, before1.classrooms[0].id, 'and is rebuilt');
  assert.deepEqual(after1.students.map(s => s.username), ['demo-student-01', 'demo-student-01-b', 'demo-student-01-c'], 'visitors\' students are gone');
  assert.equal(count('SELECT COUNT(*) AS n FROM student_reflections WHERE student_id = ?', mess[1].kid), 0);
  assert.deepEqual([after1.seats, after1.admins, after1.sb, after1.db_, after1.fw, after1.fav, after1.tok, after1.fake], [1, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(count("SELECT COUNT(*) AS n FROM site_users WHERE email = 'teacher2-1@example.com' OR email = 'admin2-1@example.com'"), 0, 'the fake accounts its invitations made are removed');
  assert.ok(await bcrypt.compare('246810', db.prepare("SELECT password_hash FROM classroom_students WHERE username = 'demo-student-01'").get().password_hash), 'the PIN the group was given still works');
  assert.equal(db.prepare('SELECT student_id FROM parent_classroom_links WHERE site_user_id = ?').get(w1.ids.parent).student_id, db.prepare("SELECT id FROM classroom_students WHERE username = 'demo-student-01'").get().id);
  assert.ok(db.prepare('SELECT last_reset_at FROM public_demo_workspaces WHERE id = 1').get().last_reset_at, 'the reset time is recorded');

  // workspace 2 was not touched at all
  assert.deepEqual(snap(w2, 2), before2);
  assert.equal(db.prepare('SELECT last_reset_at FROM public_demo_workspaces WHERE id = 2').get().last_reset_at, null);
  assert.deepEqual(db.prepare('SELECT id, password_hash, demo_workspace_id, session_invalidated_at FROM site_users WHERE demo_workspace_id = 2 ORDER BY id').all(), w2Accounts);
  assert.equal(count('SELECT COUNT(*) AS n FROM classrooms WHERE name = ?', 'Visitor class 2'), 1, 'group 2\'s own classroom is still there');
  assert.equal(count('SELECT COUNT(*) AS n FROM classroom_students WHERE username = ?', 'visitor-kid-2'), 1);
});

test('RESET: it works on every workspace in turn, and a second reset leaves nothing more to clear', async () => {
  const m = await twoMessyWorkspaces();
  const { conn, count } = m;
  await resetWorkspaces(conn, [1, 2], { rounds: 4 });
  assert.equal(count('SELECT COUNT(*) AS n FROM classrooms'), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM student_reflections'), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM site_users WHERE email LIKE '%@example.com' AND is_shared_demo = 0"), 0);
  const second = await resetWorkspaces(conn, [1, 2], { rounds: 4 });
  assert.ok(!second.lines.some(l => /^cleared (?!1 classroom)/.test(l[1]) && !/classroom/.test(l[1]) && !/workspace record time/.test(l[1])), JSON.stringify(second.lines));
  assert.equal(count('SELECT COUNT(*) AS n FROM classrooms'), 2);
});

test('RESET: a workspace that was never seeded is refused with a message, and the original demo\'s reset still works beside the workspaces', async () => {
  const { db, conn, count } = buildDb();
  await assert.rejects(resetWorkspaces(conn, [5], { rounds: 4 }), /Demo workspace 5 has not been seeded yet/);
  const legacy = await seedLegacy(conn);
  await seedLib.putSettingRaw(conn, 'public_demo_pin', '482915');
  await seedPool(conn, 2);
  db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('My own class', ?, 'VISITOR1')").run(legacy.ids.teacher);
  db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('Group 1 class', (SELECT id FROM site_users WHERE email = 'demo-teacher-01@public-demo.example.com'), 'GROUP001')").run();
  await resetDemo(conn, { rounds: 4 }); // the original demo
  assert.equal(count('SELECT COUNT(*) AS n FROM classrooms WHERE teacher_site_user_id = ?', legacy.ids.teacher), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM classrooms WHERE join_code = 'GROUP001'"), 1, 'resetting the original demo never touches a workspace');
  await resetWorkspaces(conn, [1], { rounds: 4 });
  assert.equal(count("SELECT COUNT(*) AS n FROM classrooms WHERE join_code = 'GROUP001'"), 0);
  assert.ok(await bcrypt.compare('482915', db.prepare("SELECT password_hash FROM classroom_students WHERE username = 'demo-student'").get().password_hash), 'the original demo PIN is unchanged');
});

// ============================================================================================================================================
// The real routes: one workspace's logins cannot reach another workspace, the original demo, a salesperson's demo or a real school
// ============================================================================================================================================

const world = buildDb();
const stubs = { [path.join(SERVER, 'db/pool.js')]: { query: world.run } };
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/school-admin', require(path.join(SERVER, 'routes/school-admin.js')));
app.use('/api/district-admin', require(path.join(SERVER, 'routes/district-admin.js')));
app.use('/api/classrooms', require(path.join(SERVER, 'routes/classrooms.js')));
app.use((err, req, res, next) => { if (process.env.DEBUG_DEMO_TEST) console.error(err); res.status(500).json({ error: String(err.message) }); });
// The stub stays installed: modules such as lib/sales-demo.js load the database pool when they are first used, not when they are required.

let server, port;
const fx = {};
test.before(async () => {
  server = app.listen(0); port = server.address().port;
  const { db, conn } = world;
  const legacy = await seedLegacy(conn);
  const { out } = await seedPool(conn, 2);
  fx.legacy = legacy; fx.w1 = out[0]; fx.w2 = out[1];
  // a salesperson's demo (the district, school and purchase the salesperson seed makes) and a real school and district
  const mk = (name, domain, source) => {
    const district = Number(db.prepare('INSERT INTO districts (name) VALUES (?)').run(name).lastInsertRowid);
    const school = Number(db.prepare('INSERT INTO schools (domain, district_id, display_name) VALUES (?, ?, ?)').run(domain, district, name).lastInsertRowid);
    const purchase = Number(db.prepare("INSERT INTO purchases (product_type, seat_count, source, payment_status, school_domain, school_id) VALUES ('group_license', 25, ?, 'paid', ?, ?)").run(source, domain, school).lastInsertRowid);
    return { district, school, purchase };
  };
  fx.sales = mk('FNE Sales Demo District', 'sales-demo.example.com', 'Sales Demo');
  fx.real = mk('Springfield USD', 'springfield.k12.us', 'Website');
  const user = (email, flags = {}) => Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, role, password_hash, email_verified, is_sales_demo, is_shared_demo, demo_workspace_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .run(email, 'Test', 'Person', 'school_license_admin', 'x', flags.sales ? 1 : 0, flags.shared ? 1 : 0, flags.ws || null).lastInsertRowid);
  fx.user = user;
  fx.salesPerson = user('salesperson@fullsteam.example.com', { sales: true });
  fx.realAdmin = user('principal@springfield.k12.us');
});
test.after(() => server.close());

const cookieFor = (userId) => `fn_user_session=${signSession('site', { userId }, '1h')}`;
function call(method, p, userId, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (userId) headers.Cookie = cookieFor(userId);
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = {}; try { json = b ? JSON.parse(b) : {}; } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const assign = {
  school: (userId, purchaseId) => world.db.prepare("INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)").run(userId, purchaseId),
  district: (userId, districtId) => world.db.prepare('INSERT INTO district_license_admins (site_user_id, district_id, is_active) VALUES (?, ?, 1)').run(userId, districtId),
};
const schoolDomains = (res) => (res.json.schools || []).map(s => s.schoolDomain).sort();
const w1Domain = () => W.workspaceFixtures(1).domain;
const w2Domain = () => W.workspaceFixtures(2).domain;

test('ROUTES, school admin: a workspace\'s school admin sees its own school and nothing else, even if it is wrongly assigned elsewhere', async () => {
  const w1School = fx.w1.ids.school;
  const plain = await call('GET', '/api/school-admin/me', w1School);
  assert.equal(plain.status, 200);
  assert.deepEqual(schoolDomains(plain), [w1Domain()]);

  // every wrong assignment an FNE admin could make by mistake: another workspace, the original demo, a salesperson's demo, a real school
  for (const p of [fx.w2.purchaseId, fx.legacy.purchaseId, fx.sales.purchase, fx.real.purchase]) assign.school(w1School, p);
  const crowded = await call('GET', '/api/school-admin/me', w1School);
  assert.equal(crowded.status, 200);
  assert.deepEqual(schoolDomains(crowded), [w1Domain()], 'still only its own workspace school');

  // asking for another school by id is refused, whichever one it is (its own school is answered by /me above)
  for (const p of [fx.w2.purchaseId, fx.legacy.purchaseId, fx.sales.purchase, fx.real.purchase, 9999]) {
    const r = await call('GET', `/api/school-admin/dashboard?purchaseId=${p}`, w1School);
    assert.equal(r.status, 403, `purchase ${p}`);
  }
});

test('ROUTES, school admin: a login with no assignment to its own demo gets nothing, and every other kind of demo login is just as confined', async () => {
  // a workspace-2 login assigned ONLY to workspace 1's school is refused outright
  const strayW2 = fx.user('stray-w2@public-demo.example.com', { sales: true, shared: true, ws: 2 });
  assign.school(strayW2, fx.w1.purchaseId);
  const a = await call('GET', '/api/school-admin/me', strayW2);
  assert.equal(a.status, 403);
  assert.match(a.json.error, /No active school administrator assignment/);

  // the original shared demo's login assigned to a workspace school
  const strayLegacy = fx.user('stray-legacy@public-demo.example.com', { sales: true, shared: true });
  assign.school(strayLegacy, fx.w1.purchaseId);
  assert.equal((await call('GET', '/api/school-admin/me', strayLegacy)).status, 403);
  assign.school(strayLegacy, fx.legacy.purchaseId);
  assert.deepEqual(schoolDomains(await call('GET', '/api/school-admin/me', strayLegacy)), [F.DEMO_DOMAIN]);

  // a salesperson's demo login assigned to a workspace school or the original demo's school
  assign.school(fx.salesPerson, fx.w1.purchaseId);
  assign.school(fx.salesPerson, fx.legacy.purchaseId);
  assert.equal((await call('GET', '/api/school-admin/me', fx.salesPerson)).status, 403);
  assign.school(fx.salesPerson, fx.sales.purchase);
  assert.deepEqual(schoolDomains(await call('GET', '/api/school-admin/me', fx.salesPerson)), ['sales-demo.example.com']);

  // a workspace login assigned to a salesperson's school and nothing of its own
  const strayToSales = fx.user('stray-sales@public-demo.example.com', { sales: true, shared: true, ws: 1 });
  assign.school(strayToSales, fx.sales.purchase);
  assert.equal((await call('GET', '/api/school-admin/me', strayToSales)).status, 403);

  // an account whose workspace number cannot exist matches no school at all
  const nowhere = fx.user('nowhere@public-demo.example.com', { sales: true, shared: true, ws: 77 });
  assign.school(nowhere, fx.w1.purchaseId);
  assign.school(nowhere, fx.w2.purchaseId);
  assert.equal((await call('GET', '/api/school-admin/me', nowhere)).status, 403);

  // not signed in, or a deleted account
  assert.equal((await call('GET', '/api/school-admin/me', null)).status, 401);
  assert.equal((await call('GET', '/api/school-admin/me', 424242)).status, 403);
});

test('ROUTES, school admin: an ordinary customer\'s school admin is not affected by any of this', async () => {
  assign.school(fx.realAdmin, fx.real.purchase);
  assert.deepEqual(schoolDomains(await call('GET', '/api/school-admin/me', fx.realAdmin)), ['springfield.k12.us']);
});

test('ROUTES, district admin: a workspace\'s district admin sees its own district and its own school, never another\'s', async () => {
  const w1District = fx.w1.ids.district;
  const me = await call('GET', '/api/district-admin/me', w1District);
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.districts.map(d => d.districtName), ['FNE Demo District 01']);
  const schools = await call('GET', '/api/district-admin/schools', w1District);
  assert.deepEqual((schools.json.schools || []).map(s => s.school_domain), [w1Domain()]);
  assert.ok(schools.json.schools[0].admins.some(a => a.email === 'demo-school-01@public-demo.example.com'));
  assert.ok(schools.json.schools[0].admins.every(a => a.purchase_id === fx.w1.purchaseId), 'and only admins assigned to that school');

  for (const d of [fx.w2.districtId, fx.legacy.districtId, fx.sales.district, fx.real.district]) assign.district(w1District, d);
  const crowded = await call('GET', '/api/district-admin/me', w1District);
  assert.deepEqual(crowded.json.districts.map(d => d.districtName), ['FNE Demo District 01'], 'still only its own district');
  const crowdedSchools = await call('GET', '/api/district-admin/schools', w1District);
  assert.deepEqual((crowdedSchools.json.schools || []).map(s => s.school_domain), [w1Domain()]);
});

test('ROUTES, district admin: every other kind of demo login is confined to its own district too', async () => {
  const stray = fx.user('stray-district-w2@public-demo.example.com', { sales: true, shared: true, ws: 2 });
  assign.district(stray, fx.w1.districtId);
  const r = await call('GET', '/api/district-admin/me', stray);
  assert.equal(r.status, 403);
  assert.match(r.json.error, /No active district administrator assignment/);

  const salesDistrict = fx.user('sales-district@fullsteam.example.com', { sales: true });
  assign.district(salesDistrict, fx.w1.districtId); assign.district(salesDistrict, fx.legacy.districtId);
  assert.equal((await call('GET', '/api/district-admin/me', salesDistrict)).status, 403);
  assign.district(salesDistrict, fx.sales.district);
  assert.deepEqual((await call('GET', '/api/district-admin/me', salesDistrict)).json.districts.map(d => d.districtName), ['FNE Sales Demo District']);

  const legacyDistrict = fx.user('legacy-district@public-demo.example.com', { sales: true, shared: true });
  assign.district(legacyDistrict, fx.w2.districtId);
  assert.equal((await call('GET', '/api/district-admin/me', legacyDistrict)).status, 403);

  const real = fx.user('super@springfield.k12.us');
  assign.district(real, fx.real.district);
  assert.deepEqual((await call('GET', '/api/district-admin/me', real)).json.districts.map(d => d.districtName), ['Springfield USD']);
});

test('ROUTES, teacher: another workspace\'s classroom and students are not found (404, never "forbidden"), whatever the ids', async () => {
  const { db } = world;
  const room1 = db.prepare('SELECT id FROM classrooms WHERE teacher_site_user_id = ?').get(fx.w1.ids.teacher).id;
  const room2 = db.prepare('SELECT id FROM classrooms WHERE teacher_site_user_id = ?').get(fx.w2.ids.teacher).id;
  const legacyRoom = db.prepare('SELECT id FROM classrooms WHERE teacher_site_user_id = ?').get(fx.legacy.ids.teacher).id;
  const student1 = db.prepare('SELECT id FROM classroom_students WHERE classroom_id = ? ORDER BY id').get(room1).id;

  // the teacher of workspace 2 asks for workspace 1's classroom and for the original demo's
  for (const id of [room1, legacyRoom]) {
    assert.equal((await call('GET', `/api/classrooms/${id}`, fx.w2.ids.teacher)).status, 404, `classroom ${id}`);
    assert.equal((await call('GET', `/api/classrooms/${id}/students`, fx.w2.ids.teacher)).status, 404);
    assert.equal((await call('PUT', `/api/classrooms/${id}/students/${student1}`, fx.w2.ids.teacher, { displayName: 'Renamed' })).status, 404);
    assert.equal((await call('DELETE', `/api/classrooms/${id}/students/${student1}`, fx.w2.ids.teacher)).status, 404);
    assert.equal((await call('POST', `/api/classrooms/${id}/students/${student1}/invite-parent`, fx.w2.ids.teacher, { email: 'x@example.com' })).status, 404);
  }
  // the student id of workspace 1 used under workspace 2's own classroom is not found either
  assert.equal((await call('PUT', `/api/classrooms/${room2}/students/${student1}`, fx.w2.ids.teacher, { displayName: 'Renamed' })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM classroom_students WHERE id = ?').get(student1).n, 1, 'and nothing was deleted');

  // each teacher's own list holds only its own classroom, and its own classroom opens
  const list2 = await call('GET', '/api/classrooms', fx.w2.ids.teacher);
  assert.equal(list2.status, 200);
  assert.deepEqual((list2.json.classrooms || list2.json).map(c => c.id), [room2]);
  assert.equal((await call('GET', `/api/classrooms/${room2}`, fx.w2.ids.teacher)).status, 200);
  assert.equal((await call('GET', `/api/classrooms/${room1}`, fx.w1.ids.teacher)).status, 200);
});

test('ROUTES, parents: a workspace parent is linked to its own workspace\'s classroom and student only', () => {
  const { db } = world;
  for (const [o, n] of [[fx.w1, 1], [fx.w2, 2]]) {
    const links = db.prepare('SELECT c.teacher_site_user_id AS teacher, s.username FROM parent_classroom_links l JOIN classrooms c ON c.id = l.classroom_id JOIN classroom_students s ON s.id = l.student_id WHERE l.site_user_id = ?').all(o.ids.parent);
    assert.equal(links.length, 1);
    assert.equal(links[0].teacher, o.ids.teacher);
    assert.equal(links[0].username, `demo-student-0${n}`);
  }
});
