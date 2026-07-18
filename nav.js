/**
 * nav.js — Global site navigation for Fixer Nation public pages.
 * Include via <script src="nav.js"></script> just before site-auth.js.
 */
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────────────────
  // v3: explicit flex-wrap:nowrap + flex layout locks prevent page CSS from
  //     ever letting the nav wrap to a second line at any viewport width.
  if (!document.getElementById('fn-nav-css-v3')) {
    var s = document.createElement('style');
    s.id = 'fn-nav-css-v3';
    s.textContent =
      'a{text-decoration:none!important;}' +
      'header{background:#fff!important;box-shadow:0 1px 0 rgba(22,79,74,.09)!important;position:sticky!important;top:0!important;z-index:999!important;}' +
      // Outer row: self-contained layout — max-width + centering live here, not on any page .wrap
      '.nav{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:14px 24px!important;flex-wrap:nowrap!important;gap:0!important;max-width:1180px!important;margin:0 auto!important;}' +
      // Brand: never shrinks, text never breaks
      '.brand{display:flex!important;align-items:center!important;gap:12px!important;font-family:\'Fraunces\',serif!important;font-weight:700!important;font-size:21px!important;color:var(--teal-dark,#0E3733)!important;text-decoration:none!important;flex-shrink:0!important;white-space:nowrap!important;}' +
      '.brand-mark{width:42px!important;height:42px!important;border-radius:14px!important;background:linear-gradient(135deg,var(--coral,#F26B4D),var(--gold,#EBA657))!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:16px!important;font-weight:800!important;box-shadow:0 8px 18px -6px rgba(242,107,77,.6)!important;flex-shrink:0!important;}' +
      // Nav-links: fills middle space, centres items, NEVER wraps internally, clips overflow silently
      '.nav-links{display:flex!important;align-items:center!important;gap:18px!important;font-size:14px!important;font-weight:600!important;color:var(--ink,#2C3B33)!important;flex:1 1 0!important;min-width:0!important;justify-content:center!important;flex-wrap:nowrap!important;overflow:hidden!important;}' +
      '.nav-links>a,.fn-nav-parent{opacity:.8!important;transition:opacity .15s!important;text-decoration:none!important;color:inherit!important;white-space:nowrap!important;flex-shrink:0!important;}' +
      '.nav-links>a:hover,.nav-links>a.active,.fn-nav-parent:hover,.fn-nav-parent.active{opacity:1!important;color:var(--coral-dark,#D9502F)!important;}' +
      // CTA: never shrinks; gap locked to 14px overriding any page rule
      '.nav-cta{display:flex!important;align-items:center!important;gap:14px!important;flex-shrink:0!important;}' +
      '.fn-cart-btn{display:flex!important;align-items:center!important;justify-content:center!important;position:relative!important;width:38px!important;height:38px!important;border-radius:10px!important;color:var(--teal-dark,#0E3733)!important;text-decoration:none!important;transition:background .15s!important;}' +
      '.fn-cart-btn:hover{background:rgba(22,79,74,.08)!important;}' +
      '.fn-cart-btn svg{display:block!important;}' +
      '.fn-cart-badge{position:absolute!important;top:-4px!important;right:-4px!important;min-width:18px!important;height:18px!important;padding:0 4px!important;border-radius:9px!important;background:var(--coral,#F26B4D)!important;color:#fff!important;font-size:11px!important;font-weight:700!important;line-height:18px!important;text-align:center!important;box-sizing:border-box!important;display:none!important;}' +
      '.fn-cart-badge.visible{display:block!important;}' +
      // Dropdown
      '.fn-nav-dropdown{position:relative!important;display:flex!important;align-items:center!important;flex-shrink:0!important;}' +
      '.fn-nav-parent{display:flex!important;align-items:center!important;gap:4px!important;cursor:pointer!important;}' +
      '.fn-nav-caret{font-size:10px!important;opacity:.6!important;display:inline-block!important;transition:transform .15s!important;line-height:1!important;}' +
      '.fn-nav-menu{display:none!important;position:absolute!important;top:calc(100% + 8px)!important;left:-10px!important;background:#fff!important;border-radius:10px!important;box-shadow:0 8px 28px -8px rgba(22,79,74,.22)!important;min-width:130px!important;padding:5px 0!important;z-index:2000!important;}' +
      '.fn-nav-menu a{display:block!important;padding:9px 16px!important;font-size:13.5px!important;font-weight:600!important;opacity:.85!important;color:var(--ink,#2C3B33)!important;text-decoration:none!important;white-space:nowrap!important;transition:background .1s,color .1s!important;}' +
      '.fn-nav-menu a:hover,.fn-nav-menu a.active{background:rgba(22,79,74,.06)!important;opacity:1!important;color:var(--coral-dark,#D9502F)!important;}' +
      '.fn-nav-dropdown.open .fn-nav-menu{display:block!important;}' +
      '.fn-nav-dropdown.open .fn-nav-caret{transform:rotate(180deg)!important;}' +
      // Responsive: hide Join button when nav is tight; hide all links on mobile
      // Join button: fully self-contained — never inherits page .btn-primary color
      '.fn-nav-join{display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:10px 20px!important;border-radius:999px!important;font-weight:700!important;font-size:14px!important;font-family:\'Plus Jakarta Sans\',sans-serif!important;background:#F26B4D!important;color:#fff!important;border:none!important;cursor:pointer!important;white-space:nowrap!important;text-decoration:none!important;box-shadow:0 8px 20px -8px rgba(242,107,77,0.5)!important;transition:background .15s!important;letter-spacing:0!important;}' +
      '.fn-nav-join:hover{background:#D9502F!important;text-decoration:none!important;}' +
      '@media(max-width:1099px){.fn-nav-join{display:none!important;}}' +
      '@media(max-width:899px){.nav-links{display:none!important;}.nav{padding:12px 16px!important;}}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Active page detection ────────────────────────────────────────────────────
  var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || 'index';
  var homeActive    = page === 'index' || page === '';
  var aboutActive   = page === 'about';
  var booksActive   = page === 'books' || /^book-/.test(page);
  var blogActive    = page === 'blog';
  var netActive     = page === 'fnnetwork';
  var schoolsActive = page === 'education-portal' || page === 'education-schools' || page === 'programs' || page === 'why-fixer-nation' || page === 'school-licensing';
  var commActive    = page === 'social';
  var fixerActive   = page === 'askthefixer';

  function lnk(href, label, isActive) {
    return '<a href="' + href + '"' + (isActive ? ' class="active"' : '') + '>' + label + '</a>';
  }

  // ── Nav HTML ─────────────────────────────────────────────────────────────────
  var inner =
    '<div class="nav">' +
      '<a href="index.html" class="brand"><div class="brand-mark">FN</div> Fixer Nation</a>' +
      '<nav class="nav-links">' +
        lnk('index.html', 'Home',  homeActive)  +
        lnk('about.html', 'About', aboutActive) +
        lnk('books.html',           'Books',         booksActive)   +
        lnk('blog.html',            'FN Blogs',      blogActive)    +
        lnk('fnnetwork.html',       'FN Network',    netActive)     +
        '<div class="fn-nav-dropdown">' +
          '<span class="fn-nav-parent' + (schoolsActive ? ' active' : '') + '">Schools <span class="fn-nav-caret">▾</span></span>' +
          '<div class="fn-nav-menu">' +
            '<a href="education-portal.html"' + ((page === 'education-portal' || page === 'education-schools' || page === 'programs') ? ' class="active"' : '') + '>Education Portal</a>' +
            '<a href="why-fixer-nation.html"' + (page === 'why-fixer-nation' ? ' class="active"' : '') + '>Why We\'re Different</a>' +
            '<a href="school-licensing.html"' + (page === 'school-licensing' ? ' class="active"' : '') + '>School Licensing</a>' +
            '<a href="education-schools.html"' + (page === 'education-schools' ? ' class="active"' : '') + '>Teacher Registration</a>' +
          '</div>' +
        '</div>' +
        lnk('social.html',          'Community',     commActive)    +
        lnk('askthefixer.html',     'Ask The Fixer', fixerActive)   +
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
        '<a href="join.html" class="btn btn-primary fn-nav-join">Join Fixer Nation</a>' +
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

    // ── Dropdown: JS hover with hide-delay so mouse can travel to menu ─────────
    var dropdown = h.querySelector('.fn-nav-dropdown');
    var menu     = h.querySelector('.fn-nav-menu');
    var caret    = h.querySelector('.fn-nav-caret');
    var hideTimer;

    function openMenu() {
      clearTimeout(hideTimer);
      dropdown.classList.add('open');
    }

    function closeMenu() {
      hideTimer = setTimeout(function () {
        dropdown.classList.remove('open');
      }, 180);
    }

    if (dropdown) {
      dropdown.addEventListener('mouseenter', openMenu);
      dropdown.addEventListener('mouseleave', closeMenu);
      menu.addEventListener('mouseenter', openMenu);
      menu.addEventListener('mouseleave', closeMenu);

      dropdown.querySelector('.fn-nav-parent').addEventListener('click', function (e) {
        e.preventDefault();
        dropdown.classList.toggle('open');
      });

      document.addEventListener('click', function (e) {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
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
