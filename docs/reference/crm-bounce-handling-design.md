# Customer Hub: bounce handling for quote emails (design only)

Written 2026-11-17. **Nothing in this note is built.** The owner chose "plan it now, build later" because the build needs a mailbox login that only the owner can supply, and one real test message. This note is the plan so the build can start in a fresh session the day those are ready.

## 1. The gap today

When the site sends a quote email, three things can happen:

| What happens | Does the site know? |
|---|---|
| The mail server **refuses it straight away** (bad address, server down) | **Yes.** `routes/contact.js` records a `send_failed` quote event with the mail server's code only (never the address), shows the staff member an error, and does not mark the quote as sent (punch list G13). |
| The mail server **accepts it, and the buyer's server rejects it later** (mailbox full, address does not exist, domain blocks us). A "delivery failure" email comes back to our mailbox hours later. | **No.** The quote shows as sent. Nobody learns it never arrived. The 30-day "no answer" and expiry reminders then chase a quote the buyer never saw. |
| It is delivered | Nothing to do. The mail server gives no delivery receipts, so the timeline never says "delivered" (G13). |

Nothing in the site reads a mailbox. The campaign system classifies only an immediate refusal (`lib/campaign-tracking.js`, `classifySendError`, a 5xx code is "bounced"); a bounce that arrives later is a separate email and "is not caught" (comment in `db/schema.sql`, and CHANGELOG, "deliberately deferred"). There is no IMAP or POP library in `server/package.json`.

What does exist (from the 2026-11-15 spike, `docs/reference/crm-email-sync-spike.md`):

- `server/scripts/spike-crm-imap.js`: a read-only, counts-only probe. It needs `imapflow`, which is **not installed**.
- `server/lib/crm-mail-sync-state.js` (+ test): the one decision a mailbox sync must get right (UID and UIDVALIDITY handling; "resync, never guess").
- The result of the run on the real host: **GO**. `imapflow` and `mailparser` work, the host `mail.fixernationeducation.com:993` (TLS) accepts a session, the mailbox is small (68 messages), and the INBOX **already receives delivery-failure notices** (spike section 6).
- The owner's decisions then: **INBOX only**, never Trash, Junk or the "Registered Teachers" folder; mailbox reading is CRM Admin territory; "pause here" before phase 5b (the full conversations screen), which is still not started (punch list E1). The mailbox password is to be stored encrypted with a key in `.env` (S16, key rotation, is deferred).

Bounce handling is a **much smaller** job than 5b. It reads the same INBOX but looks only at delivery-failure notices, and writes one line on a quote's own activity log. It does not show anyone's mail on screen.

## 2. What the owner gets

On a deal's timeline and the quote's activity log: **"Quote email bounced (mailbox does not exist)"**, with the reason as a short class, and optionally one item on the Needs Attention list: "Quote email bounced. Fix the address and send it again." The quote stops looking like it reached them.

The reason is a class only: `mailbox_unknown`, `mailbox_full`, `domain_not_found`, `blocked_or_spam`, `other_permanent`. Never the address, never the text of the message, never the mail server's wording (which usually repeats the address).

## 3. The design

### 3.1 Know which quote a bounce belongs to

A delivery-failure notice quotes the original message's headers. We need a key that is in them and never guessed from an address:

- **Option A (needs nothing new from the mail host): store the Message-ID.** Today `lib/mailer.js` `sendQuoteEmail` returns nothing, so the Message-ID nodemailer makes is thrown away. Change it to return it (or set one explicitly, `<quote-{id}-{random}@fixernationeducation.com>`) and store it on the quote (a new column or a small table `crm_quote_mail`: quote id, message id, sent at). The bounce's "original message" part contains that header, so the match is exact.
- **Option B (stronger, needs proof on the host): a VERP envelope sender**, for example `bounces+q{id}.{hmac}@fixernationeducation.com`. The bounce is addressed to that, so the match needs no parsing of the original at all and cannot be forged by a random email. It depends on the host's mail server (Exim on cPanel) letting the site set an envelope sender different from the From address, and on plus-addressing delivering to the base mailbox. **Neither is verified.** One real test message settles it.
- **Recommendation: A first, B only if the test message shows it works.** A is enough to be correct; B only makes forgery harder.

An unmatched bounce is counted and ignored. It is never matched by email address.

### 3.2 Read the notices (a cron job, off until a dry run is read)

A new script, `scripts/crm-quote-bounces.js`, every 10 minutes (one new line in `setup-cron-jobs.sh`, like the other cron lines):

1. Opens **INBOX only, read-only** (`imapflow`; it never sets a flag, moves or deletes anything).
2. Uses `lib/crm-mail-sync-state.js` (`decideSync`, `nextPosition`) and a small table for the saved position (mailbox, folder, UIDVALIDITY, last UID). A rebuilt folder starts again and recognises messages already handled by Message-ID.
3. Looks only at messages that are delivery-status notices: `Content-Type: multipart/report; report-type=delivery-status`, or the sender `MAILER-DAEMON` / `postmaster`. It ignores everything else without reading it further (so no customer reply, no teacher sign-up notice is ever opened).
4. Parses the machine-readable part (`mailparser`): the `Status:` code. **5.x.x is a hard bounce** (record it). **4.x.x is a delay** (record nothing; the mail server is still trying). An out-of-office or auto-reply is not a delivery-status report and is ignored.
5. Matches it to a quote by the stored Message-ID (or the VERP tag), then writes a `bounced` quote event (`lib/crm-quote-events.js` `TYPES`, and the timeline's list and title in `lib/crm-timeline.js`) with the reason class, once.
6. Claims a ledger row first (unique on the bounce's own Message-ID), so reading the same notice twice makes one event. A notice that cannot be parsed is counted as "unrecognised", never guessed.

Hard rules, as for every CRM job: **off until the owner has read a dry run** (switch `crm_quote_bounce_reader`, `--on|--off|--status`, and `--apply`); counts only in the log and on the console (no name, no address, no subject); never emails anyone; never changes a quote's price, status or the deal's stage; the quote is **not** un-sent (a person decides what to do); `stderr.log` never gets an address (`safeError()` in the spike script is the habit to keep).

### 3.3 What it never does

It does not show any mail, does not read replies, does not touch a folder other than INBOX, does not store a message body, does not store the notice's text, and has no user-facing mailbox screen. That is phase 5b, which stays paused.

## 4. What the owner must provide before it can be built

1. **The mailbox login in `server/.env`** (never in chat): `IMAP_HOST` (`mail.fixernationeducation.com`), `IMAP_PORT` (993), `IMAP_USER`, `IMAP_PASSWORD`. The spike used the same mailbox that sends the site's email (`SMTP_USER`). A separate mailbox that only receives bounces would be tidier (see the next point), but the same one works.
2. **Which mailbox receives the bounces.** A bounce goes to the quote email's From address, or its envelope sender. **Unconfirmed:** whether the setting `quote_from_email` (used by `sendQuoteEmail`, falling back to `SMTP_USER`) is the `sales@` mailbox the spike read. Check this first; if it is a different address, bounces land somewhere the reader does not look.
3. **One real test message**: send a quote to an address that does not exist (an `@example.com`-style address is not enough, it must be a real domain with no such mailbox) and see that a delivery-failure notice arrives in that INBOX. This also proves option B if wanted.
4. **A decision on S16** (key rotation for the stored mailbox secret). Not needed to read from `.env` as above; needed if the password is ever stored in the database.
5. Confirm "reason class only, never the address" and "no Needs Attention item" or "yes, add one".

## 5. The build, when ready (one gap, one session)

- Store the Message-ID at send time (`lib/mailer.js` `sendQuoteEmail`, `routes/contact.js` send route; an alter script, additive, run before the restart; before it has run quotes simply cannot be matched).
- `lib/crm-quote-bounces.js` (parser and matcher, pure and testable with canned notices), `scripts/crm-quote-bounces.js` (the cron job and the switch), the position table, the ledger.
- `bounced` in `lib/crm-quote-events.js` and `lib/crm-timeline.js`; optional Needs Attention rule; the deal page shows it.
- `imapflow` and `mailparser` in `server/package.json` (npm install on the host; check the host's native-addon constraints, both are pure JavaScript).
- Tests: canned Exim, Gmail and Microsoft notices, a 4.x.x delay, an out-of-office, a forged "bounce" with the wrong Message-ID, a notice read twice, an unrecognised notice, UIDVALIDITY change, the address never appearing in any log or event, the switch off, before the alter script.
- Docs: runbook section, punch-list row, CHANGELOG, and the owner's one-line to-do (the login in `.env`).

## 6. Risks and how they are held

| Risk | Hold |
|---|---|
| Notice formats differ (Exim, Gmail, Microsoft) | Parse only the standard `delivery-status` part; anything else is "unrecognised" and counted, never guessed. Canned examples of each in tests. |
| A real person's reply or a teacher sign-up notice is opened | Only messages that are delivery-status reports are read past the headers. INBOX only. |
| A password in `.env` | Same as the SMTP password already there; never logged; never in the repo (public repo). |
| A forged "bounce" marks someone's quote as bounced | It only adds a line to the activity log; the match needs the stored Message-ID (or the signed VERP tag); nothing is un-sent or changed. |
| The reader cannot connect (host rule, mailbox full, password changed) | It prints one line (counts and a plain reason) and exits; nothing else in the site depends on it. |
