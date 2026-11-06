# Support requests (FNE inbox): requirements

Status: PHASE 1 BUILT (Release 115, 2026-11-05). Owner confirmed the matrix and the plan defaults for questions 1 to 4 and 6 (question 5: the notice address is the new setting `contact_email_support`, default the general admin address, editable in admin-settings.html). Phases 2 to 4 are not built.

> Release 134: the support pages were gathered into one Support area; see `support-consolidation-requirements.md`. The Inbox page keeps Requests only.

## Goal

Anyone who uses Fixer Nation (district admin, school license admin, teacher, parent, or a visitor) can ask for help in one place, and FNE staff can see who they are, what they were doing, and answer them from an inbox inside the admin workspace. Today the contact forms only send an email; nothing is stored, so there is no history, status, or context.

## Decisions already made

- Requests live in FNE (own table, admin inbox page), not in a shared mailbox. (Owner, 2026-11-05.)

## Who can do what (access matrix)

| Actor | Create request | See own requests | See others' | Reply / status / notes |
|---|---|---|---|---|
| Visitor (not signed in) | Yes, public form, rate limited, email required | No (gets an emailed copy) | No | No |
| Teacher, school admin, district admin, parent (signed in, `fn_user_session`) | Yes; role, school and district come from the server, not the form | Yes: own requests and staff replies marked "public" | No | No |
| Student (PIN login) | **No.** Students are children; the path is student, then teacher. No form, no stored student text | No | No | No |
| Sales demo account (`is_sales_demo`) | Refused (open question 3) | No | No | No |
| FNE admin (`fn_session`, `requireAuth`) | Yes (on behalf of a caller) | Yes: all | Yes: all | Yes: reply (emails the requester), set status, assign, internal notes |
| Closed account (`closed_at`) | Public form only | No | No | No |

Second-level scope: `GET /api/support/mine/:id` checks the request's `site_user_id` against the verified session (404, never 403, for someone else's). The two auth systems stay separate: requester routes use `requireSiteAuth`, inbox routes use `requireAuth`.

## What gets stored

`support_requests`: id, ref (short human code, e.g. `SR-4F7K2`, via `crypto.randomBytes`), status (`new`, `open`, `waiting_on_user`, `resolved`), category (`cant_sign_in`, `invitation_or_seat`, `students_or_classroom`, `parents`, `billing_or_license`, `something_broke`, `other`), subject, message, requester name and email, `site_user_id` (nullable), role and school domain and district id (resolved server-side from the session), page URL and user agent (client-supplied, length-capped, treated as untrusted text), assigned admin (nullable), created/updated/resolved timestamps.

`support_request_messages`: id, request_id, author (`requester` | `staff`), visibility (`public` | `internal`), body, created_at. Staff internal notes never leave the admin side.

Not stored: student names, student PINs, passwords, tokens. The form carries a plain warning not to type them. Server strips nothing automatically (no guessing), but the admin page shows the warning too.

## Rules that must not erode

- Context (role, school, district) is looked up from the verified session; a client that sends its own role is ignored.
- Public endpoint takes only the public form's fields (CLAUDE.md security rule); `limiter()` per IP and per email.
- All requester text goes through `fnEscape()` in admin HTML and `esc()` in email HTML; never in inline `onclick` strings (use `data-` attributes).
- Staff replies are emailed with the requester's address only from the stored request, never from a client-supplied field.
- Every staff action (status change, assignment, reply, note) goes through `lib/audit.js`.
- A requester who is later closed or deleted keeps the request (staff history); the copy is anonymised only on a privacy request.
- Staff are notified of new requests by email to a setting (`contact_email_support`) in addition to the inbox badge, so a new request is never silent.

## Phases

1. **Inbox core:** table, public + signed-in form (new `support.html`, linked from the footer and the portals), "My requests" list, admin inbox page (`admin-support.html`, in the nav under Schools & Partners), reply and status, email notices both ways. Help-video button not needed.
2. **Support console:** Account Lookup gains students and parents (by teacher/classroom), a timeline from `school_audit_log`, and one-click reset password / resend verification / resend welcome / clear PIN lockout (requires moving lockouts out of memory: new table, expiry by time).
3. **Error capture:** browser errors and failed API calls (page, role, time, no personal text) in a small table, shown on the request and in a staff view.
4. **Help centre:** FAQ by role built from what phases 1 to 3 show people actually ask.
5. **Maybe, later:** read-only "view as" for staff, only after separate access requirements.

## Open questions for the owner

1. Is the single admin login enough, or should several staff share the inbox with "assigned to"? (Plan: build the assigned-to field; it costs little.)
2. Should replies be emailed only, or should a signed-in requester also read them in "My requests"? (Plan: both.)
3. Sales demo accounts: refuse the form, or let it through marked "demo"? (Plan: refuse.)
4. Inbound email replies: staff replies go out with Reply-To set to the support mailbox, and a requester's email reply lands in that mailbox, not back in the inbox thread. Acceptable for phase 1? (Threading inbound mail is a later project.)
5. Which email address receives new-request notices (`contact_email_support`)?
6. Retention: keep requests for how long (plan: 2 years, then delete)?

## Video check

The new page is not covered by any help video yet; `docs/training-videos/video-watch.json` needs no entry until a staff video is planned.

## As built (Release 115)

- Person side `routes/support.js` (`POST /api/support`, `GET /context`, `GET /mine`, `GET /mine/:id`, `POST /mine/:id/messages`); staff side `routes/admin-support.js` (list with counts, `/admins`, detail, `PUT` status/assignment, `POST /:id/messages` reply or note); shared `lib/support.js`; tables from `scripts/alter-create-support-requests.js`.
- Retention (question 6): the 2-year deletion is NOT built yet; nothing deletes requests today. Needs a small script, not done in this release.
- Staff reply emails link to "My requests" only when the requester was signed in.
- Account Lookup reads `?email=` so the inbox can open a person's record in one click.

## Change in Release 118 (owner, 2026-11-05)

- Replies are read on the Get help page, not emailed (owner: "I prefer that the user receive the update via the support page and not email"). This replaces the "reply is emailed" rows above.
- Signed in: a "New reply" tag from `support_requests.requester_seen_message_id` (newest staff reply opened); opening a request sets it.
- Not signed in: `POST /api/support/lookup` and `/lookup/messages` take the reference AND the email. A miss is always the same 404 words; misses are throttled (10 per 15 min per address, 5 per reference). The response never repeats the email, and internal notes are never selected.
- The request confirmation email is kept (reference plus link to the page). Staff still get an email notice for each new request or follow-up, and the admin menu shows a count of new requests (`GET /api/admin/support/summary`).
