// Seeds every account the Playwright e2e suite (tests/e2e/) needs to sign in
// as: a licensed teacher, an unlicensed teacher, a Morning Boost member, a
// school license admin, a plain teacher with a classroom, a student in that
// classroom, and a parent linked to that classroom. Safe to re-run — every
// insert is idempotent (checks for an existing row by email/username first,
// or uses INSERT IGNORE on a unique key).
//
// All accounts use the password/PIN below unless already seeded with a
// different one on a prior run. Run once, then copy the printed values into
// tests/.env.test.
//
// Usage (from server/, with nodevenv activated in production):
//   node scripts/seed-qa-test-accounts.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const QA_PASSWORD = 'QaTest!2026';
const QA_PIN = '135790';

async function findOrCreateSiteUser(conn, { email, firstName, lastName, role }) {
  const [[existing]] = await conn.query('SELECT id, role FROM site_users WHERE email = ?', [email]);
  if (existing) {
    if (role && existing.role !== role) {
      await conn.query('UPDATE site_users SET role = ? WHERE id = ?', [role, existing.id]);
    }
    return existing.id;
  }
  const passwordHash = await bcrypt.hash(QA_PASSWORD, 10);
  const [result] = await conn.query(
    `INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [firstName, lastName, email, passwordHash, role || 'teacher']
  );
  return result.insertId;
}

async function findOrCreateContact(conn, { email, name }) {
  const [[existing]] = await conn.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (existing) return existing.id;
  const [result] = await conn.query(
    `INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'QA Seed', 'Subscribed')`,
    [name, email]
  );
  return result.insertId;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const out = { password: QA_PASSWORD, pin: QA_PIN };

  // --- Licensed site user -----------------------------------------------
  const licensedEmail = 'qa-licensed@example.com';
  const licensedContactId = await findOrCreateContact(conn, { email: licensedEmail, name: 'QA Licensed' });
  const licensedUserId = await findOrCreateSiteUser(conn, {
    email: licensedEmail, firstName: 'QA', lastName: 'Licensed', role: 'teacher',
  });
  const [[licenseProduct]] = await conn.query(
    "SELECT id FROM license_products WHERE active = 1 ORDER BY id LIMIT 1"
  );
  if (!licenseProduct) {
    console.warn('No active license_products row found — skipping license seat setup. Run scripts/seed-license-products.js first.');
  } else {
    let [[purchase]] = await conn.query(
      "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND license_product_id = ?",
      [licensedContactId, licenseProduct.id]
    );
    let purchaseId = purchase && purchase.id;
    if (!purchaseId) {
      const [result] = await conn.query(
        `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status)
         VALUES (?, 'group_license', ?, 1, 'QA Seed', 'manual', 'paid')`,
        [licensedContactId, licenseProduct.id]
      );
      purchaseId = result.insertId;
    }
    const [[seat]] = await conn.query(
      "SELECT id FROM license_seats WHERE registered_site_user_id = ?",
      [licensedUserId]
    );
    if (!seat) {
      await conn.query(
        `INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at)
         VALUES (?, ?, 'registered', ?, NOW())`,
        [purchaseId, licensedEmail, licensedUserId]
      );
    }
  }
  out.siteUserLicensed = licensedEmail;

  // --- Unlicensed site user ----------------------------------------------
  const unlicensedEmail = 'qa-unlicensed@example.com';
  await findOrCreateSiteUser(conn, {
    email: unlicensedEmail, firstName: 'QA', lastName: 'Unlicensed', role: 'teacher',
  });
  out.siteUserUnlicensed = unlicensedEmail;

  // --- Morning Boost member ----------------------------------------------
  const memberEmail = 'qa-member@example.com';
  const memberContactId = await findOrCreateContact(conn, { email: memberEmail, name: 'QA Member' });
  await findOrCreateSiteUser(conn, {
    email: memberEmail, firstName: 'QA', lastName: 'Member', role: 'teacher',
  });
  const [[membershipPlan]] = await conn.query(
    "SELECT id FROM membership_plans WHERE active = 1 ORDER BY id LIMIT 1"
  );
  if (!membershipPlan) {
    console.warn('No active membership_plans row found — skipping membership setup. Run scripts/seed-membership-plans.js first.');
  } else {
    const [[existingMembership]] = await conn.query(
      "SELECT id FROM contact_memberships WHERE contact_id = ? AND status IN ('trialing','active')",
      [memberContactId]
    );
    if (!existingMembership) {
      await conn.query(
        `INSERT INTO contact_memberships (contact_id, membership_plan_id, status) VALUES (?, ?, 'active')`,
        [memberContactId, membershipPlan.id]
      );
    }
  }
  out.member = memberEmail;

  // --- School license admin ----------------------------------------------
  const schoolAdminEmail = 'qa-school-admin@example.com';
  const schoolAdminContactId = await findOrCreateContact(conn, { email: schoolAdminEmail, name: 'QA School Admin' });
  const schoolAdminUserId = await findOrCreateSiteUser(conn, {
    email: schoolAdminEmail, firstName: 'QA', lastName: 'SchoolAdmin', role: 'school_license_admin',
  });
  let saPurchaseId;
  if (licenseProduct) {
    let [[saPurchase]] = await conn.query(
      "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND license_product_id = ?",
      [schoolAdminContactId, licenseProduct.id]
    );
    saPurchaseId = saPurchase && saPurchase.id;
    if (!saPurchaseId) {
      const [result] = await conn.query(
        `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, school_domain)
         VALUES (?, 'group_license', ?, 10, 'QA Seed', 'manual', 'paid', 'qa-school.example.com')`,
        [schoolAdminContactId, licenseProduct.id]
      );
      saPurchaseId = result.insertId;
    }
    await conn.query(
      `INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
       VALUES (?, ?, 'primary', 1)`,
      [schoolAdminUserId, saPurchaseId]
    );
  } else {
    console.warn('Skipping school_license_admins row — no license_products available for the backing purchase.');
  }
  out.schoolAdmin = schoolAdminEmail;

  // --- Removable teacher, registered under the school admin's own purchase
  // (qa-teacher above has its own unrelated classroom, not this purchase) —
  // used only by the "remove teacher" e2e test. Re-seedable: if a prior test
  // run already revoked this seat, flip it back to registered so the test
  // stays repeatable without needing a fresh account each time.
  if (licenseProduct && typeof saPurchaseId !== 'undefined') {
    const removableEmail = 'qa-removable-teacher@example.com';
    const removableUserId = await findOrCreateSiteUser(conn, {
      email: removableEmail, firstName: 'QA', lastName: 'RemovableTeacher', role: 'teacher',
    });
    const [[removableSeat]] = await conn.query(
      'SELECT id FROM license_seats WHERE purchase_id = ? AND registered_site_user_id = ?',
      [saPurchaseId, removableUserId]
    );
    if (removableSeat) {
      await conn.query(
        "UPDATE license_seats SET status = 'registered', revoked_at = NULL, revoked_by = NULL, revocation_reason = NULL WHERE id = ?",
        [removableSeat.id]
      );
    } else {
      await conn.query(
        `INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at)
         VALUES (?, ?, 'registered', ?, NOW())`,
        [saPurchaseId, removableEmail, removableUserId]
      );
    }
    out.removableTeacher = removableEmail;
  }

  // --- Teacher invite acceptance flow, fixed token -------------------------
  // school-invite.spec.ts can't read a real inbox to get the emailed
  // acceptance link, so this pre-seeds a 'pending' invitation with a known,
  // stable token (same reasoning as TEST_QUOTE_VALID_TOKEN below) — the test
  // still drives the real school-invite-accept.html registration UI end to
  // end, only the email-delivery step itself is bridged. Re-seedable: if the
  // account from a prior run wasn't cleaned up (e.g. a failed test), tear it
  // down and reset the seat/invitation back to 'pending' first.
  if (licenseProduct && typeof saPurchaseId !== 'undefined') {
    const inviteEmail = 'qa-invite-teacher@example.com';
    const inviteToken = 'qa-fixed-invite-test-token-0000000000000000000000000000000000000000000000';

    const [[existingInviteUser]] = await conn.query('SELECT id FROM site_users WHERE email = ?', [inviteEmail]);
    if (existingInviteUser) {
      await conn.query('DELETE FROM site_users WHERE id = ?', [existingInviteUser.id]);
    }

    let [[inviteSeat]] = await conn.query(
      'SELECT id FROM license_seats WHERE purchase_id = ? AND invited_email = ?',
      [saPurchaseId, inviteEmail]
    );
    let inviteSeatId;
    if (inviteSeat) {
      inviteSeatId = inviteSeat.id;
      await conn.query(
        "UPDATE license_seats SET status = 'pending', registered_site_user_id = NULL, registered_at = NULL WHERE id = ?",
        [inviteSeatId]
      );
    } else {
      const [r] = await conn.query(
        "INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, 'pending')",
        [saPurchaseId, inviteEmail]
      );
      inviteSeatId = r.insertId;
    }

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [[existingInv]] = await conn.query('SELECT id FROM school_invitations WHERE token = ?', [inviteToken]);
    if (existingInv) {
      await conn.query(
        "UPDATE school_invitations SET status = 'pending', seat_id = ?, expires_at = ? WHERE id = ?",
        [inviteSeatId, expiresAt, existingInv.id]
      );
    } else {
      await conn.query(
        `INSERT INTO school_invitations (purchase_id, seat_id, invited_email, first_name, last_name, token, status, expires_at)
         VALUES (?, ?, ?, 'QA', 'InviteTest', ?, 'pending', ?)`,
        [saPurchaseId, inviteSeatId, inviteEmail, inviteToken, expiresAt]
      );
    }
    out.inviteToken = inviteToken;
    out.inviteEmail = inviteEmail;
  }

  // --- Teacher with a classroom -------------------------------------------
  const teacherEmail = 'qa-teacher@example.com';
  const teacherUserId = await findOrCreateSiteUser(conn, {
    email: teacherEmail, firstName: 'QA', lastName: 'Teacher', role: 'teacher',
  });
  let [[classroom]] = await conn.query(
    "SELECT id, join_code, parent_code FROM classrooms WHERE teacher_site_user_id = ? AND archived_at IS NULL LIMIT 1",
    [teacherUserId]
  );
  if (!classroom) {
    const joinCode = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    const parentCode = `${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const [result] = await conn.query(
      `INSERT INTO classrooms (name, teacher_site_user_id, join_code, parent_code, grade_level, subject, academic_year)
       VALUES ('QA Test Classroom', ?, ?, ?, '5th Grade', 'Homeroom', '2025-2026')`,
      [teacherUserId, joinCode, parentCode]
    );
    classroom = { id: result.insertId, join_code: joinCode, parent_code: parentCode };
  }
  out.teacher = teacherEmail;
  out.classroomId = classroom.id;
  out.classroomJoinCode = classroom.join_code;
  out.classroomParentCode = classroom.parent_code;

  // Assign a published curriculum to the classroom so teacher/parent/student
  // lesson-card flows have something real to render, not just an empty
  // "No lessons" state.
  const [[curriculum]] = await conn.query(
    "SELECT id FROM curricula WHERE published = 1 ORDER BY id LIMIT 1"
  );
  if (curriculum) {
    await conn.query(
      `INSERT IGNORE INTO classroom_assignments (classroom_id, curriculum_id, assigned_by_id)
       VALUES (?, ?, ?)`,
      [classroom.id, curriculum.id, teacherUserId]
    );
  } else {
    console.warn('No published curriculum found — classroom has no lesson assigned. Publish one via admin-curriculum.html, then re-run this script.');
  }

  // --- Student in that classroom ------------------------------------------
  const studentUsername = 'qa-student-1';
  const [[existingStudent]] = await conn.query(
    'SELECT id FROM classroom_students WHERE username = ?',
    [studentUsername]
  );
  if (!existingStudent) {
    const pinHash = await bcrypt.hash(QA_PIN, 10);
    await conn.query(
      `INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, is_active)
       VALUES (?, 'QA Student', ?, ?, 1)`,
      [classroom.id, studentUsername, pinHash]
    );
  }
  out.studentUsername = studentUsername;

  // --- Parent linked to that classroom ------------------------------------
  const parentEmail = 'qa-parent@example.com';
  const parentUserId = await findOrCreateSiteUser(conn, {
    email: parentEmail, firstName: 'QA', lastName: 'Parent', role: 'parent',
  });
  await conn.query(
    'INSERT IGNORE INTO parent_classroom_links (site_user_id, classroom_id) VALUES (?, ?)',
    [parentUserId, classroom.id]
  );
  out.parent = parentEmail;

  await conn.end();

  console.log('\nQA test accounts ready. Paste these into tests/.env.test:\n');
  console.log(`TEST_SITE_USER_EMAIL=${out.siteUserLicensed}`);
  console.log(`TEST_SITE_USER_PASSWORD=${out.password}`);
  console.log(`TEST_SITE_USER_UNLICENSED_EMAIL=${out.siteUserUnlicensed}`);
  console.log(`TEST_SITE_USER_UNLICENSED_PASSWORD=${out.password}`);
  console.log(`TEST_MEMBER_EMAIL=${out.member}`);
  console.log(`TEST_MEMBER_PASSWORD=${out.password}`);
  console.log(`TEST_SCHOOL_ADMIN_EMAIL=${out.schoolAdmin}`);
  console.log(`TEST_SCHOOL_ADMIN_PASSWORD=${out.password}`);
  console.log(`TEST_TEACHER_EMAIL=${out.teacher}`);
  console.log(`TEST_TEACHER_PASSWORD=${out.password}`);
  console.log(`TEST_STUDENT_USERNAME=${out.studentUsername}`);
  console.log(`TEST_STUDENT_PIN=${out.pin}`);
  console.log(`TEST_PARENT_EMAIL=${out.parent}`);
  console.log(`TEST_PARENT_PASSWORD=${out.password}`);
  if (out.removableTeacher) console.log(`TEST_REMOVABLE_TEACHER_EMAIL=${out.removableTeacher}`);
  if (out.inviteToken) console.log(`TEST_TEACHER_INVITE_TOKEN=${out.inviteToken}`);
  if (out.inviteEmail) console.log(`TEST_TEACHER_INVITE_EMAIL=${out.inviteEmail}`);
  console.log(`\n(Classroom #${out.classroomId} — join code ${out.classroomJoinCode}, parent code ${out.classroomParentCode})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
