require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { workspaceFixtures, MAX_DEMO_WORKSPACES } = require('../lib/public-demo-workspaces');
const { seed, makeReport } = require('./seed-public-demo');

// Creates (or tops up) the pool of prospect-demo WORKSPACES (docs/reference/shared-demo-workspaces-requirements.md, R4): workspace 01, 02, ... each a
// private copy of the demo with its own fake district ("FNE Demo District 07"), school (w07.public-demo.example.com), $0 licence purchase, demo
// classroom with three fake students, and five logins:
//
//   demo-district-07@public-demo.example.com   demo-school-07@...   demo-teacher-07@...   demo-parent-07@...   and the student  demo-student-07
//
//   node scripts/seed-demo-workspaces.js
//       DRY RUN (default): 10 workspaces. Runs every statement inside a transaction against the real schema, reports what it would create, then ROLLS
//       BACK. Nothing is written.
//   node scripts/seed-demo-workspaces.js --apply
//       Does it. --count N makes workspaces 1 to N (default 10, at most 40); running it again with a bigger N only adds the new ones.
//
// Safe to re-run: every step finds-or-creates, and an existing workspace is left exactly as it is (no password or PIN is changed, nobody is signed out).
// No password or PIN is made or shown: every login of a new workspace gets a random password nobody is told, so nobody can sign in to a workspace until
// an invitation gives it one (the next phase). This script never turns anything on, and the original single shared demo is not touched.
//
// Run scripts/alter-add-sales-demo-flag.js, alter-add-shared-demo-flag.js and alter-add-demo-workspaces.js first.

function parseArgs(argv) {
  const args = { apply: false, count: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--count') args.count = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > MAX_DEMO_WORKSPACES) throw new Error(`--count must be a whole number from 1 to ${MAX_DEMO_WORKSPACES}.`);
  return args;
}

// Makes workspaces 1..count. Returns the report lines, one report for the whole run.
async function seedWorkspaces(conn, count, { rounds = 12 } = {}, report = makeReport()) {
  const out = [];
  for (let n = 1; n <= count; n++) {
    report.note(`--- workspace ${String(n).padStart(2, '0')} ---`);
    out.push(await seed(conn, { password: null, pin: null, rounds, fx: workspaceFixtures(n) }, report));
  }
  return { out, report };
}

async function main() {
  const mysql = require('mysql2/promise');
  const args = parseArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  for (const [table, col, alter] of [['site_users', 'is_sales_demo', 'alter-add-sales-demo-flag.js'], ['site_users', 'is_shared_demo', 'alter-add-shared-demo-flag.js'], ['site_users', 'demo_workspace_id', 'alter-add-demo-workspaces.js']]) {
    const [has] = await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [process.env.DB_NAME, table, col]);
    if (!has.length) {
      await conn.end();
      throw new Error(`${table}.${col} does not exist yet. Run scripts/${alter} first -- without it the workspace logins would NOT be confined.`);
    }
  }
  const [hasTable] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [process.env.DB_NAME, 'public_demo_workspaces']);
  if (!hasTable.length) { await conn.end(); throw new Error('public_demo_workspaces does not exist yet. Run scripts/alter-add-demo-workspaces.js first.'); }

  console.log(`\n${args.apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} -- demo workspaces 1 to ${args.count}\n`);
  let report;
  await conn.beginTransaction();
  try {
    ({ report } = await seedWorkspaces(conn, args.count));
    if (args.apply) await conn.commit(); else await conn.rollback();
  } catch (err) {
    await conn.rollback();
    await conn.end();
    console.error('\nFAILED -- the transaction was rolled back, nothing was changed.');
    throw err;
  }
  await conn.end();

  const created = report.lines.filter(l => l[0].trim() === 'create').length;
  report.print(args.apply ? '' : 'would ');
  console.log(`\n${created} item(s) ${args.apply ? 'created' : 'would be created'} across ${args.count} workspace(s).`);
  if (!args.apply) { console.log('\nDry run complete: every statement ran against the real schema and was rolled back.\nRe-run with --apply to make it real.\n'); return; }
  console.log('\nNo workspace can be signed in to yet: each login has a random password nobody knows, until an invitation (a later phase) gives it one.\n');
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { seedWorkspaces, parseArgs };
