// Sales CRM gap G1: what an ACCOUNT (a school or district) is to us: Customer, Prospect or Suspect, and whether it needs a person's review. Derived on every read, never stored,
// so it cannot drift: the one place that decides is this file (the Overview's "Customer organizations" card uses customerAccountIds() too).
//
//  Customer  a paid, non-trial purchase (the same rule as a contact, lib/crm-classification.js) is placed on the organization: its school_id is the account's school, or is a
//            school of the account's district (decision D4). A purchase that names no school is never guessed into an account.
//  Prospect  not a Customer, and it has an open deal, or a person on it is a Prospect or a Customer (owner's answer, 2026-11-15). A lost or set-aside deal alone does not make one.
//  Suspect   anything else.
//  Needs review  separate from the label: a person on the account owns a paid, non-trial purchase that names no school, so it cannot be placed (D4's "unresolved, needs review").
//                Not shown for an account that is already a Customer. The CRM never edits a purchase; staff fix the school in the old admin tool and the flag clears itself.
//
// Test addresses (@example.com) are left out everywhere. Every function reads only; `conn` is the pool in the routes and any handle in tests. SQL stays portable.
const cls = require('./crm-classification');
const { DEAL_REAL_SQL } = require('./crm-reports');

const NOT_TEST_BUYER = "LOWER(TRIM(c.email)) NOT LIKE '%@example.com'";
const LABELS = ['suspect', 'prospect', 'customer'];

// Accounts with a paid, non-trial purchase placed on them, by school or through the district's schools.
async function customerAccountIds(conn) {
  const [rows] = await conn.query(
    `SELECT a.id FROM crm_accounts a WHERE a.archived_at IS NULL AND EXISTS (
       SELECT 1 ${cls.PURCHASES_FROM} JOIN newsletter_contacts c ON c.id = p.contact_id
       WHERE ${cls.QUALIFYING_SQL} AND ${NOT_TEST_BUYER}
         AND (p.school_id = a.school_id OR p.school_id IN (SELECT sc.id FROM schools sc WHERE sc.district_id = a.district_id)))`);
  return new Set(rows.map(r => Number(r.id)));
}

// Paid, non-trial, non-test purchases that name no school (so they cannot be placed), each with the accounts its buyer belongs to.
async function unplacedPurchases(conn) {
  // The school named on the purchase (a free-text domain) is a convenience for the review list; a database without that column still gets the list, without it.
  const sql = (cols) => `SELECT p.id, p.contact_id, ${cols}p.purchased_at, p.amount_cents, c.name AS contact_name, c.email AS contact_email
     ${cls.PURCHASES_FROM} JOIN newsletter_contacts c ON c.id = p.contact_id WHERE ${cls.QUALIFYING_SQL} AND ${NOT_TEST_BUYER} AND p.school_id IS NULL ORDER BY p.id`;
  let rows;
  try { [rows] = await conn.query(sql('p.school_domain, ')); } catch (err) {
    if (!(err && (err.code === 'ER_BAD_FIELD_ERROR' || /no such column|has no column named/i.test(String(err.message))))) throw err;
    [rows] = await conn.query(sql(''));
  }
  const ids = [...new Set(rows.map(r => Number(r.contact_id)))];
  const accountsOf = new Map();
  if (ids.length) {
    const [mem] = await conn.query(`SELECT ac.contact_id, a.id, a.name FROM crm_account_contacts ac JOIN crm_accounts a ON a.id = ac.account_id WHERE a.archived_at IS NULL AND ac.contact_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.name`, ids);
    for (const m of mem) accountsOf.set(Number(m.contact_id), (accountsOf.get(Number(m.contact_id)) || []).concat({ id: Number(m.id), name: m.name }));
  }
  return rows.map(r => ({ purchaseId: Number(r.id), contactId: Number(r.contact_id), contactName: r.contact_name || null, contactEmail: r.contact_email, schoolDomain: r.school_domain || null,
    purchasedAt: r.purchased_at, amountCents: r.amount_cents === null || r.amount_cents === undefined ? null : Number(r.amount_cents), accounts: accountsOf.get(Number(r.contact_id)) || [] }));
}

// { id -> { relationship, needsReview, why } } for every live account.
async function accountRelationships(conn, today = new Date().toISOString().slice(0, 10)) {
  const [accounts] = await conn.query('SELECT id, account_type FROM crm_accounts WHERE archived_at IS NULL');
  const customers = await customerAccountIds(conn);
  const [open] = await conn.query(`SELECT DISTINCT o.account_id AS id FROM crm_opportunities o WHERE o.state = 'open' AND ${DEAL_REAL_SQL}`);
  const openDeal = new Set(open.map(r => Number(r.id)));
  const [people] = await conn.query(
    `SELECT DISTINCT ac.account_id AS id FROM crm_account_contacts ac JOIN newsletter_contacts c ON c.id = ac.contact_id
     WHERE c.crm_classification IN ('prospect', 'customer') AND ${NOT_TEST_BUYER} AND (ac.ended_on IS NULL OR ac.ended_on >= ?)`, [today]);
  const withProspectPerson = new Set(people.map(r => Number(r.id)));
  const review = new Set();
  for (const u of await unplacedPurchases(conn)) for (const a of u.accounts) review.add(a.id);

  const out = new Map();
  for (const a of accounts) {
    const id = Number(a.id), kind = a.account_type === 'district' ? 'district' : 'school';
    let relationship, why;
    if (customers.has(id)) { relationship = 'customer'; why = `A paid, non-trial purchase is placed on this ${kind}.`; }
    else if (openDeal.has(id)) { relationship = 'prospect'; why = 'It has an open deal.'; }
    else if (withProspectPerson.has(id)) { relationship = 'prospect'; why = 'A person on this account is a Prospect or a Customer.'; }
    else { relationship = 'suspect'; why = 'No open deal, and nobody on this account has shown buying interest yet.'; }
    const needsReview = relationship !== 'customer' && review.has(id);
    if (needsReview) why += ' A person here also owns a paid purchase that names no school, so it cannot be placed on any account. It is listed on the Accounts page.';
    out.set(id, { relationship, needsReview, why });
  }
  return out;
}

function relationshipCounts(map) {
  const c = { suspect: 0, prospect: 0, customer: 0, review: 0 };
  for (const v of map.values()) { c[v.relationship]++; if (v.needsReview) c.review++; }
  return c;
}

module.exports = { LABELS, customerAccountIds, unplacedPurchases, accountRelationships, relationshipCounts };
