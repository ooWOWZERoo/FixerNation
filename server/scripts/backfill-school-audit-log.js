// Idempotent backfill script: writes school_audit_log entries for teacher activity
// that predates going-forward logging in school-registration.js and school-invite.js.
//
// Run once after deploying:
//   node scripts/backfill-school-audit-log.js
//
// Safe to re-run — each INSERT checks for an existing matching row first.
// Covers the last 6 months of completed registrations and revocations.
// Pending self-registrations are included in full (no creation date to filter on).

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');

async function run() {
  // 1. Pending self-registrations: seats with no invitation row, any date
  const [pendingSeats] = await pool.query(
    `SELECT ls.id AS seat_id, ls.purchase_id, ls.invited_email,
            p.school_domain
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     LEFT JOIN school_invitations si ON si.seat_id = ls.id
     WHERE ls.status = 'pending' AND si.id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM school_audit_log
         WHERE action = 'teacher_self_registered'
           AND entity_type = 'seat'
           AND entity_id = ls.id
       )`
  );

  let inserted = 0;
  for (const r of pendingSeats) {
    await pool.query(
      `INSERT INTO school_audit_log
         (actor_type, actor_email, action, entity_type, entity_id, purchase_id, school_domain)
       VALUES ('teacher', ?, 'teacher_self_registered', 'seat', ?, ?, ?)`,
      [r.invited_email, r.seat_id, r.purchase_id, r.school_domain]
    );
    inserted++;
  }
  console.log(`teacher_self_registered: ${inserted} rows inserted (${pendingSeats.length} found)`);

  // 2. Completed registrations in the last 6 months
  const [regSeats] = await pool.query(
    `SELECT ls.id AS seat_id, ls.purchase_id, ls.registered_site_user_id,
            ls.registered_at, p.school_domain,
            su.email AS teacher_email
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.status IN ('registered', 'inactive', 'revoked')
       AND ls.registered_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       AND NOT EXISTS (
         SELECT 1 FROM school_audit_log
         WHERE action = 'teacher_registered'
           AND entity_type = 'site_user'
           AND entity_id = ls.registered_site_user_id
           AND purchase_id = ls.purchase_id
       )`
  );

  inserted = 0;
  for (const r of regSeats) {
    await pool.query(
      `INSERT INTO school_audit_log
         (actor_type, actor_id, actor_email, action, entity_type, entity_id, purchase_id, school_domain, created_at)
       VALUES ('teacher', ?, ?, 'teacher_registered', 'site_user', ?, ?, ?, ?)`,
      [r.registered_site_user_id, r.teacher_email, r.registered_site_user_id, r.purchase_id, r.school_domain, r.registered_at]
    );
    inserted++;
  }
  console.log(`teacher_registered: ${inserted} rows inserted (${regSeats.length} found)`);

  // 3. Teacher removals (revoked seats that had a registered user) in the last 6 months
  const [revokedSeats] = await pool.query(
    `SELECT ls.id AS seat_id, ls.purchase_id, ls.registered_site_user_id,
            ls.revoked_at, ls.revocation_reason, p.school_domain,
            su.email AS teacher_email,
            rev.email AS revoker_email
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     JOIN site_users su ON su.id = ls.registered_site_user_id
     LEFT JOIN site_users rev ON rev.id = ls.revoked_by
     WHERE ls.status = 'revoked'
       AND ls.registered_site_user_id IS NOT NULL
       AND ls.revoked_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       AND NOT EXISTS (
         SELECT 1 FROM school_audit_log
         WHERE action = 'teacher_removed'
           AND entity_type = 'site_user'
           AND entity_id = ls.registered_site_user_id
           AND purchase_id = ls.purchase_id
       )`
  );

  inserted = 0;
  for (const r of revokedSeats) {
    await pool.query(
      `INSERT INTO school_audit_log
         (actor_type, actor_email, action, entity_type, entity_id, purchase_id, school_domain, reason, created_at)
       VALUES ('admin', ?, 'teacher_removed', 'site_user', ?, ?, ?, ?, ?)`,
      [r.revoker_email || null, r.registered_site_user_id, r.purchase_id, r.school_domain, r.revocation_reason || null, r.revoked_at]
    );
    inserted++;
  }
  console.log(`teacher_removed: ${inserted} rows inserted (${revokedSeats.length} found)`);

  await pool.end();
  console.log('Backfill complete.');
}

run().catch(err => { console.error(err); process.exit(1); });
