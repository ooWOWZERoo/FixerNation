// Sales CRM: quotes that have no deal or no contact, and the links that fix that (mounted at /api/crm/quotes).
// Setting a link writes only quote_requests.contact_id / opportunity_id. A quote's status, price, token and dates are never touched here, and no
// purchase, invoice or license is created (phase 4 owns that). The accept token is never returned.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm, canEditDeal } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const cls = require('../lib/crm-classification');
const { text, posInt, paging, oneOf } = require('../lib/crm-common');
const { stageForQuote, dealName, matchingContacts, listQuoteGaps } = require('../lib/crm-quotes');
const NM = require('../lib/crm-name-match'); // a look-alike account name is a warning, never an automatic link

const router = express.Router();
const normName = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const gap = oneOf(req.query.gap, ['no_deal', 'no_contact', 'any']) || 'any';
  const r = await listQuoteGaps(pool, { gap, q: req.query.q, includeTest: req.query.includeTest === 'true', limit: size, offset });
  res.json({ quotes: r.rows, total: r.total, page, pageSize: size });
});

async function loadQuote(id) {
  const [[q]] = id ? await pool.query(
    'SELECT id, quote_number, first_name, last_name, email, school, status, quoted_amount_cents, quoted_product_name, quote_sent_at, accepted_at, created_at, contact_id, opportunity_id FROM quote_requests WHERE id = ?', [id]) : [[null]];
  return q || null;
}

// The contact to link: the one already on the quote, else the only contact with the same email. More than one or none: staff choose, nothing is guessed.
async function contactForQuote(q) {
  if (q.contact_id) return q.contact_id;
  const ids = await matchingContacts(pool, q.email);
  return ids.length === 1 ? ids[0] : null;
}

async function linkQuote(q, opportunityId, contactId) {
  // Compare-and-set: two people linking the same quote cannot both win.
  const [r] = await pool.query(
    'UPDATE quote_requests SET opportunity_id = ?, contact_id = COALESCE(contact_id, ?) WHERE id = ? AND opportunity_id IS NULL', [opportunityId, contactId, q.id]);
  return r.affectedRows > 0;
}

async function afterLink(contactId) {
  if (!contactId) return;
  try { await cls.reconcileContact(pool, contactId); } catch (err) { console.error('crm reconcile after quote link failed:', err.message); }
}

// Make a deal from a quote and link them. The account is picked (accountId) or made from the quote's organization (createAccount: true).
router.post('/:id/create-deal', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const q = await loadQuote(posInt(req.params.id));
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  if (q.opportunity_id) return res.status(409).json({ code: 'already_linked', opportunityId: q.opportunity_id, error: 'This quote is already on a deal.' });
  const b = req.body || {};

  let accountId = posInt(b.accountId);
  let createdAccount = false;
  if (accountId) {
    const [[a]] = await pool.query('SELECT id, archived_at FROM crm_accounts WHERE id = ?', [accountId]);
    if (!a) return res.status(400).json({ error: 'That account does not exist.' });
    if (a.archived_at) return res.status(409).json({ code: 'account_archived', error: 'That account is archived. Restore it first.' });
  } else if (b.createAccount === true) {
    const name = text(b.accountName, 255) || text(q.school, 255);
    if (!name) return res.status(400).json({ error: 'This quote has no organization. Pick an account or type a name for a new one.' });
    const [live] = await pool.query('SELECT id, name, account_type, state FROM crm_accounts WHERE archived_at IS NULL');
    const hit = live.find(a => normName(a.name) === normName(name));
    if (hit) return res.status(409).json({ code: 'possible_duplicate', kind: 'same_name', existingAccountId: hit.id, error: `An account named "${hit.name}" already exists. Pick it instead.` });
    // A look-alike name is a warning, not a block: send allowDuplicate to make the new account anyway. (A school made from a quote is a school; the quote's own state is not known here.)
    if (b.allowDuplicate !== true) {
      const similar = NM.suggestFor({ name, accountType: 'school' }, live.map(a => NM.prepare({ id: Number(a.id), name: a.name, accountType: a.account_type, state: a.state })), { limit: 3 });
      if (similar.length) return res.status(409).json({ code: 'possible_duplicate', kind: 'similar_name', existingAccountId: similar[0].id, similarAccounts: similar.map(a => ({ id: a.id, name: a.name, state: a.state })), error: `A similar account already exists: "${similar[0].name}"${similar[0].state ? ` (${similar[0].state})` : ''}. Pick it instead, or choose Make the deal again to make a new account anyway.` });
    }
  } else {
    return res.status(400).json({ error: 'Pick an account for this deal, or ask for a new one.' });
  }

  const target = stageForQuote(q);
  const [[stage]] = await pool.query('SELECT id, is_active FROM crm_pipeline_stages WHERE stage_key = ?', [target.stageKey]);
  if (!stage) return res.status(500).json({ error: 'The pipeline stages are missing. Run the CRM setup script.' });
  const contactId = await contactForQuote(q);
  const dealNameText = text(b.name, 255) || dealName(q);
  const ownerAdminId = req.crm.adminId;
  const now = cls.sqlNow();

  if (!accountId) {
    const name = text(b.accountName, 255) || text(q.school, 255);
    const [a] = await pool.query("INSERT INTO crm_accounts (name, account_type, source, created_by_admin_id, assigned_admin_id) VALUES (?, 'school', 'From a quote', ?, ?)", [name, req.crm.adminId, ownerAdminId]);
    accountId = a.insertId;
    createdAccount = true;
    await crmAudit(req, { action: 'crm_account_created', entityType: 'crm_account', entityId: accountId, next: { name, accountType: 'school', fromQuote: q.id } });
  }

  const closedAt = target.state === 'open' ? null : (q.accepted_at || q.quote_sent_at || now);
  const [d] = await pool.query(
    `INSERT INTO crm_opportunities (account_id, name, owner_admin_id, stage_id, state, stage_entered_at, primary_contact_id, opp_type, amount_cents, source, product_focus, closed_at, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new_business', ?, 'Quote', ?, ?, ?)`,
    [accountId, dealNameText, ownerAdminId, stage.id, target.state, q.accepted_at || q.quote_sent_at || now, contactId, q.quoted_amount_cents === undefined ? null : q.quoted_amount_cents,
      text(q.quoted_product_name, 255), closedAt, req.crm.adminId]);
  const dealId = d.insertId;
  const linked = await linkQuote(q, dealId, contactId);
  if (!linked) {
    // Lost the race: take the new deal back out so no orphan is left, then tell the person.
    await pool.query('DELETE FROM crm_opportunities WHERE id = ?', [dealId]);
    return res.status(409).json({ code: 'already_linked', error: 'This quote was just linked to another deal. Reload and check.' });
  }
  await pool.query(
    'INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, actor_admin_id, reason, created_at) VALUES (?, NULL, ?, NULL, ?, ?, ?, ?)',
    [dealId, stage.id, target.state, req.crm.adminId, `Deal made from quote ${q.quote_number || q.id}`, now]);
  if (contactId) {
    await pool.query("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'other')", [dealId, contactId]);
  }
  await crmAudit(req, { action: 'crm_opportunity_created', entityType: 'crm_opportunity', entityId: dealId, next: { name: dealNameText, accountId, stage: target.stageKey, fromQuote: q.id } });
  await crmAudit(req, { action: 'crm_quote_linked', entityType: 'crm_opportunity', entityId: dealId, next: { quoteId: q.id, contactId } });
  await afterLink(contactId);
  res.status(201).json({ ok: true, opportunityId: dealId, accountId, createdAccount, contactLinked: !!contactId });
});

// Put a quote on a deal that already exists (a Sales user needs to be allowed to edit that deal).
router.post('/:id/link-deal', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const q = await loadQuote(posInt(req.params.id));
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  if (q.opportunity_id) return res.status(409).json({ code: 'already_linked', opportunityId: q.opportunity_id, error: 'This quote is already on a deal.' });
  const dealId = posInt((req.body || {}).opportunityId);
  const [[o]] = dealId ? await pool.query('SELECT id, owner_admin_id FROM crm_opportunities WHERE id = ?', [dealId]) : [[null]];
  if (!o) return res.status(400).json({ error: 'Pick a deal from the list.' });
  if (!canEditDeal(req.crm.role, req.crm.adminId, o)) return res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
  const contactId = await contactForQuote(q);
  if (!(await linkQuote(q, o.id, contactId))) return res.status(409).json({ code: 'already_linked', error: 'This quote was just linked to another deal. Reload and check.' });
  await crmAudit(req, { action: 'crm_quote_linked', entityType: 'crm_opportunity', entityId: o.id, next: { quoteId: q.id, contactId } });
  await afterLink(contactId);
  res.json({ ok: true, opportunityId: o.id, contactLinked: !!contactId });
});

// A quote whose email matches no contact (or several): staff pick the contact by hand.
router.post('/:id/link-contact', requireAuth, requireCrm('write'), async (req, res) => {
  const q = await loadQuote(posInt(req.params.id));
  if (!q) return res.status(404).json({ error: 'Quote not found' });
  if (q.contact_id) return res.status(409).json({ code: 'already_linked', error: 'This quote already has a contact.' });
  const contactId = posInt((req.body || {}).contactId);
  const [[c]] = contactId ? await pool.query('SELECT id FROM newsletter_contacts WHERE id = ?', [contactId]) : [[null]];
  if (!c) return res.status(400).json({ error: 'Pick a contact from the list.' });
  const [r] = await pool.query('UPDATE quote_requests SET contact_id = ? WHERE id = ? AND contact_id IS NULL', [c.id, q.id]);
  if (!r.affectedRows) return res.status(409).json({ code: 'already_linked', error: 'This quote just got a contact. Reload and check.' });
  await crmAudit(req, { action: 'crm_quote_contact_linked', entityType: 'crm_contact', entityId: c.id, next: { quoteId: q.id } });
  await afterLink(c.id);
  res.json({ ok: true });
});

module.exports = router;
