# Support console (phase 2): requirements

Status: BUILT as Release 121 (2026-11-05). Owner confirmed the revised plan and the four defaults, and added: student names hide after an idle time (Settings, default 5 minutes from the last mouse move or click; the script also counts key presses, touch and scroll). Follows `support-requests-requirements.md` (phase 1, live as Releases 115 and 118). Per CLAUDE.md the access matrix is confirmed before any code.

## Goal

When a person writes in, staff can see what is going on and fix it from the browser, without sending anyone an email and without opening a terminal. Owner's rule (2026-11-05): everything is managed in the browser, not by email.

## Where it lives

All on **Account Lookup** (`admin-account-lookup.html`), no new menu entry (so no cache-version churn across the admin pages). It gains: a timeline and more actions on the account card; a **Classroom lookup** card; and a **Parent** section. Support Inbox gets a link from a request to the person.

## What already exists (checked 2026-11-05) and what is missing

Everything below that exists is **email-based**, lives on a different page for each person type, and (except account lookup's revokes) writes **no audit-log row**.

| Need | Exists today | Where | Missing |
|---|---|---|---|
| Password reset for a site account (teacher, school or district admin, parent) | Yes, emails a link: `POST /api/site-auth/site-users/:id/send-password-reset` | "Reset Password" on admin-school-admins.html; "Send Password Reset" on the CRM contact card (admin-newsletter.html); teacher modal on admin-licenses.html | Not on Account Lookup. No on-screen link. No audit row. |
| Resend verification email | Yes, emails: `POST /api/newsletter/contacts/:id/resend-verification` | CRM contact card | Not on Account Lookup. Needs the CRM contact id. |
| Resend welcome / invite | Yes, emails | School admins (admin-school-admins.html), district admins (admin-districts.html), concierge (admin-concierge.html), school and district portals; FNE admin accounts via Settings ("Resend invite", "Send password reset") | Not on Account Lookup. |
| Teacher invitations | Yes: resend, extend, revoke (school admin portal); cancel and seat revoke on Account Lookup | school-admin-invitations.html, Account Lookup | Nothing needed. |
| Mark email verified | No button. (A completed password reset already marks the account verified: `site-auth.js` sets `email_verified = 1`.) | n/a | Not needed if the on-screen reset link is built. |
| Sign out everywhere | No button; only a side effect of a password change, revoke, deactivate or close | n/a | New. |
| Student PIN reset | Teacher only (own classroom) | teacher-classroom.html | Staff cannot. New. |
| Student lockout | Invisible to everyone | n/a | New (staff and teacher). |
| Parent invitation | Teacher can invite (one pending per email and student) and revoke; no resend, no extend, no staff view | teacher-classroom.html | New: staff view, extend 14 days, revoke. |
| One timeline for a person | Pieces only (account lookup lists, school-admin audit) | n/a | New. |

## What phase 2 builds (revised to reuse what exists)

All on **Account Lookup** (`admin-account-lookup.html`), no new menu entry. All `requireAuth`, the FNE admin login.

1. **Account actions row** on the account card, reusing the existing routes (no new backend): Send password reset email; Resend verification (unverified accounts); Resend welcome (pending admin assignments). The existing site-user reset route gains an audit row.
2. **New on the account card:** Show a one-time reset link on screen (1-hour life; a completed reset also verifies the email; not offered for FNE staff accounts or the admin login; audited), and Sign out everywhere (audited).
3. **Timeline** (newest first, last 100): account created or closed, invitations, seat claims, admin assignments, support requests, audit rows about the person. Read-only.
4. **Classroom lookup** card by teacher email, join code or student username: classroom, teacher, students (display name, username, active, locked). Never a PIN or lesson data. Each lookup audited.
5. **Reset a student's PIN** (new 6-digit PIN with `crypto.randomInt`, shown once, never stored in the clear or logged; audited) and **clear a lockout** (audited).
6. **Parent view** by parent email: linked children and invitations sent to that email, with Extend 14 days and Revoke (tokens never shown; audited).

Lockouts live in the server's memory (that is how they work today and why a restart clears them). Phase 2 shows and clears that same state; it does **not** add a table. The per-school-address limit (100 failures) is not shown or cleared; a school behind one address is not locked out by correct logins.

## Who can do what (access matrix)

| Actor | Timeline, verify, sign-out, reset link | Classroom lookup and student list | Reset student PIN | Clear student lockout | Parent view, extend/revoke invite |
|---|---|---|---|---|---|
| FNE admin (`fn_session`) | Yes | Yes (every lookup logged) | Yes (logged) | Yes (logged) | Yes (logged) |
| Teacher (`fn_user_session`) | No | Own classrooms only (already) | Own classrooms only (already) | **New:** own classrooms only | Own invitations only (already) |
| School admin | No change | No change | No | No | No |
| District admin | No change | No | No | No | No |
| Student, parent, visitor | No | No | No | No | No |
| FNE staff sign-in account (`is_fne_staff`) | No (it is a normal site account; staff tools are the admin login only) | No | No | No | No |

Rules that must hold:
- The privacy page already says student data is available to "authorized FNE staff"; every classroom lookup, PIN reset, lockout clear, verify, sign-out, reset link and invitation change writes a `school_audit_log` row (ids only, never a PIN, link or message).
- A teacher clearing a lockout is scoped by the verified classroom (`ownedClassroom`), then the student id inside that classroom (404, never 403, for anyone else's).
- Second-level ids (`:studentId`, `:invitationId`) are checked against the classroom or account they were looked up from.
- Staff pages escape everything with `fnEscape()`; no data in inline handlers.
- No endpoint returns a password hash, token, PIN or full invitation link.

## Teacher side (small)

The classroom student list shows a "Locked" tag with an **Unlock** button for the teacher's own students (`GET /api/classrooms/:id/students` gains `locked` and `lockedMinutes`; new `POST /api/classrooms/:id/students/:sid/unlock`). The teacher can already reset a PIN.

## Build outline

`lib/support-console.js` (timeline builder, shared PIN reset), `routes/admin-support-console.js` mounted at `/api/admin/support-console`, two small exports from `routes/classroom-auth.js` (`pinLockStatus(username)`, `clearPinLock(username)`), teacher route additions, Account Lookup page additions, tests (real SQL via `node:sqlite`), docs. No schema change, no alter script, no new emails. Deploy: pull, rsync (account lookup page, teacher classroom page), restart Node.

## Decisions for the owner

1. **Reset link on screen.** Recommended: yes, for non-staff accounts, audited, 1-hour life. The alternative is email-only, which fails for anyone whose mail is not arriving (as with your test).
2. **Staff can see student names, usernames and which classroom** (not PINs, not lesson data), with each lookup logged. This matches the privacy page. Recommended: yes.
3. **Teachers can clear their own students' lockouts.** Recommended: yes.
4. **Staff email notice for each new support request** still goes to the support address. Recommended: keep it (the admin menu count works either way); say so if you want it removed.

## Not in phase 2

Browser error capture (phase 3), FAQ or help centre (phase 4), "view as", the 2-year retention delete, seeing a student's progress.

## As built (Release 121)

- Routes `routes/admin-support-console.js` at `/api/admin/support-console` (timeline, reset-link, sign-out, resend-verification, classrooms, reset-pin, clear-lock, parents, parent-invitations extend/revoke); teacher `POST /api/classrooms/:id/students/:sid/unlock`; settings `GET/PUT /api/settings/privacy-lock` (1 to 120 minutes).
- Existing buttons reused, not rebuilt: reset email (`/api/site-auth/site-users/:id/send-password-reset`, now audited) and Resend welcome (`/api/admin/school-admins/:id/resend-welcome`, `/api/admin/districts/admins/:id/resend-welcome`), added to Account Lookup.
- Timeline shows a support request by reference and status only: its subject is typed by a person and could hold a student's name.
- Which admin pages show student names: only the new Classroom lookup and Parent view (no existing admin page showed any). They hide on idle through `admin-privacy-lock.js`; the page calls `lock.arm()` when names appear.
- The idle lock is a screen-privacy feature in the browser; the server still returns names to any signed-in admin request, and each lookup is audited.
- Not built (as agreed): staff roles among admins, 2-year support retention delete, phases 3 and 4.
