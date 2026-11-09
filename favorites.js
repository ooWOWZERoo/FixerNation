/* Favorites for lessons and games, and the shared star (Release 165). One small script any page can include.
   Server rules live in server/routes/favorites.js (lessons, games, and one list of everything) and server/routes/blog-favorites.js
   (Morning Boost posts): signed-in site users only, own favorites only.

   A page does four things:
     1. const store = FnFav.createStore();  await store.load();
     2. put a star on each item with FnFav.starHtml('lessons' | 'games' | 'posts', item, store.isFav(kind, item.id), 'icon' | 'text')
     3. FnFav.bind({ store, rerender, signIn, toast })  (one click handler for every star on the page)
     4. after sign-in:  await store.load();  const saved = await store.applyPending();

   The state and rules (optimistic star, rollback on failure, sign-in memory) live in createStore() and take their fetch and storage as
   arguments, so server/test/favorites-client.test.js runs them in Node without a browser. The click handler runs in the capture phase so
   a star on a card that is itself a link or has its own click handler never also opens the card. */
(function (root) {
  'use strict';
  var LIST_URL = '/api/favorites';
  var KINDS = ['lessons', 'games', 'posts'];
  var PENDING_KEY = 'fn_pending_favorite_item';
  var PENDING_MINUTES = 30;

  var MSG = {
    signIn: 'Sign in to save favorites.',
    added: 'Saved to favorites.',
    removed: 'Removed from favorites.',
    locked: "This needs a license, so it can't be saved.",
    slow: 'Slow down a little and try again.',
    gone: 'That is not available any more.',
    generic: "We couldn't save that. Try again.",
  };
  var NOUN = { lessons: 'lesson', games: 'game', posts: 'post' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- pure helpers -------------------------------------------------------------------------------------------------------------
  function urlFor(kind, id) {
    if (kind === 'lessons') return '/api/favorites/lessons/' + encodeURIComponent(id);
    if (kind === 'games') return '/api/favorites/games/' + encodeURIComponent(id);
    if (kind === 'posts') return '/api/blog-favorites/' + encodeURIComponent(id);
    return null;
  }
  function errorMessage(status, serverText) {
    if (status === 403) return MSG.locked;
    if (status === 404) return MSG.gone;
    if (status === 409 && serverText) return serverText;
    if (status === 429) return MSG.slow;
    return MSG.generic;
  }
  function emptySets() { return { lessons: new Set(), games: new Set(), posts: new Set() }; }

  // ---- state and rules ----------------------------------------------------------------------------------------------------------
  // deps: { fetch, storage (sessionStorage-like), now }
  function createStore(deps) {
    deps = deps || {};
    var doFetch = deps.fetch || (typeof fetch === 'function' ? fetch.bind(root) : null);
    var session = deps.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    var now = deps.now || function () { return Date.now(); };
    var safe = function (fn) { try { return fn(); } catch (e) { return null; } };

    var store = { signedIn: false, sets: emptySets() };

    store.isFav = function (kind, id) { return !!store.sets[kind] && store.sets[kind].has(Number(id)); };
    store.count = function (kind) { return store.sets[kind] ? store.sets[kind].size : 0; };
    store.ids = function (kind) { return store.sets[kind] ? Array.from(store.sets[kind]) : []; };

    // Loads the user's favorites. A 401 means "not signed in", which is normal, not an error.
    store.load = async function () {
      try {
        var r = await doFetch(LIST_URL, { credentials: 'include' });
        if (r.status === 401) { store.signedIn = false; store.sets = emptySets(); return store; }
        if (!r.ok) throw new Error('status ' + r.status);
        var data = (await r.json()) || {};
        store.signedIn = true;
        var sets = emptySets();
        KINDS.forEach(function (k) { sets[k] = new Set((Array.isArray(data[k]) ? data[k] : []).map(Number)); });
        store.sets = sets;
      } catch (e) {
        // Keep whatever we had; the page still works as a plain list.
      }
      return store;
    };

    function rememberPending(kind, id) {
      if (session) safe(function () { session.setItem(PENDING_KEY, JSON.stringify({ kind: kind, id: Number(id), at: now() })); });
    }
    store.pending = function () {
      var raw = session && safe(function () { return session.getItem(PENDING_KEY); });
      if (!raw) return null;
      var p = safe(function () { return JSON.parse(raw); });
      if (!p || KINDS.indexOf(p.kind) === -1 || typeof p.id !== 'number' || now() - p.at > PENDING_MINUTES * 60 * 1000) { store.clearPending(); return null; }
      return { kind: p.kind, id: p.id };
    };
    store.clearPending = function () { if (session) safe(function () { session.removeItem(PENDING_KEY); }); };

    // Sets one item. Optimistic: the star changes at once and goes back if the server says no.
    store.set = async function (kind, id, favorited) {
      id = Number(id);
      var url = urlFor(kind, id);
      if (!url) return { status: 'error', code: 0, message: MSG.generic };
      var had = store.sets[kind].has(id);
      var restore = function () { if (had) store.sets[kind].add(id); else store.sets[kind].delete(id); };
      if (favorited) store.sets[kind].add(id); else store.sets[kind].delete(id);
      try {
        var r = await doFetch(url, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorited: favorited }),
        });
        if (r.status === 401) { // signed out in another tab, or the session ended
          restore();
          store.signedIn = false; store.sets = emptySets();
          rememberPending(kind, id);
          return { status: 'signin', message: MSG.signIn };
        }
        if (!r.ok) {
          restore();
          var text = null;
          try { text = (await r.json()).error; } catch (e) { /* no body */ }
          return { status: 'error', code: r.status, message: errorMessage(r.status, text) };
        }
        return { status: favorited ? 'added' : 'removed', message: favorited ? MSG.added : MSG.removed };
      } catch (e) {
        restore();
        return { status: 'error', code: 0, message: MSG.generic };
      }
    };

    // A star tap. Signed out: remember which item, and ask the page to open sign-in.
    store.toggle = function (kind, id) {
      if (!store.signedIn) { rememberPending(kind, id); return Promise.resolve({ status: 'signin', message: MSG.signIn }); }
      return store.set(kind, id, !store.isFav(kind, id));
    };

    // After sign-in: save the item the person tapped before they were asked to sign in. The server decides if it can be saved.
    store.applyPending = async function () {
      var p = store.pending();
      if (!p || !store.signedIn) return null;
      store.clearPending();
      if (store.isFav(p.kind, p.id)) return null;
      var r = await store.set(p.kind, p.id, true);
      return r.status === 'added' ? p : null;
    };

    return store;
  }

  // ---- markup -------------------------------------------------------------------------------------------------------------------
  var STAR_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7 6.1 20.8l1.2-6.5L2.5 9.7l6.6-.9z" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  // style: 'icon' (round button in the top-right corner of a card) or 'text' (a "Save" / "Saved" button next to other buttons)
  function starHtml(kind, item, isFav, style) {
    if (!item || KINDS.indexOf(kind) === -1 || !Number.isFinite(Number(item.id))) return '';
    var title = esc(item.title || item.name || 'this ' + NOUN[kind]);
    var label = isFav ? 'Remove ' + title + ' from your favorites' : 'Save ' + title + ' to your favorites';
    return '<button type="button" class="fn-star-btn fn-star-' + (style === 'text' ? 'text' : 'icon') + (isFav ? ' is-on' : '') + '" data-fav-kind="' + kind +
      '" data-fav-id="' + Number(item.id) + '" aria-pressed="' + (isFav ? 'true' : 'false') + '" aria-label="' + label + '" title="' + (isFav ? 'Saved' : 'Save') + '">' + STAR_SVG +
      (style === 'text' ? '<span>' + (isFav ? 'Saved' : 'Save') + '</span>' : '') + '</button>';
  }

  var CSS = '.fn-star-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-family:inherit;font-weight:700;color:var(--teal-dark,#0E3733);background:#fff;border:2px solid var(--teal-dark,#0E3733);transition:transform .15s ease,background .15s ease}' +
    '.fn-star-btn svg{fill:none;stroke:var(--teal-dark,#0E3733);flex:none}' +
    '.fn-star-btn:hover{transform:translateY(-1px)}' +
    '.fn-star-btn.is-on{background:var(--cream-soft,#F3EBDD)}' +
    '.fn-star-btn.is-on svg{fill:var(--gold,#EBA657)}' +
    '.fn-star-icon{width:44px;height:44px;border-radius:50%;padding:0;position:absolute;top:12px;right:12px;z-index:2;box-shadow:0 6px 16px -8px rgba(0,0,0,.45)}' +
    '.fn-star-text{min-height:44px;padding:0 18px;border-radius:999px;font-size:14.5px}' +
    '.fn-star-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1100;display:flex;align-items:center;gap:14px;background:var(--teal-dark,#0E3733);color:#fff;padding:12px 20px;border-radius:999px;font-weight:700;font-size:14px;box-shadow:0 20px 40px -14px rgba(0,0,0,.4)}' +
    '.fn-star-toast button{background:none;border:none;color:#F6D9C3;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer;padding:6px}' +
    '.fn-star-btn:focus-visible,.fn-star-toast button:focus-visible{outline:3px solid var(--gold,#EBA657);outline-offset:2px}';

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('fnStarCss')) return;
    var s = document.createElement('style'); s.id = 'fnStarCss'; s.textContent = CSS; document.head.appendChild(s);
  }

  var toastTimer;
  function showToast(message, action) {
    if (typeof document === 'undefined') return;
    injectCss();
    var el = document.getElementById('fnStarToast');
    if (el) el.remove();
    el = document.createElement('div'); el.id = 'fnStarToast'; el.className = 'fn-star-toast'; el.setAttribute('role', 'status');
    var span = document.createElement('span'); span.textContent = message; el.appendChild(span);
    if (action) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', function () { el.remove(); action.run(); });
      el.appendChild(b);
    }
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, action ? 6000 : 2600);
  }

  // One click handler for every star on the page.
  // opts: { store, rerender(), signIn(message), toast(message, action), undoOnRemove }
  function bind(opts) {
    injectCss();
    var store = opts.store;
    var toast = opts.toast || showToast;
    document.addEventListener('click', async function (e) {
      var star = e.target.closest && e.target.closest('[data-fav-kind][data-fav-id]');
      if (!star) return;
      e.preventDefault(); e.stopPropagation(); // never also open the card the star sits on
      var kind = star.getAttribute('data-fav-kind');
      var id = Number(star.getAttribute('data-fav-id'));
      var r = await store.toggle(kind, id);
      if (r.status === 'signin') { opts.signIn(r.message); opts.rerender(); return; }
      if (r.status === 'error') { toast(r.message); opts.rerender(); return; }
      if (r.status === 'removed' && opts.undoOnRemove) {
        toast(r.message, { label: 'Undo', run: async function () { var u = await store.set(kind, id, true); if (u.status === 'error') toast(u.message); opts.rerender(); } });
      } else {
        toast(r.message);
      }
      opts.rerender();
    }, true);
  }

  var api = { createStore: createStore, urlFor: urlFor, errorMessage: errorMessage, starHtml: starHtml, bind: bind,
    showToast: showToast, injectCss: injectCss, esc: esc, MSG: MSG, KINDS: KINDS, PENDING_KEY: PENDING_KEY };
  if (typeof window !== 'undefined') window.FnFav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // for server/test
})(typeof window !== 'undefined' ? window : globalThis);
