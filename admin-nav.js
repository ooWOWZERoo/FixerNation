/* Fixer Nation — shared admin sidebar navigation.
   Every admin page has an empty <aside class="a-sidebar"></aside> placeholder
   followed immediately by <script src="admin-nav.js?v=1"></script>.
   This script populates it synchronously and marks the active link. */
(function () {
  var aside = document.querySelector('.a-sidebar');
  if (!aside) return;

  var page = window.location.pathname.split('/').pop() || 'admin-dashboard.html';
  var STORAGE_KEY = 'fnAdminNavCollapsedSections';

  function link(href, icon, label, extra) {
    var cls = page === href ? ' class="active"' : '';
    var attrs = extra || '';
    return '<a href="' + href + '"' + cls + attrs + '><span class="ic">' + icon + '</span><span class="label">' + label + '</span></a>';
  }

  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
  }

  var SECTIONS = [
    { key: 'sales-schools', label: 'Sales &amp; Schools', links: [
      link('admin-quotes.html',             '💬', 'Quotes'),
      link('admin-orders.html',             '📦', 'Orders'),
      link('admin-invoices.html',           '🧾', 'Invoices'),
      link('admin-licenses.html',           '🏷️', 'License Products'),
      link('admin-school-admins.html',      '🏫', 'School Admins'),
      link('admin-districts.html',          '🗺️', 'Districts'),
      link('admin-account-lookup.html',     '🔎', 'Account Lookup'),
    ]},
    { key: 'content', label: 'Content', links: [
      link('admin-curriculum.html',         '🎓', 'Curriculums'),
      link('admin-blogs.html',              '📝', 'Blogs'),
      link('admin-morning-boost.html',      '🌅', 'Morning Boost Studio'),
      link('admin-morning-boost-email.html','📨', 'Morning Boost Email'),
    ]},
    { key: 'marketing-crm', label: 'Marketing &amp; CRM', links: [
      link('admin-newsletter.html',         '✉️', 'CRM'),
      link('admin-campaigns.html',          '📣', 'Campaigns'),
      link('admin-automations.html',        '🤖', 'Automations'),
    ]},
    { key: 'community', label: 'Community', links: [
      link('admin-social.html',             '👥', 'Social'),
      link('admin-content-safety.html',     '🛡️', 'Content Safety'),
    ]},
    { key: 'reports', label: 'Reports', links: [
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
    return '<div class="a-nav-section' + (isCollapsed ? ' collapsed' : '') + '" data-key="' + s.key + '">' +
      '<button type="button" class="a-nav-section-head" data-key="' + s.key + '">' +
        '<span class="a-nav-section-label">' + s.label + '</span>' +
        '<span class="a-nav-section-arrow">▾</span>' +
      '</button>' +
      '<div class="a-nav-section-body">' + s.links.join('') + '</div>' +
    '</div>';
  }).join('');

  aside.innerHTML =
    '<div class="a-logo"><span class="a-logo-pill"><img src="logo-fne.png?v=2" alt="Fixer Nation Education" class="a-logo-img"></span></div>' +
    '<div class="a-nav-pinned">' +
      link('admin-dashboard.html', '📊', 'Dashboard') +
      '<div class="a-nav-divider"></div>' +
    '</div>' +
    '<nav class="a-nav">' + sectionsHtml + '</nav>' +
    '<div class="a-sidebar-foot">' +
      link('admin-settings.html', '⚙️', 'Settings') +
      '<a href="index.html" target="_blank" rel="noopener"><span class="ic">↗</span><span class="label">View Site</span></a>' +
      '<a href="#" onclick="if(typeof fnLogout===\'function\')fnLogout();return false;"><span class="ic">⎋</span><span class="label">Log Out</span></a>' +
    '</div>';

  aside.querySelectorAll('.a-nav-section-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var key = head.getAttribute('data-key');
      var section = head.closest('.a-nav-section');
      var nowCollapsed = section.classList.toggle('collapsed');
      var stored = loadCollapsed();
      var idx = stored.indexOf(key);
      if (nowCollapsed && idx === -1) stored.push(key);
      if (!nowCollapsed && idx !== -1) stored.splice(idx, 1);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    });
  });
})();
