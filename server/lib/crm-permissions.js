// Sales CRM roles and the on/off switch (docs/reference/sales-crm-update-requirements.md, section 4 and decisions D1, D10).
//
// A CRM role lives on admin_users.crm_role ('admin' | 'sales' | 'readonly'). Every existing admin became 'admin' in the migration, so nothing changes for
// anyone until the owner lowers a role. requireCrm gates the /api/crm routes; requireCrmRole (below) applies the same matrix to the few older admin routes that move access or money
// (admin accounts, quote edit and send, accept-for-customer; punch list S1-S4). The other older routes (contacts, orders, invoices) are still open to any admin.
// is_fne_staff (a Community flag on site_users) grants nothing here, and a site user never reaches these routes: they all sit behind requireAuth (admin cookie).
//
// The matrix below is the single source of truth. A test walks it, and every route names the action it needs.
//
//   action               admin   sales                          readonly
//   view                 yes     yes                            yes
//   write                yes     yes                            -
//   edit_deal            yes     own deals and unassigned ones  -     (create, edit, move stage, close)
//   promote_prospect     yes     yes                            -
//   reopen_deal          yes     -                              -
//   set_customer         yes     -                              -     (override with evidence)
//   override_probability yes     -                              -
//   edit_settings        yes     -                              -     (stages, probabilities, loss reasons)
//   merge                yes     -                              -
//   assign_roles         yes     -                              -
//   audit_view           yes     -                              -
//   export               yes     -                              -
//   erase                yes     -                              -     (punch list S12: delete a meeting; erase a person's CRM notes, tasks, files and meetings along with the person)
//   files                yes     yes (then the subject check)   -     (see, upload, download or delete a file; Read-only never opens one)
//   accept_for_customer  yes     -                              -     (phase 4c: accept a quote by PO for the customer when closing a deal Won; it creates a purchase, invoice and license)
//   edit_quote_price     yes     -                              -     (change the price, product or seats of a quote that was already sent)
//   raise_refund         yes     yes                            -     (punch list G21: flag a purchase as refunded or disputed by hand; it only raises a flag)
//   decide_refund        yes     -                              -     (G21: confirm or dismiss a refund flag; a confirmed full refund stops the purchase counting as paid in the CRM)
//   email_demo           yes     yes                            -     (email a prospect demo invitation from Sales > Demo; docs/reference/demo-invitation-email-requirements.md)
//   manage_purchases     yes     -                              -     (merge phase 4: add, edit, mark paid or delete a purchase by hand, and assign, register or free a license seat, from a person's page; it moves money and access)
//   decide_repeat        yes     the owner of the request's deal  -     (punch list G5: approve or decline a district's reorder or seat-change request; the route checks the deal owner. A deal nobody owns: CRM Admin only)
//
// The older admin routes use requireCrmRole (below) with the same matrix: admin accounts need assign_roles, a quote edit or send needs write (and
// edit_quote_price once the quote was sent), and accepting a quote for the customer needs accept_for_customer. Punch list S1-S4.
//
// Phase 3 (tasks, notes, files, meetings, checklists, Needs Attention) adds one more gate on top of this table: whether the person may write THE SUBJECT
// the item belongs to (canWriteSubject below). The full role x action matrix for phase 3 is in docs/reference/sales-crm-update-requirements.md, section 6.

const pool = require('../db/pool');
const { getSetting } = require('./settings');

const ROLES = ['admin', 'sales', 'readonly'];

const ALLOWED = {
  view: ['admin', 'sales', 'readonly'],
  write: ['admin', 'sales'],
  edit_deal: ['admin', 'sales'],
  promote_prospect: ['admin', 'sales'],
  reopen_deal: ['admin'],
  set_customer: ['admin'],
  override_probability: ['admin'],
  edit_settings: ['admin'],
  merge: ['admin'],
  assign_roles: ['admin'],
  audit_view: ['admin'],
  export: ['admin'],
  erase: ['admin'],
  files: ['admin', 'sales'],
  accept_for_customer: ['admin'],
  edit_quote_price: ['admin'],
  raise_refund: ['admin', 'sales'],
  decide_refund: ['admin'],
  decide_repeat: ['admin', 'sales'],
  email_demo: ['admin', 'sales'],
  manage_purchases: ['admin'],
};

function can(role, action) {
  return Array.isArray(ALLOWED[action]) && ALLOWED[action].includes(role);
}

// Sales may change a deal they own or one nobody owns yet (so a new inquiry can be picked up); the CRM Admin may change any.
function canEditDeal(role, adminId, opportunity) {
  if (role === 'admin') return true;
  if (role !== 'sales') return false;
  return opportunity.owner_admin_id === null || opportunity.owner_admin_id === undefined || Number(opportunity.owner_admin_id) === Number(adminId);
}

// Phase 3: may this role change an item that belongs to a deal, an account or a contact? CRM Admin: always. Sales: a deal they own or nobody owns yet (canEditDeal),
// and any account or contact. Read-only: never. `subject` is { kind: 'opportunity' | 'account' | 'contact', dealOwnerAdminId } (dealOwnerAdminId only matters for a deal).
function canWriteSubject(role, adminId, subject) {
  if (role === 'admin') return true;
  if (role !== 'sales') return false;
  if (subject.kind === 'opportunity') return canEditDeal(role, adminId, { owner_admin_id: subject.dealOwnerAdminId === undefined ? null : subject.dealOwnerAdminId });
  return true;
}

// D10: one setting, read on every request. Absent or anything but 'true' means off, and every CRM route answers 404.
async function isCrmEnabled() {
  return (await getSetting('crm_v2_enabled')) === 'true';
}

// null means the column is not there yet (the alter script has not been run), which is different from a bad role.
async function loadCrmRole(adminId) {
  try {
    const [[row]] = await pool.query('SELECT crm_role FROM admin_users WHERE id = ?', [adminId]);
    return row ? (row.crm_role || 'admin') : undefined;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return null;
    throw err;
  }
}

// Use after requireAuth: router.get('/x', requireAuth, requireCrm('view'), handler). Sets req.crm = { role, adminId }.
function requireCrm(action) {
  if (!ALLOWED[action]) throw new Error(`requireCrm: unknown action "${action}"`);
  return async function crmGate(req, res, next) {
    if (!(await isCrmEnabled())) return res.status(404).json({ error: 'Not found' });
    const adminId = req.user && req.user.userId;
    const role = await loadCrmRole(adminId);
    if (role === null) return res.status(503).json({ error: 'The Sales CRM is not set up on this server yet.' });
    if (!role || !ROLES.includes(role)) return res.status(403).json({ error: 'You do not have a Sales CRM role.' });
    if (!can(role, action)) return res.status(403).json({ error: 'Your Sales CRM role does not allow this.' });
    req.crm = { role, adminId };
    next();
  };
}

// For the OLDER admin routes (admin accounts, quotes, concierge) that live outside /api/crm. Same role matrix, but it does NOT answer 404 while the Hub is off:
// those pages must keep working with the Hub off, and a lowered role must not stop counting just because the switch was flipped. Before the alter script has
// run (no crm_role column) it lets everyone through, as before. Sets req.crm = { role, adminId }.
function requireCrmRole(action) {
  if (!ALLOWED[action]) throw new Error(`requireCrmRole: unknown action "${action}"`);
  return async function crmRoleGate(req, res, next) {
    try {
      const adminId = req.user && req.user.userId;
      const role = await loadCrmRole(adminId);
      if (role === null) { req.crm = { role: 'admin', adminId }; return next(); }
      if (!role || !ROLES.includes(role)) return res.status(403).json({ error: 'You do not have a Sales CRM role.' });
      if (!can(role, action)) return res.status(403).json({ error: 'Your Sales CRM role does not allow this. Ask a CRM Admin.' });
      req.crm = { role, adminId };
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { ROLES, ALLOWED, can, canEditDeal, canWriteSubject, isCrmEnabled, loadCrmRole, requireCrm, requireCrmRole };
