// Reading and shaping a contact record, shared by the older CRM routes (routes/newsletter.js) and the merged Contacts screen (routes/contact-screens.js).
// (docs/reference/contact-pages-merge-requirements.md, phase 3: one copy, so the two cannot drift apart.)
const pool = require('../db/pool');

async function attachGroups(contacts) {
  if (contacts.length === 0) return contacts;
  const [rows] = await pool.query(
    `SELECT m.contact_id, g.id, g.name FROM contact_group_members m
     JOIN contact_groups g ON g.id = m.group_id
     WHERE m.contact_id IN (?)`,
    [contacts.map(c => c.id)]
  );
  const groupsByContact = {};
  rows.forEach(r => {
    (groupsByContact[r.contact_id] = groupsByContact[r.contact_id] || []).push({ id: r.id, name: r.name });
  });
  return contacts.map(c => ({ ...c, groups: groupsByContact[c.id] || [] }));
}

// Site users (public-site accounts) aren't a separate CRM entity — they're
// linked to a contact purely by matching email, so this surfaces account
// status as a value on the contact rather than a standalone admin dashboard.
async function attachSiteUserInfo(contacts) {
  if (contacts.length === 0) return contacts;
  const emails = contacts.map(c => c.email);
  const [rows] = await pool.query('SELECT id, email, email_verified, role FROM site_users WHERE email IN (?)', [emails]);
  const byEmail = {};
  rows.forEach(r => { byEmail[r.email.toLowerCase()] = r; });
  // The grade levels each of these accounts teaches (site_user_audiences), for the CRM's Grade levels column.
  const levelsByUser = {};
  if (rows.length) {
    const [aud] = await pool.query('SELECT site_user_id, audience FROM site_user_audiences WHERE site_user_id IN (?)', [rows.map(r => r.id)]);
    aud.forEach(a => { (levelsByUser[a.site_user_id] = levelsByUser[a.site_user_id] || []).push(a.audience); });
  }
  return contacts.map(c => {
    const su = byEmail[c.email.toLowerCase()];
    return { ...c, siteUser: su ? { ...su, audiences: levelsByUser[su.id] || [] } : null };
  });
}

async function setContactGroups(connection, contactId, groupIds) {
  await connection.query('DELETE FROM contact_group_members WHERE contact_id = ?', [contactId]);
  if (Array.isArray(groupIds) && groupIds.length) {
    await connection.query(
      'INSERT INTO contact_group_members (contact_id, group_id) VALUES ' + groupIds.map(() => '(?, ?)').join(', '),
      groupIds.flatMap(gid => [contactId, gid])
    );
  }
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    company: row.company || '',
    address: { street: row.street || '', city: row.city || '', state: row.state || '', zip: row.zip || '' },
    shipTo: { name: row.ship_to_name || '', company: row.ship_to_company || '', street: row.ship_to_street || '', city: row.ship_to_city || '', state: row.ship_to_state || '', zip: row.ship_to_zip || '' },
    signupDate: row.signup_date,
    source: row.source,
    status: row.status,
    notes: row.notes || '',
    groups: row.groups || [],
    siteUserId: row.siteUser ? row.siteUser.id : null,
    hasAccount: !!row.siteUser,
    accountVerified: row.siteUser ? !!row.siteUser.email_verified : false,
    role: row.siteUser ? row.siteUser.role : null,
    gradeLevels: row.siteUser ? row.siteUser.audiences || [] : [], // full names; the CRM page shows ES/MS/HS/HE
    crmClassification: row.crm_classification || null, // Sales CRM label (Suspect / Prospect / Customer); null until scripts/alter-create-crm-core.js has run. Read-only here.
  };
}

module.exports = { attachGroups, attachSiteUserInfo, setContactGroups, serialize };
