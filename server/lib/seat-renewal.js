// When a school (or trial) license expires, the nightly job turns every seat off and tags it with this reason, so a
// renewal can bring back exactly those seats and not the ones a school admin switched off on purpose.
// Nothing else (classrooms, rosters, lesson picks) is touched at expiry, so restoring the seats restores access.
const EXPIRED_REASON = 'license_expired';

// License statuses a staff member can renew into. 'pending', 'expired', 'cancelled' and 'suspended' keep access closed.
const RENEWED_STATUSES = ['active', 'expiring_soon', 'scheduled'];

// Puts back each seat that expiry switched off: a seat with a teacher on it becomes 'registered' again; an unaccepted
// invitation goes back to 'pending'; an unclaimed seat goes back to 'available'. Returns how many seats came back.
// `db` is the pool or a transaction connection. Safe to run twice: the second run finds nothing tagged.
async function restoreExpiredSeats(db, purchaseId) {
  const [result] = await db.query(
    `UPDATE license_seats
     SET status = CASE WHEN registered_site_user_id IS NOT NULL THEN 'registered'
                       WHEN invited_email IS NOT NULL THEN 'pending'
                       ELSE 'available' END,
         inactive_reason = NULL
     WHERE purchase_id = ? AND status = 'inactive' AND inactive_reason = ?`,
    [purchaseId, EXPIRED_REASON]
  );
  return result.affectedRows;
}

module.exports = { EXPIRED_REASON, RENEWED_STATUSES, restoreExpiredSeats };
