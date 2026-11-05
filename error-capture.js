/* Error capture (Release 122): tells the site when something breaks in the browser, so staff can see it in the Support Inbox
   (Errors tab) instead of waiting for someone to describe it. Requirements: docs/reference/error-capture-requirements.md.

   Reports three things: a script error, an async failure nobody handled, and a failed call to our own /api/ (no answer, or a 500+;
   a 400/401/403/404 is a normal "no" and is not reported). It sends the page PATH (no query string, no # fragment), the API path, the
   status, a short message and the script file:line. It never sends form values, cookies, bodies or anything the person typed. The
   server works out who it is from the cookies; this file sends no identity at all, only the anonymous analytics session id.

   At most 5 reports per page view, never the same one twice, and a report that cannot be sent is dropped silently. Loaded by nav.js,
   admin-nav.js, school-admin-nav.js, district-admin-nav.js and directly by the student pages. */
(function () {
  'use strict';
  if (window.__fnErrorCapture) return;
  window.__fnErrorCapture = true;

  var ENDPOINT = '/api/client-errors';
  var MAX_REPORTS = 5;
  var sent = 0;
  var seen = {};
  var origFetch = window.fetch;

  function sessionId() {
    try { return sessionStorage.getItem('fnAnalyticsSession') || ''; } catch (e) { return ''; }
  }

  function send(report) {
    try {
      if (sent >= MAX_REPORTS) return;
      var key = report.kind + '|' + (report.api || '') + '|' + (report.status || 0) + '|' + report.message;
      if (seen[key]) return;
      seen[key] = true;
      sent++;
      report.page = location.pathname;
      report.sessionId = sessionId();
      var body = JSON.stringify(report);
      if (navigator.sendBeacon && typeof Blob !== 'undefined') {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else if (origFetch) {
        origFetch.call(window, ENDPOINT, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* reporting must never cause an error */ }
  }

  // The path of one of OUR api calls, or '' for anything else (other sites, pages, images, this endpoint).
  function apiPath(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return '';
      if (u.pathname.indexOf('/api/') !== 0 || u.pathname.indexOf(ENDPOINT) === 0) return '';
      return u.pathname;
    } catch (e) { return ''; }
  }

  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window) return; // a missing image or script file, not a script error
    send({ kind: 'js_error', message: String((e && e.message) || 'Script error'), source: (e && e.filename ? e.filename : '') + (e && e.lineno ? ':' + e.lineno : '') });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    send({ kind: 'promise_rejection', message: String((r && r.message) || r || 'Unhandled rejection') });
  });

  if (origFetch) {
    window.fetch = function (input, init) {
      var p = origFetch.apply(this, arguments);
      try {
        var path = apiPath(typeof input === 'string' ? input : (input && input.url) || '');
        if (path) {
          var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          p.then(function (r) {
            if (r && r.status >= 500) send({ kind: 'failed_request', api: path, method: method, status: r.status, message: 'HTTP ' + r.status });
          }, function () {
            send({ kind: 'failed_request', api: path, method: method, status: 0, message: 'No answer from the server' });
          });
        }
      } catch (e) { /* never break the page's own request */ }
      return p;
    };
  }
})();
