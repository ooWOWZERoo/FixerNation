// Shared demo environment, phase 2: the seed script, the nightly reset, and the on/off switch (docs/reference/shared-demo-environment-requirements.md).
// The scripts are written in portable SQL, so these tests run them against a real SQL engine (node:sqlite) with foreign-key cascades switched on.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const SERVER = path.join(__dirname, '..');
const F = require(path.join(SERVER, 'lib/public-demo-fixtures.js'));
const seedLib = require(path.join(SERVER, 'scripts/seed-public-demo.js'));
const { resetDemo } = require(path.join(SERVER, 'scripts/reset-public-demo.js'));
const sw = require(path.join(SERVER, 'scripts/set-public-demo.js'));
const { evaluateDemoWindow } = require(path.join(SERVER, 'lib/public-demo-window.js'));

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, first_name TEXT, last_name TEXT, role TEXT, password_hash TEXT, email_verified INTEGER DEFAULT 0,
  is_sales_demo INTEGER DEFAULT 0, is_shared_demo INTEGER DEFAULT 0, session_invalidated_at TEXT, closed_at TEXT, closed_reason TEXT);
CREATE TABLE site_user_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT, type TEXT, expires_at TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE license_products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, seat_count INTEGER, price_cents INTEGER, call_for_quote INTEGER, variable_seats INTEGER, active INTEGER, sort_order INTEGER);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, source TEXT, status TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, product_type TEXT, license_product_id INTEGER, seat_count INTEGER, source TEXT, payment_method TEXT, payment_status TEXT, school_domain TEXT, school_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, seat_id INTEGER, invited_email TEXT, status TEXT);
CREATE TABLE curricula (id INTEGER PRIMARY KEY AUTOINCREMENT, published INTEGER);
CREATE TABLE classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, teacher_site_user_id INTEGER, join_code TEXT, parent_code TEXT, grade_level TEXT, subject TEXT, academic_year TEXT, archived_at TEXT);
CREATE TABLE classroom_students (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, display_name TEXT, username TEXT UNIQUE, password_hash TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE classroom_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, curriculum_id INTEGER, assigned_by_id INTEGER);
CREATE TABLE student_lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, curriculum_id INTEGER, started_at TEXT, completed_at TEXT);
CREATE TABLE student_reflections (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES classroom_students(id) ON DELETE CASCADE, body TEXT);
CREATE TABLE parent_classroom_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE, student_id INTEGER);
CREATE TABLE school_branding (school_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE district_branding (district_id INTEGER PRIMARY KEY, draft_primary_color TEXT);
CREATE TABLE standards_frameworks (id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER, name TEXT);
CREATE TABLE lesson_favorites (site_user_id INTEGER, curriculum_id INTEGER);
CREATE TABLE teacher_lesson_plans (site_user_id INTEGER, curriculum_id INTEGER);
`); // game_favorites, blog_post_favorites and teacher_lesson_plan_swaps are deliberately missing: a table that does not exist is nothing to clear
  for (let i = 0; i < 5; i++) db.prepare('INSERT INTO curricula (published) VALUES (1)').run();
  db.prepare('INSERT INTO curricula (published) VALUES (0)').run();
  const run = async (sql, rawParams = []) => {
    let i = 0;
    const params = [];
    const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\?/g, () => { params.push(rawParams[i++]); return '?'; });
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const r = db.prepare(s).run(...params);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  };
  return { db, conn: { query: run }, count: (sql, ...p) => db.prepare(sql).get(...p).n };
}

const PASSWORD = 'demo-shared-test-password-1';
const PIN = '482915';
const seedOnce = (conn, o = {}) => seedLib.seed(conn, { password: PASSWORD, pin: PIN, rounds: 4, ...o }, seedLib.makeReport());
const kinds = (report) => report.lines.map(l => l[0].trim());

test('SEED: creates the district, school, licence, four logins, classroom, students, lessons and parent link, all flagged as demo', async () => {
  const { db, conn, count } = freshDb();
  const report = seedLib.makeReport();
  const out = await seedLib.seed(conn, { password: PASSWORD, pin: PIN, rounds: 4 }, report);
  assert.equal(count("SELECT COUNT(*) AS n FROM districts WHERE name = ?", F.PUBLIC_DEMO_DISTRICT_NAME), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM schools WHERE domain = ?", F.DEMO_DOMAIN), 1);
  assert.equal(count("SELECT price_cents + active AS n FROM license_products WHERE name = ?", F.DEMO_PRODUCT_NAME), 0, 'a $0 inactive product');
  assert.equal(db.prepare("SELECT status FROM newsletter_contacts WHERE email = ?").get(F.DEMO_CONTACT_EMAIL).status, 'Unsubscribed');
  const users = db.prepare('SELECT * FROM site_users ORDER BY id').all();
  assert.equal(users.length, 4);
  for (const u of users) { assert.equal(u.is_shared_demo, 1); assert.equal(u.is_sales_demo, 1); assert.equal(u.email_verified, 1); assert.ok(await bcrypt.compare(PASSWORD, u.password_hash)); }
  assert.deepEqual(users.map(u => u.role), ['district_admin', 'school_license_admin', 'teacher', 'parent']);
  assert.ok(users.every(u => u.email.endsWith('@public-demo.example.com')));
  assert.equal(count('SELECT COUNT(*) AS n FROM license_seats WHERE registered_site_user_id = ?', out.ids.teacher), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM school_license_admins WHERE site_user_id = ? AND is_active = 1', out.ids.school), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM district_license_admins WHERE site_user_id = ? AND is_active = 1', out.ids.district), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM classroom_students'), 3);
  const a = db.prepare("SELECT * FROM classroom_students WHERE username = 'demo-student'").get();
  assert.ok(await bcrypt.compare(PIN, a.password_hash), 'the shared PIN signs in demo-student');
  const b = db.prepare("SELECT * FROM classroom_students WHERE username = 'demo-student-2'").get();
  assert.ok(!(await bcrypt.compare(PIN, b.password_hash)), 'the other students do not share the PIN');
  assert.equal(count('SELECT COUNT(*) AS n FROM classroom_assignments'), 3, 'three of the five published lessons (the draft is never assigned)');
  assert.equal(count('SELECT COUNT(*) AS n FROM student_lesson_progress WHERE student_id = ? AND completed_at IS NOT NULL', a.id), 1);
  assert.equal(db.prepare('SELECT student_id FROM parent_classroom_links WHERE site_user_id = ?').get(out.ids.parent).student_id, a.id);
  assert.match(out.classroom.join_code, /^[0-9A-F]{8}$/);
  assert.ok(kinds(report).includes('create'));
});

test('SEED: re-running changes nothing (no new rows, no re-hashed passwords)', async () => {
  const { db, conn, count } = freshDb();
  await seedOnce(conn);
  const hashes = db.prepare('SELECT password_hash FROM site_users ORDER BY id').all().map(r => r.password_hash);
  const rows = ['site_users', 'classroom_students', 'classroom_assignments', 'license_seats', 'school_license_admins', 'district_license_admins', 'parent_classroom_links', 'purchases']
    .map(t => count(`SELECT COUNT(*) AS n FROM ${t}`));
  const report = seedLib.makeReport();
  await seedLib.seed(conn, { password: PASSWORD, pin: PIN, rounds: 4 }, report);
  assert.ok(!kinds(report).includes('create') && !kinds(report).includes('update'), 'only "reuse" and "note" lines: ' + JSON.stringify(report.lines));
  assert.deepEqual(db.prepare('SELECT password_hash FROM site_users ORDER BY id').all().map(r => r.password_hash), hashes);
  assert.deepEqual(['site_users', 'classroom_students', 'classroom_assignments', 'license_seats', 'school_license_admins', 'district_license_admins', 'parent_classroom_links', 'purchases']
    .map(t => count(`SELECT COUNT(*) AS n FROM ${t}`)), rows);
});

test('SEED: a new password or PIN re-hashes the logins and signs everyone out', async () => {
  const { db, conn } = freshDb();
  await seedOnce(conn);
  const report = seedLib.makeReport();
  await seedLib.seed(conn, { password: 'demo-a-different-password-2', pin: '135790', rounds: 4 }, report);
  for (const u of db.prepare('SELECT * FROM site_users').all()) {
    assert.ok(await bcrypt.compare('demo-a-different-password-2', u.password_hash));
    assert.ok(u.session_invalidated_at, 'every other browser is signed out');
  }
  assert.ok(await bcrypt.compare('135790', db.prepare("SELECT password_hash FROM classroom_students WHERE username = 'demo-student'").get().password_hash));
  assert.ok(report.lines.some(l => /student PIN/.test(l[1])));
});

test('SEED: refuses to take over an existing real account or a username in another classroom', async () => {
  let t = freshDb();
  t.db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES (?, 'Real', 'Person', 'teacher', 'x')").run(F.ACCOUNTS.teacher.email);
  await assert.rejects(seedOnce(t.conn), /not a shared demo account/);
  t = freshDb();
  const room = Number(t.db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('Someone else', 99, 'ZZZZZZZZ')").run().lastInsertRowid);
  t.db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Kid', 'demo-student', 'x')").run(room);
  await assert.rejects(seedOnce(t.conn), /another classroom/);
});

test('SEED: the generated password is long, and every word is unique', () => {
  const p = seedLib.generatePassword();
  assert.match(p, /^demo(-[a-z]+){4}$/);
  assert.ok(p.length >= 14);
  assert.equal(new Set(seedLib.WORDS).size, seedLib.WORDS.length);
  assert.match(seedLib.generatePin(), /^\d{6}$/);
});

// A seeded demo, then a day of visitors leaving things behind.
async function messyDemo() {
  const t = freshDb();
  const { db, conn } = t;
  const out = await seedOnce(conn);
  await seedLib.putSettingRaw(conn, 'public_demo_pin', PIN);
  const ids = out.ids;
  const purchaseId = out.purchaseId;
  // visitors: a second classroom with a student who wrote something, plus work by student A
  const room2 = Number(db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('My own class', ?, 'VISITOR1')").run(ids.teacher).lastInsertRowid);
  const kid = Number(db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Visitor Kid', 'visitor-kid', 'x')").run(room2).lastInsertRowid);
  const studentA = db.prepare("SELECT id FROM classroom_students WHERE username = 'demo-student'").get().id;
  db.prepare("INSERT INTO student_reflections (student_id, body) VALUES (?, 'hello')").run(kid);
  db.prepare("INSERT INTO student_reflections (student_id, body) VALUES (?, 'my private thought')").run(studentA);
  db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES ((SELECT id FROM classrooms WHERE name = 'Demo Classroom'), 'Joined By Code', 'joiner', 'x')").run();
  // invitations to fake addresses: a teacher seat, a school administrator, a district administrator
  const fakeTeacher = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('teacher2@example.com', 'T', 'Two', 'teacher', 'x')").run().lastInsertRowid);
  db.prepare("INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('T Two', 'teacher2@example.com', 'School Invitation', 'Subscribed')").run();
  const seat = Number(db.prepare("INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id) VALUES (?, 'teacher2@example.com', 'registered', ?)").run(purchaseId, fakeTeacher).lastInsertRowid);
  db.prepare("INSERT INTO school_invitations (purchase_id, seat_id, invited_email, status) VALUES (?, ?, 'teacher2@example.com', 'pending')").run(purchaseId, seat);
  const fakeAdmin = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('admin2@example.com', 'A', 'Two', 'school_license_admin', 'x')").run().lastInsertRowid);
  db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level) VALUES (?, ?, ?)').run(fakeAdmin, purchaseId, 'primary');
  const fakeDistrict = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('district2@example.com', 'D', 'Two', 'district_admin', 'x')").run().lastInsertRowid);
  db.prepare('INSERT INTO district_license_admins (site_user_id, district_id) VALUES (?, ?)').run(fakeDistrict, out.districtId);
  // an invitee on a REAL-looking address (cannot happen through the demo, but the reset must not delete a real account anyway), and a fake account that is still used elsewhere
  const realish = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('someone@realschool.org', 'R', 'S', 'school_license_admin', 'x')").run().lastInsertRowid);
  db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level) VALUES (?, ?, ?)').run(realish, purchaseId, 'primary');
  const shared = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('shared@example.com', 'S', 'S', 'teacher', 'x')").run().lastInsertRowid);
  db.prepare('INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level) VALUES (?, ?, ?)').run(shared, purchaseId, 'primary');
  db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('Their real class', ?, 'REAL0001')").run(shared);
  // branding, a district framework, favorites, lesson picks, a reset token on the demo accounts
  db.prepare("INSERT INTO school_branding (school_id, draft_primary_color) VALUES (?, '#ff0000')").run(out.schoolId);
  db.prepare("INSERT INTO district_branding (district_id, draft_primary_color) VALUES (?, '#00ff00')").run(out.districtId);
  db.prepare("INSERT INTO standards_frameworks (district_id, name) VALUES (?, 'Visitor framework')").run(out.districtId);
  db.prepare('INSERT INTO lesson_favorites VALUES (?, 1)').run(ids.teacher);
  db.prepare('INSERT INTO teacher_lesson_plans VALUES (?, 2)').run(ids.teacher);
  db.prepare("INSERT INTO site_user_tokens (user_id, token, type, expires_at) VALUES (?, 'tok', 'reset', '2999-01-01')").run(ids.school);
  // a REAL school, district, teacher and student that must never be touched
  const realTeacher = Number(db.prepare("INSERT INTO site_users (email, first_name, last_name, role, password_hash) VALUES ('teacher@realschool.org', 'Real', 'Teacher', 'teacher', 'x')").run().lastInsertRowid);
  const realRoom = Number(db.prepare("INSERT INTO classrooms (name, teacher_site_user_id, join_code) VALUES ('Real Room', ?, 'REALROOM')").run(realTeacher).lastInsertRowid);
  db.prepare("INSERT INTO classroom_students (classroom_id, display_name, username, password_hash) VALUES (?, 'Real Kid', 'real-kid', 'x')").run(realRoom);
  db.prepare("INSERT INTO school_branding (school_id, draft_primary_color) VALUES (999, '#123456')").run();
  db.prepare("INSERT INTO standards_frameworks (district_id, name) VALUES (998, 'Real framework')").run();
  db.prepare('INSERT INTO lesson_favorites VALUES (?, 1)').run(realTeacher);
  return { ...t, out, studentA, kid, fakeTeacher, fakeAdmin, fakeDistrict, realish, shared, realTeacher };
}

test('RESET: clears everything a day of visitors left, rebuilds the seeded classroom, and touches nothing real', async () => {
  const m = await messyDemo();
  const { db, count, conn, out } = m;
  const oldJoin = out.classroom.join_code;
  const hashesBefore = db.prepare('SELECT id, password_hash FROM site_users WHERE is_shared_demo = 1 ORDER BY id').all();
  const report = await resetDemo(conn, { rounds: 4 });

  // the visitors' classrooms and work are gone; the seeded classroom is back, with the same join code and three fresh students
  assert.equal(count("SELECT COUNT(*) AS n FROM classrooms WHERE teacher_site_user_id = ?", out.ids.teacher), 1);
  const room = db.prepare("SELECT * FROM classrooms WHERE teacher_site_user_id = ?").get(out.ids.teacher);
  assert.equal(room.join_code, oldJoin);
  assert.deepEqual(db.prepare('SELECT username FROM classroom_students WHERE classroom_id = ? ORDER BY username').all(room.id).map(r => r.username), ['demo-student', 'demo-student-2', 'demo-student-3']);
  assert.equal(count('SELECT COUNT(*) AS n FROM student_reflections'), 0, 'every reflection a visitor wrote is gone');
  const a = db.prepare("SELECT * FROM classroom_students WHERE username = 'demo-student'").get();
  assert.ok(await bcrypt.compare(PIN, a.password_hash), 'the shared PIN still works');
  assert.equal(count('SELECT COUNT(*) AS n FROM student_lesson_progress WHERE student_id = ? AND completed_at IS NOT NULL', a.id), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM classroom_assignments WHERE classroom_id = ?', room.id), 3);
  assert.equal(db.prepare('SELECT student_id FROM parent_classroom_links WHERE site_user_id = ?').get(out.ids.parent).student_id, a.id);

  // invitations, seats, extra administrators and the fake accounts they made
  assert.equal(count('SELECT COUNT(*) AS n FROM school_invitations'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM license_seats'), 1, 'only the demo teacher keeps a seat');
  assert.deepEqual(db.prepare('SELECT site_user_id FROM school_license_admins').all().map(r => r.site_user_id), [out.ids.school]);
  assert.deepEqual(db.prepare('SELECT site_user_id FROM district_license_admins').all().map(r => r.site_user_id), [out.ids.district]);
  assert.equal(count("SELECT COUNT(*) AS n FROM site_users WHERE email IN ('teacher2@example.com', 'admin2@example.com', 'district2@example.com')"), 0, 'fake accounts that nothing else uses are removed');
  assert.equal(count("SELECT COUNT(*) AS n FROM newsletter_contacts WHERE email = 'teacher2@example.com'"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM site_users WHERE email = 'someone@realschool.org'"), 1, 'an account on a real address is never deleted, only its demo assignment');
  assert.equal(count("SELECT COUNT(*) AS n FROM site_users WHERE email = 'shared@example.com'"), 1, 'a fake account that still owns a classroom is left alone');
  assert.ok(report.lines.some(l => /left fake account shared@example\.com/.test(l[1])));

  // branding, frameworks, favorites, picks, tokens
  assert.equal(count('SELECT COUNT(*) AS n FROM school_branding WHERE school_id = ?', out.schoolId), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM district_branding WHERE district_id = ?', out.districtId), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM standards_frameworks WHERE district_id = ?', out.districtId), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM lesson_favorites WHERE site_user_id = ?', out.ids.teacher), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM teacher_lesson_plans WHERE site_user_id = ?', out.ids.teacher), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM site_user_tokens"), 0);

  // the four demo logins themselves are untouched (same ids, same hashes), and nothing real changed
  assert.deepEqual(db.prepare('SELECT id, password_hash FROM site_users WHERE is_shared_demo = 1 ORDER BY id').all(), hashesBefore);
  assert.equal(count("SELECT COUNT(*) AS n FROM classrooms WHERE name = 'Real Room'"), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM classroom_students WHERE username = 'real-kid'"), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM school_branding WHERE school_id = 999'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM standards_frameworks WHERE district_id = 998'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM lesson_favorites WHERE site_user_id = ?', m.realTeacher), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM classrooms WHERE name = 'Their real class'"), 1);
});

test('RESET: running it twice in a row is harmless', async () => {
  const m = await messyDemo();
  await resetDemo(m.conn, { rounds: 4 });
  const snapshot = () => ['site_users', 'classrooms', 'classroom_students', 'classroom_assignments', 'license_seats', 'school_license_admins', 'district_license_admins']
    .map(t => m.count(`SELECT COUNT(*) AS n FROM ${t}`));
  const before = snapshot();
  await resetDemo(m.conn, { rounds: 4 });
  assert.deepEqual(snapshot(), before);
});

test('RESET: refuses to run before the demo is seeded or without a stored PIN', async () => {
  const empty = freshDb();
  await assert.rejects(resetDemo(empty.conn, { rounds: 4 }), /has not been seeded/);
  const t = freshDb();
  await seedOnce(t.conn);
  await assert.rejects(resetDemo(t.conn, { rounds: 4 }), /No demo PIN is stored/);
});

test('SWITCH: turning on needs an end time inside the longest window, in the future, with a time zone', async () => {
  const { conn } = freshDb();
  await seedOnce(conn);
  await seedLib.putSettingRaw(conn, 'public_demo_pin', PIN);
  const now = new Date('2026-11-20T12:00:00Z');
  const on = (o) => sw.turnOn(conn, { now, rounds: 4, ...o });
  await assert.rejects(on({}), /needs an end time/);
  await assert.rejects(on({ days: 0 }), /above 0/);
  await assert.rejects(on({ days: 31 }), /longest demo window is 30 days/);
  await assert.rejects(on({ until: '2026-11-25T17:00:00' }), /needs a time zone/);
  await assert.rejects(on({ until: '2026-11-19T17:00:00Z' }), /already in the past/);
  await assert.rejects(on({ until: 'banana-05:00' }), /not a valid date/);
  assert.equal((await sw.describe(conn, now)).open, false, 'a refused request changes nothing');
  await seedLib.putSettingRaw(conn, 'public_demo_max_days', '60');
  const r = await on({ days: 45 });
  assert.equal(r.endsAt.toISOString(), '2027-01-04T12:00:00.000Z', 'the longest window is a setting');
});

test('SWITCH: on, then off, then left on past its date', async () => {
  const { conn } = freshDb();
  await seedOnce(conn);
  await seedLib.putSettingRaw(conn, 'public_demo_pin', PIN);
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal((await sw.describe(conn, now)).open, false);
  const { endsAt } = await sw.turnOn(conn, { days: 14, now, rounds: 4 });
  assert.equal(endsAt.toISOString(), '2026-12-04T12:00:00.000Z');
  const code = await seedLib.getSettingRaw(conn, 'public_demo_access_code');
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/, 'turning the demo on makes sure an access code exists');
  await sw.turnOn(conn, { days: 3, now, rounds: 4, reset: false });
  assert.equal(await seedLib.getSettingRaw(conn, 'public_demo_access_code'), code, 'moving the end date keeps the same code');
  const on = await sw.describe(conn, now);
  assert.equal(on.open, true);
  assert.match(on.text, /ON until .*EST/);
  assert.equal((await sw.describe(conn, new Date('2026-12-04T12:00:01Z'))).reason, 'expired', 'a switch left on past its date is off');
  await sw.turnOff(conn);
  assert.equal((await sw.describe(conn, now)).open, false);
  assert.equal(await seedLib.getSettingRaw(conn, 'public_demo_ends_at'), '');
  const until = await sw.turnOn(conn, { until: '2026-11-21T17:00:00-05:00', now, rounds: 4 });
  assert.equal(until.endsAt.toISOString(), '2026-11-21T22:00:00.000Z');
});

test('SWITCH: refuses to turn on a demo that was never seeded, and turning on clears the previous window\'s leftovers', async () => {
  const empty = freshDb();
  await assert.rejects(sw.turnOn(empty.conn, { days: 7, rounds: 4 }), /has not been set up/);
  const m = await messyDemo();
  await sw.turnOn(m.conn, { days: 7, rounds: 4 });
  assert.equal(m.count('SELECT COUNT(*) AS n FROM student_reflections'), 0, 'each window starts clean');
  const skip = await messyDemo();
  await sw.turnOn(skip.conn, { days: 7, rounds: 4, reset: false });
  assert.equal(skip.count('SELECT COUNT(*) AS n FROM student_reflections'), 2, '--no-reset leaves the data alone');
});

test('SWITCH: the scripts use the very same open/closed rule as the server', () => {
  assert.equal(require(path.join(SERVER, 'lib/public-demo.js')).evaluateDemoWindow, evaluateDemoWindow);
});

test('CRON: the nightly reset is in setup-cron-jobs.sh', () => {
  const src = fs.readFileSync(path.join(SERVER, 'scripts/setup-cron-jobs.sh'), 'utf8');
  assert.match(src, /10 3 \* \* \* \$NODE \$SCRIPTS\/reset-public-demo\.js --apply/);
});

test('NOTHING real is named by the scripts: every demo fixture lives under example.com', () => {
  assert.ok(F.DEMO_DOMAIN.endsWith('.example.com'));
  assert.ok(F.DEMO_CONTACT_EMAIL.endsWith('@example.com'));
  for (const a of Object.values(F.ACCOUNTS)) assert.ok(a.email.endsWith('@' + F.DEMO_DOMAIN));
});
