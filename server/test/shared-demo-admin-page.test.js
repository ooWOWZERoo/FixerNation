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

test('the Demo page shows this window\'s counts, and the Support Inbox and Quotes mark requests that came from the demo', () => {
  assert.match(page, /id="countsCard"/);
  assert.match(page, /People who entered the access code/);
  assert.match(page, /Questions and tickets/);
  assert.match(page, /Quote requests/);
  assert.ok(!/once the demo page is published/.test(page), 'the placeholder note is gone');
  assert.match(read('admin-support.html'), /r\.demo_window > 0 \? ' <span class="a-pill a-pill-info"[^>]*>Demo<\/span>'/);
  assert.match(read('admin-support.html'), /From the shared demo/);
  assert.match(read('admin-quotes.html'), /q\.demo_window > 0 \? ' <span class="a-pill a-pill-info"[^>]*>Demo<\/span>'/);
  assert.match(read('server/routes/admin-support.js'), /r\.demo_window/);
});

// ---- Group invitations (docs/reference/shared-demo-workspaces-requirements.md, section 5) -------------------------------------------------------

test('INVITATIONS: the page leads with the group demos, and the original single demo sits in a collapsible section below them', () => {
  for (const id of ['invHeadCard', 'invNewCard', 'invListCard', 'invDetailCard', 'invEndedCard', 'legacyDemo']) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.ok(page.indexOf('id="invHeadCard"') < page.indexOf('id="invNewCard"') && page.indexOf('id="invNewCard"') < page.indexOf('id="invListCard"'));
  assert.ok(page.indexOf('id="invEndedCard"') < page.indexOf('id="legacyDemo"'), 'groups first, the original demo after');
  // the original demo's cards are all inside the collapsible section
  const legacy = page.slice(page.indexOf('<details class="demo-legacy"'), page.indexOf('</details>'));
  for (const id of ['statusCard', 'setupCard', 'codeCard', 'loginsCard', 'messageCard', 'tidyCard', 'countsCard']) assert.ok(legacy.includes(`id="${id}"`), `${id} stays on the page, inside the original demo section`);
  assert.match(page, /<summary>The original single demo<\/summary>/);
  assert.match(page, /Group demos/); assert.match(page, /Start an invitation/); assert.match(page, /Ended invitations/);
});

test('INVITATIONS: the page asks for the group\'s name, and says only staff see it', () => {
  assert.match(page, /<label for="invLabel">Group name<\/label><input type="text" id="invLabel" maxlength="120"/);
  assert.match(page, /Only staff see this name\./);
  assert.match(page, /<label for="invRename">Group name<\/label>/, 'a group can be renamed');
  assert.match(page, /data-inv="rename"/);
});

test('INVITATIONS: its buttons use their own data-inv attribute, so the original demo\'s data-action handler never sees them', () => {
  const buttons = new Set((page.match(/data-inv="([a-z-]+)"/g) || []).map(m => m.slice(10, -1)));
  for (const b of ['start', 'open', 'toggle', 'copy', 'extend', 'end', 'unlock', 'clear', 'rename', 'pause', 'resume', 'add']) assert.ok(buttons.has(b), b);
  // the three "new ..." buttons are made from a pair in the secret rows, and each has its branch in the handler
  for (const b of ['new-code', 'new-password', 'new-pin']) { assert.ok(page.includes(`['${b}', `), `${b} button`); assert.ok(page.includes(`action === '${b}'`), `${b} handler`); }
  const invScript = page.slice(page.indexOf('// Group invitations'));
  assert.ok(!/data-action=/.test(invScript), 'no invitation button reuses the original demo\'s attribute');
  assert.ok(!/closest\('\[data-action\]'\)/.test(invScript));
  // the one handler for them
  assert.match(page, /e\.target\.closest\('\[data-inv\]'\)/);
});

test('INVITATIONS: every invitation write sends a body and a content type, and only the admin demo API is called', () => {
  const invScript = page.slice(page.indexOf('// Group invitations'));
  assert.match(invScript, /async function invApi\(path, method, body\)/);
  assert.match(invScript, /opts\.headers = \{ 'Content-Type': 'application\/json' \}; opts\.body = JSON\.stringify\(body \|\| \{\}\)/);
  assert.match(invScript, /fetch\('\/api\/admin\/public-demo' \+ path/);
  assert.match(invScript, /credentials: 'include'/);
  assert.match(invScript, /fnHandleUnauthorized\(r\)/);
  assert.ok(!/fetch\(/.test(invScript.replace(/fetch\('\/api\/admin\/public-demo' \+ path/, '')), 'no other fetch');
  for (const route of ["'/invitations'", "'/pause'", "'/workspaces'", "'/invitations/' + id + '/rename'", "'/invitations/' + id + '/extend'", "'/invitations/' + id + '/new-code'", "'/invitations/' + id + '/new-secret'", "'/invitations/' + id + '/unlock'", "'/invitations/' + id + '/reset'", "'/invitations/' + id + '/end'"]) assert.ok(invScript.includes(route), route);
});

test('INVITATIONS: everything from the server is escaped, nothing is put in an inline handler, and secrets are hidden until asked for', () => {
  const invScript = page.slice(page.indexOf('// Group invitations'));
  // every server field that reaches innerHTML goes through esc()
  for (const field of ['i.label', 'i.workspace', 'i.endsAtEastern', 'l.role', 'l.userId', 'l.signIn', 'd.joinCode', 'd.endsAtEastern', 'p.max', 'p.total', 'p.inUse', 'i.id']) {
    const bare = invScript.split('\n').filter(line => line.includes(field) && /innerHTML|\+ '|' \+/.test(line) && !line.includes(`esc(${field}`) && !/\.value\s*=|\.textContent\s*=|data\.|Number\(/.test(line));
    assert.deepEqual(bare.filter(l => new RegExp(`['"]\\s*\\+\\s*${field.replace('.', '\\.')}\\s*\\+`).test(l)), [], `${field} must go through esc()`);
  }
  // the group's name goes into an input and a title with .value and .textContent, never as HTML
  assert.match(invScript, /document\.getElementById\('invRename'\)\.value = d\.label/);
  assert.match(invScript, /document\.getElementById\('invDetailTitle'\)\.textContent = d\.label/);
  assert.match(invScript, /document\.getElementById\('invMessage'\)\.value = d\.message/);
  assert.ok(!/on[a-z]+="[^"]*"/.test(invScript), 'no inline handler in the invitation code');
  // a secret shows as dots until Show is pressed, and Show / Copy work per row
  assert.match(invScript, /(\\u2022|\u2022){8}/, 'a hidden secret shows as dots');
  assert.match(invScript, /data-inv="toggle" data-key=/);
});

test('INVITATIONS: every dangerous action asks first, with plain wording', () => {
  for (const ask of [
    'Pause every demo? Every group will be signed out until you resume.',
    'Make a new access code? Everyone in this group who used the old one will be shut out.',
    'Make a new password? Everyone in this group will be signed out.',
    'Make a new student PIN? Anyone with the old one will need the new one.',
    'Clear what this group added? Their classrooms, students and work will be removed. Their codes, password and PIN stay.',
    'End this invitation now? The group will be signed out and its copy cleared.',
  ]) assert.ok(page.includes(ask), ask);
  const invScript = page.slice(page.indexOf('// Group invitations'));
  assert.ok((invScript.match(/confirm\(/g) || []).length >= 6);
});

test('INVITATIONS: the page can open one invitation from a link (Account Lookup sends staff there)', () => {
  assert.match(page, /new URLSearchParams\(location\.search\)\.get\('invitation'\)/);
  const lookup = read('admin-account-lookup.html');
  assert.match(lookup, /renderAccount\(data\.account, data\.demo\)/);
  assert.match(lookup, /function renderAccount\(account, demo\)/);
  assert.match(lookup, /admin-demo\.html\?invitation=' \+ encodeURIComponent\(g\.id\)/);
  assert.match(lookup, /esc\(g\.label\)/, 'the group\'s name is escaped');
  assert.match(lookup, /esc\(demo\.workspace\)/);
  assert.ok(!/'\s*\+\s*g\.label\s*\+/.test(lookup), 'never added to the page as it is');
  assert.match(read('server/routes/admin-account-lookup.js'), /groupForLogin\(pool, email\)/);
});

test('INVITATIONS: the new copy has no placeholder text and no em dashes, and the page still loads nothing from outside', () => {
  const invText = page.slice(page.indexOf('id="invHeadCard"'), page.indexOf('id="legacyDemo"')) + page.slice(page.indexOf('// Group invitations'));
  assert.ok(!/[—]/.test(invText));
  assert.ok(!/lorem|TODO|FIXME/i.test(invText));
  assert.ok(!/https?:\/\//.test(invText));
  assert.match(page, /Each group gets its own private copy of the demo, with its own access code, password, student PIN and end date\./);
  assert.match(page, /A group has its own private copy of the sample data\./);
});
