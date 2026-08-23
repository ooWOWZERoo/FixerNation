/* Fixer Nation Education — shared footer. Every public page has an empty
   <footer></footer> placeholder; this script fills it in and injects CSS once. */
(function () {
  if (!document.getElementById('fn-footer-styles')) {
    var s = document.createElement('style');
    s.id = 'fn-footer-styles';
    s.textContent = [
      'footer{background:#0E3733;color:rgba(255,255,255,0.82);padding:60px 0 32px;font-size:14px;margin-top:64px;}',
      '.fn-fi{max-width:1180px;margin:0 auto;padding:0 32px;}',
      '.fn-fg{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:40px;margin-bottom:48px;}',
      '.fn-flogo{display:flex;align-items:center;gap:12px;text-decoration:none;}',
      '.fn-flogo-pill{background:#fff;border-radius:12px;padding:10px 14px;display:flex;align-items:center;flex-shrink:0;}',
      '.fn-flogo-img{height:56px;width:auto;display:block;}',
      '.fn-fcredo{font-family:\'Fraunces\',serif;font-style:italic;color:#F6D9C3;margin-top:16px;font-size:15px;max-width:280px;line-height:1.55;}',
      '.fn-fsocial{display:flex;gap:10px;margin-top:20px;}',
      '.fn-fsocial a{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;text-decoration:none;transition:background .15s;}',
      '.fn-fsocial a:hover{background:rgba(255,255,255,0.22);}',
      'footer h4{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.45);margin-bottom:14px;}',
      'footer ul{list-style:none;padding:0;margin:0;}',
      'footer ul li{margin-bottom:9px;}',
      'footer ul a{color:rgba(255,255,255,0.72);text-decoration:none;font-size:14px;transition:color .15s;}',
      'footer ul a:hover{color:#fff;}',
      '.fn-fb{font-size:12.5px;opacity:0.6;text-align:center;}',
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

        // Column 1 — Brand
        '<div>' +
          '<a class="fn-flogo" href="index.html"><span class="fn-flogo-pill"><img src="logo-fne.png" alt="Fixer Nation Education" class="fn-flogo-img"></span></a>' +
          '<p class="fn-fcredo">&ldquo;There are no problems in life&hellip; only issues and answers.&rdquo;</p>' +
          '<div class="fn-fsocial">' +
            '<a href="#">IG</a>' +
            '<a href="#">FB</a>' +
            '<a href="#">X</a>' +
            '<a href="#">in</a>' +
          '</div>' +
        '</div>' +

        // Column 2 — Explore
        '<div>' +
          '<h4>Explore</h4>' +
          '<ul>' +
            '<li><a href="why-fixer-nation.html">Why FNE</a></li>' +
            '<li><a href="for-parents.html">For Parents</a></li>' +
            '<li><a href="how-it-works.html">How It Works</a></li>' +
            '<li><a href="education-portal.html">Lesson Library</a></li>' +
            '<li><a href="brain-games.html">Brain Games</a></li>' +
            '<li><a href="social.html">Community</a></li>' +
            '<li><a href="research.html">Research &amp; Alignment</a></li>' +
          '</ul>' +
        '</div>' +

        // Column 3 — Schools
        '<div>' +
          '<h4>Schools</h4>' +
          '<ul>' +
            '<li><a href="for-teachers.html">For Teachers</a></li>' +
            '<li><a href="for-schools.html">For Schools</a></li>' +
            '<li><a href="school-licensing.html">Pricing &amp; Licensing</a></li>' +
            '<li><a href="education-schools.html">Teacher Registration</a></li>' +
          '</ul>' +
        '</div>' +

        // Column 4 — Access
        '<div>' +
          '<h4>Access</h4>' +
          '<ul>' +
            '<li><a href="teacher-classrooms.html">Teacher Login</a></li>' +
            '<li><a href="student-login.html">Student Login</a></li>' +
            '<li><a href="school-admin-login.html">School Admin</a></li>' +
            '<li><a href="parent-portal.html">Parent Portal</a></li>' +
            '<li><a href="privacy-choices.html">Privacy Choices</a></li>' +
            '<li><a href="student-data-privacy.html">Student Data Privacy</a></li>' +
            '<li><a href="contact.html">Contact</a></li>' +
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
