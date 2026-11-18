// Sales CRM punch list G19 (PRD section 17): the list filters by buying role, license status and organization, for contacts and for accounts. Pure SQL builders: each returns
// { sql, params } to be ANDed into a WHERE clause; nothing here reads or writes by itself.
//
// Rules this file keeps (each has a test):
//  - "License status" is a plain fact from purchases and trials (the owner's choice, 2026-11-17), never a score and never usage: LIVE PAID (the one Customer rule, QUALIFYING_SQL, not
//    cancelled or suspended, not past its end date), LIVE TRIAL (trial-like, not cancelled or suspended, not past its end date; a trial with no end date counts as live because nothing
//    says it ended), ENDED TRIAL ONLY (has had a trial, has neither of the above), NONE (no purchase of any kind).
//  - For an account a purchase is placed the way the Customer label places it: by the account's school, or for a district by any school in it (lib/crm-account-relationship.js).
//  - A buying role comes from either place a role is recorded: the flags on a person's place at an account (champion, decision maker, procurement, finance; only while they are still
//    there) or their role on a deal's buying committee. A person who has left an organization no longer holds its roles.
//  - Test addresses (@example.com) are left out of purchase facts the same way the rest of the CRM leaves them out.
const cls = require('./crm-classification');

const ROLES = { champion: 'is_champion', decision_maker: 'is_decision_maker', procurement: 'is_procurement', finance: 'is_finance' };
const LICENSES = ['paid', 'trial', 'ended_trial', 'none'];
// Own keys only: a role of "constructor" or "__proto__" from the address bar must be "no filter", never a lookup on the object's prototype.
const roleColumn = (role) => (typeof role === 'string' && Object.prototype.hasOwnProperty.call(ROLES, role) ? ROLES[role] : null);
const LIVE_STATUS = "COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended')";
const NOT_TEST = "LOWER(TRIM(pc.email)) NOT LIKE '%@example.com'";

// The people of a purchase set, as a correlated fragment. `who` is the SQL that ties a purchase to the row being filtered.
const livePaid = (who, today) => ({ sql: `EXISTS (SELECT 1 ${cls.PURCHASES_FROM} JOIN newsletter_contacts pc ON pc.id = p.contact_id WHERE ${who} AND ${cls.QUALIFYING_SQL} AND ${NOT_TEST} AND ${LIVE_STATUS} AND (p.expiration_date IS NULL OR p.expiration_date >= ?))`, params: [today] });
const liveTrial = (who, today) => ({ sql: `EXISTS (SELECT 1 ${cls.PURCHASES_FROM} JOIN newsletter_contacts pc ON pc.id = p.contact_id WHERE ${who} AND ${cls.TRIAL_LIKE_SQL} AND ${NOT_TEST} AND ${LIVE_STATUS} AND (COALESCE(p.trial_expiration_date, p.expiration_date) IS NULL OR COALESCE(p.trial_expiration_date, p.expiration_date) >= ?))`, params: [today] });
const anyTrial = (who) => ({ sql: `EXISTS (SELECT 1 ${cls.PURCHASES_FROM} JOIN newsletter_contacts pc ON pc.id = p.contact_id WHERE ${who} AND ${cls.TRIAL_LIKE_SQL} AND ${NOT_TEST})`, params: [] });
const anyPurchase = (who) => ({ sql: `EXISTS (SELECT 1 FROM purchases p JOIN newsletter_contacts pc ON pc.id = p.contact_id WHERE ${who} AND ${NOT_TEST})`, params: [] });

function byStatus(kind, who, today) {
  if (kind === 'paid') return livePaid(who, today);
  if (kind === 'trial') return liveTrial(who, today);
  if (kind === 'ended_trial') { const t = anyTrial(who), lt = liveTrial(who, today), lp = livePaid(who, today); return { sql: `(${t.sql} AND NOT ${lt.sql} AND NOT ${lp.sql})`, params: [...t.params, ...lt.params, ...lp.params] }; }
  if (kind === 'none') { const a = anyPurchase(who); return { sql: `NOT ${a.sql}`, params: a.params }; }
  return null;
}

// Contacts: c is newsletter_contacts. A purchase belongs to the person who bought it.
const licenseForContact = (kind, today) => byStatus(kind, 'p.contact_id = c.id', today);
// Accounts: a is crm_accounts. A purchase is placed on the account by its school, or by any school in its district.
const licenseForAccount = (kind, today) => byStatus(kind, '(p.school_id = a.school_id OR p.school_id IN (SELECT sc.id FROM schools sc WHERE sc.district_id = a.district_id))', today);

// Contacts who hold a buying role: on an account (still there) or on a deal's buying committee.
function roleForContact(role) {
  const col = roleColumn(role);
  if (!col) return null;
  return { sql: `(EXISTS (SELECT 1 FROM crm_account_contacts ac WHERE ac.contact_id = c.id AND ac.${col} = 1 AND ac.ended_on IS NULL) OR EXISTS (SELECT 1 FROM crm_opportunity_contacts oc WHERE oc.contact_id = c.id AND oc.role = ?))`, params: [role] };
}
// Accounts that have at least one person (still there) in that role.
function roleForAccount(role) {
  const col = roleColumn(role);
  if (!col) return null;
  return { sql: `EXISTS (SELECT 1 FROM crm_account_contacts ac WHERE ac.account_id = a.id AND ac.${col} = 1 AND ac.ended_on IS NULL)`, params: [] };
}

// Contacts at an organization: by exact account id, or by part of its name. Only people still there count.
function organizationForContact({ accountId, like }) {
  if (accountId) return { sql: 'EXISTS (SELECT 1 FROM crm_account_contacts ac WHERE ac.contact_id = c.id AND ac.account_id = ? AND ac.ended_on IS NULL)', params: [accountId] };
  if (like) return { sql: "EXISTS (SELECT 1 FROM crm_account_contacts ac JOIN crm_accounts oa ON oa.id = ac.account_id WHERE ac.contact_id = c.id AND ac.ended_on IS NULL AND oa.archived_at IS NULL AND oa.name LIKE ? ESCAPE '!')", params: [like] };
  return null;
}

module.exports = { ROLES, LICENSES, licenseForContact, licenseForAccount, roleForContact, roleForAccount, organizationForContact };
