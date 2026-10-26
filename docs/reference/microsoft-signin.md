# Microsoft sign-in (Entra ID / Azure AD) — full reference

Moved out of CLAUDE.md to keep the per-turn context small. CLAUDE.md keeps the hard rules.

## Microsoft sign-in (Entra ID / Azure AD)

"Continue with Microsoft" in the shared auth modal (`site-auth.js` + the modal markup duplicated across 23 public HTML pages — same `fnAuthModalOverlay` maintenance pattern as everything else there) lets any `site_users` account — teacher, parent, school/district admin — sign in via their Microsoft 365 or personal Microsoft account instead of (or in addition to) a password. Routes live in `server/routes/site-auth.js` (`/microsoft/start`, `/microsoft/callback`); the MSAL client setup is in `server/lib/microsoft-oauth.js`.

A returning user is matched by `microsoft_oid` only. The email Microsoft reports is **never trusted by itself**: for work/school accounts the `mail` attribute is set by that tenant's own admin and isn't verified, so anyone with a free Entra tenant could otherwise claim `principal@anyschool.org` and take over (or pre-claim license seats for) the real account. A first-time Microsoft sign-in therefore emails that address a confirmation link (`microsoft-confirm.html`, a page with a **button** that POSTs to `/microsoft/confirm` — never a GET that acts, since mail scanners prefetch links); the pending sign-in rides in a 1-hour signed `msLink` token, and the account is only linked/created (and seats claimed) once the mailbox owner confirms. Linking never removes the password login path — both work afterward. `site_users.password_hash` is nullable for Microsoft-only accounts; `change-password` explicitly guards against `bcrypt.compare` on a null hash.

The Entra app registration **must** be multi-tenant ("accounts in any organizational directory and personal Microsoft accounts") — FNE serves many separate school districts, each with its own tenant, plus parents who may only have a personal account. A single-tenant registration would only work for one specific organization.

**Live in production since mid-October 2026** (Azure app registered, credentials in `server/.env`). `server/lib/microsoft-oauth.js`'s `isConfigured()` still guards both routes, so on any environment without the credentials the button degrades to a clear error toast instead of a crash.
