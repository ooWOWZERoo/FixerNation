// Sales CRM phase 3: files. The type comes from the bytes, nothing is ever a public URL, the path cannot be steered, and each role sees only what the matrix allows.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const env = require('./helpers/crm-env');

const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'fne-crm-files-'));
process.env.CRM_FILES_DIR = FILES;
const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/files', R('crm-files.js')]]);
const port = server.address().port;
test.after(() => { server.close(); fs.rmSync(FILES, { recursive: true, force: true }); });
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const sales2 = env.addAdmin(db, 'rep2', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const account = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Test District')").run().lastInsertRowid);
const deal = (owner) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id) VALUES (?, 'Deal', 1, ?)").run(account, owner).lastInsertRowid);
const mine = deal(sales), theirs = deal(sales2);
const contact = env.addContact(db, 'pat@school-a.test', 'Pat');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 2)]);

function upload(adminId, fields, file) {
  const boundary = '----fnetest' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`), file.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method: 'POST', path: '/api/crm/files', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, 'x-admin': String(adminId) } }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject); req.end(body);
  });
}
function download(adminId, id) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: `/api/crm/files/${id}/download`, headers: { 'x-admin': String(adminId) } }, (res) => {
      const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
const incoming = () => { try { return fs.readdirSync(path.join(FILES, '.incoming')); } catch { return []; } };
const stored = () => fs.readdirSync(FILES).filter(f => f !== '.incoming');

test('TYPE FROM BYTES: the name and the Content-Type the browser sends are never believed', async () => {
  const html = await upload(admin, { accountId }, { name: 'quote.png', type: 'image/png', data: Buffer.from('<html><script>alert(1)</script></html>') });
  assert.equal(html.status, 415, 'HTML dressed up as a PNG is refused');
  const svg = await upload(admin, { accountId }, { name: 'logo.svg', type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>') });
  assert.equal(svg.status, 415, 'SVG is never accepted');
  const exe = await upload(admin, { accountId }, { name: 'report.pdf', type: 'application/pdf', data: Buffer.from('MZ\x90\x00 program') });
  assert.equal(exe.status, 415, 'a program named .pdf is refused');
  assert.equal((await upload(admin, { accountId }, { name: 'empty.pdf', type: 'application/pdf', data: Buffer.alloc(0) })).status, 415);
  assert.equal((await upload(admin, { accountId }, undefined)).status, 400, 'no file');
  const real = await upload(admin, { accountId }, { name: 'evil.html', type: 'text/html', data: PNG });
  assert.equal(real.status, 201, 'a real PNG is accepted whatever it is called');
  assert.equal(get('SELECT kind, mime FROM crm_attachments WHERE id = ?', real.json.id).kind, 'png');
  assert.deepEqual(incoming(), [], 'every rejected upload left nothing behind');
});
const accountId = account;

test('STORAGE: kept under a random neutral name inside the private folder, with the real name kept only as sanitised metadata', async () => {
  const r = await upload(admin, { opportunityId: mine }, { name: '../../etc/passwd‮gnp.pdf', type: 'application/pdf', data: PDF });
  assert.equal(r.status, 201);
  const row = get('SELECT * FROM crm_attachments WHERE id = ?', r.json.id);
  assert.match(row.stored_name, /^[a-f0-9]{32}\.bin$/);
  assert.ok(fs.existsSync(path.join(FILES, row.stored_name)), 'the file is inside the private folder');
  assert.ok(!/[\\/‮]/.test(row.original_name), `the label has no path or direction trick: ${row.original_name}`);
  assert.equal(row.opportunity_id, mine); assert.equal(row.account_id, account);
  const d = await download(admin, r.json.id);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body, PDF, 'the bytes come back exactly');
  assert.match(d.headers['content-disposition'], /^attachment; filename="/, 'always a download, never shown inside the page');
  assert.equal(d.headers['x-content-type-options'], 'nosniff');
  assert.match(d.headers['content-security-policy'], /sandbox/);
  assert.match(d.headers['cache-control'], /no-store/);
  const w = await upload(admin, { accountId }, { name: 'budget.xlsx', type: 'application/vnd.ms-excel', data: DOCX });
  assert.equal(w.status, 201);
  assert.equal((await download(admin, w.json.id)).headers['content-type'], 'application/octet-stream', 'a zip container is only ever a plain download');
});

test('SIZE: more than 15 MB is refused and nothing stays on disk', async () => {
  const r = await upload(admin, { accountId }, { name: 'big.pdf', type: 'application/pdf', data: Buffer.concat([PDF, Buffer.alloc(15 * 1024 * 1024 + 10, 0x20)]) });
  assert.equal(r.status, 413);
  assert.deepEqual(incoming(), []);
});

test('PATH TRAVERSAL: a bad stored name in the database, or one the code did not make, never reads outside the folder', async () => {
  const outside = path.join(os.tmpdir(), `fne-outside-${Date.now()}.bin`);
  fs.writeFileSync(outside, 'TOP SECRET');
  const rel = path.relative(FILES, outside);
  for (const bad of [rel, '../x.bin', '..%2f..%2fetc%2fpasswd', '/etc/passwd', 'a.bin', `${'a'.repeat(32)}.exe`, `${'A'.repeat(32)}.bin`]) {
    const id = Number(db.prepare("INSERT INTO crm_attachments (account_id, original_name, stored_name, kind, mime, size_bytes) VALUES (?, 'x.pdf', ?, 'pdf', 'application/pdf', 10)").run(account, bad).lastInsertRowid);
    const d = await download(admin, id);
    assert.equal(d.status, 404, `refused: ${bad}`);
    assert.ok(!d.body.toString().includes('TOP SECRET'));
  }
  const F = require(path.join(env.SERVER, 'lib/crm-files.js'));
  assert.equal(F.pathFor('../../etc/passwd'), null);
  assert.equal(F.pathFor(`${'a'.repeat(32)}.bin`), path.join(FILES, `${'a'.repeat(32)}.bin`));
  assert.equal(F.safeOriginalName('..\\..\\windows\\evil.exe'), 'evil.exe');
  assert.equal(F.safeOriginalName('....'), 'file');
  assert.ok(F.safeOriginalName('a'.repeat(300) + '.pdf').length <= 120 && F.safeOriginalName('a'.repeat(300) + '.pdf').endsWith('.pdf'));
  fs.unlinkSync(outside);
});

test('ROLES: Read-only opens no file at all; Sales reach files on deals they can edit and on accounts and contacts; the CRM Admin reaches everything', async () => {
  const onMine = (await upload(sales, { opportunityId: mine }, { name: 'po.pdf', data: PDF })).json.id;
  const onTheirs = (await upload(admin, { opportunityId: theirs }, { name: 'contract.pdf', data: PDF })).json.id;
  const onAccount = (await upload(sales, { accountId }, { name: 'w9.pdf', data: PDF })).json.id;
  const onContact = (await upload(sales2, { contactId: contact }, { name: 'card.png', data: PNG })).json.id;
  assert.ok(onMine && onTheirs && onAccount && onContact);

  // Read-only
  assert.equal((await call('GET', `/api/crm/files?accountId=${account}`, undefined, viewer)).status, 403);
  assert.equal((await upload(viewer, { accountId }, { name: 'x.pdf', data: PDF })).status, 403);
  assert.equal((await download(viewer, onAccount)).status, 403);
  assert.equal((await call('DELETE', `/api/crm/files/${onAccount}`, undefined, viewer)).status, 403);
  // Sales
  assert.equal((await upload(sales, { opportunityId: theirs }, { name: 'x.pdf', data: PDF })).status, 403, 'cannot attach to someone else\'s deal');
  assert.equal((await download(sales, onTheirs)).status, 404, 'cannot open a file on someone else\'s deal (and cannot tell it exists)');
  assert.equal((await download(sales, onMine)).status, 200);
  assert.equal((await download(sales, onContact)).status, 200, 'a contact\'s file is open to Sales');
  const list = await call('GET', `/api/crm/files?accountId=${account}`, undefined, sales);
  const names = list.json.files.map(f => f.name);
  assert.ok(names.includes('po.pdf') && names.includes('w9.pdf'));
  assert.ok(!names.includes('contract.pdf'), 'the account list hides files on deals Sales cannot edit');
  assert.equal((await call('GET', `/api/crm/files?opportunityId=${theirs}`, undefined, sales)).json.total, 0);
  // Admin
  assert.equal((await download(admin, onTheirs)).status, 200);
  assert.ok((await call('GET', `/api/crm/files?accountId=${account}`, undefined, admin)).json.files.map(f => f.name).includes('contract.pdf'));
  // Delete: the uploader or the admin
  assert.equal((await call('DELETE', `/api/crm/files/${onAccount}`, undefined, sales2)).status, 403, 'not the uploader');
  const row = get('SELECT stored_name FROM crm_attachments WHERE id = ?', onAccount);
  assert.equal((await call('DELETE', `/api/crm/files/${onAccount}`, undefined, sales)).status, 200);
  assert.ok(!fs.existsSync(path.join(FILES, row.stored_name)), 'the bytes are removed with the row');
  assert.equal((await call('DELETE', `/api/crm/files/${onTheirs}`, undefined, admin)).status, 200);
  assert.ok(all("SELECT * FROM school_audit_log WHERE entity_type = 'crm_file' AND purchase_id IS NULL").length >= 4, 'adds, downloads and deletes are audited');
});

test('LIMIT: a record holds at most 25 files', async () => {
  const c2 = env.addContact(db, 'many@school-a.test', 'Many');
  let last;
  for (let i = 0; i < 26; i++) last = await upload(admin, { contactId: c2 }, { name: `f${i}.png`, data: PNG });
  assert.equal(last.status, 409);
  assert.equal(all('SELECT * FROM crm_attachments WHERE contact_id = ?', c2).length, 25);
});

test('OFF SWITCH and PUBLIC URL: a switched-off Hub writes nothing to disk, and the private folder is never served from /uploads', async () => {
  env.enable(db, false);
  const before = stored().length;
  assert.equal((await upload(admin, { accountId }, { name: 'x.pdf', data: PDF })).status, 404);
  assert.equal(stored().length, before); assert.deepEqual(incoming(), []);
  env.enable(db, true);
  const app = fs.readFileSync(path.join(env.SERVER, 'app.js'), 'utf8');
  const block = app.indexOf("app.use('/uploads/crm-private'"), stat = app.indexOf("app.use('/uploads', express.static");
  assert.ok(block > 0 && stat > block, 'the private path is answered with a 404 BEFORE express.static can see it');
  const htaccess = fs.readFileSync(path.join(env.SERVER, '..', '.htaccess'), 'utf8');
  assert.match(htaccess, /RewriteRule \^uploads\/crm-private\(\/\|\$\) - \[F,L\]/, 'the web server refuses the path too');
  assert.ok(htaccess.indexOf('uploads/crm-private') < htaccess.indexOf('LimitRequestBody'));
  const F = require(path.join(env.SERVER, 'lib/crm-files.js'));
  assert.ok(F.baseDir().startsWith(FILES), 'CRM_FILES_DIR is honoured');
  delete process.env.CRM_FILES_DIR; process.env.UPLOADS_DIR = '/srv/uploads';
  assert.equal(F.baseDir(), '/srv/uploads/crm-private', 'by default the folder sits inside UPLOADS_DIR, so the nightly backup covers it');
});
