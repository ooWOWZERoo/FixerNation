// Release 165: the browser side of favorites (favorites.js), run in Node with a fake fetch and fake storage.
// What must hold: signed-out stars ask for sign-in and remember what was tapped; the star changes at once and goes back when the server
// refuses; every error has a plain message; something tapped before sign-in is saved after it (once, and not when it expired);
// a lesson 5 and a game 5 are different things; markup is escaped; each kind goes to the right route.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fav = require(path.join(__dirname, '..', '..', 'favorites.js'));

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const reply = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts, calls.length); };
  f.calls = calls; return f;
}

test('LOAD: 401 means signed out, 200 fills one set per kind, a failure keeps what it had', async () => {
  let s = fav.createStore({ fetch: fakeFetch(() => reply(401, { error: 'Not logged in' })), storage: mem() });
  await s.load(); assert.equal(s.signedIn, false); assert.equal(s.count('lessons') + s.count('games') + s.count('posts'), 0);
  const f = fakeFetch(() => reply(200, { posts: [3], lessons: [5, '7'], games: [5] }));
  s = fav.createStore({ fetch: f, storage: mem() });
  await s.load();
  assert.equal(s.signedIn, true);
  assert.deepEqual(s.ids('lessons'), [5, 7]); assert.deepEqual(s.ids('games'), [5]); assert.deepEqual(s.ids('posts'), [3]);
  assert.equal(f.calls[0].url, '/api/favorites'); assert.equal(f.calls[0].opts.credentials, 'include');
  assert.equal(s.isFav('lessons', 5), true); assert.equal(s.isFav('games', 5), true);
  assert.equal(s.isFav('lessons', 3), false, 'a lesson 3 is not post 3');
  assert.equal(s.isFav('nonsense', 5), false);
  const s2 = fav.createStore({ fetch: async () => { throw new Error('offline'); }, storage: mem() });
  s2.signedIn = true; s2.sets.lessons.add(1);
  await s2.load(); assert.equal(s2.signedIn, true); assert.deepEqual(s2.ids('lessons'), [1], 'a network failure changes nothing');
  const s3 = fav.createStore({ fetch: fakeFetch(() => reply(200, { lessons: 'bad', games: null })), storage: mem() });
  await s3.load(); assert.deepEqual(s3.ids('lessons'), []); assert.equal(s3.signedIn, true);
});

test('ROUTES: each kind goes to its own address, as a PUT with a JSON body and credentials', async () => {
  assert.equal(fav.urlFor('lessons', 12), '/api/favorites/lessons/12');
  assert.equal(fav.urlFor('games', 4), '/api/favorites/games/4');
  assert.equal(fav.urlFor('posts', 9), '/api/blog-favorites/9');
  assert.equal(fav.urlFor('other', 1), null);
  const f = fakeFetch(() => reply(200, { ok: true }));
  const s = fav.createStore({ fetch: f, storage: mem() }); s.signedIn = true;
  await s.set('lessons', 12, true); await s.set('games', 4, true); await s.set('posts', 9, true);
  assert.deepEqual(f.calls.map((c) => c.url), ['/api/favorites/lessons/12', '/api/favorites/games/4', '/api/blog-favorites/9']);
  for (const c of f.calls) {
    assert.equal(c.opts.method, 'PUT'); assert.equal(c.opts.credentials, 'include');
    assert.equal(c.opts.headers['Content-Type'], 'application/json'); assert.equal(c.opts.body, '{"favorited":true}');
  }
  assert.equal((await s.set('other', 1, true)).status, 'error', 'an unknown kind makes no request');
  assert.equal(f.calls.length, 3);
});

test('SIGNED OUT: a star tap makes no request, asks for sign-in and remembers kind and id', async () => {
  const f = fakeFetch(() => reply(200, {}));
  const s = fav.createStore({ fetch: f, storage: mem() });
  const r = await s.toggle('games', 21);
  assert.equal(r.status, 'signin'); assert.equal(r.message, 'Sign in to save favorites.');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(s.pending(), { kind: 'games', id: 21 });
});

test('SET: the star changes before the answer arrives, and a refusal puts it back with a plain message', async () => {
  let release;
  const slow = fakeFetch(() => new Promise((res) => { release = () => res(reply(200, { ok: true })); }));
  const s = fav.createStore({ fetch: slow, storage: mem() }); s.signedIn = true;
  const p = s.set('lessons', 5, true);
  assert.equal(s.isFav('lessons', 5), true, 'optimistic');
  release(); assert.equal((await p).status, 'added');

  const cases = [[403, 'needs a license'], [404, 'not available any more'], [429, 'Slow down'], [500, "couldn't save"]];
  for (const [status, text] of cases) {
    const t = fav.createStore({ fetch: fakeFetch(() => reply(status, { error: 'x' })), storage: mem() }); t.signedIn = true; t.sets.games.add(2);
    const r = await t.set('games', 8, true);
    assert.equal(r.status, 'error'); assert.equal(r.code, status); assert.match(r.message, new RegExp(text));
    assert.equal(t.isFav('games', 8), false, 'rolled back'); assert.equal(t.isFav('games', 2), true, 'others untouched');
  }
  const cap = fav.createStore({ fetch: fakeFetch(() => reply(409, { error: 'You can keep up to 500 favorites. Remove one to add another.' })), storage: mem() }); cap.signedIn = true;
  assert.match((await cap.set('lessons', 1, true)).message, /500 favorites/, 'the 409 shows the server sentence');
  const down = fav.createStore({ fetch: async () => { throw new Error('offline'); }, storage: mem() }); down.signedIn = true; down.sets.lessons.add(3);
  assert.equal((await down.set('lessons', 3, false)).status, 'error');
  assert.equal(down.isFav('lessons', 3), true, 'a removal that failed is put back');
});

test('SESSION ENDED: a 401 on a change signs the store out, rolls back and remembers the tap', async () => {
  const s = fav.createStore({ fetch: fakeFetch(() => reply(401, {})), storage: mem() }); s.signedIn = true; s.sets.lessons.add(1);
  const r = await s.toggle('lessons', 6);
  assert.equal(r.status, 'signin'); assert.equal(s.signedIn, false); assert.equal(s.count('lessons'), 0);
  assert.deepEqual(s.pending(), { kind: 'lessons', id: 6 });
});

test('PENDING: saved once after sign-in, not twice, not when expired, not when the memory is junk', async () => {
  const session = mem();
  let t = 1000;
  const f = fakeFetch(() => reply(200, { ok: true }));
  const s = fav.createStore({ fetch: f, storage: session, now: () => t });
  await s.toggle('games', 21); // signed out: remembered
  s.signedIn = true;
  assert.deepEqual(await s.applyPending(), { kind: 'games', id: 21 });
  assert.equal(f.calls.length, 1); assert.equal(s.isFav('games', 21), true);
  assert.equal(await s.applyPending(), null, 'only once'); assert.equal(f.calls.length, 1);

  const later = fav.createStore({ fetch: f, storage: session, now: () => t });
  await later.toggle('lessons', 5); t += 31 * 60 * 1000; later.signedIn = true;
  assert.equal(await later.applyPending(), null, 'older than 30 minutes is dropped'); assert.equal(f.calls.length, 1);

  session.setItem(fav.PENDING_KEY, '{"kind":"hax","id":1,"at":' + t + '}');
  const junk = fav.createStore({ fetch: f, storage: session, now: () => t }); junk.signedIn = true;
  assert.equal(junk.pending(), null); assert.equal(await junk.applyPending(), null);
  session.setItem(fav.PENDING_KEY, 'not json');
  assert.equal(junk.pending(), null);

  const already = fav.createStore({ fetch: f, storage: session, now: () => t }); already.signedIn = true; already.sets.lessons.add(5);
  session.setItem(fav.PENDING_KEY, JSON.stringify({ kind: 'lessons', id: 5, at: t }));
  assert.equal(await already.applyPending(), null, 'already a favorite: no request'); assert.equal(f.calls.length, 1);

  const refused = fav.createStore({ fetch: fakeFetch(() => reply(404, {})), storage: session, now: () => t }); refused.signedIn = true;
  session.setItem(fav.PENDING_KEY, JSON.stringify({ kind: 'games', id: 99, at: t }));
  assert.equal(await refused.applyPending(), null, 'the server said no: nothing is claimed saved');
});

test('MARKUP: escaped, labelled, one kind and id on each star; bad input makes no star', () => {
  const html = fav.starHtml('lessons', { id: 7, title: '<img src=x onerror=alert(1)> "Quote" & more' }, false, 'icon');
  assert.ok(!/<img/.test(html), 'title is escaped'); assert.match(html, /&lt;img/);
  assert.match(html, /data-fav-kind="lessons"/); assert.match(html, /data-fav-id="7"/);
  assert.match(html, /aria-pressed="false"/); assert.match(html, /fn-star-icon/); assert.match(html, /aria-label="Save /);
  const on = fav.starHtml('games', { id: 3, name: 'Peace Table' }, true, 'text');
  assert.match(on, /is-on/); assert.match(on, /aria-pressed="true"/); assert.match(on, /<span>Saved<\/span>/); assert.match(on, /Remove Peace Table from your favorites/);
  assert.match(fav.starHtml('games', { id: 3, name: 'x' }, false, 'text'), /<span>Save<\/span>/);
  assert.equal(fav.starHtml('nonsense', { id: 1 }, false), '');
  assert.equal(fav.starHtml('lessons', { id: 'abc' }, false), '');
  assert.equal(fav.starHtml('lessons', null, false), '');
  assert.ok(!/NaN/.test(fav.starHtml('lessons', { id: 4 }, false)));
});
