/* Fixer Nation Education — shared footer. Every public page has an empty
   <footer></footer> placeholder; this script fills it in and injects CSS once. */
(function () {
  if (!document.getElementById('fn-footer-styles')) {
    var s = document.createElement('style');
    s.id = 'fn-footer-styles';
    s.textContent = [
      'footer{position:relative;background:#0E3733;color:rgba(255,255,255,0.82);padding:44px 0 22px;font-size:14px;margin-top:64px;}',
      'footer::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#F26B4D,#EBA657 55%,#164F4A);}',
      '.fn-fi{max-width:1180px;margin:0 auto;padding:0 32px;}',
      '.fn-fg{display:grid;grid-template-columns:1.25fr repeat(3,1fr);gap:36px;margin-bottom:30px;}',
      '.fn-flogo{display:inline-flex;align-items:center;text-decoration:none;}',
      '.fn-flogo-pill{background:#fff;border-radius:12px;padding:8px 12px;display:flex;align-items:center;flex-shrink:0;}',
      '.fn-flogo-img{height:44px;width:auto;display:block;}',
      '.fn-flogo-img.fn-custom-logo{height:84px;max-width:220px;object-fit:contain;}',
      '.fn-fcredo{font-family:\'Fraunces\',serif;font-style:italic;color:#F6D9C3;margin-top:14px;font-size:14.5px;max-width:270px;line-height:1.5;}',
      '.fn-fsocial{display:flex;gap:8px;margin-top:16px;}',
      '.fn-fsocial a{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;text-decoration:none;transition:background .15s;}',
      '.fn-fsocial a:hover{background:rgba(255,255,255,0.22);}',
      'footer h4{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);margin:0 0 12px;}',
      'footer ul{list-style:none;padding:0;margin:0;}',
      'footer ul li{margin-bottom:7px;}',
      'footer ul a{color:rgba(255,255,255,0.72);text-decoration:none;font-size:14px;transition:color .15s;}',
      'footer ul a:hover{color:#fff;}',
      '.fn-fhelp{display:flex;align-items:center;justify-content:space-between;gap:12px 24px;flex-wrap:wrap;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:14px 20px;margin-bottom:22px;}',
      '.fn-fhelp-t{font-family:\'Fraunces\',serif;font-size:17px;font-weight:600;color:#fff;}',
      '.fn-fhelp-t span{display:block;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:12.5px;font-weight:500;color:rgba(255,255,255,0.55);margin-top:1px;}',
      '.fn-fchips{display:flex;gap:8px;flex-wrap:wrap;}',
      'footer .fn-fchips a{display:inline-block;padding:8px 16px;border-radius:999px;border:1px solid rgba(255,255,255,0.28);color:#fff;font-size:13px;font-weight:600;text-decoration:none;transition:background .15s,border-color .15s;}',
      'footer .fn-fchips a:hover{background:rgba(255,255,255,0.14);border-color:rgba(255,255,255,0.5);}',
      'footer .fn-fchips a.fn-fchip-main{background:#F26B4D;border-color:#F26B4D;}',
      'footer .fn-fchips a.fn-fchip-main:hover{background:#D9502F;border-color:#D9502F;}',
      '.fn-fb{border-top:1px solid rgba(255,255,255,0.12);padding-top:16px;display:flex;justify-content:space-between;align-items:baseline;gap:8px 28px;flex-wrap:wrap;font-size:12.5px;color:rgba(255,255,255,0.6);}',
      '.fn-flegal{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;}',
      '.fn-flegal b{font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.4);}',
      '.fn-flegal a{color:rgba(255,255,255,0.7);text-decoration:none;}',
      '.fn-flegal a:hover{color:#fff;text-decoration:underline;}',
      '@media(max-width:900px){.fn-fg{grid-template-columns:1fr 1fr 1fr;}.fn-fg>div:first-child{grid-column:1/-1;}}',
      '@media(max-width:600px){.fn-fg{grid-template-columns:1fr 1fr;gap:22px 18px;}.fn-fi{padding:0 20px;}footer ul li{margin-bottom:5px;}footer ul a{font-size:13.5px;}.fn-fg>div:last-child{grid-column:1/-1;}.fn-fg>div:last-child ul{display:flex;flex-wrap:wrap;gap:4px 20px;}.fn-fg>div:last-child li{margin:0;}.fn-fhelp{padding:16px;}.fn-fb{flex-direction:column;}}',
    ].join('');
    document.head.appendChild(s);
  }


  // The logo comes from the Website Logo card in admin-settings.html. The last value is remembered in localStorage so a
  // changed logo shows at once on the next page; the built-in logo-fne.png stays the fallback when none is set.
  function applySiteLogo(selector) {
    var imgs = document.querySelectorAll(selector);
    if (!imgs.length) return;
    // A custom logo is a different shape from the built-in one, so it gets its own (larger) size class.
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

  var ft = document.querySelector('footer');
  if (!ft) return;

  ft.innerHTML =
    '<div class="fn-fi">' +
      '<div class="fn-fg">' +

        // Column 1 — Brand
        '<div>' +
          '<a class="fn-flogo" href="index.html"><span class="fn-flogo-pill"><img src="logo-fne.png?v=2" alt="Fixer Nation Education" class="fn-flogo-img"></span></a>' +
          '<p class="fn-fcredo">&ldquo;There are no problems in life&hellip; only issues and answers.&rdquo;</p>' +
          '<div class="fn-fsocial">' +
            '<a href="#">IG</a>' +
            '<a href="#">FB</a>' +
            '<a href="#">X</a>' +
            '<a href="#">in</a>' +
          '</div>' +
        '</div>' +

        // Column 2 — Explore: the story first (why, how), then what you get (lessons, games, community),
        // then the parent route, then our parent community. Research and standards live under Schools.
        '<div>' +
          '<h4>Explore</h4>' +
          '<ul>' +
            '<li><a href="why-fixer-nation.html">Why FNE</a></li>' +
            '<li><a href="how-it-works.html">How It Works</a></li>' +
            '<li><a href="education-portal.html">Lesson Library</a></li>' +
            '<li><a href="brain-games.html">Brain Games</a></li>' +
            '<li><a href="social.html">Community</a></li>' +
            '<li><a href="for-parents.html">For Parents</a></li>' +
            '<li><a href="https://fixernation.org/" target="_blank" rel="noopener" title="Health, hope &amp; good news, from our parent community">Positivity Network &#8599;</a></li>' +
          '</ul>' +
        '</div>' +

        // Column 3 — Schools and partners: who it is for, what it costs, the evidence, signing up, then the partner route.
        '<div>' +
          '<h4>Schools &amp; Partners</h4>' +
          '<ul>' +
            '<li><a href="for-teachers.html">For Teachers</a></li>' +
            '<li><a href="for-schools.html">For Schools</a></li>' +
            '<li><a href="school-licensing.html">Pricing &amp; Licensing</a></li>' +
            '<li><a href="research.html">Research &amp; Alignment</a></li>' +
            '<li><a href="state-standards.html">SEL &amp; Portrait of a Graduate</a></li>' +
            '<li><a href="education-schools.html">Teacher Registration</a></li>' +
            '<li><a href="become-an-affiliate.html">Become an Affiliate</a></li>' +
          '</ul>' +
        '</div>' +

        // Column 4 — Sign in: learners first, then the adults who run things, narrowest scope to widest.
        '<div>' +
          '<h4>Sign in</h4>' +
          '<ul>' +
            '<li><a href="student-login.html">Student Login</a></li>' +
            '<li><a href="teacher-classrooms.html">Teacher Login</a></li>' +
            '<li><a href="parent-portal.html">Parent Portal</a></li>' +
            '<li><a href="school-admin-login.html">School Admin</a></li>' +
            '<li><a href="district-admin-login.html">District Admin</a></li>' +
          '</ul>' +
        '</div>' +

      '</div>' +

      // Help gets its own band, apart from the legal links below it.
      '<div class="fn-fhelp">' +
        '<div class="fn-fhelp-t">Need a hand?<span>Answers, how-to videos, or a real person.</span></div>' +
        '<div class="fn-fchips">' +
          '<a href="help.html">Help center</a>' +
          '<a href="help-videos.html">Help Videos</a>' +
          '<a href="contact.html">Contact</a>' +
          '<a class="fn-fchip-main" href="support.html">Get help</a>' +
        '</div>' +
      '</div>' +

      // Legal and privacy: one quiet row with the copyright.
      '<div class="fn-fb">' +
        '<div class="fn-flegal">' +
          '<b>Legal &amp; privacy</b>' +
          '<a href="terms.html">Terms of Use</a>' +
          '<a href="privacy-policy.html">Privacy Policy</a>' +
          '<a href="refund-policy.html">Refunds &amp; Cancellations</a>' +
          '<a href="student-data-privacy.html">Student Data Privacy</a>' +
          '<a href="parents-bill-of-rights.html">Parents\' Bill of Rights</a>' +
          '<a href="privacy-choices.html">Your Privacy Choices</a>' +
        '</div>' +
        '<div>&copy; 2026 Fixer Nation Issues and Answers. All Rights Reserved.</div>' +
      '</div>' +
    '</div>';

  applySiteLogo('.fn-flogo-img');
})();
