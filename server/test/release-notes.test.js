// Release notes pages (release-notes.html + release-notes.js): the customer-facing record of what changed. Checks that every note is
// complete and honest, that drafts stay hidden from visitors, that the claim language for Graduate Evidence never slips into
// "mastery" or "growth", that the footer links to the page, and that every help video a note names exists.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function load(file) {
  const ctx = { window: {}, document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({ style: {} }) }, location: { search: '', pathname: '/release-notes.html', href: '', hash: '' }, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx);
  return ctx;
}
const RN = load('release-notes.js').FNReleaseNotes;
const videos = load('help-videos.js').FNHelpVideos;

const allText = (n) => [n.title, n.summary, n.overview, n.where,
  ...Object.values(n.sections).flat().flatMap((x) => (typeof x === 'string' ? [x] : [x.title, x.body]))].join(' ');

test('every note is complete: unique id, a real date, known audiences, a summary, and at least one section with content', () => {
  assert.ok(RN.notes.length >= 5);
  const ids = new Set();
  for (const n of RN.notes) {
    assert.match(n.id, /^[a-z0-9-]+$/, `${n.id}: id is a url-safe slug`);
    assert.ok(!ids.has(n.id), `${n.id} is unique`); ids.add(n.id);
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, `${n.id}: date`);
    assert.ok(!Number.isNaN(Date.parse(n.date)), `${n.id}: date is real`);
    assert.ok(n.title && n.summary && n.overview, `${n.id}: title, summary and overview`);
    assert.ok(n.audiences.length && n.audiences.every((a) => RN.audiences.some((x) => x.id === a)), `${n.id}: audiences are known`);
    const filled = ['new', 'changed', 'fixed', 'know'].filter((k) => (n.sections[k] || []).length);
    assert.ok(filled.length, `${n.id}: has something to say`);
    for (const k of ['new', 'changed', 'fixed']) for (const it of n.sections[k] || []) {
      assert.ok(it.title && it.body, `${n.id}: every item has a title and a body`);
      assert.ok(it.who.length && it.who.every((a) => RN.audiences.some((x) => x.id === a)), `${n.id}: item audiences are known`);
    }
  }
});

test('notes are newest first, so the index and the month groups read in order', () => {
  const dates = RN.notes.map((n) => n.date);
  assert.equal(JSON.stringify(dates), JSON.stringify([...dates].sort().reverse()));
  const groups = RN.byMonth(RN.visible(true));
  assert.equal(groups[0].month, 'November 2026');
  assert.equal(groups.flatMap((g) => g.notes).length, RN.notes.length);
});

test('DRAFTS: a note not marked published is hidden from visitors and shown only in preview; privacy wording starts as a draft', () => {
  assert.ok(RN.visible(false).every((n) => n.published));
  assert.equal(RN.visible(true).length, RN.notes.length);
  assert.ok(RN.visible(true).length > RN.visible(false).length, 'there is at least one draft waiting for the owner');
  const retention = RN.byId('student-data-kept');
  assert.ok(retention && !retention.published, 'the student data note stays a draft until the owner has read it');
  assert.equal(RN.byId('no-such-note'), null);
});

test('audience filter keeps the notes that matter to that audience', () => {
  const all = RN.visible(true);
  assert.equal(RN.forAudience(all, 'everyone').length, all.length);
  assert.ok(RN.forAudience(all, 'district').every((n) => n.audiences.includes('district')));
  assert.ok(RN.forAudience(all, 'families').length > 0);
});

test('CLAIM LANGUAGE: Graduate Evidence says evidence of practice, never mastery, growth, proficiency, achievement or a score', () => {
  const ge = allText(RN.byId('graduate-evidence'));
  assert.match(ge, /evidence of practice/);
  assert.ok(!/mastery|mastered|proficien|achiev|\bgrowth\b|\bscores?\b|outcomes?/i.test(ge), 'no assessment words');
  assert.match(ge, /Neither New York State nor CASEL has endorsed/);
});

test('plain wording: no dashes used as punctuation, no placeholder text, and no internal file names in what customers read', () => {
  for (const n of RN.notes) {
    const t = allText(n);
    assert.ok(!/[–—]/.test(t), `${n.id}: no en or em dashes`);
    assert.ok(!/TODO|lorem|\{\w+\}/i.test(t), `${n.id}: no placeholders`);
    assert.ok(!/\.(js|ts|sql)\b|server\/|CHANGELOG|alter-|seed-/.test(t), `${n.id}: nothing internal`);
  }
});

test('help videos named by a note exist in help-videos.js (they show only once published)', () => {
  const ids = new Set(videos.videos.map((v) => v.id));
  for (const n of RN.notes) for (const v of n.videos) assert.ok(ids.has(v), `${n.id}: video ${v} exists`);
});

test('PAGE: release-notes.html loads the shared scripts, shows only published notes by default and links back to Help', () => {
  const page = read('release-notes.html');
  for (const s of ['footer.js', 'nav.js', 'release-notes.js', 'help-videos.js']) assert.match(page, new RegExp(s.replace('.', '\\.') + '\\?v='), `${s} is loaded`);
  assert.match(page, /RN\.visible\(preview\)/);
  assert.match(page, /get\('preview'\) === '1'/);
  assert.match(page, /href="help\.html"/);
  assert.match(page, /href="support\.html"/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)[^"']*\.(js|css)/.test(page), 'no script or style from another site');
});

test('FOOTER: every public page gets the Release notes link from footer.js, and no page still loads an older footer', () => {
  assert.match(read('footer.js'), /<a href="release-notes\.html">Release notes<\/a>/);
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const stale = pages.filter((f) => /footer\.js\?v=(\d+)/.test(read(f)) && !/footer\.js\?v=18/.test(read(f)));
  assert.deepEqual(stale, [], 'every page loads footer.js v18');
});
