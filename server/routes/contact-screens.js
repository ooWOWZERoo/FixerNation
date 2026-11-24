// The merged Contacts screen's server side (docs/reference/contact-pages-merge-requirements.md, phase 2): the list with server paging, the filters, the CSV export, email groups,
// the subscribe toggle, resend verification and delete. Mounted at /api/admin/contacts.
//
// WHY THIS IS NOT A routes/crm-*.js FILE: every crm-* route answers 404 while the Customer Hub is switched off (requireCrm). Decision D7 says the merged contact screens keep working
// with the Hub off, so these routes use requireCrmRole, the same role matrix without the off switch (lib/crm-permissions.js). The role still counts with the Hub off: a Read-only
// admin can look and nothing more, which is the access table in the requirements doc (section 5). A test checks every route here is written (path, requireAuth, requireCrmRole('<action>')).
//
// Access: view = list, filters, who-am-I; write = groups, subscribe toggle, resend verification (CRM Admin and Sales); export = CSV (CRM Admin); erase = delete a contact (CRM Admin).
// The older newsletter routes stay as they are for their other callers until each one moves.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrmRole, isCrmEnabled, ALLOWED, can } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { text, posInt } = require('../lib/crm-common');
const L = require('../lib/contact-list');
const { deleteContact, resendVerification } = require('../lib/contact-actions');

const router = express.Router();

// Who am I, what may I do, and whether the Hub's own parts (label, owner, deals, notes) are on.
router.get('/access', requireAuth, requireCrmRole('view'), async (req, res) => {
  const permissions = {};
  for (const action of Object.keys(ALLOWED)) permissions[action] = can(req.crm.role, action);
  res.json({ adminId: req.crm.adminId, role: req.crm.role, permissions, hubEnabled: await isCrmEnabled() });
});

// The email groups (with how many people are in each) and the sources in use: what the page's filters list.
router.get('/facets', requireAuth, requireCrmRole('view'), async (req, res) => {
  res.json(await L.facets());
});

// The CSV: everyone matching the same filters as the list, not just the page on screen. CRM Admin only (it carries every address and phone). Audited with the filters' names and a count, never the search text.
router.get('/export', requireAuth, requireCrmRole('export'), async (req, res) => {
  const out = await L.exportCsv(req.query, req.crm.adminId);
  const used = ['q', 'group', 'status', 'source', 'classification', 'assigned', 'role', 'license', 'organization', 'accountId', 'locked', 'includeTest'].filter(k => typeof req.query[k] === 'string' && req.query[k] !== '');
  await crmAudit(req, { action: 'crm_contacts_exported', entityType: 'crm_contact', next: { count: out.count, capped: out.capped, filters: used } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="fixer-nation-newsletter-contacts.csv"');
  res.set('Cache-Control', 'no-store');
  res.set('X-Export-Count', String(out.count));
  if (out.capped) res.set('X-Export-Capped', 'true');
  res.send(out.csv);
});

// ---- Email groups (they feed Campaigns, Morning Boost and Licenses) ----------------------------------------------------------------------------------------------
router.get('/groups', requireAuth, requireCrmRole('view'), async (req, res) => {
  res.json({ groups: (await L.facets()).groups });
});

router.post('/groups', requireAuth, requireCrmRole('write'), async (req, res) => {
  const name = text((req.body || {}).name, 128);
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  let id;
  try {
    const [r] = await pool.query('INSERT INTO contact_groups (name) VALUES (?)', [name]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || /UNIQUE/i.test(String(err.message))) return res.status(409).json({ error: 'A group with this name already exists' });
    throw err;
  }
  await crmAudit(req, { action: 'crm_contact_group_created', entityType: 'crm_contact_group', entityId: id });
  res.status(201).json({ group: { id, name } });
});

// A built-in group (Teachers, Consumers: the ones purchases put people in on their own) cannot be deleted here; the older page let it, which silently stopped new buyers being filed.
router.delete('/groups/:id', requireAuth, requireCrmRole('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[g]] = id ? await pool.query('SELECT id, system_key FROM contact_groups WHERE id = ?', [id]) : [[null]];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (g.system_key) return res.status(409).json({ code: 'system_group', error: 'Purchases fill in this built-in group on their own, so it can\'t be deleted.' });
  await pool.query('DELETE FROM contact_groups WHERE id = ?', [id]);
  await crmAudit(req, { action: 'crm_contact_group_deleted', entityType: 'crm_contact_group', entityId: id });
  res.json({ ok: true });
});

// ---- The list ----------------------------------------------------------------------------------------------------------------------------------------------
router.get('/', requireAuth, requireCrmRole('view'), async (req, res) => {
  res.json(await L.listContacts(req.query, req.crm.adminId));
});

// ---- One person --------------------------------------------------------------------------------------------------------------------------------------------
// Subscribe or unsubscribe: a marketing choice, separate from the Customer Hub label. Only the two statuses the older page used.
router.put('/:id/subscription', requireAuth, requireCrmRole('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const status = (req.body || {}).status;
  if (typeof status !== 'string' || !L.STATUSES.includes(status)) return res.status(400).json({ error: 'Status must be Subscribed or Unsubscribed.' });
  const [[c]] = id ? await pool.query('SELECT id, status FROM newsletter_contacts WHERE id = ?', [id]) : [[null]];
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  if (c.status !== status) {
    await pool.query('UPDATE newsletter_contacts SET status = ? WHERE id = ?', [status, id]);
    await crmAudit(req, { action: 'crm_contact_subscription_changed', entityType: 'crm_contact', entityId: id, prev: { status: c.status }, next: { status } });
  }
  res.json({ ok: true, status, changed: c.status !== status });
});

router.post('/:id/resend-verification', requireAuth, requireCrmRole('write'), async (req, res) => {
  const r = await resendVerification(posInt(req.params.id));
  res.status(r.status).json(r.body);
});

// Delete a person. CRM Admin only. Every rule is in lib/contact-actions.js (shared with the older page): a buyer or a person on a deal is refused, CRM notes need the confirm to erase,
// a sign-in account is closed (with a confirm when it holds a seat or a role), a staff account is refused.
router.delete('/:id', requireAuth, requireCrmRole('erase'), async (req, res) => {
  const id = posInt(req.params.id);
  if (!id) return res.status(404).json({ error: 'Contact not found' });
  const r = await deleteContact(id, req.body, req.user);
  if (r.status === 200) await crmAudit(req, { action: 'crm_contact_deleted', entityType: 'crm_contact', entityId: id, next: { accountClosed: !!r.body.accountClosed, erasedItems: r.body.erasedItems || 0 } });
  res.status(r.status).json(r.body);
});

module.exports = router;
