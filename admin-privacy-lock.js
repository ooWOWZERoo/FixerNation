/* Idle lock for admin pages that show student names (Release 121).
   After the idle time set in Settings (default 5 minutes with no mouse move, click or key press) the page wipes the student names
   from the screen and from the page itself (not just hides them, so they are not left in the page source), and shows a notice with
   a button to load them again. Loading them again goes back to the server, so each reveal is a fresh, logged lookup.

   A page uses it like this:
     <script src="admin-privacy-lock.js?v=1"></script>
     var lock = fnPrivacyLock({
       notice: document.getElementById('lockNotice'),   // an empty element where the "hidden" message goes
       clear: function () { ...empty every element that holds student names... },
       reload: function () { ...run the lookups again... }
     });
     lock.arm();      // call whenever student names have just been put on the page
     lock.disarm();   // call when nothing with student names is on the page any more
   Settings: GET /api/settings/privacy-lock -> { minutes }. If that cannot be read, 5 minutes is used. */
(function () {
  'use strict';
  var EVENTS = ['mousemove', 'mousedown', 'click', 'keydown', 'touchstart', 'wheel', 'scroll'];
  var DEFAULT_MINUTES = 5;

  window.fnPrivacyLock = function (opts) {
    var minutes = DEFAULT_MINUTES;
    var armed = false;
    var lastActivity = Date.now();
    var timer = null;

    var ready = fetch('/api/settings/privacy-lock', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.minutes >= 1) minutes = d.minutes; })
      .catch(function () {});

    function touch() { lastActivity = Date.now(); }
    EVENTS.forEach(function (name) { window.addEventListener(name, touch, { passive: true, capture: true }); });

    function check() {
      if (armed && Date.now() - lastActivity >= minutes * 60 * 1000) lockNow();
    }

    function lockNow() {
      armed = false;
      clearInterval(timer); timer = null;
      opts.clear();
      var n = opts.notice;
      if (!n) return;
      n.textContent = '';
      n.style.display = 'block';
      var text = document.createElement('span');
      text.textContent = 'Student names are hidden after ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + ' without activity. ';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'a-btn a-btn-outline a-btn-sm';
      btn.textContent = 'Show them again';
      btn.addEventListener('click', function () { n.style.display = 'none'; n.textContent = ''; opts.reload(); });
      n.appendChild(text); n.appendChild(btn);
    }

    return {
      ready: ready,
      minutes: function () { return minutes; },
      // Student names are on the page now: start counting from this moment.
      arm: function () {
        armed = true; touch();
        if (opts.notice) { opts.notice.style.display = 'none'; opts.notice.textContent = ''; }
        if (!timer) timer = setInterval(check, 5000);
      },
      disarm: function () { armed = false; clearInterval(timer); timer = null; },
      lockNow: lockNow
    };
  };
})();
