const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getSettingRaw, putSettingRaw } = require('../lib/public-demo-admin');

// The seed library for the prospect demo (docs/reference/shared-demo-workspaces-requirements.md). seed(conn, { fx }) creates or tops up one workspace
// (fx = workspaceFixtures(n)): its own fake district, school, $0 licence and purchase, four logins, and a demo classroom with three fake students and one
// lesson set. scripts/seed-demo-workspaces.js builds the pool with it; an invitation (lib/public-demo-invitations.js) gives the logins a password and PIN.
// Everything is fake. (The original single shared demo, which this script used to build from the command line, was retired in phase 5; its leftovers are
// removed by scripts/retire-original-demo.js.)
//
// Run scripts/alter-add-sales-demo-flag.js and scripts/alter-add-shared-demo-flag.js first. Both flags are set on every demo login: is_shared_demo
// makes it work only while its invitation is open, is_sales_demo keeps it out of the community, analytics and the Morning Boost group, and confines it to
// demo data (lib/sales-demo.js).

const WORDS = ('amber anchor apple aspen badge basil beach birch bloom bramble breeze bridge brook cabin candle canyon cedar chalk cherry cliff clover cobalt comet coral cotton crane creek crest daisy delta dune ember falcon fern field finch flint forest fox garden ginger glacier grove harbor hazel heron hill honey indigo iris island ivory jasper juniper kettle lake lantern lark laurel lemon lilac linen lotus maple marble meadow mesa mint moss mountain nectar oak olive orchid otter pearl pebble pine plum pond poppy prairie quartz quill rain raven reef ridge river robin saffron sage sandy shell sparrow spruce stone summit sunny thistle thorn tide timber tulip valley velvet violet walnut willow winter wren yarrow zephyr').split(' ');

function generatePassword() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `demo-${pick()}-${pick()}-${pick()}-${pick()}`;
}
function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
}

// Collects what each step did so the dry run and the real run print the same report.
function makeReport() {
  const lines = [];
  return {
    created: (what) => lines.push(['create', what]),
    updated: (what) => lines.push(['update', what]),
    reused: (what) => lines.push(['reuse ', what]),
    note: (what) => lines.push(['note  ', what]),
    lines,
    print(prefix) { for (const [kind, what] of lines) console.log(`  ${prefix}${kind}  ${what}`); },
  };
}

async function one(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows[0] || null;
}

// The classroom, its students, its lessons and the parent link. Shared with the nightly reset, which deletes the classroom and calls this to
// build it again (the join and parent codes are passed back in so they stay the same across resets).
//
// The shared student's PIN: `pin`, or `pinHash` (a workspace reset hands back the hash it found, so the PIN
// the group was given keeps working), or neither (a new workspace: a random PIN nobody is told, until an invitation sets one).
async function seedClassroom(conn, { teacherId, parentId, pin, pinHash = null, rounds = 10, codes = null, fx }, report) {
  let classroom = await one(conn,
    'SELECT id, join_code, parent_code FROM classrooms WHERE teacher_site_user_id = ? AND name = ? AND archived_at IS NULL', [teacherId, fx.classroomName]);
  if (classroom) report.reused(`demo classroom "${fx.classroomName}" (#${classroom.id})`);
  else {
    const joinCode = (codes && codes.join_code) || crypto.randomBytes(4).toString('hex').toUpperCase();
    const parentCode = (codes && codes.parent_code) || `${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [r] = await conn.query(
      `INSERT INTO classrooms (name, teacher_site_user_id, join_code, parent_code, grade_level, subject, academic_year)
       VALUES (?, ?, ?, ?, '5th Grade', 'Homeroom', '2026-2027')`, [fx.classroomName, teacherId, joinCode, parentCode]);
    classroom = { id: r.insertId, join_code: joinCode, parent_code: parentCode };
    report.created(`demo classroom "${fx.classroomName}"`);
  }

  const students = [];
  let madeStudents = 0;
  for (const s of fx.students) {
    let row = await one(conn, 'SELECT id, classroom_id, password_hash FROM classroom_students WHERE username = ?', [s.username]);
    if (row && row.classroom_id !== classroom.id) throw new Error(`The username "${s.username}" already belongs to a student in another classroom. Refusing to touch it.`);
    if (!row) {
      const hash = s.shared && pinHash ? pinHash : await bcrypt.hash(s.shared && pin !== null && pin !== undefined ? pin : generatePin(), rounds);
      const [r] = await conn.query(
        'INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, is_active) VALUES (?, ?, ?, ?, 1)', [classroom.id, s.name, s.username, hash]);
      row = { id: r.insertId };
      madeStudents += 1;
    } else if (s.shared && pin !== null && pin !== undefined && !(await bcrypt.compare(pin, row.password_hash))) {
      await conn.query('UPDATE classroom_students SET password_hash = ?, is_active = 1 WHERE id = ?', [await bcrypt.hash(pin, rounds), row.id]);
      report.updated(`student PIN for ${s.username}`);
    }
    students.push({ id: row.id, username: s.username });
  }
  report[madeStudents ? 'created' : 'reused'](madeStudents ? `${madeStudents} fake student(s) in the demo classroom` : 'fake students');

  const [lessons] = await conn.query(`SELECT id FROM curricula WHERE published = 1 ORDER BY id LIMIT ${Number(fx.lessonCount)}`);
  for (const lesson of lessons) {
    const has = await one(conn, 'SELECT id FROM classroom_assignments WHERE classroom_id = ? AND curriculum_id = ?', [classroom.id, lesson.id]);
    if (!has) await conn.query('INSERT INTO classroom_assignments (classroom_id, curriculum_id, assigned_by_id) VALUES (?, ?, ?)', [classroom.id, lesson.id, teacherId]);
  }
  if (lessons.length) {
    // Student A has finished the first lesson, so the parent view and the progress tab have something real to show.
    const done = await one(conn, 'SELECT id, completed_at FROM student_lesson_progress WHERE student_id = ? AND curriculum_id = ?', [students[0].id, lessons[0].id]);
    if (!done) await conn.query('INSERT INTO student_lesson_progress (student_id, curriculum_id, started_at, completed_at) VALUES (?, ?, NOW(), NOW())', [students[0].id, lessons[0].id]);
    else if (!done.completed_at) await conn.query('UPDATE student_lesson_progress SET completed_at = NOW() WHERE id = ?', [done.id]);
    report.note(`${lessons.length} published lesson(s) assigned to the classroom, with student A marked complete on the first`);
  } else {
    report.note('no published lessons exist yet, so the demo classroom has none assigned (publish one, then re-run)');
  }

  const link = await one(conn, 'SELECT id, student_id FROM parent_classroom_links WHERE site_user_id = ? AND classroom_id = ?', [parentId, classroom.id]);
  if (!link) {
    await conn.query('INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (?, ?, ?)', [parentId, classroom.id, students[0].id]);
    report.created('parent link to "Demo Student A"');
  } else {
    if (link.student_id !== students[0].id) await conn.query('UPDATE parent_classroom_links SET student_id = ? WHERE id = ?', [students[0].id, link.id]);
    report.reused('parent link to "Demo Student A"');
  }
  return { classroom, students, lessonCount: lessons.length };
}

// Builds (or tops up) one workspace (`fx = workspaceFixtures(n)`).
// password / pin may be null for a workspace: its logins then get random passwords nobody is told (they cannot be signed in to), and an account that
// already exists keeps the password it has, so topping up the pool never signs anyone out. An invitation sets the real ones (phase 2).
async function seed(conn, { password, pin, rounds = 12, fx }, report) {
  if (!fx || fx.number === null || fx.number === undefined) throw new Error('seed needs a workspace (fx = workspaceFixtures(n)). The original single demo was retired.');
  const out = {};
  const workspace = fx.number;

  // ---- Fixtures: the demo district, school, $0 licence and purchase ---------------------------------------------------------------------------
  let district = await one(conn, 'SELECT id FROM districts WHERE name = ?', [fx.districtName]);
  if (district) report.reused(`district "${fx.districtName}" (#${district.id})`);
  else {
    const [r] = await conn.query('INSERT INTO districts (name) VALUES (?)', [fx.districtName]);
    district = { id: r.insertId };
    report.created(`district "${fx.districtName}"`);
  }

  let school = await one(conn, 'SELECT id, district_id FROM schools WHERE domain = ?', [fx.domain]);
  if (school) {
    if (school.district_id !== district.id) {
      await conn.query('UPDATE schools SET district_id = ? WHERE id = ?', [district.id, school.id]);
      report.note(`school ${fx.domain} was not in the demo district -- moved it`);
    }
    report.reused(`school ${fx.domain} (#${school.id})`);
  } else {
    const [r] = await conn.query('INSERT INTO schools (domain, district_id, display_name) VALUES (?, ?, ?)', [fx.domain, district.id, fx.schoolName]);
    school = { id: r.insertId };
    report.created(`school ${fx.domain}`);
  }

  // $0 and inactive: invisible in the public catalog and adds nothing to revenue reports.
  let product = await one(conn, 'SELECT id FROM license_products WHERE name = ?', [fx.productName]);
  if (product) report.reused(`licence product "${fx.productName}" (#${product.id})`);
  else {
    const [r] = await conn.query(
      `INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, variable_seats, active, sort_order)
       VALUES (?, 'Internal shared-demo fixture -- not a real product. Do not display or sell.', 25, 0, 0, 0, 0, 997)`, [fx.productName]);
    product = { id: r.insertId };
    report.created(`licence product "${fx.productName}" ($0, inactive, 25 seats)`);
  }

  let contact = await one(conn, 'SELECT id FROM newsletter_contacts WHERE email = ?', [fx.contactEmail]);
  if (!contact) {
    const [r] = await conn.query(`INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('FNE Public Demo', ?, ?, 'Unsubscribed')`, [fx.contactEmail, fx.source]);
    contact = { id: r.insertId };
    report.created(`CRM contact ${fx.contactEmail} (Unsubscribed)`);
  }

  let purchase = await one(conn, "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND school_domain = ?", [contact.id, fx.domain]);
  if (purchase) report.reused(`demo group-licence purchase (#${purchase.id})`);
  else {
    const [r] = await conn.query(
      `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain, school_id)
       VALUES (?, 'group_license', ?, 25, ?, 'manual', 'paid', ?, ?)`, [contact.id, product.id, fx.source, fx.domain, school.id]);
    purchase = { id: r.insertId };
    report.created(`demo group-licence purchase (25 seats, source "${fx.source}")`);
  }
  out.districtId = district.id; out.schoolId = school.id; out.purchaseId = purchase.id;

  // ---- The four site logins --------------------------------------------------------------------------------------------------------------------
  // A workspace passes password = null: a NEW login gets a random password nobody is told, and an existing one keeps the password it has.
  const ids = {};
  for (const key of Object.keys(fx.accounts)) {
    const a = fx.accounts[key];
    const existing = await one(conn, 'SELECT id, password_hash, is_shared_demo FROM site_users WHERE email = ?', [a.email]);
    if (existing) {
      if (!existing.is_shared_demo) throw new Error(`${a.email} already exists and is not a shared demo account. Refusing to convert it.`);
      let changed = false;
      if (password !== null && password !== undefined && (!existing.password_hash || !(await bcrypt.compare(password, existing.password_hash)))) {
        // A new password signs every other browser out (session_invalidated_at), exactly as a real password change does.
        await conn.query('UPDATE site_users SET password_hash = ?, session_invalidated_at = NOW() WHERE id = ?', [await bcrypt.hash(password, rounds), existing.id]);
        changed = true;
      }
      await conn.query('UPDATE site_users SET email_verified = 1, role = ?, is_sales_demo = 1, is_shared_demo = 1, closed_at = NULL, closed_reason = NULL WHERE id = ?', [a.role, existing.id]);
      if (workspace !== null) await conn.query('UPDATE site_users SET demo_workspace_id = ? WHERE id = ?', [workspace, existing.id]);
      report[changed ? 'updated' : 'reused'](`login ${a.email} (#${existing.id})${changed ? ' -- password changed' : ''}`);
      ids[key] = existing.id;
    } else {
      const hash = await bcrypt.hash(password !== null && password !== undefined ? password : crypto.randomBytes(32).toString('hex'), rounds);
      const [r] = await conn.query(
        `INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role, is_sales_demo, is_shared_demo) VALUES (?, ?, ?, ?, 1, ?, 1, 1)`,
        [a.first, a.last, a.email, hash, a.role]);
      ids[key] = r.insertId;
      if (workspace !== null) await conn.query('UPDATE site_users SET demo_workspace_id = ? WHERE id = ?', [workspace, ids[key]]);
      report.created(`login ${a.email} (verified, role "${a.role}", flagged shared demo and sales demo${workspace !== null ? `, workspace ${fx.number}` : ''})`);
    }
  }
  out.ids = ids;

  // Teacher: a registered licence seat on the demo purchase.
  const seat = await one(conn, 'SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?', [purchase.id, ids.teacher]);
  if (seat) report.reused('teacher licence seat');
  else {
    await conn.query("INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at) VALUES (?, ?, 'registered', ?, NOW())",
      [purchase.id, fx.accounts.teacher.email, ids.teacher]);
    report.created('teacher licence seat (demo purchase)');
  }

  // School administrator on the demo purchase; district administrator on the demo district.
  const sa = await one(conn, 'SELECT id, is_active FROM school_license_admins WHERE site_user_id = ? AND purchase_id = ?', [ids.school, purchase.id]);
  if (!sa) { await conn.query("INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)", [ids.school, purchase.id]); report.created('school administrator assignment (primary, demo school only)'); }
  else { if (!sa.is_active) await conn.query('UPDATE school_license_admins SET is_active = 1 WHERE id = ?', [sa.id]); report.reused('school administrator assignment'); }
  const da = await one(conn, 'SELECT id, is_active FROM district_license_admins WHERE site_user_id = ? AND district_id = ?', [ids.district, district.id]);
  if (!da) { await conn.query('INSERT INTO district_license_admins (site_user_id, district_id, is_active) VALUES (?, ?, 1)', [ids.district, district.id]); report.created('district administrator assignment (demo district only)'); }
  else { if (!da.is_active) await conn.query('UPDATE district_license_admins SET is_active = 1 WHERE id = ?', [da.id]); report.reused('district administrator assignment'); }

  // ---- The classroom, students, lessons and parent link ----------------------------------------------------------------------------------------
  const room = await seedClassroom(conn, { teacherId: ids.teacher, parentId: ids.parent, pin, rounds: Math.min(rounds, 10), fx }, report);
  out.classroom = room.classroom;

  // A workspace is also recorded in public_demo_workspaces (which district, school and purchase make it up).
  if (workspace !== null) {
    const row = await one(conn, 'SELECT id FROM public_demo_workspaces WHERE id = ?', [workspace]);
    if (!row) {
      await conn.query('INSERT INTO public_demo_workspaces (id, district_id, school_id, purchase_id, status) VALUES (?, ?, ?, ?, ?)', [workspace, district.id, school.id, purchase.id, 'free']);
      report.created(`workspace record #${workspace}`);
    } else {
      await conn.query('UPDATE public_demo_workspaces SET district_id = ?, school_id = ?, purchase_id = ? WHERE id = ?', [district.id, school.id, purchase.id, workspace]);
      report.reused(`workspace record #${workspace}`);
    }
  }
  return out;
}

module.exports = { seed, seedClassroom, makeReport, generatePassword, generatePin, getSettingRaw, putSettingRaw, WORDS };
