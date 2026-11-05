// Who counts as a Community member (docs/reference/crm-record-of-truth-requirements.md, rule D): a person with a CRM contact
// (matched by email) AND a license that is working right now, who is not a sales-demo account. The CRM is the record of who is
// on the platform; Community lists, group counts, direct-message recipients and Community access itself all follow it, so a
// contact that is removed, or a license that ends, takes the person out of Community without anyone editing Community.
//

// A purchase whose license is working right now. The same test as hasActiveLicense() in lib/access.js, as SQL.
// CURRENT_DATE works in MariaDB and in the node:sqlite tests.
function workingPurchaseSql(p) {
  return `${p}.license_status NOT IN ('pending', 'expired', 'cancelled', 'suspended')
    AND (${p}.expiration_date IS NULL OR ${p}.expiration_date >= CURRENT_DATE)`;
}

// SQL for "this site_users row (alias) holds something that opens Community": a registered seat (a teacher), OR an active school
// license administrator assignment, OR an active district administrator assignment, each on a license that is working now.
// Administrators hold no seat, so before Release 111 they could not use Community at all.
function communityLicenseSql(alias) {
  return `(EXISTS (SELECT 1 FROM license_seats lsm JOIN purchases pm ON pm.id = lsm.purchase_id
                   WHERE lsm.registered_site_user_id = ${alias}.id AND lsm.status = 'registered' AND ${workingPurchaseSql('pm')})
    OR EXISTS (SELECT 1 FROM school_license_admins slm JOIN purchases ps ON ps.id = slm.purchase_id
               WHERE slm.site_user_id = ${alias}.id AND slm.is_active = 1 AND ${workingPurchaseSql('ps')})
    OR EXISTS (SELECT 1 FROM district_license_admins dlm JOIN schools sd ON sd.district_id = dlm.district_id
               JOIN purchases pd ON (pd.school_id = sd.id OR pd.school_domain = sd.domain)
               WHERE dlm.site_user_id = ${alias}.id AND dlm.is_active = 1 AND ${workingPurchaseSql('pd')}))`;
}

// SQL for "this site_users row (alias) is a current Community member".
function communityMemberSql(alias) {
  return `(${alias}.is_sales_demo = 0
    AND EXISTS (SELECT 1 FROM newsletter_contacts crm WHERE LOWER(crm.email) = LOWER(${alias}.email))
    AND ${communityLicenseSql(alias)})`;
}

// The school shown beside a member: the school of their seat, else of their school administrator assignment.
function schoolDomainSql(alias) {
  return `COALESCE(
    (SELECT p.school_domain FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id
     WHERE ls.registered_site_user_id = ${alias}.id AND ls.status = 'registered' LIMIT 1),
    (SELECT p.school_domain FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id
     WHERE sla.site_user_id = ${alias}.id AND sla.is_active = 1 LIMIT 1))`;
}

async function hasCommunityLicense(db, siteUserId) {
  if (!siteUserId) return false;
  const [rows] = await db.query(`SELECT 1 AS yes FROM site_users su WHERE su.id = ? AND ${communityLicenseSql('su')}`, [siteUserId]);
  return rows.length > 0;
}

async function isCommunityMember(db, siteUserId) {
  if (!siteUserId) return false;
  const [rows] = await db.query(`SELECT 1 AS yes FROM site_users su WHERE su.id = ? AND ${communityMemberSql('su')}`, [siteUserId]);
  return rows.length > 0;
}

async function hasCrmContact(db, email) {
  const [rows] = await db.query('SELECT 1 AS yes FROM newsletter_contacts WHERE LOWER(email) = LOWER(?)', [String(email || '')]);
  return rows.length > 0;
}

module.exports = { communityMemberSql, communityLicenseSql, schoolDomainSql, hasCommunityLicense, isCommunityMember, hasCrmContact };
