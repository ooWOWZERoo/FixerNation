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

// The shared demo environment (lib/public-demo.js) has its own fixtures, so a salesperson changing their demo never disturbs a prospect. Its
// logins are flagged is_sales_demo too, so every "demo accounts are kept apart from real people" rule applies to them; what differs is WHICH fake
// district and school they are confined to, which is why the confinement checks ask isDemoDistrictName / isDemoSchoolDomain, not a single name.
const PUBLIC_DEMO_DISTRICT_NAME = 'FNE Demo District';
const PUBLIC_DEMO_SCHOOL_DOMAIN = 'public-demo.example.com';

const DEMO_DISTRICT_NAMES = [DEMO_DISTRICT_NAME, PUBLIC_DEMO_DISTRICT_NAME];
const DEMO_SCHOOL_DOMAINS = [DEMO_SCHOOL_DOMAIN, PUBLIC_DEMO_SCHOOL_DOMAIN];

// ---- Prospect demo WORKSPACES (docs/reference/shared-demo-workspaces-requirements.md) ----------------------------------------------------------
// Each group of prospects gets its own private copy of the demo: workspace 07 is the district "FNE Demo District 07" and the school
// "w07.public-demo.example.com". The number is part of both names, so which workspace a district or school belongs to is known from its name alone,
// with no database lookup. (Only an FNE admin can create a district or school, and example.com can never be a real school's domain.)
const MAX_DEMO_WORKSPACES = 40;
const WORKSPACE_DISTRICT_PREFIX = `${PUBLIC_DEMO_DISTRICT_NAME} `;
const WORKSPACE_DISTRICT_NAME_LIKE = `${WORKSPACE_DISTRICT_PREFIX}%`; // for SQL: every workspace district
const WORKSPACE_DISTRICT_RE = /^FNE Demo District (\d{2})$/;
const WORKSPACE_SCHOOL_RE = /^w(\d{2})\.public-demo\.example\.com$/;

const workspaceTag = (n) => String(n).padStart(2, '0');
// Every two-digit number is a reserved workspace name, so a stray district called "FNE Demo District 99" is still treated as a demo; MAX_DEMO_WORKSPACES only limits how many the seed makes.
const validWorkspaceNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 99;
function workspaceDistrictName(n) { return `${WORKSPACE_DISTRICT_PREFIX}${workspaceTag(n)}`; }
function workspaceSchoolDomain(n) { return `w${workspaceTag(n)}.${PUBLIC_DEMO_SCHOOL_DOMAIN}`; }
// The workspace number a district name or school domain belongs to, or null (not a workspace, or a number outside 1..MAX).
function workspaceOfDistrictName(name) { const m = WORKSPACE_DISTRICT_RE.exec(String(name || '')); const n = m ? Number(m[1]) : NaN; return validWorkspaceNumber(n) ? n : null; }
function workspaceOfSchoolDomain(domain) { const m = WORKSPACE_SCHOOL_RE.exec(String(domain || '')); const n = m ? Number(m[1]) : NaN; return validWorkspaceNumber(n) ? n : null; }

function isDemoDistrictName(name) { return DEMO_DISTRICT_NAMES.includes(name) || workspaceOfDistrictName(name) !== null; }
function isDemoSchoolDomain(domain) { return DEMO_SCHOOL_DOMAINS.includes(domain) || workspaceOfSchoolDomain(domain) !== null; }

// Which demo a district or school belongs to: 'sales' (a salesperson's demo), 'public' (the original single shared demo), 'public:07' (workspace 07)
// or null (not a demo). A demo district may only hold a school of its own kind, and a demo login may only reach assignments of its own kind.
function demoKindOfDistrict(name) {
  if (name === DEMO_DISTRICT_NAME) return 'sales';
  if (name === PUBLIC_DEMO_DISTRICT_NAME) return 'public';
  const n = workspaceOfDistrictName(name);
  return n === null ? null : `public:${workspaceTag(n)}`;
}
function demoKindOfSchool(domain) {
  if (domain === DEMO_SCHOOL_DOMAIN) return 'sales';
  if (domain === PUBLIC_DEMO_SCHOOL_DOMAIN) return 'public';
  const n = workspaceOfSchoolDomain(domain);
  return n === null ? null : `public:${workspaceTag(n)}`;
}

// The kind of demo an ACCOUNT belongs to, from its three explicit columns (never derived from its assignments): a workspace login ->
// 'public:07'; a login of the original shared demo -> 'public'; any other sales-demo login -> 'sales'; an ordinary account -> null.
function demoKindOfAccount(row) {
  if (!row) return null;
  const ws = row.demo_workspace_id === null || row.demo_workspace_id === undefined ? null : Number(row.demo_workspace_id);
  if (ws !== null && Number.isFinite(ws) && ws !== 0) return validWorkspaceNumber(ws) ? `public:${workspaceTag(ws)}` : 'public:invalid'; // an unknown workspace matches no school
  if (row.is_shared_demo) return 'public';
  if (row.is_sales_demo) return 'sales';
  return null;
}

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

// The kind of demo this account belongs to (see demoKindOfAccount), or null. Tolerates a database that has not had the newer columns added yet
// (code deployed before its alter script ran): no such column means no such accounts either, so the older answer is the right one.
async function demoKindOfAccountId(siteUserId) {
  if (!siteUserId) return null;
  const pool = require('../db/pool');
  const attempts = ['is_sales_demo, is_shared_demo, demo_workspace_id', 'is_sales_demo, is_shared_demo', 'is_sales_demo'];
  for (const cols of attempts) {
    try {
      const [[row]] = await pool.query(`SELECT ${cols} FROM site_users WHERE id = ?`, [siteUserId]);
      return demoKindOfAccount(row);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR' || /no such column/i.test(String(err.message))) continue;
      throw err;
    }
  }
  return null;
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

module.exports = {
  DEMO_DISTRICT_NAME, DEMO_SCHOOL_DOMAIN, DEMO_SOURCE, PUBLIC_DEMO_DISTRICT_NAME, PUBLIC_DEMO_SCHOOL_DOMAIN,
  DEMO_DISTRICT_NAMES, DEMO_SCHOOL_DOMAINS, isDemoDistrictName, isDemoSchoolDomain, demoKindOfDistrict, demoKindOfSchool,
  MAX_DEMO_WORKSPACES, WORKSPACE_DISTRICT_NAME_LIKE, workspaceTag, validWorkspaceNumber, workspaceDistrictName, workspaceSchoolDomain,
  workspaceOfDistrictName, workspaceOfSchoolDomain, demoKindOfAccount, demoKindOfAccountId,
  isSalesDemoAccount, demoInviteAllowed, emailDomain,
};
