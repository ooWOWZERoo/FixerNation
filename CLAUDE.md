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

On **cPanel Terminal** (production), `node`/`npm` are not on PATH. Every Node command must activate the nodevenv first — see "Deploy workflow" for the exact prefix.

No local dev environment exists — no local MySQL/MariaDB, and the sandbox blocks outbound DB connections. All verification is done against production via `curl` with a cookie jar. Use `@example.com` emails and obviously-fake school domains for test data and clean them up after.

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

`getAuthUser(req)` returns the admin user if the `fn_session` cookie is valid. `getSiteUser(req)` returns the site user from `fn_user_session`. A licensed teacher accessing curriculum uses `getSiteUser` + `hasActiveLicense` — never `getAuthUser`.

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
```

## Admin nav ordering

The icon nav in every `admin-*.html` sidebar is **strictly alphabetical** within the cluster below the divider. Dashboard always stays alone above the divider; Settings/View Site/Log Out always stay in the footer unordered. Insert new nav links alphabetically by label — not at the end, not next to the conceptually related page. Also add the link to **every other** `admin-*.html` file (grep `admin-morning-boost.html` to see the pattern).

## Deploy workflow

Commit → push to GitHub (`github.com/ooWOWZERoo/FixerNation` — **public repo, never commit real PII or secrets**) → user runs the following in cPanel's browser Terminal.

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
   rsync -av --delete \
     --exclude='.git' \
     --exclude='.gitignore' \
     --exclude='*.md' \
     --exclude='server' \
     --exclude='api' \
     --exclude='uploads' \
     ~/repositories/fixernation/ ~/public_html/
   ```
   `api/` is cPanel-generated proxy glue (not in git). `uploads/` holds real uploaded files (not in git). Excluding both from `--delete` is intentional — they must never be wiped. **Never add `--delete-excluded`** — it deletes every excluded path found on the destination, including `api/` and `uploads/`. This has happened once and took down all API routes until the Node app was restarted to regenerate `api/`.

4. **Activate nodevenv before any Node command — every single time:**
   ```bash
   source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
     cd /home/fixernat/repositories/fixernation/server
   ```
   Activating in one command does **not** carry over to the next shell instruction. Always chain with `&&`. When giving deploy instructions, always include this prefix — a bare `node scripts/whatever.js` causes `bash: node: command not found`.

5. `npm install` (with prefix) if `server/package.json` changed.

6. **Restart the Node app** (cPanel → Setup Node.js App panel) if any `server/` code changed. `git pull` alone leaves old code running in memory — new routes 404 with Express's own page, not a server crash. **pm2 is not installed** on this host.

7. For schema changes to existing tables: run the one-off alter script with the nodevenv prefix:
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

## Infra gotchas (all previously bitten in this project)

- **`dotenv.config()` needs an explicit path.** Under this host's Passenger/LiteSpeed Node integration, `process.cwd()` isn't the app root — `require('dotenv').config()` with no path silently loads nothing. Use `require('dotenv').config({ path: path.join(__dirname, '.env') })` (or `path.join(__dirname, '..', '.env')` in scripts one level deeper).
- **Don't use `cookie-session` or any library relying on Express's deferred `on-headers` write hook** — it silently fails to attach `Set-Cookie` on this host. Sign a JWT and attach it via a direct `res.cookie()` call in the route handler itself.
- **The reverse proxy rejects POST/PUT/DELETE with no body/Content-Type** — returns a bare 400 before Express ever sees it. Every mutating `fetch()` must send `headers: {'Content-Type': 'application/json'}` and a body (`'{}'` if nothing to send), even for actions like logout.
- **A route file with a bare `GET /:id` must be declared after any more-specific `GET /literal-path` route**, or Express treats the literal path as an `:id` value (e.g. `campaigns.js`'s public `GET /track-open` pixel endpoint is declared before any `/:id` route).
- **Watch for circular `require()`s** between route files that both need something from each other — extract the shared function into `server/lib/` instead.
- **`admin-common.js`/`admin-common.css` are cache-busted as `?v=N`** — bump `N` in every HTML file referencing them whenever either file changes (grep `admin-common.js?v=`).
- Don't let a new commit assume an intentionally undeployed prior commit's schema is already live — `git pull` always catches the server up to HEAD, so if two commits land together, code written against commit B's schema can break if B ships before A's migration runs.

## Working with this codebase in an AI-assisted session

**Give a constraint inventory at the start of any new session.** This codebase runs on Hosting.com/cPanel shared hosting with no SSH, no pm2, no local DB, and no Docker. The AI will suggest those tools unless told not to. The relevant constraints are all documented in this file — point a new session here first.

**Requirements before code, always.** For any feature touching access control, billing, or user-facing auth behavior: write the requirement explicitly, get it confirmed, then ask for implementation. Both the file protection endpoint and the download counter were rebuilt because this step was skipped.

**Cross-cutting changes need a codebase-wide grep.** After any migration (URL patterns, auth patterns, analytics instrumentation), ask: "Are there any other pages in the codebase where this same pattern exists?" before closing the work. A missed page is always worse than the cost of one grep.

**Save learnings to persistent memory during the session.** Context compacts on long sessions. Any correction or discovery that should hold for future sessions belongs in the memory system — not just in the current context window.

**Token/cost hygiene.** Specific prompts cost less than vague ones. File path + line number saves a full read. Batch related edits into one prompt. End sessions at clean boundaries (feature complete, deployed) rather than mid-task. Put everything that would need re-explaining into this file.

## Maintain the changelog

Every time a feature or fix is completed and deployed, add a new release entry to the top of `CHANGELOG.md` (below the `Unreleased / Known pending work` section). Keep entries short and business-facing — what changed and why it matters, not a line-by-line code diff. Format: `## Release N — YYYY-MM-DD — Title` with short bullets. Increment `N` from the previous release. If a feature is coded and pushed but not yet deployed (e.g. blocked on a credential), note it under `Unreleased / Known pending work` instead.

Also update `PROJECT.md` if the change affects architecture, the page list, or known limitations — it describes the current state, not history.
