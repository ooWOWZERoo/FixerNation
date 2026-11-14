require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const invitationsLib = require('../lib/public-demo-invitations');

// The master pause for every prospect demo, from the command line. It works even if the website is down.
//
//   node scripts/set-public-demo.js --status     paused or running, and how many invitations are open
//   node scripts/set-public-demo.js --pause      pause EVERY demo, including every group's invitation (the emergency stop)
//   node scripts/set-public-demo.js --resume     allow invitations to work again
//
// Groups' own invitations (private workspaces, each with its own code, password, PIN and end time) are managed with scripts/demo-invitations.js. A pause
// closes their logins and pages at once; invitations keep their end times and open again on --resume.
//
// The original single shared demo (its own on/off switch, one code, one password) was retired in phase 5, so --on and --off are gone.

function parseArgs(argv) {
  let action = null;
  const setAction = (a) => { if (action && action !== a) throw new Error('Choose one of --status, --pause or --resume.'); action = a; };
  for (const a of argv) {
    if (a === '--status') setAction('status');
    else if (a === '--pause') setAction('pause');
    else if (a === '--resume') setAction('resume');
    else if (a === '--on' || a === '--off') throw new Error('The single shared demo is retired, so --on and --off are gone. Use scripts/demo-invitations.js for a group, and --pause or --resume for every demo at once.');
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { action: action || 'status' };
}

async function main() {
  const mysql = require('mysql2/promise');
  const args = parseArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    if (args.action === 'status') {
      const paused = await invitationsLib.isPaused(conn);
      let open = 0;
      try { open = (await invitationsLib.listInvitations(conn, { includeEnded: false })).filter(i => i.open).length; } catch { /* the invitations table is not there yet */ }
      console.log(`\nGroup demos: ${paused ? 'PAUSED' : 'running'}, ${open} invitation(s) open. (node scripts/demo-invitations.js list)\n`);
      return;
    }
    await invitationsLib.setPaused(conn, args.action === 'pause');
    console.log(args.action === 'pause' ? '\nEvery group invitation is paused: their logins and pages are closed. Resume with --resume.\n' : '\nGroup invitations are running again.\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { parseArgs };
