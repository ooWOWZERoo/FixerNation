/* Favorites for blog posts and Morning Boost (Release 91). One small script any blog list page can include.
   Server rules live in server/routes/blog-favorites.js (signed-in site users only, own favorites only).

   A page does four things:
     1. const store = FnFavorites.createStore();  await store.load();
     2. render stars and chips with FnFavorites.starHtml(post, store.isFav(post.id)) and FnFavorites.chipsHtml(store.view, store.count(posts), ...)
     3. show store.filter(posts) for the current view
     4. FnFavorites.bind({ store, rerender, signIn, toast, getPosts })  (one click handler for every star and chip on the page)

   The state and rules (optimistic star, rollback on failure, sign-in memory, filter and count) live in createStore() and take their
   fetch and storage as arguments, so server/test/blog-favorites-client.test.js runs them in Node without a browser. */
(function (root) {
  'use strict';
  var API = '/api/blog-favorites';
  var PENDING_KEY = 'fn_pending_favorite';
  var VIEW_KEY = 'fnBlogView';
  var PENDING_MINUTES = 30;

  var MSG = {
    signIn: 'Sign in to save favorites.',
    added: 'Saved to favorites.',
    removed: 'Removed from favorites.',
    locked: "This post needs a license, so it can't be saved.",
    slow: 'Slow down a little and try again.',
    gone: 'That post is not available any more.',
    generic: "We couldn't save that. Try again.",
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- pure helpers -------------------------------------------------------------------------------------------------------------
  function parseView(search, stored) {
    var v = new URLSearchParams(search || '').get('view');
    if (v === 'favorites' || v === 'all') return v;
    return stored === 'favorites' ? 'favorites' : 'all';
  }
  function filterPosts(posts, favSet, view) {
    return view === 'favorites' ? posts.filter(function (p) { return favSet.has(p.id); }) : posts.slice();
  }
  function countLive(posts, favSet) {
    return posts.filter(function (p) { return favSet.has(p.id); }).length;
  }
  function errorMessage(status, serverText) {
    if (status === 403) return MSG.locked;
    if (status === 404) return MSG.gone;
    if (status === 409 && serverText) return serverText;
    if (status === 429) return MSG.slow;
    return MSG.generic;
  }

  // ---- state and rules ----------------------------------------------------------------------------------------------------------
  // deps: { fetch, storage (sessionStorage-like), local (localStorage-like), now, search }
  function createStore(deps) {
    deps = deps || {};
    var doFetch = deps.fetch || (typeof fetch === 'function' ? fetch.bind(root) : null);
    var session = deps.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    var local = deps.local || (typeof localStorage !== 'undefined' ? localStorage : null);
    var now = deps.now || function () { return Date.now(); };
    var safe = function (fn) { try { return fn(); } catch (e) { return null; } };

    var store = {
      signedIn: false,
      ids: new Set(),
      view: parseView(deps.search !== undefined ? deps.search : (typeof location !== 'undefined' ? location.search : ''), local && safe(function () { return local.getItem(VIEW_KEY); })),
    };

    store.isFav = function (id) { return store.ids.has(id); };
    store.count = function (posts) { return countLive(posts, store.ids); };
    store.filter = function (posts) { return filterPosts(posts, store.ids, store.view); };
    store.setView = function (view) {
      store.view = view === 'favorites' ? 'favorites' : 'all';
      if (local) safe(function () { local.setItem(VIEW_KEY, store.view); });
    };

    // Loads the user's favorites. A 401 means "not signed in", which is normal, not an error.
    store.load = async function () {
      try {
        var r = await doFetch(API, { credentials: 'include' });
        if (r.status === 401) { store.signedIn = false; store.ids = new Set(); return store; }
        if (!r.ok) throw new Error('status ' + r.status);
        var data = await r.json();
        store.signedIn = true;
        store.ids = new Set((data && Array.isArray(data.ids) ? data.ids : []).map(Number));
      } catch (e) {
        // Keep whatever we had; the page still works as a plain list.
      }
      return store;
    };

    function rememberPending(id) {
      if (session) safe(function () { session.setItem(PENDING_KEY, JSON.stringify({ id: id, at: now() })); });
    }
    store.pending = function () {
      var raw = session && safe(function () { return session.getItem(PENDING_KEY); });
      if (!raw) return null;
      var p = safe(function () { return JSON.parse(raw); });
      if (!p || typeof p.id !== 'number' || now() - p.at > PENDING_MINUTES * 60 * 1000) { store.clearPending(); return null; }
      return p.id;
    };
    store.clearPending = function () { if (session) safe(function () { session.removeItem(PENDING_KEY); }); };

    // Sets one post. Optimistic: the star changes at once and goes back if the server says no.
    store.set = async function (id, favorited) {
      var had = store.ids.has(id);
      if (favorited) store.ids.add(id); else store.ids.delete(id);
      try {
        var r = await doFetch(API + '/' + encodeURIComponent(id), {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorited: favorited }),
        });
        if (r.status === 401) { // signed out in another tab, or the session ended
          if (had) store.ids.add(id); else store.ids.delete(id);
          store.signedIn = false; store.ids = new Set();
          rememberPending(id);
          return { status: 'signin', message: MSG.signIn };
        }
        if (!r.ok) {
          if (had) store.ids.add(id); else store.ids.delete(id);
          var text = null;
          try { text = (await r.json()).error; } catch (e) { /* no body */ }
          return { status: 'error', code: r.status, message: errorMessage(r.status, text) };
        }
        return { status: favorited ? 'added' : 'removed', message: favorited ? MSG.added : MSG.removed };
      } catch (e) {
        if (had) store.ids.add(id); else store.ids.delete(id);
        return { status: 'error', code: 0, message: MSG.generic };
      }
    };

    // A star tap. Signed out: remember which post, and ask the page to open sign-in.
    store.toggle = function (id) {
      if (!store.signedIn) { rememberPending(id); return Promise.resolve({ status: 'signin', message: MSG.signIn }); }
      return store.set(id, !store.ids.has(id));
    };

    // After sign-in: save the post the person tapped before they were asked to sign in (if it is still on the page).
    store.applyPending = async function (posts) {
      var id = store.pending();
      if (id === null || !store.signedIn) return null;
      store.clearPending();
      if (!posts.some(function (p) { return p.id === id && !p.locked; }) || store.ids.has(id)) return null;
      var r = await store.set(id, true);
      return r.status === 'added' ? id : null;
    };

    return store;
  }

  // ---- markup -------------------------------------------------------------------------------------------------------------------
  var STAR_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7 6.1 20.8l1.2-6.5L2.5 9.7l6.6-.9z" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  // style: 'icon' (round button on a card image) or 'text' (a "Save" / "Saved" button next to other buttons)
  function starHtml(post, isFav, style) {
    if (!post || post.locked) return '';
    var title = esc(post.title || 'this post');
    var label = isFav ? 'Remove ' + title + ' from your favorites' : 'Save ' + title + ' to your favorites';
    return '<button type="button" class="fn-fav-btn fn-fav-' + (style === 'text' ? 'text' : 'icon') + (isFav ? ' is-on' : '') + '" data-fav-id="' + Number(post.id) +
      '" aria-pressed="' + (isFav ? 'true' : 'false') + '" aria-label="' + label + '" title="' + (isFav ? 'Saved' : 'Save') + '">' + STAR_SVG +
      (style === 'text' ? '<span>' + (isFav ? 'Saved' : 'Save') + '</span>' : '') + '</button>';
  }

  function chipsHtml(view, count) {
    return '<div class="fn-fav-chips" role="group" aria-label="Show posts">' +
      '<button type="button" class="fn-fav-chip' + (view === 'all' ? ' active' : '') + '" data-fav-view="all" aria-pressed="' + (view === 'all') + '">All posts</button>' +
      '<button type="button" class="fn-fav-chip' + (view === 'favorites' ? ' active' : '') + '" data-fav-view="favorites" aria-pressed="' + (view === 'favorites') + '">&#9733; Favorites (' + Number(count) + ')</button>' +
      '</div>';
  }

  var CSS = '.fn-fav-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-family:inherit;font-weight:700;color:var(--teal-dark,#0E3733);background:#fff;border:2px solid var(--teal-dark,#0E3733);transition:transform .15s ease,background .15s ease}' +
    '.fn-fav-btn svg{fill:none;stroke:var(--teal-dark,#0E3733);flex:none}' +
    '.fn-fav-btn:hover{transform:translateY(-1px)}' +
    '.fn-fav-btn.is-on{background:var(--cream-soft,#F3EBDD)}' +
    '.fn-fav-btn.is-on svg{fill:var(--gold,#EBA657)}' +
    '.fn-fav-icon{width:44px;height:44px;border-radius:50%;padding:0;position:absolute;top:12px;right:12px;z-index:2;box-shadow:0 6px 16px -8px rgba(0,0,0,.45)}' +
    '.fn-fav-text{min-height:44px;padding:0 18px;border-radius:999px;font-size:14.5px}' +
    '.fn-fav-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px}' +
    '.fn-fav-chip{padding:9px 18px;min-height:44px;border-radius:999px;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;background:var(--cream-soft,#F3EBDD);border:2px solid transparent;color:var(--teal-dark,#0E3733)}' +
    '.fn-fav-chip:hover{background:#e6dccb}.fn-fav-chip.active{background:var(--teal,#164F4A);color:#fff;border-color:var(--teal-dark,#0E3733)}' +
    '.fn-fav-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1100;display:flex;align-items:center;gap:14px;background:var(--teal-dark,#0E3733);color:#fff;padding:12px 20px;border-radius:999px;font-weight:700;font-size:14px;box-shadow:0 20px 40px -14px rgba(0,0,0,.4)}' +
    '.fn-fav-toast button{background:none;border:none;color:#F6D9C3;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer;padding:6px}' +
    '.fn-fav-btn:focus-visible,.fn-fav-chip:focus-visible,.fn-fav-toast button:focus-visible{outline:3px solid var(--gold,#EBA657);outline-offset:2px}';

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('fnFavCss')) return;
    var s = document.createElement('style'); s.id = 'fnFavCss'; s.textContent = CSS; document.head.appendChild(s);
  }

  var toastTimer;
  function showToast(message, action) {
    if (typeof document === 'undefined') return;
    injectCss();
    var el = document.getElementById('fnFavToast');
    if (el) el.remove();
    el = document.createElement('div'); el.id = 'fnFavToast'; el.className = 'fn-fav-toast'; el.setAttribute('role', 'status');
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

  // One click handler for every star and chip on the page.
  // opts: { store, rerender(), signIn(message), getPosts(), toast(message, action) }
  function bind(opts) {
    injectCss();
    var store = opts.store;
    var toast = opts.toast || showToast;
    document.addEventListener('click', async function (e) {
      var star = e.target.closest && e.target.closest('[data-fav-id]');
      if (star) {
        e.preventDefault(); e.stopPropagation();
        var id = Number(star.getAttribute('data-fav-id'));
        var r = await store.toggle(id);
        if (r.status === 'signin') { opts.signIn(r.message); opts.rerender(); return; }
        if (r.status === 'error') { toast(r.message); opts.rerender(); return; }
        if (r.status === 'removed' && store.view === 'favorites') {
          toast(r.message, { label: 'Undo', run: async function () { var u = await store.set(id, true); if (u.status === 'error') toast(u.message); opts.rerender(); } });
        } else {
          toast(r.message);
        }
        opts.rerender();
        return;
      }
      var chip = e.target.closest && e.target.closest('[data-fav-view]');
      if (chip) {
        e.preventDefault();
        var view = chip.getAttribute('data-fav-view');
        store.setView(view);
        try { var url = new URL(location.href); url.searchParams.set('view', store.view); history.replaceState(null, '', url); } catch (err) { /* keep going */ }
        opts.rerender();
      }
    });
  }

  var api = { createStore: createStore, filterPosts: filterPosts, countLive: countLive, parseView: parseView, errorMessage: errorMessage,
    starHtml: starHtml, chipsHtml: chipsHtml, bind: bind, showToast: showToast, injectCss: injectCss, esc: esc, MSG: MSG, PENDING_KEY: PENDING_KEY, VIEW_KEY: VIEW_KEY };
  if (typeof window !== 'undefined') window.FnFavorites = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // for server/test
})(typeof window !== 'undefined' ? window : globalThis);
