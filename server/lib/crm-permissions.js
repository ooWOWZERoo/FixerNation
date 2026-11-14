// Sales CRM roles and the on/off switch (docs/reference/sales-crm-update-requirements.md, section 4 and decisions D1, D10).
//
// A CRM role lives on admin_users.crm_role ('admin' | 'sales' | 'readonly'). Every existing admin became 'admin' in the migration, so nothing changes for
// anyone until the owner lowers a role. The role gates ONLY the /api/crm routes; the older admin routes (contacts, quotes, orders, invoices) are unchanged.
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

module.exports = { ROLES, ALLOWED, can, canEditDeal, isCrmEnabled, loadCrmRole, requireCrm };
