// Fills the throwaway test site with a clearly fake district for the how-to videos.
// Run by stack.sh from the server/ folder (it borrows server/node_modules). Never run against production:
// it refuses unless the database host is local.
//
// Everything is fictional and on example.com addresses. One random password is made per run and written
// to tests/howto/.env.howto.local (git-ignored), so no password is ever committed.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const days = (n) => new Date(Date.now() + n * 86400000);
const ymd = (d) => d.toISOString().slice(0, 10);

(async () => {
  if (!['127.0.0.1', 'localhost'].includes(process.env.DB_HOST)) throw new Error('Refusing to seed a non-local database.');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const q = async (sql, p = []) => (await db.query(sql, p))[0];
  const password = 'Demo-' + crypto.randomBytes(5).toString('hex');
  const hash = await bcrypt.hash(password, 10);

  const user = async (first, last, email, role) =>
    (await q('INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role) VALUES (?,?,?,?,1,?)', [first, last, email, hash, role])).insertId;

  // FNE staff login (admin side), used only by setup steps that act as staff.
  await q('INSERT INTO admin_users (username, password_hash, email) VALUES (?,?,?)', ['howto-admin', hash, 'howto-admin@example.com']);

  const districtId = (await q('INSERT INTO districts (name) VALUES (?)', ['Riverbend School District'])).insertId;

  const school = async (domain, name, seats, status, expiresInDays, payment = 'paid') => {
    const productId = (await q(
      `INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, variable_seats, active, sort_order) VALUES (?, 'How-to demo plan', ?, 0, 0, 0, 0, 999)`,
      [`School Building Plan (Up to ${seats} Educators)`, seats])).insertId;
    const schoolId = (await q('INSERT INTO schools (domain, district_id, display_name) VALUES (?,?,?)', [domain, districtId, name])).insertId;
    const contactId = (await q("INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?,?,?, 'Unsubscribed')", [name, `office@${domain}`, 'How-to demo'])).insertId;
    const purchaseId = (await q(
      `INSERT INTO purchases (contact_id, product_type, license_product_id, seat_count, source, payment_method, payment_status, license_status,
        school_domain, school_id, effective_date, expiration_date) VALUES (?, 'group_license', ?, ?, 'How-to demo', 'manual', ?, ?, ?, ?, ?, ?)`,
      [contactId, productId, seats, payment, status, domain, schoolId, ymd(days(expiresInDays - 365)), ymd(days(expiresInDays))])).insertId;
    return { schoolId, purchaseId, domain };
  };
  const maple = await school('maple.example.com', 'Maple Elementary', 25, 'active', 200);
  const cedar = await school('cedar.example.com', 'Cedar Middle School', 40, 'expiring_soon', 20);
  const oak = await school('oak.example.com', 'Oak Hill High School', 60, 'expired', -10);

  const admin = async (userId, purchaseId, level) =>
    q('INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?,?,?,1)', [userId, purchaseId, level]);
  const sam = await user('Sam', 'Carter', 'sam.carter@maple.example.com', 'school_license_admin');
  const pat = await user('Pat', 'Nguyen', 'pat.nguyen@maple.example.com', 'school_license_admin');
  const taylor = await user('Taylor', 'Brooks', 'taylor.brooks@cedar.example.com', 'school_license_admin');
  await admin(sam, maple.purchaseId, 'primary');
  await admin(pat, maple.purchaseId, 'secondary');
  await admin(taylor, cedar.purchaseId, 'primary');
  // An administrator who has not chosen a password yet (shows the "Pending Setup" badge).
  const jo = await db.query('INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role) VALUES (?,?,?,?,0,?)',
    ['Jo', 'Alvarez', 'jo.alvarez@cedar.example.com', hash, 'school_license_admin']).then(r => r[0].insertId);
  await admin(jo, cedar.purchaseId, 'secondary');

  const dana = await user('Dana', 'Rivera', 'dana.rivera@riverbend.example.com', 'district_admin');
  await q('INSERT INTO district_license_admins (site_user_id, district_id, is_active) VALUES (?,?,1)', [dana, districtId]);

  // Maple teachers with registered seats.
  const teachers = [['Maria', 'Lopez'], ['James', 'Okafor'], ['Priya', 'Shah'], ['Ethan', 'Brooks'], ['Hannah', 'Weiss'], ['Luis', 'Ortega']];
  for (const [f, l] of teachers) {
    const email = `${f}.${l}@maple.example.com`.toLowerCase();
    const id = await user(f, l, email, 'teacher');
    await q("INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at) VALUES (?,?, 'registered', ?, NOW())", [maple.purchaseId, email, id]);
  }
  // Maple invitations in every status the Invitations page can show.
  const invite = async (first, last, status, expiresInDays, extra = {}) => {
    const email = `${first}.${last}@maple.example.com`.toLowerCase();
    const seatStatus = status === 'pending' || status === 'opened' ? 'pending' : 'revoked';
    const seatId = (await q('INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?,?,?)', [maple.purchaseId, email, seatStatus])).insertId;
    const invId = (await q(
      `INSERT INTO school_invitations (purchase_id, seat_id, invited_email, first_name, last_name, token, status, expires_at, invited_by_site_user_id, revoked_at, revocation_reason, role_title)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [maple.purchaseId, seatId, email, first, last, crypto.randomBytes(24).toString('hex'), status, days(expiresInDays), sam,
        extra.revoked ? new Date() : null, extra.reason || null, extra.title || null])).insertId;
    await q('UPDATE license_seats SET invitation_id = ? WHERE id = ?', [invId, seatId]);
  };
  await invite('Alex', 'Kim', 'pending', 12, { title: '3rd grade teacher' });
  await invite('Jordan', 'Lee', 'opened', 9, { title: 'Music teacher' });
  await invite('Sasha', 'Bell', 'pending', 13, { title: 'Art teacher' });
  await invite('Casey', 'Nguyen', 'expired', -3, { title: 'Librarian' });
  await invite('Riley', 'Park', 'revoked', 5, { revoked: true, reason: 'Sent to the wrong address', title: 'Counselor' });

  // A little history so the dashboard's Recent Activity list is not empty.
  const audit = (action, who, email, mins) => q(
    'INSERT INTO school_audit_log (actor_type, actor_email, action, entity_type, purchase_id, school_domain, created_at) VALUES (?,?,?,?,?,?, DATE_SUB(NOW(), INTERVAL ? MINUTE))',
    ['site_user', email, action, 'invitation', maple.purchaseId, maple.domain, mins]);
  await audit('teacher_registered', 'Luis', 'luis.ortega@maple.example.com', 60 * 26);
  await audit('invitation_sent', 'Sam', 'sam.carter@maple.example.com', 60 * 5);
  await audit('invitation_sent', 'Sam', 'sam.carter@maple.example.com', 60 * 4);
  await audit('invitation_revoked', 'Sam', 'sam.carter@maple.example.com', 60 * 2);
  await audit('teacher_registered', 'Hannah', 'hannah.weiss@maple.example.com', 45);

  fs.writeFileSync(path.join(__dirname, '.env.howto.local'),
    `# Written by seed-demo.js for the throwaway test site. Git-ignored. Not real credentials.\n` +
    `HOWTO_BASE_URL=http://localhost:3002\nHOWTO_PASSWORD=${password}\nHOWTO_STAFF_USER=howto-admin\n` +
    `HOWTO_SCHOOL_ADMIN=sam.carter@maple.example.com\nHOWTO_DISTRICT_ADMIN=dana.rivera@riverbend.example.com\n` +
    `HOWTO_MAIL_API=http://localhost:8026\n`);
  console.log(`Demo data ready: district #${districtId}, schools ${maple.schoolId}/${cedar.schoolId}/${oak.schoolId}.`);
  await db.end();
})().catch((e) => { console.error('seed-demo failed:', e.message); process.exit(1); });
