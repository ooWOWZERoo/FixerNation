// Tests for the nightly backup helpers (lib/backup-tools.js, used by scripts/backup-nightly.js).
// What must hold: old dated dumps and folders are removed and recent or undated ones are kept; a dump
// only counts as good when it is a real gzip with enough tables that ends with "Dump completed";
// a cut-off or garbage file is rejected.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { dateStamp, pruneDated, verifyGzipDump } = require('../lib/backup-tools');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fne-backup-test-'));
const NOW = new Date('2026-11-05T02:30:00Z');

function fakeDump(complete, tables = 8) {
  let sql = '-- MariaDB dump\n';
  for (let i = 0; i < tables; i++) sql += `CREATE TABLE t${i} (id int);\nINSERT INTO t${i} VALUES (1),(2),(3);\n`;
  sql += crypto.randomBytes(1500).toString('hex') + '\n'; // random so it does not compress below the size floor
  if (complete) sql += '-- Dump completed on 2026-11-05  2:30:05\n';
  return zlib.gzipSync(sql);
}

test('dateStamp uses the UTC date', () => {
  assert.equal(dateStamp(new Date('2026-11-05T23:59:59Z')), '2026-11-05');
});

test('pruneDated removes only dated entries older than the cutoff', () => {
  const dir = tmp();
  for (const n of ['db-2026-11-05.sql.gz', 'db-2026-10-29.sql.gz', 'db-2026-10-28.sql.gz', 'db-2026-09-01.sql.gz', 'README.txt']) {
    fs.writeFileSync(path.join(dir, n), 'x');
  }
  const removed = pruneDated(dir, 7, NOW).sort();
  assert.deepEqual(removed, ['db-2026-09-01.sql.gz', 'db-2026-10-28.sql.gz']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['README.txt', 'db-2026-10-29.sql.gz', 'db-2026-11-05.sql.gz']);
});

test('pruneDated removes old dated folders with their contents, and ignores a missing folder', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '2026-10-01', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-01', 'sub', 'a.pdf'), 'x');
  fs.mkdirSync(path.join(dir, '2026-11-04'));
  assert.deepEqual(pruneDated(dir, 14, NOW), ['2026-10-01']);
  assert.deepEqual(fs.readdirSync(dir), ['2026-11-04']);
  assert.deepEqual(pruneDated(path.join(dir, 'nope'), 14, NOW), []);
});

test('a complete dump passes the check', async () => {
  const f = path.join(tmp(), 'ok.sql.gz');
  fs.writeFileSync(f, fakeDump(true));
  const r = await verifyGzipDump(f);
  assert.equal(r.ok, true);
  assert.equal(r.tables, 8);
});

test('a dump with no "Dump completed" line is rejected', async () => {
  const f = path.join(tmp(), 'cut.sql.gz');
  fs.writeFileSync(f, fakeDump(false));
  const r = await verifyGzipDump(f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Dump completed/);
});

test('a dump with too few tables, a tiny file, a bad gzip and a missing file are rejected', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'few.sql.gz'), fakeDump(true, 2));
  assert.match((await verifyGzipDump(path.join(dir, 'few.sql.gz'))).reason, /tables/);
  fs.writeFileSync(path.join(dir, 'tiny.sql.gz'), zlib.gzipSync('x'));
  assert.match((await verifyGzipDump(path.join(dir, 'tiny.sql.gz'))).reason, /bytes/);
  fs.writeFileSync(path.join(dir, 'bad.sql.gz'), Buffer.from('this is not gzip data '.repeat(100)));
  assert.match((await verifyGzipDump(path.join(dir, 'bad.sql.gz'))).reason, /gzip/);
  assert.equal((await verifyGzipDump(path.join(dir, 'missing.sql.gz'))).ok, false);
});
