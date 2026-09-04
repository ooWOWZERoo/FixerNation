// Read-only — full history for a specific school_license_admins assignment
// (purchase + audit trail), to figure out why/when it went inactive before
// deciding whether reactivating it is safe.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const purchaseId = Number(process.argv[2]);
const siteUserId = Number(process.argv[3]);
if (!purchaseId || !siteUserId) {
  console.error('Usage: node scripts/diagnose-school-admin-assignment.js <purchaseId> <siteUserId>');
  process.exit(1);
}

async function main() {
  const [[purchase]] = await pool.query(
    `SELECT p.id, p.school_domain, p.seat_count, p.payment_status, p.license_status,
            p.effective_date, p.expiration_date, s.domain AS school_table_domain
     FROM purchases p LEFT JOIN schools s ON s.id = p.school_id
     WHERE p.id = ?`,
    [purchaseId]
  );
  console.log('=== Purchase ===');
  console.log(purchase || 'NOT FOUND');

  const [assignments] = await pool.query(
    'SELECT * FROM school_license_admins WHERE purchase_id = ? ORDER BY id',
    [purchaseId]
  );
  console.log(`\n=== All school_license_admins rows for purchase ${purchaseId} (${assignments.length}) ===`);
  assignments.forEach(a => console.log(a));

  const [seats] = await pool.query(
    `SELECT ls.id, ls.status, ls.invited_email, ls.registered_at, su.id AS site_user_id, su.email, su.role
     FROM license_seats ls LEFT JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.purchase_id = ?`,
    [purchaseId]
  );
  console.log(`\n=== Seats on this purchase (${seats.length}) ===`);
  seats.forEach(s => console.log(s));

  const [audit] = await pool.query(
    `SELECT id, actor_type, actor_email, action, entity_type, entity_id, reason, prev_value, new_value, created_at
     FROM school_audit_log
     WHERE purchase_id = ?
        OR (entity_type = 'school_license_admins' AND entity_id IN (SELECT id FROM school_license_admins WHERE purchase_id = ?))
     ORDER BY created_at`,
    [purchaseId, purchaseId]
  );
  console.log(`\n=== school_audit_log entries for purchase ${purchaseId} (${audit.length}) ===`);
  audit.forEach(a => console.log(a));

  await pool.end();
}

main().catch(err => {
  console.error('Diagnostic failed:', err.message);
  process.exit(1);
});
