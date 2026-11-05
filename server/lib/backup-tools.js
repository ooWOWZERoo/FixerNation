// Small helpers for scripts/backup-nightly.js, kept here so they can be tested without a database.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATE_IN_NAME = /(\d{4})-(\d{2})-(\d{2})/;

// "2026-11-05" in UTC, so the name does not depend on the server's time zone.
function dateStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Deletes files and folders in `dir` whose name holds a date (YYYY-MM-DD) more than `keepDays` days
// before `now`. Names without a date are never touched. Returns the names it removed.
function pruneDated(dir, keepDays, now = new Date()) {
  if (!fs.existsSync(dir)) return [];
  const cutoff = Date.parse(dateStamp(now)) - keepDays * 86400000;
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    const m = DATE_IN_NAME.exec(name);
    if (!m) continue;
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}`);
    if (Number.isNaN(t) || t >= cutoff) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// A mysqldump file is only trusted if it is a real gzip, has a few tables, and ends with the
// "Dump completed" comment mysqldump writes last (a cut-off dump has no such line).
function verifyGzipDump(file, { minTables = 5, minBytes = 1024 } = {}) {
  return new Promise((resolve) => {
    let size;
    try { size = fs.statSync(file).size; } catch (e) { return resolve({ ok: false, reason: 'file missing' }); }
    if (size < minBytes) return resolve({ ok: false, reason: `only ${size} bytes` });
    let tables = 0, tail = '';
    const gunzip = zlib.createGunzip();
    gunzip.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      tables += (text.match(/CREATE TABLE/g) || []).length;
      tail = (tail + text).slice(-2048);
    });
    gunzip.on('error', (e) => resolve({ ok: false, reason: `not a valid gzip (${e.message})` }));
    gunzip.on('end', () => {
      if (tables < minTables) return resolve({ ok: false, reason: `only ${tables} tables found` });
      if (!/-- Dump completed/.test(tail)) return resolve({ ok: false, reason: 'dump does not end with "Dump completed"' });
      resolve({ ok: true, tables, bytes: size });
    });
    fs.createReadStream(file).on('error', (e) => resolve({ ok: false, reason: e.message })).pipe(gunzip);
  });
}

module.exports = { dateStamp, pruneDated, verifyGzipDump };
