// The "Your sign-ins" card on demo-welcome.html links to each sign-in page with the user ID, and the sign-in page fills it in. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const F = require('../lib/public-demo-fixtures');
const SCRIPT = read('demo-signin-prefill.js');

// Run the real script against a stand-in page: a search string and the boxes it looks for.
function run(search, boxes, hasGoStep = true) {
  const els = {}; const log = [];
  for (const id of boxes) els[id] = { value: '', dispatchEvent() {}, focus() { log.push('focus ' + id); } };
  const ctx = { window: { location: { search } }, document: { getElementById: (id) => els[id] || null }, Event: class {}, decodeURIComponent };
  if (hasGoStep) ctx.goStep = (s) => log.push('goStep ' + s);
  vm.runInNewContext(SCRIPT, ctx);
  return { els, log };
}
const q = (v) => '?demoUser=' + encodeURIComponent(v);

test('PREFILL: a demo email is put in the email box and the cursor moves to the password; nothing else is touched', () => {
  const { els, log } = run(q('demo-teacher-12@public-demo.example.com'), ['email', 'password']);
  assert.equal(els.email.value, 'demo-teacher-12@public-demo.example.com');
  assert.equal(els.password.value, '');
  assert.deepEqual(log, ['focus password']);
});

test('PREFILL: a demo student name goes to the student page, which first moves to its username and PIN step, and the cursor lands on the PIN', () => {
  const { els, log } = run(q('demo-student-12'), ['loginUsername', 'loginPin']);
  assert.equal(els.loginUsername.value, 'demo-student-12');
  assert.deepEqual(log, ['goStep step-login', 'focus loginPin']);
});

test('PREFILL: only the shape of a demo user ID is accepted, so a sign-in page cannot be used to pre-fill anyone else', () => {
  for (const bad of ['someone@school.edu', 'demo-teacher-12@evil.com', 'demo-teacher-12@public-demo.example.com.evil.com', '<script>alert(1)</script>', 'demo-', 'admin', '', 'demo-teacher-12 @public-demo.example.com']) {
    const { els, log } = run(q(bad), ['email', 'password']);
    assert.equal(els.email.value, '', `not accepted: ${bad}`); assert.deepEqual(log, []);
  }
  assert.equal(run('', ['email', 'password']).els.email.value, '', 'no address, nothing happens');
  assert.equal(run('?demoUser=%E0%A4%A', ['email', 'password']).els.email.value, '', 'a broken encoding is ignored');
  assert.equal(run('?other=1&demoUser=demo-parent-3%40public-demo.example.com', ['email', 'password']).els.email.value, 'demo-parent-3@public-demo.example.com', 'found among other parameters');
});

test('PAGES: the card adds the user ID to every link; each page it can link to is a real sign-in page with the boxes and the script', () => {
  const card = read('demo-welcome.html');
  assert.match(card, /a\.href = l\.signIn \+ '\?demoUser=' \+ encodeURIComponent\(l\.userId\)/);
  for (const [role, page] of Object.entries(F.LOGIN_PAGES)) {
    assert.match(page, /-login\.html$/, `${role} goes to a sign-in page, not a page that redirects or opens a pop-up`);
    const html = read(page);
    assert.match(html, /<script src="demo-signin-prefill\.js\?v=1" defer><\/script>/, `${page} loads the prefill`);
    if (role === 'student') assert.match(html, /id="loginUsername"[\s\S]*id="loginPin"/); else assert.match(html, /id="email"[\s\S]*id="password"/);
  }
});

test('SECRETS: neither the card nor the prefill puts a password or PIN in an address', () => {
  assert.doesNotMatch(read('demo-welcome.html'), /signIn \+ '\?[^']*(password|pin)/i);
  assert.doesNotMatch(SCRIPT, /password\.value\s*=|loginPin\.value\s*=|\.value\s*=\s*[^i]*(password|pin)/i);
});
