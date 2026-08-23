/**
 * nav.js — Education-only navigation for Fixer Nation Education.
 */
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────────────────
  if (!document.getElementById('fn-nav-css-v13')) {
    var s = document.createElement('style');
    s.id = 'fn-nav-css-v13';
    s.textContent =
      'a{text-decoration:none!important;}' +
      'header{background:#fff!important;box-shadow:0 1px 0 rgba(22,79,74,.09)!important;position:sticky!important;top:0!important;z-index:999!important;}' +
      '.nav{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:14px 24px!important;flex-wrap:nowrap!important;gap:0!important;max-width:1180px!important;margin:0 auto!important;}' +
      '.brand{display:flex!important;align-items:center!important;gap:12px!important;text-decoration:none!important;flex-shrink:0!important;white-space:nowrap!important;}' +
      '.brand-logo{height:100px!important;width:auto!important;display:block!important;flex-shrink:0!important;}' +
      '.nav-links{display:flex!important;align-items:center!important;gap:14px!important;font-size:14px!important;font-weight:600!important;color:var(--ink,#2C3B33)!important;flex:1 1 0!important;min-width:0!important;justify-content:center!important;flex-wrap:nowrap!important;}' +
      '.nav-links>a{opacity:.8!important;transition:opacity .15s!important;text-decoration:none!important;color:inherit!important;white-space:nowrap!important;flex-shrink:0!important;}' +
      '.nav-links>a:hover,.nav-links>a.active{opacity:1!important;color:var(--coral-dark,#D9502F)!important;}' +
      '.fn-nav-parent{background:none!important;border:none!important;padding:0!important;cursor:pointer!important;font-family:inherit!important;font-size:14px!important;font-weight:600!important;color:var(--ink,#2C3B33)!important;opacity:.8!important;transition:opacity .15s,color .15s!important;white-space:nowrap!important;display:flex!important;align-items:center!important;gap:4px!important;}' +
      '.fn-nav-parent:hover,.fn-nav-parent.active{opacity:1!important;color:var(--coral-dark,#D9502F)!important;}' +
      '.nav-cta{display:flex!important;align-items:center!important;gap:14px!important;flex-shrink:0!important;}' +
      '.fn-cart-btn{display:flex!important;align-items:center!important;justify-content:center!important;position:relative!important;width:38px!important;height:38px!important;border-radius:10px!important;color:var(--teal-dark,#0E3733)!important;text-decoration:none!important;transition:background .15s!important;}' +
      '.fn-cart-btn:hover{background:rgba(22,79,74,.08)!important;}' +
      '.fn-cart-btn svg{display:block!important;}' +
      '.fn-cart-badge{position:absolute!important;top:-4px!important;right:-4px!important;min-width:18px!important;height:18px!important;padding:0 4px!important;border-radius:9px!important;background:var(--coral,#F26B4D)!important;color:#fff!important;font-size:11px!important;font-weight:700!important;line-height:18px!important;text-align:center!important;box-sizing:border-box!important;display:none!important;}' +
      '.fn-cart-badge.visible{display:block!important;}' +
      '.fn-nav-dropdown{position:relative!important;display:flex!important;align-items:center!important;flex-shrink:0!important;}' +
      '.fn-nav-caret{font-size:10px!important;opacity:.6!important;display:inline-block!important;transition:transform .15s!important;line-height:1!important;}' +
      '.fn-nav-menu{display:none!important;position:absolute!important;top:calc(100% + 8px)!important;left:-10px!important;background:#fff!important;border-radius:10px!important;box-shadow:0 8px 28px -8px rgba(22,79,74,.22)!important;min-width:150px!important;padding:5px 0!important;z-index:2000!important;}' +
      '.fn-nav-menu a{display:block!important;padding:9px 16px!important;font-size:13.5px!important;font-weight:600!important;opacity:.85!important;color:var(--ink,#2C3B33)!important;text-decoration:none!important;white-space:nowrap!important;transition:background .1s,color .1s!important;}' +
      '.fn-nav-menu a:hover,.fn-nav-menu a.active{background:rgba(22,79,74,.06)!important;opacity:1!important;color:var(--coral-dark,#D9502F)!important;}' +
      '.fn-nav-dropdown.open .fn-nav-menu,.fn-nav-dropdown:hover .fn-nav-menu{display:block!important;}' +
      '.fn-nav-dropdown.open .fn-nav-caret{transform:rotate(180deg)!important;}' +
      '.fn-nav-menu-right{left:auto!important;right:0!important;}' +
      '.fn-nav-login{display:inline-flex!important;align-items:center!important;gap:4px!important;padding:9px 18px!important;border-radius:999px!important;font-weight:700!important;font-size:14px!important;font-family:\'Plus Jakarta Sans\',sans-serif!important;background:rgba(14,55,51,0.08)!important;color:var(--teal-dark,#0E3733)!important;border:none!important;cursor:pointer!important;white-space:nowrap!important;transition:background .15s!important;}' +
      '.fn-nav-login:hover,.fn-nav-login.active{background:rgba(14,55,51,0.14)!important;color:var(--teal-dark,#0E3733)!important;}' +
      '@media(max-width:899px){.nav-links{display:none!important;}.nav{padding:12px 16px!important;}}' +
      '.fn-user-authed .fn-login-dd{display:none!important;}' +
      '.fn-user-authed .fn-mm-login-group{display:none!important;}' +
      '.fn-nav-toggle{display:none!important;align-items:center!important;justify-content:center!important;width:38px!important;height:38px!important;border-radius:10px!important;border:none!important;background:none!important;padding:0!important;cursor:pointer!important;color:var(--teal-dark,#0E3733)!important;flex-shrink:0!important;}' +
      '.fn-nav-toggle:hover{background:rgba(22,79,74,.08)!important;}' +
      '.fn-nav-toggle svg{display:block!important;}' +
      '.fn-mobile-menu{display:none!important;}' +
      '.fn-mobile-menu .fn-mm-label{padding:14px 20px 6px!important;font-size:11px!important;font-weight:800!important;letter-spacing:.06em!important;text-transform:uppercase!important;color:var(--ink-soft,#6B5F55)!important;opacity:.65!important;}' +
      '.fn-mobile-menu a{display:block!important;padding:11px 20px!important;font-size:15.5px!important;font-weight:600!important;color:var(--ink,#2C3B33)!important;text-decoration:none!important;}' +
      '.fn-mobile-menu a.active{color:var(--coral-dark,#D9502F)!important;}' +
      '.fn-mobile-menu a:active{background:rgba(22,79,74,.06)!important;}' +
      '.fn-mm-divider{height:1px!important;background:rgba(22,79,74,.1)!important;margin:10px 20px!important;}' +
      '@media(max-width:899px){' +
        '.fn-nav-toggle{display:flex!important;}' +
        // -webkit-overflow-scrolling + touch-action are load-bearing on real
        // phones, not just nice-to-have: a non-body overflow:auto box can
        // render a working scrollbar yet still not respond to an actual
        // finger swipe on mobile Safari without them — confirmed working via
        // el.scrollTop in headless Chromium, which does NOT catch this. The
        // 100dvh line is a progressive enhancement after the 100vh fallback
        // (invalid units get skipped, not overwritten) — 100vh includes the
        // address bar's reserved space on mobile Safari even when it's
        // hidden, so max-height can end up taller than what's actually
        // touchable on screen; 100dvh tracks the real visible viewport.
        '.fn-mobile-menu.open{display:block!important;position:absolute!important;top:100%!important;left:0!important;right:0!important;background:#fff!important;box-shadow:0 16px 32px -12px rgba(22,79,74,.3)!important;max-height:calc(100vh - 68px)!important;max-height:calc(100dvh - 68px)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important;padding:8px 0 16px!important;z-index:1500!important;}' +
        // The 4 login links now live in the mobile menu too (below), so the
        // separate "Log In ▾" dropdown button would just be a second,
        // redundant way to reach them — and one more ~110px item the
        // already-tight mobile top bar (brand + cart + this + hamburger)
        // doesn't have room for. #fnAuthNav's account menu stays, since
        // that's the one top-bar action a logged-in user needs at a glance.
        '.fn-login-dd{display:none!important;}' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Active page detection ────────────────────────────────────────────────────
  var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || 'index';

  var whyActive       = page === 'why-fixer-nation';
  var aboutActive     = page === 'about';
  var howActive       = page === 'how-it-works';
  var teachersActive  = page === 'for-teachers';
  var schoolsActive   = page === 'for-schools';
  var parentsActive   = page === 'for-parents';
  var studentsActive  = page === 'for-students';
  var programsActive  = page === 'programs';
  var libraryActive        = page === 'education-portal';
  var morningBoostActive   = page === 'morning-boost-blog';
  var researchActive  = page === 'research';
  var pricingActive   = page === 'school-licensing' || page === 'licenses' || page === 'education-schools';
  var brainActive     = page === 'brain-games' || page.indexOf('brain-') === 0;
  var communityActive = page === 'social' || page === 'social-profile' || page === 'fnnetwork';
  var loginActive     = page === 'teacher-classrooms' || page === 'teacher-classroom' ||
                       page === 'teacher-classroom-progress' ||
                       page === 'student-login' || page === 'student-home' || page === 'student-lesson' ||
                       page === 'school-admin-login' || page === 'school-admin-dashboard' ||
                       page === 'teacher-login' || page === 'parent-login' || page === 'parent-portal';

  function lnk(href, label, isActive) {
    return '<a href="' + href + '"' + (isActive ? ' class="active"' : '') + '>' + label + '</a>';
  }

  var ICON_MENU  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  var ICON_CLOSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

  function mmLabel(text) { return '<div class="fn-mm-label">' + text + '</div>'; }

  // ── Nav HTML ─────────────────────────────────────────────────────────────────
  var inner =
    '<div class="nav">' +
      '<a href="index.html" class="brand"><img src="logo-fne.png" alt="Fixer Nation Education" class="brand-logo"></a>' +
      '<nav class="nav-links">' +
        '<div class="fn-nav-dropdown">' +
          '<button class="fn-nav-parent' + (whyActive || researchActive || aboutActive ? ' active' : '') + '">Why FNE <span class="fn-nav-caret">&#9662;</span></button>' +
          '<div class="fn-nav-menu">' +
            '<a href="why-fixer-nation.html"' + (whyActive      ? ' class="active"' : '') + '>Why FNE</a>'    +
            '<a href="research.html"'          + (researchActive ? ' class="active"' : '') + '>Research</a>'   +
            '<a href="about.html"'             + (aboutActive    ? ' class="active"' : '') + '>About</a>'       +
          '</div>' +
        '</div>' +
        '<div class="fn-nav-dropdown">' +
          '<button class="fn-nav-parent' + (howActive || teachersActive || schoolsActive || parentsActive || studentsActive || programsActive ? ' active' : '') + '">Explore <span class="fn-nav-caret">&#9662;</span></button>' +
          '<div class="fn-nav-menu">' +
            '<a href="how-it-works.html"'  + (howActive      ? ' class="active"' : '') + '>How It Works</a>'  +
            '<a href="programs.html"'      + (programsActive ? ' class="active"' : '') + '>Programs</a>'      +
            '<a href="for-teachers.html"'  + (teachersActive ? ' class="active"' : '') + '>For Teachers</a>'  +
            '<a href="for-schools.html"'   + (schoolsActive  ? ' class="active"' : '') + '>For Schools</a>'   +
            '<a href="for-parents.html"'   + (parentsActive  ? ' class="active"' : '') + '>For Parents</a>'   +
            '<a href="for-students.html"'  + (studentsActive ? ' class="active"' : '') + '>For Students</a>'  +
          '</div>' +
        '</div>' +
        lnk('education-portal.html',    'Lesson Library', libraryActive)       +
        lnk('morning-boost-blog.html', 'Morning Boost',  morningBoostActive)  +
        lnk('school-licensing.html',   'Pricing',        pricingActive)       +
        lnk('brain-games.html',      'Brain Games',    brainActive)    +
        '<a href="social.html"' + (communityActive ? ' class="active"' : '') + ' style="position:relative;padding-right:4px;">Community<span id="fnCommunityBadge" style="display:none;position:absolute;top:-9px;right:-12px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--coral,#F26B4D);color:#fff;font-size:10px;font-weight:700;line-height:18px;text-align:center;box-sizing:border-box;border:2px solid #fff;font-family:\'Plus Jakarta Sans\',sans-serif;pointer-events:none;"></span></a>' +
      '</nav>' +
      '<div class="nav-cta">' +
        '<a href="cart.html" class="fn-cart-btn" title="Cart">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="9" cy="21" r="1"/>' +
            '<circle cx="20" cy="21" r="1"/>' +
            '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' +
          '</svg>' +
          '<span class="fn-cart-badge" id="fnCartBadge"></span>' +
        '</a>' +
        '<div id="fnAuthNav"></div>' +
        '<div class="fn-nav-dropdown fn-login-dd">' +
          '<button class="fn-nav-login' + (loginActive ? ' active' : '') + '">Log In <span class="fn-nav-caret">&#9662;</span></button>' +
          '<div class="fn-nav-menu fn-nav-menu-right">' +
            '<a href="teacher-login.html"' + (page === 'teacher-classrooms' || page === 'teacher-classroom' || page === 'teacher-classroom-progress' || page === 'teacher-login' ? ' class="active"' : '') + '>Teacher Login</a>' +
            '<a href="student-login.html"' + (page === 'student-login' || page === 'student-home' || page === 'student-lesson' ? ' class="active"' : '') + '>Student Login</a>' +
            '<a href="parent-login.html"'  + (page === 'parent-login' || page === 'parent-portal' ? ' class="active"' : '') + '>Parent Login</a>'  +
            '<a href="school-admin-login.html"' + (page === 'school-admin-login' || page === 'school-admin-dashboard' ? ' class="active"' : '') + '>School Admin</a>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="fn-nav-toggle" id="fnNavToggle" aria-label="Menu" aria-expanded="false" aria-controls="fnMobileMenu">' + ICON_MENU + '</button>' +
      '</div>' +
    '</div>' +
    '<nav class="fn-mobile-menu" id="fnMobileMenu">' +
      mmLabel('Why FNE') +
      lnk('why-fixer-nation.html', 'Why FNE', whyActive) +
      lnk('research.html',         'Research', researchActive) +
      lnk('about.html',            'About', aboutActive) +
      mmLabel('Explore') +
      lnk('how-it-works.html',  'How It Works', howActive) +
      lnk('programs.html',      'Programs', programsActive) +
      lnk('for-teachers.html',  'For Teachers', teachersActive) +
      lnk('for-schools.html',   'For Schools', schoolsActive) +
      lnk('for-parents.html',   'For Parents', parentsActive) +
      lnk('for-students.html',  'For Students', studentsActive) +
      '<div class="fn-mm-divider"></div>' +
      lnk('education-portal.html',   'Lesson Library', libraryActive) +
      lnk('morning-boost-blog.html', 'Morning Boost', morningBoostActive) +
      lnk('school-licensing.html',   'Pricing', pricingActive) +
      lnk('brain-games.html',        'Brain Games', brainActive) +
      lnk('social.html',             'Community', communityActive) +
      '<div class="fn-mm-login-group">' +
        '<div class="fn-mm-divider"></div>' +
        mmLabel('Log In') +
        '<a href="teacher-login.html"' + (page === 'teacher-classrooms' || page === 'teacher-classroom' || page === 'teacher-classroom-progress' || page === 'teacher-login' ? ' class="active"' : '') + '>Teacher Login</a>' +
        '<a href="student-login.html"' + (page === 'student-login' || page === 'student-home' || page === 'student-lesson' ? ' class="active"' : '') + '>Student Login</a>' +
        '<a href="parent-login.html"'  + (page === 'parent-login' || page === 'parent-portal' ? ' class="active"' : '') + '>Parent Login</a>'  +
        '<a href="school-admin-login.html"' + (page === 'school-admin-login' || page === 'school-admin-dashboard' ? ' class="active"' : '') + '>School Admin</a>' +
      '</div>' +
    '</nav>';

  // ── Inject ───────────────────────────────────────────────────────────────────
  function inject() {
    var h = document.querySelector('header');
    if (!h) {
      h = document.createElement('header');
      document.body.insertBefore(h, document.body.firstChild);
    }
    h.innerHTML = inner;

    // Dropdown: hover with hide-delay so mouse can travel to menu
    var dropdowns = h.querySelectorAll('.fn-nav-dropdown');
    dropdowns.forEach(function (dropdown) {
      var menu = dropdown.querySelector('.fn-nav-menu');
      var hideTimer;

      function openMenu()  { clearTimeout(hideTimer); dropdown.classList.add('open'); }
      function closeMenu() { hideTimer = setTimeout(function () { dropdown.classList.remove('open'); }, 180); }

      dropdown.addEventListener('mouseenter', openMenu);
      dropdown.addEventListener('mouseleave', closeMenu);
      if (menu) {
        menu.addEventListener('mouseenter', openMenu);
        menu.addEventListener('mouseleave', closeMenu);
      }

      var trigger = dropdown.querySelector('.fn-nav-login, .fn-nav-parent');
      if (trigger) {
        trigger.addEventListener('click', function (e) {
          e.preventDefault();
          dropdowns.forEach(function (d) { if (d !== dropdown) d.classList.remove('open'); });
          dropdown.classList.toggle('open');
        });
      }
    });

    document.addEventListener('click', function (e) {
      dropdowns.forEach(function (d) { if (!d.contains(e.target)) d.classList.remove('open'); });
    });

    // Mobile menu: hamburger toggle + close on outside click, Escape, or
    // resizing back up to desktop width (where .nav-links is visible again
    // and the mobile panel would otherwise be left stuck open underneath).
    var navToggle = h.querySelector('.fn-nav-toggle');
    var mobileMenu = h.querySelector('.fn-mobile-menu');
    if (navToggle && mobileMenu) {
      function setMobileMenuOpen(open) {
        mobileMenu.classList.toggle('open', open);
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        navToggle.innerHTML = open ? ICON_CLOSE : ICON_MENU;
      }
      navToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        setMobileMenuOpen(!mobileMenu.classList.contains('open'));
      });
      document.addEventListener('click', function (e) {
        if (mobileMenu.classList.contains('open') && !mobileMenu.contains(e.target) && !navToggle.contains(e.target)) {
          setMobileMenuOpen(false);
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && mobileMenu.classList.contains('open')) setMobileMenuOpen(false);
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth >= 900 && mobileMenu.classList.contains('open')) setMobileMenuOpen(false);
      });
    }

    // Sync cart badge in case cart.js ran before nav.js injected the DOM
    if (typeof cartRenderBadge === 'function') cartRenderBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
