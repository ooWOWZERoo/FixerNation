# Backlog

Things we have agreed to do later. Newest section first. Nothing here is started unless it says so. When an item is done, move it to `CHANGELOG.md` as part of its release and delete it here.

## Shared demo environment (added 2026-11-12)

Requirements drafted in `docs/reference/shared-demo-environment-requirements.md`. One global on/off switch and end date in the admin, an unlisted page behind an access code, one account per role with a shared published password, view-only content, no outbound email. Nothing is built. The owner has answered account shape, page access, switch scope and content access; decisions D1 to D7 (time zone, page address, longest window, branding, safety alerts, release note, separate fixtures) were accepted as recommended on 2026-11-12.

- [x] **Owner decisions D1 to D7** accepted as recommended (section 9 of the requirements): US Eastern, an unguessable page path, 30-day maximum, color-only branding changes, silent safety alerts, no customer release note, separate demo fixtures.
- [x] **Phase 1: server foundation.** Built 2026-11-12 (879 server tests pass), **not yet committed or deployed**: `is_shared_demo` column (alter script), `lib/public-demo.js` and its gate, login, join-code and session refusal when closed, view-only downloads, no password, PIN or profile change, a mailer-level email guard (with a test that nothing else can send), no uploads. To deploy: run `alter-add-shared-demo-flag.js`, then restart the Node app.
- [x] **Phase 2: seed, reset and switch scripts.** Built 2026-11-12 (897 server tests pass), **not yet committed or deployed**: `seed-public-demo.js`, `reset-public-demo.js`, `set-public-demo.js` (on/off from the command line, also the emergency off), the nightly cron line, and the demo confinement now covering both the salesperson demo and the shared demo. To deploy: pull, restart the Node app, run the seed dry run then `--apply`, run `set-public-demo.js --on --days N` to test, add the cron line with `setup-cron-jobs.sh`.
- [ ] **Phase 4 note (found in phase 2):** a demo session cannot send a support request today (the logins have no real email). The demo page's ticket button must use the signed-out form (name and email) and a demo session must be allowed to use it.
- [ ] **Phase 3: admin Demo page** (switch, end date, code, password, copy message, reset, unlock, audit).
- [ ] **Phase 4: public demo page** with the access-code flow, "demo" tag on tickets and quote requests, analytics exclusion.
- [ ] **Phase 5: docs and checks.** PROJECT.md, CHANGELOG, staff how-to, video check.

## Password and sign-in security (added 2026-11-09)

Requirements drafted in `docs/reference/password-and-sign-in-security-requirements.md`. Today the only rule is "8 characters or more", copied into five places; there is no common-password check, no second factor and no forced-reset flag. Nothing is built.

- [x] **Owner decisions D1 to D5** accepted as recommended on 2026-11-09 (section 6 of the requirements): three length tiers (14 / 12 / 10), MFA offered then required after a 60-day grace period for school and district admins, no rotation timer, 7-day sessions for school and district admins, nudge for teachers and parents and force for admin roles.
- [ ] **Phase 1: one shared password policy.** `lib/password-policy.js`, a bundled common-password list, use it in the five places that check length, a test that fails on a stray `password.length`, and the one-line hint on the forms. No migration.
- [ ] **Phase 2: must-change flag and gentle notice.** `must_change_password` column (alter script plus `schema.sql`), Account Lookup button with an audit entry, sign-in notice for passwords below the new minimum.
- [ ] **Phase 3: authenticator-app MFA.** Admin account first, then school and district admins after D2. Needs its own access-matrix review before code.
- [ ] **Phase 4: shorter sessions and a password re-check** before sensitive actions.
- [ ] **Phase 5: public wording.** Update the Student Data Privacy page and the Help center security answer only once phases 1 to 3 are live; release note and a video check on the sign-up and sign-in videos.

## Owner housekeeping (added 2026-11-07)

Things only the owner can do (cPanel, the live admin, own devices). None affects the site today. The repo is public, so the specific email addresses are in the private memory notes, not here.

- [ ] **Account clean-up in the live admin.** Delete the three stray CRM contacts (two internal or test addresses and one misspelled teacher address). Deleting a contact also closes any sign-in account with the same email, including the misspelled teacher's typo account (id 125). Before deleting the teacher's, check in Account Lookup that her correct account exists and which account holds her license seat.
- [ ] **Rotate the QA credentials** (`rotate-qa-test-credentials.js`). Postponed by the owner on 2026-11-07.
- [ ] **Errors tab.** Open Support, then Errors, and Clear any group mentioning "QA deploy check" (the curl test row; the command-line clean-up found none).
- [ ] **Registration product description** in the admin still says "this price becomes $0 at checkout". Suggested: "Uses your school's license, so there is nothing to pay. Use your school email address."
- [ ] **Still yours from earlier notes:** Discover voice test on a Chromebook and an iPad, sales deck pricing check, verify more states (only NY and OH are verified), check the stray demo-style address on `admin-school-admins.html`, and one real Stripe test purchase of the solo license once live keys are on.

## Legal pages: owner and lawyer review (added 2026-11-06)

`terms.html`, `privacy-policy.html`, `refund-policy.html` and `affiliate-terms.html` (Release 126) were drafted from what the site, Help center and code already say. Decide or confirm before relying on them:

- [ ] **Governing law and where disputes are heard.** Left out of the Terms on purpose; needs the state and a lawyer.
- [ ] **Liability cap** (Terms section 12: amount paid in the last 12 months) and the "as is" wording.
- [ ] **Legal name.** Pages say "Fixer Nation Issues and Answers" (taken from the footer). Confirm it is the contracting entity.
- [ ] **Quote wins over the Terms** for that order (Terms section 4). Confirm, and check the text in each quote content profile (the "License, Download, and School-Year Terms" section lives in the database and was not read).
- [ ] **Safety alerts promise** (Terms section 8): we check student writing but cannot promise someone watches at every hour. Confirm that matches how alerts are handled.
- [ ] **Server logs.** Privacy Policy says the host keeps ordinary server logs with IP addresses. Confirm with Hosting.com, and check it against the Student Data Privacy page, which says no IP addresses are collected from student accounts.
- [ ] **Affiliate payout terms** (how and when paid, tax forms, what happens to paid commission after a refund). The terms only say these are confirmed when someone is approved and that unpaid commission on refunded orders can be reversed.
- [ ] **Adults only** for teacher, administrator and parent accounts (Terms section 2). Confirm.
- [ ] **Stripe consent.** Card checkout shows the Terms line on our cart only; Stripe's own page has no terms checkbox. Adding one needs a terms URL set in the Stripe dashboard first.
- [ ] **Emails.** Transactional emails and quote emails carry no Terms or Privacy link yet.
- [ ] **Accessibility statement, sub-processor list and a downloadable data privacy agreement** are still not on the site (the Student Data Privacy page says the team can provide them on request).
- [ ] **Student data retention.** The Privacy Policy still points to the Student Data Privacy page, which now states today's rule (Release 146). Update both when the purge ships.

## Help center and support (added 2026-11-06)

Where it stands: Help center live with 209 published answers and 2 drafts (Release 146). Support requests, support console, error capture and the Get help videos (published in Release 145) are built. These are the loose ends.

### Needs a decision from the owner

- [ ] **Student data retention: build the year-end purge.** Decisions are confirmed (2026-11-06) in `docs/reference/student-data-retention-requirements.md`. Done in Release 146: the interim honest wording and a read-only report (`node scripts/report-student-retention.js`). Next: owner runs the report and reads it; then phase 3 (teacher CSV download, banner and reminder emails, `removed_at` column and the 30-day rule), phase 4 (`purge-student-data.js`, dry run default, off until switched on), phase 5 (switch the public wording to the real rule, video check).
- [ ] **Office hours details.** The FAQ says 8 a.m. to 5 p.m., Monday through Friday. Add the time zone, and say whether to list a public email address or phone number (the site has neither today).
- [ ] **Read and decide on the 2 remaining drafts** at `help.html?preview=1`: `ferpa-requests` (access to a child's records; legal wording) and `who-reads-student-writing` (who can read reflections and quiz answers; privacy wording, added in Release 150). `student-data-retention` was published in Release 146 with wording that matches what happens today; it changes again when the purge ships.
- [x] **Public pages that disagreed** (Releases 147 and 150): parents see completion only; reflections are for the assigning teacher only; parents join by invitation from the teacher, not a code; prices come from the admin price list. The Help center answers them (Release 150), except the privacy one below, which waits for the owner to read it.
- [ ] **Facts the FAQ still cannot answer** (the site does not say, and the owner has not supplied them): the lesson scope and sequence before buying, how many Brain Games there are and whether they need a login, use at home or offline, languages, security certifications and sub-processor list, nonprofit or charter discounts, how to update billing details or get a receipt, what happens if someone forgets which email they bought with, whether an individual license can be reimbursed by a school or used for more than one classroom.

### Ready to do when the owner says go

- [ ] **Record M5, the staff community-moderation video.** The page now has a Remove button for comments (Release 145), so the video can be planned: storyboard in `tests/howto/storyboards/M5.ts`, entry in `help-videos.js` and `video-watch.json`, then publish with the owner's OK.
- [ ] **Review the Help center answers with fresh eyes after a few weeks of use**: use the anonymous `faq_open` counts (analytics) to see which answers are opened, add answers for the questions people send to Get help instead, and trim ones nobody opens.

### Later, if it proves useful

- [ ] An in-browser editor for Help center answers (today they change through a release in `help-center.js`).
- [ ] Email or text alerts for error spikes (the Errors tab only shows counts today).
- [ ] A read-only "view as" for staff (needs its own access requirements first).
