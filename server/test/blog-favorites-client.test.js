// Release 91: the browser side of favorites (blog-favorites.js), run in Node with a fake fetch and fake storage.
// What must hold: signed-out stars ask for sign-in and remember the post; the star changes at once and goes back when the server
// refuses; every error has a plain message; a post tapped before sign-in is saved after it (once, and not for locked posts);
// the filter and count only look at posts on the page; markup is escaped and locked posts get no star.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fav = require(path.join(__dirname, '..', '..', 'blog-favorites.js'));

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const reply = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts, calls.length); };
  f.calls = calls; return f;
}
const POSTS = [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }, { id: 3, title: 'Three', locked: true }];

test('VIEW: the address wins, then the saved choice, then "all"', () => {
  assert.equal(fav.parseView('?view=favorites', 'all'), 'favorites');
  assert.equal(fav.parseView('?view=all', 'favorites'), 'all');
  assert.equal(fav.parseView('', 'favorites'), 'favorites');
  assert.equal(fav.parseView('?view=nonsense', null), 'all');
  assert.equal(fav.parseView('?post=abc', 'weird'), 'all');
});

test('FILTER AND COUNT: only posts on the page count, in the page order', () => {
  const ids = new Set([2, 99]);
  assert.deepEqual(fav.filterPosts(POSTS, ids, 'favorites').map((p) => p.id), [2]);
  assert.deepEqual(fav.filterPosts(POSTS, ids, 'all').map((p) => p.id), [1, 2, 3]);
  assert.equal(fav.countLive(POSTS, ids), 1, 'a favorite whose post is not on the page is not counted');
});

test('LOAD: 401 means signed out, 200 fills the set, a failure keeps what it had', async () => {
  let s = fav.createStore({ fetch: fakeFetch(() => reply(401, { error: 'Not logged in' })), storage: mem(), local: mem(), search: '' });
  await s.load(); assert.equal(s.signedIn, false); assert.equal(s.ids.size, 0);
  const f = fakeFetch(() => reply(200, { ids: [5, '7'] }));
  s = fav.createStore({ fetch: f, storage: mem(), local: mem(), search: '' });
  await s.load(); assert.equal(s.signedIn, true); assert.deepEqual([...s.ids], [5, 7]);
  assert.equal(f.calls[0].url, '/api/blog-favorites'); assert.equal(f.calls[0].opts.credentials, 'include');
  s.ids.add(9);
  s.signedIn = true;
  const s2 = fav.createStore({ fetch: async () => { throw new Error('offline'); }, storage: mem(), local: mem(), search: '' });
  s2.signedIn = true; s2.ids = new Set([1]);
  await s2.load(); assert.equal(s2.signedIn, true); assert.deepEqual([...s2.ids], [1], 'a network failure changes nothing');
});

test('SIGNED OUT: a star tap makes no request, asks for sign-in and remembers the post', async () => {
  const f = fakeFetch(() => reply(200, {}));
  const session = mem();
  const s = fav.createStore({ fetch: f, storage: session, local: mem(), search: '' });
  const r = await s.toggle(2);
  assert.equal(r.status, 'signin'); assert.equal(r.message, 'Sign in to save favorites.');
  assert.equal(f.calls.length, 0);
  assert.equal(s.pending(), 2);
});

test('SET: sends a PUT with a JSON body and credentials, and the star changes before the answer arrives', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const f = fakeFetch(async () => { await gate; return reply(200, { ok: true, favorited: true, count: 1 }); });
  const s = fav.createStore({ fetch: f, storage: mem(), local: mem(), search: '' });
  s.signedIn = true;
  const pending = s.toggle(2);
  assert.equal(s.isFav(2), true, 'optimistic');
  release();
  const r = await pending;
  assert.deepEqual([r.status, r.message], ['added', 'Saved to favorites.']);
  const call = f.calls[0];
  assert.equal(call.url, '/api/blog-favorites/2'); assert.equal(call.opts.method, 'PUT'); assert.equal(call.opts.credentials, 'include');
  assert.equal(call.opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.opts.body), { favorited: true });
  const r2 = await s.toggle(2);
  assert.deepEqual([r2.status, r2.message], ['removed', 'Removed from favorites.']);
  assert.deepEqual(JSON.parse(f.calls[1].opts.body), { favorited: false });
});

test('ERRORS: each refusal puts the star back and gives a plain message', async () => {
  const cases = [[403, null, "This post needs a license, so it can't be saved."], [404, null, 'That post is not available any more.'],
    [409, 'You can keep up to 500 favorites. Remove one to add another.', 'You can keep up to 500 favorites. Remove one to add another.'],
    [429, null, 'Slow down a little and try again.'], [500, null, "We couldn't save that. Try again."]];
  for (const [status, serverText, message] of cases) {
    const s = fav.createStore({ fetch: fakeFetch(() => reply(status, serverText ? { error: serverText } : {})), storage: mem(), local: mem(), search: '' });
    s.signedIn = true;
    const r = await s.toggle(1);
    assert.deepEqual([r.status, r.message], ['error', message], `status ${status}`);
    assert.equal(s.isFav(1), false, `rolled back on ${status}`);
  }
  const off = fav.createStore({ fetch: async () => { throw new Error('offline'); }, storage: mem(), local: mem(), search: '' });
  off.signedIn = true; off.ids.add(4);
  const r = await off.set(4, false);
  assert.equal(r.status, 'error'); assert.equal(off.isFav(4), true, 'removal rolled back when offline');
});

test('SESSION ENDED: a 401 on a change asks for sign-in again and remembers the post', async () => {
  const session = mem();
  const s = fav.createStore({ fetch: fakeFetch(() => reply(401, { error: 'Not logged in' })), storage: session, local: mem(), search: '' });
  s.signedIn = true; s.ids = new Set([8]);
  const r = await s.toggle(2);
  assert.equal(r.status, 'signin'); assert.equal(s.signedIn, false); assert.equal(s.ids.size, 0); assert.equal(s.pending(), 2);
});

test('PENDING: saved once after sign-in, never for a locked post or one that is not on the page, and it expires', async () => {
  const f = fakeFetch(() => reply(200, { ok: true }));
  const session = mem();
  let t = 1000;
  const s = fav.createStore({ fetch: f, storage: session, local: mem(), now: () => t, search: '' });
  await s.toggle(2); // signed out: remembered
  s.signedIn = true;
  assert.equal(await s.applyPending(POSTS), 2);
  assert.equal(s.isFav(2), true); assert.equal(s.pending(), null);
  assert.equal(await s.applyPending(POSTS), null, 'applied only once');
  await (async () => { s.signedIn = false; await s.toggle(3); s.signedIn = true; })();
  assert.equal(await s.applyPending(POSTS), null, 'a locked post is not saved'); assert.equal(s.isFav(3), false);
  s.signedIn = false; await s.toggle(77); s.signedIn = true;
  assert.equal(await s.applyPending(POSTS), null, 'a post not on this page is ignored');
  s.signedIn = false; await s.toggle(1);
  t += 31 * 60 * 1000;
  assert.equal(s.pending(), null, 'expires after 30 minutes');
});

test('MARKUP: a star is escaped, numbered and labeled; locked posts get none; chips carry the count', () => {
  const html = fav.starHtml({ id: 7, title: 'Mia "the <b>" post' }, false, 'icon');
  assert.match(html, /data-fav-id="7"/); assert.match(html, /aria-pressed="false"/);
  assert.ok(!html.includes('<b>') && html.includes('&lt;b&gt;') && html.includes('&quot;'));
  assert.match(html, /Save Mia/);
  assert.match(fav.starHtml({ id: 7, title: 'X' }, true, 'text'), /aria-pressed="true"[\s\S]*Remove X from your favorites[\s\S]*<span>Saved<\/span>/);
  assert.equal(fav.starHtml({ id: 8, title: 'Locked', locked: true }, false, 'icon'), '');
  const chips = fav.chipsHtml('favorites', 3);
  assert.match(chips, /Favorites \(3\)/); assert.match(chips, /data-fav-view="favorites" aria-pressed="true"/); assert.match(chips, /data-fav-view="all" aria-pressed="false"/);
  assert.equal(fav.starHtml({ id: '7; alert(1)', title: 'Bad id' }, false, 'icon').includes('alert'), false, 'ids are forced to numbers');
});

test('VIEW CHOICE: setView remembers the choice on the device', () => {
  const local = mem();
  const s = fav.createStore({ fetch: fakeFetch(() => reply(200, {})), storage: mem(), local, search: '' });
  s.setView('favorites');
  assert.equal(local.getItem('fnBlogView'), 'favorites');
  assert.equal(fav.createStore({ storage: mem(), local, search: '' }).view, 'favorites');
  s.setView('anything else'); assert.equal(s.view, 'all');
});
