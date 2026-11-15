// Closing a deal Won, the one way (Sales CRM phase 4c). Used by the customer-accepts hook and by the staff Won handoff. It changes the DEAL only: it never creates
// a purchase, an invoice or a license, and it never sets a contact's label (that stays lib/crm-classification.js, from a paid purchase).
// Compare-and-set on the deal's state, so two callers at once close it once. Returns true when this call closed it, false when it was not open any more.
const { sqlNow } = require('./crm-classification');
const { audit } = require('./audit');

async function closeDealWon(db, dealId, { actorAdminId = null, reason = null, actorEmail = null } = {}) {
  const [[won]] = await db.query("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'won'");
  if (!won) return false;
  const [[o]] = await db.query('SELECT id, stage_id, state FROM crm_opportunities WHERE id = ?', [dealId]);
  if (!o || o.state !== 'open') return false;
  const now = sqlNow();
  const [r] = await db.query("UPDATE crm_opportunities SET state = 'won', closed_at = ?, stage_id = ?, stage_entered_at = ? WHERE id = ? AND state = 'open'", [now, won.id, now, o.id]);
  if (!r.affectedRows) return false;
  await db.query(
    `INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, actor_admin_id, reason, created_at) VALUES (?, ?, ?, 'open', 'won', ?, ?, ?)`,
    [o.id, o.stage_id, won.id, actorAdminId || null, reason ? String(reason).slice(0, 255) : null, now]
  );
  await audit(db, {
    actorType: actorAdminId ? 'admin_user' : 'system', actorId: actorAdminId || null, actorEmail,
    action: 'crm_opportunity_closed', entityType: 'crm_opportunity', entityId: o.id, prevValue: { state: 'open' }, newValue: { state: 'won' }, reason,
  });
  return true;
}

module.exports = { closeDealWon };
