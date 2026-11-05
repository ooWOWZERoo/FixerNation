// The "Morning Boost Recipients" group: licensed educators who should get the daily Morning Boost email.
// Rules and reasons: docs/reference/morning-boost-recipient-group-requirements.md.
//
// A person belongs while a license is open and they hold a role on it (registered teacher, school license administrator,
// district administrator) and were registered on or after the start date. The group is managed: this module adds who
// qualifies and removes who does not. Morning Boost itself still skips anyone unsubscribed (routes/morning-boost.js), so
// nothing here can email a person who opted out.
//
// Plain portable SQL (no NOW(), no ON DUPLICATE KEY, no array parameters) so it runs in the node:sqlite tests as well as MariaDB.
const { licenseOpenSql } = require('./license-access');
const { ensureContact } = require('./teacher-onboarding');

const GROUP_KEY = 'morning_boost_recipients';
const GROUP_NAME = 'Morning Boost Recipients';
const DEFAULT_START_DATE = '2026-10-15';
const START_DATE_SETTING = 'morning_boost_group_start_date';
const CONTACT_SOURCE = 'School License';

const isoDay = (d) => d.toISOString().slice(0, 10);

async function readStartDate(db) {
  const [[row]] = await db.query('SELECT setting_value FROM settings WHERE setting_key = ?', [START_DATE_SETTING]);
  const v = row && String(row.setting_value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : DEFAULT_START_DATE;
}

// A license counts as open for this group when it is open under the shared rule AND still running (an expired license
// can stay "paid", and the expiry job may not have reached it yet). Takes one date parameter: today.
function openLicenseSql(alias) {
  return `${licenseOpenSql(alias)}
    AND (${alias}.license_status IS NULL OR ${alias}.license_status IN ('active', 'expiring_soon'))
    AND (${alias}.expiration_date IS NULL OR ${alias}.expiration_date >= ?)`;
}

// Every site user who qualifies right now: Map(siteUserId -> { email, name, roles:Set }).
async function eligibleUsers(db, { since, today, onlyUserId = null }) {
  const people = new Map();
  const add = (rows, role) => rows.forEach((r) => {
    if (!people.has(r.id)) people.set(r.id, { id: r.id, email: String(r.email || '').trim().toLowerCase(), name: [r.first_name, r.last_name].filter(Boolean).join(' '), roles: new Set() });
    people.get(r.id).roles.add(role);
  });
  const only = onlyUserId ? ' AND su.id = ?' : '';
  const extra = onlyUserId ? [onlyUserId] : [];

  const [teachers] = await db.query(
    `SELECT DISTINCT su.id, su.email, su.first_name, su.last_name
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     JOIN site_users su ON su.id = ls.registered_site_user_id
     WHERE ls.status = 'registered' AND COALESCE(ls.registered_at, su.created_at) >= ?
       AND su.is_sales_demo = 0 AND ${openLicenseSql('p')}${only}`,
    [since, today, ...extra]
  );
  add(teachers, 'teacher');

  const [schoolAdmins] = await db.query(
    `SELECT DISTINCT su.id, su.email, su.first_name, su.last_name
     FROM school_license_admins sla
     JOIN purchases p ON p.id = sla.purchase_id
     JOIN site_users su ON su.id = sla.site_user_id
     WHERE sla.is_active = 1 AND su.email_verified = 1 AND sla.created_at >= ?
       AND su.is_sales_demo = 0 AND ${openLicenseSql('p')}${only}`,
    [since, today, ...extra]
  );
  add(schoolAdmins, 'school_admin');

  const [districtAdmins] = await db.query(
    `SELECT DISTINCT su.id, su.email, su.first_name, su.last_name
     FROM district_license_admins dla
     JOIN site_users su ON su.id = dla.site_user_id
     WHERE dla.is_active = 1 AND su.email_verified = 1 AND dla.created_at >= ? AND su.is_sales_demo = 0
       AND EXISTS (SELECT 1 FROM purchases p JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
                   WHERE s.district_id = dla.district_id AND ${openLicenseSql('p')})${only}`,
    [since, today, ...extra]
  );
  add(districtAdmins, 'district_admin');
  return people;
}

async function findGroup(db) {
  const [[row]] = await db.query('SELECT id FROM contact_groups WHERE system_key = ?', [GROUP_KEY]);
  return row ? row.id : null;
}

// Makes sure the group exists and is one of the Morning Boost recipient groups. Returns { groupId, activated } where
// activated is false only when Morning Boost has no configuration row yet (the admin page creates it the first time it opens).
async function ensureGroup(db) {
  let groupId = await findGroup(db);
  if (!groupId) {
    const [r] = await db.query('INSERT INTO contact_groups (name, system_key) VALUES (?, ?)', [GROUP_NAME, GROUP_KEY]);
    groupId = r.insertId;
  }
  const [[config]] = await db.query('SELECT id FROM morning_boost_email_config ORDER BY id LIMIT 1');
  if (!config) return { groupId, activated: false };
  const [[linked]] = await db.query('SELECT 1 AS yes FROM morning_boost_email_groups WHERE config_id = ? AND group_id = ?', [config.id, groupId]);
  if (!linked) await db.query('INSERT INTO morning_boost_email_groups (config_id, group_id) VALUES (?, ?)', [config.id, groupId]);
  return { groupId, activated: true };
}

// The sync. apply=false reports what would change and changes nothing. onlyUserId limits it to one person (used right after
// a registration or assignment); the nightly and on-demand runs cover everyone.
async function syncMorningBoostGroup(db, { apply = false, since = null, today = null, onlyUserId = null } = {}) {
  const startDate = since || await readStartDate(db);
  const day = today || isoDay(new Date());
  const eligible = await eligibleUsers(db, { since: startDate, today: day, onlyUserId });

  let groupId = await findGroup(db);
  let activated = null;
  if (apply) ({ groupId, activated } = await ensureGroup(db));

  // The CRM contact for each person who qualifies (created on apply when missing).
  const desired = new Map(); // contactId -> person
  let contactsToCreate = 0;
  const wouldCreate = []; // dry run only: people with no contact yet, who would be created and added
  for (const person of eligible.values()) {
    if (!person.email) continue;
    const [[found]] = await db.query('SELECT id FROM newsletter_contacts WHERE LOWER(email) = ?', [person.email]);
    let contactId = found ? found.id : null;
    if (!contactId) {
      contactsToCreate += 1;
      if (apply) contactId = await ensureContact(db, { email: person.email, name: person.name, source: CONTACT_SOURCE });
      else wouldCreate.push(person.email);
    }
    if (contactId) desired.set(Number(contactId), person);
  }

  // Who is in the group now. For a one-person run only that person's own contact is looked at.
  let members = [];
  if (groupId) {
    const [rows] = await db.query(
      'SELECT cgm.contact_id, nc.email FROM contact_group_members cgm JOIN newsletter_contacts nc ON nc.id = cgm.contact_id WHERE cgm.group_id = ?',
      [groupId]
    );
    members = rows.map((r) => ({ id: Number(r.contact_id), email: String(r.email || '').toLowerCase() }));
  }
  if (onlyUserId) {
    const [[user]] = await db.query('SELECT email FROM site_users WHERE id = ?', [onlyUserId]);
    const mine = user ? String(user.email || '').trim().toLowerCase() : null;
    members = members.filter((m) => m.email === mine);
  }
  const memberIds = new Set(members.map((m) => m.id));

  const toAdd = [...desired.keys()].filter((id) => !memberIds.has(id));
  const toRemove = members.filter((m) => !desired.has(m.id));

  if (apply) {
    for (const id of toAdd) await db.query('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)', [id, groupId]);
    for (const m of toRemove) await db.query('DELETE FROM contact_group_members WHERE contact_id = ? AND group_id = ?', [m.id, groupId]);
  }

  const byRole = { teacher: 0, school_admin: 0, district_admin: 0 };
  eligible.forEach((p) => p.roles.forEach((r) => { byRole[r] += 1; }));
  return {
    applied: !!apply, startDate, today: day, groupExists: !!groupId, activated,
    eligible: eligible.size, byRole,
    add: toAdd.length + wouldCreate.length, remove: toRemove.length, contactsToCreate,
    addEmails: [...toAdd.map((id) => desired.get(id).email), ...wouldCreate],
    removeEmails: toRemove.map((m) => m.email),
  };
}

// For the places that register or assign someone: never lets a problem here undo the registration.
async function syncMorningBoostForUser(db, siteUserId) {
  try {
    await syncMorningBoostGroup(db, { apply: true, onlyUserId: siteUserId });
  } catch (err) {
    console.error('Morning Boost group sync failed for user', siteUserId, '-', err.message);
  }
}

module.exports = { syncMorningBoostGroup, syncMorningBoostForUser, eligibleUsers, ensureGroup, GROUP_KEY, GROUP_NAME, DEFAULT_START_DATE, START_DATE_SETTING };
