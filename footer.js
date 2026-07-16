/* Fixer Nation — shared public footer (mirrors nav.js pattern). Every public
   page has an empty <footer></footer> placeholder; this script fills it in and
   injects the shared CSS once. */
(function () {
  if (!document.getElementById('fn-footer-styles')) {
    var s = document.createElement('style');
    s.id = 'fn-footer-styles';
    s.textContent = [
      'footer{background:#0E3733;color:rgba(255,255,255,0.82);padding:60px 0 32px;font-size:14px;margin-top:64px;}',
      '.fn-fi{max-width:1180px;margin:0 auto;padding:0 32px;}',
      '.fn-fg{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:40px;margin-bottom:48px;}',
      '.fn-flogo{display:flex;align-items:center;gap:12px;font-family:\'Fraunces\',serif;font-weight:700;font-size:21px;color:#fff;text-decoration:none;}',
      '.fn-fmark{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#F26B4D,#EBA657);color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;flex-shrink:0;}',
      '.fn-fcredo{font-family:\'Fraunces\',serif;font-style:italic;color:#F6D9C3;margin-top:16px;font-size:15px;max-width:280px;line-height:1.55;}',
      '.fn-fsocial{display:flex;gap:10px;margin-top:20px;}',
      '.fn-fsocial a{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;text-decoration:none;transition:background .15s;}',
      '.fn-fsocial a:hover{background:rgba(255,255,255,0.22);}',
      'footer h4{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);margin-bottom:14px;}',
      'footer ul{list-style:none;padding:0;margin:0;}',
      'footer ul li{margin-bottom:9px;}',
      'footer ul a{color:rgba(255,255,255,0.72);text-decoration:none;font-size:14px;transition:color .15s;}',
      'footer ul a:hover{color:#fff;}',
      '.fn-fb{border-top:1px solid rgba(255,255,255,0.12);padding-top:24px;font-size:12.5px;opacity:0.6;text-align:center;}',
      '@media(max-width:900px){.fn-fg{grid-template-columns:1fr 1fr;}}',
      '@media(max-width:600px){.fn-fg{grid-template-columns:1fr;}.fn-fi{padding:0 20px;}}',
    ].join('');
    document.head.appendChild(s);
  }

  var ft = document.querySelector('footer');
  if (!ft) return;

  ft.innerHTML =
    '<div class="fn-fi">' +
      '<div class="fn-fg">' +

        '<div>' +
          '<a class="fn-flogo" href="index.html"><div class="fn-fmark">FN</div> Fixer Nation</a>' +
          '<p class="fn-fcredo">&ldquo;There are no problems in life&hellip; only issues and answers.&rdquo;</p>' +
          '<div class="fn-fsocial">' +
            '<a href="#">IG</a>' +
            '<a href="#">FB</a>' +
            '<a href="#">X</a>' +
            '<a href="#">in</a>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<h4>Explore</h4>' +
          '<ul>' +
            '<li><a href="about.html">About</a></li>' +
            '<li><a href="books.html">Books</a></li>' +
            '<li><a href="blog.html">FN Blogs</a></li>' +
            '<li><a href="brain-games.html" style="display:flex;align-items:center;gap:6px;"><span style="font-size:16px;line-height:1;">🧠</span> Tune Your Brain</a></li>' +
          '</ul>' +
        '</div>' +

        '<div>' +
          '<h4>Community</h4>' +
          '<ul>' +
            '<li><a href="fnnetwork.html">FN Network</a></li>' +
            '<li><a href="social.html">Community</a></li>' +
            '<li><a href="askthefixer.html">Ask The Fixer</a></li>' +
            '<li><a href="join.html">Join Fixer Nation</a></li>' +
            '<li><a href="service-providers.html">Service Providers</a></li>' +
            '<li><a href="brand-ambassador.html">Brand Ambassador</a></li>' +
          '</ul>' +
        '</div>' +

        '<div>' +
          '<h4>Schools &amp; Company</h4>' +
          '<ul>' +
            '<li><a href="education-portal.html">National Education Portal</a></li>' +
            '<li><a href="education-schools.html">2D Education &mdash; Schools</a></li>' +
            '<li><a href="programs.html">Programs</a></li>' +
            '<li><a href="contact.html">Contact</a></li>' +
            '<li><a href="teacher-classrooms.html">My Classrooms</a></li>' +
            '<li><a href="student-login.html">Student Login</a></li>' +
            '<li><a href="admin-login.html">Admin Log In</a></li>' +
          '</ul>' +
        '</div>' +

      '</div>' +
      '<div class="fn-fb">' +
        '&copy; 2026 Fixer Nation Issues and Answers. All Rights Reserved.' +
        ' &nbsp;&middot;&nbsp; ' +
        '<a href="privacy-choices.html" style="color:inherit;">Your Privacy Choices</a>' +
      '</div>' +
    '</div>';
})();
