require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Creates (or tops up) ONE site-user account for an FNE salesperson that can demo
// every customer-facing role at once -- teacher, parent, school license admin and
// district admin -- against DEMO DATA ONLY. It is a normal site_users account, not
// an FNE admin: it can't reach any admin-*.html page.
//
//   node scripts/seed-sales-demo-account.js --email jane@fullsteam.com --first Jane --last Doe
//       DRY RUN (default): runs every statement inside a transaction against the real
//       schema, reports what it would create/reuse, then ROLLS BACK. Nothing is written.
//   ... --apply
//       Does it for real and emails the salesperson a link to choose their own password.
//   ... --apply --no-email
//       Same, but prints the one-time password-setup link instead of emailing it.
//   ... --allow-existing
//       Needed only if the email already belongs to an account that holds REAL licence seats,
//       school-admin assignments or classrooms. Converting such an account to a confined demo
//       account is refused by default -- use a fresh email for the salesperson instead.
//
// Safe to re-run: every step finds-or-creates, so running it again for the same
// person only fills in whatever is missing.
//
// The account is flagged site_users.is_sales_demo = 1 (run scripts/alter-add-sales-demo-flag.js
// first). The server then CONFINES it, whatever it is assigned later: no community access
// (the one place teachers see other real teachers), school/district admin portals limited to
// the demo school/district, teacher invitations into the demo school limited to example.com,
// colleagues on the inviter's own company domain, or -- for a consumer address such as
// yahoo.com or gmail.com -- only the inviter's own mailbox and its + variants. See lib/sales-demo.js.
//
// WHY DEMO DATA ONLY: the school-admin and district-admin portals show real student
// and teacher records for whatever school/district the account is assigned to.
// Pointing a salesperson at a real customer would hand them that customer's data, so
// every entitlement here is attached to a clearly fake district/school/classroom
// (the domain ends in .example.com, which no real teacher can register against).
//
// Shared by all salespeople (created once): the demo district, school, $0 licence
// product and group-licence purchase.
// Per salesperson: their own account, licence seat, school/district admin
// assignments, a demo classroom with three fake students, and a parent link to one
// of those students.

const { DEMO_DISTRICT_NAME, DEMO_SCHOOL_DOMAIN, DEMO_SOURCE } = require('../lib/sales-demo');
const DEMO_SCHOOL_NAME = 'Fixer Nation Demo School';
const DEMO_PRODUCT_NAME = '[Sales Demo] Demo License';
const DEMO_CONTACT_EMAIL = 'sales-demo@example.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv) {
  const args = { apply: false, noEmail: false, allowExisting: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--no-email') args.noEmail = true;
    else if (a === '--allow-existing') args.allowExisting = true;
    else if (a === '--email') args.email = argv[++i];
    else if (a === '--first') args.first = argv[++i];
    else if (a === '--last') args.last = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  args.email = String(args.email || '').trim().toLowerCase();
  args.first = String(args.first || '').trim();
  args.last = String(args.last || '').trim();
  if (!EMAIL_PATTERN.test(args.email)) throw new Error('--email is required and must be a valid email address.');
  if (!args.first || !args.last) throw new Error('--first and --last are required.');
  return args;
}

// Collects what each step did so the dry run and the real run print the same report.
function makeReport() {
  const lines = [];
  return {
    created: (what) => lines.push(['create', what]),
    reused: (what) => lines.push(['reuse ', what]),
    note: (what) => lines.push(['note  ', what]),
    print(prefix) {
      for (const [kind, what] of lines) console.log(`  ${prefix}${kind}  ${what}`);
    },
  };
}

async function seed(conn, args, report) {
  const out = {};

  // ---- Shared demo scaffolding ------------------------------------------------
  let [[district]] = await conn.query('SELECT id FROM districts WHERE name = ?', [DEMO_DISTRICT_NAME]);
  if (district) report.reused(`district "${DEMO_DISTRICT_NAME}" (#${district.id})`);
  else {
    const [r] = await conn.query('INSERT INTO districts (name) VALUES (?)', [DEMO_DISTRICT_NAME]);
    district = { id: r.insertId };
    report.created(`district "${DEMO_DISTRICT_NAME}"`);
  }

  let [[school]] = await conn.query('SELECT id, district_id FROM schools WHERE domain = ?', [DEMO_SCHOOL_DOMAIN]);
  if (school) {
    if (school.district_id !== district.id) {
      await conn.query('UPDATE schools SET district_id = ? WHERE id = ?', [district.id, school.id]);
      report.note(`school ${DEMO_SCHOOL_DOMAIN} was not in the demo district -- moved it`);
    }
    report.reused(`school ${DEMO_SCHOOL_DOMAIN} (#${school.id})`);
  } else {
    const [r] = await conn.query('INSERT INTO schools (domain, district_id, display_name) VALUES (?, ?, ?)', [DEMO_SCHOOL_DOMAIN, district.id, DEMO_SCHOOL_NAME]);
    school = { id: r.insertId };
    report.created(`school ${DEMO_SCHOOL_DOMAIN}`);
  }

  // $0 and inactive: invisible in the public catalog and adds nothing to revenue reports.
  let [[product]] = await conn.query('SELECT id FROM license_products WHERE name = ?', [DEMO_PRODUCT_NAME]);
  if (product) report.reused(`licence product "${DEMO_PRODUCT_NAME}" (#${product.id})`);
  else {
    const [r] = await conn.query(
      `INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, variable_seats, active, sort_order)
       VALUES (?, 'Internal sales-demo fixture -- not a real product. Do not display or sell.', 25, 0, 0, 0, 0, 998)`,
      [DEMO_PRODUCT_NAME]
    );
    product = { id: r.insertId };
    report.created(`licence product "${DEMO_PRODUCT_NAME}" ($0, inactive, 25 seats)`);
  }

  // Unsubscribed so no campaign or Morning Boost send ever targets this fake address.
  let [[contact]] = await conn.query('SELECT id FROM newsletter_contacts WHERE email = ?', [DEMO_CONTACT_EMAIL]);
  if (!contact) {
    const [r] = await conn.query(
      `INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('FNE Sales Demo', ?, ?, 'Unsubscribed')`,
      [DEMO_CONTACT_EMAIL, DEMO_SOURCE]
    );
    contact = { id: r.insertId };
    report.created(`CRM contact ${DEMO_CONTACT_EMAIL} (Unsubscribed)`);
  }

  let [[purchase]] = await conn.query(
    "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND school_domain = ?",
    [contact.id, DEMO_SCHOOL_DOMAIN]
  );
  if (purchase) report.reused(`demo group-licence purchase (#${purchase.id})`);
  else {
    const [r] = await conn.query(
      `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain, school_id)
       VALUES (?, 'group_license', ?, 25, ?, 'manual', 'paid', ?, ?)`,
      [contact.id, product.id, DEMO_SOURCE, DEMO_SCHOOL_DOMAIN, school.id]
    );
    purchase = { id: r.insertId };
    report.created(`demo group-licence purchase (25 seats, source "${DEMO_SOURCE}")`);
  }
  out.districtId = district.id; out.schoolId = school.id; out.purchaseId = purchase.id;

  // ---- This salesperson ---------------------------------------------------------
  let [[user]] = await conn.query('SELECT id, role FROM site_users WHERE email = ?', [args.email]);
  if (user) {
    report.reused(`account ${args.email} (#${user.id}, role "${user.role}")`);
    // An existing account that already holds REAL data would be silently converted into a
    // confined demo account (and lose community access). Refuse unless explicitly asked.
    const [[seats]] = await conn.query(
      "SELECT COUNT(*) AS n FROM license_seats WHERE registered_site_user_id = ? AND status = 'registered' AND purchase_id <> ?", [user.id, purchase.id]);
    const [[admins]] = await conn.query(
      'SELECT COUNT(*) AS n FROM school_license_admins WHERE site_user_id = ? AND is_active = 1 AND purchase_id <> ?', [user.id, purchase.id]);
    const [[rooms]] = await conn.query(
      'SELECT COUNT(*) AS n FROM classrooms WHERE teacher_site_user_id = ? AND name NOT LIKE ?', [user.id, 'Demo Classroom - %']);
    if (seats.n || admins.n || rooms.n) {
      const detail = `${seats.n} real licence seat(s), ${admins.n} real school-admin assignment(s), ${rooms.n} real classroom(s)`;
      if (!args.allowExisting) {
        throw new Error(`${args.email} is an existing account that already holds ${detail}. Converting it would confine it to demo data. Use a fresh email for the salesperson, or pass --allow-existing if you really mean it.`);
      }
      report.note(`CONVERTING an account that holds ${detail} -- the demo restrictions will now apply to it`);
    }
    await conn.query('UPDATE site_users SET is_sales_demo = 1 WHERE id = ?', [user.id]);
    report.note('flagged as a sales-demo account (confined to demo data)');
  } else {
    // Unusable random password: the salesperson sets their own via the emailed link.
    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    const [r] = await conn.query(
      `INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role, is_sales_demo) VALUES (?, ?, ?, ?, 1, 'teacher', 1)`,
      [args.first, args.last, args.email, unusable]
    );
    user = { id: r.insertId, role: 'teacher' };
    report.created(`account ${args.email} (verified, role "teacher", flagged sales-demo, no usable password yet)`);
  }
  out.userId = user.id;

  // Teacher: a registered licence seat on the demo purchase.
  const [[seat]] = await conn.query('SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?', [purchase.id, user.id]);
  if (seat) report.reused('teacher licence seat');
  else {
    await conn.query(
      `INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at) VALUES (?, ?, 'registered', ?, NOW())`,
      [purchase.id, args.email, user.id]
    );
    report.created('teacher licence seat (demo purchase)');
  }

  // School licence admin on the demo purchase; district admin on the demo district.
  const [sa] = await conn.query(
    `INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)
     ON DUPLICATE KEY UPDATE is_active = 1`, [user.id, purchase.id]);
  report[sa.affectedRows === 1 ? 'created' : 'reused']('school licence admin assignment (primary, demo school only)');
  const [da] = await conn.query(
    `INSERT INTO district_license_admins (site_user_id, district_id, is_active) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE is_active = 1`, [user.id, district.id]);
  report[da.affectedRows === 1 ? 'created' : 'reused']('district admin assignment (demo district only)');

  // Demo classroom + fake students (for the teacher view, the student login and the parent link).
  const classroomName = `Demo Classroom - ${args.first} ${args.last}`.slice(0, 120);
  let [[classroom]] = await conn.query(
    'SELECT id, join_code, parent_code FROM classrooms WHERE teacher_site_user_id = ? AND name = ? AND archived_at IS NULL LIMIT 1', [user.id, classroomName]);
  if (classroom) report.reused(`demo classroom "${classroomName}" (#${classroom.id})`);
  else {
    const joinCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const parentCode = `${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [r] = await conn.query(
      `INSERT INTO classrooms (name, teacher_site_user_id, join_code, parent_code, grade_level, subject, academic_year)
       VALUES (?, ?, ?, ?, '5th Grade', 'Homeroom', '2026-2027')`, [classroomName, user.id, joinCode, parentCode]);
    classroom = { id: r.insertId, join_code: joinCode, parent_code: parentCode };
    report.created(`demo classroom "${classroomName}"`);
  }
  out.classroom = classroom;

  out.students = [];
  const labels = ['A', 'B', 'C'];
  for (let i = 0; i < labels.length; i++) {
    const username = `demo-${user.id}-${i + 1}`;
    let [[stu]] = await conn.query('SELECT id FROM classroom_students WHERE username = ?', [username]);
    if (stu) { out.students.push({ id: stu.id, username, pin: null }); continue; }
    const pin = String(crypto.randomInt(100000, 1000000));
    const [r] = await conn.query(
      `INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, is_active) VALUES (?, ?, ?, ?, 1)`,
      [classroom.id, `Demo Student ${labels[i]}`, username, await bcrypt.hash(pin, 10)]);
    out.students.push({ id: r.insertId, username, pin });
  }
  const newStudents = out.students.filter(s => s.pin).length;
  report[newStudents ? 'created' : 'reused'](newStudents ? `${newStudents} fake student(s) in the demo classroom` : 'fake students');

  const [[curriculum]] = await conn.query('SELECT id FROM curricula WHERE published = 1 ORDER BY id LIMIT 1');
  if (curriculum) {
    await conn.query('INSERT IGNORE INTO classroom_assignments (classroom_id, curriculum_id, assigned_by_id) VALUES (?, ?, ?)', [classroom.id, curriculum.id, user.id]);
    // Give student A finished progress so the parent view has something real to show.
    await conn.query(
      `INSERT INTO student_lesson_progress (student_id, curriculum_id, started_at, completed_at) VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE completed_at = COALESCE(completed_at, NOW())`, [out.students[0].id, curriculum.id]);
    report.note('first published lesson assigned to the classroom, with student A marked complete');
  } else {
    report.note('no published curriculum exists yet -- the demo classroom has no lesson assigned (publish one, then re-run)');
  }

  // Parent: linked to demo student A, so the parent portal has a child to show.
  const [pl] = await conn.query(
    `INSERT INTO parent_classroom_links (site_user_id, classroom_id, student_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE student_id = VALUES(student_id)`, [user.id, classroom.id, out.students[0].id]);
  report[pl.affectedRows === 1 ? 'created' : 'reused']('parent link to "Demo Student A"');

  // One-time "choose your password" token (same kind the forgot-password flow issues).
  out.resetToken = crypto.randomBytes(32).toString('hex');
  await conn.query('INSERT INTO site_user_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)',
    [user.id, out.resetToken, 'reset', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [flagCol] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'site_users' AND COLUMN_NAME = 'is_sales_demo'`,
    [process.env.DB_NAME]);
  if (!flagCol.length) {
    await conn.end();
    throw new Error('site_users.is_sales_demo does not exist yet. Run `node scripts/alter-add-sales-demo-flag.js` first -- without the flag the account would NOT be confined to demo data.');
  }

  console.log(`\n${args.apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} -- sales demo account for ${args.email}\n`);
  const report = makeReport();
  let out;
  await conn.beginTransaction();
  try {
    out = await seed(conn, args, report);
    if (args.apply) await conn.commit(); else await conn.rollback();
  } catch (err) {
    await conn.rollback();
    await conn.end();
    console.error('\nFAILED -- the transaction was rolled back, nothing was changed.');
    throw err;
  }
  await conn.end();

  report.print(args.apply ? '' : 'would ');
  if (!args.apply) {
    console.log('\nDry run complete: every statement ran against the real schema and was rolled back.');
    console.log('Re-run with --apply to make it real.\n');
    return;
  }

  const siteUrl = process.env.SITE_URL || '';
  const resetUrl = `${siteUrl}/reset-password.html?token=${out.resetToken}`;
  if (args.noEmail) {
    console.log(`\nPassword-setup link for ${args.email} (valid 7 days, single use):\n  ${resetUrl}`);
  } else {
    const { sendPasswordResetEmail } = require('../lib/mailer');
    await sendPasswordResetEmail({ to: args.email, firstName: args.first, resetUrl });
    console.log(`\nEmailed ${args.email} a link to choose their password (valid 7 days, single use).`);
  }

  console.log('\nWhat this account can do (all against demo data only):');
  console.log('  Teacher ........ teacher-classrooms.html  -> "Demo Classroom"');
  console.log('  Parent ......... parent-portal.html       -> child "Demo Student A"');
  console.log('  School admin ... school-admin-login.html  -> demo school (sales-demo.example.com)');
  console.log('  District admin . district-admin-login.html -> "FNE Sales Demo District"');
  console.log(`\nStudent demo logins (shown once; the teacher view can reset any PIN): classroom join code ${out.classroom.join_code}`);
  for (const s of out.students) console.log(`  ${s.username}  ${s.pin ? 'PIN ' + s.pin : '(already existed -- PIN unchanged)'}`);
  console.log('');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
