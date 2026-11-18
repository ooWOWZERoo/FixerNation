// Sales CRM phase 2: the screens' wiring (nav group, page set, shared scripts, cache versions, escaping rules, vocabulary, the old contacts page).
// These are static checks over the files; the routes behind the screens are tested in crm-routes and crm-phase2, and the screens themselves are driven
// by tests/e2e/admin-crm-smoke.spec.ts on the local stack. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['overview', 'attention', 'tasks', 'accounts', 'account', 'contacts', 'contact', 'opportunities', 'opportunity', 'reports', 'settings'].map(k => `admin-crm-${k}.html`);
// Pages that draw the phase 3 panels (tasks, notes, files, meetings, checklist, timeline) load crm-panels.js after crm-common.js.
const PANEL_PAGES = ['opportunity', 'account', 'contact'].map(k => `admin-crm-${k}.html`);

test('PAGES: all eleven Customer Hub pages exist and load the shared admin assets at the current versions', () => {
  for (const f of PAGES) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
    const html = read(f);
    assert.match(html, /<aside class="a-sidebar"><\/aside>\s*<script src="admin-nav\.js\?v=39"><\/script>/, f);
    assert.match(html, /admin-common\.css\?v=22/, f);
    assert.match(html, /admin-common\.js\?v=17/, f);
    assert.match(html, /admin-shell\.js\?v=12/, f);
    assert.match(html, /crm-common\.css\?v=3/, f);
    assert.match(html, /crm-common\.js\?v=2/, f);
    assert.match(html, /<meta name="robots" content="noindex">/, `${f} is not for search engines`);
    assert.doesNotMatch(html, /fonts\.googleapis|cdn\.|unpkg|jsdelivr|cdnjs/i, `${f} loads nothing from a CDN`);
  }
});

test('VERSIONS: every admin page that loads the nav or the shell loads the current version, so none is left on an old copy', () => {
  const pages = fs.readdirSync(ROOT).filter(f => /^admin-.*\.html$/.test(f));
  assert.ok(pages.length > 25);
  for (const f of pages) {
    const html = read(f);
    if (/admin-nav\.js\?v=/.test(html)) assert.match(html, /admin-nav\.js\?v=39/, f);
    if (/admin-shell\.js\?v=/.test(html)) assert.match(html, /admin-shell\.js\?v=12/, f);
  }
});

test('NAV: one Customer Hub group, hidden until /api/crm/me answers, with Settings shown only to a role that may edit them', () => {
  const nav = read('admin-nav.js');
  const group = nav.slice(nav.indexOf("{ key: 'customer-hub'"), nav.indexOf("{ key: 'support'"));
  const hrefs = [...group.matchAll(/link\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(hrefs, ['admin-crm-overview.html', 'admin-crm-attention.html', 'admin-crm-tasks.html', 'admin-crm-calendar.html', 'admin-crm-accounts.html', 'admin-crm-contacts.html', 'admin-crm-opportunities.html', 'admin-crm-customers.html', 'admin-crm-reports.html', 'admin-crm-refunds.html', 'admin-crm-repeat-requests.html', 'admin-crm-settings.html']);
  assert.match(group, /admin-crm-settings\.html'[^)]*data-crm-perm="edit_settings"/);
  assert.match(nav, /fetch\('\/api\/crm\/me'/);
  assert.match(nav, /hiddenAttr = s\.crm \? ' hidden data-crm-nav="1"'/, 'the group starts hidden');
  assert.match(nav, /showCrmNav\(null\)/, 'any failure leaves it hidden');
  for (const k of ['crm-overview', 'crm-attention', 'crm-tasks', 'crm-calendar', 'crm-accounts', 'crm-contacts', 'crm-opportunities', 'crm-customers', 'crm-reports', 'crm-refunds', 'crm-repeat-requests', 'crm-settings']) assert.ok(nav.includes(`"${k}": "<`), `icon for ${k}`);
  assert.match(nav, /'admin-crm-opportunity\.html':'admin-crm-opportunities\.html'/, 'a deal page lights up its list in the menu');
});

test('SHELL: every page has an introduction, and the page finder reads the menu when someone types, so a hidden group is never offered', () => {
  const shell = read('admin-shell.js');
  for (const k of ['crm-overview', 'crm-attention', 'crm-tasks', 'crm-accounts', 'crm-account', 'crm-contacts', 'crm-contact', 'crm-opportunities', 'crm-opportunity', 'crm-reports', 'crm-settings']) assert.ok(shell.includes(`'${k}': [`), k);
  assert.match(shell, /function pageLinks\(\)/);
  assert.match(shell, /!a\.closest\('\[hidden\]'\)/);
});

test('ESCAPING: no inline handler and no data interpolated into one; every page goes through the shared escaper', () => {
  for (const f of [...PAGES, 'crm-common.js', 'crm-panels.js']) {
    const body = read(f).replace('onclick="fnToggleTheme()"', ''); // the shared theme switch is the one static handler every admin page has
    assert.doesNotMatch(body, /\son(click|change|input|submit|keydown)\s*=\s*["'`]/i, `${f} uses addEventListener, not inline handlers`);
  }
  assert.match(read('crm-common.js'), /var esc = C\.esc = function \(v\) \{ return fnEscape\(v\); \}/);
  // Strings that come from the database never land in innerHTML without esc(): every API field the pages print is wrapped.
  for (const f of [...PAGES, 'crm-panels.js']) {
    const body = read(f);
    const raw = body.match(/\+\s*(o|d|q|c|a|m|p|s|e|r|x)\.(name|email|school|company|accountName|nextStep|notes|reason|title|description|source|competitor|productFocus|username|label)\s*\+/g) || [];
    assert.deepEqual(raw, [], `${f} prints a text field without esc(): ${raw.join(' | ')}`);
  }
});

test('WRITES: every change the pages send is a JSON write with a body (the proxy refuses an empty one)', () => {
  const c = read('crm-common.js');
  assert.match(c, /if \(method !== 'GET'\) opts\.body = JSON\.stringify\(body \|\| \{\}\)/);
  assert.match(c, /'Content-Type': 'application\/json'/);
  for (const f of [...PAGES, 'crm-panels.js']) assert.doesNotMatch(read(f), /\bfetch\(/, `${f} goes through FnCrm.api or FnCrm.upload, not a bare fetch`);
  assert.match(c, /C\.upload = function \(url, formData\)[\s\S]*?method: 'POST', credentials: 'include', body: formData/, 'the one multipart write is FnCrm.upload');
});

test('VOCABULARY: the screens only ever say Suspect, Prospect and Customer', () => {
  for (const f of [...PAGES, 'crm-common.js', 'crm-panels.js', 'crm-common.css']) {
    assert.doesNotMatch(read(f), /\b(hot|warm|cold)\b\s*(lead|label|prospect|contact|deal)|'(hot|warm|cold)'|"(hot|warm|cold)"/i, f);
  }
  assert.match(read('crm-common.js'), /CLASS_LABEL = \{ suspect: 'Suspect', prospect: 'Prospect', customer: 'Customer' \}/);
});

test('OLD CONTACTS PAGE: gets the label column and filter only while the Customer Hub is on, and does not touch the subscription Status', () => {
  const html = read('admin-newsletter.html');
  assert.match(html, /id="filterClass"[^>]*style="display:none;"/, 'the filter starts hidden');
  assert.match(html, /fetch\('\/api\/crm\/me'/);
  assert.match(html, /filterClass && \(c\.crmClassification \|\| 'suspect'\) !== filterClass/);
  assert.match(html, /status: `<td><span class="a-pill \$\{subscribed \? 'a-pill-success' : 'a-pill-neutral'\}">/, 'the Status column is unchanged');
  assert.doesNotMatch(html, /\b(hot|warm|cold)\b\s*(lead|label)/i);
  const route = read('server/routes/newsletter.js');
  assert.match(route, /crmClassification: row\.crm_classification \|\| null/);
});

test('NO CDN OR RUNTIME TEXT-TO-SPEECH in the new files', () => {
  for (const f of [...PAGES, 'crm-common.js', 'crm-panels.js']) assert.doesNotMatch(read(f), /speechSynthesis|https?:\/\/(?!localhost)/i, f);
});

test('SYNTAX: the shared admin scripts parse (one stray apostrophe in a page intro would silently switch the whole admin shell off)', () => {
  for (const f of ['admin-shell.js', 'admin-nav.js', 'crm-common.js', 'crm-panels.js']) assert.doesNotThrow(() => new Function(read(f)), f);
  for (const f of PAGES) {
    const scripts = [...read(f).matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(b => b.trim().length > 200);
    assert.ok(scripts.length >= 1, `${f} has its page script`);
    for (const b of scripts) assert.doesNotThrow(() => new Function(b), f);
  }
});

test('PANELS (phase 3): the three record pages load crm-panels.js after crm-common.js, and each panel is drawn from there', () => {
  for (const f of PANEL_PAGES) {
    const html = read(f);
    assert.match(html, /crm-common\.js\?v=2"><\/script>\s*<script src="crm-panels\.js\?v=3"><\/script>/, f);
    for (const p of ['tasks', 'notes', 'files', 'meetings', 'timeline']) assert.match(html, new RegExp(`FnCrmPanels\\.${p}\\(`), `${f} draws the ${p} panel`);
  }
  assert.match(read('admin-crm-opportunity.html'), /FnCrmPanels\.checklist\(/, 'only a deal has a procurement checklist');
  const panels = read('crm-panels.js');
  for (const fn of ['tasks', 'notes', 'files', 'meetings', 'checklist', 'timeline']) assert.match(panels, new RegExp(`P\\.${fn} = function`));
  assert.match(panels, /function safeLink\(href\) \{ return \/\^admin-crm-\[a-z\]\+\\\.html/, 'a timeline link is only ever one of our own pages');
  assert.doesNotMatch(panels, /\bviewed\b/i, 'the screens never claim a quote was viewed');
});

test('FILES UI: downloads are plain links to the authenticated route, and Read-only is told why there is nothing to open', () => {
  const panels = read('crm-panels.js');
  assert.match(panels, /href="\/api\/crm\/files\/' \+ esc\(f\.id\) \+ '\/download" download/);
  assert.doesNotMatch(panels, /\/uploads\//, 'no file is ever linked by a public path');
  assert.doesNotMatch(panels, /<iframe|<embed|<object/i, 'files are downloads, never shown inside the page');
  assert.match(panels, /if \(!C\.can\('files'\)\)/);
});

test('UPLOAD: only the files panel may send a multipart body, and it names the record first so the server has it before the file arrives', () => {
  const panels = read('crm-panels.js');
  assert.match(panels, /fd\.append\(KEY\[s\.kind\], s\.id\);[^\n]*\n\s*fd\.append\('file'/);
});
