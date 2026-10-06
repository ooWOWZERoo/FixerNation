/* Fixer Nation — shared admin sidebar navigation.
   Every admin page has an empty <aside class="a-sidebar"></aside> placeholder
   followed immediately by <script src="admin-nav.js?v=23"></script>.
   This script populates it synchronously and marks the active link. */
(function () {
  var aside = document.querySelector('.a-sidebar');
  if (!aside) return;

  var page = window.location.pathname.split('/').pop() || 'admin-dashboard.html';
  var STORAGE_KEY = 'fnAdminNavCollapsedSections';

  var ICONS = {"dashboard": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/>", "analytics": "<path d=\"M4 20V10m8 10V4m8 16v-7M2 22h20\"/>", "curriculum": "<path d=\"M12 5v16M3 4q5-2 9 1 4-3 9-1v15q-5-2-9 2-4-4-9-2z\"/>", "campaigns": "<path d=\"m3 10 17-6v15L3 14zM7 15l2 6h4l-2-5M20 9h2\"/>", "morning-boost": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2\"/>", "content-safety": "<path d=\"m12 2 9 4v6q-1 6-9 10-8-4-9-10V6z\"/><path d=\"m8 12 3 3 5-6\"/>", "account-lookup": "<circle cx=\"10\" cy=\"10\" r=\"7\"/><path d=\"m15 15 7 7\"/>", "settings": "<path d=\"M3 6h18M3 12h18M3 18h18\"/><circle cx=\"8\" cy=\"6\" r=\"2\"/><circle cx=\"16\" cy=\"12\" r=\"2\"/><circle cx=\"10\" cy=\"18\" r=\"2\"/>", "newsletter": "<rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/><path d=\"m2 5 10 8L22 5\"/>", "districts": "<path d=\"m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15\"/>", "school-admins": "<path d=\"m2 9 10-7 10 7M4 9h16v12H4zM9 21v-7h6v7\"/>", "affiliates": "<circle cx=\"8\" cy=\"7\" r=\"3\"/><circle cx=\"18\" cy=\"9\" r=\"2\"/><path d=\"M1 21v-4a7 7 0 0 1 14 0v4m1-7a5 5 0 0 1 7 5v2\"/>", "downloads": "<path d=\"M12 2v14m-5-5 5 5 5-5M3 16v5h18v-5\"/>", "automations": "<path d=\"m13 2-9 12h7l-1 8 10-13h-8z\"/>", "social": "<path d=\"M21 11a9 9 0 0 1-9 9H3l2-4a9 9 0 1 1 16-5z\"/><path d=\"M7 10h10m-10 4h6\"/>", "orders": "<path d=\"m3 7 9-5 9 5v11l-9 4-9-4zM3 7l9 5 9-5M12 12v10M7 4l10 5\"/>", "licenses": "<path d=\"M5 2h14v13H5zM8 15v7l4-3 4 3v-7M8 6h8M8 10h5\"/>", "quotes": "<path d=\"M4 3h16v14H9l-5 4zM8 7h8M8 11h6\"/>", "blogs": "<path d=\"M14 3H4v18h16V11M11 13l1-4 7-7 3 3-7 7z\"/>", "invoices": "<path d=\"M5 2h14v20l-3-2-4 2-4-2-3 2zM8 7h8M8 11h8M8 15h5\"/>"};
  function link(href, icon, label, extra) {
    var parent = {'admin-morning-boost-calendar.html':'admin-morning-boost.html','admin-concierge.html':'admin-quotes.html'};
    var active = page === href || parent[page] === href;
    var cls = active ? ' class="active" aria-current="page"' : '';
    var key = href.replace('admin-', '').replace('.html', '');
    if (key === 'morning-boost-email') key = 'newsletter';
    icon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[key] || ICONS.dashboard) + '</svg>';
    var attrs = extra || '';
    return '<a href="' + href + '"' + cls + attrs + '><span class="ic">' + icon + '</span><span class="label">' + label + '</span></a>';
  }

  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
  }

  var SECTIONS = [
    { key: 'sales-schools', cat: 'sales', label: 'Sales &amp; Schools', links: [
      link('admin-quotes.html',             '💬', 'Quotes'),
      link('admin-orders.html',             '📦', 'Orders'),
      link('admin-invoices.html',           '🧾', 'Invoices'),
      link('admin-licenses.html',           '🏷️', 'License Products'),
      link('admin-school-admins.html',      '🏫', 'School Admins'),
      link('admin-districts.html',          '🗺️', 'Districts'),
      link('admin-affiliates.html',         '🤝', 'Affiliates'),
      link('admin-account-lookup.html',     '🔎', 'Account Lookup'),
    ]},
    { key: 'content', cat: 'content', label: 'Content', links: [
      link('admin-curriculum.html',         '🎓', 'Curriculums'),
      link('admin-blogs.html',              '📝', 'Blogs'),
      link('admin-morning-boost.html',      '🌅', 'Morning Boost Studio'),
      link('admin-morning-boost-email.html','📨', 'Morning Boost Email'),
    ]},
    { key: 'marketing-crm', cat: 'marketing', label: 'Marketing &amp; CRM', links: [
      link('admin-newsletter.html',         '✉️', 'CRM'),
      link('admin-campaigns.html',          '📣', 'Campaigns'),
      link('admin-automations.html',        '🤖', 'Automations'),
    ]},
    { key: 'community', cat: 'neutral', label: 'Community', links: [
      link('admin-social.html',             '👥', 'Social'),
      link('admin-content-safety.html',     '🛡️', 'Content Safety'),
    ]},
    { key: 'reports', cat: 'neutral', label: 'Reports', links: [
      link('admin-downloads.html',          '⬇️', 'Downloads'),
      link('admin-analytics.html',          '👣', 'Visitor Paths'),
    ]},
  ];

  var collapsed = loadCollapsed();

  var sectionsHtml = SECTIONS.map(function (s) {
    // A section containing the current page always renders expanded,
    // regardless of stored state — never hide the page you're on.
    var hasActive = s.links.some(function (html) { return html.indexOf('class="active"') !== -1; });
    var isCollapsed = !hasActive && collapsed.indexOf(s.key) !== -1;
    var catAttr = s.cat ? ' data-cat="' + s.cat + '"' : '';
    return '<div class="a-nav-section' + (isCollapsed ? ' collapsed' : '') + '" data-key="' + s.key + '"' + catAttr + '>' +
      '<button type="button" class="a-nav-section-head" aria-expanded="' + (!isCollapsed) + '" data-key="' + s.key + '">' +
        '<span class="a-nav-section-label">' + s.label + '</span>' +
        '<span class="a-nav-section-arrow">▾</span>' +
      '</button>' +
      '<div class="a-nav-section-body">' + s.links.join('') + '</div>' +
    '</div>';
  }).join('');

  aside.innerHTML =
    '<div class="a-logo"><span class="a-logo-pill"><img src="logo-fne.png?v=2" alt="Fixer Nation Education" class="a-logo-img"></span></div>' +
    '<div class="a-nav-pinned">' +
      link('admin-dashboard.html', '📊', 'Mission Control') +
      '<div class="a-nav-divider"></div>' +
    '</div>' +
    '<nav class="a-nav" aria-label="Administration">' + sectionsHtml + '</nav>' +
    '<div class="a-sidebar-foot">' +
      link('admin-settings.html', '⚙️', 'Settings') +
      '<a href="index.html" target="_blank" rel="noopener"><span class="ic">↗</span><span class="label">View Site</span></a>' +
      '<a href="#" onclick="if(typeof fnLogout===\'function\')fnLogout();return false;"><span class="ic">⎋</span><span class="label">Log Out</span></a>' +
    '</div>';

  // Every click is a full page load (no client-side routing), so without
  // this the nav's own scroll position resets to the top on every single
  // navigation -- annoying once the link list no longer fits one screen.
  // sessionStorage (not localStorage) so it clears with the tab/session.
  var navEl = aside.querySelector('.a-nav');
  if (navEl) {
    var SCROLL_KEY = 'fnAdminNavScrollTop';
    var savedScroll = parseInt(sessionStorage.getItem(SCROLL_KEY), 10);
    if (!isNaN(savedScroll)) navEl.scrollTop = savedScroll;
    navEl.addEventListener('scroll', function () {
      sessionStorage.setItem(SCROLL_KEY, String(navEl.scrollTop));
    });
  }

  aside.querySelectorAll('.a-nav-section-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var key = head.getAttribute('data-key');
      var section = head.closest('.a-nav-section');
      var nowCollapsed = section.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!nowCollapsed));
      var stored = loadCollapsed();
      var idx = stored.indexOf(key);
      if (nowCollapsed && idx === -1) stored.push(key);
      if (!nowCollapsed && idx !== -1) stored.splice(idx, 1);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    });
  });
})();
