// Sales CRM: quotes that are not yet tied to a deal or a contact (docs/reference/sales-crm-update-requirements.md, phase 2).
// The CRM only READS quote_requests and sets two link columns (contact_id, opportunity_id). It never changes a quote's status, price, token or dates.
// The accept token is a credential for the public accept page and is never selected here.
const { likeTerm } = require('./crm-common');
const { TEST_ADDRESS_SQL } = require('./crm-classification');
const pool = require('../db/pool');
const { isCrmEnabled, loadCrmRole, canEditDeal } = require('./crm-permissions');

// Same evidence the phase 1 backfill uses, so a deal made by hand starts where a backfilled one would.
function stageForQuote(q) {
  const sent = !!q.quote_sent_at;
  if (q.status === 'converted') return { stageKey: 'won', state: 'won' };
  if (q.status === 'closed') return { stageKey: sent ? 'proposal_sent' : 'new_inquiry', state: 'inactive' };
  if (q.status === 'contacted') return { stageKey: sent ? 'proposal_sent' : 'qualified', state: 'open' };
  return { stageKey: sent ? 'proposal_sent' : 'new_inquiry', state: 'open' };
}

function dealName(q) {
  const label = String(q.quoted_product_name || 'Quote').slice(0, 120);
  return `${String(q.school || 'Quote').slice(0, 100)} - ${label}${q.quote_number ? ` (${q.quote_number})` : ''}`.slice(0, 255);
}

// Contacts whose email equals the quote's, ignoring case and spaces. Exactly one is a safe automatic link; none or several never are.
async function matchingContacts(conn, email) {
  if (typeof email !== 'string' || !email.trim()) return [];
  const [rows] = await conn.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [email]);
  return rows.map(r => r.id);
}

const QUOTE_TEST_SQL = TEST_ADDRESS_SQL.replace(/\bemail\b/, 'q.email');

// gap: 'no_deal' | 'no_contact' | 'any'. Returns { rows, total }.
async function listQuoteGaps(conn, { gap = 'any', q = null, includeTest = false, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (gap === 'no_deal') where.push('q.opportunity_id IS NULL');
  else if (gap === 'no_contact') where.push('q.contact_id IS NULL');
  else where.push('(q.opportunity_id IS NULL OR q.contact_id IS NULL)');
  if (!includeTest) where.push(`NOT (${QUOTE_TEST_SQL})`);
  const like = likeTerm(q);
  if (like) {
    where.push("(q.email LIKE ? ESCAPE '!' OR q.school LIKE ? ESCAPE '!' OR q.first_name LIKE ? ESCAPE '!' OR q.last_name LIKE ? ESCAPE '!' OR q.quote_number LIKE ? ESCAPE '!')");
    params.push(like, like, like, like, like);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM quote_requests q ${w}`, params);
  const [rows] = await conn.query(
    `SELECT q.id, q.quote_number, q.first_name, q.last_name, q.email, q.school, q.status, q.quoted_amount_cents, q.quoted_product_name, q.quote_sent_at, q.created_at,
            q.contact_id, q.opportunity_id,
            (SELECT COUNT(*) FROM newsletter_contacts c WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(q.email))) AS email_matches
     FROM quote_requests q ${w} ORDER BY q.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    total: Number(total),
    rows: rows.map(r => ({
      id: r.id, quoteNumber: r.quote_number, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, email: r.email, school: r.school,
      status: r.status, amountCents: r.quoted_amount_cents === null || r.quoted_amount_cents === undefined ? null : Number(r.quoted_amount_cents),
      product: r.quoted_product_name || null, sentAt: r.quote_sent_at || null, createdAt: r.created_at || null,
      contactId: r.contact_id || null, opportunityId: r.opportunity_id || null,
      // 1 = a click can link it; 0 = no contact has this email (staff pick one); more than 1 = ambiguous, staff pick one.
      emailMatches: Number(r.email_matches),
    })),
  };
}

// Phase 4b: the links a new quote gets. Never throws and never blocks the request: a database that has not had scripts/alter-create-crm-quotes.js (or the
// phase 1 script) run yet simply leaves the quote unlinked, and "Quotes without a deal" still finds it. Returns the contact id it linked, or null.
const quiet = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || /no such column|has no column named/i.test(String(err.message)));

async function setQuoteLinks(db, quoteId, { contactEmail = null, opportunityId = null, adminId = null } = {}) {
  let linked = null;
  try {
    if (contactEmail) {
      const ids = await matchingContacts(db, contactEmail);
      if (ids.length === 1) { await db.query('UPDATE quote_requests SET contact_id = ? WHERE id = ?', [ids[0], quoteId]); linked = ids[0]; }
    }
    if (opportunityId) await db.query('UPDATE quote_requests SET opportunity_id = ? WHERE id = ?', [opportunityId, quoteId]);
    if (adminId) await db.query('UPDATE quote_requests SET created_by_admin_id = ? WHERE id = ?', [adminId, quoteId]);
  } catch (err) {
    if (!quiet(err)) console.error('linking a new quote failed:', err.message);
  }
  return linked;
}

// May this signed-in admin put a quote on this deal? Needs the Hub on and a CRM role that can edit THAT deal (Sales: their own or unowned; Read-only: never).
// Returns { deal } or { error, status }.
async function dealForQuote(req, opportunityId) {
  if (!(await isCrmEnabled())) return { status: 400, error: 'The Customer Hub is off, so a quote cannot be put on a deal.' };
  const role = await loadCrmRole(req.user.userId);
  if (!role) return { status: 403, error: 'You do not have a Sales CRM role.' };
  const [[deal]] = await pool.query('SELECT id, owner_admin_id, state FROM crm_opportunities WHERE id = ?', [opportunityId]);
  if (!deal) return { status: 400, error: 'That deal does not exist.' };
  if (!canEditDeal(role, req.user.userId, deal)) return { status: 403, error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' };
  return { deal };
}

module.exports = { stageForQuote, dealName, matchingContacts, listQuoteGaps, setQuoteLinks, dealForQuote };
