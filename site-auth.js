/* Fixer Nation public site auth widget — shared by every public page.
   Expects the modal markup (#fnAuthModalOverlay etc.) and a nav placeholder
   (#fnAuthNav) to already be present in the page's HTML. */

function fnAuthShowMessage(text, kind) {
  const box = document.getElementById('fnAuthMessage');
  if (!box) return;
  box.textContent = text;
  box.style.display = 'block';
  box.style.background = kind === 'error' ? '#FDECEA' : '#E4F3EE';
  box.style.color = kind === 'error' ? '#B3261E' : '#164F4A';
}
function fnAuthClearMessage() {
  const box = document.getElementById('fnAuthMessage');
  if (box) box.style.display = 'none';
  const resendWrap = document.getElementById('fnAuthResendWrap');
  if (resendWrap) resendWrap.style.display = 'none';
}

function fnAuthSwitchTab(tab) {
  fnAuthClearMessage();
  const loginTab = document.getElementById('fnAuthTabLogin');
  const signupTab = document.getElementById('fnAuthTabSignup');
  const loginView = document.getElementById('fnAuthLoginView');
  const signupView = document.getElementById('fnAuthSignupView');
  const forgotView = document.getElementById('fnAuthForgotView');
  forgotView.style.display = 'none';
  if (tab === 'signup') {
    loginView.style.display = 'none';
    signupView.style.display = 'block';
    loginTab.style.color = '#B8AFA6';
    signupTab.style.color = '#164F4A';
  } else {
    loginView.style.display = 'block';
    signupView.style.display = 'none';
    loginTab.style.color = '#164F4A';
    signupTab.style.color = '#B8AFA6';
  }
}

function fnAuthShowForgotPassword() {
  fnAuthClearMessage();
  document.getElementById('fnAuthLoginView').style.display = 'none';
  document.getElementById('fnAuthForgotView').style.display = 'block';
}
function fnAuthShowLoginForm() {
  fnAuthClearMessage();
  document.getElementById('fnAuthForgotView').style.display = 'none';
  document.getElementById('fnAuthLoginView').style.display = 'block';
}

function fnAuthOpenModal(tab) {
  fnAuthClearMessage();
  document.getElementById('fnAuthLoginForm').reset();
  document.getElementById('fnAuthSignupForm').reset();
  document.getElementById('fnAuthForgotForm').reset();
  fnAuthShowLoginForm();
  fnAuthSwitchTab(tab || 'login');
  document.getElementById('fnAuthModalOverlay').style.display = 'flex';
}
function fnAuthCloseModal() {
  document.getElementById('fnAuthModalOverlay').style.display = 'none';
}

// A plain (non-httpOnly) hint of who's logged in, so the nav can render
// correctly on first paint without waiting on a network round-trip to
// /api/site-auth/me. This is purely a display optimization — the real
// session lives in the httpOnly cookie, and fnAuthCheckSession() below
// still verifies with the server on every page load and self-corrects
// the hint (and the nav) if it's ever stale.
const FN_AUTH_HINT_KEY = 'fnUserFirstName';

function fnAuthRenderNav(loggedIn, firstName) {
  const nav = document.getElementById('fnAuthNav');
  if (loggedIn) {
    localStorage.setItem(FN_AUTH_HINT_KEY, firstName);
  } else {
    localStorage.removeItem(FN_AUTH_HINT_KEY);
  }
  if (!nav) return;
  if (loggedIn) {
    nav.innerHTML = `
      <div style="position:relative;">
        <a href="#" onclick="fnAuthToggleUserMenu(); return false;" style="font-weight:600; font-size:14px;">${firstName} ▾</a>
        <div id="fnAuthUserMenu" style="display:none; position:absolute; right:0; top:26px; background:#fff; border-radius:10px; box-shadow:0 12px 26px -10px rgba(22,79,74,0.35); padding:8px; min-width:175px; z-index:300;">
          <a href="my-profile.html" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#2A2420; border-radius:6px;">My Profile</a>
          <a href="my-memberships.html" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#2A2420; border-radius:6px;">My Memberships</a>
          <a href="my-license.html" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#2A2420; border-radius:6px;">My Licenses</a>
          <a href="my-purchases.html" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#2A2420; border-radius:6px;">Purchase History</a>
          <div style="height:1px; background:rgba(22,79,74,0.1); margin:4px 8px;"></div>
          <a href="#" onclick="fnAuthLogout(); return false;" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#D9502F; border-radius:6px;">Log Out</a>
        </div>
      </div>
    `;
  } else {
    nav.innerHTML = `<a href="#" onclick="fnAuthOpenModal('login'); return false;" style="font-weight:600; font-size:14px;">Log In</a>`;
  }
}

// Renders immediately from the local hint (no network wait) to avoid a
// "Log In" flash on every page load for already-logged-in visitors.
// fnAuthCheckSession() still runs right after to confirm/correct it.
function fnAuthRenderNavOptimistic() {
  const hint = localStorage.getItem(FN_AUTH_HINT_KEY);
  if (hint) fnAuthRenderNav(true, hint);
}
fnAuthRenderNavOptimistic();

function fnAuthToggleUserMenu() {
  const menu = document.getElementById('fnAuthUserMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function fnAuthCheckSession() {
  fetch('/api/site-auth/me', { credentials: 'include' })
    .then(r => r.json())
    .then(data => fnAuthRenderNav(data.loggedIn, data.firstName))
    .catch(() => fnAuthRenderNav(false));
}

async function fnAuthLogout() {
  await fetch('/api/site-auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  fnAuthRenderNav(false);
}

document.addEventListener('DOMContentLoaded', function () {
  fnAuthCheckSession();

  const loginForm = document.getElementById('fnAuthLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      fnAuthClearMessage();
      const email = document.getElementById('fnAuthLoginEmail').value.trim();
      const password = document.getElementById('fnAuthLoginPassword').value;
      const r = await fetch('/api/site-auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) {
        fnAuthShowMessage(result.error || 'Login failed.', 'error');
        if (result.reason === 'unverified') {
          document.getElementById('fnAuthResendWrap').style.display = 'block';
        }
        return;
      }
      fnAuthRenderNav(true, result.firstName);
      fnAuthCloseModal();
      document.dispatchEvent(new CustomEvent('fn-auth-changed'));
    });
  }

  const signupForm = document.getElementById('fnAuthSignupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      fnAuthClearMessage();
      const firstName = document.getElementById('fnAuthSignupFirstName').value.trim();
      const lastName = document.getElementById('fnAuthSignupLastName').value.trim();
      const email = document.getElementById('fnAuthSignupEmail').value.trim();
      const password = document.getElementById('fnAuthSignupPassword').value;
      const r = await fetch('/api/site-auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) {
        fnAuthShowMessage(result.error || 'Could not create your account.', 'error');
        return;
      }
      signupForm.reset();
      fnAuthSwitchTab('login');
      fnAuthShowMessage(result.message || 'Check your email to verify your account.', 'success');
    });
  }

  const forgotForm = document.getElementById('fnAuthForgotForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      fnAuthClearMessage();
      const email = document.getElementById('fnAuthForgotEmail').value.trim();
      await fetch('/api/site-auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      fnAuthShowLoginForm();
      fnAuthShowMessage('If that email has an account, a reset link is on its way.', 'success');
    });
  }
});

async function fnAuthResendVerification() {
  const email = document.getElementById('fnAuthLoginEmail').value.trim();
  if (!email) { fnAuthShowMessage('Enter your email above first.', 'error'); return; }
  await fetch('/api/site-auth/resend-verification', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  fnAuthShowMessage('If that email has an account, a new verification link is on its way.', 'success');
}
