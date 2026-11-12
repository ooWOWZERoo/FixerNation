# Shared demo environment: requirements

Status: **DECISIONS CONFIRMED 2026-11-12 (owner answered the four design questions and accepted the recommended answers for D1 to D7).** Nothing is built. Per the project rule, access and auth work is confirmed before any code.

Written because the owner wants a prospect (for example a district that shows interest) to try Fixer Nation as a district admin, school admin, teacher, parent and student **without a salesperson present**, using one published set of logins, and wants FNE staff to switch that demo on and off from the admin.

This is separate from the per-salesperson demo accounts in `docs/reference/sales-demo-accounts.md` (one named login per salesperson, no switch, no expiry). Both stay. The shared demo reuses that work's confinement (`lib/sales-demo.js`) and adds a switch, an expiry, an access code and a public page.

## 1. The experience

1. A district shows interest.
2. An FNE admin opens **Demo** in the admin (Sales group), turns the demo **on**, picks an **end date and time**, and copies the ready-made message (page address, access code, end date).
3. The district opens the unlisted demo page, enters the access code, and sees a welcome note, a table of logins (role, where to sign in, user ID, password or PIN), when the demo ends, and three prominent ways to reach FNE: **ask a question, submit a ticket, request a quote**. Those can be used at any time, including after sign-in.
4. On the end date, or when an admin switches it off, the demo stops working everywhere at once: the page disappears, the logins are refused and any open sessions end.

## 2. Decisions already made by the owner (2026-11-12)

| Question | Answer |
|---|---|
| Account shape | **One account per role**, all sharing one published password: `demo-district`, `demo-school`, `demo-teacher`, `demo-parent`, plus a `demo-student` PIN login. |
| Who sees the page and credentials | **Unlisted page plus an access code.** Not linked from the site, not in search, credentials appear only after the code is entered. |
| Switch scope | **One global switch and one end date.** Extending it extends it for everyone. |
| Content access | **View only, no downloads.** Lessons, videos and teacher copies can be viewed (PDF viewer) but not downloaded. |

## 3. What happens today (checked in the code, 2026-11-12)

| Fact | Where |
|---|---|
| Site sign-in takes an **email address**, not a free-form user name. A "user ID" must therefore be email-shaped. | `routes/site-auth.js` login (`WHERE email = ?`) |
| Account lockout is 8 failures per account and 30 per IP in 15 minutes. On a shared account, a stranger's wrong guesses lock everyone out until the window passes. | `routes/site-auth.js`, `lib/rate-limit.js` |
| Students sign in with a username and a 4 to 6 digit PIN. Five failures in 15 minutes lock the username (in memory). | `routes/classroom-auth.js`, `lib/pin-lockout.js` |
| Site sessions last 30 days, students 8 hours. A session stays valid after the account's access ends unless a check says otherwise. | `signSession(...)` calls |
| The per-salesperson demo flag `site_users.is_sales_demo` already confines an account to demo data: community denied, only the demo school and district visible, teacher invitations limited. | `lib/sales-demo.js`, `middleware/schoolAdminAuth.js`, `middleware/districtAdminAuth.js` |
| **Not confined today:** the district "+ Invite Admin", "Resend Welcome" and "Reset Password" actions and parent invitations send real email to any typed address. Fine for a trusted salesperson, **not fine for a password published to strangers** (it would turn FNE's mail server into a relay). | run sheet section 4, `docs/sales/FNE-Demo-Run-Sheet.md` |
| A licensed teacher can download lesson files (`forceDownload` in `curriculum.js`). Only parents are view-only today. | `routes/curriculum.js` |
| "Forgot password" and change-password work for any site account. For a shared password that would let a visitor lock everyone else out. | `routes/site-auth.js` |
| Settings live in the `settings` table (`getSetting`/`setSetting`); there is a feature-flag table, but it is per school and not a fit. | `lib/settings.js` |
| Support requests (Get help) and quote requests already exist as public forms. | `routes/support.js`, `routes/contact.js` |

## 4. Rules

### R1. The switch and the end date live on the server

- Settings: `public_demo_enabled` (`'true'`/`'false'`), `public_demo_ends_at` (UTC), `public_demo_access_code`, `public_demo_password`.
- The demo is **on** only when the flag is true **and** the end date is in the future. A flag left on past its date is **off**: the server never trusts the flag alone.
- An admin cannot turn the demo on without an end date. Maximum window: 30 days from the moment it is turned on (editable in the settings table, D3). Extending is a new choice of date, written to the audit log.
- Everything below checks the same function, `isPublicDemoOpen()` in a new `lib/public-demo.js`. There is no second copy of the rule.

### R2. When the demo is off, nothing about it is visible or usable

- `GET` for the demo page and for its API answer exactly as a page that does not exist (the site's normal 404). No "coming soon", no hint that a demo exists.
- The demo accounts **cannot sign in** even with the correct password (same generic "Invalid email or password" message, same timing).
- **Existing sessions end.** Every session check (`requireSiteAuth`, school admin, district admin, parent, and the student session) refuses a shared-demo account while the demo is not open. Hiding the page alone is not enough, because 30-day cookies would otherwise keep working. Demo sessions are also capped at 8 hours.
- The FNE admin account is never affected by this check.

### R3. The access code gates the credentials

- A short code (8 characters, no look-alike letters), generated when the demo is turned on and shown to the admin, who sends it to the district.
- `POST /api/demo/enter` with the code: rate limited per IP (`limiter()`), constant-time comparison, same answer for "wrong code" and "demo is off".
- A correct code sets a signed cookie through `lib/session-tokens.js` with its **own `aud` (new kind `demoGate`)**, lasting 8 hours or until the demo ends, whichever is first. Never call `jwt.sign` directly.
- `GET /api/demo/credentials` returns the logins **only** with a valid gate cookie. The page itself contains no credentials in its HTML.
- Regenerating the code in the admin ends every visitor's gate immediately (the cookie carries a code version).

### R4. The accounts

| Role | Sign-in page | User ID | Password |
|---|---|---|---|
| District admin | `district-admin-login.html` | `demo-district@public-demo.example.com` | the shared password |
| School admin | `school-admin-login.html` | `demo-school@public-demo.example.com` | the shared password |
| Teacher | login on any public page | `demo-teacher@public-demo.example.com` | the shared password |
| Parent | `parent-portal.html` | `demo-parent@public-demo.example.com` | the shared password |
| Student | `student-login.html` | `demo-student` | a shared 6-digit PIN |

- Each is a normal `site_users` row (the student a `classroom_students` row) flagged **`is_shared_demo = 1`** (new column; keep `is_sales_demo = 1` too so every existing confinement applies). Neither can reach any `admin-*.html` page.
- The address domain `public-demo.example.com` is under `example.com`, which can never receive mail and already passes the demo-invitation rule.
- **Shared password:** generated each time the demo is turned on, in the style `demo-` plus several unrelated words (at least 14 characters, so it also passes the new password policy), editable by the admin. It is shown on the gated page and in the admin; it is not secret by design, but it is only ever shown behind the code. The same style is used for the shared PIN (6 digits).
- **Own fixtures, separate from the salesperson demo:** "FNE Demo District", one demo school (`public-demo.example.com`), a demo purchase and a demo classroom with a few fake students and one lesson assigned. A salesperson changing their demo cannot disturb a prospect, and the reverse.
- The seed script is `server/scripts/seed-public-demo.js` (dry run by default, `--apply`, idempotent, same pattern as the salesperson script). It sets the password hashes from the current `public_demo_password`.

### R5. What a demo account can and cannot do (access matrix)

| Action | District | School | Teacher | Parent | Student |
|---|---|---|---|---|---|
| View lessons, videos, teacher copies in the viewer | yes | yes | yes | yes (their rules) | assigned lessons only |
| **Download** any lesson file | **no** | **no** | **no** | no | no |
| View demo school/district data, reports, standards views | yes | yes | yes | yes | n/a |
| Invite a teacher, parent or admin, resend a welcome, **send any email** | **no, shows "This is a demo, so no email was sent."** | **same** | **same** | **same** | n/a |
| Change or reset the account password, change the account email, close the account | **no** | **no** | **no** | **no** | **no** (PIN change by a teacher is also refused for `demo-student`) |
| Community (other teachers) | no | no | no | no | no |
| Upload a file (logo, attachment) | no | no | no | no | no |
| Change branding colors | yes, reset nightly | yes, reset nightly | n/a | n/a | n/a |
| Create classrooms, add fake students, assign lessons and games, write reflections or goals | n/a | n/a | yes, reset nightly | n/a | yes, reset nightly |
| Submit a support request or quote request | yes | yes | yes | yes | n/a (no form in the student view) |

Rules behind the table:

- The "no email" rule is enforced **once, in the mailer** (`lib/mailer.js`), not route by route. While a request runs as a demo session, every email is held back unless the caller marks it `demoAllowed` (a public form's notice to staff: quote and contact forms, new support requests) **and** every recipient is an FNE staff address (the `contact_email_*` settings). Safety alerts, order and quote alerts, invitations, reset emails and the submitter's own confirmation copy are all held back. A test fails if any file other than `lib/mailer.js` creates a transport or calls `sendMail` (the Morning Boost broadcast, started only by an admin route or the cron script, is the one named exception). When mail is held back the JSON answer carries `demoNotice` ("This is a demo, so no email was sent.") and the header `X-Demo-Email-Suppressed: 1`; showing that note on screen is built with the pages in a later phase.
- An FNE admin testing the demo in their own browser holds the admin cookie as well; the gate leaves such requests unrestricted so their own invoice and support emails still go out. A visitor can never hold a valid admin cookie. (Test the demo in a private window to see exactly what a visitor sees.)
- "No download" is the server's `forceDownload` check treating a shared-demo account like a parent: view allowed, `?download=1` refused with a plain message.
- Free text a visitor types still goes through the **content safety** filters. Demo-student text is blocked as usual, but **staff alert emails for demo accounts are suppressed** and logged instead (D5), so a visitor cannot make FNE staff think a child is at risk.
- Visitors **share the data**: what one person adds, the next person sees until the nightly reset (R7). The demo page says so.

### R6. Lockouts on shared accounts

The 8-failure and 5-failure lockouts **stay** (do not loosen them). Because strangers can now lock a shared login:

- A lockout of a demo account **self-clears** after the normal 15 minutes.
- The admin Demo page shows a count of recent failed sign-ins on the demo accounts and has an **"Unlock demo accounts"** button (clears the in-memory trackers for the five logins; audited).
- Account Lookup shows these accounts as "shared demo".

### R7. Reset

- `server/scripts/reset-public-demo.js` runs nightly by cPanel cron (about 3 a.m.) **while the demo is open**, and the admin can press **"Reset demo data now"**. It puts the demo district, school, classroom and students back to the seeded state: removes added students and classrooms, student answers, reflections, goals, game completions, branding changes and anything else created under the demo accounts.
- It also runs once when the demo is turned on, so each window starts clean.
- Dry run by default; it touches only rows belonging to the demo district, school, classroom and accounts. It is written the same way as the salesperson seed (idempotent, runs against the real schema).

### R8. Questions, tickets and quotes (tagged, not hidden)

- The page and, once signed in, the demo-account nav show three buttons: **Ask a question / submit a ticket** (the existing Get help page) and **Request a quote** (the existing quote form), plus the sales contact line.
- **Tickets need a real contact address (found in phase 2, built in phase 4).** The demo logins have no real email, and today a signed-in demo account is refused when it sends a support request (`routes/support.js`). The demo page's "ask a question / submit a ticket" button therefore uses the signed-out form, which asks for a name and an email, and a demo session must be allowed to use that form (it is today only when no one is signed in). The quote request form already asks for contact details.
- Requests submitted by someone holding a valid demo gate cookie are **tagged "demo"** by the server (the tag comes from the cookie, never from a field the visitor can send), so staff see in the Support Inbox and the quote list which ones came from the demo.
- The demo page tells people they can ask at any time and that the demo ends on a stated date; those two things appear above the credentials.

### R9. Accounting and reporting stay clean

- Demo accounts and their activity are excluded from usage analytics, the Morning Boost recipient group, CRM counts and revenue (the same flags already used for the salesperson demo). The demo purchase is a $0, inactive product tagged `source = 'Sales Demo'`.
- Admin Demo page shows, for the current window: number of gate entries, sign-ins by role, tickets and quote requests tagged demo.

### R10. Rules that must not erode

- The demo is **off by default** and after any deploy; a new database starts with the flag false.
- The page is `noindex`, left out of the sitemap, the nav and `robots` hints; **the page never appears in Google or any internal link.**
- No third-party fonts or scripts on the page (`fonts.css` only).
- Admin and site-user auth stay separate; the demo gate cookie has its own `aud` and cannot stand in for either.
- The demo accounts are excluded from the new password and MFA rules (they have no email, no forced rotation, no MFA) but the shared password still meets the length rule.
- Never commit a real demo password or code; the repo is public. The seed script reads them from the settings table, and the doc examples are placeholders.

## 5. The admin page

**Demo** in the Sales group (`admin-demo.html`, uses `requireAuth`):

- Status line: Off / **On until `<date, time zone>`** (red when under 24 hours), or "Expired".
- Turn on / off, end date and time picker (default 14 days, max 30), **Extend**.
- Access code with **Regenerate** (ends all current visits).
- Shared password and PIN with **Regenerate**; applying a new password re-hashes the five accounts.
- The page address and a **"Copy message for the district"** button (page address, code, end date, a reminder that they can ask questions or request a quote any time).
- Counts for the window (R9), **Reset demo data now**, **Unlock demo accounts**.
- Every change is written to the audit log (who, when, old and new end date).

## 6. The public demo page

`demo.html` (an unlisted address; final path in D2), before the code is entered: a plain page with one box and nothing else. After the code:

1. A welcome note (short, warm, says what this is and that nothing real is in it).
2. The end date, in the time zone chosen in D1.
3. The logins table (R4), with a sign-in link per role and a one-line "what you will see" for each.
4. A short "how to explore" order (teacher, then student, then parent, then school, then district).
5. A note that everything here is example data, others may be using it at the same time, and that it is reset every night.
6. The three buttons from R8, repeated at the bottom.

All wording is run through the humanize skill when it is written. The page loads `error-capture.js`.

## 7. Phases

1. **Foundation (server only, no page). BUILT 2026-11-12, not yet deployed.** `scripts/alter-add-shared-demo-flag.js` (`site_users.is_shared_demo`), `lib/public-demo.js` (`isPublicDemoOpen`, the window rule, the gate mounted in `app.js`), settings keys (off by default), token kind `demoGate` (signing exists; the code-entry route comes in phase 4), refusal of demo sign-in, join codes and sessions while closed (demo sessions are 8 hours and carry a signed `demo` claim), view-only downloads, no password, PIN or profile change and no reset link for a demo account, the transport-level email guard, no uploads. Community was already refused by `is_sales_demo`. Tests: `test/shared-demo.test.js` and `test/shared-demo-routes.test.js`. Deploy: run the alter script, then restart the Node app; nothing is switched on (the demo accounts do not exist until phase 2).
2. **Seed, reset and switch scripts. BUILT and DEPLOYED 2026-11-12 (seeded in production).** `scripts/seed-public-demo.js` (dry run by default; `--apply`; `--password`, `--pin`; stores the shared password and PIN in settings `public_demo_password` and `public_demo_pin`; never turns the demo on), `scripts/reset-public-demo.js` (dry run by default; `--apply`; `--force`; skips while the demo is closed), `scripts/set-public-demo.js` (`--status`, `--on --days N` or `--until <date, time and zone>`, `--off`, `--no-reset`; an end time is always required and capped at `public_demo_max_days`, 30 by default; it is also the emergency off switch that works when the website is down), and the nightly cron line `10 3 * * *` in `setup-cron-jobs.sh`. Shared constants: `lib/public-demo-fixtures.js`; the open/closed rule moved to `lib/public-demo-window.js` so the scripts and the server run the same code. Three gaps in the earlier requirements were found and fixed here: (a) the existing demo confinement was tied to the salesperson demo's own district and school, so the shared demo's separate fixtures would have been locked out; it now knows both (`isDemoDistrictName`, `isDemoSchoolDomain`, `demoKindOf*` in `lib/sales-demo.js`), keeps each district to its own school, and keeps both out of the public standards pages; (b) an invitation in a demo session still writes the invitee's address, so a demo session may now only name an example.com address (teacher, parent and administrator invitations), and resending a welcome or sending a password reset is refused; (c) the nightly reset also removes the fake example.com accounts an invitation created, but only when nothing else points at them.
3. **Admin Demo page. BUILT 2026-11-12, not yet deployed.** `admin-demo.html` (Sales group, between License Products and Support; `admin-nav.js` v32, `admin-shell.js` v5) over `routes/admin-public-demo.js` (`/api/admin/public-demo`, every route behind `requireAuth` once, via `router.use`): status and end date, turn on (days or a date and time) and change the end date, turn off, set up the demo (runs the seed, so no Terminal is needed), access code with a new-code button (the code and its version are settings `public_demo_access_code` and `public_demo_code_version`; the version goes up each time so phase 4's gate cookie dies with the old code), shared password and PIN with show, copy and new buttons (each new one re-hashes the logins and signs everyone out), join code, a table of the five logins with a "locked for N min" marker, Reset now, Unlock (clears the per-account lockouts through `siteLoginBlockedFor` / `unlockSiteLogin` in `routes/site-auth.js` and `clearLock`), and a "what visitors can and can't do" list. Every change is written to the audit log (`public_demo.*`, actor, time, old and new end date) and never contains the password, PIN or code. Turning on from closed resets the demo first; changing the end date of an open demo does not. `set-public-demo.js` now also makes sure an access code exists. **Held back until phase 4:** "Copy message for the district" (it needs the demo page to exist: `PUBLIC_DEMO_PAGE_READY` in `lib/public-demo-fixtures.js` flips to true then), and the visit, ticket and quote counts. Copy was run through the humanize skill.
4. **Public demo page**, the access-code flow, ticket and quote tagging, analytics exclusion.
5. **Wrap-up:** PROJECT.md and CHANGELOG, video check on every commit (the demo does not change a recorded flow, but run `videos-to-review.js`), a how-to note for staff, and a decision on a customer release note (D6).

Each phase is its own release. Phase 1 must be live and tested before any demo password exists in production.

## 8. Risks and what we accept

- **Shared data:** visitors see each other's edits until the nightly reset. Accepted; told on the page.
- **Lockout by a stranger:** possible by design of the lockout rule; mitigated by self-clearing and the Unlock button (R6).
- **The code can be forwarded.** Accepted: it is a speed bump, not a lock. The real limits are the end date, view-only content, no email and the nightly reset. Regenerate the code to cut everyone off.
- **View-only is not copy-proof.** A viewer can still screenshot; this stops file downloads, not screen capture.

## 9. Decisions (all accepted as recommended, 2026-11-12)

| # | Question | Decision |
|---|---|---|
| D1 | Which time zone is the end date shown and entered in? | US Eastern, shown with the zone name on the page. |
| D2 | Page address and name. | Accepted as `/demo-welcome.html`. Found in phase 3: the repository is public, so a page name can never be a secret. The protection is the access code and the switch; the page is also `noindex`, unlinked and left out of the sitemap. |
| D3 | Longest window an admin can set. | 30 days (default 14). |
| D4 | Visitors may change school and district branding colors (reset nightly) but not upload logos. | Yes. |
| D5 | Safety alerts from `demo-student` writing: block as usual but do not email staff. | Yes. |
| D6 | Is a customer release note needed? | No: the page is for prospects, not customers, and is off by default. A staff how-to is enough. |
| D7 | Separate demo district and school from the salesperson demo. | Yes (R4). |

## 10. Out of scope

Per-prospect codes and per-prospect end dates (the owner chose one global switch), a self-serve "start a trial" button, demo accounts for affiliates, a demo for the FNE admin side, and any real student data.
