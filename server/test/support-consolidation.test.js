// Release 134: all support tools in one Support area of the admin (docs/reference/support-consolidation-requirements.md).
// These are wiring tests: the pages, the sidebar group, the tab strip, the idle lock on the student-name page, the old links, and
// that every support route is still behind the admin login. The routes themselves are tested in support-requests, support-console
// and client-errors.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUPPORT_PAGES = ['admin-support.html', 'admin-account-lookup.html', 'admin-support-classrooms.html', 'admin-support-errors.html', 'admin-support-help.html'];

test('NAV: one Support group with the five pages, and neither old entry is left under Schools & Partners', () => {
  const nav = read('admin-nav.js');
  const group = nav.slice(nav.indexOf("{ key: 'support'"), nav.indexOf("{ key: 'schools-partners'"));
  const hrefs = [...group.matchAll(/link\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(hrefs, SUPPORT_PAGES);
  assert.match(group, /label: 'Support'/);
  const partners = nav.slice(nav.indexOf("{ key: 'schools-partners'"), nav.indexOf("{ key: 'content'"));
  assert.ok(!/admin-support|admin-account-lookup/.test(partners), 'the old entries are gone from Schools & Partners');
  for (const f of SUPPORT_PAGES) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  // both counts are best effort and the errors count is remembered, so it is not a grouped query on every admin page
  assert.match(nav, /api\/admin\/support\/summary/);
  assert.match(nav, /api\/admin\/client-errors\?hours=24/);
  assert.match(nav, /fnAdminErr24/);
  // clearing or reloading on the Errors page must refresh the menu count (the 5-minute memory made it stale in Release 134)
  assert.match(nav, /window\.fnSetErrorBadge = function/);
  assert.match(read('admin-support-errors.html'), /fnSetErrorBadge\(d\.last24Hours\)/);
});

test('SHELL: all five pages show the same tab strip and say "Support" in the breadcrumb', () => {
  const shell = read('admin-shell.js');
  for (const k of ['support', 'account-lookup', 'support-classrooms', 'support-errors', 'support-help']) {
    assert.match(shell, new RegExp(`'${k}': \\[[^\\]]*'Support'\\]`), `${k} has a Support breadcrumb`);
  }
  assert.match(shell, /\[\['support','Requests'\],\['account-lookup','Account lookup'\],\['support-classrooms','Classrooms & parents'\],\['support-errors','Errors'\],\['support-help','Help content'\]\]/);
});

test('OLD LINKS: the Inbox still opens, ?tab=errors and #errors forward to the Errors page, ?email= still works on Account Lookup', () => {
  const inbox = read('admin-support.html');
  assert.match(inbox, /get\('tab'\) === 'errors'\) location\.replace\('admin-support-errors\.html'\)/);
  assert.match(inbox, /\^#errors\$/);
  assert.match(read('admin-account-lookup.html'), /get\('email'\)/);
  // the Inbox keeps the per-request errors panel (it has no list of its own any more)
  assert.match(inbox, /for-request/);
  assert.ok(!/id="errorsCard"|id="tabErrors"|loadErrors/.test(inbox), 'the Errors list moved out of the Inbox');
  const errors = read('admin-support-errors.html');
  assert.match(errors, /api\/admin\/client-errors/); assert.match(errors, /clearErrorGroup/); assert.match(errors, /fnEscape/);
  assert.ok(!/<div class="a-card" id="errorsCard" style="display:none;">/.test(errors), 'the Errors card is shown, not hidden');
});

test('STUDENT NAMES: only Classrooms & Parents shows them, and it carries the idle lock; Account Lookup no longer asks for names', () => {
  const cls = read('admin-support-classrooms.html');
  assert.match(cls, /admin-privacy-lock\.js\?v=1/); assert.match(cls, /fnPrivacyLock\(/); assert.match(cls, /lock\.arm\(\)/);
  assert.match(cls, /support-console\/classrooms/); assert.match(cls, /support-console\/parents/);
  assert.match(cls, /reset-pin/); assert.match(cls, /clear-lock/); assert.match(cls, /parent-invitations/);
  assert.match(cls, /fnEscape/);
  assert.ok(!/onclick="[^"]*\+ *(s|c|i|a)\.(displayName|student|name|username)/.test(cls), 'no student name goes into an inline handler');
  // the Open parent view link and ?q= / ?parent= deep links
  assert.match(cls, /get\('parent'\)/); assert.match(cls, /get\('q'\)/);
  const acc = read('admin-account-lookup.html');
  assert.ok(!/fnPrivacyLock|admin-privacy-lock/.test(acc), 'Account Lookup shows no student names, so it carries no lock');
  assert.ok(!/support-console\/(classrooms|parents|students|parent-invitations)/.test(acc), 'no student-name call is left on Account Lookup');
  assert.match(acc, /admin-support-classrooms\.html\?parent=/);
  // the other pages in the area hold no student names
  for (const f of ['admin-support-errors.html', 'admin-support-help.html']) assert.ok(!/support-console\/(classrooms|parents)/.test(read(f)), f);
});

test('ACCOUNT ACTIONS: everything that was on Account Lookup is still there', () => {
  const acc = read('admin-account-lookup.html');
  for (const needle of ['send-password-reset', 'resend-verification', 'sign-out', 'reset-link', 'support-console/timeline', '/reopen', 'invitations/', 'seats/', 'resend-welcome']) {
    assert.ok(acc.includes(needle), `Account Lookup still calls ${needle}`);
  }
});

test('HELP CONTENT: read-only, reads the two static lists, writes nothing and builds no HTML from data', () => {
  const page = read('admin-support-help.html');
  assert.match(page, /FNHelpCenter/); assert.match(page, /FNHelpVideos/);
  assert.match(page, /api\/settings\/contact-emails/); assert.match(page, /api\/settings\/privacy-lock/);
  assert.ok(!/innerHTML\s*=/.test(page), 'built with textContent only');
  assert.ok(!/method:\s*'(POST|PUT|DELETE)'/.test(page), 'the page only reads');
  assert.equal(page.match(/help-center\.js\?v=(\d+)/)[1], read('help.html').match(/help-center\.js\?v=(\d+)/)[1], 'same help-center.js version as the Help center');
  assert.match(read('server/routes/settings.js'), /router\.get\('\/contact-emails', requireAuth/);
});

test('ACCESS: every route behind the Support pages is still the admin login, and no new endpoint was added for them', () => {
  for (const f of ['admin-support.js', 'admin-support-console.js', 'admin-client-errors.js', 'admin-account-lookup.js']) {
    const src = read('server/routes/' + f);
    const lines = src.split('\n').filter(l => /^router\.(get|post|put|delete)\(/.test(l));
    assert.ok(lines.length > 0, f);
    for (const l of lines) assert.match(l, /requireAuth/, `${f}: ${l.slice(0, 60)}`);
  }
  // the new pages only call routes that already existed
  const allowed = [/^\/api\/admin\/support/, /^\/api\/admin\/support-console/, /^\/api\/admin\/client-errors/, /^\/api\/admin\/account-lookup/, /^\/api\/settings\/(contact-emails|privacy-lock)/];
  for (const f of ['admin-support-classrooms.html', 'admin-support-errors.html', 'admin-support-help.html']) {
    for (const m of read(f).matchAll(/'(\/api\/[^'?]*)/g)) assert.ok(allowed.some(re => re.test(m[1])), `${f} calls ${m[1]}`);
  }
});

test('MISSION CONTROL: Needs Attention shows new support requests and the last 24 hours of errors, from the existing endpoints', () => {
  const dash = read('admin-dashboard.html');
  assert.match(dash, /api\/admin\/support\/summary/); assert.match(dash, /api\/admin\/client-errors\?hours=24/);
  assert.match(dash, /admin-support\.html/); assert.match(dash, /admin-support-errors\.html/);
  assert.match(dash, /new support request/);
});

test('AUTOMATIONS: the two Support triggers nothing ever fired are no longer offered', () => {
  const page = read('admin-automations.html');
  assert.ok(!/<select id="bTrigCat"[\s\S]*?value="support"[\s\S]*?<\/select>/.test(page), 'the trigger picker has no Support category');
  assert.ok(!/id:'cs4'/.test(page), 'the Support Ticket Follow-Up template is gone');
  // and the server never fires them (this is why they were removed)
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' || e.name === 'test' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  for (const f of walk(path.join(ROOT, 'server'))) assert.ok(!/fireAutomation\(\s*'ticket_/.test(fs.readFileSync(f, 'utf8')), f);
});

test('CACHE VERSIONS: every admin page loads the same admin-nav.js and admin-shell.js, and the numbers moved', () => {
  const files = fs.readdirSync(ROOT).filter(n => /^admin-.*\.html$/.test(n));
  for (const f of files) {
    const s = read(f);
    const nav = s.match(/src="admin-nav\.js\?v=(\d+)"/);
    if (nav) assert.equal(nav[1], '31', `${f} loads admin-nav.js v31`);
    const sh = s.match(/src="admin-shell\.js\?v=(\d+)"/);
    if (sh) assert.equal(sh[1], '4', `${f} loads admin-shell.js v4`);
  }
  for (const f of SUPPORT_PAGES) { assert.match(read(f), /admin-nav\.js\?v=31/, f); assert.match(read(f), /admin-shell\.js\?v=4/, f); }
  assert.match(read('admin-nav.js'), /admin-nav\.js\?v=31/);
});

test('HELP VIDEO G3: the staff video button is on the Inbox and on the Errors page it also walks through', () => {
  const g3 = JSON.parse(read('docs/training-videos/video-watch.json')).videos
    ? JSON.parse(read('docs/training-videos/video-watch.json')).videos.G3
    : JSON.parse(read('docs/training-videos/video-watch.json')).G3;
  assert.ok(g3.includes('admin-support-errors.html'), 'video-watch.json lists the Errors page for G3');
  assert.match(read('admin-support-errors.html'), /help-videos\.js\?v=16/);
});
