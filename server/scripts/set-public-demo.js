require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const F = require('../lib/public-demo-fixtures');
const { evaluateDemoWindow, formatEastern } = require('../lib/public-demo-window');
const { makeReport } = require('./seed-public-demo');
const { getSettingRaw, putSettingRaw, ensureAccessCode, startNewWindow } = require('../lib/public-demo-admin');
const { resetDemo } = require('./reset-public-demo');

// The shared demo's on/off switch from the command line (docs/reference/shared-demo-environment-requirements.md, R1). It is the switch until the
// admin Demo page exists, and the emergency OFF afterwards: it works even if the website is down.
//
//   node scripts/set-public-demo.js --status
//   node scripts/set-public-demo.js --on --days 14
//   node scripts/set-public-demo.js --on --until 2026-11-21T17:00:00-05:00
//   node scripts/set-public-demo.js --off
//
// --on needs an end time (never open-ended): either --days N, or --until with a date, time and time zone. The longest window is the setting
// public_demo_max_days (30 unless changed). Turning the demo on also resets the demo data (so each window starts clean); add --no-reset to skip that.
// Turning it off takes effect at once: the logins are refused and every open demo session ends on its next request.

// Mistakes the person asking can fix (a bad date, too long a window) carry status 400 so the admin page can show them as they are.
const bad = (message) => Object.assign(new Error(message), { status: 400 });

const DEFAULT_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

async function maxDays(conn) {
  const n = Number(await getSettingRaw(conn, 'public_demo_max_days'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DAYS;
}

async function describe(conn, now = new Date()) {
  const enabled = await getSettingRaw(conn, 'public_demo_enabled');
  const endsAt = await getSettingRaw(conn, 'public_demo_ends_at');
  const w = evaluateDemoWindow({ enabled, endsAt }, now);
  if (w.open) return { ...w, text: `The shared demo is ON until ${formatEastern(w.endsAt)} (${w.endsAt.toISOString()}).` };
  if (w.reason === 'expired') return { ...w, text: `The shared demo is OFF: its end time (${formatEastern(w.endsAt)}) has passed, although the switch was left on.` };
  if (w.reason === 'no_end_date') return { ...w, text: 'The shared demo is OFF: the switch is on but there is no valid end time.' };
  return { ...w, text: 'The shared demo is OFF.' };
}

async function turnOn(conn, { days, until, now = new Date(), reset = true, rounds = 10 }, report = makeReport()) {
  const limit = await maxDays(conn);
  let end;
  if (days !== undefined) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) throw bad('The number of days must be above 0.');
    end = new Date(now.getTime() + n * DAY_MS);
  } else if (until !== undefined) {
    if (!/(Z|[+-]\d\d:?\d\d)$/i.test(String(until))) throw bad('The end time needs a time zone, for example 2026-11-21T17:00:00-05:00 or ending in Z.');
    end = new Date(until);
    if (Number.isNaN(end.getTime())) throw bad('The end time is not a valid date and time.');
  } else {
    throw bad('Turning the demo on needs an end time (a number of days, or a date and time).');
  }
  if (end.getTime() <= now.getTime()) throw bad('The end time is already in the past.');
  if (end.getTime() - now.getTime() > limit * DAY_MS + 1000) throw bad(`The longest demo window is ${limit} days (setting public_demo_max_days).`);

  const seeded = await conn.query('SELECT id FROM site_users WHERE email = ? AND is_shared_demo = 1', [F.ACCOUNTS.teacher.email]);
  if (!seeded[0][0]) throw Object.assign(new Error('The shared demo has not been set up yet. Use "Set up the demo" on the Demo page (or run scripts/seed-public-demo.js --apply) first.'), { status: 409 });

  // A fresh start is a new window: the counts on the admin Demo page start again from zero. Moving the end date of an open demo is not.
  if (reset) { await resetDemo(conn, { rounds }, report); await startNewWindow(conn); }
  await ensureAccessCode(conn); // a code always exists while the demo is on (the admin Demo page shows it)
  await putSettingRaw(conn, 'public_demo_ends_at', end.toISOString());
  await putSettingRaw(conn, 'public_demo_enabled', 'true');
  report.note(`switched ON until ${end.toISOString()}`);
  return { endsAt: end, report };
}

async function turnOff(conn) {
  await putSettingRaw(conn, 'public_demo_enabled', 'false');
  await putSettingRaw(conn, 'public_demo_ends_at', '');
}

function parseArgs(argv) {
  const args = { reset: true };
  let action = null;
  const setAction = (a) => { if (action && action !== a) throw new Error('Choose one of --status, --on or --off.'); action = a; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--status') setAction('status');
    else if (a === '--on') setAction('on');
    else if (a === '--off') setAction('off');
    else if (a === '--days') args.days = argv[++i];
    else if (a === '--until') args.until = argv[++i];
    else if (a === '--no-reset') args.reset = false;
    else throw new Error(`Unknown argument: ${a}`);
  }
  args.action = action || 'status';
  return args;
}

async function main() {
  const mysql = require('mysql2/promise');
  const args = parseArgs(process.argv.slice(2));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    if (args.action === 'status') { console.log('\n' + (await describe(conn)).text + '\n'); return; }
    if (args.action === 'off') {
      await turnOff(conn);
      console.log('\n' + (await describe(conn)).text + ' Open demo sessions end on their next request.\n');
      return;
    }
    await conn.beginTransaction();
    let report;
    try {
      ({ report } = await turnOn(conn, { days: args.days, until: args.until, reset: args.reset }));
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    report.print('');
    console.log('\n' + (await describe(conn)).text);
    console.log('Turn it off at any time with: node scripts/set-public-demo.js --off\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { turnOn, turnOff, describe, maxDays };
