// Shared audit-log helper — extracted from routes/school-admin.js (the table's
// original and, until now, only writer) so the affiliate program (stage 3.5c)
// doesn't duplicate it into a second near-identical table. Per CLAUDE.md:
// "always extract there when two route files would otherwise need to require
// each other." No behavior changed in the move — same signature, same
// fire-and-forget contract.
//
// school_audit_log's name predates this reuse and is domain-agnostic in
// practice (actor_type/actor_id/action/entity_type/entity_id are all
// generic); purchase_id/school_domain are nullable extras that simply don't
// apply outside the school/district-admin and affiliate-commission contexts.
// A truly generic name wasn't chosen for this file because renaming the live
// table is a bigger, unrelated change — flagged, not done here.
async function audit(conn, { actorType, actorId, actorEmail, action, entityType, entityId, purchaseId, schoolDomain, prevValue, newValue, reason, ipAddress }) {
  try {
    await conn.query(
      `INSERT INTO school_audit_log
         (actor_type, actor_id, actor_email, action, entity_type, entity_id,
          purchase_id, school_domain, prev_value, new_value, reason, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorType, actorId || null, actorEmail || null,
        action, entityType || null, entityId || null,
        purchaseId || null, schoolDomain || null,
        prevValue ? JSON.stringify(prevValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        reason || null,
        ipAddress || null,
      ]
    );
  } catch (e) {
    console.error('audit log error:', e.message);
  }
}

// entity_type values the affiliate program writes into school_audit_log.
// Shared in both directions: routes/affiliates.js's own audit-log view
// filters TO these values (GET /api/affiliates/audit-log); school-admin.js's
// purchase-scoped audit views filter them OUT. Both need the same list kept
// in exactly one place — a commission's payout_reference is real, sensitive
// data (someone's payment reference), and a school license admin viewing
// "activity for this purchase" must never see it just because the purchase
// happened to be referred by an affiliate.
const AFFILIATE_ENTITY_TYPES = ['affiliate', 'affiliate_application', 'affiliate_commission', 'affiliate_territory'];

module.exports = { audit, AFFILIATE_ENTITY_TYPES };
