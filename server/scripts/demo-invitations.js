require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const inv = require('../lib/public-demo-invitations');
const A = require('../lib/public-demo-admin');
const { formatEastern } = require('../lib/public-demo-window');
const { workspaceTag } = require('../lib/sales-demo');

// Prospect demo INVITATIONS from the command line (docs/reference/shared-demo-workspaces-requirements.md, section 3). One invitation is one group's visit: its own
// access code, password, student PIN, end time and private workspace. Until the admin Demo page can do this (a later phase) this is how staff start and end one,
// and it keeps working when the website is down.
//
//   node scripts/demo-invitations.js list [--all]              open invitations (with --all, ended ones too); never shows a password or PIN
//   node scripts/demo-invitations.js show ID                   one invitation WITH its code, password, PIN and the message to send
//   node scripts/demo-invitations.js create --label "Springfield USD" [--days 14 | --until 2026-11-21T17:00:00-05:00]
//                                                              takes a free workspace, wipes it, makes a code, password and PIN, and prints them once
//   node scripts/demo-invitations.js rename ID --label "Springfield Unified"
//                                                              corrects the group's name (staff only; the group never sees it)
//   node scripts/demo-invitations.js extend ID --days 7        (or --until ...) moves the end time; the group keeps its session
//   node scripts/demo-invitations.js end ID                    ends it now: logins stop, the workspace is wiped and goes back in the pool
//   node scripts/demo-invitations.js new-code ID               a new access code for this group only (the old one stops working)
//   node scripts/demo-invitations.js new-password ID           a new shared password (signs this group out)
//   node scripts/demo-invitations.js new-pin ID                a new student PIN
//   node scripts/demo-invitations.js sweep                     ends every invitation whose time has run out (cron runs this every few minutes)
//
// An invitation lasts 14 days unless you say otherwise, and never more than public_demo_max_days (30). To pause every demo at once, use
// node scripts/set-public-demo.js --pause (or --off), and --resume to allow demos again.

const COMMANDS = ['list', 'show', 'create', 'rename', 'extend', 'end', 'new-code', 'new-password', 'new-pin', 'sweep'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new Error(`Usage: node scripts/demo-invitations.js <${COMMANDS.join('|')}> ...  (see the top of the file)`);
  const args = { command, all: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--all') args.all = true;
    else if (a === '--label') args.label = rest[++i];
    else if (a === '--days') args.days = rest[++i];
    else if (a === '--until') args.until = rest[++i];
    else if (/^\d+$/.test(a) && args.id === undefined) args.id = Number(a);
    else throw new Error(`Unknown argument: ${a}`);
  }
  const needsId = ['show', 'rename', 'extend', 'end', 'new-code', 'new-password', 'new-pin'];
  if (needsId.includes(command) && !(Number.isInteger(args.id) && args.id > 0)) throw new Error(`"${command}" needs the invitation's number (see: node scripts/demo-invitations.js list).`);
  if ((command === 'create' || command === 'rename') && args.label === undefined) throw new Error(`"${command}" needs --label "the group's name".`);
  if (command === 'extend' && args.days === undefined && args.until === undefined) throw new Error('"extend" needs --days N or --until <date and time with a time zone>.');
  return args;
}

const pad = (v, n) => String(v).padEnd(n);

// One line per invitation, never a secret.
function renderList(rows) {
  if (!rows.length) return 'No invitations.\n';
  const lines = [`${pad('#', 4)}${pad('Workspace', 11)}${pad('State', 14)}${pad('Ends (US Eastern)', 40)}Group`];
  for (const r of rows) {
    const stateText = { active: 'open', ending_soon: 'ending soon', expired: 'ran out', ended: 'ended' }[r.state] || r.state;
    lines.push(`${pad(r.id, 4)}${pad(workspaceTag(r.workspaceId), 11)}${pad(stateText, 14)}${pad(r.endsAtEastern, 40)}${r.label}`);
  }
  return lines.join('\n') + '\n';
}

// Everything staff need to send an invitation, with the secrets (shown to the person who asked, in their own terminal).
function renderDetails(r, siteUrl) {
  const out = [
    `Invitation ${r.id}: "${r.label}"`,
    `  Workspace .......... ${workspaceTag(r.workspaceId)}`,
    `  Open until ......... ${r.endsAtEastern} (${r.endsAt.toISOString()})`,
    `  Access code ........ ${r.accessCodeFormatted}`,
    `  Password ........... ${r.password}`,
    `  Student PIN ........ ${r.pin}`,
    '  Sign-ins (the group sees these after entering the code):',
    ...inv.loginsFor(r.workspaceId).map(l => `    ${pad(l.role, 9)} ${pad(l.userId, 44)} ${l.page}`),
    '',
    'Message to send:',
    '',
    A.buildInviteMessage({ siteUrl, code: r.accessCode, endsAt: r.endsAt, privateCopy: true }).replace(/^/gm, '  '),
    '',
  ];
  return out.join('\n');
}

async function run(conn, args, { siteUrl = process.env.SITE_URL || 'https://fixernationeducation.com', now = new Date(), createdBy = 'command line' } = {}) {
  switch (args.command) {
    case 'list': return renderList(await inv.listInvitations(conn, { includeEnded: args.all, now }));
    case 'show': {
      const r = await inv.getInvitation(conn, args.id, { secrets: true, now });
      if (!r) throw Object.assign(new Error('That invitation was not found.'), { status: 404 });
      return r.status === 'ended' ? `Invitation ${r.id} ("${r.label}") ended ${r.endedAt ? r.endedAt.toISOString() : ''} (${r.endReason}). Its workspace is back in the pool.\n` : renderDetails(r, siteUrl);
    }
    case 'create': return renderDetails(await inv.createInvitation(conn, { label: args.label, days: args.days, until: args.until, createdBy, now }), siteUrl) + 'These are shown once here; "show" prints them again while the invitation is open.\n';
    case 'rename': { const r = await inv.renameInvitation(conn, args.id, args.label, { now }); return `Invitation ${r.invitation.id} (workspace ${workspaceTag(r.invitation.workspaceId)}) is now called "${r.invitation.label}" (it was "${r.previous}").\n`; }
    case 'extend': { const r = await inv.extendInvitation(conn, args.id, { days: args.days, until: args.until, now }); return `Invitation ${r.id} now runs until ${r.endsAtEastern}.\n`; }
    case 'end': { const r = await inv.endInvitation(conn, args.id, { now }); return `Invitation ${r.id} ("${r.label}") is ended. Its logins stopped working at once, and workspace ${workspaceTag(r.workspaceId)} was wiped and is free again.\n`; }
    case 'new-code': { const r = await inv.regenerateCode(conn, args.id, { now }); return `New access code for invitation ${r.id}: ${r.accessCodeFormatted}\nThe old code and every visit made with it stopped working. Other groups are unaffected.\n`; }
    case 'new-password': { const r = await inv.regenerateSecret(conn, args.id, 'password', { now }); return `New password for invitation ${r.id}: ${r.password}\nThis group was signed out; other groups are unaffected.\n`; }
    case 'new-pin': { const r = await inv.regenerateSecret(conn, args.id, 'pin', { now }); return `New student PIN for invitation ${r.id}: ${r.pin}\n`; }
    case 'sweep': {
      const r = await inv.sweep(conn, { now });
      return r.ended.length || r.repaired.length ? `Ended ${r.ended.length} invitation(s) whose time ran out (${r.ended.join(', ') || 'none'}); put right ${r.repaired.length} workspace(s).\n` : 'Nothing to sweep.\n';
    }
    default: throw new Error('Unknown command.');
  }
}

async function main() {
  const mysql = require('mysql2/promise');
  const args = parseArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true, // the same as the site's own pool, so a time is read exactly as the site reads it
  });
  try {
    const [has] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'public_demo_invitations']);
    if (!has.length) throw new Error('public_demo_invitations does not exist yet. Run scripts/alter-add-demo-invitations.js first.');
    process.stdout.write('\n' + await run(conn, args));
    console.log('');
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { parseArgs, run, renderList, renderDetails };
