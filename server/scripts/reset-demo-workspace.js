require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { workspaceFixtures, MAX_DEMO_WORKSPACES } = require('../lib/public-demo-workspaces');
const { resetDemo } = require('./reset-public-demo');
const { makeReport } = require('./seed-public-demo');

// Puts ONE prospect-demo workspace (or every workspace) back to the state the seed made (docs/reference/shared-demo-workspaces-requirements.md, R6):
// the demo teacher's classrooms are deleted (with their students and everything they did) and the seeded classroom is rebuilt with the same join code
// and the same student PIN; extra invitations, licence seats and administrators (and the fake accounts they created), branding, district frameworks
// and the four logins' favorites and reset tokens are cleared. It touches only that workspace's own district, school, purchase and logins.
//
//   node scripts/reset-demo-workspace.js --workspace 7
//   node scripts/reset-demo-workspace.js --all
//       DRY RUN (default): does everything inside a transaction, reports what it would clear, then ROLLS BACK.
//   ... --apply
//       Does it. Unlike the original demo's nightly reset, this does not look at the on/off switch: a workspace is reset when an invitation takes it
//       and when it releases it (the next phase), and by hand.

function parseArgs(argv) {
  const args = { apply: false, workspace: null, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--all') args.all = true;
    else if (a === '--workspace') args.workspace = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (args.all === (args.workspace !== null)) throw new Error('Give exactly one of --workspace N or --all.');
  if (args.workspace !== null && !(Number.isInteger(args.workspace) && args.workspace >= 1 && args.workspace <= MAX_DEMO_WORKSPACES)) throw new Error(`--workspace must be a whole number from 1 to ${MAX_DEMO_WORKSPACES}.`);
  return args;
}

async function resetWorkspaces(conn, numbers, { rounds = 10 } = {}, report = makeReport()) {
  for (const n of numbers) {
    report.note(`--- workspace ${String(n).padStart(2, '0')} ---`);
    await resetDemo(conn, { rounds, fx: workspaceFixtures(n) }, report);
  }
  return report;
}

async function main() {
  const mysql = require('mysql2/promise');
  const args = parseArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    let numbers = [args.workspace];
    if (args.all) {
      const [rows] = await conn.query('SELECT id FROM public_demo_workspaces ORDER BY id');
      numbers = rows.map(r => Number(r.id));
      if (!numbers.length) { console.log('There are no demo workspaces yet. Run scripts/seed-demo-workspaces.js --apply first.'); return; }
    }
    console.log(`\n${args.apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} -- reset demo workspace(s) ${numbers.join(', ')}\n`);
    await conn.beginTransaction();
    let report;
    try {
      report = await resetWorkspaces(conn, numbers);
      if (args.apply) await conn.commit(); else await conn.rollback();
    } catch (err) {
      await conn.rollback();
      console.error('\nFAILED -- the transaction was rolled back, nothing was changed.');
      throw err;
    }
    report.print(args.apply ? '' : 'would ');
    console.log(args.apply ? '\nDone.\n' : '\nDry run complete. Re-run with --apply to make it real.\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { resetWorkspaces, parseArgs };
