// Fills in the user ID on a sign-in page when someone arrives from the "Your sign-ins" card on the demo welcome page (?demoUser=...).
// It only accepts the shape of a demo user ID (demo-teacher-12@public-demo.example.com, demo-student-12), so these public pages can never be
// used to pre-fill any other address. It sets the field's value (never HTML) and moves the cursor to the password or PIN box. No password or PIN is ever put in an address.
(function () {
  var m = /[?&]demoUser=([^&#]*)/.exec(window.location.search ? window.location.search : '');
  if (!m) return;
  var id;
  try { id = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (e) { return; }
  if (!/^demo-[a-z]+(-\d+)?(@public-demo\.example\.com)?$/.test(id)) return;

  function put(userBox, secretBox) {
    if (!userBox) return false;
    userBox.value = id;
    userBox.dispatchEvent(new Event('input', { bubbles: true }));
    if (secretBox) secretBox.focus();
    return true;
  }

  // Student page: it opens on "Join with a code", so go to the username and PIN step first.
  var studentName = document.getElementById('loginUsername');
  if (studentName) {
    if (typeof goStep === 'function') goStep('step-login');
    put(studentName, document.getElementById('loginPin'));
    return;
  }
  // Teacher, parent, school and district pages: an email box and a password box.
  put(document.getElementById('email'), document.getElementById('password'));
})();
