// Closing and reopening a sign-in account (docs/reference/crm-record-of-truth-requirements.md, rules B and C). The CRM is the record of
// who is on the platform, so deleting a CRM contact that has a sign-in account closes the account: it signs out everywhere, cannot sign in
// again, gives up its license seat and administrator roles, and leaves Community. Reopening brings back the account only (a person
// signing in again), not the seat, roles or groups: staff re-add those on purpose.
//
// Plain portable SQL so it runs in the node:sqlite tests as well as MariaDB. Functions take `db`: the pool, or a connection that is
// already inside a transaction (the CRM delete uses one so closing the account and deleting the contact succeed or fail together).

// What closing this account would take away, for the confirmation dialog and for deciding whether staff must confirm.
async function describeConsequences(db, siteUserId) {
  const [seats] = await db.query(
    `SELECT p.school_domain FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id
     WHERE ls.registered_site_user_id = ? AND ls.status = 'registered'`, [siteUserId]);
  const [schoolAdmin] = await db.query(
    `SELECT p.school_domain FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id
     WHERE sla.site_user_id = ? AND sla.is_active = 1`, [siteUserId]);
  const [districtAdmin] = await db.query(
    `SELECT d.name FROM district_license_admins dla JOIN districts d ON d.id = dla.district_id
     WHERE dla.site_user_id = ? AND dla.is_active = 1`, [siteUserId]);
  const [affiliate] = await db.query("SELECT 1 AS yes FROM affiliates WHERE site_user_id = ? AND status = 'active'", [siteUserId]);
  return {
    seats: seats.map((r) => r.school_domain || 'an individual license'),
    schoolAdmin: schoolAdmin.map((r) => r.school_domain || 'a school'),
    districtAdmin: districtAdmin.map((r) => r.name),
    affiliate: affiliate.length > 0,
  };
}

const hasRoles = (c) => !!(c.seats.length || c.schoolAdmin.length || c.districtAdmin.length || c.affiliate);

// A sentence for staff: "Cheryl Herman holds a license seat at x, is a school administrator for y, ..."
function consequencesText(name, c) {
  const parts = [];
  if (c.seats.length) parts.push(`holds a license seat (${c.seats.join(', ')}), which goes back to the school's pool`);
  if (c.schoolAdmin.length) parts.push(`is a school license administrator for ${c.schoolAdmin.join(', ')}`);
  if (c.districtAdmin.length) parts.push(`is a district administrator for ${c.districtAdmin.join(', ')}`);
  if (c.affiliate) parts.push('has an affiliate account (it is left as it is)');
  return `${name || 'This person'} ${parts.join('; ')}. Deleting this contact closes their account: they are signed out, cannot sign in again, and lose these. Reopening later restores the account only.`;
}

// Closes the account. Returns { closed: false } when there is nothing to close (no account, or already closed).
async function closeAccount(db, siteUserId, { reason = 'crm_contact_deleted', actorType = 'admin', actorId = null, actorEmail = null } = {}) {
  const [[user]] = await db.query('SELECT id, email, closed_at FROM site_users WHERE id = ?', [siteUserId]);
  if (!user || user.closed_at) return { closed: false };
  const email = String(user.email || '').toLowerCase();

  // signed out everywhere now: every session token issued before this moment stops working
  await db.query('UPDATE site_users SET closed_at = CURRENT_TIMESTAMP, closed_reason = ?, session_invalidated_at = CURRENT_TIMESTAMP WHERE id = ?', [reason, siteUserId]);
  // license seats back to the school's pool: the one they registered, and any still waiting for this address
  await db.query(
    `UPDATE license_seats SET status = 'available', invited_email = NULL, registered_site_user_id = NULL, registered_at = NULL, invitation_id = NULL
     WHERE registered_site_user_id = ?`, [siteUserId]);
  await db.query(
    `UPDATE license_seats SET status = 'available', invited_email = NULL, invitation_id = NULL
     WHERE LOWER(invited_email) = ? AND status = 'pending'`, [email]);
  await db.query("UPDATE school_invitations SET status = 'revoked' WHERE LOWER(invited_email) = ? AND status NOT IN ('registered', 'revoked', 'expired')", [email]);
  await db.query('UPDATE school_license_admins SET is_active = 0 WHERE site_user_id = ? AND is_active = 1', [siteUserId]);
  await db.query('UPDATE district_license_admins SET is_active = 0 WHERE site_user_id = ? AND is_active = 1', [siteUserId]);
  await db.query('DELETE FROM social_group_members WHERE user_id = ?', [siteUserId]);
  await db.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, reason) VALUES (?, ?, ?, 'account_closed', 'site_users', ?, ?)`,
    [actorType, actorId, actorEmail, siteUserId, reason]);
  return { closed: true };
}

// Reopens a closed account. It needs a CRM contact (the CRM is the record of who is on the platform), so one is created if missing, as
// Unsubscribed: deleting a contact is not consent to be mailed again. Seats, roles and groups are not restored.
async function reopenAccount(db, siteUserId, { actorType = 'admin', actorId = null, actorEmail = null } = {}) {
  const [[user]] = await db.query('SELECT id, email, first_name, last_name, closed_at FROM site_users WHERE id = ?', [siteUserId]);
  if (!user || !user.closed_at) return { reopened: false };
  const [[contact]] = await db.query('SELECT id FROM newsletter_contacts WHERE LOWER(email) = LOWER(?)', [user.email]);
  let contactCreated = false;
  if (!contact) {
    await db.query("INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'Reopened account', 'Unsubscribed')",
      [[user.first_name, user.last_name].filter(Boolean).join(' '), String(user.email).toLowerCase()]);
    contactCreated = true;
  }
  await db.query('UPDATE site_users SET closed_at = NULL, closed_reason = NULL WHERE id = ?', [siteUserId]);
  await db.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id) VALUES (?, ?, ?, 'account_reopened', 'site_users', ?)`,
    [actorType, actorId, actorEmail, siteUserId]);
  return { reopened: true, contactCreated };
}

module.exports = { describeConsequences, consequencesText, hasRoles, closeAccount, reopenAccount };
