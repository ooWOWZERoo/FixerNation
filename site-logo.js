/* Fixer Nation Education: shows the Website Logo setting (FNE Admin > Settings) on the sign-in and one-card pages that
   have no shared header. Mark the image with data-site-logo; it keeps the built-in logo-fne.png until a logo is set.
   The last value is remembered so a changed logo shows at once on the next page. */
(function () {
  var s = document.createElement('style');
  s.textContent = 'img[data-site-logo].fn-custom-logo{height:128px!important;width:auto!important;max-width:100%!important;object-fit:contain!important;align-self:flex-start;}';
  document.head.appendChild(s);

  function run() {
    var imgs = document.querySelectorAll('img[data-site-logo]');
    if (!imgs.length) return;
    function show(u, custom) {
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].getAttribute('src') !== u) imgs[i].setAttribute('src', u);
        imgs[i].classList.toggle('fn-custom-logo', !!custom);
      }
    }
    try { var cached = localStorage.getItem('fn_site_logo'); if (cached) show(cached, true); } catch (e) { /* storage blocked */ }
    window.__fnSiteLogo = window.__fnSiteLogo || fetch('/api/settings/site-logo').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    window.__fnSiteLogo.then(function (d) {
      var u = (d && d.url) || '';
      try { if (u) localStorage.setItem('fn_site_logo', u); else localStorage.removeItem('fn_site_logo'); } catch (e) { /* storage blocked */ }
      show(u || 'logo-fne.png?v=2', !!u);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
