/* A thin, dismissible banner at the top of the public site and the school and district portals whenever a new release note is
   published. It shows the NEWEST PUBLISHED note from release-notes.js (never a draft), only for 30 days after the note's date, links
   straight to that note (release-notes.html?note=<id>), and stays away once the visitor dismisses it: the dismissed note's id is kept
   in this browser, so the next note brings the banner back. Nothing is sent anywhere. Not shown on the release notes page itself, on
   print, or on the student pages (they do not load nav.js). Loaded by nav.js, school-admin-nav.js and district-admin-nav.js.
   Adding a note to release-notes.js is all it takes: there is nothing else to update, except that release-notes.js is requested with
   the same ?v=N as release-notes.html (a test keeps the two in step). */
(function () {
  'use strict';
  if (window.__fnReleaseBanner) return;
  window.__fnReleaseBanner = true;

  var KEY = 'fn_release_banner_dismissed';
  var SHOW_FOR_DAYS = 30;
  var NOTES_SCRIPT = 'release-notes.js?v=8';

  if (/release-notes\.html$/.test(location.pathname || '')) return;

  function store() {
    try { var t = '__fn_t'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; } catch (e) { /* blocked */ }
    try { return sessionStorage; } catch (e2) { return null; }
  }

  // Whole days from a note's date ('2026-11-08') to today, read as text so a time zone cannot move the day.
  function daysSince(dateText, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || '');
    if (!m) return null;
    var then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - then) / 86400000);
  }

  function addStyles() {
    var st = document.createElement('style');
    st.textContent =
      '.fn-rb{background:#0E3733;color:#FBF5EC;font:600 13px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;padding:7px 46px 7px 16px;position:relative;text-align:center;}' +
      '.fn-rb a{color:#EBA657;font-weight:700;text-decoration:underline;text-underline-offset:2px;margin-left:10px;white-space:nowrap;}' +
      '.fn-rb a:hover{color:#fff;}' +
      '.fn-rb button{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:#FBF5EC;font:400 20px/1 system-ui,sans-serif;cursor:pointer;padding:4px 9px;border-radius:6px;}' +
      '.fn-rb button:hover{background:rgba(255,255,255,.14);}' +
      '.fn-rb a:focus-visible,.fn-rb button:focus-visible{outline:2px solid #EBA657;outline-offset:2px;}' +
      '@media print{.fn-rb{display:none;}}';
    document.head.appendChild(st);
  }

  function show(note, storage) {
    addStyles();
    var bar = document.createElement('div');
    bar.className = 'fn-rb';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'New release note');
    var text = document.createElement('span');
    text.textContent = 'New: ' + note.title + '.';
    var link = document.createElement('a');
    link.href = 'release-notes.html?note=' + encodeURIComponent(note.id);
    link.textContent = 'Read the release note';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss this message');
    close.textContent = '×';
    close.addEventListener('click', function () {
      try { if (storage) storage.setItem(KEY, note.id); } catch (e) { /* the banner just comes back next visit */ }
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    bar.appendChild(text);
    bar.appendChild(link);
    bar.appendChild(close);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function start() {
    var RN = window.FNReleaseNotes;
    if (!RN || !RN.visible) return;
    var latest = RN.visible(false)[0]; // newest first, published only
    if (!latest) return;
    var age = daysSince(latest.date, new Date());
    if (age === null || age > SHOW_FOR_DAYS) return;
    var storage = store(), dismissed = null;
    try { dismissed = storage ? storage.getItem(KEY) : null; } catch (e) { dismissed = null; }
    if (dismissed === latest.id) return;
    show(latest, storage);
  }

  function run() {
    if (window.FNReleaseNotes) { start(); return; }
    var s = document.createElement('script');
    s.src = NOTES_SCRIPT;
    s.onload = start;
    document.head.appendChild(s);
  }
  if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);
})();
