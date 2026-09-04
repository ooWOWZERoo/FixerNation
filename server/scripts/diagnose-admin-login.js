// Read-only — checks both possible auth systems for a given email/username,
// since "admin dashboard" is ambiguous between FNE-staff (admin_users,
// fn_session) and a school/district license admin (site_users,
// fn_user_session) — these are two completely separate systems, and a
// password reset on one never affects login on the other.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const identifier = process.argv[2];
if (!identifier) {
  console.error('Usage: node scripts/diagnose-admin-login.js <email-or-username>');
  process.exit(1);
}

async function main() {
  console.log(`\n=== Checking "${identifier}" ===\n`);

  const [adminRows] = await pool.query(
    'SELECT id, username, email, email_verified, created_at FROM admin_users WHERE username = ? OR email = ?',
    [identifier, identifier]
  );
  console.log(`admin_users (FNE staff, fn_session): ${adminRows.length} match(es)`);
  for (const a of adminRows) {
    console.log(`  id=${a.id} username=${a.username} email=${a.email} email_verified=${a.email_verified} created_at=${a.created_at}`);
    const [tokens] = await pool.query(
      'SELECT id, expires_at, expires_at > NOW() AS still_valid, created_at FROM admin_invite_tokens WHERE admin_id = ? ORDER BY created_at DESC',
      [a.id]
    );
    console.log(`  admin_invite_tokens for this admin: ${tokens.length}`);
    tokens.forEach(t => console.log(`    id=${t.id} created_at=${t.created_at} expires_at=${t.expires_at} still_valid=${!!t.still_valid}`));
  }

  const [siteRows] = await pool.query(
    'SELECT id, first_name, last_name, email, email_verified, role, session_invalidated_at, created_at FROM site_users WHERE email = ?',
    [identifier]
  );
  console.log(`\nsite_users (teacher/parent/school-admin/district-admin, fn_user_session): ${siteRows.length} match(es)`);
  for (const s of siteRows) {
    console.log(`  id=${s.id} name=${s.first_name} ${s.last_name} email=${s.email} role=${s.role} email_verified=${s.email_verified} session_invalidated_at=${s.session_invalidated_at}`);

    const [schoolAssign] = await pool.query(
      `SELECT sla.id, sla.purchase_id, sla.is_active, sla.permission_level, p.school_domain
       FROM school_license_admins sla LEFT JOIN purchases p ON p.id = sla.purchase_id
       WHERE sla.site_user_id = ?`,
      [s.id]
    );
    console.log(`  school_license_admins rows: ${schoolAssign.length}`);
    schoolAssign.forEach(r => console.log(`    purchase_id=${r.purchase_id} school=${r.school_domain} is_active=${r.is_active} level=${r.permission_level}`));

    const [districtAssign] = await pool.query(
      `SELECT dla.id, dla.district_id, dla.is_active, d.name
       FROM district_license_admins dla LEFT JOIN districts d ON d.id = dla.district_id
       WHERE dla.site_user_id = ?`,
      [s.id]
    );
    console.log(`  district_license_admins rows: ${districtAssign.length}`);
    districtAssign.forEach(r => console.log(`    district_id=${r.district_id} name=${r.name} is_active=${r.is_active}`));

    const [tokens] = await pool.query(
      'SELECT id, type, expires_at, expires_at > NOW() AS still_valid, created_at FROM site_user_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [s.id]
    );
    console.log(`  recent site_user_tokens: ${tokens.length}`);
    tokens.forEach(t => console.log(`    id=${t.id} type=${t.type} created_at=${t.created_at} expires_at=${t.expires_at} still_valid=${!!t.still_valid}`));
  }

  if (!adminRows.length && !siteRows.length) {
    console.log('\nNo account found in either table with that email/username.');
  }

  console.log('');
  await pool.end();
}

main().catch(err => {
  console.error('Diagnostic failed:', err.message);
  process.exit(1);
});
