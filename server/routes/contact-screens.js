// The merged Contacts screen's server side (docs/reference/contact-pages-merge-requirements.md, phase 2): the list with server paging, the filters, the CSV export, email groups,
// the subscribe toggle, resend verification and delete. Mounted at /api/admin/contacts.
//
// WHY THIS IS NOT A routes/crm-*.js FILE: every crm-* route answers 404 while the Customer Hub is switched off (requireCrm). Decision D7 says the merged contact screens keep working
// with the Hub off, so these routes use requireCrmRole, the same role matrix without the off switch (lib/crm-permissions.js). The role still counts with the Hub off: a Read-only
// admin can look and nothing more, which is the access table in the requirements doc (section 5). A test checks every route here is written (path, requireAuth, requireCrmRole('<action>')).
//
// Access: view = list, filters, who-am-I, a person's card and roles; write = edit a person, add a person, groups, subscribe toggle, resend verification, send a password reset (CRM Admin and Sales);
// export = CSV (CRM Admin); erase = delete a contact, delete a sign-in account (CRM Admin).
// The older newsletter routes stay as they are for their other callers until each one moves.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrmRole, isCrmEnabled, ALLOWED, can } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { text, posInt } = require('../lib/crm-common');
const L = require('../lib/contact-list');
const { deleteContact, resendVerification } = require('../lib/contact-actions');
const { updateContact, createContact, EMAIL_PATTERN } = require('../lib/contact-edit');
const { attachGroups, attachSiteUserInfo, serialize } = require('../lib/contact-records');
const { rolesForContact } = require('../lib/contact-roles');
const accountActions = require('../lib/contact-account');
const { matchingContacts } = require('../lib/crm-quotes');
const cls = require('../lib/crm-classification');

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

// ---- One person's card (phase 3: everything the older Edit Contact box showed and saved) ---------------------------------------------------------------------------------
const STATUS_LIST = L.STATUSES;
const LIMITS = { name: 255, phone: 32, company: 255, source: 100, notes: 15000 };
const ADDRESS_LIMITS = { street: 255, city: 128, state: 64, zip: 16 };

// What the browser sent, checked and cut to size. Returns { body } or { error }. Only keys that were sent are kept (the edit changes only those). typeof is checked first because
// RegExp.test() and String() coerce undefined and objects (CLAUDE.md).
async function cleanCardBody(b) {
  b = b && typeof b === 'object' ? b : {};
  const out = {};
  for (const k of Object.keys(LIMITS)) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string') return { error: `${k} must be text.` };
    out[k] = b[k].trim().slice(0, LIMITS[k]);
  }
  if (b.email !== undefined) {
    if (typeof b.email !== 'string' || !EMAIL_PATTERN.test(b.email.trim()) || b.email.trim().length > 254) return { error: 'A valid email address is required.' };
    out.email = b.email.trim();
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUS_LIST.includes(b.status)) return { error: 'Email list status must be Subscribed or Unsubscribed.' };
    out.status = b.status;
  }
  for (const [key, limits] of [['address', ADDRESS_LIMITS], ['shipTo', { name: 255, company: 255, ...ADDRESS_LIMITS }]]) {
    if (b[key] === undefined) continue;
    if (!b[key] || typeof b[key] !== 'object' || Array.isArray(b[key])) return { error: `${key} must be an object.` };
    out[key] = {};
    for (const [f, max] of Object.entries(limits)) {
      if (b[key][f] === undefined) continue;
      if (typeof b[key][f] !== 'string') return { error: `${key}.${f} must be text.` };
      out[key][f] = b[key][f].trim().slice(0, max);
    }
  }
  if (b.groupIds !== undefined) {
    if (!Array.isArray(b.groupIds) || b.groupIds.length > 500) return { error: 'groupIds must be a list.' };
    const ids = [...new Set(b.groupIds.map(posInt).filter(Boolean))];
    if (ids.length) {
      const [have] = await pool.query(`SELECT id FROM contact_groups WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      out.groupIds = have.map(g => g.id);
    } else out.groupIds = [];
  }
  return { body: out };
}

// The card: the contact with address, ship-to, source, status, notes, email groups, the sign-in account (if any), and the CRM fields that are plain columns (owner, last contacted, label).
router.get('/:id/card', requireAuth, requireCrmRole('view'), async (req, res) => {
  const id = posInt(req.params.id);
  const [rows] = id ? await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]) : [[]];
  if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
  const [contact] = await attachSiteUserInfo(await attachGroups(rows));
  res.json({ contact: { ...serialize(contact), assignedAdminId: rows[0].assigned_admin_id || null, lastContactedAt: rows[0].last_contacted_at || null }, hubEnabled: await isCrmEnabled() });
});

// Roles and assignments: teacher seats, School and District Administrator roles, grade levels. Read-only.
router.get('/:id/roles', requireAuth, requireCrmRole('view'), async (req, res) => {
  const id = posInt(req.params.id);
  if (!id) return res.status(404).json({ error: 'Contact not found' });
  const r = await rolesForContact(id);
  res.status(r.status).json(r.body);
});

// Add a person with every field the older Add Contact form had. With the Hub on they also start as a Suspect, owned by whoever added them, from "crm_manual" (as the Hub's own Add did).
// A repeat email (any capitalisation, or a +tag of the same mailbox) is refused with the existing person's id. The email-list status defaults to Unsubscribed: no consent is recorded for a person typed in.
router.post('/', requireAuth, requireCrmRole('write'), async (req, res) => {
  const c = await cleanCardBody(req.body);
  if (c.error) return res.status(400).json({ error: c.error });
  if (!c.body.email) return res.status(400).json({ error: 'A valid email address is required.' });
  const dups = await matchingContacts(pool, c.body.email);
  if (dups.length) return res.status(409).json({ code: 'duplicate_email', existingContactId: dups[0], error: 'A contact with this email already exists. Open it instead.' });
  const r = await createContact(c.body);
  if (r.status !== 201) return res.status(r.status).json(r.body);
  const hub = await isCrmEnabled();
  let classification = null;
  if (hub) {
    await pool.query('UPDATE newsletter_contacts SET crm_source = ?, assigned_admin_id = ? WHERE id = ?', ['crm_manual', req.crm.adminId, r.body.id]);
    await cls.reconcileContact(pool, r.body.id, { actorAdminId: req.crm.adminId });
    const [[row]] = await pool.query('SELECT crm_classification FROM newsletter_contacts WHERE id = ?', [r.body.id]);
    classification = (row && row.crm_classification) || 'suspect';
  }
  await crmAudit(req, { action: 'crm_contact_created', entityType: 'crm_contact', entityId: r.body.id, next: { source: 'contacts_screen', subscribed: c.body.status === 'Subscribed' } });
  res.status(201).json({ ok: true, id: r.body.id, classification });
});

// Edit the whole card. Only what is sent changes. Changing the email also moves the person's sign-in account's email (refused if another account has it). The audit row names the fields, never their values.
router.put('/:id', requireAuth, requireCrmRole('write'), async (req, res) => {
  const id = posInt(req.params.id);
  if (!id) return res.status(404).json({ error: 'Contact not found' });
  const c = await cleanCardBody(req.body);
  if (c.error) return res.status(400).json({ error: c.error });
  if (!Object.keys(c.body).length) return res.status(400).json({ error: 'Nothing to change.' });
  const r = await updateContact(id, c.body);
  if (r.status === 200 && r.body.changed.length) await crmAudit(req, { action: 'crm_contact_details_changed', entityType: 'crm_contact', entityId: id, next: { fields: r.body.changed, accountEmailUpdated: !!r.body.accountEmailUpdated } });
  res.status(r.status).json(r.body);
});

// The sign-in account behind this person (matched by email): send a password reset (CRM Admin and Sales), or delete the account (CRM Admin only; a seat it held reopens).
async function accountOf(id) {
  const [[c]] = id ? await pool.query('SELECT email FROM newsletter_contacts WHERE id = ?', [id]) : [[null]];
  if (!c) return { error: { status: 404, body: { error: 'Contact not found' } } };
  const [[u]] = await pool.query('SELECT id, role, is_fne_staff FROM site_users WHERE email = ?', [c.email]);
  if (!u) return { error: { status: 404, body: { error: 'No account is registered for this email' } } };
  return { user: u };
}
router.post('/:id/send-password-reset', requireAuth, requireCrmRole('write'), async (req, res) => {
  const a = await accountOf(posInt(req.params.id));
  if (a.error) return res.status(a.error.status).json(a.error.body);
  const r = await accountActions.sendPasswordReset(a.user.id, req.user);
  res.status(r.status).json(r.body);
});
router.delete('/:id/site-account', requireAuth, requireCrmRole('erase'), async (req, res) => {
  const id = posInt(req.params.id);
  const a = await accountOf(id);
  if (a.error) return res.status(a.error.status).json(a.error.body);
  // The older route had no such check; a Fixer Nation staff account is never removed from a contact card (the contact delete refuses it the same way).
  if (a.user.role === 'admin' || Number(a.user.is_fne_staff)) return res.status(409).json({ code: 'staff_account', error: 'This is a Fixer Nation staff account and cannot be deleted here.' });
  const r = await accountActions.deleteSiteAccount(a.user.id);
  if (r.status === 200) await crmAudit(req, { action: 'crm_contact_site_account_deleted', entityType: 'crm_contact', entityId: id });
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
