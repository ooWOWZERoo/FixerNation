# Working in this repo

Fixer Nation Education (fixernationeducation.com) — Node/Express + MariaDB, deployed on Hosting.com/cPanel. See `PROJECT.md` for architecture/feature overview and `CHANGELOG.md` for release history.

## Maintain the changelog

**Every time a feature or fix is completed and deployed, add a new release entry to the top of `CHANGELOG.md`** (right below the `Unreleased / Known pending work` section). Keep entries short and business-facing — what changed and why it matters to whoever runs the site, not a line-by-line diff of the code. Match the existing format: a dated `## Release N — YYYY-MM-DD — Title` heading with a short bullet list. Increment `N` from the previous release. If a feature is coded and pushed but intentionally not deployed yet (e.g. blocked on a third-party credential), note it under `Unreleased / Known pending work` instead of as a numbered release.

Also update `PROJECT.md` if the change affects architecture, the page list, or known limitations — it should always describe the *current* state, not history (history belongs in `CHANGELOG.md`).

## Deploy workflow

This is a git-based deploy: commit → push to GitHub (`github.com/ooWOWZERoo/FixerNation` — **public repo, never commit real PII or secrets**) → the user runs the following in cPanel's browser Terminal (no SSH access exists into this environment):

1. `git pull` in the git clone (`~/repositories/fixernation`)
2. `rsync` the static files into `~/public_html`:
   ```
   rsync -av --delete --delete-excluded \
     --exclude='.git' \
     --exclude='.gitignore' \
     --exclude='*.md' \
     --exclude='server' \
     --exclude='api' \
     --exclude='uploads' \
     ~/repositories/fixernation/ ~/public_html/
   ```
   `api` is cPanel-generated proxy glue (not in git) and `uploads` holds real uploaded files (not in git) — excluding either wrong will silently break the live API or destroy uploaded content. `*.md` covers all repo documentation (`PROJECT.md`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`, and any future doc file) — none of it is meant to be served publicly. **`--delete-excluded` is required, not optional** — plain `--exclude` + `--delete` only stops *new* copies of excluded files; it actively *protects* any excluded file already present in `public_html` from being removed. Without `--delete-excluded`, a doc file that was ever synced before an exclude rule existed for it stays live forever. (This bit us once already — `CLAUDE.md`/`CHANGELOG.md` sat publicly exposed on production, serving internal deploy/infra details including the cPanel hostname and username, until this flag was added.)
3. `npm install` (after `source`-ing the app's nodevenv) if `server/package.json` changed
4. **Restart the Node app** if any `server/` code changed — Node does not hot-reload; a `git pull` alone leaves old code running in memory even though the files on disk are current (symptom: new routes 404 with Express's own "Cannot GET/POST" page, not a crash)
5. For a schema change to an **existing** table: `server/scripts/migrate.js` only ever runs `CREATE TABLE IF NOT EXISTS`, so it silently no-ops on altered tables. Write a one-off idempotent script (see `server/scripts/alter-*.js` for the pattern — check `information_schema.COLUMNS`/`TABLES` before altering) and have the user run it via `node scripts/whatever.js` in cPanel Terminal, in addition to updating `schema.sql` (which stays the source of truth for fresh installs only).

No local dev environment exists for this project — there's no local MySQL/MariaDB, and the sandbox blocks direct outbound connections to the remote DB. All verification happens by deploying to production and checking with `curl` + a cookie jar (no browser automation available either). Always use clearly-named test data (e.g. `@example.com` emails, obviously-fake school domains) and clean it up after verifying.

## Infra gotchas (all previously bitten in this project)

- **`dotenv.config()` needs an explicit path.** Under this host's Passenger/LiteSpeed Node integration, `process.cwd()` isn't the app root — `require('dotenv').config()` with no path silently loads nothing.
- **Don't use `cookie-session` or any library relying on Express's deferred `on-headers` write hook** — it silently fails to attach `Set-Cookie` on this host. Sign a JWT and attach it via a direct `res.cookie()` call in the route handler itself.
- **The reverse proxy rejects POST/PUT/DELETE with no body/Content-Type** — returns a bare 400 before Express ever sees it. Every mutating `fetch()` must send `headers: {'Content-Type': 'application/json'}` and a body (`'{}'` if nothing to send), even for actions like logout.
- **Shared `admin-common.js`/`admin-common.css` are cache-busted as `?v=N`** — bump `N` in every HTML file that references either one, any time either file changes (grep for `admin-common.js?v=` to find them all). `site-auth.js` is not yet under this scheme — watch for staleness if it's edited.
- **A route file with a bare `GET /:id` must be declared after any more-specific `GET /literal-path` route**, or Express will treat the literal path as an `:id` value (e.g. `campaigns.js`'s public `GET /track-open` pixel endpoint is declared before any `/:id` route).
- **Watch for circular `require()`s** between route files that both need something from each other (e.g. `newsletter.js` and `site-auth.js` both touch purchases/tokens) — extract the shared function into `server/lib/` instead of having either route file require the other.
- Don't let a new commit's code assume an *intentionally undeployed* prior commit's schema/dependency is already live — `git pull` always catches the server up to `HEAD`, so if two commits land together, code written against commit B's schema will break commit A's undeployed feature too if B ships first.
