/* School License Administrator Portal — shared sidebar nav.
   Every portal page has <aside class="sa-sidebar"></aside>
   followed by <script src="school-admin-nav.js?v=2"></script>. */
(function () {
  var aside = document.querySelector('.sa-sidebar');
  if (!aside) return;

  var page = window.location.pathname.split('/').pop() || 'school-admin-dashboard.html';

  function link(href, icon, label) {
    var cls = page === href ? ' class="active"' : '';
    return '<a href="' + href + '"' + cls + '><span class="ic">' + icon + '</span><span class="label">' + label + '</span></a>';
  }

  function esc(str) { return String(str == null ? '' : str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // Persistent license-expiration banner, inserted once at the top of every
  // portal page's content area (right before .sa-content, inside .sa-main —
  // both exist consistently across every school-admin-*.html page, unlike
  // any single page's own topbar markup). The insertion point lookup can't
  // happen here at top-level script scope — this script tag runs BEFORE
  // .sa-main/.sa-content are parsed into the DOM (they appear later in each
  // page's HTML), so document.querySelector would always return null at
  // this point. Deferred into ensureBannerInserted(), called lazily from
  // renderLicenseBanner() — which only ever runs inside the /me fetch's
  // .then(), well after the full DOM has parsed.
  var licenseBanner = document.createElement('div');
  licenseBanner.id = 'saLicenseBanner';

  function ensureBannerInserted() {
    if (licenseBanner.parentNode) return;
    var contentEl = document.querySelector('.sa-main .sa-content');
    if (contentEl && contentEl.parentNode) contentEl.parentNode.insertBefore(licenseBanner, contentEl);
  }

  function formatDate(iso) {
    var d = new Date(iso + 'T00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function renderLicenseBanner(school) {
    ensureBannerInserted();
    if (!school || !school.expirationDate) { licenseBanner.innerHTML = ''; return; }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var expiry = new Date(school.expirationDate + 'T00:00');
    var daysLeft = Math.round((expiry - today) / 86400000);

    var variant = 'sa-alert-success', icon = '✅', lead = 'Your license is active through';
    if (daysLeft < 0) { variant = 'sa-alert-danger'; icon = '🚨'; lead = 'Your license expired on'; }
    else if (daysLeft <= 30) { variant = 'sa-alert-warn'; icon = '⚠️'; lead = 'Your license expires on'; }

    licenseBanner.innerHTML =
      '<div class="sa-alert ' + variant + '" style="margin-bottom:20px;">' + icon +
      ' <div><strong>' + lead + ' ' + esc(formatDate(school.expirationDate)) + '</strong>' +
      (daysLeft >= 0 ? '<p>' + daysLeft + ' day(s) remaining' + (school.schoolDomain ? ' for ' + esc(school.schoolDomain) : '') + '. Contact Fixer Nation Education to renew before access is interrupted.</p>'
                     : '<p>Teacher access' + (school.schoolDomain ? ' for ' + esc(school.schoolDomain) : '') + ' has been suspended. Contact Fixer Nation Education to renew and restore access.</p>') +
      '</div></div>';
  }

  aside.innerHTML =
    '<div class="sa-logo">' +
      '<span class="sa-logo-pill"><img src="logo-fne.png?v=2" alt="Fixer Nation Education" class="sa-logo-img"></span>' +
    '</div>' +
    '<div class="sa-school-select" id="saSchoolSelectWrap" style="display:none;">' +
      '<select id="saSchoolSelect" onchange="saSelectSchool(this.value)"><option value="">Loading…</option></select>' +
    '</div>' +
    '<nav class="sa-nav">' +
      link('school-admin-dashboard.html',   '📊', 'Dashboard') +
      link('school-admin-org.html',         '🏫', 'Organization') +
      link('school-admin-branding.html',    '🎨', 'Branding') +
      link('school-admin-roster.html',      '🪑', 'Roster') +
      link('school-admin-invitations.html', '✉️',  'Invitations') +
      link('school-admin-reports.html',     '📈', 'Reports') +
    '</nav>' +
    '<div id="saSchoolInfo" style="padding:12px 16px 8px;border-top:1px solid rgba(255,255,255,.08);margin-top:auto;"></div>' +
    '<div class="sa-sidebar-foot">' +
      '<a href="help-videos.html#school-admins" target="_blank" rel="noopener"><span class="ic">▶</span><span class="label">Help videos</span></a>' +
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
      var avatarEl = document.getElementById('saUserAvatar');
      if (avatarEl && data.firstName) avatarEl.textContent = data.firstName.charAt(0).toUpperCase();

      // Populate school selector for multi-school admins
      if (data.schools && data.schools.length > 1) {
        var wrap = document.getElementById('saSchoolSelectWrap');
        var sel = document.getElementById('saSchoolSelect');
        if (wrap && sel) {
          wrap.style.display = '';
          sel.innerHTML = data.schools.map(function (s) {
            return '<option value="' + s.purchaseId + '">' + esc(s.schoolDomain || 'School ' + s.purchaseId) + '</option>';
          }).join('');
          var stored = sessionStorage.getItem('saActivePurchaseId');
          if (stored) sel.value = stored;
        }
      }

      // School info block in sidebar footer
      var infoEl = document.getElementById('saSchoolInfo');
      if (infoEl && data.schools && data.schools[0]) {
        var school = data.schools[0];
        var domain = school.schoolDomain ? esc(school.schoolDomain) : '';
        var plan = school.planName ? esc(school.planName) : '';
        var seats = school.seatCount ? school.seatCount + ' seats' : '';
        var adminEmail = data.email ? esc(data.email) : '';
        var adminName = [data.firstName, data.lastName].filter(Boolean).map(esc).join(' ');
        infoEl.innerHTML =
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.35);margin-bottom:4px;">Your School</div>' +
          (domain ? '<div style="font-size:12.5px;font-weight:600;color:rgba(255,255,255,.7);margin-bottom:2px;">' + domain + '</div>' : '') +
          ((plan || seats) ? '<div style="font-size:11.5px;color:rgba(255,255,255,.4);margin-bottom:6px;">' + [plan, seats].filter(Boolean).join(' · ') + '</div>' : '') +
          '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.35);margin-bottom:2px;margin-top:6px;">Administrator</div>' +
          (adminName ? '<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.65);margin-bottom:1px;">' + adminName + '</div>' : '') +
          (adminEmail ? '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:2px;word-break:break-all;">' + adminEmail + '</div>' : '') +
          '<div style="font-size:10px;color:rgba(255,255,255,.3);font-style:italic;">School License Administrator</div>';
      }

      // Expose globally for page-level JS
      window.saPortalData = data;
      window.saActivePurchaseId = function () {
        var el = document.getElementById('saSchoolSelect');
        return el && el.value ? Number(el.value) : (data.schools && data.schools[0] ? data.schools[0].purchaseId : null);
      };

      applySchoolBranding(window.saActivePurchaseId());
      renderLicenseBanner((data.schools || []).find(function (s) { return s.purchaseId === window.saActivePurchaseId(); }));

      // Fire a custom event so page JS can react
      document.dispatchEvent(new CustomEvent('saReady', { detail: data }));
    })
    .catch(function () { window.location.href = 'school-admin-login.html'; });

  // The admin's own dashboard reflects their school's published branding
  // too, not just the branding editor — reapplied whenever they switch
  // schools via the multi-school selector.
  function applySchoolBranding(purchaseId) {
    if (!purchaseId || typeof fnApplyBranding !== 'function') return;
    fetch('/api/school-admin/branding/resolved?purchaseId=' + purchaseId, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) fnApplyBranding(data.branding, document.documentElement, window.FN_SCHOOL_ADMIN_VARMAP);
      })
      .catch(function () {});
  }
  document.addEventListener('saSchoolChanged', function (e) {
    applySchoolBranding(e.detail.purchaseId);
    var data = window.saPortalData;
    if (data) renderLicenseBanner((data.schools || []).find(function (s) { return s.purchaseId === e.detail.purchaseId; }));
  });

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

  // In-page confirmation, used instead of the browser's own confirm() box. The browser box is small, easy to
  // miss and cannot be shown in a how-to video; this one is part of the page. Resolves true or false.
  window.saConfirm = function (message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'sa-modal-overlay';
      ov.style.display = 'flex';
      var box = document.createElement('div');
      box.className = 'sa-modal';
      box.style.maxWidth = '440px';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      var head = document.createElement('div');
      head.className = 'sa-modal-head';
      var h = document.createElement('h2');
      h.textContent = opts.title || 'Please confirm';
      head.appendChild(h);
      var p = document.createElement('p');
      p.style.cssText = 'font-size:14px;line-height:1.55;margin:4px 0 18px;';
      p.textContent = message;
      var foot = document.createElement('div');
      foot.className = 'sa-modal-foot';
      var no = document.createElement('button');
      no.type = 'button'; no.className = 'sa-btn sa-btn-secondary'; no.textContent = opts.cancelText || 'Cancel';
      var yes = document.createElement('button');
      yes.type = 'button'; yes.className = 'sa-btn ' + (opts.danger === false ? 'sa-btn-primary' : 'sa-btn-danger'); yes.textContent = opts.confirmText || 'Yes, continue';
      foot.appendChild(no); foot.appendChild(yes);
      box.appendChild(head); box.appendChild(p); box.appendChild(foot);
      ov.appendChild(box);
      function done(v) { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }
      no.addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      ov.addEventListener('click', function (e) { if (e.target === ov) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      no.focus();
    });
  };

  // Shared API helper — returns parsed JSON or throws with error message
  window.saFetch = async function (url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts));
    var data = await r.json().catch(function () { return {}; });
    // Only a lost session or lost admin access sends you back to sign in.
    // Other 403s (a Read Only or Secondary admin pressing a button their level
    // can't use) show their own message instead of bouncing to the login page.
    var gateLost = r.status === 401 ||
      (r.status === 403 && /access required|No active school administrator/i.test(data.error || ''));
    if (gateLost) { window.location.href = 'school-admin-login.html'; return; }
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
})();
