// Nightly backup. Run via cPanel Cron Jobs once a day (see scripts/setup-cron-jobs.sh):
//   30 2 * * *  <node> /home/fixernat/repositories/fixernation/server/scripts/backup-nightly.js
//
// What it does, in order:
//   1. Dumps the MariaDB database to  <BACKUP_DIR>/db/db-YYYY-MM-DD.sql.gz  and checks the file is complete.
//   2. Mirrors the uploads folder (everything EXCEPT .mp4 lesson videos) to <BACKUP_DIR>/uploads/current/.
//      A file that was changed or deleted since the last run is moved to <BACKUP_DIR>/uploads/changed/YYYY-MM-DD/
//      first, so an accidental delete or overwrite can be undone.
//   3. Keeps 7 days of database dumps and 14 days of changed files, then deletes older ones.
//   4. Writes <BACKUP_DIR>/last-success.json (or last-failure.json and an alert email if anything failed).
//
// The .mp4 videos are not backed up here: they never change once uploaded and are too big for this plan's disk.
// This copy is on the same server, so it does not protect against losing the server itself.
//
// Optional settings in server/.env:
//   BACKUP_DIR=/home/fixernat/backups     (default: <home folder>/backups, must be outside public_html)
//   BACKUP_ALERT_EMAIL=you@example.com    (default: the SMTP_USER mailbox)
//   MYSQLDUMP_PATH=/usr/bin/mysqldump     (default: looks in the usual places, then PATH)
// Flags: --dry-run  prints what it would do and changes nothing.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const { pipeline } = require('stream/promises');
const { dateStamp, pruneDated, verifyGzipDump } = require('../lib/backup-tools');

process.umask(0o077); // everything written here is readable only by this account

const DB_KEEP_DAYS = 7;
const CHANGED_KEEP_DAYS = 14;
const DRY_RUN = process.argv.includes('--dry-run');

const SERVER_DIR = path.join(__dirname, '..');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(os.homedir(), 'backups'));
const UPLOADS_DIR = path.resolve(SERVER_DIR, process.env.UPLOADS_DIR || path.join(SERVER_DIR, 'uploads'));

function log(msg) { console.log(`[backup ${new Date().toISOString()}] ${msg}`); }

function findMysqldump() {
  const candidates = [process.env.MYSQLDUMP_PATH, '/usr/bin/mysqldump', '/usr/local/bin/mysqldump'].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || 'mysqldump';
}

function dirSizeKb(dir) {
  const r = spawnSync('du', ['-sk', dir], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.split(/\s+/)[0]) : null;
}

async function dumpDatabase(day) {
  for (const k of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!process.env[k]) throw new Error(`${k} is not set in server/.env`);
  }
  const dbDir = path.join(BACKUP_DIR, 'db');
  const finalFile = path.join(dbDir, `db-${day}.sql.gz`);
  const partial = `${finalFile}.partial`;
  if (DRY_RUN) { log(`[dry run] would dump ${process.env.DB_NAME} to ${finalFile}`); return null; }
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });

  const args = [
    '--single-transaction', '--quick', '--routines', '--triggers', '--no-tablespaces',
    '--default-character-set=utf8mb4',
    '-h', process.env.DB_HOST || '127.0.0.1', '-P', String(process.env.DB_PORT || 3306),
    '-u', process.env.DB_USER, process.env.DB_NAME,
  ];
  // The password goes in the environment, never on the command line (where `ps` could show it).
  const child = spawn(findMysqldump(), args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const exited = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`could not start mysqldump: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump exited with ${code}: ${stderr.trim().slice(0, 500)}`))));
  });
  try {
    await Promise.all([pipeline(child.stdout, zlib.createGzip({ level: 9 }), fs.createWriteStream(partial, { mode: 0o600 })), exited]);
    const check = await verifyGzipDump(partial);
    if (!check.ok) throw new Error(`the dump failed its check: ${check.reason}`);
    fs.renameSync(partial, finalFile); // only a verified dump ever gets the real name
    return { file: finalFile, bytes: check.bytes, tables: check.tables };
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
}

function mirrorUploads(day) {
  if (!fs.existsSync(UPLOADS_DIR)) throw new Error(`uploads folder not found: ${UPLOADS_DIR}`);
  const current = path.join(BACKUP_DIR, 'uploads', 'current');
  const changed = path.join(BACKUP_DIR, 'uploads', 'changed', day);
  const args = ['-a', '--delete', '--exclude=*.mp4', '--backup', `--backup-dir=${changed}`, `${UPLOADS_DIR}/`, `${current}/`];
  if (DRY_RUN) { log(`[dry run] would run: rsync ${args.join(' ')}`); return null; }
  fs.mkdirSync(current, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(changed), { recursive: true, mode: 0o700 });
  const r = spawnSync('rsync', args, { encoding: 'utf8' });
  if (r.error) throw new Error(`could not start rsync: ${r.error.message}`);
  if (r.status !== 0 && r.status !== 24) { // 24 = a file vanished while copying, harmless
    throw new Error(`rsync exited with ${r.status}: ${(r.stderr || '').trim().slice(0, 500)}`);
  }
  return { currentKb: dirSizeKb(current) };
}

async function sendAlert(message) {
  try {
    const to = process.env.BACKUP_ALERT_EMAIL || process.env.SMTP_USER;
    if (!to) return;
    const { sendAutomationEmail } = require('../lib/mailer');
    await sendAutomationEmail({
      to,
      subject: 'FNE nightly backup FAILED',
      body: `The nightly backup on the Fixer Nation server did not finish.\n\n${message}\n\nLast good backup: see ${BACKUP_DIR}/last-success.json\nThe site itself is not affected.`,
    });
  } catch (e) {
    log(`could not send the alert email: ${e.message}`);
  }
}

async function main() {
  const day = dateStamp();
  if (BACKUP_DIR.includes(`${path.sep}public_html`)) throw new Error(`BACKUP_DIR must not be inside public_html: ${BACKUP_DIR}`);
  if (!DRY_RUN) fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  if (!DRY_RUN) fs.chmodSync(BACKUP_DIR, 0o700);

  const dump = await dumpDatabase(day);
  if (dump) log(`database dump ok: ${path.basename(dump.file)}, ${(dump.bytes / 1048576).toFixed(1)} MB, ${dump.tables} tables`);

  const uploads = mirrorUploads(day);
  if (uploads) log(`uploads mirror ok: ${(uploads.currentKb / 1024).toFixed(0)} MB (videos excluded)`);

  if (DRY_RUN) { log('[dry run] nothing changed.'); return; }

  const removedDumps = pruneDated(path.join(BACKUP_DIR, 'db'), DB_KEEP_DAYS);
  const removedChanged = pruneDated(path.join(BACKUP_DIR, 'uploads', 'changed'), CHANGED_KEEP_DAYS);
  if (removedDumps.length || removedChanged.length) log(`removed old: ${[...removedDumps, ...removedChanged].join(', ')}`);

  const status = {
    finishedAt: new Date().toISOString(),
    database: { file: path.basename(dump.file), megabytes: Number((dump.bytes / 1048576).toFixed(1)), tables: dump.tables },
    dumpsKept: fs.readdirSync(path.join(BACKUP_DIR, 'db')).filter((f) => f.endsWith('.sql.gz')).length,
    uploadsBackupMegabytes: Number((uploads.currentKb / 1024).toFixed(0)),
    uploadsFolderTotalMegabytes: Math.round((dirSizeKb(UPLOADS_DIR) || 0) / 1024), // includes the videos: watch this against the 15 GB plan
    backupFolderMegabytes: Math.round((dirSizeKb(BACKUP_DIR) || 0) / 1024),
  };
  fs.writeFileSync(path.join(BACKUP_DIR, 'last-success.json'), JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
  fs.rmSync(path.join(BACKUP_DIR, 'last-failure.json'), { force: true });
  log(`done. ${JSON.stringify(status)}`);
}

main().catch(async (err) => {
  log(`FAILED: ${err.message}`);
  if (!DRY_RUN) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(BACKUP_DIR, 'last-failure.json'), JSON.stringify({ at: new Date().toISOString(), error: err.message }, null, 2) + '\n', { mode: 0o600 });
    } catch { /* the log line above is enough */ }
    await sendAlert(err.message);
  }
  process.exit(1);
});
