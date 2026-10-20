// Sales-demo accounts (see scripts/seed-sales-demo-account.js) hold every customer
// role at once so a salesperson can demo each portal. The promise that makes that
// acceptable is "demo data only": a demo account must never be able to see real
// teachers, students, schools or districts. That promise is enforced HERE, on the
// server, no matter how the account's assignments are later changed:
//
//   - the community (all of /api/social/*)        -> denied outright
//   - the school-admin portal                      -> demo school's purchase only
//   - the district-admin portal                    -> demo district only
//   - inviting teachers into the demo school       -> example.com or the inviter's own domain
//
// The flag is an explicit column (site_users.is_sales_demo), deliberately NOT derived
// from "holds a seat on the demo purchase": a derived flag turns off the moment the
// seat is revoked or the purchase edited, silently turning the account back into an
// ordinary teacher account with access to real people.

const DEMO_DISTRICT_NAME = 'FNE Sales Demo District';
const DEMO_SCHOOL_DOMAIN = 'sales-demo.example.com';
const DEMO_SOURCE = 'Sales Demo';

// True if this site_user is a sales-demo account. If the column doesn't exist yet
// (code deployed before scripts/alter-add-sales-demo-flag.js has run), no demo
// accounts can exist either -- the seed script refuses to run without the column --
// so "no" is the correct answer rather than an error that would lock everyone out.
async function isSalesDemoAccount(siteUserId) {
  if (!siteUserId) return false;
  // Loaded here, not at the top, so CLI scripts that only want the constants above
  // (scripts/seed-sales-demo-account.js) don't spin up a second database pool.
  const pool = require('../db/pool');
  try {
    const [[row]] = await pool.query('SELECT is_sales_demo FROM site_users WHERE id = ?', [siteUserId]);
    return !!(row && row.is_sales_demo);
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return false;
    throw err;
  }
}

function emailDomain(email) {
  const at = String(email || '').trim().toLowerCase().lastIndexOf('@');
  return at === -1 ? '' : String(email).trim().toLowerCase().slice(at + 1);
}

// May `inviteeEmail` be invited into the DEMO school by `inviterEmail`? A demo
// school admin is allowed to invite teachers (that's a core thing to demo), but the
// invitee becomes a seat holder on the demo purchase and then shows up in the demo
// roster -- so a real teacher invited there would be visible to the salesperson, and
// would get a real email from FNE about a school that doesn't exist. Colleagues (same
// email domain as the inviter) and example.com addresses are fine.
function demoInviteAllowed(inviteeEmail, inviterEmail) {
  const invitee = emailDomain(inviteeEmail);
  if (!invitee) return false;
  if (invitee === 'example.com' || invitee.endsWith('.example.com')) return true;
  const inviter = emailDomain(inviterEmail);
  return !!inviter && invitee === inviter;
}

module.exports = { DEMO_DISTRICT_NAME, DEMO_SCHOOL_DOMAIN, DEMO_SOURCE, isSalesDemoAccount, demoInviteAllowed, emailDomain };
