// The website logo setting (routes/settings.js, lib/settings.js): the public header and footer read it from the public
// GET /site-logo; only an FNE admin can change it; unsafe values are refused; empty means the built-in logo.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT)');
const pool = {
  query: async (sql, params = []) => {
    const s = sql.trim().replace(/^INSERT INTO settings \(setting_key, setting_value\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE setting_value = \?$/,
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value');
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const usable = /ON CONFLICT/.test(s) ? params.slice(0, 2) : params;
    const r = db.prepare(s).run(...usable);
    return [{ affectedRows: Number(r.changes) }];
  },
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => (req.get('x-admin') ? next() : res.status(401).json({ error: 'no' })), getAuthUser: () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
require('express-async-errors');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/settings', require(path.join(SERVER, 'routes/settings.js')));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, path, body, admin = true) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = admin ? { 'x-admin': '1' } : {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: '/api/settings/' + path, headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('with nothing set, the public logo is empty (the pages keep the built-in logo)', async () => {
  db.exec('DELETE FROM settings');
  assert.deepEqual((await call('GET', 'site-logo', undefined, false)).json, { url: '' });
  assert.deepEqual((await call('GET', 'website-logo')).json, { logoUrl: '' });
});

test('an admin can set a logo and the public endpoint serves it without a sign-in', async () => {
  for (const v of ['/uploads/logo-1.webp', 'uploads/logo-1.webp', 'logo.png', 'https://example.com/a/b.png']) {
    assert.equal((await call('PUT', 'website-logo', { logoUrl: v })).status, 200, v);
    assert.equal((await call('GET', 'site-logo', undefined, false)).json.url, v);
    assert.equal((await call('GET', 'website-logo')).json.logoUrl, v);
  }
});

test('the website logo is separate from the invoice logo', async () => {
  await call('PUT', 'invoice-branding', { businessName: 'X', tagline: '', logoUrl: '/uploads/invoice.png' });
  await call('PUT', 'website-logo', { logoUrl: '/uploads/site.png' });
  assert.equal((await call('GET', 'invoice-branding')).json.logoUrl, '/uploads/invoice.png');
  assert.equal((await call('GET', 'site-logo', undefined, false)).json.url, '/uploads/site.png');
});

test('empty clears it back to the built-in logo', async () => {
  await call('PUT', 'website-logo', { logoUrl: '/uploads/site.png' });
  assert.equal((await call('PUT', 'website-logo', { logoUrl: '  ' })).status, 200);
  assert.equal((await call('GET', 'site-logo', undefined, false)).json.url, '');
});

test('values that could run script or break out of an attribute are refused, and the saved value stays', async () => {
  await call('PUT', 'website-logo', { logoUrl: '/uploads/keep.png' });
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'http://example.com/a.png', '//evil.example/a.png:x', '/a.png" onerror="x', "/a.png'x", '/a b.png', '<img>']) {
    assert.equal((await call('PUT', 'website-logo', { logoUrl: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal((await call('PUT', 'website-logo', { logoUrl: 123 })).status, 200); // non-strings are treated as empty
  assert.equal((await call('GET', 'site-logo', undefined, false)).json.url, '');
});

test('only an FNE admin can read the admin view or change the logo', async () => {
  assert.equal((await call('GET', 'website-logo', undefined, false)).status, 401);
  assert.equal((await call('PUT', 'website-logo', { logoUrl: '/uploads/x.png' }, false)).status, 401);
});

// The public endpoint serves a copy with the blank margin trimmed, so a stacked logo on a big white canvas is not tiny.
const fs = require('node:fs');
const os = require('node:os');
const sharp = require('sharp');
const { trimmedLogoUrl } = require(path.join(SERVER, 'lib/site-logo.js'));

test('a logo on a big blank canvas is trimmed to its content; the original stays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fne-logo-'));
  process.env.UPLOADS_DIR = dir; process.env.UPLOADS_URL_PREFIX = '/uploads/';
  const mark = await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 10, g: 80, b: 180 } } }).png().toBuffer();
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } })
    .composite([{ input: mark, left: 250, top: 160 }]).png().toFile(path.join(dir, 'big.png'));
  const url = await trimmedLogoUrl('/uploads/big.png');
  assert.equal(url, '/uploads/site-logo-big.png');
  const meta = await sharp(path.join(dir, 'site-logo-big.png')).metadata();
  assert.deepEqual([meta.width, meta.height], [100, 80]);
  assert.equal((await sharp(path.join(dir, 'big.png')).metadata()).width, 600);
  assert.equal(await trimmedLogoUrl('/uploads/big.png'), url); // second call reuses it
  assert.equal(await trimmedLogoUrl('uploads/big.png'), url);  // path without the leading slash
});

test('addresses it cannot or should not touch come back unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fne-logo-'));
  process.env.UPLOADS_DIR = dir; process.env.UPLOADS_URL_PREFIX = '/uploads/';
  for (const u of ['https://example.com/a.png', '/uploads/missing.png', '/uploads/../secret.png', '/uploads/sub/a.png', 'logo-fne.png', '', '/uploads/.hidden.png']) {
    assert.equal(await trimmedLogoUrl(u), u, JSON.stringify(u));
  }
});

// Tab icon and home-screen icon: GET /api/settings/favicon?size=N.
function raw(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: pathname, timeout: 5000 }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('favicon: with no website logo it sends the built-in icon files', async () => {
  db.exec('DELETE FROM settings');
  const cases = { 16: '/favicon-16x16.png', 32: '/favicon-32x32.png', 48: '/favicon-32x32.png', 180: '/apple-touch-icon.png', 999: '/favicon-32x32.png' };
  for (const [size, to] of Object.entries(cases)) {
    const r = await raw('/api/settings/favicon?size=' + size);
    assert.equal(r.status, 302, size); assert.equal(r.headers.location, to, size);
  }
  assert.equal((await raw('/api/settings/favicon')).headers.location, '/favicon-32x32.png');
});

test('favicon: with a website logo it serves a square PNG made from it, at the size asked for', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fne-icon-'));
  process.env.UPLOADS_DIR = dir; process.env.UPLOADS_URL_PREFIX = '/uploads/';
  const mark = await sharp({ create: { width: 120, height: 100, channels: 3, background: { r: 10, g: 80, b: 180 } } }).png().toBuffer();
  await sharp({ create: { width: 700, height: 500, channels: 3, background: '#ffffff' } })
    .composite([{ input: mark, left: 290, top: 200 }]).png().toFile(path.join(dir, 'wide.png'));
  await call('PUT', 'website-logo', { logoUrl: '/uploads/wide.png' });
  for (const size of [16, 32, 48, 180]) {
    const r = await raw('/api/settings/favicon?size=' + size);
    assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/png');
    const m = await sharp(r.body).metadata();
    assert.deepEqual([m.width, m.height], [size, size], 'size ' + size);
  }
  // a logo that is not a local upload falls back to the built-in icon
  await call('PUT', 'website-logo', { logoUrl: 'https://example.com/x.png' });
  assert.equal((await raw('/api/settings/favicon?size=16')).status, 302);
});

// Sign-in and one-card pages have no shared header, so each marks its logo and loads site-logo.js.
test('the sign-in pages show the website logo (marked image + shared script, no hard-coded logo left)', () => {
  const root = path.join(SERVER, '..');
  const pages = 'admin-login district-admin-login parent-login school-admin-login student-login teacher-login reset-password parent-invite-accept school-invite-accept admin-accept-invite microsoft-confirm accept-quote'.split(' ');
  for (const p of pages) {
    const html = fs.readFileSync(path.join(root, p + '.html'), 'utf8');
    assert.match(html, /<img src="logo-fne\.png\?v=2" alt="Fixer Nation Education" data-site-logo>/, p);
    assert.match(html, /<script src="site-logo\.js\?v=1"><\/script>\s*<\/body>/, p);
  }
});
