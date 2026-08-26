/* District Administrator Portal — shared sidebar nav. Structural clone of
   school-admin-nav.js, one tier up (districts instead of schools) — branding
   is the only capability in scope for this portal. Reuses school-admin-
   common.css's .sa-* classes directly (same shell/sidebar/topbar look as the
   school admin portal) rather than standing up a parallel CSS system for a
   two-page portal.
   Every portal page has <aside class="sa-sidebar"></aside>
   followed by <script src="district-admin-nav.js?v=1"></script>. */
(function () {
  var aside = document.querySelector('.sa-sidebar');
  if (!aside) return;

  var page = window.location.pathname.split('/').pop() || 'district-admin-dashboard.html';

  function link(href, icon, label) {
    var cls = page === href ? ' class="active"' : '';
    return '<a href="' + href + '"' + cls + '><span class="ic">' + icon + '</span><span class="label">' + label + '</span></a>';
  }

  function esc(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Unlike the school-admin portal (one school, one expiration date), a
  // district has many schools each with their own independent license — so
  // instead of a single date, this is a summary alert that only appears
  // when at least one school's license needs attention.
  var licenseBanner = document.createElement('div');
  licenseBanner.id = 'daLicenseBanner';
  var contentEl = document.querySelector('.sa-main .sa-content');
  if (contentEl && contentEl.parentNode) contentEl.parentNode.insertBefore(licenseBanner, contentEl);

  function loadLicenseBanner() {
    fetch('/api/district-admin/schools', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.schools) return;
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var expired = 0, expiringSoon = 0;
        data.schools.forEach(function (s) {
          if (!s.expiration_date) return;
          var days = Math.round((new Date(s.expiration_date + 'T00:00') - today) / 86400000);
          if (days < 0) expired++;
          else if (days <= 30) expiringSoon++;
        });
        if (!expired && !expiringSoon) { licenseBanner.innerHTML = ''; return; }

        var parts = [];
        if (expired) parts.push(expired + ' school license(s) expired');
        if (expiringSoon) parts.push(expiringSoon + ' school license(s) expiring within 30 days');
        licenseBanner.innerHTML =
          '<div class="sa-alert ' + (expired ? 'sa-alert-danger' : 'sa-alert-warn') + '" style="margin-bottom:20px;">' + (expired ? '🚨' : '⚠️') +
          ' <div><strong>' + esc(parts.join(' · ')) + '</strong>' +
          '<p><a href="district-admin-schools.html">Review schools →</a></p></div></div>';
      })
      .catch(function () {});
  }
  loadLicenseBanner();

  aside.innerHTML =
    '<div class="sa-logo">' +
      '<span class="sa-logo-pill"><img src="logo-fne.png?v=2" alt="Fixer Nation Education" class="sa-logo-img"></span>' +
    '</div>' +
    '<div class="sa-school-select" id="daDistrictSelectWrap" style="display:none;">' +
      '<select id="daDistrictSelect" onchange="daSelectDistrict(this.value)"><option value="">Loading…</option></select>' +
    '</div>' +
    '<nav class="sa-nav">' +
      link('district-admin-dashboard.html', '📊', 'Dashboard') +
      link('district-admin-branding.html',  '🎨', 'Branding') +
      link('district-admin-schools.html',   '🏫', 'Schools') +
    '</nav>' +
    '<div id="daDistrictInfo" style="padding:12px 16px 8px;border-top:1px solid rgba(255,255,255,.08);margin-top:auto;"></div>' +
    '<div class="sa-sidebar-foot">' +
      '<a href="index.html" target="_blank" rel="noopener"><span class="ic">↗</span><span class="label">View Site</span></a>' +
      '<a href="#" onclick="daLogout();return false;"><span class="ic">⎋</span><span class="label">Log Out</span></a>' +
    '</div>';

  fetch('/api/district-admin/me', { credentials: 'include' })
    .then(function (r) {
      if (!r.ok) { window.location.href = 'district-admin-login.html'; return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.loggedIn) { window.location.href = 'district-admin-login.html'; return; }

      var userEl = document.getElementById('saUserName');
      if (userEl) userEl.textContent = data.firstName + ' ' + (data.lastName || '');
      var avatarEl = document.getElementById('saUserAvatar');
      if (avatarEl && data.firstName) avatarEl.textContent = data.firstName.charAt(0).toUpperCase();

      if (data.districts && data.districts.length > 1) {
        var wrap = document.getElementById('daDistrictSelectWrap');
        var sel = document.getElementById('daDistrictSelect');
        if (wrap && sel) {
          wrap.style.display = '';
          sel.innerHTML = data.districts.map(function (d) {
            return '<option value="' + d.districtId + '">' + esc(d.districtName) + '</option>';
          }).join('');
          var stored = sessionStorage.getItem('daActiveDistrictId');
          if (stored) sel.value = stored;
        }
      }

      var infoEl = document.getElementById('daDistrictInfo');
      if (infoEl && data.districts && data.districts[0]) {
        var district = data.districts[0];
        var adminName = [data.firstName, data.lastName].filter(Boolean).map(esc).join(' ');
        var adminEmail = data.email ? esc(data.email) : '';
        infoEl.innerHTML =
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.35);margin-bottom:4px;">Your District</div>' +
          '<div style="font-size:12.5px;font-weight:600;color:rgba(255,255,255,.7);margin-bottom:6px;">' + esc(district.districtName) + '</div>' +
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.35);margin-bottom:2px;margin-top:6px;">Administrator</div>' +
          (adminName ? '<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.65);margin-bottom:1px;">' + adminName + '</div>' : '') +
          (adminEmail ? '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:2px;word-break:break-all;">' + adminEmail + '</div>' : '') +
          '<div style="font-size:10px;color:rgba(255,255,255,.3);font-style:italic;">District Administrator</div>';
      }

      window.daPortalData = data;
      window.daActiveDistrictId = function () {
        var el = document.getElementById('daDistrictSelect');
        return el && el.value ? Number(el.value) : (data.districts && data.districts[0] ? data.districts[0].districtId : null);
      };

      document.dispatchEvent(new CustomEvent('daReady', { detail: data }));
    })
    .catch(function () { window.location.href = 'district-admin-login.html'; });

  window.daSelectDistrict = function (districtId) {
    sessionStorage.setItem('daActiveDistrictId', districtId);
    document.dispatchEvent(new CustomEvent('daDistrictChanged', { detail: { districtId: Number(districtId) } }));
  };

  window.daLogout = function () {
    fetch('/api/site-auth/logout', { method: 'POST', credentials: 'include' })
      .then(function () { window.location.href = 'district-admin-login.html'; });
  };

  var toastContainer = document.createElement('div');
  toastContainer.id = 'sa-toast-container';
  document.body.appendChild(toastContainer);

  window.daToast = function (msg, type) {
    var t = document.createElement('div');
    t.className = 'sa-toast sa-toast-' + (type || 'info');
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  };

  window.daFetch = async function (url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts));
    if (r.status === 401 || r.status === 403) { window.location.href = 'district-admin-login.html'; return; }
    var data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
})();
