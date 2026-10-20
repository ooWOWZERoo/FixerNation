require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// One-time cleanup for credentials that were committed to this (public) repo.
// seed-qa-test-accounts.js used to hard-code the QA password and student PIN, and
// it created real accounts in the production database -- including a licensed
// teacher and school/district admins. Anyone reading the repo could sign in as them.
//
//   node scripts/rotate-qa-test-credentials.js            dry run: lists what WOULD change
//   node scripts/rotate-qa-test-credentials.js --apply    rotates, and prints the new values ONCE
//
// Set QA_PASSWORD / QA_PIN in the environment to choose the values; otherwise random
// ones are generated. Also revokes every existing session for these accounts.
// Only touches site_users whose email matches qa-%@example.com and
// classroom_students whose username matches qa-%.
const APPLY = process.argv.includes('--apply');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [users] = await conn.query("SELECT id, email, role FROM site_users WHERE email LIKE 'qa-%@example.com' ORDER BY email");
  const [students] = await conn.query("SELECT id, username FROM classroom_students WHERE username LIKE 'qa-%' ORDER BY username");
  const [others] = await conn.query("SELECT id, email FROM site_users WHERE email LIKE '%@example.com' AND email NOT LIKE 'qa-%@example.com' ORDER BY email LIMIT 50");

  console.log(`site_users matching qa-%@example.com: ${users.length}`);
  users.forEach(u => console.log(`  #${u.id}  ${u.email}  (${u.role})`));
  console.log(`classroom_students matching qa-%: ${students.length}`);
  students.forEach(s => console.log(`  #${s.id}  ${s.username}`));
  if (others.length) {
    console.log(`\nOther @example.com site_users NOT touched (review by hand -- test debris?): ${others.length}`);
    others.forEach(u => console.log(`  #${u.id}  ${u.email}`));
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to rotate the accounts listed above.');
    await conn.end();
    return;
  }

  const password = process.env.QA_PASSWORD || 'Qa!' + crypto.randomBytes(12).toString('base64url');
  const pin = process.env.QA_PIN || String(crypto.randomInt(100000, 1000000));
  if (password.length < 12 || !/^\d{6}$/.test(pin)) throw new Error('QA_PASSWORD must be 12+ chars and QA_PIN exactly 6 digits.');

  const passwordHash = await bcrypt.hash(password, 12);
  const pinHash = await bcrypt.hash(pin, 10);
  const [u] = await conn.query("UPDATE site_users SET password_hash = ?, session_invalidated_at = NOW() WHERE email LIKE 'qa-%@example.com'", [passwordHash]);
  const [s] = await conn.query("UPDATE classroom_students SET password_hash = ? WHERE username LIKE 'qa-%'", [pinHash]);

  console.log(`\nRotated ${u.affectedRows} site_users and ${s.affectedRows} classroom_students; existing sessions revoked.`);
  console.log('New values (shown once -- put them in tests/.env.test as TEST_QA_PASSWORD / TEST_QA_PIN, never in the repo):');
  console.log('  password:', password);
  console.log('  pin:     ', pin);
  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
