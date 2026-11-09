// Release 165: the pages that show favorites are wired the same safe way: the script loads before the page script that uses it, the
// sign-in box exists on every page that can open it, stars go on the right cards, students never see stars on the games page,
// database text is escaped, the menu link opens My Favorites, and every inline script parses (a stray apostrophe once blanked a page).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAGES = ['education-portal.html', 'lesson-detail.html', 'teacher-lesson-plans-browse.html', 'brain-games.html', 'game.html', 'my-favorites.html'];

test('EVERY PAGE: favorites.js loads once, before the page script that calls it, and every inline script parses', () => {
  for (const f of PAGES) {
    const html = read(f);
    assert.equal((html.match(/<script src="favorites\.js\?v=1"><\/script>/g) || []).length, 1, `${f} loads favorites.js once`);
    const at = html.indexOf('favorites.js?v=1');
    const uses = html.indexOf('FnFav.createStore');
    assert.ok(uses > at, `${f}: favorites.js comes before the first use`);
    // the inline script that uses FnFav must come after the script tag
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(inline.length >= 1);
    for (const m of inline) assert.doesNotThrow(() => new vm.Script(m[1]), `${f} inline script parses`);
    const withFav = inline.find((m) => m[1].includes('FnFav.createStore'));
    assert.ok(withFav && html.indexOf(withFav[0]) > at, `${f}: the script that uses FnFav is after the favorites.js tag`);
    assert.ok(!/fonts\.googleapis|cdn\./i.test(html), `${f}: no third-party font or CDN`);
  }
});

test('SIGN-IN BOX: any page that can open it carries the sign-in markup', () => {
  for (const f of PAGES.filter((p) => p !== 'teacher-lesson-plans-browse.html')) {
    const html = read(f);
    if (html.includes("fnAuthOpenModal('login')")) assert.match(html, /id="fnAuthModalOverlay"/, `${f} has the sign-in box`);
  }
});

test('STARS: each page puts the right kind on the right cards', () => {
  const edu = read('education-portal.html');
  assert.equal((edu.match(/\$\{lessonStar\(c\)\}/g) || []).length, 2, 'locked and open lesson cards both get a star');
  assert.match(edu, /FnFav\.starHtml\('lessons', c, favStore\.isFav\('lessons', c\.id\), 'icon'\)/);
  assert.match(read('lesson-detail.html'), /FnFav\.starHtml\('lessons', favLesson, favStore\.isFav\('lessons', favLesson\.id\), 'text'\)/);
  assert.match(read('teacher-lesson-plans-browse.html'), /FnFav\.starHtml\('lessons', c, favStore\.isFav\('lessons', c\.id\), 'text'\)/);
  const hub = read('brain-games.html');
  assert.match(hub, /FnFav\.starHtml\('games', g, favStore\.isFav\('games', g\.id\), 'icon'\)/);
  assert.match(hub, /\$\{gameStar\(g\)\}/);
  assert.match(read('game.html'), /FnFav\.starHtml\('games', favGame, favStore\.isFav\('games', favGame\.id\), 'text'\)/);
});

test('STUDENTS: the games page does not start favorites for a student session', () => {
  const hub = read('brain-games.html');
  assert.match(hub, /pd\.principalType !== 'student'\) startFavorites\(\)/);
  assert.match(read('server/routes/brain-games.js'), /principalType: principal\.type/);
});

test('SIGN-IN FLOW: pages reload stars on fn-auth-changed and save what was tapped before sign-in', () => {
  for (const f of ['education-portal.html', 'lesson-detail.html', 'brain-games.html', 'game.html']) {
    const html = read(f);
    assert.match(html, /fn-auth-changed/, `${f} listens for sign-in`);
    assert.match(html, /applyPending\(\)/, `${f} saves the pending tap`);
  }
  assert.match(read('my-favorites.html'), /addEventListener\('fn-auth-changed', load\)/);
});

test('FAVORITES.JS: the click handler runs in the capture phase so a star never also opens its card', () => {
  const js = read('favorites.js');
  assert.match(js, /\}, true\);\s*\n\s*\}\s*\n\s*var api/);
  assert.match(js, /e\.preventDefault\(\); e\.stopPropagation\(\)/);
  assert.match(js, /\/api\/blog-favorites\//, 'Morning Boost posts keep their own route');
});

test('MY FAVORITES: signed-out and error states, private page, escaped text, three catalogs, Undo on removal', () => {
  const html = read('my-favorites.html');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Sign in to see your favorites\./);
  assert.match(html, /Nothing saved yet\./);
  assert.match(html, /Your favorites didn't load\./);
  assert.match(html, /undoOnRemove: true/);
  for (const url of ['/api/curricula', '/api/brain-games', '/api/blog/posts']) assert.ok(html.includes(url), url);
  // starHtml escapes the title itself (checked in favorites-client.test.js), so that one call is left out of this scan
  const card = html.slice(html.indexOf('function cardHtml'), html.indexOf('function render()')).replace(/FnFav\.starHtml\([^\n]*\)/, '');
  for (const field of ['it.title', 'it.sub', 'it.desc', 'it.href', 'it.lockedText', 'it.icon']) {
    assert.ok(card.includes('esc(' + field + ')'), `${field} goes through esc() in cardHtml`);
    assert.ok(!new RegExp("\\+\\s*" + field.replace('.', '\\.') + "(?![A-Za-z])").test(card), `${field} is never added to the markup bare`);
  }
});

test('MENU AND VERSIONS: the signed-in menu opens My Favorites; site-auth is v12 on every page that loads it', () => {
  assert.match(read('site-auth.js'), /li\('my-favorites\.html', 'My Favorites'\)/);
  const stale = fs.readdirSync(ROOT).filter((n) => n.endsWith('.html')).filter((n) => /site-auth\.js\?v=(?!12")/.test(read(n)));
  assert.deepEqual(stale, []);
  assert.match(read('server/scripts/build-core-games.js'), /site-auth\.js\?v=12/, 'generated game pages carry the same version');
});
