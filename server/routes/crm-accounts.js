// Sales CRM accounts: the organizations being sold to (mounted at /api/crm/accounts).
// A CRM account is NOT a school or district row. It may point at one (school_id / district_id, each linked at most once), but a prospect account
// exists without creating anything operational. A contact can belong to several accounts; membership has its own role flags.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { ACCOUNT_TYPES, text, posInt, dateOnly, oneOf, paging, likeTerm } = require('../lib/crm-common');
const { engagementFor } = require('../lib/crm-engagement');
const rel = require('../lib/crm-account-relationship');
const FILT = require('../lib/crm-filters'); // G19: buying role and license status filters
const roll = require('../lib/crm-account-rollups'); // G17: duplicate review by website address, and paid purchase and deal rollups
const NM = require('../lib/crm-name-match'); // names that are alike: a warning, never an automatic link or merge
const ND = require('../lib/crm-account-not-duplicates'); // "not a duplicate" memory for that review (a pair a person has said is separate)

const router = express.Router();

const normName = n => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

function accountRow(a) {
  return {
    id: a.id, name: a.name, accountType: a.account_type, websiteDomain: a.website_domain, state: a.state,
    assignedAdminId: a.assigned_admin_id || null, source: a.source, parentAccountId: a.parent_account_id || null,
    schoolId: a.school_id || null, districtId: a.district_id || null, description: a.description,
    archivedAt: a.archived_at || null, createdAt: a.created_at,
  };
}

async function exists(table, id) {
  const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  return !!rows[0];
}

// Walk up from the proposed parent: it must not be this account or one of its descendants (the walk is capped, hierarchies here are two or three deep).
async function wouldCycle(accountId, parentId) {
  let cursor = parentId;
  for (let i = 0; i < 20 && cursor; i++) {
    if (Number(cursor) === Number(accountId)) return true;
    const [[row]] = await pool.query('SELECT parent_account_id FROM crm_accounts WHERE id = ?', [cursor]);
    cursor = row ? row.parent_account_id : null;
  }
  return false;
}

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.archived !== 'true') where.push('a.archived_at IS NULL');
  const type = oneOf(req.query.type, ACCOUNT_TYPES);
  if (type) { where.push('a.account_type = ?'); params.push(type); }
  if (req.query.owner === 'none') where.push('a.assigned_admin_id IS NULL');
  else if (posInt(req.query.owner)) { where.push('a.assigned_admin_id = ?'); params.push(posInt(req.query.owner)); }
  const like = likeTerm(req.query.q);
  if (like) { where.push("(a.name LIKE ? ESCAPE '!' OR a.website_domain LIKE ? ESCAPE '!')"); params.push(like, like); }
  // G1: what the account is to us (Customer, Prospect, Suspect) and whether it needs review, worked out from the data on every request (lib/crm-account-relationship.js).
  const relMap = await rel.accountRelationships(pool, typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : undefined);
  const wantRel = oneOf(req.query.relationship, ['suspect', 'prospect', 'customer', 'review']);
  if (wantRel) {
    const ids = [...relMap.entries()].filter(([, v]) => (wantRel === 'review' ? v.needsReview : v.relationship === wantRel)).map(([id]) => id);
    where.push(ids.length ? `a.id IN (${ids.map(() => '?').join(',')})` : '1 = 0'); params.push(...ids);
  }
  // G19: accounts that have a person in a buying role, that have a live paid licence, a live trial, only an ended trial or nothing, or that sit under one district (parent).
  const today = dateOnly(req.query.today) || new Date().toISOString().slice(0, 10);
  for (const f of [FILT.roleForAccount(typeof req.query.role === 'string' ? req.query.role : ''), FILT.licenseForAccount(typeof req.query.license === 'string' && FILT.LICENSES.includes(req.query.license) ? req.query.license : '', today)].filter(Boolean)) { where.push(f.sql); params.push(...f.params); }
  if (posInt(req.query.parent)) { where.push('a.parent_account_id = ?'); params.push(posInt(req.query.parent)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM crm_accounts a ${w}`, params);
  // Counts are correlated subqueries, one value per account, so a contact in two accounts or a deal with many contacts can never multiply a row.
  const [rows] = await pool.query(
    `SELECT a.*,
       (SELECT COUNT(*) FROM crm_account_contacts ac WHERE ac.account_id = a.id) AS contact_count,
       (SELECT COUNT(*) FROM crm_opportunities o WHERE o.account_id = a.id AND o.state = 'open') AS open_deals
     FROM crm_accounts a ${w} ORDER BY a.name, a.id LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  const paidBy = await roll.purchaseTotals(pool, rows.map(a => a.id)); // G17: paid, non-trial purchases placed on each account (a district includes its schools)
  const view = (a) => { const r = relMap.get(Number(a.id)); return r ? { relationship: r.relationship, needsReview: r.needsReview } : { relationship: null, needsReview: false }; };
  res.json({ accounts: rows.map(a => ({ ...accountRow(a), ...view(a), contactCount: Number(a.contact_count), openDeals: Number(a.open_deals), paid: paidBy.get(Number(a.id)) || { count: 0, totalCents: 0, firstAt: null, lastAt: null } })), total: Number(total), page, pageSize: size, relationshipCounts: rel.relationshipCounts(relMap) });
});

// G17: live accounts of the same type that share a website address. Read only: nothing is merged, archived or changed; merging is the CRM Admin's own action on the account.
router.get('/review/duplicates', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 20, maxSize: 100 });
  // Pairs a person has said are separate organizations (ND) are taken out after the groups are found; a database without that table yet remembers nothing.
  const memory = await ND.dismissedPairs(pool);
  // Two reasons to list accounts together: they share a website address, or their names are alike (suggestions only; see lib/crm-name-match.js). A pair already listed for its website is not listed again for its name.
  const web = await roll.duplicateAccounts(pool);
  const webPairs = new Set();
  for (const g of web) for (let i = 0; i < g.accounts.length; i++) for (let j = i + 1; j < g.accounts.length; j++) webPairs.add(ND.keyOf(g.accounts[i].id, g.accounts[j].id));
  const names = await roll.similarNameAccounts(pool, webPairs);
  const found = ND.applyMemory([...web.map(g => ({ ...g, reason: 'website' })), ...names.groups], memory.set);
  const shown = found.slice(offset, offset + size);
  const relMap = await rel.accountRelationships(pool);
  res.json({
    groups: shown.map(g => ({ domain: g.domain, reason: g.reason, accounts: g.accounts.map(a => ({ ...a, relationship: (relMap.get(a.id) || {}).relationship || null })) })),
    total: found.length, page, pageSize: size, memoryAvailable: memory.available, markedCount: memory.set.size, namesTruncated: names.truncated,
  });
});

// The pairs a person has marked "not a duplicate", newest first, so one can be brought back. Read: every role. Mark and undo: CRM Admin and Sales (the write action). Neither changes an account.
router.get('/review/not-duplicates', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 20, maxSize: 100 });
  const out = await ND.listMarked(pool, { limit: size, offset });
  res.json({ pairs: out.pairs, total: out.total, page, pageSize: size, available: out.available });
});

router.post('/review/not-duplicates', requireAuth, requireCrm('write'), async (req, res) => {
  const r = await ND.mark(pool, (req.body || {}).accountIds, req.crm.adminId);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  if (r.marked) await crmAudit(req, { action: 'crm_account_not_duplicate_marked', entityType: 'crm_account', entityId: r.pairs[0][0], next: { pairs: r.pairs } });
  res.status(r.marked ? 201 : 200).json({ ok: true, marked: r.marked, alreadyMarked: r.already });
});

router.delete('/review/not-duplicates/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const r = await ND.unmark(pool, req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  await crmAudit(req, { action: 'crm_account_not_duplicate_undone', entityType: 'crm_account', entityId: r.pair[0], prev: { pair: r.pair } });
  res.json({ ok: true });
});

// G1 (decision D4): paid, non-trial purchases that name no school, so they cannot be placed on an account. Each shows the buyer and the accounts the buyer belongs to, so staff
// know which school to set on the purchase in the old admin tool. The CRM never edits a purchase; once the school is set the purchase leaves this list by itself.
router.get('/review/unplaced', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 20, maxSize: 100 });
  const all = await rel.unplacedPurchases(pool);
  res.json({ purchases: all.slice(offset, offset + size), total: all.length, page, pageSize: size });
});

// Phase 6: the "Trial and demo engagement" card. Read only; counts only; an unknown is never shown as a zero (lib/crm-engagement.js).
router.get('/:id/engagement', requireAuth, requireCrm('view'), async (req, res) => {
  const out = await engagementFor(pool, 'account', posInt(req.params.id));
  if (!out) return res.status(404).json({ error: 'Account not found' });
  res.json(out);
});

router.get('/:id', requireAuth, requireCrm('view'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[a]] = id ? await pool.query('SELECT * FROM crm_accounts WHERE id = ?', [id]) : [[null]];
  if (!a) return res.status(404).json({ error: 'Account not found' });
  const [contacts] = await pool.query(
    `SELECT ac.contact_id, c.name, c.email, c.crm_classification, ac.title, ac.started_on, ac.ended_on, ac.is_primary, ac.is_champion, ac.is_decision_maker, ac.is_procurement, ac.is_finance
     FROM crm_account_contacts ac JOIN newsletter_contacts c ON c.id = ac.contact_id WHERE ac.account_id = ? ORDER BY ac.is_primary DESC, c.name`, [id]);
  const [opps] = await pool.query(
    `SELECT o.id, o.name, o.state, o.amount_cents, o.opp_type, s.label AS stage, o.owner_admin_id, o.next_step, o.next_step_due_at
     FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.account_id = ? ORDER BY o.id DESC`, [id]);
  const [children] = await pool.query('SELECT id, name, account_type FROM crm_accounts WHERE parent_account_id = ? ORDER BY name', [id]);
  const relation = (await rel.accountRelationships(pool)).get(Number(a.id)) || null;
  const todayDay = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const rollup = await roll.accountRollup(pool, a, todayDay);          // G17: paid purchases and deals
  // G17: other live accounts with the same website address, less any a person has said are separate.
  const possibleDuplicates = a.archived_at ? [] : ND.keepSuspected(a.id, await roll.duplicatesOf(pool, a), (await ND.dismissedPairs(pool)).set);
  res.json({
    rollup, possibleDuplicates,
    account: { ...accountRow(a), relationship: relation ? relation.relationship : null, needsReview: relation ? relation.needsReview : false, relationshipWhy: relation ? relation.why : null },
    contacts: contacts.map(c => ({ contactId: c.contact_id, name: c.name, email: c.email, classification: c.crm_classification, title: c.title, startedOn: c.started_on || null, endedOn: c.ended_on || null, isPrimary: !!c.is_primary, isChampion: !!c.is_champion, isDecisionMaker: !!c.is_decision_maker, isProcurement: !!c.is_procurement, isFinance: !!c.is_finance })),
    opportunities: opps.map(o => ({ id: o.id, name: o.name, state: o.state, stage: o.stage, oppType: o.opp_type, amountCents: o.amount_cents === null ? null : Number(o.amount_cents), ownerAdminId: o.owner_admin_id || null, nextStep: o.next_step, nextStepDueAt: o.next_step_due_at })),
    children,
  });
});

// Shared by create and update: validates and cleans the fields. Returns { error } or { fields }.
async function cleanAccount(b, { existing = null } = {}) {
  const f = {};
  if (!existing || b.name !== undefined) { f.name = text(b.name, 255); if (!f.name) return { error: 'A name is required.' }; }
  if (!existing || b.accountType !== undefined) { f.account_type = oneOf(b.accountType === undefined ? 'school' : b.accountType, ACCOUNT_TYPES); if (!f.account_type) return { error: `The type must be one of: ${ACCOUNT_TYPES.join(', ')}.` }; }
  for (const [key, col, max] of [['websiteDomain', 'website_domain', 255], ['state', 'state', 64], ['source', 'source', 128], ['description', 'description', 4000]]) {
    if (b[key] !== undefined) f[col] = text(b[key], max);
  }
  if (b.assignedAdminId !== undefined) {
    f.assigned_admin_id = b.assignedAdminId === null ? null : posInt(b.assignedAdminId);
    if (f.assigned_admin_id && !(await exists('admin_users', f.assigned_admin_id))) return { error: 'That staff member does not exist.' };
  }
  for (const [key, col, table] of [['schoolId', 'school_id', 'schools'], ['districtId', 'district_id', 'districts']]) {
    if (b[key] === undefined) continue;
    f[col] = b[key] === null ? null : posInt(b[key]);
    if (f[col] && !(await exists(table, f[col]))) return { error: `That ${key === 'schoolId' ? 'school' : 'district'} does not exist.` };
    if (f[col]) {
      const [dup] = await pool.query(`SELECT id FROM crm_accounts WHERE ${col} = ? ${existing ? 'AND id <> ?' : ''}`, existing ? [f[col], existing.id] : [f[col]]);
      if (dup[0]) return { error: `Another account is already linked to that ${key === 'schoolId' ? 'school' : 'district'}.`, status: 409, code: 'already_linked', existingAccountId: dup[0].id };
    }
  }
  if (b.parentAccountId !== undefined) {
    f.parent_account_id = b.parentAccountId === null ? null : posInt(b.parentAccountId);
    if (f.parent_account_id) {
      if (!(await exists('crm_accounts', f.parent_account_id))) return { error: 'That parent account does not exist.' };
      if (existing && await wouldCycle(existing.id, f.parent_account_id)) return { error: 'An account cannot be its own parent or sit under one of its own sub-accounts.' };
    }
  }
  return { fields: f };
}

router.post('/', requireAuth, requireCrm('write'), async (req, res) => {
  const b = req.body || {};
  const c = await cleanAccount(b);
  if (c.error) return res.status(c.status || 400).json({ code: c.code, existingAccountId: c.existingAccountId, error: c.error });
  // Same normalized name already on a live account: ask before making a second one. Never merged automatically.
  if (b.allowDuplicate !== true) {
    const [same] = await pool.query('SELECT id, name FROM crm_accounts WHERE archived_at IS NULL');
    const hit = same.find(r => normName(r.name) === normName(c.fields.name));
    if (hit) return res.status(409).json({ code: 'possible_duplicate', kind: 'same_name', existingAccountId: hit.id, error: `An account named "${hit.name}" already exists. Open it, or send allowDuplicate to create another.` });
    // Not the same name, but one that looks alike (same words, or one spelling slip; same type and state). A suggestion: say so once, and a second try with allowDuplicate goes ahead.
    const [live] = await pool.query('SELECT id, name, account_type, state FROM crm_accounts WHERE archived_at IS NULL');
    const similar = NM.suggestFor({ name: c.fields.name, accountType: c.fields.account_type, state: c.fields.state }, live.map(a => NM.prepare({ id: Number(a.id), name: a.name, accountType: a.account_type, state: a.state })), { limit: 3 });
    if (similar.length) return res.status(409).json({ code: 'possible_duplicate', kind: 'similar_name', existingAccountId: similar[0].id, similarAccounts: similar.map(a => ({ id: a.id, name: a.name, state: a.state })), error: `A similar account already exists: "${similar[0].name}"${similar[0].state ? ` (${similar[0].state})` : ''}. Open it, or send allowDuplicate to create another.` });
  }
  const f = { ...c.fields, created_by_admin_id: req.crm.adminId };
  if (!('assigned_admin_id' in f)) f.assigned_admin_id = null;
  const cols = Object.keys(f);
  const [r] = await pool.query(`INSERT INTO crm_accounts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => f[k]));
  await crmAudit(req, { action: 'crm_account_created', entityType: 'crm_account', entityId: r.insertId, next: { name: f.name, accountType: f.account_type } });
  res.status(201).json({ ok: true, id: r.insertId });
});

router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[a]] = id ? await pool.query('SELECT * FROM crm_accounts WHERE id = ?', [id]) : [[null]];
  if (!a) return res.status(404).json({ error: 'Account not found' });
  const c = await cleanAccount(req.body || {}, { existing: a });
  if (c.error) return res.status(c.status || 400).json({ code: c.code, existingAccountId: c.existingAccountId, error: c.error });
  const cols = Object.keys(c.fields);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  await pool.query(`UPDATE crm_accounts SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map(k => c.fields[k]), id]);
  await crmAudit(req, { action: 'crm_account_updated', entityType: 'crm_account', entityId: id, prev: Object.fromEntries(cols.map(k => [k, a[k]])), next: c.fields });
  res.json({ ok: true });
});

// Archive and restore: CRM Admin only (the matrix groups it with merge). An account with open deals cannot be archived.
router.post('/:id/archive', requireAuth, requireCrm('merge'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[a]] = id ? await pool.query('SELECT id, archived_at FROM crm_accounts WHERE id = ?', [id]) : [[null]];
  if (!a) return res.status(404).json({ error: 'Account not found' });
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM crm_opportunities WHERE account_id = ? AND state = 'open'", [id]);
  if (Number(n)) return res.status(409).json({ code: 'open_deals', error: `This account has ${n} open deal(s). Close or move them first.` });
  await pool.query('UPDATE crm_accounts SET archived_at = ? WHERE id = ?', [require('../lib/crm-classification').sqlNow(), id]);
  await crmAudit(req, { action: 'crm_account_archived', entityType: 'crm_account', entityId: id });
  res.json({ ok: true });
});

router.post('/:id/unarchive', requireAuth, requireCrm('merge'), async (req, res) => {
  const id = posInt(req.params.id);
  const [[a]] = id ? await pool.query('SELECT id FROM crm_accounts WHERE id = ?', [id]) : [[null]];
  if (!a) return res.status(404).json({ error: 'Account not found' });
  await pool.query('UPDATE crm_accounts SET archived_at = NULL WHERE id = ?', [id]);
  await crmAudit(req, { action: 'crm_account_restored', entityType: 'crm_account', entityId: id });
  res.json({ ok: true });
});

// ---- Membership: a person at an organization -------------------------------------------------------------------------------------

router.post('/:id/contacts', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const b = req.body || {};
  const contactId = posInt(b.contactId);
  if (!id || !contactId) return res.status(400).json({ error: 'An account and a contact are required.' });
  if (!(await exists('crm_accounts', id))) return res.status(404).json({ error: 'Account not found' });
  if (!(await exists('newsletter_contacts', contactId))) return res.status(404).json({ error: 'Contact not found' });
  const [dup] = await pool.query('SELECT id FROM crm_account_contacts WHERE account_id = ? AND contact_id = ?', [id, contactId]);
  if (dup[0]) return res.status(409).json({ code: 'already_member', error: 'This person is already on the account.' });
  const flag = k => (b[k] === true ? 1 : 0);
  // G16: the day they joined is recorded, and making someone the primary contact takes the badge off whoever had it, in the same step.
  await pool.query(
    `INSERT INTO crm_account_contacts (account_id, contact_id, title, is_primary, is_champion, is_decision_maker, is_procurement, is_finance, started_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, contactId, text(b.title, 128), flag('isPrimary'), flag('isChampion'), flag('isDecisionMaker'), flag('isProcurement'), flag('isFinance'), new Date().toISOString().slice(0, 10)]
  );
  if (flag('isPrimary')) await pool.query('UPDATE crm_account_contacts SET is_primary = 0 WHERE account_id = ? AND contact_id <> ? AND is_primary = 1', [id, contactId]);
  await crmAudit(req, { action: 'crm_account_contact_added', entityType: 'crm_account', entityId: id, next: { contactId } });
  res.status(201).json({ ok: true });
});

router.put('/:id/contacts/:contactId', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const contactId = posInt(req.params.contactId);
  const [[m]] = id && contactId ? await pool.query('SELECT id, ended_on FROM crm_account_contacts WHERE account_id = ? AND contact_id = ?', [id, contactId]) : [[null]];
  if (!m) return res.status(404).json({ error: 'That person is not on this account.' });
  const b = req.body || {};
  if (b.isPrimary === true && m.ended_on) return res.status(409).json({ code: 'left', error: 'This person has left the organization, so they cannot be its primary contact. Mark them as back first.' });
  const sets = [];
  const vals = [];
  if (b.title !== undefined) { sets.push('title = ?'); vals.push(text(b.title, 128)); }
  for (const [key, col] of [['isPrimary', 'is_primary'], ['isChampion', 'is_champion'], ['isDecisionMaker', 'is_decision_maker'], ['isProcurement', 'is_procurement'], ['isFinance', 'is_finance']]) {
    if (b[key] !== undefined) { sets.push(`${col} = ?`); vals.push(b[key] === true ? 1 : 0); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
  await pool.query(`UPDATE crm_account_contacts SET ${sets.join(', ')} WHERE id = ?`, [...vals, m.id]);
  if (b.isPrimary === true) await pool.query('UPDATE crm_account_contacts SET is_primary = 0 WHERE account_id = ? AND id <> ? AND is_primary = 1', [id, m.id]); // only one primary contact per account
  await crmAudit(req, { action: 'crm_account_contact_updated', entityType: 'crm_account', entityId: id, next: { contactId } });
  res.json({ ok: true });
});

// G16: a person who has left the organization keeps their place in its history. The date they left is recorded, they are no longer its primary contact and no longer count as
// someone to invite or reach there, and "Back" undoes it. "Remove" (below) is for an entry made by mistake.
router.post('/:id/contacts/:contactId/left', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id), contactId = posInt(req.params.contactId);
  const [[m]] = id && contactId ? await pool.query('SELECT id, ended_on FROM crm_account_contacts WHERE account_id = ? AND contact_id = ?', [id, contactId]) : [[null]];
  if (!m) return res.status(404).json({ error: 'That person is not on this account.' });
  if (m.ended_on) return res.json({ ok: true, unchanged: true });
  const day = dateOnly((req.body || {}).on) || new Date().toISOString().slice(0, 10);
  if (day > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'The day they left cannot be in the future.' });
  const [u] = await pool.query('UPDATE crm_account_contacts SET ended_on = ?, is_primary = 0 WHERE id = ? AND ended_on IS NULL', [day, m.id]);
  if (!u.affectedRows) return res.json({ ok: true, unchanged: true });
  await crmAudit(req, { action: 'crm_account_contact_left', entityType: 'crm_account', entityId: id, next: { contactId, on: day } });
  res.json({ ok: true });
});
router.post('/:id/contacts/:contactId/back', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id), contactId = posInt(req.params.contactId);
  const [[m]] = id && contactId ? await pool.query('SELECT id, ended_on FROM crm_account_contacts WHERE account_id = ? AND contact_id = ?', [id, contactId]) : [[null]];
  if (!m) return res.status(404).json({ error: 'That person is not on this account.' });
  if (!m.ended_on) return res.json({ ok: true, unchanged: true });
  await pool.query('UPDATE crm_account_contacts SET ended_on = NULL WHERE id = ?', [m.id]);
  await crmAudit(req, { action: 'crm_account_contact_back', entityType: 'crm_account', entityId: id, next: { contactId } });
  res.json({ ok: true });
});

router.delete('/:id/contacts/:contactId', requireAuth, requireCrm('write'), async (req, res) => {
  const id = posInt(req.params.id);
  const contactId = posInt(req.params.contactId);
  if (!id || !contactId) return res.status(400).json({ error: 'An account and a contact are required.' });
  const [r] = await pool.query('DELETE FROM crm_account_contacts WHERE account_id = ? AND contact_id = ?', [id, contactId]);
  if (!r.affectedRows) return res.status(404).json({ error: 'That person is not on this account.' });
  await crmAudit(req, { action: 'crm_account_contact_removed', entityType: 'crm_account', entityId: id, prev: { contactId } });
  res.json({ ok: true });
});

// Merge a duplicate account into the one you keep: CRM Admin only. Everything moves (people, deals, sub-accounts, a school or district link the kept
// account does not already have, the owner if the kept one has none). The duplicate is archived with a note, never deleted, so it can be looked at
// or restored. Never done automatically, and never suggested from a shared email domain.
router.post('/:id/merge', requireAuth, requireCrm('merge'), async (req, res) => {
  const fromId = posInt(req.params.id);
  const intoId = posInt((req.body || {}).intoId);
  if (!fromId || !intoId) return res.status(400).json({ error: 'Pick the account to keep.' });
  if (fromId === intoId) return res.status(400).json({ error: 'Pick a different account to keep.' });
  const [[from]] = await pool.query('SELECT * FROM crm_accounts WHERE id = ?', [fromId]);
  const [[into]] = await pool.query('SELECT * FROM crm_accounts WHERE id = ?', [intoId]);
  if (!from || !into) return res.status(404).json({ error: 'Account not found' });
  if (from.archived_at) return res.status(409).json({ code: 'already_archived', error: 'The account you are merging away is already archived.' });
  if (into.archived_at) return res.status(409).json({ code: 'account_archived', error: 'The account you are keeping is archived. Restore it first.' });
  if (await wouldCycle(fromId, intoId)) return res.status(409).json({ code: 'sub_account', error: 'The account you are keeping sits under the one you are merging away. Move it out first.' });

  const conn = await pool.getConnection();
  const moved = { people: 0, deals: 0, subAccounts: 0 };
  try {
    await conn.beginTransaction();
    const [keptPeople] = await conn.query('SELECT contact_id FROM crm_account_contacts WHERE account_id = ?', [intoId]);
    const have = new Set(keptPeople.map(r => r.contact_id));
    const [fromPeople] = await conn.query('SELECT id, contact_id FROM crm_account_contacts WHERE account_id = ?', [fromId]);
    for (const m of fromPeople) {
      if (have.has(m.contact_id)) await conn.query('DELETE FROM crm_account_contacts WHERE id = ?', [m.id]);
      else { await conn.query('UPDATE crm_account_contacts SET account_id = ? WHERE id = ?', [intoId, m.id]); moved.people++; }
    }
    const [d] = await conn.query('UPDATE crm_opportunities SET account_id = ? WHERE account_id = ?', [intoId, fromId]);
    // Phase 3: tasks, notes, files and meetings on the account (and on its deals, which carry the account id too) move with it.
    for (const table of ['crm_tasks', 'crm_notes', 'crm_attachments', 'crm_appointments']) await conn.query(`UPDATE ${table} SET account_id = ? WHERE account_id = ?`, [intoId, fromId]);
    moved.deals = d.affectedRows;
    const [k] = await conn.query('UPDATE crm_accounts SET parent_account_id = ? WHERE parent_account_id = ?', [intoId, fromId]);
    moved.subAccounts = k.affectedRows;
    // Each school and district can be linked to one account only, so free the duplicate's link first, then give it to the kept account if that has none.
    const sets = [];
    const vals = [];
    if (from.school_id) { await conn.query('UPDATE crm_accounts SET school_id = NULL WHERE id = ?', [fromId]); if (!into.school_id) { sets.push('school_id = ?'); vals.push(from.school_id); } }
    if (from.district_id) { await conn.query('UPDATE crm_accounts SET district_id = NULL WHERE id = ?', [fromId]); if (!into.district_id) { sets.push('district_id = ?'); vals.push(from.district_id); } }
    if (!into.assigned_admin_id && from.assigned_admin_id) { sets.push('assigned_admin_id = ?'); vals.push(from.assigned_admin_id); }
    if (!into.website_domain && from.website_domain) { sets.push('website_domain = ?'); vals.push(from.website_domain); }
    if (sets.length) await conn.query(`UPDATE crm_accounts SET ${sets.join(', ')} WHERE id = ?`, [...vals, intoId]);
    const note = `Merged into "${into.name}" (account ${intoId}) on ${require('../lib/crm-classification').sqlNow().slice(0, 10)}.`;
    await conn.query('UPDATE crm_accounts SET archived_at = ?, description = ? WHERE id = ?',
      [require('../lib/crm-classification').sqlNow(), `${note}${from.description ? ' ' + from.description : ''}`.slice(0, 4000), fromId]);
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* the original error matters */ }
    throw err;
  } finally {
    if (conn.release) conn.release();
  }
  await crmAudit(req, { action: 'crm_account_merged', entityType: 'crm_account', entityId: intoId, prev: { mergedAwayId: fromId, name: from.name, schoolId: from.school_id || null, districtId: from.district_id || null }, next: moved, reason: text((req.body || {}).reason, 255) });
  res.json({ ok: true, keptId: intoId, moved });
});

module.exports = router;
