// Shared demo environment, phase 3: the admin Demo page (admin-demo.html) and its place in the admin workspace.
// Static checks only: the API behind it is tested in shared-demo-admin.test.js.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const page = read('admin-demo.html');
const nav = read('admin-nav.js');
const shell = read('admin-shell.js');

test('the page is a normal admin workspace page: same shell, current shared asset versions, not indexable', () => {
  assert.match(page, /<aside class="a-sidebar"><\/aside>\s*<script src="admin-nav\.js\?v=32"><\/script>/);
  assert.match(page, /admin-common\.css\?v=22/);
  assert.match(page, /admin-common\.js\?v=17/);
  assert.match(page, /admin-shell\.js\?v=5/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /<h1>Demo<\/h1>/);
});

test('every admin page that loads the shared nav and shell loads the same, current versions', () => {
  const bad = [];
  for (const f of fs.readdirSync(ROOT).filter(n => /^admin-.*\.html$/.test(n))) {
    const src = read(f);
    const navV = (src.match(/admin-nav\.js\?v=(\d+)/) || [])[1];
    const shellV = (src.match(/admin-shell\.js\?v=(\d+)/) || [])[1];
    if (navV && navV !== '32') bad.push(`${f}: admin-nav.js v${navV}`);
    if (shellV && shellV !== '5') bad.push(`${f}: admin-shell.js v${shellV}`);
  }
  assert.deepEqual(bad, [], 'bump the ?v= on every admin page whenever admin-nav.js or admin-shell.js changes');
  assert.match(nav, /admin-nav\.js\?v=32/, 'the header comment in admin-nav.js names the current version');
});

test('the sidebar lists Demo in the Sales group, with its own icon, and the page has an intro', () => {
  const sales = nav.slice(nav.indexOf("key: 'sales'"), nav.indexOf("key: 'support'"));
  assert.match(sales, /link\('admin-demo\.html',\s+'[^']+', 'Demo'\)/);
  assert.match(nav, /"demo": "</);
  assert.match(shell, /'demo': \['Let them try it first'/);
});

test('the page talks only to the admin demo API, and every write sends a body and a content type', () => {
  assert.match(page, /fetch\('\/api\/admin\/public-demo' \+ path/);
  assert.match(page, /opts\.headers = \{ 'Content-Type': 'application\/json' \}; opts\.body = JSON\.stringify\(body \|\| \{\}\)/);
  assert.match(page, /credentials: 'include'/);
  assert.match(page, /fnHandleUnauthorized\(r\)/);
  assert.ok(!/fetch\('\/api\/(?!admin\/public-demo)/.test(page), 'no other endpoint is called');
});

test('everything that came from the server is escaped before it goes into the page', () => {
  assert.match(page, /function esc\(v\) \{ return fnEscape\(v\); \}/);
  // no inline handler carries data from the server (the escaping rule in CLAUDE.md): handlers are static, data lives in data- attributes
  const inline = page.match(/on[a-z]+="[^"]*"/g) || [];
  assert.deepEqual(inline.filter(h => h.includes("'+") || h.includes('+ ') || h.includes('${')), []);
  // the places server text is turned into HTML
  for (const field of ['s.endsAtEastern', 'l.role', 'l.userId', 'l.signIn', 's.joinCode', 'value', 'label']) {
    const uses = page.split('\n').filter(line => line.includes(field) && /innerHTML|\+ /.test(line) && !/esc\(/.test(line) && !/\.value\s*=/.test(line));
    assert.deepEqual(uses.filter(l => /['"]\s*\+\s*(s|l)\.[a-zA-Z]+\s*\+/.test(l)), [], `${field} must go through esc()`);
  }
  // the message is put into a textarea with .value, never as HTML
  assert.match(page, /document\.getElementById\('demoMessage'\)\.value = s\.message/);
});

test('secrets stay hidden until asked for, and every dangerous action asks first', () => {
  assert.match(page, /(\\u2022|\u2022){6,}/, 'a hidden secret shows as dots');
  assert.match(page, /data-action="toggle"/);
  for (const ask of ['Turn the demo off now?', 'Make a new access code?', 'Make a new password?', 'Make a new student PIN?', 'Reset the demo data now?']) {
    assert.ok(page.includes(ask), ask);
  }
  // off, reset, and the shared renew handler that covers a new code, password and PIN
  assert.ok((page.match(/confirm\(/g) || []).length >= 3);
});

test('no outside scripts, fonts or images, and no placeholder wording', () => {
  assert.ok(!/https?:\/\/(?!example\.com)/.test(page.replace(/<link rel="icon"[^>]*>/g, '')), 'no external URLs');
  assert.ok(!/fonts\.googleapis|cdnjs|unpkg|jsdelivr/i.test(page));
  assert.ok(!/lorem|TODO|FIXME/i.test(page));
  assert.ok(!/[—]/.test(page), 'no em dashes in the copy');
});

test('the visible copy matches what the requirements promise visitors can and cannot do', () => {
  for (const line of [
    "They can view every lesson in the viewer, but they can't download files.",
    "They can't send email. Invitations only work with example.com addresses.",
    "They can't change the password or PIN, upload files, or reach the community.",
  ]) assert.ok(page.includes(line), line);
});
