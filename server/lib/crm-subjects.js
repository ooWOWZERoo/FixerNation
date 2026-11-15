// Sales CRM phase 3: what a task, note, file, meeting or checklist item belongs to (its "subject"), and whether the signed-in role may change it.
//
// A subject is a deal, an account or a contact: exactly one of opportunityId / accountId / contactId, never none (so nothing is orphaned) and never two.
// A row for a deal also stores that deal's account_id, so the account timeline and the account's lists find it without a join; a row for an account or a
// contact stores just that one column. Whoever lists "everything for an account" filters on account_id; "just this deal" filters on opportunity_id.
// The role check is in lib/crm-permissions.js (canWriteSubject); this file only finds the subject and builds the pieces the routes share.

const pool = require('../db/pool');
const { posInt, dateOnly } = require('./crm-common');
const { canWriteSubject } = require('./crm-permissions');

// 'YYYY-MM-DD' for "today". The browser sends its own calendar day (so "due today" means today where the person is); anything that is not a real date within a
// day or two of the server's UTC date is ignored, so a wrong or hostile value cannot move the line by more than a day.
function todayFrom(value) {
  const utc = new Date().toISOString().slice(0, 10);
  const d = dateOnly(value);
  if (!d) return utc;
  const off = Math.abs(new Date(`${d}T00:00:00Z`).getTime() - new Date(`${utc}T00:00:00Z`).getTime());
  return off <= 2 * 86400000 ? d : utc;
}
function addDays(day, n) {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}

// Reads the one subject a request names. Returns { subject } or { error, status }.
//   subject = { kind, id, cols: { opportunity_id, account_id, contact_id }, dealOwnerAdminId }
async function resolveSubject(src) {
  src = src || {};
  const named = [['opportunity', src.opportunityId], ['account', src.accountId], ['contact', src.contactId]]
    .filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (named.length !== 1) return { error: 'Say what this belongs to: one deal, one account or one contact.', status: 400 };
  const [kind, raw] = named[0];
  const id = posInt(raw);
  if (!id) return { error: 'That is not a valid id.', status: 400 };
  if (kind === 'opportunity') {
    const [[o]] = await pool.query('SELECT id, account_id, owner_admin_id FROM crm_opportunities WHERE id = ?', [id]);
    if (!o) return { error: 'That deal does not exist.', status: 404 };
    return { subject: { kind, id, cols: { opportunity_id: id, account_id: o.account_id, contact_id: null }, dealOwnerAdminId: o.owner_admin_id || null } };
  }
  if (kind === 'account') {
    const [[a]] = await pool.query('SELECT id FROM crm_accounts WHERE id = ?', [id]);
    if (!a) return { error: 'That account does not exist.', status: 404 };
    return { subject: { kind, id, cols: { opportunity_id: null, account_id: id, contact_id: null }, dealOwnerAdminId: null } };
  }
  const [[c]] = await pool.query('SELECT id FROM newsletter_contacts WHERE id = ?', [id]);
  if (!c) return { error: 'That contact does not exist.', status: 404 };
  return { subject: { kind, id, cols: { opportunity_id: null, account_id: null, contact_id: id }, dealOwnerAdminId: null } };
}

// The same, for a list request: returns { column, id } to filter on. An account list includes its deals' items (they carry the account_id too).
function listFilter(src, alias) {
  src = src || {};
  const a = alias ? `${alias}.` : '';
  const pairs = [['opportunity_id', src.opportunityId], ['account_id', src.accountId], ['contact_id', src.contactId]]
    .filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (pairs.length !== 1) return { error: 'Say whose list this is: one deal, one account or one contact.' };
  const id = posInt(pairs[0][1]);
  if (!id) return { error: 'That is not a valid id.' };
  return { where: `${a}${pairs[0][0]} = ?`, params: [id] };
}

// Which kind of subject an existing row belongs to (a deal row also has an account_id, so check the deal first).
function kindOfRow(row) { return row.opportunity_id ? 'opportunity' : row.contact_id ? 'contact' : 'account'; }

// For rows read with a LEFT JOIN to the deal (alias gives the owner as deal_owner_id): may this person change it?
function canWriteRow(req, row) {
  return canWriteSubject(req.crm.role, req.crm.adminId, { kind: kindOfRow(row), dealOwnerAdminId: row.deal_owner_id === undefined ? null : row.deal_owner_id });
}
function canWriteResolved(req, subject) { return canWriteSubject(req.crm.role, req.crm.adminId, subject); }

// SQL pieces that put the subject's names next to a row. `t` is the alias of the item's table.
const SUBJECT_JOIN = (t) => `LEFT JOIN crm_opportunities so ON so.id = ${t}.opportunity_id
  LEFT JOIN crm_accounts sa ON sa.id = ${t}.account_id
  LEFT JOIN newsletter_contacts sc ON sc.id = ${t}.contact_id`;
const SUBJECT_COLS = 'so.name AS deal_name, so.owner_admin_id AS deal_owner_id, sa.name AS account_name, sc.name AS contact_name, sc.email AS contact_email';

function subjectView(row) {
  return {
    kind: kindOfRow(row),
    opportunityId: row.opportunity_id || null, dealName: row.deal_name || null,
    accountId: row.account_id || null, accountName: row.account_name || null,
    contactId: row.contact_id || null, contactName: row.contact_name || row.contact_email || null,
  };
}

// An existing row, loaded with its deal owner, by id, for the routes that change or open one item.
async function loadItem(table, id) {
  const n = posInt(id);
  if (!n) return null;
  const [[row]] = await pool.query(`SELECT t.*, so.owner_admin_id AS deal_owner_id FROM ${table} t LEFT JOIN crm_opportunities so ON so.id = t.opportunity_id WHERE t.id = ?`, [n]);
  return row || null;
}

module.exports = { todayFrom, addDays, resolveSubject, listFilter, kindOfRow, canWriteRow, canWriteResolved, SUBJECT_JOIN, SUBJECT_COLS, subjectView, loadItem };
