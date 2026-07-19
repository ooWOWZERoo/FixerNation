/**
 * nav.js — Education-only navigation for Fixer Nation Education.
 */
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────────────────
  if (!document.getElementById('fn-nav-css-v7')) {
    var s = document.createElement('style');
    s.id = 'fn-nav-css-v7';
    s.textContent =
      'a{text-decoration:none!important;}' +
      'header{background:#fff!important;box-shadow:0 1px 0 rgba(22,79,74,.09)!important;position:sticky!important;top:0!important;z-index:999!important;}' +
      '.nav{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:14px 24px!important;flex-wrap:nowrap!important;gap:0!important;max-width:1180px!important;margin:0 auto!important;}' +
      '.brand{display:flex!important;align-items:center!important;gap:12px!important;font-family:\'Fraunces\',serif!important;font-weight:700!important;font-size:18px!important;color:var(--teal-dark,#0E3733)!important;text-decoration:none!important;flex-shrink:0!important;white-space:nowrap!important;}' +
      '.brand-mark{width:42px!important;height:42px!important;border-radius:14px!important;background:linear-gradient(135deg,var(--coral,#F26B4D),var(--gold,#EBA657))!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;gap:0!important;font-size:16px!important;font-weight:800!important;box-shadow:0 8px 18px -6px rgba(242,107,77,.6)!important;flex-shrink:0!important;}' +
      '.bm-init{font-size:13px!important;font-weight:800!important;line-height:1.1!important;}' +
      '.bm-sub{font-size:7.5px!important;font-weight:700!important;letter-spacing:0.1em!important;opacity:0.8!important;line-height:1!important;}' +
      '.nav-links{display:flex!important;align-items:center!important;gap:10px!important;font-size:14px!important;font-weight:600!important;color:var(--ink,#2C3B33)!important;flex:1 1 0!important;min-width:0!important;justify-content:center!important;flex-wrap:nowrap!important;overflow:hidden!important;}' +
      '.nav-links>a{opacity:.8!important;transition:opacity .15s!important;text-decoration:none!important;color:inherit!important;white-space:nowrap!important;flex-shrink:0!important;}' +
      '.nav-links>a:hover,.nav-links>a.active{opacity:1!important;color:var(--coral-dark,#D9502F)!important;}' +
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
      '.fn-nav-dropdown.open .fn-nav-menu{display:block!important;}' +
      '.fn-nav-dropdown.open .fn-nav-caret{transform:rotate(180deg)!important;}' +
      '.fn-nav-menu-right{left:auto!important;right:0!important;}' +
      '.fn-nav-login{display:inline-flex!important;align-items:center!important;gap:4px!important;padding:9px 18px!important;border-radius:999px!important;font-weight:700!important;font-size:14px!important;font-family:\'Plus Jakarta Sans\',sans-serif!important;background:rgba(14,55,51,0.08)!important;color:var(--teal-dark,#0E3733)!important;border:none!important;cursor:pointer!important;white-space:nowrap!important;transition:background .15s!important;}' +
      '.fn-nav-login:hover,.fn-nav-login.active{background:rgba(14,55,51,0.14)!important;color:var(--teal-dark,#0E3733)!important;}' +
      '@media(max-width:899px){.nav-links{display:none!important;}.nav{padding:12px 16px!important;}}' +
      '.fn-user-authed .fn-login-dd{display:none!important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Active page detection ────────────────────────────────────────────────────
  var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || 'index';

  var whyActive       = page === 'why-fixer-nation';
  var howActive       = page === 'how-it-works';
  var teachersActive  = page === 'for-teachers';
  var schoolsActive   = page === 'for-schools';
  var libraryActive   = page === 'education-portal';
  var researchActive  = page === 'research';
  var pricingActive   = page === 'school-licensing' || page === 'licenses' || page === 'education-schools';
  var brainActive     = page === 'brain-games' || page.indexOf('brain-') === 0;
  var communityActive = page === 'social' || page === 'social-profile' || page === 'fnnetwork';
  var loginActive     = page === 'teacher-classrooms' || page === 'teacher-classroom' ||
                       page === 'teacher-classroom-progress' ||
                       page === 'student-login' || page === 'student-home' || page === 'student-lesson' ||
                       page === 'school-admin-login' || page === 'school-admin-dashboard' ||
                       page === 'teacher-login';

  function lnk(href, label, isActive) {
    return '<a href="' + href + '"' + (isActive ? ' class="active"' : '') + '>' + label + '</a>';
  }

  // ── Nav HTML ─────────────────────────────────────────────────────────────────
  var inner =
    '<div class="nav">' +
      '<a href="index.html" class="brand"><div class="brand-mark"><span class="bm-init">FNE</span><span class="bm-sub">SEL</span></div> Fixer Nation Education</a>' +
      '<nav class="nav-links">' +
        lnk('why-fixer-nation.html', 'Why FNE',        whyActive)      +
        lnk('how-it-works.html',     'How It Works',   howActive)      +
        lnk('for-teachers.html',     'For Teachers',   teachersActive) +
        lnk('for-schools.html',      'For Schools',    schoolsActive)  +
        lnk('education-portal.html', 'Lesson Library', libraryActive)  +
        lnk('brain-games.html',      'Brain Games',    brainActive)    +
        lnk('social.html',           'Community',      communityActive)+
        lnk('research.html',         'Research',       researchActive) +
        lnk('school-licensing.html', 'Pricing',        pricingActive)  +
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
            '<a href="school-admin-login.html"' + (page === 'school-admin-login' || page === 'school-admin-dashboard' ? ' class="active"' : '') + '>School Admin</a>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

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

    // Sync cart badge in case cart.js ran before nav.js injected the DOM
    if (typeof cartRenderBadge === 'function') cartRenderBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
