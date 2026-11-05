// Who counts as a Community member (docs/reference/crm-record-of-truth-requirements.md, rule D): a person with a CRM contact
// (matched by email) AND a license that is working right now, who is not a sales-demo account. The CRM is the record of who is
// on the platform; Community lists, group counts, direct-message recipients and Community access itself all follow it, so a
// contact that is removed, or a license that ends, takes the person out of Community without anyone editing Community.
//
// The license part is the same test as hasActiveLicense() in lib/access.js, written as SQL so a list can use it. CURRENT_DATE
// works in MariaDB and in the node:sqlite tests.

// SQL for "this site_users row (alias) is a current Community member".
function communityMemberSql(alias) {
  return `(${alias}.is_sales_demo = 0
    AND EXISTS (SELECT 1 FROM newsletter_contacts crm WHERE LOWER(crm.email) = LOWER(${alias}.email))
    AND EXISTS (SELECT 1 FROM license_seats lsm JOIN purchases pm ON pm.id = lsm.purchase_id
                WHERE lsm.registered_site_user_id = ${alias}.id AND lsm.status = 'registered'
                  AND pm.license_status NOT IN ('pending', 'expired', 'cancelled', 'suspended')
                  AND (pm.expiration_date IS NULL OR pm.expiration_date >= CURRENT_DATE)))`;
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

module.exports = { communityMemberSql, isCommunityMember, hasCrmContact };
