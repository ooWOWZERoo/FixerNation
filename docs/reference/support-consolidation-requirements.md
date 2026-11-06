# Support consolidation: audit and requirements

Status: **BUILT as Release 134 (2026-11-06).** The owner confirmed the matrix and took the recommendation on all 12 questions. Follows `support-requests-requirements.md` (R115, R118), `support-console-requirements.md` (R121), `error-capture-requirements.md` (R122) and `help-centre-requirements.md` (R123 to R125).

## Goal

Support feels spread out because it grew in four releases, each adding to whatever page was nearest. The owner wants every support tool in **one obvious place** in the admin backend, with nothing lost and no old link broken.

## 1. Inventory (audit done read-only, 2026-11-06)

"Who" is always the FNE admin login (`fn_session`, `requireAuth`) unless stated; the admin has no staff roles.

| # | What | Where it lives today | Who uses it | Data it touches |
|---|---|---|---|---|
| 1 | **Support Inbox**: request list, filters, detail, reply, internal note, status, assign | `admin-support.html` (Requests tab); `routes/admin-support.js`, `lib/support.js` | FNE admin | `support_requests`, `support_request_messages`: name, email, role, school, free text typed by the requester |
| 2 | **Errors tab**: grouped browser, API, server and failed-email errors, Clear | Same page, second button (`#tabErrors`, hidden from the menu); `routes/admin-client-errors.js`, `lib/client-errors.js` | FNE admin | `client_errors` (no IP, no query strings, no student ids; 30-day retention) |
| 3 | Errors panel on each request ("in the 7 days before this request") | Inside the Inbox detail card; `GET /api/admin/client-errors/for-request/:id` | FNE admin | `client_errors` matched by account id or browser session id |
| 4 | New-request count badge | `admin-nav.js` (beside the Support Inbox link); `GET /api/admin/support/summary` | FNE admin | counts only |
| 5 | **Account Lookup**: account, school invitations, license seats, school-admin and district-admin assignments; cancel invitation, revoke seat or assignment, reopen a closed account, delete account | `admin-account-lookup.html`; `routes/admin-account-lookup.js` and existing routes it calls | FNE admin | `site_users`, invitations, `license_seats`, admin assignments |
| 6 | Account actions: send reset email, show one-time reset link, sign out everywhere, resend verification, resend welcome | Account card on Account Lookup; `routes/admin-support-console.js` plus two older routes | FNE admin | tokens (never shown except the one-time link), `school_audit_log` rows |
| 7 | Timeline for one person | Account Lookup; `GET /api/admin/support-console/timeline`; `lib/support-console.js` | FNE admin | audit log, invitations, support requests by reference and status only |
| 8 | **Classroom lookup**, reset a student's PIN, clear a lockout | Account Lookup (second and third cards); `routes/admin-support-console.js`; lockout state in memory (`lib/pin-lockout.js`) | FNE admin | **student names**, usernames, classroom, teacher; never a PIN except the one-time new one |
| 9 | **Parent view**, extend or revoke a parent invitation | Account Lookup (last card) | FNE admin | **student names** (linked children), parent email, invitations |
| 10 | Idle lock for student names | `admin-privacy-lock.js`, minutes set on `admin-settings.html` (`/api/settings/privacy-lock`, default 5) | FNE admin | browser only |
| 11 | The same account buttons, repeated where the person type is managed | School Admins ("Reset Password", resend welcome); CRM contact card (`admin-newsletter.html`: send password reset, resend verification); License Products teacher modal (`admin-licenses.html`: reset); Districts and Concierge (resend welcome); Settings (FNE admin accounts: resend invite, reset) | FNE admin | same routes as #6 |
| 12 | **Contact Us** and **Ask The Fixer** messages | Public forms; `routes/contact.js` (`general-inquiry`, `ask-the-fixer`); routing emails set in `admin-settings.html` | Whoever owns the mailbox | **Emailed only. Nothing stored, no list, no status.** |
| 13 | **Privacy requests** (access, delete, opt out) | Public Your Privacy Choices page; `POST /api/contact/privacy-request`; routing email in Settings | Whoever owns the mailbox | **Emailed only. Nothing stored, no due date, no status.** |
| 14 | Help center answers (reviewed or draft) | `help.html`, `help-center.js` (197 answers; 17 drafts; drafts at `help.html?preview=1`) | Public; FNE admin edits through a release | Static file. `faq_open` events show in Visitor Paths "top events" |
| 15 | Help videos list (G1 to G3 recorded, not published) | `help-videos.js`, `help-videos.html` (`?preview=1`); the G3 button sits on `admin-support.html` | Public; FNE admin | Static file |
| 16 | Support settings: "Support requests go to", "Privacy/data requests go to", idle-lock minutes | `admin-settings.html` (contact emails card; privacy lock card) | FNE admin | `settings` |
| 17 | Automations "Support" trigger group: *Support Request Submitted* and *Support Request Resolved* | `admin-automations.html` (lines 508 and 509, plus a "Support Ticket Follow-Up" template) | FNE admin | **Nothing in the server fires either event** (checked: no `fireAutomation('ticket_…')` call). They are choices that can never run |
| 18 | Mission Control | `admin-dashboard.html` Needs Attention: invoices, POs, quotes only | FNE admin | **No support item.** The only signal is the menu badge |
| 19 | Teacher unlock button; portal "Help center" and "Help videos" links; public Get help page and My requests | `teacher-classroom.html`, `school-admin-nav.js`, `district-admin-nav.js`, `support.html` | Teachers, administrators, parents | Not admin pages; they stay as they are |
| 20 | Adjacent, **not support**: Quotes and Concierge (sales and onboarding), Content Safety alerts (community moderation), Campaign bounces (marketing) | `admin-quotes.html`, `admin-concierge.html`, `admin-content-safety.html`, `admin-campaigns.html` | FNE admin | stay where they are |

What the audit shows: support is **two sidebar entries** under "Schools & Partners" (one of them with a second tool hidden behind a button), a student-data tool buried at the bottom of a page about one email address, support settings in Settings, two inbound channels (contact form, privacy requests) that live only in a mailbox, two automation triggers that never fire, and nothing on Mission Control.

## 2. Proposal

### One Support group in the sidebar, one tab strip on every support page

The Morning Boost workspace already does this (three pages, one tab strip from `admin-shell.js`). Use the same pattern: **no single mega-page, no URL changes**, so help videos, emails and bookmarks keep working.

New sidebar group **Support** (placed second, right after Sales; both Support Inbox and Account Lookup leave "Schools & Partners"):

| Sidebar link | Page | Contents | Change |
|---|---|---|---|
| Support Inbox (count badge) | `admin-support.html` | Requests only | Errors tab removed from this page |
| Account Lookup | `admin-account-lookup.html` | Account, invitations, seats, assignments, account actions, timeline | Classroom lookup and Parent view move out |
| Classrooms & Parents | `admin-support-classrooms.html` **(new)** | Classroom lookup, PIN reset, clear lockout, Parent view, extend/revoke | Moved as is; the **whole page** is under the idle lock (`admin-privacy-lock.js`) |
| Errors (24-hour count badge) | `admin-support-errors.html` **(new)** | The Errors tab, moved as is | Own page, own menu entry |
| Help Content | `admin-support-help.html` **(new, read-only)** | Published and draft counts per audience from `help-center.js`, links to `help.html?preview=1` and `help-videos.html?preview=1`, which videos are recorded but unpublished, the open `student-data-retention` draft, and a summary of where each form's email goes with a link to Settings | New, no server code, no write access |

Every one of these pages shows the same tab strip: **Requests | Account lookup | Classrooms & parents | Errors | Help content**, so you can move around without the sidebar.

### What moves, stays, redirects

- **Moves:** Errors tab out of the Inbox; Classroom lookup and Parent view out of Account Lookup; the sidebar entries into one group.
- **Stays exactly as it is:** every API route and URL (`/api/admin/support`, `/support-console`, `/client-errors`, `/account-lookup`), the data, the audit rows, the Get help page, My requests, the portal Help links, the teacher Unlock button, Content Safety, Quotes, Concierge.
- **Redirects:** `admin-support.html?tab=errors` (and `#errors`) forwards to `admin-support-errors.html`. `admin-account-lookup.html?email=` keeps working (the Inbox "Look up this account" link uses it). No page is deleted.
- **Mission Control:** two new Needs Attention rows, "N new support requests" (links to the Inbox) and "N errors in the last 24 hours" (links to Errors), read from the endpoints that already exist.
- **Dead automations:** remove the two never-fired Support triggers and the "Support Ticket Follow-Up" template from `admin-automations.html` (see question 8).

### Not in this release (separate requirements first)

Storing the Contact Us / Ask The Fixer messages and Privacy requests as inbox items with a status and a due date (rows 12 and 13). This is new personal data and a new access path, so it gets its own requirements (question 9). Also not in this release: staff roles, an in-browser editor for Help answers, a viewer for the audit log.

## 3. Access matrix (consolidation must change nothing here)

Single admin login. Every route behind `requireAuth` today stays behind it; the three new pages are static HTML that call only those routes, and send a signed-out admin to the login page (`fnHandleUnauthorized`), like every other admin page.

| Action | FNE admin (`fn_session`) | Teacher / school admin / district admin / parent (`fn_user_session`) | Student (PIN) | Visitor | Sales demo, FNE staff site account, closed account |
|---|---|---|---|---|---|
| Open any Support page or route | Yes | No | No | No | No |
| Read, reply, assign, note on requests | Yes | No (own requests only, on Get help, unchanged) | No | No | No |
| Account Lookup and account actions (reset link, sign out, resend, reopen, revoke) | Yes, audited as today | No | No | No | No |
| Classroom lookup, reset PIN, clear lockout | Yes, each lookup and action audited | Own classroom only, on their own page (unchanged) | No | No | No |
| Parent view, extend/revoke invitation | Yes, audited | Own invitations only, on their own page (unchanged) | No | No | No |
| Read, clear errors | Yes | No | No | No | No |
| Send an error report | n/a | Yes (write-only) | Yes, no identifiers | Yes | n/a |
| Help Content page | Yes (read-only) | No | No | No | No |

Second-level scoping (`:studentId`, `:invitationId`, `/for-request/:id`) is untouched because the routes do not change. A test will assert that each new page's source calls no route outside the existing `/api/admin/...` set and that no old route lost its `requireAuth`.

## 4. Pages that show student names

Rule from CLAUDE.md: any admin page that shows student names must use the idle lock.

- `admin-support-classrooms.html` shows student names (classroom lookup, linked children). It loads `admin-privacy-lock.js`, wipes names after the idle time and reloads them on "Show them again", exactly as Account Lookup does now. Moving the cards means the lock becomes **page-wide**, simpler than today.
- `admin-account-lookup.html` shows no student names after the split (the Timeline already hides them), so it **drops** the lock script. A test pins that: no student-name cards on Account Lookup, lock script present on the classrooms page.
- `admin-support.html` (Inbox) shows free text the requester typed. Requesters are told not to type student names, but one might. See question 10.
- Errors and Help Content pages hold no student data.

## 5. Build outline (after you confirm)

- `admin-nav.js`: new Support group, badge code moves to cover the Errors link too (v29 to v30).
- `admin-shell.js`: Support tab strip and breadcrumb group "Support" for all five pages (v3 to v4); page intros for the three new keys.
- New pages: `admin-support-classrooms.html`, `admin-support-errors.html`, `admin-support-help.html`. The first two are the existing code moved; no new endpoints, no schema change, no alter script.
- `admin-support.html` and `admin-account-lookup.html` lose the moved sections; Inbox gets the `?tab=errors` forward.
- `admin-dashboard.html`: two Needs Attention rows. `admin-automations.html`: remove the dead Support triggers.
- Cache numbers: bump every exact reference to `admin-nav.js?v=29`, `admin-shell.js?v=3`, and `help-videos.js?v=15` (G3's page list gains the Errors page) with a grep; `admin-common.css` and `admin-common.js` stay (the tab strip class already exists).
- `help-videos.js` G3 `pages` adds `admin-support-errors.html`; `video-watch.json` G3 adds the new page files.
- Tests (`server/test`): update the four that read these pages (`support-requests.test.js:389`, `client-errors.test.js:295`, `help-center.test.js:114,117`, `support-console.test.js:300`); add one for the new nav group, tab strip, redirect, the lock on the classrooms page and not on Account Lookup, and the removed automation triggers.
- Docs: CHANGELOG (Release 134), PROJECT.md page list, a note in the four earlier requirements files pointing here, `VIDEO-STATUS.md` after `node server/scripts/videos-to-review.js`.
- Video impact (expected): G1, G2 unaffected; G3 is recorded but unpublished and narrates the Errors tab on the Inbox page, so it needs a small re-record before it is published. The sidebar change also touches any recorded video that shows the admin sidebar; the check script will list them and I will judge each one.
- Deploy: push, pull, rsync of the admin HTML and JS files, **no Node restart**, no alter script, no `npm install` (static files only, unless you choose question 8's second option).

## 6. Open questions for the owner (recommendation first)

1. **Structure.** Separate pages with one tab strip and one sidebar group (recommended: keeps every URL, matches Morning Boost) or one hub page with in-page tabs (bigger change, needs redirects for every old page).
2. **Split Classroom lookup and Parent view onto their own page.** Recommended yes: it isolates the student-name tools behind one lock. Alternative: leave them on Account Lookup.
3. **Errors on its own page and menu entry with a 24-hour badge.** Recommended yes.
4. **Help Content page (read-only status).** Recommended yes. Alternative: skip it and leave Help content managed only through releases.
5. **Two Support rows on Mission Control's Needs Attention.** Recommended yes.
6. **Account buttons on School Admins, CRM, License Products, Districts, Concierge and Settings (row 11).** Recommended: leave them; they are handy where you are already working. They all call the same audited routes.
7. **Support settings (support email, privacy email, idle-lock minutes).** Recommended: keep editing them in Settings; Help Content shows the current values and links there. Alternative: move the two cards.
8. **Never-fired automations (row 17).** Recommended: remove them, since Release 118 chose "replies are read on the Get help page, not emailed". Alternative: wire them up, which adds requester emails and needs a Node restart.
9. **Contact messages and privacy requests (rows 12 and 13).** Recommended: treat as the next piece (requirements first): store them in the Inbox with a status, and for privacy requests a due date. Today they are emails only, so there is no record if the mailbox loses one. Not in Release 134 either way.
10. **Inbox free text and student names.** Recommended: no idle lock on the Inbox for now (it is adult-typed text, warned against student names). Alternative: wipe message bodies on idle too.
11. **Content Safety stays under Community.** Recommended yes.
12. **Menu position.** Support second, after Sales (recommended), or first under Mission Control.

## As built (Release 134)

- Pages: `admin-support-classrooms.html`, `admin-support-errors.html`, `admin-support-help.html` are new; `admin-support.html` lost the Errors list (it keeps the per-request errors panel and forwards `?tab=errors` and `#errors`); `admin-account-lookup.html` lost Classroom lookup and Parent view and gained an "Open parent view" link (`admin-support-classrooms.html?parent=<email>`; the page also reads `?q=` for a classroom search).
- `admin-nav.js` v30 (Support group, two counts; the errors count is cached for 5 minutes per tab because the errors endpoint is a grouped query), `admin-shell.js` v4 (tab strip, breadcrumb "Support"), `help-videos.js` v16 on every page that loads it (G3 now lists the Errors page).
- `admin-dashboard.html`: two Needs Attention rows. `admin-automations.html`: the Support trigger category and the Support Ticket Follow-Up template are no longer offered; `TRIGGER_EVENTS.support` stays only so older saved automations show a name.
- No server code, no new routes, no schema change, no restart. Tests: `server/test/support-consolidation.test.js`; four older tests updated for the moved pieces.
- Unchanged by decision: the account buttons on School Admins, CRM, License Products, Districts, Concierge and Settings (question 6); support settings stay in Settings (question 7); Contact Us, Ask The Fixer and privacy requests are still email only, a separate requirements piece (question 9); no idle lock on the Inbox (question 10).
