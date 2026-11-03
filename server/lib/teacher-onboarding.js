// What happens to a teacher the moment they accept a school invitation (or sign up and have a pending invited seat claimed):
//   1. the grade levels the school admin chose on the invite are added to the teacher's own levels (site_user_audiences),
//      never replacing levels they already had;
//   2. the teacher is in the CRM (newsletter_contacts) and in the Teachers system group, so the CRM list can show them
//      with their levels.
// One helper for all four acceptance paths (school-invite.js /register, /claim, /accept-and-verify, and site-auth.js
// claimPendingSeatsAndSubscribe) so they cannot drift apart. Plain portable SQL (selects, then inserts) so it runs in the
// node:sqlite tests as well as MariaDB.
const defaultPool = require('../db/pool');
const { fromStored } = require('./grade-levels');

// Adds each of `names` the teacher does not have yet. Returns the names that were added.
async function mergeAudiences(db, siteUserId, names) {
  const wanted = [...new Set(names || [])];
  if (!wanted.length) return [];
  const [rows] = await db.query('SELECT audience FROM site_user_audiences WHERE site_user_id = ?', [siteUserId]);
  const have = new Set(rows.map((r) => r.audience));
  const added = [];
  for (const name of wanted) {
    if (have.has(name)) continue;
    await db.query('INSERT INTO site_user_audiences (site_user_id, audience) VALUES (?, ?)', [siteUserId, name]);
    added.push(name);
  }
  return added;
}

// Returns the CRM contact id for this email, creating a Subscribed contact only if there is none. An existing contact is
// left exactly as it is (its status, source and notes belong to whoever put it there).
async function ensureContact(db, { email, name, source }) {
  const [[found]] = await db.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
  if (found) return found.id;
  try {
    const [r] = await db.query(
      "INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, ?, 'Subscribed')",
      [name || '', email, source || 'School Invite']
    );
    return r.insertId;
  } catch (e) {
    // Another request created the same contact a moment ago (email is unique): use theirs.
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    const [[again]] = await db.query('SELECT id FROM newsletter_contacts WHERE email = ?', [email]);
    return again ? again.id : null;
  }
}

async function addToTeachersGroup(db, contactId) {
  if (!contactId) return false;
  const [[group]] = await db.query("SELECT id FROM contact_groups WHERE system_key = 'teachers'");
  if (!group) return false; // the seed script has not run on this database; never block a sign-up over it
  const [[member]] = await db.query('SELECT 1 AS yes FROM contact_group_members WHERE contact_id = ? AND group_id = ?', [contactId, group.id]);
  if (member) return false;
  await db.query('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)', [contactId, group.id]);
  return true;
}

// `audiences` is what the invitation stored (school_invitations.audiences, the comma-joined text) or an array of names.
// Never throws past its caller's try/catch decision: callers log and carry on, because a CRM or level problem must not
// undo a teacher's accepted invitation.
async function onboardInvitedTeacher({ db = defaultPool, siteUserId, email, name, audiences, source = 'School Invite' }) {
  const names = Array.isArray(audiences) ? audiences : fromStored(audiences);
  const addedLevels = await mergeAudiences(db, siteUserId, names);
  const contactId = await ensureContact(db, { email: String(email).toLowerCase(), name, source });
  const grouped = await addToTeachersGroup(db, contactId);
  return { addedLevels, contactId, grouped };
}

module.exports = { onboardInvitedTeacher, mergeAudiences, ensureContact, addToTeachersGroup };
