# Error capture (support phase 3): requirements

Status: BUILT as Release 122 (2026-11-05). Owner confirmed the matrix and all four recommended answers. Follows `support-requests-requirements.md` (phase 1) and `support-console-requirements.md` (phase 2). This one collects data from public pages, including pages students use, so the access and privacy rules are confirmed before any code.

## Goal

When someone writes in with "it just doesn't work", staff can see in the browser what went wrong, without opening a terminal or reading `stderr.log`. Today the server's error log has no timestamps and can only be read in cPanel, and a failed email (like your test one that never arrived) leaves no trace staff can see.

## What is captured (five kinds)

| Kind | When | What is stored |
|---|---|---|
| `js_error` | A page script throws (`window.onerror`) | Message, file and line, page path |
| `promise_rejection` | An async failure nobody handled | Message, page path |
| `failed_request` | A call to our own `/api/` fails: no network answer, or the server answers 500 or above (not 400, 401, 403, 404: those are normal "no" answers) | Method, API path with numbers replaced by `:id`, status, page path |
| `server_error` | An API route crashes (the Express error handler) | Method, API path (numbers replaced), the error's message and code, with emails and long tokens removed |
| `email_failed` | The mail server refuses or cannot send | The email's subject, the recipient's domain only (not the address), the mail server's error text |

Every row also has: when (first and last time, and how many times), what kind of visitor it was (`visitor`, `signed_in`, `student`, `admin`), the signed-in account id (only for `signed_in`), the anonymous browser session id (the same random id analytics already keeps in the visitor's own `sessionStorage`), and the browser's user-agent text.

## What is never stored

IP addresses; query strings and `#` fragments (reset, invite and verify tokens live there); request or response bodies; cookies; anything typed into a form; screenshots; student names or ids (a student's errors have no account id and no classroom); a full email address; full stack traces. Messages are cut to 300 characters; anything that looks like an email address or a token (24 or more letters and digits in a row) is replaced with `[removed]` before saving.

## Access matrix

| Actor | Send an error report | See reports | Change or delete reports |
|---|---|---|---|
| Any page visitor, signed in or not (browser) | Yes: write-only endpoint, rate limited, size capped, junk refused | No | No |
| Student (PIN login) | Their browser reports like anyone's, **with no identifiers** (decision 2) | No | No |
| Teacher, school admin, district admin, parent | Their browser reports, tied to their account id so staff can match a support request | No | No |
| FNE admin (`fn_session`) | n/a | Yes: all, grouped, plus per-request view | Yes: clear a group once fixed |
| The server itself | Writes `server_error` and `email_failed` | n/a | Deletes rows older than 30 days |

The report endpoint takes only the fields above; the account id, visitor kind and user agent come from the server (session cookies and headers), never from the request body. Reports do not require, and never create, a session.

## Where staff see it (no new menu item)

- **Errors tab on the Support Inbox** (`admin-support.html`): grouped by kind, path and message, newest first, with how many times, how many different browsers, first and last seen, and a **Clear** button. Filter: last 24 hours, 7 days, 30 days; by kind.
- **On every support request:** a panel "Errors from this person or browser, in the 7 days before this request": matched by the signed-in account id, or the browser session id the Get help form now sends along. Nothing matched shows "None found" (which itself is a clue).
- No email is sent for errors. The tab shows a count for the last 24 hours.

## How it works (outline)

- `error-capture.js` (new, small): listens for errors and rejections, wraps `fetch` for same-site `/api/` calls (never the report endpoint), sends at most 5 reports per page view, never repeats an identical one, uses `navigator.sendBeacon` when the page is closing. Loaded from `nav.js` (all public pages), the three admin-area nav scripts, and the five student pages directly. A report that fails to send is dropped, never retried, never shown.
- `POST /api/client-errors` (public, `limiter` per address, 4 KB body cap); `routes/admin-client-errors.js` (staff list, detail, clear); `lib/client-errors.js` (cleaning and saving); the Express error handler and the mail transport call the same saver.
- A repeat of the same error in the same browser session only raises its count.
- New table `client_errors`; new column `support_requests.client_session_id`; one alter script, run before restarting Node. Rows older than 30 days are deleted opportunistically (at most once an hour) when a report arrives.
- Cache versions bump on `nav.js`, `admin-nav.js`, `school-admin-nav.js`, `district-admin-nav.js` and `help-videos.js` is untouched.

## Limits (be aware)

It cannot see a page that never loads its scripts, a blank screen with no error, or something wrong with the person's own network. It reports what the browser tells it. It will be noisy at first (browser extensions throw errors on our pages); the grouping and "Clear" are there for that.

## Decisions for the owner

1. **Capture the five kinds above, including failed emails.** Recommended: yes. Failed-email capture is what would have explained your missing test email.
2. **Capture student browsers too, with no identifiers** (no account, no classroom, no name). Recommended: yes; game and lesson errors are exactly what teachers report, and nothing identifies a child. The alternative is to skip the five student pages and the game pages when a student is signed in.
3. **Tie signed-in adults' errors to their account id** so a support request can show them. Recommended: yes, 30-day retention.
4. **Retention 30 days.** Recommended: yes.

## Not in phase 3

Phase 4 (FAQ and help centre), the 2-year support-request retention delete, alerts by email or text for error spikes, session replay, performance timing.

## As built (Release 122)

- Browser: `error-capture.js` (injected by `nav.js`, `admin-nav.js`, `school-admin-nav.js`, `district-admin-nav.js`; a direct tag on the five student pages). Reports go by `sendBeacon` to `POST /api/client-errors`.
- Server: `routes/client-errors.js` (public, write-only, 60 per 10 minutes per address, 4 KB cap), `routes/admin-client-errors.js` (`GET /`, `POST /clear`, `GET /for-request/:id`), `lib/client-errors.js` (cleaning, dedupe, purge); the Express error handler calls `recordServerError`, and the mail transport in `lib/mailer.js` calls `recordEmailFailure`.
- Staff: Errors tab on `admin-support.html`; a panel on each request; the Get help form sends the browser's anonymous `fnAnalyticsSession` id (`support_requests.client_session_id`).
- Alter script `scripts/alter-create-client-errors.js` (table and column), run before restarting Node.
- Wrapping `fetch` means a failed `fetch` that has our reporter attached no longer raises an unhandled-rejection report of its own; the failed-request report covers it.
