/* School License Administrator Portal — shared sidebar nav.
   Every portal page has <aside class="sa-sidebar"></aside>
   followed by <script src="school-admin-nav.js?v=1"></script>. */
(function () {
  var aside = document.querySelector('.sa-sidebar');
  if (!aside) return;

  var page = window.location.pathname.split('/').pop() || 'school-admin-dashboard.html';

  function link(href, icon, label) {
    var cls = page === href ? ' class="active"' : '';
    return '<a href="' + href + '"' + cls + '><span class="ic">' + icon + '</span><span class="label">' + label + '</span></a>';
  }

  aside.innerHTML =
    '<div class="sa-logo">' +
      '<div class="mark">FN</div>' +
      '<div class="word">School Admin<span class="sub">Portal</span></div>' +
    '</div>' +
    '<div class="sa-school-select" id="saSchoolSelectWrap" style="display:none;">' +
      '<select id="saSchoolSelect" onchange="saSelectSchool(this.value)"><option value="">Loading…</option></select>' +
    '</div>' +
    '<nav class="sa-nav">' +
      link('school-admin-dashboard.html',    '📊', 'Dashboard') +
      link('school-admin-teachers.html',     '👩‍🏫', 'Teachers') +
      link('school-admin-invitations.html',  '✉️',  'Invitations') +
      link('school-admin-licenses.html',     '🪪',  'Licenses') +
      link('school-admin-reports.html',      '📈',  'Reports') +
      link('school-admin-org.html',          '🏫',  'Organization') +
    '</nav>' +
    '<div class="sa-sidebar-foot">' +
      '<a href="index.html" target="_blank" rel="noopener"><span class="ic">↗</span><span class="label">View Site</span></a>' +
      '<a href="#" onclick="saLogout();return false;"><span class="ic">⎋</span><span class="label">Log Out</span></a>' +
    '</div>';

  // Bootstrap: load school context and populate the school selector for multi-school admins
  fetch('/api/school-admin/me', { credentials: 'include' })
    .then(function (r) {
      if (!r.ok) { window.location.href = 'school-admin-login.html'; return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.loggedIn) { window.location.href = 'school-admin-login.html'; return; }

      // Update user display if topbar exists
      var userEl = document.getElementById('saUserName');
      if (userEl) userEl.textContent = data.firstName + ' ' + (data.lastName || '');

      // Populate school selector for multi-school admins
      if (data.schools && data.schools.length > 1) {
        var wrap = document.getElementById('saSchoolSelectWrap');
        var sel = document.getElementById('saSchoolSelect');
        if (wrap && sel) {
          wrap.style.display = '';
          sel.innerHTML = data.schools.map(function (s) {
            return '<option value="' + s.purchaseId + '">' + (s.schoolDomain || 'School ' + s.purchaseId) + '</option>';
          }).join('');
          var stored = sessionStorage.getItem('saActivePurchaseId');
          if (stored) sel.value = stored;
        }
      }

      // Expose globally for page-level JS
      window.saPortalData = data;
      window.saActivePurchaseId = function () {
        var el = document.getElementById('saSchoolSelect');
        return el && el.value ? Number(el.value) : (data.schools && data.schools[0] ? data.schools[0].purchaseId : null);
      };

      // Fire a custom event so page JS can react
      document.dispatchEvent(new CustomEvent('saReady', { detail: data }));
    })
    .catch(function () { window.location.href = 'school-admin-login.html'; });

  window.saSelectSchool = function (purchaseId) {
    sessionStorage.setItem('saActivePurchaseId', purchaseId);
    document.dispatchEvent(new CustomEvent('saSchoolChanged', { detail: { purchaseId: Number(purchaseId) } }));
  };

  window.saLogout = function () {
    fetch('/api/site-auth/logout', { method: 'POST', credentials: 'include' })
      .then(function () { window.location.href = 'school-admin-login.html'; });
  };

  // Shared toast notification
  var toastContainer = document.createElement('div');
  toastContainer.id = 'sa-toast-container';
  document.body.appendChild(toastContainer);

  window.saToast = function (msg, type) {
    var t = document.createElement('div');
    t.className = 'sa-toast sa-toast-' + (type || 'info');
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  };

  // Shared API helper — returns parsed JSON or throws with error message
  window.saFetch = async function (url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts));
    if (r.status === 401 || r.status === 403) { window.location.href = 'school-admin-login.html'; return; }
    var data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
})();
