/**
 * nav.js — Global site navigation for Fixer Nation public pages.
 * Include via <script src="nav.js" defer></script> in <head>.
 * Replaces <header></header> placeholder with the full nav.
 */
(function () {
  'use strict';

  // ── CSS ──────────────────────────────────────────────────────────────────────
  if (!document.getElementById('fn-nav-css')) {
    var s = document.createElement('style');
    s.id = 'fn-nav-css';
    s.textContent =
      'header{background:#fff;box-shadow:0 1px 0 rgba(22,79,74,.09);position:sticky;top:0;z-index:999;}' +
      '.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;}' +
      '.brand{display:flex;align-items:center;gap:12px;font-family:\'Fraunces\',serif;font-weight:700;font-size:21px;color:var(--teal-dark,#0E3733);text-decoration:none;}' +
      '.brand-mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--coral,#F26B4D),var(--gold,#EBA657));color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;box-shadow:0 8px 18px -6px rgba(242,107,77,.6);}' +
      '.nav-links{display:flex;align-items:center;gap:30px;font-size:14.5px;font-weight:600;color:var(--ink,#2C3B33);}' +
      '.nav-links>a,.fn-nav-parent{opacity:.8;transition:opacity .15s;text-decoration:none;color:inherit;}' +
      '.nav-links>a:hover,.nav-links>a.active,.fn-nav-parent:hover,.fn-nav-parent.active{opacity:1;color:var(--coral-dark,#D9502F);}' +
      '.nav-cta{display:flex;align-items:center;gap:18px;}' +
      // Dropdown
      '.fn-nav-dropdown{position:relative;display:flex;align-items:center;padding-bottom:12px;margin-bottom:-12px;}' +
      '.fn-nav-parent{display:flex;align-items:center;gap:4px;cursor:pointer;}' +
      '.fn-nav-caret{font-size:10px;opacity:.6;display:inline-block;transition:transform .15s;line-height:1;}' +
      '.fn-nav-menu{display:none;position:absolute;top:100%;left:-10px;background:#fff;border-radius:10px;box-shadow:0 8px 28px -8px rgba(22,79,74,.22);min-width:130px;padding:5px 0;z-index:2000;}' +
      '.fn-nav-menu a{display:block;padding:9px 16px;font-size:13.5px;font-weight:600;opacity:.85;color:var(--ink,#2C3B33);text-decoration:none;white-space:nowrap;transition:background .1s,color .1s;}' +
      '.fn-nav-menu a:hover,.fn-nav-menu a.active{background:rgba(22,79,74,.06);opacity:1;color:var(--coral-dark,#D9502F);}' +
      '.fn-nav-dropdown:hover .fn-nav-menu,.fn-nav-dropdown.open .fn-nav-menu{display:block;}' +
      '.fn-nav-dropdown:hover .fn-nav-caret,.fn-nav-dropdown.open .fn-nav-caret{transform:rotate(180deg);}' +
      // Mobile
      '@media(max-width:767px){.nav-links{display:none;}.nav{padding:14px 20px;}}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Active page detection ────────────────────────────────────────────────────
  var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '') || 'index';
  var homeActive  = page === 'index' || page === 'about' || page === '';
  var aboutActive = page === 'about';
  var booksActive = page === 'books' || /^book-/.test(page);
  var blogActive  = page === 'blog';
  var netActive   = page === 'fnnetwork';
  var schoolsActive = page === 'education-portal' || page === 'education-schools' || page === 'programs';
  var commActive  = page === 'social';
  var fixerActive = page === 'askthefixer';

  function lnk(href, label, isActive) {
    return '<a href="' + href + '"' + (isActive ? ' class="active"' : '') + '>' + label + '</a>';
  }

  // ── Nav HTML ─────────────────────────────────────────────────────────────────
  var inner =
    '<div class="nav wrap">' +
      '<a href="index.html" class="brand"><div class="brand-mark">FN</div> Fixer Nation</a>' +
      '<nav class="nav-links">' +
        '<div class="fn-nav-dropdown">' +
          '<a href="index.html" class="fn-nav-parent' + (homeActive ? ' active' : '') + '">' +
            'Home <span class="fn-nav-caret">▾</span>' +
          '</a>' +
          '<div class="fn-nav-menu">' +
            lnk('about.html', 'About', aboutActive) +
          '</div>' +
        '</div>' +
        lnk('books.html',          'Books',         booksActive) +
        lnk('blog.html',           'FN Blogs',      blogActive)  +
        lnk('fnnetwork.html',      'FN Network',    netActive)   +
        lnk('education-portal.html','Schools',      schoolsActive) +
        lnk('social.html',         'Community',     commActive)  +
        lnk('askthefixer.html',    'Ask The Fixer', fixerActive) +
      '</nav>' +
      '<div class="nav-cta">' +
        '<div id="fnCartNav"></div>' +
        '<div id="fnAuthNav"><a href="#" onclick="if(typeof fnAuthOpenModal===\'function\')fnAuthOpenModal(\'login\');return false;" style="font-weight:600;font-size:14px;">Log In</a></div>' +
        '<a href="join.html" class="btn btn-primary">Join Fixer Nation</a>' +
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
