// Sales CRM audit trail (decision D6): a thin wrapper over lib/audit.js, which writes school_audit_log. CRM events use entity types from
// CRM_ENTITY_TYPES, one actor spelling ('admin_user'), and never set purchase_id or school_domain, so no school or district view can show them.
const { audit } = require('./audit');
const pool = require('../db/pool');
const { clientIp } = require('./rate-limit');

// req.crm and req.user come from requireAuth + requireCrm. Fire-and-forget like audit() itself: a logging failure never fails the action.
async function crmAudit(req, { action, entityType, entityId, prev, next, reason }) {
  let actorEmail = null;
  try {
    const [[row]] = await pool.query('SELECT email FROM admin_users WHERE id = ?', [req.user.userId]);
    actorEmail = row ? row.email : null;
  } catch { /* the email is a convenience */ }
  await audit(pool, {
    actorType: 'admin_user', actorId: req.user.userId, actorEmail,
    action, entityType, entityId,
    prevValue: prev, newValue: next, reason,
    ipAddress: clientIp(req) || null,
  });
}

module.exports = { crmAudit };
