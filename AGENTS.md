# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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

On **cPanel Terminal** (production), `node`/`npm` are not on PATH. Every Node command must activate the nodevenv first — see "Deploy workflow" for the exact prefix.

**Where the database actually lives.** `fixernat_fixernation` (MariaDB, ~66 MB, app user `fixernat_fixernation_app`) runs on the same Hosting.com/cPanel account as the site itself, alongside the domain — see cPanel → MySQL Databases. That's why `server/.env` has `DB_HOST=127.0.0.1`: localhost *from the app server's point of view*, not from anyone's laptop. Calling it "no local DB" was misleading and has been fixed here: there is a real, live database, it just isn't on a dev machine. `SCHEMA.md` documents its current shape.

What that means in practice: a dev machine has no copy of the schema to try changes against (verified 2026-09-24 — no MySQL/MariaDB client installed, nothing listening on 3306, no database container), so migrations and queries are not exercised before they reach the server. All verification is done against production via `curl` with a cookie jar. Use `@example.com` emails and obviously-fake school domains for test data and clean them up after.

If a migration is ever worth dry-running first, Docker is available on the dev machine (it's already running containers for other projects), so a throwaway `mariadb` container is a reasonable way to prove `schema.sql` and an `alter-*.js` script before deploying. Nothing like that is set up today.

## Architecture

### Server (`server/`)

`app.js` loads all route modules and mounts them at `/api/*`. The two body-parser rules are load-order sensitive: `express.raw()` for `/api/checkout/webhook` must be registered before `express.json()` (Stripe signature check needs the raw body).

`server/lib/` holds shared utilities — always extract there when two route files would otherwise need to require each other:
- `mailer.js` — all transactional email (nodemailer SMTP)
- `access.js` — `getSiteUser(req)`, `hasActiveLicense(userId)` for curriculum/blog gating
- `settings.js` — `getSetting(key)` key-value store (contact routing, invoice branding)
- `automations.js` — `fireAutomation(eventKey, contact, mergeFields)` — single call site for all 6 auto-email events
- `session.js` — JWT cookie constants
- `site-tokens.js` — email verification and password-reset token generation
- `campaign-tracking.js` — open-pixel and link-click helpers; `classifySendError()` for bounce/undelivered classification

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

"Continue with Microsoft" in the shared auth modal (`site-auth.js` + the modal markup duplicated across 23 public HTML pages — same `fnAuthModalOverlay` maintenance pattern as everything else there) lets any `site_users` account — teacher, parent, school/district admin — sign in via their Microsoft 365 or personal Microsoft account instead of (or in addition to) a password. Routes live in `server/routes/site-auth.js` (`/microsoft/start`, `/microsoft/callback`); the MSAL client setup is in `server/lib/microsoft-oauth.js`.

A returning user is matched by `microsoft_oid` only. The email Microsoft reports is **never trusted by itself**: for work/school accounts the `mail` attribute is set by that tenant's own admin and isn't verified, so anyone with a free Entra tenant could otherwise claim `principal@anyschool.org` and take over (or pre-claim license seats for) the real account. A first-time Microsoft sign-in therefore emails that address a confirmation link (`microsoft-confirm.html`, a page with a **button** that POSTs to `/microsoft/confirm` — never a GET that acts, since mail scanners prefetch links); the pending sign-in rides in a 1-hour signed `msLink` token, and the account is only linked/created (and seats claimed) once the mailbox owner confirms. Linking never removes the password login path — both work afterward. `site_users.password_hash` is nullable for Microsoft-only accounts; `change-password` explicitly guards against `bcrypt.compare` on a null hash.

The Entra app registration **must** be multi-tenant ("accounts in any organizational directory and personal Microsoft accounts") — FNE serves many separate school districts, each with its own tenant, plus parents who may only have a personal account. A single-tenant registration would only work for one specific organization.

"Coded but not live until configured" (same pattern as `ELEVENLABS_API_KEY`) — `server/lib/microsoft-oauth.js`'s `isConfigured()` guards both routes, so the button degrades to a clear error toast instead of a crash until the real Azure credentials are in `server/.env`. Needs `npm install --prefix server` (`@azure/msal-node`), `node scripts/alter-add-microsoft-oauth.js`, and a Node app restart before going live.

## Admin navigation and Mission Control visual system

`admin-nav.js` renders the sidebar for 23 admin workspace pages from one `SECTIONS` array. Preserve the existing workflow groups: Sales, Schools & Partners, Content, Marketing & CRM, Community, Reports (Sales was split from the original "Sales & Schools" on 2026-10-13 -- it mixed catalog/config with transactional workflow). Mission Control (the existing dashboard URL) remains pinned; Settings/View Site/Log Out remain in the footer. This supersedes the former alphabetical/per-page navigation instructions.

`admin-shell.js` renders the common page header, local page finder, mobile drawer, and page-specific introductions. It moves existing heading nodes rather than cloning them so dynamic IDs such as `ccTitle` continue to work. Do not add shell code to `admin-common.js`, which is also used by public pages. The approved visual direction is recorded in `.interface-design/system.md`.

Bump the relevant cache version across all exact admin HTML references when changing shared assets. Current versions: admin-common.css v21, admin-nav.js v23, admin-shell.js v1; admin-common.js v17 (added the shared `fnEscape`), site-auth.js v10, school-admin-nav.js v19, district-admin-nav.js v5. Do not accidentally match school-admin or district-admin assets.

## Deploy workflow

Commit → push to GitHub (`github.com/ooWOWZERoo/FixerNation` — **public repo, never commit real PII or secrets**) → user runs the following in cPanel's browser Terminal.

**Git credentials:** `credential.helper osxkeychain` is now configured globally (`~/.gitconfig`). On first push after a new macOS session, the terminal will prompt for GitHub username (`ooWOWZERoo`) and a personal access token (PAT) as the password — macOS Keychain caches it from then on. **Codex's Bash tool cannot push to GitHub directly** (non-interactive, can't authenticate) — always commit from the Bash tool, then instruct the user to complete step 1 below before any cPanel step.

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
     /home/fixernat/repositories/fixernation/ /home/fixernat/public_html/
   ```
   `api/` is cPanel-generated proxy glue (not in git). `uploads/` holds real uploaded files (not in git). Excluding both from `--delete` is intentional — they must never be wiped. `tests`, `docs`, `deploy.sh` and `.interface-design` are repo internals that used to be copied into the web root and served publicly (test code with a hard-coded test password, internal scripts); they're excluded now, and `.htaccess` also blocks those paths. **`--exclude` only protects a path from `--delete` — it does not remove copies already sitting in `public_html`.** Those need a one-time manual cleanup (delete `public_html/tests`, `docs`, `deploy.sh`, `ads.db`, `.interface-design`, and the stale `public_html/server` tree if it is not the live Node app root — check cPanel → Setup Node.js App first). **Never add `--delete-excluded`** — it deletes every excluded path found on the destination, including `api/` and `uploads/`. This has happened once and took down all API routes until the Node app was restarted to regenerate `api/`.

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

**Always write the access matrix before building any endpoint that gates access.**
Write every role (anonymous, student, licensed teacher, admin) × every action (view, download, edit) for the specific resource. Share it, confirm it, implement once against it. The file-serving endpoint was fully rewritten because this was skipped — it blocked teachers who had valid licenses.

Example matrix for curriculum file endpoints:
```
Role              | View file | Download file | View Quiz+Key | View docs
------------------+-----------+---------------+---------------+----------
Anonymous         |    YES    |      NO       |      NO       |    NO
Student (class)   |    YES*   |      NO       |      NO       |    NO
Licensed teacher  |    YES    |  YES (counted)|      YES      |   YES
Admin             |    YES    |      YES      |      YES      |   YES
* Student Handout only
```

**Never block the old access path until the new one is proven live.**
Build and verify the replacement in production first; block the old path second. Adding an `.htaccess` `Deny from all` to `uploads/` before the Node `/file` endpoint was running would have taken down every file link. The rule: prove the replacement works, then optionally add the block.

**Grep the entire codebase before calling any security or access migration complete.**
When file access was migrated from raw `/uploads/` URLs to the `/api/.../file` endpoint, a fourth page (`education-portal.html`) was missed and only caught by manual production testing. Before closing any cross-cutting change, run:
```bash
grep -rn "old pattern" --include="*.html" --include="*.js" .
```

**Server-side protection and browser-side protection are different problems.**
Securing the API endpoint (who can call it) is not the same as preventing the user at the browser from saving the rendered content. Opening a file in a new tab via the API still exposes the native PDF viewer's Download button and right-click Save As. PDF.js canvas rendering addresses the browser-side threat: no download button, right-click yields a single-page PNG, URL never appears in the address bar.

**PDF iframes are unreliable.** They fail on iOS/iPadOS and when `Content-Disposition: attachment` is set. Use PDF.js canvas rendering in a modal (`pdf-modal.js`) or open in a new tab via the API. Test on mobile before shipping any file-display feature.

## Security rules (from the 2026-10-15 audit — each one closed a real hole)

- **Never call `jwt.sign`/`jwt.verify` directly** — use `server/lib/session-tokens.js` (per-session-type `aud`; see "Two separate auth systems").
- **Rate limiting:** public endpoints that send email, create rows, or check credentials use `server/lib/rate-limit.js` — `limiter()` for spam-prone forms, `FailureTracker` for logins (counts failures only, cleared on success). It reads the **rightmost** `X-Forwarded-For` entry (the one LiteSpeed wrote; the left ones are client-supplied) and **skips IP limits entirely** when no client IP resolves, so one visitor can never exhaust a bucket shared by everyone. Student PINs are 6 digits, so the per-username lockout (5 failures / 15 min) is the real protection — don't loosen it. Check the app log for the one-time `rate-limit: could not resolve a client IP` warning after deploy.
- **Uploads:** a file's type comes from its bytes (`server/lib/upload-safety.js` — `sniffFile`/`finalizeUpload`), never from the client's `Content-Type` or filename, and the stored extension comes from the detected type. Images from non-admin users are decoded and re-encoded to WebP (`reencodeImageToWebp`) so a disguised HTML/SVG/script file can't survive. SVG is not an accepted upload type (logos go through `branding-editor.js`, which sanitizes it). Uploads are served from the site's own origin, so a stored `.html` is a page that runs with the site's privileges.
- **Randomness for anything guessable-matters** (PINs, join/parent codes, tokens, placeholder passwords): `crypto.randomInt` / `crypto.randomBytes`, never `Math.random()`.
- **Public endpoints that write CRM rows** take only the fields the public form actually has (`POST /api/newsletter/contacts` is name + email for anonymous callers; the full payload only for a real admin).
- **Escaping:** see the Frontend section — `fnEscape()`, and `data-` attributes instead of data inside inline handlers. Email HTML bodies must use `esc()`/`safeUrl()` from `lib/mailer.js` for any user-supplied value (plain-text bodies stay unescaped).
- **Second-level IDs need their own scope check.** Owning classroom `:id` says nothing about `:studentId`; being in a group says nothing about a `:postId` in a different group. Every ID taken from the URL/body gets bound to the already-verified parent in its own query.
- **`.htaccess`:** `<Directory>`/`<LocationMatch>` aren't allowed there and `LimitRequestBody` can't be scoped to a path (it's a global 256 MB cap — lowering it needs the host's server config). Use `RewriteRule`/`SetEnvIf`+`Header … env=`, which are proven to work on this host. CSP is currently **report-only** — promote it to `Content-Security-Policy` once the console is quiet.
- **Never commit credentials**, including test/QA ones: the repo is public and the QA fixture accounts are real accounts in the production DB (one holds a paid licence seat). `seed-qa-test-accounts.js` and the e2e tests read `QA_PASSWORD`/`TEST_QA_PASSWORD` from the environment.

## Sales demo accounts

One account per salesperson, **demo data only**, created with `server/scripts/seed-sales-demo-account.js` (`--email --first --last`; dry run by default — it runs every statement in a transaction against the real schema and rolls back; `--apply` commits and emails the person a link to choose their own password; `--no-email` prints the link instead). The account is a normal `site_users` row (NOT an FNE admin — it can't reach any `admin-*.html` page) holding every customer role against a fake district/school (`sales-demo.example.com`) and its own demo classroom with three fake students: teacher (licence seat), parent (link to a demo student), school licence admin, district admin. Re-running for the same email only fills in what's missing. Never point a salesperson at a real customer's school or district — those portals show real student and teacher records. The shared demo licence product is $0/inactive and the contact is Unsubscribed so it never shows in revenue or gets emailed; the purchase is tagged `source = 'Sales Demo'` if it needs filtering out of a report. Note a demo account has a licence seat, so it also has access to the teacher community.

Parent access is decided by **parent links** (`parent_classroom_links`, via `isLinkedParent()` in `lib/access.js`), never by `site_users.role` — `role` holds one value and every admin/parent assignment overwrites it, which is exactly why a combined account would otherwise lose its parent portal depending on assignment order.

## Infra gotchas (all previously bitten in this project)

- **`dotenv.config()` needs an explicit path.** Under this host's Passenger/LiteSpeed Node integration, `process.cwd()` isn't the app root — `require('dotenv').config()` with no path silently loads nothing. Use `require('dotenv').config({ path: path.join(__dirname, '.env') })` (or `path.join(__dirname, '..', '.env')` in scripts one level deeper).
- **Don't use `cookie-session` or any library relying on Express's deferred `on-headers` write hook** — it silently fails to attach `Set-Cookie` on this host. Sign a JWT and attach it via a direct `res.cookie()` call in the route handler itself.
- **The reverse proxy rejects POST/PUT/DELETE with no body/Content-Type** — returns a bare 400 before Express ever sees it. Every mutating `fetch()` must send `headers: {'Content-Type': 'application/json'}` and a body (`'{}'` if nothing to send), even for actions like logout.
- **A route file with a bare `GET /:id` must be declared after any more-specific `GET /literal-path` route**, or Express treats the literal path as an `:id` value (e.g. `campaigns.js`'s public `GET /track-open` pixel endpoint is declared before any `/:id` route).
- **Watch for circular `require()`s** between route files that both need something from each other — extract the shared function into `server/lib/` instead.
- **`admin-common.js`/`admin-common.css` are cache-busted as `?v=N`** — bump `N` in every HTML file referencing them whenever either file changes (grep `admin-common.js?v=`).
- Don't let a new commit assume an intentionally undeployed prior commit's schema is already live — `git pull` always catches the server up to HEAD, so if two commits land together, code written against commit B's schema can break if B ships before A's migration runs.

## Working with this codebase in an AI-assisted session

**Give a constraint inventory at the start of any new session.** The real constraints are on the *host*: Hosting.com/cPanel shared hosting, no SSH (browser Terminal only), no pm2, and the MariaDB database sits on that same server rather than on any dev machine. Docker is **not** a constraint — it's installed and running on the dev machine, so don't repeat the old "no Docker" line that used to be here. The relevant constraints are all documented in this file — point a new session here first.

**Requirements before code, always.** For any feature touching access control, billing, or user-facing auth behavior: write the requirement explicitly, get it confirmed, then ask for implementation. Both the file protection endpoint and the download counter were rebuilt because this step was skipped.

**Cross-cutting changes need a codebase-wide grep.** After any migration (URL patterns, auth patterns, analytics instrumentation), ask: "Are there any other pages in the codebase where this same pattern exists?" before closing the work. A missed page is always worse than the cost of one grep.

**Save learnings to persistent memory during the session.** Context compacts on long sessions. Any correction or discovery that should hold for future sessions belongs in the memory system — not just in the current context window.

**Token/cost hygiene.** Specific prompts cost less than vague ones. File path + line number saves a full read. Batch related edits into one prompt. End sessions at clean boundaries (feature complete, deployed) rather than mid-task. Put everything that would need re-explaining into this file.

## Maintain the changelog

Every time a feature or fix is completed and deployed, add a new release entry to the top of `CHANGELOG.md` (below the `Unreleased / Known pending work` section). Keep entries short and business-facing — what changed and why it matters, not a line-by-line code diff. Format: `## Release N — YYYY-MM-DD — Title` with short bullets. Increment `N` from the previous release. If a feature is coded and pushed but not yet deployed (e.g. blocked on a credential), note it under `Unreleased / Known pending work` instead.

Also update `PROJECT.md` if the change affects architecture, the page list, or known limitations — it describes the current state, not history.
