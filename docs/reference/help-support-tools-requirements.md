# Help and support tools: requirements (DRAFT, nothing built)

Status: drafted 2026-11-24 from the backlog section "Later, if it proves useful" in `docs/BACKLOG.md`. Three separate features, each with its own access matrix. They share nothing but the Support sidebar group, so they can be built and deployed one at a time. **No code until the owner confirms the decisions in section 5.** Follows `support-requests-requirements.md`, `support-console-requirements.md`, `error-capture-requirements.md` and `help-center-requirements.md`.

Build order recommended: A (editor), then B (alerts), then C (view as). C changes what staff can see about other people's accounts, so it goes last and gets its own confirmation pass after A and B are live.

---

## A. In-browser editor for Help center answers

### Today
Answers live in `help-center.js` (about 200 entries, `E(...)` published, `D(...)` draft). Changing one means editing the file, a commit, a push and a deploy. The file is read only by the browser (`help.html`, `support.html`, `admin-support-help.html`) and by tests; the server never reads it. The anonymous `faq_open` analytics event records an entry's `id`, so ids must never change.

### Goal
A staff member edits, adds, publishes, un-publishes and reorders answers in the browser (Support > Help Content) with no release.

### What staff can do
| Action | Detail |
|---|---|
| Edit | question, answer, audiences (`for`), topic, Get help topic (`help`), video id, optional steps |
| Add | a new answer; the id is made from the question once and then locked |
| Publish / un-publish | a published answer shows to visitors; a draft shows only at `help.html?preview=1` |
| Delete | a **soft delete** (hidden, restorable for 30 days); never removes an id that has `faq_open` history from the counts |
| See what changed | each save keeps the earlier version (who, when); one click restores it |
| Preview | the exact public card, before saving |

Not in scope: rich text (answers stay plain text with the existing steps list), uploading images, translating.

### How it works (outline)
- New table `help_answers`: `id` (the stable slug, primary key, never editable), `audiences`, `topic`, `help_topic`, `video`, `question`, `answer`, `steps` (JSON), `status` (`draft`/`published`/`deleted`), `sort_order`, `updated_by`, `updated_at`; plus `help_answer_versions` (one row per save). Alter script plus `schema.sql`.
- `help-center.js` stays as the **seed and the fallback**: a one-time script (`import-help-answers.js`, dry run by default, never overwrites a row staff already edited) copies the file's entries into the table. The public pages read `GET /api/help-center` (published rows only, cached 60 seconds, no login) and fall back to the bundled file if the call fails, so a database problem never blanks the Help center.
- Staff routes under `/api/admin/help-answers`, all `requireAuth` (admin `fn_session`). Visitors can never reach draft rows; the public route filters `status = 'published'` in SQL and never returns the version history or `updated_by`.
- Text is saved as plain text and escaped by the existing renderers. A save refuses HTML tags in the question or answer (the pages already render these as text; the editor says so rather than silently stripping).
- Guards kept: the "never put a number an owner can change into an answer" rule is shown as a hint in the editor; privacy, pricing, legal and research wording is flagged "needs your read" (the same list that starts as drafts today), and a save of one of those starts as a draft, matching the current rule that such answers begin as drafts.

### Access matrix
| Actor | Read published | Read drafts | Edit / publish / delete |
|---|---|---|---|
| Anyone | Yes (public API) | No (preview flag only works for a signed-in admin; see decision A3) | No |
| FNE admin (`fn_session`), any CRM role | Yes | Yes | Yes (admin accounts have no roles for the Help center; see decision A2) |
| Teacher, school/district admin, parent, student | Yes (same as anyone) | No | No |

### Open point worth knowing
Today `help.html?preview=1` shows drafts to **anyone who adds the flag**, because the file is static. With the table, drafts come only from an admin route, so the preview link works only while signed in as admin. That closes a small existing leak (drafts about privacy and legal wording are readable by anyone who guesses the flag).

---

## B. Alerts for error spikes

### Today
Errors are captured (Release 122) and staff read them on the Errors page. Nothing tells staff when something breaks; the nav shows a count for the last 24 hours only.

### Goal
Staff hear about a real spike without having to open the page, and are not spammed by the usual browser-extension noise.

### What counts as a spike (all values are admin settings, shown as plain numbers)
| Rule | Default |
|---|---|
| The same error group reaches **N reports from M different browsers** inside one hour | 10 reports from 3 browsers |
| Any `server_error` (a route crashed) | 3 in one hour |
| Any `email_failed` | 1 (rare and important: password resets stop working) |
| Quiet period after an alert for the same group | 6 hours |
| Daily cap on alert messages | 5 |

Extension noise is already de-grouped by message, path and kind; a group seen in only one browser never alerts.

### Channels
- **Email** to a list of staff addresses (a setting), sent through `lib/mailer.js` (a test already fails if any other file sends mail). Each message names the kind, the page or API path, how many reports and browsers, the first and last time, and a link to the Errors page. It never contains a student identifier, a full email address or a token, because the stored rows never do.
- **Text message:** there is no text provider in the project, and carrier email-to-text addresses are unreliable now. A real text needs an outside service (Twilio is the usual one): a paid account, a sending number (US carriers require registration of the number, which takes days to weeks), and the owner's phone number sent to that service. **Recommended: build email now; add text only if email proves too slow, as a separate step that needs the owner to decide on the provider.**
- **Important weakness:** if the thing that broke is email, an email alert will not arrive. Mitigation: an `email_failed` alert is also shown as a red banner on the admin Mission Control page and the Support menu count, so it does not depend on mail.

### How it works (outline)
- A cron script `scripts/alert-error-spikes.js` runs every 10 minutes (the existing pattern: loads `.env`, its own pool, idempotent, dry run with `--dry-run`). It reads `client_errors`, applies the rules, writes a row to a small `error_alerts` table (group key, sent at, channel) so it can honour the quiet period and the daily cap, and sends through `mailer.js`. It is **off until a setting `error_alerts_enabled` is `true`** and a recipient list exists.
- Settings card in Settings (or on the Errors page): on/off, recipients, the thresholds above, a "send me a test alert" button.
- No new data is collected; the 30-day retention and the "never stored" list in `error-capture-requirements.md` are unchanged.

### Access matrix
| Actor | See or change alert settings | Receive alerts | Test button |
|---|---|---|---|
| FNE admin | Yes | Only if listed as a recipient | Yes |
| Everyone else | No | No | No |
Recipients may be any address the admin types (a staff member's own email, a shared mailbox); the list is not shown anywhere public.

---

## C. Read-only "view as" for staff

Status: **design for confirmation, nothing built.** The owner chose the real read-only session on 2026-11-24. Checking the code turned up four things that shape it, listed first because each one changes what "view as" can safely be.

### What the code check found

1. **A browser has one cookie jar for all tabs.** A normal "sign in as that person" cookie would also hit staff's other admin tabs and break or confuse them. So the view-as identity is **not a cookie**. It is a signed token kept in that one tab's `sessionStorage`, sent as an `X-View-As` header by a small script (`view-as.js`) that wraps `fetch` on public and portal pages. Other tabs have no token, so they are untouched. The token only works while staff's own `fn_session` is still valid and is the same admin.
2. **A teacher's screens hold student names and writing.** The public Help text says reflections are for the assigning teacher only, and the privacy pages say what staff see. A full copy of a teacher's screens would show FNE staff student names, reflections, quiz answers and goals, which contradicts those promises and the retention and privacy rules in `CLAUDE.md` (the idle-lock rule exists because of this). So view-as is **allowlist only**: a view-as session may call only GET routes on an explicit, reviewed list; every other route answers 403 "not available in view-as". A new route added later is therefore **closed by default**. Student rosters, student progress, reflections, quiz answers, goals, Brain Games results, parent links and student PINs are never on the list.
3. **281 GET routes exist, and 18 have something that looks like a write** (for example marking a support reply as seen, marking social messages read, logging a file download, tracking pixels, token links). A deny-list would have to catch each of these forever; the allowlist avoids it, and a test fails if an allowlisted route can write.
4. **Every identity check goes through a few resolvers** (`getSiteUser`, the school and district admin guards, `getAuthUser`). The viewer therefore works by presenting the **target's** identity to those same resolvers for one request, so every existing scope check (a district admin sees only their district, and so on) applies exactly as it does for that person: staff can never see more than the person can.

### Goal
When someone writes in with "my page looks wrong" or "I can't find the button", a staff member sees what that person sees (menus, buttons, license and seat state, assignments, school and district pages), without asking for a screenshot and without being able to change anything or read student data.

### How it works (outline)
- **Start:** a **View as** button on the person in Account Lookup (and on a support request whose requester has an account). Staff type a short reason (5 to 200 characters, required). `POST /api/admin/view-as/start` creates a `view_as_sessions` row and returns a signed token (new session kind `viewAs`, signed only through `lib/session-tokens.js`, 20 minutes). The admin page opens `view-as-start.html#<token>` in a new tab; that page stores the token in the new tab's `sessionStorage`, clears the address fragment (a fragment is never sent to the server) and goes to the person's usual home page.
- **Every request in that tab** carries `X-View-As`. A middleware that runs before all routes checks, in order: the token is valid and not expired; its `view_as_sessions` row is not ended; the request also carries a valid `fn_session` for the **same** admin who started it, and that admin still exists; the target still exists, is not closed, and is still an allowed kind. Any failure answers 401 and the tab shows "This view has ended". If all pass: the request must be GET or HEAD (anything else is 403, `Content-Type: application/json`), the path must match the allowlist (else 403), the admin and student cookies are removed from that request so the route sees only the person, the person's identity is supplied, and `Set-Cookie` is suppressed (a view can never write a cookie into staff's browser).
- **Banner:** `view-as.js` shows a fixed bar on every page in that tab: "Viewing as <first name, role> (read only). Ends in mm:ss. Stop." Stop calls `POST /api/view-as/end` (the one write exempt from the read-only rule, and it only ends the caller's own session) and closes the tab.
- **Ends** when: the 20 minutes pass; staff press Stop; the admin signs out or the admin session is invalidated; the person's account is closed or their password is reset; the admin starts another view (one at a time).
- **Never in a view:** downloads, uploads, email, payments, and file or video streams (they do not carry the header, so they fail closed as the staff member's own identity, which has no site access). A viewed page may show "could not load" in places; that is by design and the banner says so.
- **Records:** `view_as_sessions` (admin id, target id, reason, started, ended, ended_by: stop, expired, signed out) kept 2 years, and `school_audit_log` rows by id for start and end (`view_as_started`, `view_as_ended`; never the reason text in the audit log, the reason lives in the session row). Account Lookup shows the person's recent views (who, when, reason) so staff see the history.

### Who may be viewed (decision C2)
| Account | Viewable? | Reason |
|---|---|---|
| Teacher (including trial) | Yes | Menus, license and seat, lesson library and plans, classrooms as names and counts only |
| School administrator | Yes | Teacher list, licenses, invitations, branding; no student data |
| District administrator | Yes | Schools, licenses, standards, program-use report (school-level counts) |
| Parent | **Not in v1** | Their screens are the child's progress and name; with student data off the list there is almost nothing left to show. Can be added later by its own requirements |
| Student (PIN login) | **Never** | Children's accounts; separate table; staff keep the Classroom lookup and PIN tools |
| Another FNE admin, any `is_fne_staff` account | No | Never an identity that carries staff access |
| Sales-demo and shared-demo logins | No | Fixtures, not customers |
| Closed account (`closed_at`) | No | Refused at every session check |
| The staff member's own account | No | Pointless and confusing |

### Allowlist (what a view may read)
Written from the real route files at build time, reviewed line by line, and kept in one file (`lib/view-as-routes.js`) with a test that: every entry is a GET; none matches a student-data pattern (`students`, `reflections`, `answers`, `goals`, `progress`, `brain-games`, `parent`, `pin`, `portrait`, `evidence` at student level); every entry's handler has no INSERT, UPDATE, DELETE or helper that writes; and a route not on the list answers 403. Expected size: about 20 to 30 routes (account and role summary, license and seat, lesson library and plans, classroom list without students, school and district administration screens, standards pages, help).

### Access matrix
| Actor | Start a view | Use a view token | See the view history | End a view |
|---|---|---|---|---|
| FNE admin with the CRM role chosen in C3, with a typed reason | Yes, for the accounts above | Only together with their own valid `fn_session` and only for the person they started | Yes (Account Lookup) | Yes |
| Other admin accounts | No (C3) | No | Read only, if C3 is "any admin" | No |
| The viewed person | Not told on screen; see C4 | No | No | No |
| Anyone else, or a token with a different admin's cookie, or an expired, ended or forged token | No | No (401) | No | No |

### Controls summary
Read-only in middleware (not a banner); allowlist, closed by default; target identity only (admin and student cookies removed for that request); no cookies written; short and single; reason required; start and end audited; bound to the starting admin's live session; no student data; cannot be used on staff, demo, closed, student or parent accounts.

### Tests the build must include
Non-GET refused with the exact JSON; unlisted GET refused; listed GET answered as the target and not as the admin; a token with another admin's cookie, no cookie, an expired, ended or forged token (wrong `aud`, the site-session `aud`, the admin `aud`) all refused; target closed, staff, demo, parent, student or self refused at start; `Set-Cookie` never present; the start route needs the role in C3 (404 or 403 for others); one at a time; ends on admin session invalidation and on target password reset; no allowlisted handler writes (static scan); no student-data pattern on the list; audit rows hold ids, not reason text; the header is ignored on routes that never opted in (admin namespace answers 401 for a view tab).

### Limits (be aware)
It shows what the person's pages show with the student data left out, so a bug that only appears in a student-data panel cannot be seen this way (use the Classroom lookup and the Errors page). Pages that stream files, videos or PDFs will not load in a view. The header approach needs the three nav scripts (public, school-admin, district-admin) and `site-auth.js` pages to load `view-as.js`; a page that loads none of them cannot be viewed.

---

## 5. Decisions for the owner

A1. **Editor storage:** table with the file as seed and fallback (recommended), or keep the file and add only a "suggest a change" form.
A2. **Who may edit:** any admin account (recommended, matches "admin accounts have no roles"), or only a CRM Admin.
A3. **Draft preview:** make `?preview=1` require an admin sign-in (recommended; closes a small leak) or keep it open.
A4. **Delete:** soft delete restorable for 30 days (recommended).
B1. **Alerts channel:** email now, text later and only if needed (recommended), or set up a text provider at the same time.
B2. **Recipients:** which addresses (the owner's, plus any other staff).
B3. **Thresholds:** accept the defaults in section B, or change them.
B4. **The red in-app banner for failed email** (recommended: yes).
C1. **View as:** the real read-only session (confirmed 2026-11-24).
C2. **Which accounts:** teachers, school administrators and district administrators; parents not in v1; students never (recommended).
C3. **Who may start it:** CRM Admin only, as a new action `view_as` (recommended; works with the Hub off, like `manage_purchases`), or any admin account.
C4. **Telling people:** a line in the Privacy Policy and the Student Data Privacy page saying support staff may view a read-only copy of an adult's screens, without student data, to help them, and that it is logged (recommended; wording flagged for lawyer review), or that line plus an email to the person after each view, or nothing.
C5. **Student data:** none at all, allowlist only (recommended), or student names behind the idle lock (needs the privacy and legal review first, and breaks the public "reflections are for the assigning teacher only" promise unless reflections stay off).

### Answers recorded 2026-11-24

- **Order:** A, then B, then C (confirmed).
- **A1, A2, A3 confirmed as recommended:** table with the file as seed and fallback; any admin account may edit; `?preview=1` needs an admin sign-in. **A4 (soft delete, 30 days) not yet answered; building as recommended.**
- **B1 confirmed:** email now, text later only if needed. B2 (recipient addresses) is needed only when alerts are switched on, not to build; B3 and B4 build as recommended unless the owner changes them.
- **C1 to C5 answered 2026-11-24 (the full design is section C above):** real read-only session (C1); teachers, school administrators and district administrators, no parents in v1, never students (C2); **student data none, allowlist only (C5, as recommended)**; a privacy line flagged for lawyer review (C4, no email to the person); **C3: "CRM Admins and Super Admins". The code has no Super Admin role** (admin accounts have no roles; the CRM roles are Admin, Sales and Read-only, and every existing admin account is a CRM Admin today). Built as the CRM Admin role through one new action, `view_as`, in `lib/crm-permissions.js`; if a narrower or separate tier is wanted, that is one line in that matrix. **Confirmed 2026-11-24: the CRM Admin role, through the new `view_as` action. All of C1 to C5 are now answered; C is ready to build.**

### As built, phase A (2026-11-24)

- **Overlay, not a one-time import.** A row in `help_answers` overrides the file's answer with the same id, or adds a new one; an empty table changes nothing, and a failed fetch leaves the file's answers showing. This replaced the "import everything" idea: nothing to copy, nothing to get out of step. "Revert to the original" deletes the row.
- Public `GET /api/help-center` (cached 60 seconds, so a saved change reaches visitors within a minute) sends published text plus the ids of drafts and deleted answers to hide; never text, author or dates for those.
- **A3 corrected:** the two drafts that are still written in `help-center.js` (`who-reads-student-writing`, `ferpa-requests`) are readable by anyone who opens that file. Only drafts created in the editor are private. To make those two private, open each in the editor, save it, and delete the line from the file in a later release.
- **A4 changed:** deleted answers stay in the Deleted filter and can be restored any time (no 30-day expiry), because expiring a deleted file answer would bring it back.
- Sensitive wording (price, refund, privacy, legal, research) is flagged with a warning on save while published; it is not blocked.

### As built, phase B (2026-11-24)

- `lib/error-alerts.js` (rules, settings checks, the run), `scripts/alert-error-spikes.js` (cron every 10 minutes; `--status`; report only without `--apply`), `routes/admin-error-alerts.js` (GET and PUT settings, POST test, once a minute), table `error_alerts` (`alter-create-error-alerts.js`), `sendErrorAlertEmail` in `lib/mailer.js`, the card on `admin-support-errors.html`, the red banner on `admin-dashboard.html`.
- Settings are `error_alerts_enabled`, `_recipients`, `_browser_reports` (10), `_browsers` (3), `_server_errors` (3), `_quiet_hours` (6), `_daily_cap` (5); an unset or invalid value falls back to the default. A page error needs both the report count and the browser count; the count is the occurrences of rows seen in the last hour, so it can include a row's earlier reports (a small over-count, never an under-count).
- One email per run names up to 10 groups ("and N more" for the rest) and counts once against the daily cap. A failed send is recorded as `failed`, counts toward nothing and is retried on the next run. A failed alert email's own `email_failed` row (its subject starts "Error alert") is skipped, so a broken mail server cannot cause alerts about alerts.
- B4 changed: the red banner is on Mission Control only; the Support menu count already existed and was left alone.
- Found while checking against a real database: compare times as `Date` objects (the driver writes them in the server's timezone, like `CURRENT_TIMESTAMP`), never as UTC text. A first version used UTC text and the once-a-minute test limit did not hold.

### As built, phase C (2026-11-24)

- As designed in section C, with these details. The list is `lib/view-as-routes.js` (about 45 GET routes); a test reads every listed handler and fails if it contains INSERT, UPDATE or DELETE, and fails if a path looks like student data or a download. `/school-admin/invitations` is left off (it expires old rows as it is read) and so is `/curricula/:id` (it records usage against a license). A request in a view that is not on the list answers **403 "That screen is not available in a staff view"**, including every staff `/api/admin/*` route (the doc's earlier "answers 401" for those is superseded).
- A view tab sees only what the person sees: for a teacher, the classroom list shows name, grade and counts, with the join code removed; the classroom page itself answers 403 so its roster never loads.
- The gate reads the session row, the admin, the CRM role and the person on every request (four small queries); acceptable at one staff member and 20 minutes.
- "Cannot view your own account" is checked by comparing the staff member's email with the account's email; staff accounts are refused through `is_fne_staff`.
- Not done, by design: parents, students, downloads, file and video streams (they do not carry the header), and any screen that shows student data.
- The privacy sentence is on `privacy-policy.html` (section 7) and `student-data-privacy.html` (section 8), flagged in `docs/BACKLOG.md` for lawyer review; no customer release note yet (add a draft once the lawyer has read the wording).

## 6. Phases (after the answers)

A1 table, alter script, import script, public API with fallback. A2 editor screen, history and restore. A3 draft-preview change, release note (staff-only, so likely none), video check on the Help Content video if one exists. B1 spike rules, cron script, settings card, test button. B2 in-app banner for failed email. C (after its own confirmation): the chosen option, its tests (GET-only enforcement, audit rows, no student, one target, expiry), and the privacy line.

Every phase: tests first for the access rules; `npm test`; video check before commit; CHANGELOG, PROJECT.md and `docs/BACKLOG.md` updated in the same release; deploy steps given with the release.
