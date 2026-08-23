/* Fixer Nation Education — shared school-branding application.
   One function, fnApplyBranding(branding, scopeEl, varMap), used on every
   surface that inherits school branding (teacher dashboard, digital
   classroom, student experience, parent experience, school-admin pages,
   and the branding editor's own live preview panels).

   branding === null/undefined means "no published branding" — this is a
   deliberate no-op, leaving whatever FNE-default colors/logo that scope
   already has in its own CSS. Nothing here ever throws; a missing/partial
   branding object just skips whichever piece it can't apply. */
(function () {
  // Two color universes exist in this codebase today — the marketing/
  // teacher/student/parent palette (--coral/--teal-dark/--gold) and the
  // school-admin palette (--sa-accent/--sa-sidebar-bg). Pass the matching
  // map for the page you're on; both are exported below for convenience.
  var MARKETING_VARMAP = {
    primary: '--coral', primaryDark: '--coral-dark',
    secondary: '--teal-dark', secondaryLight: '--teal',
    accent: '--gold',
  };

  var SCHOOL_ADMIN_VARMAP = {
    primary: '--sa-accent', primaryDark: '--sa-accent-dark',
    secondary: '--sa-sidebar-bg', secondaryTextVar: '--sa-sidebar-text',
  };

  function fnApplyBranding(branding, scopeEl, varMap) {
    scopeEl = scopeEl || document.documentElement;
    varMap = varMap || MARKETING_VARMAP;
    if (!branding) return;

    if (branding.primaryColor) {
      scopeEl.style.setProperty(varMap.primary, branding.primaryColor);
      if (varMap.primaryDark && branding.primaryColorDark) {
        scopeEl.style.setProperty(varMap.primaryDark, branding.primaryColorDark);
      }
    }
    if (branding.secondaryColor) {
      scopeEl.style.setProperty(varMap.secondary, branding.secondaryColor);
      if (varMap.secondaryLight && branding.secondaryColorLight) {
        scopeEl.style.setProperty(varMap.secondaryLight, branding.secondaryColorLight);
      }
      // A school's secondary color often becomes a background (sidebar,
      // header) — recompute the text color that sits on it so a light
      // secondary color never produces unreadable text, without the admin
      // ever having to think about contrast.
      if (varMap.secondaryTextVar && branding.secondaryTextColor) {
        scopeEl.style.setProperty(varMap.secondaryTextVar, branding.secondaryTextColor);
      }
    }
    if (branding.accentColor && varMap.accent) {
      scopeEl.style.setProperty(varMap.accent, branding.accentColor);
    }

    if (branding.logoDisplayUrl) {
      var img = scopeEl.querySelector ? scopeEl.querySelector('.brand-logo, .brand img, .sa-logo-img') : null;
      if (img) img.src = branding.logoDisplayUrl;
    }

    // Non-removable FNE attribution — only shown once a school's own logo
    // is actively replacing the FNE one, so it never appears redundant.
    if (branding.logoDisplayUrl && scopeEl.querySelector && !scopeEl.querySelector('.fn-powered-by')) {
      var anchor = scopeEl.querySelector('.brand, .sa-logo, .brand-logo');
      if (anchor) {
        var pb = document.createElement('div');
        pb.className = 'fn-powered-by';
        pb.textContent = 'Powered by Fixer Nation Education';
        pb.style.cssText = 'font-size:10.5px;opacity:.55;margin-top:2px;white-space:nowrap;';
        var container = anchor.closest ? (anchor.closest('.sa-logo') || anchor.parentNode) : anchor.parentNode;
        container.appendChild(pb);
      }
    }
  }

  window.fnApplyBranding = fnApplyBranding;
  window.FN_MARKETING_VARMAP = MARKETING_VARMAP;
  window.FN_SCHOOL_ADMIN_VARMAP = SCHOOL_ADMIN_VARMAP;
})();
