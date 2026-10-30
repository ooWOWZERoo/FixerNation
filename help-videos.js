/* Help videos: the one list of how-to videos, plus the "How-to video" button and player.

   TO ADD A VIDEO: paste its link into that video's `url` below. That is all.
   - A video is shown on the site only once its `url` is filled in. Until then it is hidden everywhere.
   - `pages` lists the pages the video belongs to. Each of those pages gets a "How-to video" button once
     the video has a url, and the page must load this file:  <script src="help-videos.js?v=1" defer></script>
   - `help-videos.html` lists every recorded video, grouped by audience and topic.
     `help-videos.html?preview=1` also lists the ones not recorded yet (the plan in docs/training-videos/).
   - `url` can be a YouTube link, a Vimeo link, or a file on this site (https://... .mp4 or /uploads/....mp4).
     YouTube plays from youtube-nocookie.com so no tracking cookies are set for students and parents.
   - Bump the ?v=N on the script tags in the HTML files when this file changes. */
(function () {
  'use strict';

  var GROUPS = [
    { id: 'getting-started', title: 'Getting started' },
    { id: 'school-admins', title: 'School license administrators' },
    { id: 'district-admins', title: 'District administrators' },
    { id: 'teachers', title: 'Teachers' },
    { id: 'students', title: 'Students' },
    { id: 'parents', title: 'Parents' }
  ];

  var VIDEOS = [
    // ---- Getting started
    { id: 'D1', group: 'getting-started', topic: 'Before you sign in', title: 'Accept your quote',
      summary: 'Choose how to pay (PO or card) and say who will run the school\'s account.',
      pages: ['accept-quote.html'], url: '' },
    { id: 'A1', group: 'getting-started', topic: 'Signing in', title: 'Your welcome email and first sign-in',
      summary: 'Open your welcome email and choose a password. You\'ll land in your portal.',
      pages: ['reset-password.html'], url: '' },
    { id: 'A2', group: 'getting-started', topic: 'Signing in', title: 'Forgot your password, or the link expired',
      summary: 'Get back in when you forget your password or the setup link has run out.',
      pages: ['school-admin-login.html', 'district-admin-login.html'], url: '' },
    { id: 'A3', group: 'getting-started', topic: 'Signing in', title: 'Which sign-in page do I use?',
      summary: 'Teachers, school administrators and district administrators each have their own sign-in page. Here is which one to use.',
      pages: ['teacher-login.html'], url: '' },

    // ---- School license administrators
    { id: 'B1', group: 'school-admins', topic: 'Your portal', title: 'A tour of the School Admin portal',
      summary: 'Your dashboard, seat counts, license banner and menu.',
      pages: ['school-admin-dashboard.html'], url: '' },
    { id: 'B9', group: 'school-admins', topic: 'Your portal', title: 'Permission levels and getting help',
      summary: 'What Primary, Secondary and Read Only administrators can do, and who to contact for more seats or a renewal.',
      pages: ['school-admin-org.html'], url: '' },
    { id: 'B10', group: 'school-admins', topic: 'Your portal', title: 'Why can\'t I invite teachers yet?',
      summary: 'What a pending payment, a purchase order or a trial license means for sending invitations.',
      pages: [], url: '' },
    { id: 'B2', group: 'school-admins', topic: 'Teachers and seats', title: 'Invite a teacher',
      summary: 'Add one teacher to your school and see what they receive.',
      pages: ['school-admin-invitations.html'], url: '' },
    { id: 'B3', group: 'school-admins', topic: 'Teachers and seats', title: 'Invite many teachers with a CSV',
      summary: 'Download the template, fill it in and invite a whole staff at once.',
      pages: ['school-admin-invitations.html'], url: '' },
    { id: 'B4', group: 'school-admins', topic: 'Teachers and seats', title: 'Manage invitations',
      summary: 'Resend, extend, revoke or delete an invitation, and read the status badges.',
      pages: ['school-admin-invitations.html'], url: '' },
    { id: 'B5', group: 'school-admins', topic: 'Teachers and seats', title: 'Manage your teacher roster',
      summary: 'See who has a seat and set grade levels. Deactivate, reactivate or remove a teacher.',
      pages: ['school-admin-roster.html'], url: '' },
    { id: 'B6', group: 'school-admins', topic: 'Branding and settings', title: 'Brand your school',
      summary: 'Add your logo and colors, then preview and publish them.',
      pages: ['school-admin-branding.html'], url: '' },
    { id: 'B8', group: 'school-admins', topic: 'Branding and settings', title: 'Safety alert recipients',
      summary: 'Choose who gets an email when a student safety alert comes up.',
      pages: ['school-admin-org.html'], url: '' },
    { id: 'B7', group: 'school-admins', topic: 'Reports', title: 'Reports and exports',
      summary: 'Utilization, teachers, invitations and the activity log, with CSV downloads.',
      pages: ['school-admin-reports.html'], url: '' },

    // ---- District administrators
    { id: 'C1', group: 'district-admins', topic: 'Your portal', title: 'A tour of the District Admin portal',
      summary: 'The dashboard, the menu, the license banner and switching districts.',
      pages: ['district-admin-dashboard.html'], url: '' },
    { id: 'C2', group: 'district-admins', topic: 'Branding', title: 'Set district-wide branding',
      summary: 'Set the logo and colors every school in your district starts with.',
      pages: ['district-admin-branding.html'], url: '' },
    { id: 'C3', group: 'district-admins', topic: 'Schools and school administrators', title: 'See your schools and licenses',
      summary: 'See each licensed school, how many seats it has and who administers it.',
      pages: ['district-admin-schools.html'], url: '' },
    { id: 'C4', group: 'district-admins', topic: 'Schools and school administrators', title: 'Invite and manage school administrators',
      summary: 'Invite a school administrator, then resend, reset, edit or remove them.',
      pages: ['district-admin-schools.html'], url: '' },
    { id: 'C5', group: 'district-admins', topic: 'Portrait of a Graduate', title: 'Record your Portrait of a Graduate (part 1)',
      summary: 'Add your district\'s framework and its standards.',
      pages: ['district-admin-standards.html'], url: '' },
    { id: 'C6', group: 'district-admins', topic: 'Portrait of a Graduate', title: 'Suggest connections and submit for review (part 2)',
      summary: 'Suggest where our lessons and games fit, then confirm the framework is yours and send it for review.',
      pages: ['district-admin-standards.html'], url: '' },
    { id: 'C7', group: 'district-admins', topic: 'Portrait of a Graduate', title: 'What the public sees',
      summary: 'What the review states mean and what visitors see once it\'s published.',
      pages: ['district-admin-standards.html'], url: '' },

    // ---- Teachers
    { id: 'T1', group: 'teachers', topic: 'Getting in', title: 'Accept your school\'s invitation',
      summary: 'Accept your school\'s invitation, whether you\'re new or already have an account.',
      pages: ['school-invite-accept.html'], url: '' },
    { id: 'T2', group: 'teachers', topic: 'Getting in', title: 'Register with your school email',
      summary: 'Use your school email to reserve a seat and create your account.',
      pages: ['education-schools.html'], url: '' },
    { id: 'T3', group: 'teachers', topic: 'Classrooms and students', title: 'Create a classroom and add students',
      summary: 'Create a classroom, then add students one at a time or import a list.',
      pages: ['teacher-classrooms.html', 'teacher-classroom.html'], url: '' },
    { id: 'T6', group: 'teachers', topic: 'Classrooms and students', title: 'Reset a student\'s PIN and invite a parent',
      summary: 'Reset a student\'s PIN and send a parent an invitation.',
      pages: ['teacher-classroom.html'], url: '' },
    { id: 'T4', group: 'teachers', topic: 'Lessons and results', title: 'Assign lessons and brain games',
      summary: 'Choose lessons and brain games for your class.',
      pages: ['teacher-classroom.html'], url: '' },
    { id: 'T5', group: 'teachers', topic: 'Lessons and results', title: 'Read progress and student reflections',
      summary: 'See who started and finished, quiz scores and written reflections.',
      pages: ['teacher-classroom-progress.html', 'teacher-game-report.html'], url: '' },

    // ---- Students
    { id: 'S1', group: 'students', topic: 'Getting in', title: 'Join your class and sign in',
      summary: 'Join your class with the code from your teacher, then sign in with your username and PIN.',
      pages: ['student-login.html'], url: '' },
    { id: 'S2', group: 'students', topic: 'Learning', title: 'Do a lesson and play a brain game',
      summary: 'Work through a lesson and its quiz, then play a brain game.',
      pages: ['student-home.html', 'student-lesson.html'], url: '' },
    { id: 'S3', group: 'students', topic: 'Learning', title: 'Goals and history',
      summary: 'Set goals and look back at what you\'ve done.',
      pages: ['student-achievements.html'], url: '' },

    // ---- Parents
    { id: 'P1', group: 'parents', topic: 'Getting started', title: 'Accept your invitation and see your child\'s progress',
      summary: 'Accept your invitation and see how your child is doing.',
      pages: ['parent-invite-accept.html', 'parent-portal.html'], url: '' }
  ];

  var TEXT = {
    one: 'How-to video',
    many: 'How-to videos',
    more: 'More videos for this page',
    all: 'See all help videos',
    close: 'Close',
    planned: 'Not recorded yet',
    watch: 'Watch'
  };

  // ---- URL handling: only https links or same-site paths ever reach an iframe/video src.
  function embedFor(url) {
    url = String(url || '').trim();
    if (!url) return null;
    var m = url.match(/^https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/);
    if (m) return { kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0' };
    m = url.match(/^https:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/) || url.match(/^https:\/\/player\.vimeo\.com\/video\/(\d{5,12})/);
    if (m) return { kind: 'iframe', src: 'https://player.vimeo.com/video/' + m[1] + '?dnt=1' };
    if (/^https:\/\/[^\s"'<>]+\.(?:mp4|webm|m4v)(?:\?[^\s"'<>]*)?$/i.test(url) || /^\/(?!\/)[^\s"'<>\\]+\.(?:mp4|webm|m4v)$/i.test(url)) {
      return { kind: 'video', src: url };
    }
    return null;
  }
  function recorded(v) { return !!embedFor(v.url); }
  function byId(id) { for (var i = 0; i < VIDEOS.length; i++) if (VIDEOS[i].id === id) return VIDEOS[i]; return null; }
  function groupOf(v) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === v.group) return GROUPS[i]; return GROUPS[0]; }
  // Pages are matched by file name; a URL without ".html" (extensionless hosting) counts as the same page.
  function pageName() {
    var p = location.pathname.split('/').pop();
    if (!p) return 'index.html';
    return /\.[a-z0-9]+$/i.test(p) ? p : p + '.html';
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- Styles (injected once, so every page can just load this one file)
  function injectStyles() {
    if (document.getElementById('fnhv-style')) return;
    var s = el('style', { id: 'fnhv-style' });
    s.textContent =
      '.fnhv-btn{position:fixed;right:18px;bottom:18px;z-index:900;display:inline-flex;align-items:center;gap:8px;background:#164F4A;color:#fff;border:0;border-radius:999px;padding:11px 18px;font:700 14px/1 "Plus Jakarta Sans",system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 24px -8px rgba(14,55,51,.55);}' +
      '.fnhv-btn:hover{background:#0E3733;}.fnhv-btn:focus-visible{outline:3px solid #EBA657;outline-offset:2px;}' +
      '.fnhv-ov{position:fixed;inset:0;z-index:2000;background:rgba(14,55,51,.72);display:flex;align-items:center;justify-content:center;padding:18px;}' +
      '.fnhv-box{background:#fff;color:#2A2420;border-radius:16px;width:100%;max-width:880px;max-height:94vh;overflow:auto;font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
      '.fnhv-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 10px;}' +
      '.fnhv-head h2{margin:0;font-size:18px;line-height:1.25;color:#0E3733;font-family:"Fraunces",Georgia,serif;font-weight:600;}' +
      '.fnhv-x{border:0;background:#F3EBDD;color:#0E3733;border-radius:999px;padding:8px 14px;font:700 13px/1 inherit;cursor:pointer;flex-shrink:0;}' +
      '.fnhv-x:focus-visible,.fnhv-pick:focus-visible{outline:3px solid #EBA657;outline-offset:2px;}' +
      '.fnhv-stage{position:relative;background:#000;aspect-ratio:16/9;}' +
      '.fnhv-stage iframe,.fnhv-stage video{position:absolute;inset:0;width:100%;height:100%;border:0;}' +
      '.fnhv-sum{margin:0;padding:12px 18px 4px;font-size:14px;line-height:1.55;color:#6B5F55;}' +
      '.fnhv-more{padding:6px 18px 4px;}.fnhv-more h3{margin:10px 0 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6B5F55;font-family:inherit;}' +
      '.fnhv-pick{display:block;width:100%;text-align:left;border:1px solid rgba(22,79,74,.18);background:#FBF5EC;color:#0E3733;border-radius:10px;padding:9px 12px;margin-bottom:6px;font:600 14px/1.3 inherit;cursor:pointer;}' +
      '.fnhv-pick[aria-current="true"]{background:#164F4A;color:#fff;}' +
      '.fnhv-foot{padding:8px 18px 16px;font-size:13.5px;}.fnhv-foot a{color:#0E3733;font-weight:700;}' +
      '@media print{.fnhv-btn,.fnhv-ov{display:none!important;}}';
    document.head.appendChild(s);
  }

  // ---- Player modal. `list` = recorded videos to offer, `idx` = which one plays first.
  var lastFocus = null;
  function closePlayer() {
    var ov = document.getElementById('fnhv-ov');
    if (ov) ov.parentNode.removeChild(ov);           // removing the iframe/video stops playback
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePlayer(); } }

  function openPlayer(list, idx) {
    list = list.filter(recorded);
    if (!list.length) return;
    injectStyles();
    lastFocus = document.activeElement;
    var old = document.getElementById('fnhv-ov'); if (old) old.parentNode.removeChild(old);
    var v = list[idx || 0], emb = embedFor(v.url);

    var ov = el('div', { id: 'fnhv-ov', class: 'fnhv-ov' });
    var box = el('div', { class: 'fnhv-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fnhv-title' });
    var head = el('div', { class: 'fnhv-head' });
    head.appendChild(el('h2', { id: 'fnhv-title' }, v.title));
    var x = el('button', { type: 'button', class: 'fnhv-x' }, TEXT.close);
    x.addEventListener('click', closePlayer);
    head.appendChild(x);
    box.appendChild(head);

    var stage = el('div', { class: 'fnhv-stage' });
    if (emb.kind === 'iframe') {
      var f = el('iframe', { src: emb.src, title: v.title, allow: 'fullscreen; picture-in-picture', allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin' });
      stage.appendChild(f);
    } else {
      var vid = el('video', { src: emb.src, controls: '', playsinline: '', preload: 'metadata', title: v.title });
      stage.appendChild(vid);
    }
    box.appendChild(stage);
    box.appendChild(el('p', { class: 'fnhv-sum' }, v.summary));

    if (list.length > 1) {
      var more = el('div', { class: 'fnhv-more' });
      more.appendChild(el('h3', null, TEXT.more));
      list.forEach(function (o, i) {
        var b = el('button', { type: 'button', class: 'fnhv-pick' }, o.title);
        if (i === (idx || 0)) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', function () { openPlayer(list, i); });
        more.appendChild(b);
      });
      box.appendChild(more);
    }
    var foot = el('div', { class: 'fnhv-foot' });
    foot.appendChild(el('a', { href: 'help-videos.html#' + v.group }, TEXT.all));
    box.appendChild(foot);

    ov.appendChild(box);
    ov.addEventListener('click', function (e) { if (e.target === ov) closePlayer(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey, true);
    x.focus();
  }

  // ---- The button on a page that has recorded videos
  function addPageButton() {
    var here = pageName();
    var mine = VIDEOS.filter(function (v) { return recorded(v) && v.pages.indexOf(here) !== -1; });
    if (!mine.length) return;
    injectStyles();
    var b = el('button', { type: 'button', class: 'fnhv-btn', 'aria-haspopup': 'dialog' });
    b.appendChild(el('span', { 'aria-hidden': 'true' }, '▶'));
    b.appendChild(el('span', null, mine.length > 1 ? TEXT.many : TEXT.one));
    b.addEventListener('click', function () { openPlayer(mine, 0); });
    document.body.appendChild(b);
  }

  // ---- help-videos.html: every video, grouped. `preview` also shows the unrecorded ones.
  function renderHelpPage(root, preview) {
    injectStyles();
    var shown = VIDEOS.filter(function (v) { return preview || recorded(v); });
    root.textContent = '';
    if (!shown.length) {
      root.appendChild(el('p', { class: 'hv-empty' }, 'Videos are on the way. Check back soon.'));
      return;
    }
    GROUPS.forEach(function (g) {
      var inGroup = shown.filter(function (v) { return v.group === g.id; });
      if (!inGroup.length) return;
      var sec = el('section', { class: 'hv-group', id: g.id });
      sec.appendChild(el('h2', null, g.title));
      var topics = [];
      inGroup.forEach(function (v) { if (topics.indexOf(v.topic) === -1) topics.push(v.topic); });
      topics.forEach(function (t) {
        sec.appendChild(el('h3', null, t));
        var grid = el('div', { class: 'hv-grid' });
        inGroup.filter(function (v) { return v.topic === t; }).forEach(function (v) {
          var card = el('article', { class: 'hv-card' });
          card.appendChild(el('h4', null, v.title));
          card.appendChild(el('p', null, v.summary));
          if (recorded(v)) {
            var w = el('button', { type: 'button', class: 'hv-watch' }, '▶ ' + TEXT.watch);
            w.setAttribute('aria-label', TEXT.watch + ': ' + v.title);
            w.addEventListener('click', function () { openPlayer([v], 0); });
            card.appendChild(w);
          } else {
            card.appendChild(el('span', { class: 'hv-planned' }, TEXT.planned));
          }
          grid.appendChild(card);
        });
        sec.appendChild(grid);
      });
      root.appendChild(sec);
    });
  }

  window.FNHelpVideos = { groups: GROUPS, videos: VIDEOS, embedFor: embedFor, recorded: recorded, open: function (id) { var v = byId(id); if (v) openPlayer([v], 0); }, renderHelpPage: renderHelpPage };

  function init() {
    var root = document.getElementById('hvRoot');
    if (root) {
      var q = new URLSearchParams(location.search);
      var preview = q.get('preview') === '1';
      if (preview) {
        var m = el('meta', { name: 'robots', content: 'noindex' }); document.head.appendChild(m);
        var note = document.getElementById('hvPreviewNote'); if (note) note.hidden = false;
      }
      renderHelpPage(root, preview);
      var want = q.get('v'); var wv = want && byId(want);
      if (wv && recorded(wv)) openPlayer([wv], 0);
      else if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t && t.scrollIntoView) t.scrollIntoView(); }
    } else {
      addPageButton();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
