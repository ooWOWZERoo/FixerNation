// Admin navigation: (1) Customer Hub and Support buttons in the top bar right after the page search; (2) the side menu keeps the link you just clicked where you can see it, instead of
// restoring a scroll position measured with the Customer Hub group showing while that group was still hidden. Source-level checks plus a simulation of the scroll logic
// (the real layout needs a browser). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('THE TOP BAR: a Customer Hub button and a Support button are added right after the page search; the Hub one follows the Hub being on for this person; the current area is marked', () => {
  const shell = read('admin-shell.js');
  const search = shell.indexOf('searchWrap.append(search, results, status); tools.after(searchWrap);'), quick = shell.indexOf("quick.className = 'mc-quick'");
  assert.ok(search > 0 && quick > search, 'the buttons are made right after the search box is placed');
  assert.match(shell, /searchWrap\.after\(quick\)/);
  assert.match(shell, /quickLink\('admin-crm-overview\.html', 'Customer Hub', inHub\)/); assert.match(shell, /quickLink\('admin-support\.html', 'Support', inSupport\)/);
  assert.match(shell, /hubBtn\.hidden = !window\.__fnCrmOn/); assert.match(shell, /addEventListener\('fn-crm-nav'/);
  assert.match(shell, /key\.indexOf\('crm-'\) === 0/); for (const k of ['support', 'account-lookup', 'support-classrooms', 'support-errors', 'support-help']) assert.ok(shell.includes(`'${k}'`), k);
  assert.match(shell, /textContent = text/, 'text, never markup');
  const css = read('admin-common.css');
  for (const rule of ['.mc-quick{', '.mc-quick a{', '.mc-quick a:hover', '.mc-quick a[aria-current="true"]', '.mc-quick a[hidden]{display:none;}']) assert.ok(css.includes(rule), rule);
  assert.doesNotMatch(css, /\.mc-page-search\{[^}]*margin-right:auto/, 'the space to the right now belongs to the buttons, so they sit next to the search');
  assert.match(css, /\.mc-quick\{[^}]*margin-right:auto/); assert.match(css, /@media\(max-width:760px\)\{\.mc-quick\{display:none;\}\}/);
  assert.match(css, /\.mc-quick a\[aria-current="true"\]\{background:var\(--a-accent-soft\)/, 'readable in light and dark: no white text on the dark-mode accent');
});

test('THE NAV TELLS THE SHELL: admin-nav.js announces whether the Customer Hub is on, so the Hub button never shows for a role that cannot use it', () => {
  const nav = strip(read('admin-nav.js'));
  const fn = nav.slice(nav.indexOf('function showCrmNav'), nav.indexOf("fetch('/api/crm/me'"));
  assert.match(fn, /window\.__fnCrmOn = !!perms/); assert.match(fn, /dispatchEvent\(new CustomEvent\('fn-crm-nav'/);
  assert.match(nav, /\.catch\(function \(\) \{ showCrmNav\(null\); \}\)/, 'a failure hides it');
});

test('NO JUMP IN THE SIDE MENU: the saved position is applied after the Customer Hub group is shown, an old answer is used at once, the group never shifts the link under you, and the link is kept in view', () => {
  const nav = strip(read('admin-nav.js'));
  assert.doesNotMatch(nav, /navEl\.scrollTop = savedScroll/, 'it was applied before the group was shown');
  assert.doesNotMatch(nav, /Date\.now\(\) - cachedCrm\.at < 300000/, 'a five-minute limit made the group pop in on the first page after each pause');
  const start = nav.indexOf('if (window.fetch) {\n    var cachedCrm');
  const body = nav.slice(start, nav.indexOf("fetch('/api/crm/me'", start));
  assert.ok(body.indexOf('showCrmNav(cachedCrm.perms)') > 0 && body.indexOf('restoreNavScroll();') > body.indexOf('showCrmNav(cachedCrm.perms)'), 'restore comes after the group has been shown');
  assert.match(body, /keepActiveVisible\(\);/);
  assert.match(nav, /\} else \{ restoreNavScroll\(\); keepActiveVisible\(\); \}/, 'a browser without fetch still restores it');
  const fn = nav.slice(nav.indexOf('function showCrmNav'), nav.indexOf("fetch('/api/crm/me'"));
  assert.match(fn, /navEl\.scrollTop \+= link\.getBoundingClientRect\(\)\.top - before/, 'the link stays where it was when the group appears above it');
  assert.match(fn, /wasHidden !== group\.hidden/, 'only when the group really appeared or went');
  for (const fnName of ['restoreNavScroll', 'activeLink', 'keepActiveVisible']) assert.match(nav, new RegExp(`function ${fnName}\\(`), fnName);
});

// ---- the scroll logic, run for real against a tiny fake of the menu -------------------------------------------------------------------
// Rows are 30px tall in a 300px window. Above the Customer Hub group (hidden or 12 rows tall) there are 3 rows; the page's own link is far below.
function runNav({ cache, savedScroll, hubOnAnswer, active = 'support' }) {
  const rows = [...Array.from({ length: 3 }, (_, i) => ({ id: `top${i}` })), { id: 'hub', hub: true }, ...Array.from({ length: 9 }, (_, i) => ({ id: `mid${i}` })), { id: 'support' }, ...Array.from({ length: 6 }, (_, i) => ({ id: `end${i}` }))];
  const state = { hubHidden: true, scrollTop: 0, scrolls: [] };
  const H = 30, WINDOW = 300;
  const rowsShown = () => rows.flatMap(r => (r.hub ? (state.hubHidden ? [] : Array.from({ length: 12 }, () => ({ id: 'hubrow' }))) : [r]));
  const total = () => rowsShown().length * H, maxScroll = () => Math.max(0, total() - WINDOW);
  const topOf = (id) => rowsShown().findIndex(r => r.id === id) * H - state.scrollTop;
  const navEl = {
    get scrollTop() { return state.scrollTop; },
    set scrollTop(v) { state.scrollTop = Math.min(Math.max(0, v), maxScroll()); },
    addEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: WINDOW }),
    querySelector: (sel) => (sel === 'a.active' ? link : null),
  };
  const link = {
    getClientRects: () => (rowsShown().some(r => r.id === active) ? [1] : []),
    getBoundingClientRect: () => ({ top: topOf(active), bottom: topOf(active) + H }),
    scrollIntoView() { state.scrollTop = Math.min(Math.max(0, rowsShown().findIndex(r => r.id === active) * H - (WINDOW - H)), maxScroll()); state.scrolls.push('into view'); },
  };
  const group = { get hidden() { return state.hubHidden; }, set hidden(v) { state.hubHidden = v; }, querySelectorAll: () => [] };
  const aside = { querySelector: (sel) => (sel === '[data-crm-nav]' ? group : sel === '.a-nav' ? navEl : null), querySelectorAll: () => [], innerHTML: '' };
  let resolveFetch;
  const store = { fnAdminNavScrollTop: savedScroll === undefined ? null : String(savedScroll), fnCrmNav: cache ? JSON.stringify({ at: 1, perms: { edit_settings: true } }) : null };
  const ctx = {
    document: { querySelector: (s) => (s === '.a-sidebar' ? aside : null), querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({}), getElementById: () => null },
    window: { location: { pathname: '/admin-support.html' }, fetch: true, dispatchEvent() {}, __fnErrorCapture: true },
    sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { store[k] = null; } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CustomEvent: function () {}, Date, JSON, parseInt, isNaN, console,
    fetch: (url) => (/crm\/me/.test(url) ? new Promise((r) => { resolveFetch = () => r({ ok: true, json: async () => ({ permissions: { edit_settings: true } }) }); }) : Promise.resolve({ ok: false, json: async () => ({}) })),
  };
  ctx.window.fetch = ctx.fetch; ctx.window.sessionStorage = ctx.sessionStorage;
  return { state, ctx, navEl, link, group, rows, answer: () => resolveFetch && resolveFetch(), topOf, H, WINDOW };
}

test('THE SCROLL LOGIC, SIMULATED: with the group already shown from the last answer the link comes back where it was; when the group appears later the link does not move; a hidden-group page lands in view', async () => {
  const src = read('admin-nav.js');
  const fnSrc = (name) => { const i = src.indexOf(`function ${name}(`); let depth = 0, j = src.indexOf('{', i); const start = i; for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); } } };
  // Build the three helpers and showCrmNav from the real file and run them against the fake menu.
  const make = (opts) => {
    const w = runNav(opts);
    const code = ['restoreNavScroll', 'activeLink', 'keepActiveVisible', 'showCrmNav'].map(fnSrc).join('\n') + '\nthis.__api = { showCrmNav, restoreNavScroll, keepActiveVisible };';
    const c = { ...w.ctx, SCROLL_KEY: 'fnAdminNavScrollTop', navEl: w.navEl, aside: { querySelector: () => w.group } };
    vm.createContext(c);
    vm.runInContext(`var SCROLL_KEY='fnAdminNavScrollTop';var navEl=this.navEl;var aside=this.aside;${code}`, c);
    return { w, api: c.__api };
  };
  // A: the group was showing on the last page, and the menu had been scrolled to 500 (Support, below the group, was at 220 in the window). Applying that BEFORE showing the group clamps it to the shorter menu.
  let { w, api } = make({ cache: true, savedScroll: 500 });
  w.navEl.scrollTop = 500; assert.equal(w.state.scrollTop, 270, 'with the group hidden the menu is too short to scroll that far: it stops at 270, not 500 (this is the old bug)');
  api.showCrmNav({ edit_settings: true });                  // the group is shown from the remembered answer
  api.restoreNavScroll(); api.keepActiveVisible();           // then the saved position is applied
  assert.equal(w.state.scrollTop, 500); assert.equal(w.topOf('support'), 220, 'the link is exactly where it was when clicked'); assert.ok(w.topOf('support') >= 0 && w.topOf('support') + w.H <= w.WINDOW, 'the link is in the window');
  // B: no remembered answer; the page opens with the group hidden and the answer arrives later. The link keeps its place on screen when the group appears above it.
  ({ w, api } = make({ cache: false }));
  w.navEl.scrollTop = 40; const before = w.topOf('support');
  api.showCrmNav({ edit_settings: true });
  assert.equal(w.topOf('support'), before, 'nothing moved under the pointer');
  // C: the group goes away (role lowered): same promise.
  const mid = w.topOf('support'); api.showCrmNav(null); assert.equal(w.topOf('support'), mid);
  // D: a link that would be off screen is brought into view.
  ({ w, api } = make({ cache: true }));
  api.showCrmNav({ edit_settings: true }); w.navEl.scrollTop = 0; assert.ok(w.topOf('support') + w.H > w.WINDOW, 'it starts off screen');
  api.keepActiveVisible(); assert.ok(w.topOf('support') >= 0 && w.topOf('support') + w.H <= w.WINDOW, 'now in view');
});

test('VERSIONS: admin-common.css v23, admin-nav.js v41 and admin-shell.js v13 on every admin page that loads them, and the notes say so', () => {
  const pages = fs.readdirSync(ROOT).filter(f => /^admin-.*\.html$/.test(f)); // (the school and district portals have their own nav and styles)
  let n = 0;
  for (const f of pages) {
    const html = read(f);
    if (/src="admin-nav\.js\?v=/.test(html)) { n++; assert.match(html, /src="admin-nav\.js\?v=41"/, f); }
    if (/src="admin-shell\.js\?v=/.test(html)) assert.match(html, /src="admin-shell\.js\?v=13"/, f);
    if (/admin-common\.css\?v=/.test(html)) assert.match(html, /admin-common\.css\?v=23/, f);
  }
  assert.ok(n > 40, `${n} pages load the nav`);
  assert.match(read('CLAUDE.md'), /admin-common\.css v23, admin-nav\.js v41, admin-shell\.js v13/);
  for (const f of ['admin-nav.js', 'admin-shell.js']) assert.doesNotThrow(() => new vm.Script(read(f)), f);
});
