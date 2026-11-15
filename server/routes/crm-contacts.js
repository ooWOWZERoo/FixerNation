// Sales CRM: the contact list and Contact 360 with Suspect / Prospect / Customer (mounted at /api/crm/contacts).
// Reads newsletter_contacts (the canonical person) and adds only CRM fields. It never writes the subscription status, the email, or any purchase.
// The classification rules live in lib/crm-classification.js; this file only exposes them behind roles.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const cls = require('../lib/crm-classification');
const { text, posInt, oneOf, paging, likeTerm } = require('../lib/crm-common');
const { matchingContacts } = require('../lib/crm-quotes');
const { attributionView, mergeTouches } = require('../lib/attribution');

const router = express.Router();

const SORTS = {
  name: 'c.name',
  email: 'c.email',
  classification: 'c.crm_classification',
  changed: 'c.classification_updated_at',
  contacted: 'c.last_contacted_at',
  signup: 'c.signup_date',
};

function contactRow(c) {
  return {
    id: c.id, name: c.name, email: c.email, company: c.company, state: c.state,
    classification: c.crm_classification || 'suspect',
    classificationLocked: Number(c.classification_locked) === 1,
    classificationUpdatedAt: c.classification_updated_at || null,
    assignedAdminId: c.assigned_admin_id || null,
    lastContactedAt: c.last_contacted_at || null,
    // Shown for reference only. The CRM never changes it (it is an email-marketing preference, not a sales stage).
    subscriptionStatus: c.status,
    signupDate: c.signup_date,
  };
}

// Server-side paging and filtering (the older contacts page loads everything at once). Test addresses (@example.com) are left out unless asked for.
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  const classification = oneOf(req.query.classification, cls.CLASSIFICATIONS);
  if (classification) { where.push('c.crm_classification = ?'); params.push(classification); }
  if (req.query.assigned === 'me') { where.push('c.assigned_admin_id = ?'); params.push(req.crm.adminId); }
  else if (req.query.assigned === 'none') where.push('c.assigned_admin_id IS NULL');
  else if (posInt(req.query.assigned)) { where.push('c.assigned_admin_id = ?'); params.push(posInt(req.query.assigned)); }
  const like = likeTerm(req.query.q);
  if (like) { where.push("(c.name LIKE ? ESCAPE '!' OR c.email LIKE ? ESCAPE '!' OR c.company LIKE ? ESCAPE '!')"); params.push(like, like, like); }
  if (req.query.includeTest !== 'true') where.push(`NOT (LOWER(TRIM(c.email)) LIKE '%@example.com')`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortKey = SORTS[req.query.sort] ? req.query.sort : 'changed';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM newsletter_contacts c ${w}`, params);
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.email, c.company, c.state, c.status, c.signup_date, c.crm_classification, c.classification_locked,
            c.classification_updated_at, c.assigned_admin_id, c.last_contacted_at
     FROM newsletter_contacts c ${w}
     ORDER BY ${SORTS[sortKey]} ${dir}, c.id ${dir} LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  res.json({ contacts: rows.map(contactRow), total: Number(total), page, pageSize: size });
});

// Overview counts: contacts only, test addresses left out. Account-level Customer is a separate figure, never added to these.
router.get('/counts', requireAuth, requireCrm('view'), async (req, res) => {
  res.json({ counts: await cls.classificationCounts(pool) });
});

// Paid, non-trial purchases whose amount is unknown or zero. They are never a Customer on their own; the owner confirms each by hand (decision D3).
router.get('/review/purchases', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const all = await cls.listPurchasesNeedingReview(pool);
  const slice = all.slice(offset, offset + size);
  // Who the purchase belongs to, so the page can say it without a second request per row.
  const ids = [...new Set(slice.map(p => p.contactId))];
  const people = new Map();
  if (ids.length) {
    const [rows] = await pool.query(`SELECT id, name, email FROM newsletter_contacts WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const r of rows) people.set(r.id, r);
  }
  res.json({
    purchases: slice.map(p => ({ ...p, contactName: (people.get(p.contactId) || {}).name || null, contactEmail: (people.get(p.contactId) || {}).email || null })),
    total: all.length, page, pageSize: size,
  });
});

// "Could these be the same person?" Suggestions for a human to review; nothing is ever merged from here. Two people at the same school or
// district share an email DOMAIN, so a domain alone never makes a pair. The only signals are the same mailbox with a +tag removed, or the same full name
// (two or more words). Test addresses are left out.
const normEmail = e => String(e || '').trim().toLowerCase();
function mailboxKey(email) {
  const e = normEmail(email);
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at).split('+')[0];
  return local ? `${local}@${e.slice(at + 1)}` : null;
}
const nameKey = n => {
  const k = String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return k.split(' ').length >= 2 && k.length >= 5 ? k : null;
};
router.get('/review/duplicates', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 20, maxSize: 100 });
  const [rows] = await pool.query(`SELECT c.id, c.name, c.email, c.company, c.crm_classification FROM newsletter_contacts c WHERE NOT (${cls.TEST_ADDRESS_SQL.replace(/\bemail\b/, 'c.email')}) ORDER BY c.id`);
  const groups = new Map();
  const add = (key, reason, row) => { const k = `${reason}|${key}`; if (!groups.has(k)) groups.set(k, { reason, rows: [] }); groups.get(k).rows.push(row); };
  for (const r of rows) {
    const mk = mailboxKey(r.email);
    if (mk) add(mk, 'same_mailbox', r);
    const nk = nameKey(r.name);
    if (nk) add(nk, 'same_name', r);
  }
  // The same pair can match on both signals; show it once, under the mailbox reason (it was added first).
  const seen = new Set();
  const found = [...groups.values()].filter(g => {
    if (g.rows.length < 2) return false;
    const k = g.rows.map(r => r.id).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  res.json({
    groups: found.slice(offset, offset + size).map(g => ({
      reason: g.reason === 'same_mailbox' ? 'The same mailbox, once a + tag is removed' : 'The same full name',
      contacts: g.rows.map(r => ({ id: r.id, name: r.name, email: r.email, company: r.company, classification: r.crm_classification || 'suspect' })),
    })),
    total: found.length, page, pageSize: size,
  });
});

// A Suspect made by hand (a name from a conference, a referral). The row lives in newsletter_contacts like every contact, so it is NOT put on the
// newsletter unless staff say so: the subscription status is "Unsubscribed" (no consent recorded) unless subscribe is true.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
router.post('/', requireAuth, requireCrm('write'), async (req, res) => {
  const b = req.body || {};
  const email = text(b.email, 254);
  if (!email || !EMAIL_SHAPE.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
  const dups = await matchingContacts(pool, email);
  if (dups.length) return res.status(409).json({ code: 'duplicate_email', existingContactId: dups[0], error: 'A contact with this email already exists. Open it instead.' });
  const accountId = b.accountId === undefined || b.accountId === null ? null : posInt(b.accountId);
  if (b.accountId !== undefined && b.accountId !== null) {
    const [[a]] = accountId ? await pool.query('SELECT id FROM crm_accounts WHERE id = ?', [accountId]) : [[null]];
    if (!a) return res.status(400).json({ error: 'That account does not exist.' });
  }
  let id;
  try {
    const [r] = await pool.query(
      'INSERT INTO newsletter_contacts (name, email, company, state, phone, source, status, crm_source, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [text(b.name, 255) || '', email, text(b.company, 255) || '', text(b.state, 64) || '', text(b.phone, 32) || '', 'Sales CRM', b.subscribe === true ? 'Subscribed' : 'Unsubscribed', 'crm_manual', req.crm.adminId]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ code: 'duplicate_email', error: 'A contact with this email already exists. Open it instead.' });
    throw err;
  }
  if (accountId) await pool.query('INSERT INTO crm_account_contacts (account_id, contact_id, title) VALUES (?, ?, ?)', [accountId, id, text(b.title, 128)]);
  await crmAudit(req, { action: 'crm_contact_created', entityType: 'crm_contact', entityId: id, next: { source: 'crm_manual', accountId, subscribed: b.subscribe === true } });
  const r = await cls.reconcileContact(pool, id, { actorAdminId: req.crm.adminId });
  const [[c]] = await pool.query('SELECT crm_classification FROM newsletter_contacts WHERE id = ?', [id]);
  res.status(201).json({ ok: true, id, classification: (c && c.crm_classification) || 'suspect', reconciled: !!(r && r.changed) });
});

router.get('/:id', requireAuth, requireCrm('view'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[c]] = id ? await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]) : [[null]];
  if (!c) return res.status(404).json({ error: 'Contact not found' });

  const [events] = await pool.query(
    `SELECT e.id, e.from_classification, e.to_classification, e.event_type, e.source_ref, e.reason, e.created_at, a.username AS actor
     FROM crm_classification_events e LEFT JOIN admin_users a ON a.id = e.actor_admin_id
     WHERE e.contact_id = ? ORDER BY e.id DESC LIMIT 50`, [id]);
  const [accounts] = await pool.query(
    `SELECT ac.account_id, a.name, a.account_type, ac.title, ac.is_primary, ac.is_champion, ac.is_decision_maker, ac.is_procurement, ac.is_finance
     FROM crm_account_contacts ac JOIN crm_accounts a ON a.id = ac.account_id WHERE ac.contact_id = ? ORDER BY a.name`, [id]);
  const [opps] = await pool.query(
    `SELECT o.id, o.name, o.state, s.label AS stage, oc.role
     FROM crm_opportunity_contacts oc JOIN crm_opportunities o ON o.id = oc.opportunity_id JOIN crm_pipeline_stages s ON s.id = o.stage_id
     WHERE oc.contact_id = ? ORDER BY o.id DESC`, [id]);
  const [purchases] = await pool.query(
    `SELECT p.id, p.product_type, p.payment_status, p.payment_method, p.amount_cents, p.trial_lesson_limit, p.trial_expiration_date, lp.is_trial, p.purchased_at
     ${cls.PURCHASES_FROM} WHERE p.contact_id = ? ORDER BY p.id DESC`, [id]);

  // Quotes for this person: linked by id, or by the same email while the link is not set. The accept token is never selected.
  const [quotes] = await pool.query(
    `SELECT id, quote_number, status, quoted_amount_cents, quote_sent_at, accepted_at, opportunity_id FROM quote_requests
     WHERE contact_id = ? OR LOWER(TRIM(email)) = LOWER(TRIM(?)) ORDER BY id DESC`, [id, c.email]);

  res.json({
    contact: contactRow(c),
    // Phase 6: first and latest touch, or null for each when none was recorded (never guessed from the signup form's name). Advisory: a visitor's browser can forge it.
    attribution: attributionView(c),
    quotes: quotes.map(q => ({ id: q.id, quoteNumber: q.quote_number, status: q.status, amountCents: q.quoted_amount_cents === null ? null : Number(q.quoted_amount_cents), sentAt: q.quote_sent_at || null, acceptedAt: q.accepted_at || null, opportunityId: q.opportunity_id || null })),
    events: events.map(e => ({ id: e.id, from: e.from_classification, to: e.to_classification, type: e.event_type, sourceRef: e.source_ref, reason: e.reason, at: e.created_at, actor: e.actor || null })),
    accounts: accounts.map(a => ({ accountId: a.account_id, name: a.name, accountType: a.account_type, title: a.title, isPrimary: !!a.is_primary, isChampion: !!a.is_champion, isDecisionMaker: !!a.is_decision_maker, isProcurement: !!a.is_procurement, isFinance: !!a.is_finance })),
    opportunities: opps.map(o => ({ id: o.id, name: o.name, state: o.state, stage: o.stage, role: o.role })),
    // "qualifies" is the Customer rule applied to each row, so staff can see exactly why a purchase does or does not make someone a Customer.
    purchases: purchases.map(p => ({
      id: p.id, productType: p.product_type, paymentStatus: p.payment_status, paymentMethod: p.payment_method,
      amountCents: p.amount_cents === null ? null : Number(p.amount_cents), purchasedAt: p.purchased_at,
      isTrial: cls.isTrialLike(p), qualifies: cls.isQualifyingPurchase(p),
    })),
  });
});

// Owner. A CRM Admin or Sales role may set it; the owner must be a real admin.
router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[c]] = id ? await pool.query('SELECT id, assigned_admin_id FROM newsletter_contacts WHERE id = ?', [id]) : [[null]];
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  const b = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(b, 'assignedAdminId')) return res.status(400).json({ error: 'Nothing to change.' });
  let owner = null;
  if (b.assignedAdminId !== null) {
    owner = posInt(b.assignedAdminId);
    const [[a]] = owner ? await pool.query('SELECT id FROM admin_users WHERE id = ?', [owner]) : [[null]];
    if (!a) return res.status(400).json({ error: 'That staff member does not exist.' });
  }
  await pool.query('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?', [owner, id]);
  await crmAudit(req, { action: 'crm_contact_owner_changed', entityType: 'crm_contact', entityId: id, prev: { assignedAdminId: c.assigned_admin_id }, next: { assignedAdminId: owner } });
  res.json({ ok: true });
});

router.post('/:id/promote', requireAuth, requireCrm('promote_prospect'), async (req, res) => {
  const id = posInt(req.params.id);
  const r = await cls.promoteToProspect(pool, id, { actorAdminId: req.crm.adminId, reason: (req.body || {}).reason });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : r.code === 'reason_required' ? 400 : 409).json({ code: r.code, error: r.error });
  await crmAudit(req, { action: 'crm_contact_promoted', entityType: 'crm_contact', entityId: id, prev: { classification: 'suspect' }, next: { classification: 'prospect' }, reason: text((req.body || {}).reason, 255) });
  res.json({ ok: true, classification: 'prospect' });
});

// CRM Admin only, with a reason AND evidence. The label is then locked against automatic changes.
router.post('/:id/customer-override', requireAuth, requireCrm('set_customer'), async (req, res) => {
  const id = posInt(req.params.id);
  const b = req.body || {};
  const r = await cls.setCustomerOverride(pool, id, { actorAdminId: req.crm.adminId, reason: b.reason, evidence: b.evidence });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : r.code === 'evidence_required' ? 400 : 409).json({ code: r.code, error: r.error });
  await crmAudit(req, { action: 'crm_customer_override', entityType: 'crm_contact', entityId: id, prev: { classification: r.from }, next: { classification: 'customer', locked: true }, reason: `${text(b.reason, 120)}; evidence: ${text(b.evidence, 120)}` });
  res.json({ ok: true, classification: 'customer', locked: true });
});

router.post('/:id/release-override', requireAuth, requireCrm('set_customer'), async (req, res) => {
  const id = posInt(req.params.id);
  const r = await cls.releaseOverride(pool, id, { actorAdminId: req.crm.adminId, reason: (req.body || {}).reason });
  if (!r.ok) return res.status(r.code === 'not_found' ? 404 : r.code === 'reason_required' ? 400 : 409).json({ code: r.code, error: r.error });
  await crmAudit(req, { action: 'crm_override_released', entityType: 'crm_contact', entityId: id, reason: text((req.body || {}).reason, 255) });
  res.json({ ok: true });
});

// Re-derive one contact from the facts (safe to repeat).
router.post('/:id/reconcile', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const r = id ? await cls.reconcileContact(pool, id, { actorAdminId: req.crm.adminId }) : { found: false };
  if (!r.found) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true, changed: !!r.changed, from: r.from || null, to: r.to || null, needsReview: !!r.needsReview });
});

// Merge a duplicate into the contact you keep: CRM Admin only. :id is the duplicate that goes away; intoId is the one that stays.
// What moves: account memberships, buying-committee seats, deals' primary contact, quotes, email-list memberships, and any blank detail.
// What blocks it (nothing is guessed): the duplicate owns a purchase or an invoice (the CRM never moves money; keep that one and merge the other
// into it), has a sign-in account or is a staff member (handle it in Account Lookup first), or holds a staff-set Customer lock.
// The subscription status of the contact you keep is not changed.
router.post('/:id/merge', requireAuth, requireCrm('merge'), async (req, res) => {
  const fromId = posInt(req.params.id);
  const intoId = posInt((req.body || {}).intoId);
  if (!fromId || !intoId) return res.status(400).json({ error: 'Pick the contact to keep.' });
  if (fromId === intoId) return res.status(400).json({ error: 'Pick a different contact to keep.' });
  const [[from]] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [fromId]);
  const [[into]] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [intoId]);
  if (!from || !into) return res.status(404).json({ error: 'Contact not found' });
  const [[owned]] = await pool.query('SELECT (SELECT COUNT(*) FROM purchases WHERE contact_id = ?) AS p, (SELECT COUNT(*) FROM invoices WHERE contact_id = ?) AS i', [fromId, fromId]);
  if (Number(owned.p) || Number(owned.i)) {
    return res.status(409).json({ code: 'source_owns_purchases', error: 'The contact you are removing owns purchases or invoices, and the CRM never moves those. Keep that contact and merge the other one into it.' });
  }
  const [[site]] = await pool.query('SELECT id FROM site_users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [from.email]);
  const [[staff]] = await pool.query('SELECT id FROM admin_users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [from.email]);
  if (site || staff) return res.status(409).json({ code: 'has_account', error: 'The contact you are removing has a sign-in account. Close or move that account in Account Lookup first.' });
  if (Number(from.classification_locked)) return res.status(409).json({ code: 'source_locked', error: 'The contact you are removing has a staff-set Customer label. Release it first.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Account memberships: move the ones the kept contact is not already on.
    const [keptAccts] = await conn.query('SELECT account_id FROM crm_account_contacts WHERE contact_id = ?', [intoId]);
    const haveAcct = new Set(keptAccts.map(r => r.account_id));
    const [fromAccts] = await conn.query('SELECT id, account_id FROM crm_account_contacts WHERE contact_id = ?', [fromId]);
    for (const m of fromAccts) {
      if (haveAcct.has(m.account_id)) await conn.query('DELETE FROM crm_account_contacts WHERE id = ?', [m.id]);
      else await conn.query('UPDATE crm_account_contacts SET contact_id = ? WHERE id = ?', [intoId, m.id]);
    }
    const [keptOpps] = await conn.query('SELECT opportunity_id FROM crm_opportunity_contacts WHERE contact_id = ?', [intoId]);
    const haveOpp = new Set(keptOpps.map(r => r.opportunity_id));
    const [fromOpps] = await conn.query('SELECT id, opportunity_id FROM crm_opportunity_contacts WHERE contact_id = ?', [fromId]);
    for (const m of fromOpps) {
      if (haveOpp.has(m.opportunity_id)) await conn.query('DELETE FROM crm_opportunity_contacts WHERE id = ?', [m.id]);
      else await conn.query('UPDATE crm_opportunity_contacts SET contact_id = ? WHERE id = ?', [intoId, m.id]);
    }
    await conn.query('UPDATE crm_opportunities SET primary_contact_id = ? WHERE primary_contact_id = ?', [intoId, fromId]);
    // Phase 3: the duplicate's notes, tasks, files and meetings follow the person you keep (they would otherwise be deleted with the duplicate).
    for (const table of ['crm_tasks', 'crm_notes', 'crm_attachments', 'crm_appointments']) await conn.query(`UPDATE ${table} SET contact_id = ? WHERE contact_id = ?`, [intoId, fromId]);
    await conn.query('UPDATE quote_requests SET contact_id = ? WHERE contact_id = ?', [intoId, fromId]);
    await conn.query('UPDATE quote_requests SET contact_id = ? WHERE contact_id IS NULL AND LOWER(TRIM(email)) = LOWER(TRIM(?))', [intoId, from.email]);
    // Email lists: the kept contact joins every list the duplicate was on (their own status is not touched).
    const [keptGroups] = await conn.query('SELECT group_id FROM contact_group_members WHERE contact_id = ?', [intoId]);
    const haveGroup = new Set(keptGroups.map(r => r.group_id));
    const [fromGroups] = await conn.query('SELECT group_id FROM contact_group_members WHERE contact_id = ?', [fromId]);
    for (const g of fromGroups) if (!haveGroup.has(g.group_id)) await conn.query('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)', [intoId, g.group_id]);
    // Fill blanks only: never overwrite what the kept contact already says.
    const fill = [];
    const vals = [];
    for (const col of ['name', 'company', 'state', 'phone']) {
      if (!String(into[col] || '').trim() && String(from[col] || '').trim()) { fill.push(`${col} = ?`); vals.push(from[col]); }
    }
    if (!into.assigned_admin_id && from.assigned_admin_id) { fill.push('assigned_admin_id = ?'); vals.push(from.assigned_admin_id); }
    if (from.last_contacted_at && (!into.last_contacted_at || String(from.last_contacted_at) > String(into.last_contacted_at))) { fill.push('last_contacted_at = ?'); vals.push(from.last_contacted_at); }
    // Phase 6: how they found us. The earlier first touch and the newer latest touch survive (nothing is guessed, and a column that is not there yet changes nothing).
    const touches = mergeTouches(into, from);
    if (touches) { fill.push(...touches.set); vals.push(...touches.params); }
    if (fill.length) await conn.query(`UPDATE newsletter_contacts SET ${fill.join(', ')} WHERE id = ?`, [...vals, intoId]);
    const [gone] = await conn.query('DELETE FROM newsletter_contacts WHERE id = ?', [fromId]);
    if (!gone.affectedRows) throw new Error('The duplicate could not be removed.');
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* the original error matters */ }
    throw err;
  } finally {
    if (conn.release) conn.release();
  }
  await crmAudit(req, {
    action: 'crm_contact_merged', entityType: 'crm_contact', entityId: intoId,
    prev: { removedId: fromId, name: from.name, email: from.email, classification: from.crm_classification, status: from.status },
    next: { keptId: intoId }, reason: text((req.body || {}).reason, 255),
  });
  await cls.reconcileContact(pool, intoId, { actorAdminId: req.crm.adminId });
  res.json({ ok: true, keptId: intoId });
});

module.exports = router;
