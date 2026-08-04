/* Fixer Nation — shared admin sidebar navigation.
   Every admin page has an empty <aside class="a-sidebar"></aside> placeholder
   followed immediately by <script src="admin-nav.js?v=1"></script>.
   This script populates it synchronously and marks the active link. */
(function () {
  var aside = document.querySelector('.a-sidebar');
  if (!aside) return;

  var page = window.location.pathname.split('/').pop() || 'admin-dashboard.html';

  function link(href, icon, label, extra) {
    var cls = page === href ? ' class="active"' : '';
    var attrs = extra || '';
    return '<a href="' + href + '"' + cls + attrs + '><span class="ic">' + icon + '</span><span class="label">' + label + '</span></a>';
  }

  aside.innerHTML =
    '<div class="a-logo"><div class="mark">FN</div><div class="word">FN Admin</div></div>' +
    '<div class="a-nav-pinned">' +
      link('admin-dashboard.html', '📊', 'Dashboard') +
      '<div class="a-nav-divider"></div>' +
    '</div>' +
    '<nav class="a-nav">' +
      link('admin-automations.html',        '🤖', 'Automations') +
      link('admin-blogs.html',              '📝', 'Blogs') +
      link('admin-books.html',              '📚', 'Books') +
      link('admin-campaigns.html',          '📣', 'Campaigns') +
      link('admin-newsletter.html',         '✉️', 'CRM') +
      link('admin-curriculum.html',         '🎓', 'Curriculums') +
      link('admin-downloads.html',          '⬇️', 'Downloads') +
      link('admin-invoices.html',           '🧾', 'Invoices') +
      link('admin-licenses.html',           '🏫', 'Licenses') +
      link('admin-memberships.html',        '🪪', 'Memberships') +
      link('admin-morning-boost.html',      '🌅', 'Morning Boost Studio') +
      link('admin-morning-boost-email.html','📨', 'Morning Boost Email') +
      link('admin-orders.html',             '📦', 'Orders') +
      link('admin-quotes.html',             '💬', 'Quotes') +
      link('admin-school-admins.html',      '🏫', 'School Admins') +
      link('admin-social.html',             '💬', 'Social') +
      link('admin-analytics.html',          '👣', 'Visitor Paths') +
    '</nav>' +
    '<div class="a-sidebar-foot">' +
      link('admin-settings.html', '⚙️', 'Settings') +
      '<a href="index.html" target="_blank" rel="noopener"><span class="ic">↗</span><span class="label">View Site</span></a>' +
      '<a href="#" onclick="if(typeof fnLogout===\'function\')fnLogout();return false;"><span class="ic">⎋</span><span class="label">Log Out</span></a>' +
    '</div>';
})();
