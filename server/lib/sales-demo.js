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

// Free/consumer mail providers. "Same email domain" means "same organisation" for a
// company address, but for these it means "any member of the public" -- a salesperson
// using a yahoo.com address must not be able to invite every Yahoo user (real teachers
// included). Best-effort list; anything not on it is treated as a company domain.
const CONSUMER_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk', 'yahoo.ca',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'hotmail.co.uk', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'comcast.net',
  'att.net', 'sbcglobal.net', 'verizon.net', 'cox.net', 'bellsouth.net', 'charter.net',
]);

function emailLocal(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at === -1 ? '' : e.slice(0, at);
}

// "john+demo" and "john+teacher1" are both the mailbox "john".
function mailboxBase(local) {
  return String(local || '').split('+')[0];
}

// May `inviteeEmail` be invited into the DEMO school by `inviterEmail`? A demo school
// admin is allowed to invite teachers (that's a core thing to demo), but the invitee
// becomes a seat holder on the demo purchase and then shows up in the demo roster -- so
// a real teacher invited there would be visible to the salesperson, and would get a real
// email from FNE about a school that doesn't exist. Allowed:
//   - any example.com address (fake by definition);
//   - a colleague on the inviter's own COMPANY email domain;
//   - on a consumer provider (yahoo.com, gmail.com, ...) only the inviter's own mailbox,
//     including its plus-variants (johnfshaw+teacher1@yahoo.com) -- enough to demo the
//     invite flow with yourself without opening it to the whole provider.
function demoInviteAllowed(inviteeEmail, inviterEmail) {
  const invitee = emailDomain(inviteeEmail);
  if (!invitee) return false;
  if (invitee === 'example.com' || invitee.endsWith('.example.com')) return true;
  const inviter = emailDomain(inviterEmail);
  if (!inviter || invitee !== inviter) return false;
  if (!CONSUMER_EMAIL_DOMAINS.has(inviter)) return true;
  const mine = mailboxBase(emailLocal(inviterEmail));
  return !!mine && mailboxBase(emailLocal(inviteeEmail)) === mine;
}

module.exports = { DEMO_DISTRICT_NAME, DEMO_SCHOOL_DOMAIN, DEMO_SOURCE, isSalesDemoAccount, demoInviteAllowed, emailDomain };
