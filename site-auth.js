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
const FN_AUTH_ROLE_KEY = 'fnUserRole';

function fnAuthRenderNav(loggedIn, firstName, role) {
  const nav = document.getElementById('fnAuthNav');
  if (loggedIn) {
    localStorage.setItem(FN_AUTH_HINT_KEY, firstName);
    localStorage.setItem(FN_AUTH_ROLE_KEY, role || 'teacher');
  } else {
    localStorage.removeItem(FN_AUTH_HINT_KEY);
    localStorage.removeItem(FN_AUTH_ROLE_KEY);
  }
  document.body.classList.toggle('fn-user-authed', !!loggedIn);
  if (!nav) return;
  if (loggedIn) {
    const isParent = role === 'parent';
    const li = (href, label) => `<a href="${href}" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#2A2420; border-radius:6px;">${label}</a>`;
    nav.innerHTML = `
      <div style="position:relative;">
        <a href="#" onclick="fnAuthToggleUserMenu(event); return false;" style="font-weight:600; font-size:14px;">${firstName} ▾</a>
        <div id="fnAuthUserMenu" style="display:none; position:absolute; right:0; top:26px; background:#fff; border-radius:10px; box-shadow:0 12px 26px -10px rgba(22,79,74,0.35); padding:8px; min-width:175px; z-index:300;">
          ${li('my-profile.html', 'My Profile')}
          ${li('my-memberships.html', 'My Memberships')}
          ${!isParent ? li('my-license.html', 'My Licenses') : ''}
          ${!isParent ? li('teacher-lesson-plans.html', 'My Lesson Plans') : ''}
          ${!isParent ? li('teacher-classrooms.html', 'My Classrooms') : ''}
          ${isParent ? li('parent-portal.html', 'Parent Portal') : ''}
          ${li('my-purchases.html', 'Purchase History')}
          <div style="height:1px; background:rgba(22,79,74,0.1); margin:4px 8px;"></div>
          <a href="#" onclick="fnAuthLogout(); return false;" style="display:block; padding:8px 12px; font-size:13.5px; font-weight:600; color:#D9502F; border-radius:6px;">Log Out</a>
        </div>
      </div>
    `;
  } else {
    nav.innerHTML = '';
  }
}

// Renders immediately from the local hint (no network wait) to avoid a
// "Log In" flash on every page load for already-logged-in visitors.
// fnAuthCheckSession() still runs right after to confirm/correct it.
function fnAuthRenderNavOptimistic() {
  const hint = localStorage.getItem(FN_AUTH_HINT_KEY);
  const role = localStorage.getItem(FN_AUTH_ROLE_KEY) || 'teacher';
  fnAuthRenderNav(!!hint, hint || null, role);
}
fnAuthRenderNavOptimistic();

function fnAuthToggleUserMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('fnAuthUserMenu');
  if (!menu) return;
  const opening = menu.style.display === 'none';
  menu.style.display = opening ? 'block' : 'none';
  if (opening) {
    document.addEventListener('click', function _close() {
      menu.style.display = 'none';
      document.removeEventListener('click', _close);
    }, { once: true });
  }
}

function fnFetchCommunityBadge() {
  Promise.all([
    fetch('/api/social/messages/conversations', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('/api/social/groups/unread', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(function(results) {
    const msgData = results[0], groupData = results[1];
    let total = 0;
    (msgData && msgData.conversations || []).forEach(function(c) { total += Number(c.unread_count) || 0; });
    (groupData && groupData.unread || []).forEach(function(g) { total += Number(g.unread_count) || 0; });
    const badge = document.getElementById('fnCommunityBadge');
    if (badge) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.style.display = total > 0 ? '' : 'none';
    }
  });
}

function fnAuthCheckSession() {
  fetch('/api/site-auth/me', { credentials: 'include' })
    .then(r => r.json())
    .then(function(data) {
      fnAuthRenderNav(data.loggedIn, data.firstName, data.role);
      if (data.loggedIn) fnFetchCommunityBadge();
    })
    .catch(function() { fnAuthRenderNav(false); });
}

async function fnAuthLogout() {
  await fetch('/api/site-auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (typeof cartClear === 'function') cartClear();
  fnAuthRenderNav(false);
  // Logging out used to just re-render the nav in place, leaving whatever
  // was already on screen (e.g. a classroom roster with student names and
  // PINs) fully visible indefinitely on a shared/classroom computer. A hard
  // navigation destroys that DOM state outright, not just the cookie.
  window.location.href = 'index.html';
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
      fnAuthRenderNav(true, result.firstName, result.role);
      fnAuthCloseModal();
      document.dispatchEvent(new CustomEvent('fn-auth-changed'));
      const _pa = sessionStorage.getItem('fn_pending_audiences');
      if (_pa) {
        sessionStorage.removeItem('fn_pending_audiences');
        const _aud = JSON.parse(_pa);
        if (_aud.length) {
          fetch('/api/site-auth/me/audiences', {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audiences: _aud }),
          }).catch(() => {});
        }
      }
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

// Redirect to index.html if the user is not logged in as a site_user.
// Call at the top of any teacher-facing page that requires a session.
function fnRequireSiteAuth(redirectTo) {
  fetch('/api/site-auth/me', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.loggedIn) window.location.href = redirectTo || 'index.html';
    })
    .catch(function() { /* server unreachable — page will show its own API errors */ });
}

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
