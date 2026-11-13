require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { legacyFixtures } = require('../lib/public-demo-workspaces');
const { evaluateDemoWindow } = require('../lib/public-demo-window');
const { seedClassroom, makeReport, getSettingRaw } = require('./seed-public-demo');

// Puts the SHARED DEMO ENVIRONMENT back to the state seed-public-demo.js made (docs/reference/shared-demo-environment-requirements.md, R7).
// Visitors share the demo, so what one person adds the next person sees; this clears it. Run nightly by cron while the demo is open (about 3:10 a.m.),
// once whenever the demo is switched on (scripts/set-public-demo.js), and by hand.
//
//   node scripts/reset-public-demo.js
//       DRY RUN (default): does everything inside a transaction, reports what it would clear, then ROLLS BACK.
//   node scripts/reset-public-demo.js --apply
//       Does it. Without --force it does nothing while the demo is closed (nothing changes while the logins are refused, so there is nothing to clear).
//   ... --force
//       Reset even though the demo is closed (for example after a long closed spell, or to test it).
//
// What it touches, and only this: the demo teacher's classrooms (deleted, then the seeded one rebuilt with the same join code; deleting a classroom
// removes its students and everything they did), invitations and extra licence seats on the demo purchase, school and district administrator
// assignments other than the two demo logins, demo school and district branding, district frameworks recorded under the demo district, and the four
// logins' own favorites, lesson plan picks and password-reset tokens. Fake example.com accounts that an invitation made are removed too, but only
// when nothing else points at them. It never touches any row that belongs to a real school, district, teacher or student.

const isExampleDomain = (email) => /@([a-z0-9-]+\.)*example\.com$/i.test(String(email || '').trim());
const isMissingTable = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(String(err.message)));

async function one(conn, sql, params) { const [rows] = await conn.query(sql, params); return rows[0] || null; }
async function many(conn, sql, params) { const [rows] = await conn.query(sql, params); return rows; }
const marks = (arr) => arr.map(() => '?').join(', ');

// A table that does not exist on this install (an older database, or a test) is simply nothing to clear.
async function clear(conn, report, label, sql, params) {
  try {
    const [r] = await conn.query(sql, params);
    if (r && r.affectedRows) report.updated(`cleared ${r.affectedRows} ${label}`);
    return r && r.affectedRows ? r.affectedRows : 0;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

// Removes accounts that an invitation created for a fake address, if (and only if) nothing else points at them.
async function purgeFakeAccounts(conn, report, candidateIds) {
  for (const id of [...new Set(candidateIds)]) {
    const u = await one(conn, 'SELECT id, email, is_shared_demo, is_sales_demo FROM site_users WHERE id = ?', [id]);
    if (!u || u.is_shared_demo || u.is_sales_demo || !isExampleDomain(u.email)) continue;
    const refs = [
      ['SELECT 1 AS x FROM license_seats WHERE registered_site_user_id = ?', [id]],
      ['SELECT 1 AS x FROM school_license_admins WHERE site_user_id = ?', [id]],
      ['SELECT 1 AS x FROM district_license_admins WHERE site_user_id = ?', [id]],
      ['SELECT 1 AS x FROM classrooms WHERE teacher_site_user_id = ?', [id]],
      ['SELECT 1 AS x FROM parent_classroom_links WHERE site_user_id = ?', [id]],
    ];
    let held = false;
    for (const [sql, params] of refs) { if (await one(conn, sql, params)) { held = true; break; } }
    if (held) { report.note(`left fake account ${u.email} in place (something else still uses it)`); continue; }
    try {
      await conn.query('DELETE FROM site_user_tokens WHERE user_id = ?', [id]);
      const contact = await one(conn, 'SELECT id FROM newsletter_contacts WHERE email = ?', [u.email]);
      if (contact && !(await one(conn, 'SELECT id FROM purchases WHERE contact_id = ?', [contact.id]))) {
        await conn.query('DELETE FROM newsletter_contacts WHERE id = ?', [contact.id]);
      }
      await conn.query('DELETE FROM site_users WHERE id = ?', [id]);
      report.updated(`removed fake account ${u.email}`);
    } catch (err) {
      report.note(`left fake account ${u.email} in place (${err.code || err.message})`);
    }
  }
}

// Puts one demo back to the state the seed made: the original single demo (no `fx`) or one workspace (`fx = workspaceFixtures(n)`). Everything it
// touches is found through that demo's own district, school, purchase and logins, so resetting one workspace cannot touch another.
// `newCodes` gives the rebuilt classroom a new join code and parent code (a workspace changing hands must not keep the codes the last group knew).
async function resetDemo(conn, { rounds = 10, fx = legacyFixtures(), newCodes = false } = {}, report = makeReport()) {
  const workspace = fx.number;
  const seedHint = workspace === null ? 'scripts/seed-public-demo.js --apply' : 'scripts/seed-demo-workspaces.js --apply';
  const district = await one(conn, 'SELECT id FROM districts WHERE name = ?', [fx.districtName]);
  const school = await one(conn, 'SELECT id FROM schools WHERE domain = ?', [fx.domain]);
  const purchase = school && await one(conn, "SELECT id FROM purchases WHERE school_domain = ? AND product_type = 'group_license'", [fx.domain]);
  const ids = {};
  for (const key of Object.keys(fx.accounts)) {
    const u = await one(conn, 'SELECT id, is_shared_demo FROM site_users WHERE email = ?', [fx.accounts[key].email]);
    if (u && u.is_shared_demo) ids[key] = u.id;
  }
  if (!district || !school || !purchase || Object.keys(ids).length !== Object.keys(fx.accounts).length) {
    throw new Error(`${workspace === null ? 'The shared demo has' : `Demo workspace ${fx.number} has`} not been seeded yet. Run ${seedHint} first.`);
  }
  // The shared student's PIN. The original demo keeps it in a setting; a workspace keeps it only on the student, so a reset hands back the hash it
  // finds (the PIN the group was given keeps working).
  let pin = null, pinHash = null;
  if (workspace === null) {
    pin = await getSettingRaw(conn, 'public_demo_pin');
    if (!pin) throw new Error('No demo PIN is stored (setting public_demo_pin). Run scripts/seed-public-demo.js --apply first.');
  } else {
    const shared = fx.students.find(st => st.shared);
    const found = shared && await one(conn, 'SELECT password_hash FROM classroom_students WHERE username = ?', [shared.username]);
    pinHash = found ? found.password_hash : null;
  }

  // 1. The classroom: keep its codes, delete every classroom the demo teacher owns (this removes the students and all their work), rebuild it.
  const old = await one(conn, 'SELECT join_code, parent_code FROM classrooms WHERE teacher_site_user_id = ? AND name = ? ORDER BY id', [ids.teacher, fx.classroomName]);
  const rooms = await many(conn, 'SELECT id FROM classrooms WHERE teacher_site_user_id = ?', [ids.teacher]);
  if (rooms.length) {
    await conn.query('DELETE FROM classrooms WHERE teacher_site_user_id = ?', [ids.teacher]);
    report.updated(`cleared ${rooms.length} classroom(s) with their students, lessons, parent links and work`);
  }
  await seedClassroom(conn, { teacherId: ids.teacher, parentId: ids.parent, pin, pinHash, rounds, codes: newCodes ? null : old, fx }, report);

  // 2. Invitations, extra licence seats and extra administrators (and the fake accounts they created).
  const fake = [];
  await clear(conn, report, 'teacher invitation(s)', 'DELETE FROM school_invitations WHERE purchase_id = ?', [purchase.id]);
  const seats = await many(conn, 'SELECT id, registered_site_user_id FROM license_seats WHERE purchase_id = ? AND (registered_site_user_id IS NULL OR registered_site_user_id <> ?)', [purchase.id, ids.teacher]);
  if (seats.length) {
    seats.forEach(s => s.registered_site_user_id && fake.push(s.registered_site_user_id));
    await conn.query(`DELETE FROM license_seats WHERE id IN (${marks(seats)})`, seats.map(s => s.id));
    report.updated(`cleared ${seats.length} extra licence seat(s)`);
  }
  const schoolAdmins = await many(conn, 'SELECT id, site_user_id FROM school_license_admins WHERE purchase_id = ? AND site_user_id <> ?', [purchase.id, ids.school]);
  if (schoolAdmins.length) {
    schoolAdmins.forEach(a => fake.push(a.site_user_id));
    await conn.query(`DELETE FROM school_license_admins WHERE id IN (${marks(schoolAdmins)})`, schoolAdmins.map(a => a.id));
    report.updated(`cleared ${schoolAdmins.length} extra school administrator assignment(s)`);
  }
  const districtAdmins = await many(conn, 'SELECT id, site_user_id FROM district_license_admins WHERE district_id = ? AND site_user_id <> ?', [district.id, ids.district]);
  if (districtAdmins.length) {
    districtAdmins.forEach(a => fake.push(a.site_user_id));
    await conn.query(`DELETE FROM district_license_admins WHERE id IN (${marks(districtAdmins)})`, districtAdmins.map(a => a.id));
    report.updated(`cleared ${districtAdmins.length} extra district administrator assignment(s)`);
  }
  await purgeFakeAccounts(conn, report, fake);

  // 3. Branding and district frameworks recorded under the demo school and district.
  await clear(conn, report, 'school branding setting(s)', 'DELETE FROM school_branding WHERE school_id = ?', [school.id]);
  await clear(conn, report, 'district branding setting(s)', 'DELETE FROM district_branding WHERE district_id = ?', [district.id]);
  await clear(conn, report, 'district framework(s)', 'DELETE FROM standards_frameworks WHERE district_id = ?', [district.id]);

  // 4. The four logins' own leftovers.
  const mine = Object.values(ids);
  for (const [label, table] of [['lesson favorite(s)', 'lesson_favorites'], ['game favorite(s)', 'game_favorites'], ['blog favorite(s)', 'blog_post_favorites'],
    ['lesson plan pick(s)', 'teacher_lesson_plans'], ['lesson plan swap record(s)', 'teacher_lesson_plan_swaps']]) {
    await clear(conn, report, label, `DELETE FROM ${table} WHERE site_user_id IN (${marks(mine)})`, mine);
  }
  await clear(conn, report, 'password-reset token(s)', `DELETE FROM site_user_tokens WHERE user_id IN (${marks(mine)})`, mine);

  if (workspace !== null) {
    await clear(conn, report, 'workspace record time', 'UPDATE public_demo_workspaces SET last_reset_at = CURRENT_TIMESTAMP WHERE id = ?', [workspace]);
  }
  return report;
}

async function main() {
  const mysql = require('mysql2/promise');
  const argv = process.argv.slice(2);
  const unknown = argv.filter(a => !['--apply', '--force'].includes(a));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = argv.includes('--apply'), force = argv.includes('--force');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const window = evaluateDemoWindow({ enabled: await getSettingRaw(conn, 'public_demo_enabled'), endsAt: await getSettingRaw(conn, 'public_demo_ends_at') });
    if (!window.open && !force) {
      console.log(`Shared demo is closed (${window.reason}); nothing to reset. Use --force to reset anyway.`);
      return;
    }
    console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} -- reset the shared demo environment\n`);
    await conn.beginTransaction();
    let report;
    try {
      report = await resetDemo(conn);
      if (apply) await conn.commit(); else await conn.rollback();
    } catch (err) {
      await conn.rollback();
      console.error('\nFAILED -- the transaction was rolled back, nothing was changed.');
      throw err;
    }
    report.print(apply ? '' : 'would ');
    console.log(apply ? '\nDemo reset.\n' : '\nDry run complete. Re-run with --apply to make it real.\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { resetDemo, purgeFakeAccounts };
