// The thin, dismissible "new release note" banner (release-banner.js): shows the newest PUBLISHED note for 30 days, links straight to it,
// stays dismissed per note, comes back for the next note, never shows a draft, and stays off the release notes page. Runs the real script
// against a tiny fake browser, plus checks of the wiring (which pages load it, the shared ?v=N).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SOURCE = read('release-banner.js');

// notes: newest first, as release-notes.js keeps them. today: 'YYYY-MM-DD'. Returns what the page ended up with.
function browser({ notes, today = '2026-11-09', pathname = '/index.html', saved = null, storageBlocked = false, loadsNotes = false }) {
  const store = {};
  if (saved) store.fn_release_banner_dismissed = saved;
  const makeEl = (tag) => {
    const el = { tag, children: [], attrs: {}, listeners: {}, style: {}, textContent: '', className: '', parentNode: null };
    el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
    el.setAttribute = (k, v) => { el.attrs[k] = v; };
    el.addEventListener = (n, fn) => { el.listeners[n] = fn; };
    return el;
  };
  const body = makeEl('body');
  body.insertBefore = (c, ref) => { c.parentNode = body; body.children.unshift(c); };
  body.removeChild = (c) => { body.children = body.children.filter((x) => x !== c); c.parentNode = null; };
  const head = makeEl('head');
  const [y, m, d] = today.split('-').map(Number);
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(y, m - 1, d, 12, 0, 0); } }
  const winNotes = { visible: (preview) => notes.filter((n) => preview || n.published) };
  const ctx = {
    window: loadsNotes ? {} : { FNReleaseNotes: winNotes },
    location: { pathname },
    document: { body, head, createElement: makeEl, addEventListener: () => {} },
    localStorage: storageBlocked ? { setItem() { throw new Error('blocked'); }, removeItem() {}, getItem() { throw new Error('blocked'); } }
      : { setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; }, getItem: (k) => (k in store ? store[k] : null) },
    sessionStorage: { setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; }, getItem: (k) => (k in store ? store[k] : null) },
    encodeURIComponent, Date: FakeDate, Math, Number,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  if (loadsNotes) { // the script asked for release-notes.js; deliver it
    const s = head.children.find((c) => c.tag === 'script');
    ctx.window.FNReleaseNotes = winNotes;
    if (s && s.onload) s.onload();
    ctx.requested = s && s.src;
  }
  const bar = body.children.find((c) => c.className === 'fn-rb');
  return { bar, store, body, head, ctx, link: bar && bar.children.find((c) => c.tag === 'a'), close: bar && bar.children.find((c) => c.tag === 'button'), text: bar && bar.children[0].textContent };
}
const note = (id, date, published = true, title = id) => ({ id, date, published, title });

test('shows the newest published note, with a link straight to it and a dismiss button', () => {
  const b = browser({ notes: [note('my-graduate-portrait', '2026-11-08', true, 'My Graduate Portrait'), note('older', '2026-11-07')] });
  assert.ok(b.bar, 'the banner is on the page');
  assert.equal(b.text, 'New: My Graduate Portrait.');
  assert.equal(b.link.href, 'release-notes.html?note=my-graduate-portrait');
  assert.equal(b.link.textContent, 'Read the release note');
  assert.equal(b.close.attrs['aria-label'], 'Dismiss this message');
  assert.equal(b.bar.attrs.role, 'region');
  assert.equal(b.body.children[0], b.bar, 'it is the first thing on the page');
});

test('a draft is never announced: the newest PUBLISHED note is used', () => {
  const b = browser({ notes: [note('draft-one', '2026-11-08', false, 'Draft'), note('live-one', '2026-11-07', true, 'Live')] });
  assert.equal(b.link.href, 'release-notes.html?note=live-one');
  assert.ok(!browser({ notes: [note('only-draft', '2026-11-08', false)] }).bar, 'only drafts: no banner');
  assert.ok(!browser({ notes: [] }).bar);
});

test('dismissing removes it, remembers that note, and keeps it away on later visits', () => {
  const notes = [note('a', '2026-11-08')];
  const first = browser({ notes });
  first.close.listeners.click();
  assert.equal(first.body.children.length, 0, 'removed from the page');
  assert.equal(first.store.fn_release_banner_dismissed, 'a');
  assert.ok(!browser({ notes, saved: 'a' }).bar, 'stays away');
});

test('the NEXT note brings the banner back for someone who dismissed the last one', () => {
  const b = browser({ notes: [note('b', '2026-11-09', true, 'Newer'), note('a', '2026-11-08')], saved: 'a' });
  assert.ok(b.bar);
  assert.equal(b.link.href, 'release-notes.html?note=b');
});

test('only for 30 days after the note\'s date; a bad date shows nothing; the day itself and a future date do show', () => {
  assert.ok(browser({ notes: [note('a', '2026-10-10')], today: '2026-11-09' }).bar, '30 days old still shows');
  assert.ok(!browser({ notes: [note('a', '2026-10-09')], today: '2026-11-09' }).bar, '31 days old does not');
  assert.ok(browser({ notes: [note('a', '2026-11-09')], today: '2026-11-09' }).bar, 'the day it was published');
  assert.ok(browser({ notes: [note('a', '2026-11-10')], today: '2026-11-09' }).bar, 'a note dated tomorrow (time zones) still shows');
  assert.ok(!browser({ notes: [note('a', 'banana')] }).bar);
});

test('not on the release notes page itself', () => {
  assert.ok(!browser({ notes: [note('a', '2026-11-08')], pathname: '/release-notes.html' }).bar);
  assert.ok(browser({ notes: [note('a', '2026-11-08')], pathname: '/pricing.html' }).bar);
});

test('works when storage is blocked (private browsing): it still shows, and dismissing still removes it for this visit', () => {
  const b = browser({ notes: [note('a', '2026-11-08')], storageBlocked: true });
  assert.ok(b.bar);
  b.close.listeners.click();
  assert.equal(b.body.children.length, 0);
});

test('loads the notes itself when the page has not (the normal case) and asks for the same file the notes page uses', () => {
  const b = browser({ notes: [note('a', '2026-11-08', true, 'Loaded')], loadsNotes: true });
  assert.ok(b.bar, 'shown once the notes arrive');
  const asked = b.head.children.find((c) => c.tag === 'script').src;
  assert.equal(asked, `release-notes.js?v=${read('release-notes.html').match(/release-notes\.js\?v=(\d+)/)[1]}`, 'same ?v=N as release-notes.html, so the browser reuses one cached copy');
});

test('the note\'s words go in as text, never as markup', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(SOURCE), 'no HTML injection');
  assert.equal(browser({ notes: [note('a', '2026-11-08', true, '<img src=x onerror=alert(1)>')] }).text, 'New: <img src=x onerror=alert(1)>.');
});

test('WIRING: public pages and the school and district portals load it; students, the staff admin and the notes page itself do not', () => {
  for (const f of ['nav.js', 'school-admin-nav.js', 'district-admin-nav.js']) assert.match(read(f), /release-banner\.js\?v=\d+/, `${f} loads the banner`);
  assert.ok(!/release-banner/.test(read('admin-nav.js')), 'the staff admin pages do not');
  for (const f of ['student-home.html', 'student-portrait.html', 'student-lesson.html', 'student-game.html', 'student-login.html', 'student-achievements.html', 'portrait-keepsake.html']) {
    assert.ok(!/(^|[^-a-z])nav\.js/.test(read(f)), `${f} does not load nav.js, so children never see the banner`);
  }
  assert.match(SOURCE, /@media print\{\.fn-rb\{display:none;\}\}/, 'hidden when printing');
});
