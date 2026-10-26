# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fixer Nation Education (fixernationeducation.com) — Node/Express + MariaDB backend, plain HTML/CSS/vanilla JS frontend, deployed on Hosting.com/cPanel. See `PROJECT.md` for architecture/feature overview and `CHANGELOG.md` for release history.

## Commands

```bash
# Development (from server/)
npm start          # node app.js
npm run dev        # node --watch app.js (auto-restart on file change)

# Database (from server/)
npm run db:migrate # node scripts/migrate.js  — CREATE TABLE IF NOT EXISTS for all tables
npm run db:seed    # node scripts/seed.js     — seed reference data (run after migrate)
```

On **cPanel Terminal** (production) `node`/`npm` are not on PATH — activate the nodevenv first (see Deploy workflow). The MariaDB database `fixernat_fixernation` (~66 MB) lives on the same cPanel account as the site (`DB_HOST=127.0.0.1` means the server itself); a dev machine has no copy, so verify against production with `curl` and a cookie jar, using `@example.com` emails and fake school domains, and clean up. `SCHEMA.md` documents the schema.
## Architecture

### Server (`server/`)

`app.js` loads all route modules and mounts them at `/api/*`. The two body-parser rules are load-order sensitive: `express.raw()` for `/api/checkout/webhook` must be registered before `express.json()` (Stripe signature check needs the raw body).

`server/lib/` holds shared utilities — extract there when two route files would otherwise need to require each other (circular requires bite). Key ones: `mailer.js` (all transactional email), `access.js` (`getSiteUser`, `hasActiveLicense`, `isLinkedParent`), `settings.js` (`getSetting`), `automations.js` (`fireAutomation` — single call site for auto-emails), `session-tokens.js` (all JWT signing), `site-tokens.js` (verify/reset tokens), `campaign-tracking.js` (open pixel, link clicks, bounce classification), `rate-limit.js`, `upload-safety.js`, `standards.js`.

`server/db/pool.js` exports a `mysql2/promise` pool (connectionLimit 10, `dateStrings: true`). Queries follow this pattern everywhere:
```js
const [rows] = await pool.query('SELECT ...', [params]);
const [[row]] = await pool.query('SELECT ... LIMIT 1', [id]);
```

### Two separate auth systems — never mix them

| | Admin auth | Site-user auth |
|---|---|---|
| Cookie name | `fn_session` | `fn_user_session` |
| Middleware | `requireAuth` (`middleware/auth.js`) | `requireSiteAuth` (`middleware/siteAuth.js`) |
| Identity | Single admin account | Teachers / consumers who sign up on the site |
| Used in | All `admin-*.html` pages, all `requireAuth` routes | Public-facing `/api/site-auth/*`, membership, curriculum access |

**All three session types are signed with the same `SESSION_SECRET`, so they are separated by a JWT `aud` claim, not just by cookie name** (an attacker controls their own cookie jar — without `aud`, a free site-user's token pasted into `fn_session` passed `requireAuth` as admin). Every sign/verify goes through `server/lib/session-tokens.js` (`signSession(kind, …)` / `verifySession(kind, …)`, kinds `admin` / `site` / `student` / `msLink`). **Never call `jwt.sign`/`jwt.verify` directly.** `requireAuth` additionally confirms the admin row still exists. `getAuthUser(req)` returns the admin user if the `fn_session` cookie is valid. `getSiteUser(req)` returns the site user from `fn_user_session`. A licensed teacher accessing curriculum uses `getSiteUser` + `hasActiveLicense` — never `getAuthUser`.

### Database schema changes

`server/db/schema.sql` is the source of truth for fresh installs (all `CREATE TABLE IF NOT EXISTS`). `scripts/migrate.js` runs it.

For changes to **existing** tables: write a one-off idempotent script following the `server/scripts/alter-*.js` pattern — check `information_schema.COLUMNS` or `TABLES` before altering, catch and skip `ER_DUP_FIELDNAME`. The growing `seed-user-groups.js` script now consolidates many of these migrations and is safe to re-run. Always update `schema.sql` too so it stays current for fresh installs.

### Cron scripts (`server/scripts/`)

`send-membership-reminders.js` and `send-morning-boost-email.js` run via cPanel Cron Jobs every 5 minutes. Each script is fully self-contained: it loads `.env`, creates its own DB pool, does work, and closes the pool. Scripts check conditions (time window, already-sent guards) so running every 5 minutes is idempotent.

### Frontend

No build step. All public pages are flat HTML files with inline `<style>` and `<script>` blocks. Shared JS files loaded via `<script src="...">`:

- `admin-common.js` / `admin-common.css` — shared by all `admin-*.html` pages. **Cache-busted as `?v=N`** — bump `N` in every admin HTML file whenever either one changes (grep `admin-common.js?v=` to find all references).
- `site-auth.js` — login/signup modal, auth-state nav rendering, used on every public page.
- `cart.js` — localStorage cart helper used on every public page with a shopping element.

**Escaping rule (admin pages especially):** anything that originated outside the admin's own keyboard — public form fields, newsletter signups, analytics beacons, signup names/emails, student display names — must go through `fnEscape()` (`admin-common.js`) before it's interpolated into `innerHTML` or an attribute. Never put such data inside an inline `onclick="fn('${...}')"` string: HTML-escaping doesn't help there (`&#39;` decodes back to `'` before the JS runs). Put it in a `data-` attribute (`data-v="${fnEscape(x)}" onclick="fn(this.dataset.v)"`).

Public pages write `credentials: 'include'` on every `fetch()` to send the `fn_user_session` cookie. Admin pages rely on the `fn_session` cookie the same way.

CSS variables are defined in `admin-common.css` for admin pages. Public pages define their own `:root` variables inline. The brand palette: `--teal: #164F4A`, `--teal-dark: #0E3733`, `--coral: #F26B4D`, `--coral-dark: #D9502F`, `--gold: #EBA657`, `--cream: #FBF5EC`, `--ink: #2A2420`, `--ink-soft: #6B5F55`. Note: `--muted` and `--border-light` are **not** defined in public pages — never use them there.

## Environment variables

Required in `server/.env`:

```
PORT=3001
SESSION_SECRET=          # long random string, required at startup

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=

SMTP_HOST=               # cPanel mailbox relay
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=               # full email address of the mailbox
SMTP_PASSWORD=

SITE_URL=https://fixernationeducation.com
UPLOADS_DIR=./uploads                    # dev; production uses absolute path
UPLOADS_URL_PREFIX=/uploads/

SERVE_STATIC=true        # dev only — production has Apache serve static files

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

ELEVENLABS_API_KEY=      # not yet live; blocks Morning Boost voice-over

MS_OAUTH_CLIENT_ID=      # not yet live; blocks "Continue with Microsoft" site-user sign-in
MS_OAUTH_CLIENT_SECRET=
MS_OAUTH_REDIRECT_URI=   # must exactly match the redirect URI registered in Azure, e.g. https://fixernationeducation.com/api/site-auth/microsoft/callback
```

## Microsoft sign-in (Entra ID / Azure AD)

"Continue with Microsoft" for any `site_users` account (`/microsoft/start|callback|confirm` in `routes/site-auth.js`, `lib/microsoft-oauth.js`). **Live in production** since mid-Oct 2026; `isConfigured()` guards the routes. Hard rules: match returning users by `microsoft_oid` only and **never trust the email Microsoft reports** (tenant admins set `mail`); a first-time sign-in emails a confirm link to `microsoft-confirm.html`, whose **button** POSTs (never a GET that acts — mail scanners prefetch links); `password_hash` is nullable, so guard `bcrypt.compare`; the Entra app registration must stay multi-tenant. Detail: `docs/reference/microsoft-signin.md`.
## Admin navigation and Mission Control visual system

`admin-nav.js` renders the sidebar for the admin workspace pages from one `SECTIONS` array (groups: Sales, Schools & Partners, Content, Marketing & CRM, Community, Reports; Mission Control pinned; Settings/View Site/Log Out in the footer). `admin-shell.js` renders the page header, page finder, mobile drawer and page intros (it moves heading nodes, never clones them; don't put shell code in `admin-common.js`, which public pages also load). Visual direction: `.interface-design/system.md`. Bump the `?v=N` cache version on every exact admin HTML reference when a shared asset changes. Current: admin-common.css v21, admin-nav.js v25, admin-shell.js v2, admin-common.js v17, site-auth.js v10, footer.js v6, school-admin-nav.js v19, district-admin-nav.js v5 (don't match school-admin/district-admin assets by accident).
## Deploy workflow

Commit → push to GitHub (`github.com/ooWOWZERoo/FixerNation` — **public repo, never commit real PII or secrets**) → user runs the following in cPanel's browser Terminal.

**Every command block given to the user for manual execution must start with an explicit `cd /full/absolute/path` — never a bare relative command, never `~` shorthand, never an assumption that the shell is already in the right directory.** The user has asked for this repeatedly. This applies to every step below, including `rsync` (both the source and destination paths) — write out `/home/fixernat/...` in full, not `~/...`, even though `~` happens to resolve the same way on this account.

**Git credentials:** `credential.helper osxkeychain` is now configured globally (`~/.gitconfig`). On first push after a new macOS session, the terminal will prompt for GitHub username (`ooWOWZERoo`) and a personal access token (PAT) as the password — macOS Keychain caches it from then on. **Claude's Bash tool cannot push to GitHub directly** (non-interactive, can't authenticate) — always commit from the Bash tool, then instruct the user to complete step 1 below before any cPanel step.

1. **Push to GitHub** (run on your local Mac terminal — not cPanel):
   ```bash
   git push
   ```
   Do not proceed to cPanel until this succeeds. A cPanel `git pull` will return "Already up to date" if this step is skipped.

2. **Pull:**
   ```bash
   cd /home/fixernat/repositories/fixernation && git pull
   ```

3. **Sync static files to `public_html`:**
   ```bash
   cd /home/fixernat/repositories/fixernation && \
   rsync -av --delete \
     --exclude='.git' \
     --exclude='.gitignore' \
     --exclude='*.md' \
     --exclude='server' \
     --exclude='api' \
     --exclude='uploads' \
     --exclude='tests' \
     --exclude='docs' \
     --exclude='deploy.sh' \
     --exclude='.interface-design' \
     --exclude='mission-control-static-files.txt' \
     /home/fixernat/repositories/fixernation/ /home/fixernat/public_html/
   ```
   `api/` is cPanel-generated proxy glue (not in git). `uploads/` holds real uploaded files (not in git). Excluding both from `--delete` is intentional — they must never be wiped. `tests`, `docs`, `deploy.sh`, `.interface-design` and `mission-control-static-files.txt` are repo internals that used to be copied into the web root and served publicly (test code with a hard-coded test password, internal scripts); they're excluded now, and `.htaccess` also blocks those paths. **`--exclude` only protects a path from `--delete` — it does not remove copies already sitting in `public_html`.** Those need a one-time manual cleanup (delete `public_html/tests`, `docs`, `deploy.sh`, `ads.db`, `.interface-design`, and the stale `public_html/server` tree if it is not the live Node app root — check cPanel → Setup Node.js App first). **Never add `--delete-excluded`** — it deletes every excluded path found on the destination, including `api/` and `uploads/`. This has happened once and took down all API routes until the Node app was restarted to regenerate `api/`.

4. **Activate nodevenv before any Node command — every single time:**
   ```bash
   source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
     cd /home/fixernat/repositories/fixernation/server
   ```
   Activating in one command does **not** carry over to the next shell instruction. Always chain with `&&`. When giving deploy instructions, always include this prefix — a bare `node scripts/whatever.js` causes `bash: node: command not found`.

5. `npm install` (with prefix) if `server/package.json` changed.

6. **Restart the Node app** (cPanel → Setup Node.js App panel) if any `server/` code changed. `git pull` alone leaves old code running in memory — new routes 404 with Express's own page, not a server crash. **pm2 is not installed** on this host.

7. For schema changes to existing tables: run the one-off alter script with the nodevenv prefix (**run it before restarting the Node app** when the new code reads the column — `middleware/auth.js` and `routes/auth.js` tolerate the missing `admin_users.session_invalidated_at` column, but don't rely on that):
   ```bash
   source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
     cd /home/fixernat/repositories/fixernation/server && \
     node scripts/alter-whatever.js
   ```
   `migrate.js` silently no-ops on existing tables.

When giving deploy instructions after a push, always specify:
- Which HTML files to include in the `rsync` (or use the broad `rsync` above for large changes)
- Whether a seed/alter script needs to be run
- Whether a restart is needed

## Access control design rules

Write the access matrix (role × action) before building any gating endpoint, confirm it, then implement once. Never block an old access path until its replacement is proven live in production. After any security or access migration, grep the whole codebase for the old pattern (a fourth page was missed once). Server-side protection is not browser-side protection: show PDFs with PDF.js canvas rendering (`pdf-modal.js`), never iframes (they fail on iOS and with `Content-Disposition: attachment`). Example matrix and history: `docs/reference/security-and-access-rules.md`.
## Security rules (from the 2026-10-15 audit — each one closed a real hole)

- **Never call `jwt.sign`/`jwt.verify` directly** — use `server/lib/session-tokens.js` (per-type `aud`).
- **Rate limiting:** `lib/rate-limit.js` — `limiter()` for spam-prone forms, `FailureTracker` for logins; rightmost `X-Forwarded-For`; student PIN lockout (5 failures/15 min per username) is the real protection, don't loosen it.
- **Uploads:** type comes from the file's bytes (`lib/upload-safety.js`), never `Content-Type` or filename; non-admin images are re-encoded to WebP; no SVG uploads.
- **Randomness** for anything guessable (PINs, codes, tokens): `crypto.randomInt`/`randomBytes`, never `Math.random()`.
- **Public endpoints that write CRM rows** take only the fields the public form has.
- **Escaping:** `fnEscape()` in admin pages, `data-` attributes instead of data inside inline handlers; `esc()`/`safeUrl()` from `lib/mailer.js` in email HTML.
- **Second-level IDs** (`:studentId`, `:postId`) need their own scope check against the verified parent.
- **`.htaccess`:** no `<Directory>`/`<LocationMatch>`; use `RewriteRule`/`SetEnvIf`+`Header … env=`. CSP is report-only until the console is quiet. `LimitRequestBody` is a global 256 MB cap.
- **Never commit credentials**, including QA ones (public repo; QA accounts are real prod accounts) — scripts read `QA_PASSWORD`/`TEST_QA_PASSWORD` from the environment.
- **`RegExp.test()` coerces:** `typeof` check request input first (`undefined` matches `^[a-z]{8,}$`).

Why each rule exists: `docs/reference/security-and-access-rules.md`.
## Sales demo accounts

One account per salesperson, **demo data only**, made by `server/scripts/seed-sales-demo-account.js` (dry run by default; `--apply`, `--no-email`, `--allow-existing`; run `alter-add-sales-demo-flag.js` first). It is a normal `site_users` row holding every customer role against a fake school/district — NOT an FNE admin. Confined server-side by `site_users.is_sales_demo` (`lib/sales-demo.js`): refused by community routes; school/district portals filtered to the demo school/district; teacher invitations limited to example.com, the inviter's own company domain, or (consumer providers like yahoo/gmail) only their own mailbox and `+` variants. Never point a salesperson at a real school or district. Parent access is `isLinkedParent()` (parent links), never `site_users.role`. Detail: `docs/reference/sales-demo-accounts.md`.
## State standards & Portrait of a Graduate crosswalk

Design, rules, access matrix, phases: `docs/standards-crosswalk/DESIGN.md` — read before touching. Admin page `admin-standards.html`; public page `state-standards.html`; code `lib/standards.js`, `routes/standards.js`, `routes/admin-standards.js`, `scripts/import-standards.js` (research JSON in `server/data/standards/<STATE>.json` → draft rows); tables from `alter-create-standards-crosswalk.js`. `cd server && npm test` runs the real routes on a real SQL engine (`node:sqlite`) — keep SQL portable (no `NOW()`, `ON DUPLICATE KEY`, array params). Rules that must not erode: every record has an https source and the date checked; public SQL filters `review_status = 'verified'`; editing a verified record re-drafts it; an alignment verifies only once its framework does; the public API strips reviewer `notes` (`forPublic()`); alignment is FNE's thematic mapping, never a state or CASEL endorsement; short summaries and links out, not whole documents. Claude researches and drafts but **cannot verify**. Lesson connections apply to every grade version of a lesson (K-5/6-8/9-12; higher-ed never shown) — see "Grade levels" in DESIGN.md.
## Infra gotchas (all previously bitten in this project)

- **The Node app's error log is `/home/fixernat/repositories/fixernation/server/stderr.log`** (not `~/logs`, which only holds cron/PHP logs). It has **no timestamps** and keeps old entries, so judge recency from the file's modified time (`ls -l --time-style=long-iso`) and from stack-trace line numbers vs. the deployed file. To test whether it is still being written, send one deliberately malformed request tagged with a unique `User-Agent` and `grep` for it (done 2026-10-26 — the log is alive and was simply quiet).
- **`dotenv.config()` needs an explicit path.** Under this host's Passenger/LiteSpeed Node integration, `process.cwd()` isn't the app root — `require('dotenv').config()` with no path silently loads nothing. Use `require('dotenv').config({ path: path.join(__dirname, '.env') })` (or `path.join(__dirname, '..', '.env')` in scripts one level deeper).
- **Don't use `cookie-session` or any library relying on Express's deferred `on-headers` write hook** — it silently fails to attach `Set-Cookie` on this host. Sign a JWT and attach it via a direct `res.cookie()` call in the route handler itself.
- **The reverse proxy rejects POST/PUT/DELETE with no body/Content-Type** — returns a bare 400 before Express ever sees it. Every mutating `fetch()` must send `headers: {'Content-Type': 'application/json'}` and a body (`'{}'` if nothing to send), even for actions like logout.
- **A route file with a bare `GET /:id` must be declared after any more-specific `GET /literal-path` route**, or Express treats the literal path as an `:id` value (e.g. `campaigns.js`'s public `GET /track-open` pixel endpoint is declared before any `/:id` route).
- **Watch for circular `require()`s** between route files that both need something from each other — extract the shared function into `server/lib/` instead.
- **`admin-common.js`/`admin-common.css` are cache-busted as `?v=N`** — bump `N` in every HTML file referencing them whenever either file changes (grep `admin-common.js?v=`).
- Don't let a new commit assume an intentionally undeployed prior commit's schema is already live — `git pull` always catches the server up to HEAD, so if two commits land together, code written against commit B's schema can break if B ships before A's migration runs.
- **`brain-games.js`'s `getPrincipal()` (dual site-user/PIN-student resolver) tries a site-user (`fn_user_session`) cookie before a student (`fn_student_session`) one.** If a browser context (or Playwright test) has signed in as both a teacher and a PIN student, `GET /api/brain-games/me/*` silently returns the teacher's own progress/badges, not the student's — no error, just the wrong identity. When a test needs to check a PIN-student's brain-games state, drive that part from an isolated `browser.newContext()`, not the same context/page used for teacher setup calls.

## Working with this codebase in an AI-assisted session

Real constraints are on the host: Hosting.com/cPanel shared hosting, no SSH (browser Terminal only), no pm2, and MariaDB lives on that server (Docker exists on the dev machine and can run a throwaway mariadb). **Requirements before code** for anything touching access control, billing, or auth: write them, get them confirmed, then build. **Grep the codebase** after any cross-cutting change. **Save learnings to memory** during the session. Keep prompts specific (file + line), batch edits, and end sessions at clean boundaries.
## Maintain the changelog

Every time a feature or fix is completed and deployed, add a new release entry to the top of `CHANGELOG.md` (below the `Unreleased / Known pending work` section). Keep entries short and business-facing — what changed and why it matters, not a line-by-line code diff. Format: `## Release N — YYYY-MM-DD — Title` with short bullets. Increment `N` from the previous release. If a feature is coded and pushed but not yet deployed (e.g. blocked on a credential), note it under `Unreleased / Known pending work` instead.

Also update `PROJECT.md` if the change affects architecture, the page list, or known limitations — it describes the current state, not history.
