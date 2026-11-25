/* Staff "view as" (docs/reference/help-support-tools-requirements.md, section C). A CRM Admin starts a read-only view of a teacher's, school
   administrator's or district administrator's screens from Account Lookup; view-as-start.html puts the view's token in THIS TAB's sessionStorage.
   This script, loaded by the nav scripts only when that token exists, does two things: it sends the token as the X-View-As header on every call to our own
   /api/ (the server then answers as that person, read only, and without student data), and it shows a bar on the page with a countdown and a Stop button.
   Other tabs have no token, so they are never affected. The token is useless without the same admin's own signed-in session. */
(function () {
  'use strict';
  var KEY = 'fnViewAsToken';
  var token = null;
  try { token = sessionStorage.getItem(KEY); } catch (e) { token = null; }
  if (!token || window.__fnViewAs) return;
  window.__fnViewAs = true;

  function ourApi(url) {
    try { var u = new URL(url, location.href); return u.origin === location.origin && u.pathname.indexOf('/api/') === 0; } catch (e) { return false; }
  }

  var bar = null, textEl = null, stopBtn = null, timer = null, endsAt = 0;

  function ended() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ }
    if (timer) { clearInterval(timer); timer = null; }
    if (textEl) textEl.textContent = 'This view has ended. Close this tab.';
    if (stopBtn) stopBtn.textContent = 'Close tab';
    if (bar) bar.style.background = '#6b1d1d';
  }

  // Every call to our own API carries the token.
  var realFetch = window.fetch;
  if (realFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (!ourApi(url)) return realFetch.apply(this, arguments);
      var opts = Object.assign({}, init || {});
      var headers = new Headers(opts.headers || (input && typeof input !== 'string' ? input.headers : undefined) || {});
      headers.set('X-View-As', token);
      opts.headers = headers;
      return realFetch.call(this, input, opts).then(function (r) {
        if (r.status === 401) { r.clone().json().then(function (j) { if (j && j.viewAs && j.ended) ended(); }).catch(function () { /* not ours */ }); }
        return r;
      });
    };
  }
  if (window.XMLHttpRequest) {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__fnViewAsUrl = url; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      if (ourApi(this.__fnViewAsUrl)) { try { this.setRequestHeader('X-View-As', token); } catch (e) { /* not open yet */ } }
      return send.apply(this, arguments);
    };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick(name) {
    var left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    if (left <= 0) { ended(); return; }
    textEl.textContent = 'Viewing as ' + name + '. Read only: nothing can be changed, and student names and writing are hidden. Ends in ' + Math.floor(left / 60) + ':' + pad(left % 60) + '.';
  }

  function build() {
    bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#7a3b00;color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:8px 14px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;';
    textEl = document.createElement('span');
    textEl.textContent = 'Starting the staff view.';
    stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.textContent = 'Stop viewing';
    stopBtn.style.cssText = 'background:#fff;color:#7a3b00;border:0;border-radius:6px;padding:4px 12px;font-weight:700;cursor:pointer;';
    stopBtn.addEventListener('click', function () {
      var done = function () { ended(); try { window.close(); } catch (e) { /* the tab stays open with the ended notice */ } };
      if (!timer && textEl.textContent.indexOf('has ended') !== -1) { done(); return; }
      realFetch.call(window, '/api/view-as/end', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-View-As': token }, body: '{}' }).then(done, done);
    });
    bar.appendChild(textEl); bar.appendChild(stopBtn);
    document.body.appendChild(bar);
    document.documentElement.style.paddingTop = '40px';
    realFetch.call(window, '/api/view-as/status', { credentials: 'include', headers: { 'X-View-As': token } }).then(function (r) {
      if (!r.ok) { ended(); return null; }
      return r.json();
    }).then(function (s) {
      if (!s || !s.active) { if (s !== null) ended(); return; }
      endsAt = new Date(String(s.expiresAt).replace(' ', 'T')).getTime();
      var name = (s.firstName || 'this person') + ' (' + (s.roles || []).join(' and ') + ')';
      tick(name);
      timer = setInterval(function () { tick(name); }, 1000);
    }).catch(function () { /* the next API call shows the ended notice if the view is gone */ });
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
