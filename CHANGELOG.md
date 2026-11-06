# Changelog

All notable changes to the Fixer Nation Education platform (fixernationeducation.com), grouped by release. Dates are when each release was deployed to production.

> **Maintenance convention:** add a new release section at the top of this file every time a feature or fix is completed and deployed — see `CLAUDE.md` for the exact rule. Keep entries short and user/business-facing (what changed and why it matters), not a line-by-line diff.

## Go-Live cutover — 2026-09-05

- **Visitor-path analytics reset to zero** (`server/scripts/reset-visitor-analytics.js`, `analytics_sessions`/`analytics_events` only) as the last step before go-live, so real launch traffic starts from a clean baseline instead of being mixed in with ~1,529 dev/QA sessions accumulated since testing began — confirmed via `admin-analytics.html` that all of it was noise (top entry pages included `blog.html`/`books.html`, both removed from FNE's scope long ago; top event was a literal `"[QA] Test License"` add-to-cart). Deliberately scoped to only these two tables — sent test campaigns, curriculum download counters, and quote requests were all identified as also containing some test data during the same review, but left untouched at the user's explicit call (not a blanket wipe).
- **Production Stripe keys activated** — `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` swapped from test to live mode. No code change; a live-mode webhook endpoint was registered in the Stripe Dashboard alongside the existing test one.
- **Revenue/financial dashboard data reset to zero** (`server/scripts/reset-revenue-data.js` — `purchases`, `invoices`, `quote_requests`, cascading to `license_seats`/`school_license_admins`/`school_invitations`). Every one of the 23 purchases and 22 quotes on record was individually checked and confirmed test/internal (`qa-*@example.com` accounts, the developer's own dogfooding account, or the internal `vssus.com`/`fixernation.org` staff domains) before this ran — zero real customers or leads existed at cutover time.

## Unreleased / Known pending work

- **Help center and support loose ends** are tracked in `docs/BACKLOG.md` (student data retention decision, office-hours details, 18 draft answers to review, publishing the Get help videos, re-recording two portal tours, hiding the Convert to Annual Access button after a trial ends, role-aware quick answers).
- **"Your turn" finale for Strength Spotter and Values Compass (Release 138, built and tested, held for the owner's read of `docs/tune-your-brain/OWN_SELF_STEPS_FOR_REVIEW.md`; not deployed).** After the stories (4 per run instead of 5), the child answers three questions about themselves and gets a card built from their own picks: Strength Spotter (pick up to two strengths, where they use them, one small way to grow one) and Values Compass (rank their top three values, face a tradeoff between two of them, where they acted on one). Nothing is logged, sent or saved and there is always a "not sure" answer. The per-story check shrinks to one tap. Static files only (`engine-scenario-choice.js` v8). Both games now count as Self-Awareness games in the coverage grid; Feelings Detective is the last one waiting (needs recorded clips).
- **"Your turn" finale for Feelings Detective (Release 139, built and tested, held for the owner's read and ear test of the new clips; not deployed).** After 3 stories (was 4) and one tap each, the child says how they feel (one or two of eight feelings), where they feel it in their body, and what helps, then sees and hears a feeling card built from those picks, read aloud in the recorded Ava voice (28 new clips). Nothing is logged, sent or saved and every question has an "I'm not sure". Also fixed for all scenario-choice games: a double tap on a confirm, Continue or Finish button no longer starts the next screen twice. Static files only. With this, the three Self-Awareness games all have their finale and count in the coverage grid.
- **Stripe card checkout** (individual teacher license purchase on `licenses.html`, and the Stripe option in the cart/PO checkout flow) is coded, pushed, and — as of 2026-08-22 — confirmed configured and working end-to-end in Stripe's **test mode** (real e2e coverage, cart → Stripe Checkout → test card → webhook → paid/active license). **Still not live for real customer charges** — that requires swapping in the admin's real/live Stripe keys in place of the test ones. Purchase Order (PO) checkout requires no Stripe keys and is fully live today.
- **Deeper bounce detection** — today's bounce/undelivered tracking only catches failures the mail server reports immediately at send time. Catching the far more common case (a bounce that arrives later as its own email) would need IMAP access to the sending mailbox, a bounce-message parser, and a periodic cron job — deliberately deferred as a second phase; ask if this becomes a real gap.
- **Migrate off plain SMTP to a real ESP** (SendGrid, Postmark, Amazon SES, etc.) with native delivery/open/bounce/complaint webhooks — this would replace the current pixel-and-click-tracking guesswork entirely with accurate, real-time data straight from the provider. Bigger infrastructure change (new account, API integration, likely a cost) — not started.

## Release 137 — 2026-11-06 — Games grouped by focus

- **The games page now filters by focus.** The old single row (Literacy, Math, Thinking Skills, SEL & Character, Wellness & Life Skills) is two rows: the five SEL competencies (Self-Awareness, Self-Management, Social Awareness, Relationship Skills, Responsible Decision-Making) and Skills practice (Literacy, Math, Thinking Skills). A line under the chips explains the one you pick, and each card's tag names its focus. The Wellness chip is gone; no game used it.
- **Every one of the 31 games has one focus** (new `brain_games.focus` column, one value per game; the competency list stays as the secondary tag). A check fails the tests if a game is added without one, and `node server/scripts/focus-coverage.js` prints the grade band x focus grid and every cell with fewer than two games.
- **Teachers can pick a focus when assigning a game**, on top of the grade-level filter.
- **Tags corrected to match what each game trains:** Number Sequence is Math (was Thinking Skills); Quick Math moves from Challenge to Explore (its numbers are grade 3-5 level); The Post is Responsible Decision-Making and no longer claims Self-Management; Feelings Detective also lists Social Awareness; Idea Lab, Fix-It Workshop and Values Compass lose competencies they do not practise.
- **Reaction Time has STOP signs.** Between the green rounds a red STOP sign sometimes appears; the right move is to not tap (1 sign on Easy, 2 on Medium, 3 on Hard; never first, never two in a row). The sign differs by word and shape, not only colour. Errors and holds are shown at the end and saved, but do not change the score, so no earned badge or level changes. The run still has 5 green rounds.
- Needs one database step before the Node restart (adds the column) and one seed script (fills it). The three self-awareness games (Feelings Detective, Strength Spotter, Values Compass) are tagged but do not count toward the two-per-cell minimum until each gets a "your turn" step in a later release.

## Release 136 — 2026-11-06 — Game fixes from the games audit

- **Money Moves and Money Matters can always be won now.** Each run draws some of the events at random, and in about 35 percent of Money Moves runs and 43 percent of Money Matters runs the draw left out the money coming in, so the goal could not be reached however well you chose. The allowance (Money Moves) and the paycheck and tax refund (Money Matters) are now in every run. A test tries every possible run of both games.
- **Number Sequence:** the "Quadratic pattern" questions on Hard had a new random number added to every term, so there was no rule to find (about 1 Hard question in 5). They now follow one rule.
- **Story games:** choosing to ask a trusted adult now counts in "Smart choices" on the end screen (nine games), matching what the feedback already says.
- **Memory Match** works with a keyboard and a screen reader: every card is a button that says what it shows, and matches and misses are announced.
- **Same and Different:** a stale code comment corrected (5 rounds are drawn from 12, not 4).
- **Reading Detective** now has 12 passages, 5 drawn each run (it was the same 4 every time). The wrong answers are written as long as the right one: before, the right answer was the longest in all four items. The text is in `docs/tune-your-brain/READING_DETECTIVE_FOR_REVIEW.md`; sentences and explanations were kept inside the Explore word limits.
- Static files only. No server or database change.

## Release 135 — 2026-11-06 — Errors count in the menu follows the Errors page

- **The count beside Errors in the menu did not go down after you cleared errors.** The menu remembered the 24-hour count for 5 minutes. The Errors page now updates the menu count every time it loads or clears a group.
- Static change only. No server or database change.

## Release 134 — 2026-11-06 — All support tools in one Support area

- **One Support group in the admin menu.** Support Inbox, Account Lookup, Classrooms & Parents, Errors and Help Content now sit together under Support (they were split between "Schools & Partners" and a hidden button). Every support page shows the same tab strip so you can move between them without the menu.
- **Errors has its own page and a count in the menu** (last 24 hours). The old Errors button on the Inbox is gone; `admin-support.html?tab=errors` forwards to the new page, and each request in the Inbox still shows the errors from that person.
- **Classroom lookup and Parent view moved to their own page** (Classrooms & Parents), so every student name in the admin sits behind one idle lock. Account Lookup keeps the account, invitations, seats, admin assignments, account actions and timeline, and gains an "Open parent view" link.
- **New read-only Help Content page:** how many Help center answers are published or still drafts, which help videos have no link yet, and where each form's email goes.
- **Mission Control:** Needs Attention now lists new support requests and errors from the last 24 hours.
- **Removed two Automations choices that never worked** ("Support Request Submitted" and "Support Request Resolved" triggers, and the Support Ticket Follow-Up template). Nothing on the server ever fired them; replies are read on the Get help page, not emailed. Automations saved earlier still show their name.
- No server or database change. No new routes. All old page links still work.

## Release 133 — 2026-11-06 — Classroom Academic Year list goes from now to graduation

- **The Academic Year choices were a fixed list** (2024–2025 to 2027–2028) on the Create Classroom and Edit Classroom boxes, so it already offered two past years and ran out in a year. The list now starts at the school year we are in (2026–2027) and runs 13 school years, to 2038–2039, so a child starting kindergarten now can be followed through grade 12. It moves forward by itself each August (a school year runs August to July), so nobody has to edit it again. New shared `school-years.js`.
- **An older year on an existing classroom is kept.** If a classroom already has a year no longer in the list (for example 2025–2026), Edit Classroom still shows it, so saving the classroom does not blank it.
- Static change only. No server or database change.

## Release 132 — 2026-11-06 — Sound Safari: no more sounds said three times

- **Found why "lll" was said three times.** The voice reads a spelled triple like "lll" as three letter names ("el el el"). The clip lengths showed the same for "sss", "fff", "nnn", "rrr" and "vvv" (each 1.0 to 1.4 seconds, against 0.3 to 0.6 for "mmm", "zzz" and "shhh", which it reads as one hum, buzz and hush).
- **Six sounds respelled so they are said once:** s, f, l, n, r and v now use a short "uh" ("suh", "fuh", "luh", "nuh", "ruh", "vuh"), the same way the pop sounds ("tuh", "buh") already did. "mmm", "zzz" and "shhh" are unchanged. A test now fails if a sound is ever spelled as a repeated letter again. Only 6 clips changed.

## Release 131 — 2026-11-06 — Games: a way back, clearer sounds, Ava on every Discover game, and many more rounds

- **Every game now has a "← All Brain Games" link** under the site header (32 game pages; new `game-backlink.js`). It is left out when a game is shown inside a student's classroom page, which already has "My Classroom". Before this, the 26 newer games had no way back except the browser's Back button.
- **"Log in to track your progress" explained and fixed.** It meant "you are not signed in, so your scores are not saved", and it only pointed at adult accounts. A student with a classroom login never saw it, but a student who had not signed in yet had nowhere to go. The games page now shows one clear banner when you are not signed in (students: classroom code, username and PIN; teachers and parents: their own login pages), the cards say "Sign in to save your progress", and the six older games' "Save your score" boxes add a student line.
- **Sound Safari sounds are clearer.** Each sound is now its own clip, said slowly and held (a stretched "mmm", a firm "tuh"), with a little silence before and after so no browser clips the start or the end, and every clip is raised to the same loudness. The question is now three pieces: the word, the sound, then the question. A page for listening to all 19 sounds is at `docs/tune-your-brain/sound-safari-audition.html`.
- **Recorded Ava voice on Calm Down Corner, Sharing Circle, Helper's Choice, Same and Different and Feelings Detective** (550 clips, about 12 MB, `assets/audio/discover/`). Every story, answer, "You got it!" and explanation is a clip; a line without a clip is read by the browser voice, so a game is never silent. New shared player `engine-voice.js`.
- **Many more rounds.** Calm Down Corner, Sharing Circle and Helper's Choice: 4 rounds each became 18, with a spoken explanation after every answer. Same and Different: 12 became 24. Feelings Detective: 4 stories became 12. Each play draws 5 rounds (Feelings Detective 4), so the same child rarely sees the same set twice. **New wording needs your read:** `docs/tune-your-brain/R131_DISCOVER_EXPANSION_FOR_REVIEW.md`.
- **Community profile badges.** The profile only showed badges you had "featured" on the badges page, so someone who had earned badges but never featured one saw "No featured badges yet". It now shows your 6 latest earned badges until you choose which to feature, and says so. A failure while loading badges is now written to the server log instead of being hidden.
- Static change plus one small server change (`routes/social.js`, `lib/profile-badges.js`): restart Node. No database change. `engine-audio-choice.js` v6, `engine-scenario-choice.js` v7, `engine-voice.js` v1.

## Release 130 — 2026-11-06 — Sound Safari: Ava's voice, a slower pace, and 77 rounds

- **Ava instead of the robot voice.** Every question, picture name and "Yes!" / "Not quite." line is now a recorded clip of the same Ava (Premium) voice the how-to videos use (262 small clips in `assets/audio/sound-safari/`, about 5 MB). If a clip ever fails to load, the browser voice reads the same words, at a slower speed.
- **The sound is said once, not three times.** It was "Mmm. Moon starts with mmm. Which picture starts with mmm?" It is now "Moon starts with mmm. Which picture starts with the same sound?" The wrong-answer and right-answer lines also name the sound once: "Moon and monkey both start with mmm."
- **A slow but natural pace for kindergarten to 2nd grade.** Sentences are recorded at 135 on the voice's speed scale (the how-to videos use 165), about 4.6 seconds for the question; each picture name is its own clip, with a half-second pause between the question, each name and the feedback. A first try at 92 was too slow, so this was raised.
- **77 rounds instead of 4**, covering 19 sounds (m, s, t, b, p, d, f, g, h, j, k, l, n, r, w, v, z, sh, ch) with 3 to 5 rounds each. Each game draws 6 at random, so a child rarely sees the same set twice. Wrong pictures never start with the answer's sound or a look-alike one (b/p, d/t, k/g, f/v, s/z, sh/ch, m/n).
- **Under the hood.** The audio engine (`engine-audio-choice.js` v5) can now play recorded clips in order, falls back to the browser voice if a clip fails, and takes an optional `speechRate` per game; the other games do not set it, so they sound the same as before. The rounds are generated by `server/scripts/build-sound-safari.js` (add or change a round there, then run it with `--audio` on the Mac). Tests in `server/test/sound-safari.test.js`.
- Static change only: new page, engine, 262 clips. No server or database change.

## Release 129 — 2026-11-06 — Instagram and LinkedIn links in the footer

- **The IG and "in" footer icons now go somewhere:** Instagram (a post, `instagram.com/p/Dd6q3pCFWFK/`) and LinkedIn (Anthony Placito's profile). Both open in a new tab. The Facebook and X icons still have no link, because no address was supplied. `footer.js` is v17 on every page.

## Release 128 — 2026-11-06 — Fix bullet lists on the legal pages

- **The bulleted lists on Terms, Privacy Policy, Refunds and Affiliate terms read badly:** each bold label, sentence and link sat in its own column, so text broke into odd blocks (worst under "What we collect and why"). Each list item now flows as normal text with a small bullet. Page styling only; no wording changed.

## Release 127 — 2026-11-06 — A shorter footer, with help and legal pages kept apart

- **The footer is about 30% shorter** (716 px to 499 px on a laptop, and about 125 px shorter on a phone). The long fourth column is gone: the 10 help, legal and privacy links no longer sit under the sign-in links.
- **Three clear zones.** Four link columns (Explore, Schools & Partners, Sign in) with seven links or fewer each. A "Need a hand?" band with its own buttons (Help center, Help Videos, Contact, and Get help in coral). A quiet "Legal & privacy" row with Terms of Use, Privacy Policy, Refunds & Cancellations, Student Data Privacy, Parents' Bill of Rights and Your Privacy Choices, next to the copyright.
- **Small changes.** A thin coral-to-gold stripe on top; Become an Affiliate moved under Schools & Partners; The Positivity Network is now one line (its tagline shows on hover); a custom website logo is capped at 84 px tall instead of 130 px.
- Static change only: `footer.js` is v16 on every page. No server or database change.

## Release 126 — 2026-11-06 — Terms, Privacy Policy, Refunds and Affiliate terms (drafts for owner review)

- **Four new public pages** so that every place that points at a legal document has one behind it: Terms of Use (`terms.html`), Privacy Policy (`privacy-policy.html`), Refunds and cancellations (`refund-policy.html`) and Affiliate program terms (`affiliate-terms.html`). They say only what the site and the Help center already say (for example, refunds are decided case by case; licenses do not renew on their own).
- **Linked from where people decide:** the footer on every page (new Terms, Privacy Policy and Refunds links, plus Terms and Privacy Policy in the bottom line), the cart, quote acceptance, the Buy Now card on the licenses page, the pricing page, the account sign-up box (25 pages), the newsletter box, the contact form and the affiliate application.
- **Needs the owner's and a lawyer's eyes before it is relied on.** The wording is plain-language drafting, not legal advice. Open questions are in `docs/BACKLOG.md` (governing law, liability cap, the legal name, payout terms).
- No server or database change. `footer.js` is v15 on every page.

## Release 125 — 2026-11-05 — Help center: pricing, refunds, hours, devices and more (answers from the owner)

- **11 new published answers** from your own words: how much a license costs (a quote, no fixed price list), refunds and cancellations (case by case), free trials and demos (case by case), discounts and tax forms (send a request), how renewals work (reminders before the license ends, and the portal banner turns yellow at 30 days), office hours (8 a.m. to 5 p.m., Monday through Friday; reached through the Contact page or Get help), which devices work (any device with a working browser, including Chromebooks and iPads; Chrome preferred), training, and accessibility.
- **Google Classroom, Clever and single sign-on:** answered from the code. There is no connection to Google Classroom, Clever or ClassLink; adults sign in with email and password or Microsoft, and students use a username and PIN.
- **"How long is student data kept?" stays a draft.** You said student data is purged at the end of the school year, but nothing in the system does that today (only Brain Games activity is cleared, after about 13 months). It will not be published until the system matches the promise or the wording changes.
- 191 answers are now published, 18 are drafts. `help-center.js` is v3. No database change.

## Release 124 — 2026-11-05 — The Help center is filled in

- **The Help center now answers questions.** It was empty because all 32 first-draft answers were still waiting for review. It now has **180 published answers** covering sign-in problems, administrator setup, invitations and seats, branding, reports, quotes and purchasing, district tools, teacher classrooms and student PINs, assignments and progress, Community, Brain Games, parents, and the Get help page itself. About 75 of them quote the exact message a person sees ("It says Too many attempts..."), and most link the matching how-to video.
- **17 answers stay hidden until you read them** (`help.html?preview=1`): everything about prices, promised response times, privacy and legal wording, and research claims.
- The answers were gathered from the how-to video scripts, the public pages and the code's own error messages, and the numbers in them were checked against the code. None tells people to email us (the site has no public support email); they point to Get help.
- Existing answers were improved (permission levels, teacher self-registration and seat release are now stated from the code). The "Check these answers first" box on the Get help page now shows real answers for the chosen topic.
- No database change. Deploy: pull, rsync (`help-center.js` and the pages that load it), restart is not needed for a static change but harmless.
- Notes and gaps: `docs/reference/help-centre-requirements.md`.

## Release 123 — 2026-11-05 — Help center, and how-to videos for Get help

- **New Help center** (`help.html`): a search box, tabs for Everyone, School administrators, District administrators, Teachers, Students and Parents, and short plain answers (about 30 to start) with steps where there are steps, the matching help video when one is recorded, and a "Still stuck? Get help" button that opens the Get help form with the topic already chosen. Linked from the footer, the School and District admin menus, the Contact page and the top of the Get help page ("Check these answers first").
- **Nothing is public until you have read it.** Every answer starts as not reviewed. Read them all at `help.html?preview=1`, then they are switched on. Until then visitors see none, and the "Check these answers first" box on the Get help page stays hidden.
- **What it learns:** opening an answer records an anonymous `faq_open` event (the answer's id only) with the analytics the site already has.
- **Support requests are deleted after 2 years**, with their messages, when a new request arrives (at most once an hour), leaving one audit row with the count and no text.
- **Three new how-to videos** on Get help, recorded and checked on the test site (published to the site only after approval): G1 Ask for help and follow your request, G2 Ask for help without signing in, and G3 Answer requests in the Support Inbox (staff only: gets a How-to video button on the Support Inbox but is not listed on the public Help Videos page).
- No database change. Deploy: pull, rsync (all pages: footer and portal menu versions changed), restart Node.
- Requirements: `docs/reference/help-centre-requirements.md`.

## Release 122 — 2026-11-05 — Error capture: staff can see what broke, in the browser

- **New Errors tab on the Support Inbox** (no new menu item). It lists what went wrong, grouped by kind and place with how many times and how many different browsers, for the last 24 hours, 7 days or 30 days, with a Clear button for a fixed problem. The tab shows a 24-hour count.
- **Five kinds are captured:** a page script error, an async failure nobody handled, a failed call to our own API (no answer, or a 500 or above; a normal 400, 401, 403 or 404 is not counted), a server crash, and a **failed email** (the subject and the recipient's domain only, plus the mail server's error text). That last one is how a missing test email shows up without reading a log.
- **Every support request shows errors from that person or browser** in the 7 days before it (matched by signed-in account, or by the anonymous browser id the Get help form now sends).
- **Privacy:** no IP addresses; no query strings or `#` fragments (tokens live there); no request or response bodies, cookies or form values; no full email addresses (any email or token-like text in a message is replaced); a **student's browser reports with no account, classroom or name**. Reports are kept 30 days and deleted automatically. Browsers can only write their own three kinds, and who is reporting comes from cookies, never from the report.
- **How it loads:** `error-capture.js` is loaded by `nav.js`, the three admin-area nav scripts and the five student pages (so `nav.js` is v20, `admin-nav.js` v29, `school-admin-nav.js` v23, `district-admin-nav.js` v9).
- **Deploy order matters:** pull, rsync (all pages), run `alter-create-client-errors.js` (new `client_errors` table and `support_requests.client_session_id`), THEN restart Node.
- Requirements and access matrix: `docs/reference/error-capture-requirements.md`.

## Release 121 — 2026-11-05 — Support console: fix a person's problem from Account Lookup, and student names hide when idle

- **Account Lookup gets the support tools in one place.** On the account: Send password reset email, **Show reset link** (a one-time link for 1 hour that staff copy and give to the person, so nobody has to wait for an email; finishing it also verifies the email; not offered for staff accounts), Sign out everywhere, Resend verification email, and Resend welcome beside a pending school or district admin assignment. A **Timeline** lists what has happened to the person, newest first.
- **Classroom lookup** by teacher email, classroom code or student username shows the students and who is locked out. Staff can **reset a student's PIN** (a new random 6-digit PIN, shown once) and **clear a lockout**. **Parent view** shows a parent's linked children and invitations, with Extend 14 days and Revoke.
- **Teachers can unlock their own students.** A student locked out by 5 wrong PINs shows a Locked tag on the teacher's classroom page with an Unlock button (it still clears by itself after 15 minutes).
- **Student names hide when the page sits idle.** On Account Lookup, student names are wiped from the page after 5 minutes without a mouse move, click or key press, with a "Show them again" button. The time is set in **Settings, Student Name Privacy** (1 to 120 minutes). Any future admin page that shows student names uses the same script (`admin-privacy-lock.js`).
- **Audited:** every classroom or parent lookup, PIN reset, lockout clear, reset link, sign-out, verification resend and invitation change writes an audit row by id (never a PIN, link or name). The existing "send password reset email" button now writes one too.
- **No database change.** Deploy: pull, rsync (Account Lookup, Settings, the teacher classroom page, `admin-privacy-lock.js`), restart Node.
- Requirements and access matrix: `docs/reference/support-console-requirements.md`.

## Release 120 — 2026-11-05 — The sign-in pages show the website logo too

- **Twelve pages that have no shared header now follow the Website Logo setting:** the admin, school administrator, district administrator, teacher, student and parent sign-in pages, plus password reset, the three invitation pages, Microsoft sign-in confirmation and Accept Quote. A new small script (`site-logo.js`) swaps the logo in; with no website logo set they keep the built-in one.
- **Size:** a custom logo is 128 px tall on these pages (was 72 to 88 px), kept at the left of the card as before (centered on the student sign-in).
- **Deploy order:** pull, rsync (the 12 pages and `site-logo.js`). No Node restart, no script.

## Release 119 — 2026-11-05 — The browser-tab icon and the admin sidebar follow the website logo

- **Tab icon.** Every page's browser-tab and home-screen icon now comes from the Website Logo setting (`/api/settings/favicon?size=16|32|48|180`: a square PNG of the trimmed logo on white). With no website logo set, the old built-in icon files are used, so nothing breaks. The page `<link>` tags on all 132 pages changed; the old `favicon.ico` link is gone (the file stays for old crawlers).
- **FNE admin sidebar.** Shows the Website Logo too, at 104 px tall (was 46 px), with the same built-in fallback.
- A tab icon is only 16 to 32 px, so only the scales emblem is legible there; the lettering is not. A simpler, emblem-only upload would read better.
- **Deploy order:** pull, rsync (all pages), restart Node. No script.

## Release 118 — 2026-11-05 — Support replies are read on the page, not emailed

- **Replies show on the Get help page.** Staff replies are no longer emailed. A signed-in person sees a **New reply** tag beside the request in Your requests until they open it.
- **People who were not signed in can still get their answer.** A new "Already sent a request?" box takes the reference (like SR-4F7K2) and the email used, shows the thread and lets them add to it. A wrong guess says only "couldn't find a request with that reference and email", never which half was wrong, and repeated misses are throttled per address and per reference.
- **The confirmation email stays** (it carries the reference and a link to the page); the page also shows the reference right after sending.
- **New requests are noticed even if email fails:** a count of new requests appears beside Support Inbox in the admin menu.
- **Deploy order matters:** pull, rsync, run `alter-add-support-seen-marker.js` (adds `support_requests.requester_seen_message_id`; the new routes read it), THEN restart Node.

## Release 117 — 2026-11-05 — A custom website logo is large enough to read

- **The header and footer logo is much bigger when a custom logo is set** (header 130 px tall, footer 130 px, down to 84 px on phones; was 100 px and 56 px). The built-in logo keeps its old size.
- **Blank margin is trimmed automatically.** A logo saved on a big white canvas (like the stacked scales mark) used to print its lettering about 10 px tall. The site now serves a trimmed copy (`site-logo-<name>.png` next to the original in uploads, capped at 480 px high); the original upload is never changed. No re-save needed.
- **Deploy order:** pull, rsync (all public pages), restart Node. No script.

## Release 116 — 2026-11-05 — The website logo is set from the admin settings page

- **New Website Logo card** on FNE Admin → Settings. Upload an image, or paste a file name or https address. Leave it empty and the site keeps the built-in Fixer Nation logo.
- **Header and footer follow it.** Every public page now reads the logo from that setting, so changing it no longer means editing 100+ pages. A change shows within about a minute.
- **Starts from the invoice logo.** A one-time script copies the current invoice branding logo into the new setting; after that the two are independent.
- **Safety:** only an FNE admin can change it; values that could run script (`javascript:`, `data:`) or break out of the page are refused.
- **Deploy order:** pull, rsync (all public pages plus `admin-settings.html`), run `copy-invoice-logo-to-website-logo.js`, restart Node. The login pages, student pages and emails still use their own logo; they are not part of the header and footer.

## Release 115 — 2026-11-05 — Support requests: one place to ask for help, and an inbox to answer from

- **New Get help page** (`support.html`, linked from the footer and the Contact page). Anyone can send a request: topic, subject, what is happening. Someone who is signed in does not retype who they are: their role (district administrator, school license administrator, teacher, parent) and school come from the account on the server, never from the form.
- **Students have no form, by design.** The page tells them to ask their teacher, who can already reset a PIN.
- **They can follow it.** A signed-in person sees their own requests, staff replies and status (Received, We're on it, Waiting for you, Resolved), and can add to a request. A reply from them reopens a resolved one.
- **New Support Inbox** (`admin-support.html`, under Schools & Partners). Filter by status and topic, search by name, email, school or reference, assign to an admin, reply by email (Reply-To is the support address), or leave an internal note that nobody outside staff ever sees. A "Look up this account" button opens Account Lookup for that email (Account Lookup now reads `?email=`).
- **Nothing is silent.** Staff get an email for every new request and every reply; the person gets a copy with a reference like SR-4F7K2. New setting "Support requests go to" in Settings (defaults to the general admin address).
- **Safety:** visitors are rate limited per IP and per email, with a hidden trap field for bots; a sales-demo account is refused; every status change, assignment and reply is written to the audit log by id only (no message text).
- **Deploy order:** pull, rsync (the new pages and every page whose footer/admin menu version changed), run `alter-create-support-requests.js`, restart Node.
- Requirements and access matrix: `docs/reference/support-requests-requirements.md`. Phases 2 to 4 (support console, lockouts, error capture, help centre) are still to come.

## Release 114 — 2026-11-05 — Deleting a CRM contact closes the person's account; reopen; email stays in step

- **Deleting a CRM contact closes its sign-in account.** The person is signed out everywhere at once and cannot sign in again (password, Microsoft or a reset link; the reset email is not even sent), their license seat goes back to the school's pool, their school and district administrator roles end, open invitations to them are revoked, and they leave Community. Posts and comments stay. If the account holds a seat or a role (or an affiliate account), the CRM first shows exactly what closing will take away and asks staff to confirm; a person with nothing attached closes straight away. A contact that owns purchases or invoices, and Fixer Nation staff accounts, are still refused.
- **Reopen:** Account Lookup shows a closed account with a **Reopen account** button. It restores the account only, not the seat, roles or Community groups (staff re-add those on purpose). If the person has no CRM contact one is created as Unsubscribed.
- **Email stays in step:** changing a contact's email in the CRM also changes the sign-in email on its account (and its seat and open invitations); it is refused if another account already uses the new address. This is what stops the CRM and the accounts drifting apart (the `ccherman@` / `cherman@` mix-up).
- **Deploy order matters:** pull, rsync (two pages), run `alter-add-account-closed.js`, then restart Node (the session checks read the new columns).
- Requirements and as-built notes: `docs/reference/crm-record-of-truth-requirements.md`.

## Release 113 — 2026-11-05 — Fixer Nation staff accounts can join and see every Community group

- **New staff marker for sign-in accounts:** `site_users.is_fne_staff`. An account marked as staff belongs to every school for Community purposes: it sees every group in Browse (private school groups and private custom groups too) and can join any of them, and the private-group cleanup never lists it as a stranger. It grants nothing else, and it is not the staff login. The flag can be set only from the server (`scripts/set-fne-staff-account.js`, dry run by default, an existing verified account only, audited); nothing on the website can set it.
- First account to mark: `johnfshaw@yahoo.com`.
- **Deploy order matters:** pull, run `alter-add-fne-staff-flag.js`, then restart Node (the Community queries read the new column), then mark the account.
- Requirements: rule A4 in `docs/reference/community-group-privacy-requirements.md`.

## Release 112 — 2026-11-05 — School groups in Community are private; who can delete groups

- **School groups are private.** Only the people of that school (a teacher with a seat there, its school license administrators, and the administrators of its district) see a school's group in Browse or can join it; to anyone else it does not exist. Before, every school's group was public, so any member could join and read another school's group. New school groups are created private, and the staff Public/Private switch is no longer offered for school groups or All Teachers. "My groups" now shows every group you are in, so a private group never disappears from its own members.
- **Who can delete:** FNE staff can delete any group; a district administrator can delete **the school groups of their own district only** (new "Community group" row on each school in the District portal's Schools page, with members and posts and a confirmation that says everything in it is erased). All Teachers is FNE staff only because every customer shares it. Another district's group, All Teachers and custom groups are not found, never "not allowed". Each district delete is written to the audit log. The staff page's delete confirmation now warns specifically about All Teachers and school groups. A deleted school group or All Teachers starts again, empty, the next time someone is added.
- **Cleanup for what's already there:** `alter-make-school-groups-private.js` makes the existing school groups private; `clean-school-group-members.js` (dry run first) removes people sitting in a school group of a school they don't belong to. Their posts stay.
- **Check without asking anyone:** `node scripts/check-school-group-access.js --school=onboces.org` (read-only) lists everyone who belongs to a school and, using the site's own rules, whether each can see the school's group (in My groups, or in Browse to join) or cannot use Community at all and why (no CRM contact, or no working license).
- Node restart, an rsync for two pages, and the two scripts. Requirements: `docs/reference/community-group-privacy-requirements.md`.

## Release 111 — 2026-11-05 — School license administrators and district administrators are in Community

- **Administrators can use Community.** Until now Community needed a registered teacher seat, and administrators hold none, so they could not open it and never appeared in the member list (Cheryl Herman, school license administrator and district administrator for Orleans-Niagara, was missing). A person now counts as a member if they hold a registered seat, **or** an active school license administrator assignment, **or** an active district administrator assignment (with a working license in the district), each on a license that is working now, and they have a CRM contact. Read Only administrators are included. The same rule drives the member list, group counts, direct messages and profiles.
- **Their school shows** beside their name, and on first opening Community an administrator joins All Teachers and their school's group (only that first time, so leaving a group sticks).
- Nothing changes for teachers. Administrators with an inactive assignment, or whose license has expired, stay out.
- Node restart needed; no rsync, no alter script.

## Release 110 — 2026-11-05 — Community now follows the CRM; a buyer's contact can no longer be deleted by accident

- **Community follows the CRM.** The member list, each group's member count, direct-message recipients, the conversation list and other members' profiles show only people who have a CRM contact (matched by email) and a license that is working right now (and are not sales-demo accounts). Community access itself also needs a CRM contact. Delete a contact and the person disappears from Community at once; before, the contact and the sign-in account were separate and the account (and its Community profile) stayed, which is why duplicate "John Shaw"s kept showing after their CRM contacts were removed. A contact that is Unsubscribed from email is still a member; unsubscribing only stops marketing mail.
- **Safety fix:** deleting a CRM contact that has purchases or invoices is now refused, with a message saying how many and to remove or cancel them first. Before, the delete silently erased those purchases and invoices, and with them every license seat on them. The CRM page now shows that message, and its confirmation says the person will leave Community.
- **New report:** `node scripts/report-accounts-vs-crm.js` (read-only) lists accounts with no CRM contact, everyone Community lists today and whether they stay, and names on more than one account. Run it before restarting the Node app after this release.
- Closing a person's whole account when their contact is deleted, reopening, and moving an account's email when a contact's email changes: built in Release 114. Requirements: `docs/reference/crm-record-of-truth-requirements.md`.
- Node restart and rsync needed (CRM page). No alter script.

## Release 109 — 2026-11-05 — A license you just bought now works if you already had an account

- **Fixed:** someone who already had a Fixer Nation account and then bought a trial or single license (signed in or not) paid, came back, and was still told Community needed an active license. The seat bought for their email was left "pending" and only brand-new accounts ever claimed it, so Community, lesson plans and everything else that checks for a license stayed shut. The seat is now claimed for the existing account as soon as the purchase is recorded, and also when they sign in. It also puts them in the Community groups, the CRM Teachers group and the Morning Boost recipient group, as a new account would be. Seats a school administrator invited someone to are never claimed this way; those still go through the invitation page.
- **Fixed:** the Community gate (and the profile page's gate) could show both the "Log In / Get a License" buttons and a second "Get a License" button at once, because the page checks access again once sign-in finishes and the first answer's buttons stayed on screen. It now shows only the right ones.
- **Cleanup tool:** `node scripts/claim-own-purchase-seats.js` lists (dry run) and with `--apply` claims any seats already stuck this way.
- Node restart and rsync needed (two pages). No alter script.

## Release 108 — 2026-11-05 — Morning Boost Recipients group for licensed educators

- **New managed group, "Morning Boost Recipients",** created automatically and switched on as one of the Morning Boost email's recipient groups (the email can have many; the others are untouched, and the on/off switch is not touched). It holds every teacher with a registered seat, every school license administrator and every district administrator who registered or was assigned on or after 15 October 2026 and whose license is open (paid, or purchase order received, and not expired). Anyone who has unsubscribed from Morning Boost, or whose CRM status is not Subscribed, is still never emailed. Sales-demo accounts and test or demo addresses (anything at `example.com` or the QA inbox domain) are excluded.
- **Automatic:** a person joins right after a teacher accepts an invitation, an administrator is assigned, or an administrator sets their password; the nightly license-expiry job then adds anyone missed and **removes everyone whose license has ended** (expired, cancelled, suspended, seat revoked, assignment deactivated). Someone with two licenses stays until both end; a renewal brings them back. Because the group is managed, anyone staff add to it by hand who does not qualify is removed at the next run; use another group for hand-picked recipients.
- **Retroactive:** `node scripts/sync-morning-boost-group.js` shows what it would do (a dry run); `--apply` does it. The first Morning Boost send afterwards goes to everyone it added.
- Requirements: `docs/reference/morning-boost-recipient-group-requirements.md`. Node restart needed; no alter script.

## Release 107 — 2026-11-05 — District admins now show in school admin lists, and admins show Registered or Pending

- **District admins who also hold a school license admin assignment are no longer hidden.** The FNE School Admins page, the concierge page's School License Administrator step, the district admin's own school list and a school admin's co-administrator list now all name them, tagged "District Admin". Before, the School Admins page left them out, so it disagreed with the concierge page (Orleans-Niagara: Cheryl Herman). The district dashboard's admin count now matches the names shown. Seat counts are unchanged: administrators still do not use up a license seat.
- **Registration status for administrators reads like the teacher roster.** On the concierge page (both the school and district admin steps), the School Admins page and the District page, each administrator shows a green "Registered" once they have set up their account, or a "Pending" tag with "Resend welcome" until they do. (Replaces the old "Unverified" tag, which had lost its colour.) The customer portals keep their "Pending Setup" wording.
- Node restart needed. No alter script.

## Release 106 — 2026-11-05 — Nightly backup of the database and uploaded files

- **New nightly backup** (`server/scripts/backup-nightly.js`, cPanel cron at 2:30 AM). It dumps the database to a compressed file and checks the file is complete before keeping it, and it mirrors the uploads folder (PDFs, images, social files) to a private folder outside `public_html`. Keeps 7 days of database dumps. Any file that is changed or deleted is kept 14 days before it is cleaned up, so an accidental delete can be undone.
- **Not included:** the lesson videos (`.mp4`, about 7.7 GB). They never change once uploaded and would not fit in the plan's disk space; the original exports are the backup. The backup sits on the same server, so it does not protect against losing the server itself; an encrypted offsite copy is the next step.
- If a night fails, the script writes `last-failure.json`, emails the alert address, and leaves the last good backup alone. `last-success.json` shows when the last good run finished and how big the uploads folder is (watch it against the 15 GB plan).
- Server-only change: new script and helper, a cron line, no database change, no `npm install`, no Node restart (a cron script is not part of the running app).

## Release 106 — 2026-11-05 — The CRM now says why a contact's email won't save

- **Fixed:** changing a CRM contact's email to an address another contact already has failed with only "Could not save contact". It now says which contact has it (for example "cherman@onboces.org already belongs to Cheryl Herman (contact #2165)") and suggests editing or deleting that one instead. Nothing is saved when this happens, and normal edits are unchanged.
- **Also added:** `server/scripts/report-email-everywhere.js`, a read-only report of everywhere an address appears (sign-in accounts, CRM, school and district admin assignments, seats, invitations, quotes) and of the administrators on a license as the concierge page and the School Admins page each list them. Used to trace the Orleans-Niagara typo (`ccherman@`), which came from a mistyped school admin assignment that left a stray account and contact behind. The School Admins page leaves out anyone who is also a district admin; that is intended.
- Node restart needed. No alter script.

## Release 105 — 2026-11-05 — Teachers at purchase-order schools can accept their invitations

- **Fixed:** a school paying by purchase order could send invitations once staff marked the PO received, but every teacher who clicked the link was told "your school's group license is pending payment". The four steps a teacher goes through to accept (open the link, create an account, sign in to claim, and the automatic claim at sign-up) still asked only whether the invoice was paid. They now use the same rule as sending invitations: paid, or a purchase order that has been received (`lib/license-access.js`). A PO that has not arrived, and a card purchase that has not paid, are still refused.
- **Wording:** the notice on the invitation page now says the license "isn't active yet" and opens when the purchase order or payment is received, instead of blaming payment.
- Found on Orleans-Niagara Teacher Center (#307785). No database change. Node restart needed.

## Release 104 — 2026-11-05 — Fonts and the PDF viewer now come from our own server

- **Student pages no longer contact Google or Cloudflare.** All 125 pages that loaded Google Fonts now load one local `fonts.css` (Fraunces, Plus Jakarta Sans and Inter, all open-license, in `assets/fonts/`). A student's browser used to send its IP address to Google on every page load; it no longer does.
- **PDF viewer self-hosted.** `pdf-modal.js` now loads PDF.js 3.11.174 from `vendor/pdfjs/` instead of cdnjs (lesson pages for teachers, parents and students). `pdf-modal.js?v=2` on its four pages.
- The Content-Security-Policy (report-only) no longer lists Google for styles or fonts. A new test (`server/test/self-hosted-assets.test.js`) fails if any page points back at Google Fonts or cdnjs.
- Look and feel unchanged: same typefaces, same weights. Still contacted from a page only when a visitor asks: Cloudinary (how-to videos on play), YouTube/Vimeo (parent lesson and community embeds), Unsplash (public marketing photos).
- Static files only. No Node restart, no alter script, no `npm install`.

## Release 103 — 2026-11-03 — "Build your lesson plan library" video now shows swaps and the level warning

- **T7 re-recorded and republished, about three minutes.** It now shows the one-time "Choose your grade levels" step, the "Curriculum level mismatch" popup (and Cancel), a real swap (Swap or remove, Replace with another lesson, Swap in, Swap), a removal, the swaps-left count going down, and the message a teacher sees when no swaps are left. The earlier version only mentioned swaps.
- The help video list says the same in its short description. No separate "Swap or remove" video is planned; this one covers it.
- Static files only (the video is on Cloudinary; captions and poster in `help-assets/`). `help-videos.js?v=14` on every page that loads it. No Node restart, no alter script.

## Release 102 — 2026-11-03 — Community how-to videos, and two fixes they uncovered

- **Fix: an apostrophe in a community post showed as "Today&" followed by a highlighted "#39" and ";s".** The page turns an apostrophe into a code (`&#39;`) before it looks for hashtags, and it mistook the "39" in that code for a hashtag. Posts with an apostrophe (every "Today's", "Here's" and "don't") now read normally, and real hashtags still highlight. A `#` inside a web address is no longer treated as a hashtag either.
- **Fix: "Profile saved!" never appeared** after saving a community profile (the save worked; the message stayed hidden by the page's own style). It now shows for three seconds.
- **Four new how-to videos for the community**, under Teachers on the Help Videos page and as a "How-to video" button on the community pages: "Find and join your community groups" (M1), "Post, reply and react" (M2), "Message a colleague privately" (M3) and "Your community profile" (M4). Each is one to a minute and a half. Planned later: a staff video on moderating the community, once the admin page can remove comments.
- Static files only (`social.html`, `social-profile.html`, `help-videos.js`, the video captions and posters). New checks in `server/test/social-render.test.js`. `help-videos.js?v=13` on every page that loads it. No Node restart, no alter script.

## Release 101 — 2026-11-03 — Nine more northeast states researched (drafts, hidden until verified)

- **ME, NH, VT, RI, CT, MA, NJ, DE and MD are researched and loaded as drafts** (`server/data/standards/<ST>.json`), with the framework, official source link, date checked and, where a state has a framework, its standards and Fixer Nation's connections to them. Seven have connections (ME, VT, RI, CT, MA, NJ, DE: 14 to 54 each, 243 in all). NH and MD have no framework to connect to yet (coverage only).
- **Nothing is public.** Every record stays hidden until an FNE admin reviews and verifies it on the Standards Crosswalk page. The public page and the one-page summary only ever show verified records.
- **Checked by script:** every lesson title, brain game and Morning Boost theme used in a connection exists in Fixer Nation's real catalog, and all 314 phrases quoted from Fixer Nation's own lesson objectives, game descriptions and program text appear word for word in them.
- **Things the reviewer must settle before verifying** are written into each file's notes: Maine's Guiding Principles stand in as its statewide graduate profile; Vermont, New Jersey and Connecticut have no official item codes, so their codes are Fixer Nation labels; Delaware's link is a CASEL-hosted mirror; Maryland's state pages blocked reading, so it is recorded as unknown; and Massachusetts has no adopted SEL standards (its Vision of a Graduate is in progress).
- Data files only. Loading them is `node scripts/import-standards.js ME NH VT RI CT MA NJ DE MD` on the server; no Node restart and no alter script.

## Release 100 — 2026-11-03 — "State Standards" becomes "SEL & Portrait of a Graduate"

- **The menu and footer link now say "SEL & Portrait of a Graduate"** instead of "State Standards" (desktop menu, mobile menu and footer), because SEL and Portrait of a Graduate (PoG) are the terms districts actually use. The page still talks about state standards: its title is "SEL Standards & Portrait of a Graduate by State", its description says "your state's SEL (social-emotional learning) standards and Portrait of a Graduate", and the headline is unchanged.
- **Page copy:** the top label reads "SEL & Portrait of a Graduate", and the opening paragraph now says SEL and PoG are the terms states and districts use for this work. The Research page promo reads "New: SEL & Portrait of a Graduate by state", the printable one-page summary is titled "SEL & Portrait of a Graduate one-page summary", and the help video list title for E1 matches.
- **Unchanged on purpose:** the "Please read" note still says this is Fixer Nation's own mapping and that no state agency or CASEL has reviewed, endorsed or certified it. The new wording says SEL and PoG are recognized terms, not that anyone has approved our mapping. The admin page is still called "Standards Crosswalk".
- Static files only. `nav.js?v=17`, `footer.js?v=10` and `help-videos.js?v=12` on every page that loads them. No Node restart, no alter script.

## Release 99 — 2026-11-03 — Add-On Seats quote email reads cleanly

- **The email for a quote built on the Add-On Seats tab is now one row.** It used to read "5 Add-On Seats (Department) (5 seats)" followed by "+ 5 added seats, included". It now reads just "5 Add-On Seats (Department)" with the total below. Quotes for annual plans (tier seats plus free added seats) and quotes with no added seats are unchanged.
- Server code changed (Node restart needed); no alter script.

## Release 98 — 2026-11-03 — Concierge steps reordered, and what is required is clear

- **New order on the Concierge Setup page:** 1 Accept the quote, 2 District Administrator, 3 School License Administrator, 4 Invite teachers, 5 District Branding.
- **District Administrator is marked "(required)"** (it used to say optional and "only if this contact oversees more than one school"). Until one is assigned, a line under the quote summary says "Still needed: a District Administrator"; once there is one it says the required setup is done. The page doesn't lock the other steps.
- **School License Administrator, Invite teachers and District Branding are all marked "(optional)".** The buyer is still added as the primary School License Administrator automatically when they already have an account.
- Page only (`admin-concierge.html`); no Node restart, no alter script.

## Release 97 — 2026-11-03 — Invoice Bill To and Ship To

- **Staff can change an invoice's Bill To.** On the Invoices page, the new 📍 button opens Bill To (name, company, email, address) and Ship To for that invoice. Saving changes that invoice only: the CRM contact and the buyer's other invoices stay as they were. Paid and cancelled invoices can be corrected too, and every edit is recorded with the old and new values.
- **Ship To is new.** The printed invoice and the invoice email show a Ship To block next to Bill To when one is filled in ("Same as Bill To" copies it across). The quote builder has Bill To address and Ship To fields (on the quote email too), and the CRM contact form has an optional Ship To address. A new invoice copies its Bill To and Ship To from its quote, or from the contact for a cart order, so a later contact edit doesn't rewrite it. The Licenses page and the contact's purchases show the invoice number and Ship To with a link to the editor.
- **Older invoices are untouched.** They keep reading Bill To from the contact until someone edits them.
- **Fix: lowering Additional Seats back to 0 on a quote now saves.** It used to keep the old number (Release 95 follow-up). The Invoices page also now escapes the buyer's name, company and email.
- **Needs a one-off script and a Node restart:** `node scripts/alter-add-bill-ship-to.js` (safe to run twice) adds the columns; run it before the restart. Rules: `docs/reference/invoice-bill-ship-to-requirements.md`. 318 server tests pass (19 new).

## Release 96 — 2026-11-03 — Five help videos re-recorded and republished

- **Re-recorded to match the new screens:** "Invite a teacher" (B2) and "Invite many teachers with a CSV" (B3) now show the grade-level checkboxes and the ES;MS rule; "Why can't I invite teachers yet?" (B10) fills in the new form; "Register with your school email" (T2) says the grade-level step is required; "Build your lesson plan library" (T7) now covers swaps and the new popups instead of saying picks are permanent.
- Static files only (the videos are on Cloudinary; captions and posters are in `help-assets/`). `help-videos.js` is now `?v=11` on every page that loads it. No Node restart, no alter script.

## Release 95 — 2026-11-03 — Added seats on an annual quote are free, and now reach the license

- **"Additional Seats" on the Annual tab of the quote builder no longer adds $50 a seat.** The box now shows for every annual tier (it used to appear only for tiers with an Add-On Rate) and says "no extra charge". The price stays the tier price, or the dollar amount you type. The Add-On Seats tab still sells seats alone at the product's Add-On Rate.
- **Fix: added seats now reach the license.** Before, a quote of 15 seats plus 2 added said "+2 added seats, included", but the license the customer accepted had 15. The quote now saves 17 seats, so the acceptance page, the license and the invoice seat count all say 17.
- **Fix: reopening a saved quote** puts the Additional Seats box back and no longer folds old add-on money into the base price, so saving again can't drop the added seats.
- **The quote email** lists the tier's seats, then "+ 2 added seats: no extra charge".
- **Quotes you already sent or accepted keep their saved numbers.** To see which accepted quotes came up short, run `node scripts/report-quote-added-seats.js` (read-only, changes nothing); fix any short license with the seat-count editor on the Licenses page.
- Server code changed (Node restart needed); no alter script. New shared file `quote-seats.js`. Rules: `docs/reference/quote-added-seats-requirements.md`. 299 server tests pass (9 new). No help video shows this screen.

## Release 94 — 2026-11-03 — Level warning, and swaps in My Lesson Plans

- **A "Curriculum level mismatch" warning.** When a teacher adds a lesson that is written for a different level than the one on their account (for example an MS lesson for an ES teacher), a popup says so and asks Add anyway or Cancel. A lesson that shares any level with the teacher, or has no level, adds as before.
- **Teachers can now take a lesson out of My Lesson Plans.** Each lesson card has "Swap or remove". Removing a lesson, or replacing it with another in one step, uses one swap. A teacher's swaps are counted in a badge ("2 swaps left") on both library pages, and lessons already assigned to a class stay assigned.
- **The swap limit is a setting.** "Swaps per Teacher (limit)" sits on the Teacher Lesson Plan Library card in Settings, next to the two plan limits. Default 3, 0 turns removal off, same number for trial and paid teachers. Staff can give one teacher their swaps back from the Library button on the Licenses page (the earlier swaps stay in the history).
- **Every teacher has a grade level before they change their library.** A teacher with none (for example one invited or registered before Release 93) is asked to choose their levels first, once.
- The wording that said picks were permanent is gone from the library pages, My Licenses, Settings, the Licenses page and the help-video list. New shared file `lesson-library-ui.js`; `help-videos.js` is now `?v=10` on every page that loads it.
- **Needs a one-off script and a Node restart:** `node scripts/alter-add-teacher-lesson-plan-swaps.js` (safe to run twice) creates the swap history table; run it before the restart. Help video T7 needs re-recording (its narration said picks were permanent).
- Requirements and access rules: `docs/reference/lesson-plan-swaps-requirements.md`. 290 server tests pass (31 new).

## Release 93 — 2026-11-03 — Grade levels on teacher invitations, and in the CRM

- **Inviting a teacher now means choosing their grade levels.** The free-text "Grade Level" box on the invite form is replaced by ES, MS, HS and HE checkboxes (one or more, at least one required). The concierge page has the same checkboxes on each teacher row. In a bulk CSV, the `grade_level` column takes ES, MS, HS or HE, and a semicolon between several (for example `ES;MS`); a row without one is reported as not sent.
- **The levels follow the teacher.** When a teacher accepts, by any of the sign-in routes, the levels from the invitation are added to the ones they already have (nothing they chose themselves is removed).
- **Every accepted teacher is now in the CRM and the Teachers group.** Before, only teachers who created their account from the invitation page were added. An existing CRM contact keeps its status and source.
- **The CRM contact list has a new "Grade Levels" column** (ES, MS, HS, HE tags; sortable; included in the CSV export). It appears once for staff who had saved their own column choices.
- **Teachers who register with their school email can no longer skip the grade-level question**, and the server refuses an empty list.
- Older invitations keep their free-text grade level. New ones also fill that old field with a short summary such as "ES, MS", so exports and reports keep showing something.
- **Needs a one-off script and a Node restart:** `node scripts/alter-add-invitation-audiences.js` (safe to run twice) adds the column; run it before the restart. Help videos B2, B3, B10 and T2 need re-recording (their steps changed).

## Release 92 — 2026-11-03 — Teachers see the whole lesson library on the main site

- **Fix: a licensed teacher who had saved lessons to My Lesson Plans saw only those lessons on the main lesson page.** The page said "growing library" but showed just the teacher's own picks. The lesson page now always lists every published lesson, as it does for everyone else. What a teacher can open and download is unchanged.
- **The classroom Assign Lesson box still shows only the teacher's saved lessons** (when they have any), as before.
- Server code changed (Node restart needed); no alter script. New checks in `server/test/curriculum-list.test.js`. Help videos T3, T4 and T6 checked and still correct.

## Release 91 — 2026-11-02 — Favorites on the Morning Boost page

- **Readers can star Morning Boost posts and come back to them.** A star on the featured post, on each card and inside the open post saves it to the reader's account, so favorites follow them to any phone or computer. A filter above the list switches between "All posts" and "Favorites (N)"; the count only counts saved posts that are live now. Un-starring in the Favorites view offers Undo.
- **Signing in is needed to save.** A signed-out visitor who taps a star sees the sign-in box; the post they tapped is saved as soon as they sign in. Locked posts can't be saved (they still show their license button), and nobody can see anyone else's favorites.
- **The Morning Boost email link now opens its post** (it used to land on the list and ignore the post), and a "My Favorites" link joins the signed-in menu.
- Built so any future blog category page can use the same script. Up to 500 favorites per person.
- **Needs a one-off script and a Node restart:** `node scripts/alter-add-blog-post-favorites.js` (safe to run twice) creates the table; the restart loads the new route. The shared sign-in script has a new version number on all 71 public pages.
- Requirements, access rules and checks: `docs/reference/blog-favorites-requirements.md`.

## Release 90 — 2026-11-02 — Renewing a school license brings its teachers back

- **When a school's license expires, every teacher's seat is switched off. Renewing the license now switches them back on.** Before, staff renewed the license but each teacher stayed locked out until the school administrator reactivated them one by one on the roster page. Classrooms, rosters, assigned lessons and each teacher's lesson picks were never deleted, so teachers pick up where they left off (after signing in again).
- **Only seats the expiry switched off come back.** A teacher a school administrator deactivated by hand stays deactivated. Unaccepted invitations come back as invitations; unclaimed seats come back as open seats.
- Staff see how many seats came back in the confirmation message on the Licenses page, and the school's activity log records it.
- The same applies when staff extend an expired free trial.
- Licenses that already expired before this release carry no record of why their seats are off, so their school administrators still use **Reactivate** on the roster after a renewal. The database script prints how many seats that affects.
- Needs the one-time database script `alter-add-seat-inactive-reason.js` (run before restarting the Node app), a Node restart, and `admin-licenses.html` copied to the site. New tests in `server/test/seat-renewal.test.js`.

## Release 89 — 2026-11-02 — Final polish for the older games, and a clearer games page

- **Each Challenge and Advance game now has its own header line** instead of sharing one template, and a handful of lines were tidied: dashes written as spaced hyphens, a few "Good catch." and "Right." openers, and soothing "that is normal" lines (the money games now give numbers). Decision Point's longest feedback line was cut to a third of its length; Values Compass sounds like a game for 11 to 13 year olds; three Money Moves events now use older items (a phone case, headphones, old clothes and games) with the same numbers.
- **Challenge and Advance show a step count** ("Step 2 of 5", and a quiet "2 / 5" in Advance), as Explore does.
- **The six older games** (Memory Match, Simon Sequence, Number Sequence, Quick Math, Reaction Time, Stroop Challenge) got plainer result lines ("Not that one. You reached round 5.", "Top tier / Solid / Average") and now have a grade band, so they are tagged, filtered and sorted with the rest. They keep their own look. **A class now sees them by default only for the matching grade band** (a teacher can still tick "Show games for all grade bands").
- **The games page shows each group's color** on a stripe and a tag, and all 25 card descriptions lost internal wording ("A Tune Your Brain pilot experience (Phase 5)"). Needs a one-off script: `node scripts/update-brain-game-copy.js` (safe to run twice).
- Static files plus that one script. No Node restart, no schema change.

## Release 88 — 2026-11-02 — The Explore games are shorter and easier to scan for ages 7 to 10

- **Choice Quest, Team Pick, Peace Table and Fix-It Workshop rewritten shorter.** Answer choices went from about 16 words to about 11, feedback from about 19 to about 13, and the hardest story setups (Fix-It Workshop) from up to 39 words to 22 or fewer. The stories, the best answers and the feedback types are the same. Thinking words like "constructive" and "overwhelmed" are gone; feeling words stay.
- **Reading Detective and Strength Spotter trimmed** (shorter explanations and stories).
- **A right answer with weaker proof now shows amber, not red** (Explore, Challenge and Advance), so it no longer looks like a wrong answer.
- **Explore shows a step count** ("Step 2 of 5", "Question 1 of 4") and ends with "Steps finished" and "Smart choices".
- A checker (`server/scripts/explore-limits.js`) and a new test hold all six games to the limits.
- Static files only (the games, five engine scripts, `game-shell.js`, `brain-games.css`, cache numbers). No Node restart, no database change.

## Release 87 — 2026-11-02 — The six Discover games now talk to children aged 5 to 6

- **The games now ask the question out loud.** Before, a child heard the story and was never asked anything, and the answers were bare pictures with no spoken meaning. Now the story, the question and each answer are read aloud, and replay plays all of it.
- **Every result is spoken** ("You got it!" or "Try another one."), including in Calm Down Corner, Sharing Circle, Helper's Choice and Sound Safari, where it used to be silent.
- **Short captions under the pictures** for children who are starting to read, and a **"Show the words" button** so deaf and hard-of-hearing children, and adults helping, can see the story.
- **All six games rewritten in shorter, plainer words** (about 8 words a sentence; "mad" instead of "frustrated", "the right thing" instead of "responsible"). Feelings Detective gets pictures on its clues and feelings and larger rows; its private check-in is still never logged or saved.
- **Sound Safari no longer repeats the answer as its example** (it said "like in turtle", then the turtle was the answer). Its spoken line also no longer includes "/m/" symbols.
- A stand-in test now runs every game engine's first screen, and a new test holds the Discover games to the word limits.
- Static files only (two engine scripts, the shared script, `brain-games.css`, six game pages, cache numbers). No Node restart, no database change. The browser voice still needs a listening check on a Chromebook and an iPad.

## Release 86 — 2026-11-02 — Wording around the games now fits each age group

- **The words around a game now change with the age group.** The finished screen, the feedback in reading games, and the step names in scenario games were the same for a first grader and a high schooler ("Nice work!", "Recognize the Issue"). Each group now has its own: for example "You did it!" for Discover, "Level complete!" for Explore, "Run complete" for Challenge and "Debrief" for Advance.
- **The two money games stop saying "correct" after every choice.** Older players now see a plain "Noted. Next decision." instead of a green success box, even after a poor pick.
- **Story text now shows on screen** in Strength Spotter and Values Compass for Explore and older (it was only read aloud before). Discover stays audio-led.
- **Idea Lab, Community Voice, Perspective Swap and Fix-It Workshop have their own step names** that fit how those games work.
- The reflection box no longer says "this demo" to screen readers.
- A game can still set its own wording, and a page without an age group keeps the old wording exactly. A new test (`server/test/band-copy.test.js`) guards both.
- Static files only (engine scripts, `brain-games.css`, cache numbers on the game pages). No Node restart, no database change.

## Release 85 — 2026-11-02 — Each age group's games now have their own colors

- **Four color themes for the brain games, one per learning group.** Discover has a warm page, thick dark outlines and a yellow button; Explore uses purple for "selected" and orange for the next step; Challenge is cool slate with blue and violet accents; Advance is a dark slate band with one cool accent. Before this, every game from Explore to Advance looked the same.
- **The band behind each game fills the page width** (between the site header and footer, which keep their look).
- **After you answer, the options you did not pick grey out** so the right and wrong ones stand out; their text stays readable.
- Every color pair is checked for contrast by a new test (`server/test/band-themes.test.js`). The six older games and the games page are unchanged.
- Static files only (`brain-games.css`, one line in `engine-branching-scenario.js`, cache numbers on the game pages). No Node restart, no database change.
- Audit behind it: `docs/tune-your-brain/GAME_LANGUAGE_COLOR_AUDIT.md` (wording changes follow in Releases 86 to 89).

## Release 84 — 2026-11-01 — Games page sorted by grade band, with a "New" tag

- **The games page now groups games by grade band** (Discover, then Explore, Challenge and Advance), with the older skills games at the end, instead of listing them in the order they were added. New games used to sit at the bottom of a long list.
- **Each card shows its grade band** (for example "Explore (3-5)") next to the "SEL & Character" or "Skills practice" tag.
- **A gold "New" tag** marks games added in the last 30 days, so teachers can spot what changed.
- The catalog now sends each game's date added to the page (one line in `routes/brain-games.js`), so it needs a Node restart. No database change.

## Release 83 — 2026-11-01 — Three more new brain games: Values Compass, Peace Table and Idea Lab

- **New game: Values Compass** (grades 6 to 8). The student reads a short story, notices what really happens, and picks every value that could fit (nothing is scored, and no value is ranked). A private check about their own values follows and is never saved or sent. 12 stories, 5 per run. A second direct game for New York SEL 1B (identity and agency).
- **New game: Peace Table** (grades 3 to 5). Two kids disagree, and the student works through saying what happened, listening, finding a fair plan and trying it. Four situations, one per run: a shared turn, a broken borrowed thing, a hurtful misunderstanding, and an argument about a call. A second direct game for SEL 2D (resolving conflict) and the first below grade 6.
- **New game: Idea Lab** (grades 9 to 12). The student finds the real need, weighs three workable ideas (none is called best), and tests one small. Four situations, one per run: peer tutoring, snack-sale waste, announcements that reach everyone, and a garden fundraiser. A second direct game for the Creative Innovator attribute.
- **All three appear in the games catalog and classroom assignments** once their catalog entries are added (three small scripts), and each earns a classroom completion badge (True North, Peacemaker, Bright Idea).
- Pages, seed scripts and tests only; no server route changes and no engine changes.


## Release 82 — 2026-11-01 — Money Matters and Money Moves are now listed as SEL & Character games

- **The two money games now carry the "SEL & Character" tag and filter** in the games catalog, instead of "Wellness & Life Skills". They practise setting a goal, making a plan and weighing tradeoffs, which are social-emotional skills, so the catalog now matches the standards mapping.
- **Competencies added:** self-management and responsible decision-making.
- Catalog data only (one existing script re-run); no page or server code changes.

## Release 81 — 2026-11-01 — Two more new brain games: Perspective Swap and Community Voice

- **New game: Perspective Swap** (grades 9 to 12). A group plan works for most people and not for one teammate. The student sees each side, then chooses how the group can adjust. Four situations, one per run: a deadline on a day that matters to a teammate's family, a fast discussion and a teammate who waits for a pause, a dinner some cannot afford, and a video with no captions. A second direct game for New York SEL 2B and 2C.
- **New game: Community Voice** (grades 9 to 12). The student listens to who is affected, checks the facts, plans a respectful ask, and handles a "no." Four situations, one per run: a later activity bus, a quiet study space, fresh cafeteria options, and a crosswalk near the school. A second direct game for SEL 3C and for the Effective Communicator attribute. Non-partisan; no party, candidate or real organization.
- **Both appear in the games catalog and classroom assignments** once their catalog entries are added (two small scripts), and each earns a classroom completion badge (Open Minded, Voice for Change).
- Pages, seed scripts and tests only; no server route changes and no engine changes.


## Release 80 — 2026-11-01 — Games catalog shows which games are SEL and which are skills practice

- **Each game card now says what kind of game it is.** "SEL & Character" for the social-emotional games, "Skills practice" for the reading, math and thinking-skills games (including the six older games: Memory Match, Simon Sequence, Number Sequence, Quick Math, Reaction Time and Stroop Challenge), and "Wellness & Life Skills" when a wellness game is added.
- **Why it matters:** teachers and districts looking for social-emotional learning can see at a glance which games are meant for it. Skills practice games are not counted toward SEL or Portrait of a Graduate coverage.
- Page only; no server changes. The games themselves are unchanged.

## Release 79 — 2026-11-01 — First Shift rewritten with four first-job situations

- **First Shift now has four situations instead of one.** The original (a coworker breaks equipment and asks you to cover) stays, now rebalanced. New: a shift you promised to two people, a rude customer and a new coworker, and pay in cash with no paperwork. One story per run.
- **The first job gets real variety.** It is the only game in the Advance band about work, so students no longer see the same scene on every play.
- **Better wrong answers.** Steps 1 to 3 now offer three options instead of two, each believable but incomplete, and option lengths are balanced so the careful answer is no longer the longest.
- Page and tests only; no server or engine changes.

## Release 78 — 2026-11-01 — The Post rewritten with four new situations

- **The Post now has four situations instead of one.** A rumor about a teacher on a public account, a group project partner and an AI tool, a giveaway that asks for your login, and a tagged photo that affects your digital footprint. One story per run.
- **No more repeat of the group-chat story.** The old situation (reposting an embarrassing video) overlapped with Decision Point and Group Chat Meltdown, so older students met the same scene twice.
- **Better wrong answers.** Steps 1 to 3 now offer three options instead of two, each believable but incomplete, and option lengths are balanced so the careful answer is no longer the longest.
- Page and tests only; no server or engine changes.

## Release 77 — 2026-11-01 — Critical Read rewritten

- **Critical Read has a pool of 12 passages** (6 drawn per run, conclusions shuffled), each with a source, a claim and a gap, replacing four short ones. The right conclusion is sometimes firm, sometimes plain, sometimes hedged, and the proving sentence moves across the first four positions, so picking the longest or the most careful answer no longer works.
- **Twelve reading skills**, one per passage: who paid for a study, correlation and cause, sample size, counts and percents, a headline against its quote, selection effects, averages, an expert outside the field, a missing denominator, independent testing, a time frame, and "no evidence of harm" versus "evidence of no harm".
- Page and tests only; no server or engine changes.

## Release 76 — 2026-11-01 — Money Matters reworked

- **Money Matters now has real money math.** A pool of 14 events for a young adult in a first apartment, 7 drawn per run, so no two plays match. The numbers can all be worked out: pay after withholding, a card at 24 percent a year, what a minimum payment really does, a better savings rate, insurance deductibles, a phone switching fee.
- **Three counters instead of made-up points.** Checking, Savings and Card Debt replace the old "Credit Score" number, which moved by arbitrary amounts.
- **A real limit, and a way out.** A choice Jordan can't afford shows greyed out, and every event keeps one choice that needs no money, so nobody gets stuck.
- **Five kind endings** that use all three counters. None treats a lower balance as a failure.
- Page and tests only; no server or engine changes.

## Release 75 — 2026-11-01 — Two more new brain games: Strength Spotter and Same and Different

- **New game: Strength Spotter** (grades 3 to 5). The child reads a short story, notices what really happens, then picks every strength that could fit (nothing is scored). A private check about their own strengths follows each story and is never saved or sent. 12 stories, 5 per run. It is the first game for New York SEL 1B (identity and agency).
- **New game: Same and Different** (grades K to 2). A scene is read aloud and the child taps a picture: what is the same, what is different, or the kind choice. Every choice has a spoken line that explains it. 12 rounds, 4 per run. It is the first game for SEL 2B (similarities and differences).
- **Small engine change:** the story-and-strengths engine now accepts its own wording for prompts. Feelings Detective is unchanged.
- **Both appear in the games catalog and classroom assignments** once their catalog entries are added (two small scripts), and each earns a classroom completion badge (Strength Finder, Curious Friend).
- Pages, seed scripts and tests only; no server route changes.

## Release 74 — 2026-11-01 — Headline rewritten, and two new brain games

- **Headline has a pool of 12 news snippets with numbers** (6 drawn per run, headlines shuffled). The right headline is sometimes bold, sometimes plain, sometimes hedged, and the sentence that proves it moves between the first, second and third sentence, so picking the "careful one" no longer works.
- **New game: Say It Another Way** (grades 6 to 8). The child reads a situation, picks the message the person would hear best, then finds the sentence that shows what that person needs. 12 situations, 6 per run. It is the first game that practises how to say something (New York SEL 2C and the Effective Communicator attribute).
- **New game: Fix-It Workshop** (grades 3 to 5). Four school problems (a long lunch line, a quiet playground corner, a lost-and-found, new students finding their way), one per run, played as a design cycle: listen, name the real problem, brainstorm, try a small test, private reflection. No single "best" idea. It is the first game aimed at Creative Innovator and SEL 3C (acting for school and community well-being).
- **Both new games appear in the games catalog and in classroom assignments** once their catalog entries are added (two small scripts), and each earns a classroom completion badge (Clear Communicator, Idea Builder).
- Pages, seed scripts and tests only; no server route changes.

## Release 73 — 2026-11-01 — Help video B10 re-recorded for the purchase-order rule

- **B10 now explains that a purchase-order school can invite teachers as soon as the PO is marked received**, matching Release 70. The old video said payment was needed first.

## Release 72 — 2026-11-01 — Money Moves reworked

- **Money Moves is a different game each run.** A pool of 14 events with 6 drawn per run, so no two plays match. The math is real: discounts, sales tax, a savings match and a loan with 10 percent extra to pay back.
- **Needs versus wants, with a real limit.** A choice you can't afford shows greyed out with a note about what is short, and every event keeps one choice that costs nothing, so nobody gets stuck.
- **Five kind endings** that use both counters (Savings and Spending Money), so the ending reflects how the child balanced them.

## Release 71 — 2026-11-01 — District dashboard, rewritten first stories, and a clearer count in scenario games

- **District administrators now land on a real dashboard.** It shows schools, seats in use, active teachers and school administrators, plus a "needs your attention" list (a purchase order not yet received, a license ending within 90 days, a school with no administrator, few seats in use 60 days after a start, a school nearly full), a table of schools, and a Portrait of a Graduate summary. Counts only: no teacher names or student data. Seat counts for a district's schools now come from one batch query that matches the single-school rule.
- **Help video C1 (tour of the District Admin portal) re-recorded and published** to match the new dashboard.
- **Choice Quest and Team Pick: the first story in each game rewritten.** Three believable options in the first three steps and options of similar length, so the right answer is no longer the longest. "Picked last" now happens at recess rather than in gym class, because physical-education guidance discourages picking teams in front of a class.
- **Decision Point:** asking Sam directly is now the best answer; adding Sam to the chat yourself is "also good", and its feedback names the risk.
- **Scenario games** now say "Choices that helped" at the end instead of "Responsible choices".

## Release 70 — 2026-11-01 — Purchase-order schools can invite teachers once the PO arrives

- **Purchase-order schools no longer wait for payment to invite teachers.** Before, staff had to click both PO Received and Mark as Paid, and payment often arrives weeks after the order. Now PO Received alone opens invitations and teacher registration. Mark as Paid still records the payment, the affiliate commission and the receipt email. Card purchases still need payment, and nothing that was open before closes.
- **The banner on five school-admin pages now says what is actually wrong.** A PO that has not arrived shows "Waiting for your purchase order"; an unpaid card purchase keeps "License payment pending".
- **Fix: a teacher at a purchase-order school could not reach their school administrator** (the "notify my administrator" request) until the invoice was paid. It works as soon as the PO is received, and the email to the administrator no longer tells them only to mark the invoice paid.
- **Organization page:** your own row in the co-administrator list is now labelled "(you)".
- Server code changed (Node restart needed, done); no alter script. Help video B10 needs re-recording because its narration described the old two steps.

## Release 69 — 2026-10-31 — Choice Quest and Team Pick get new stories; audio games can explain answers

- **Choice Quest and Team Pick now each have four stories, and a run picks one.** Choice Quest adds the borrowed markers, the rules that keep changing, and a secret that is not yours. Team Pick adds the missed catch, the spelling test, and the part in the play. Every new story offers three believable options in its first three steps, with the right answer no longer tied to being the longest, a believable unsafe choice at the end, feedback that explains what each choice does to the people involved, and a private closing reflection. The owner read and approved all of the wording.
- **The younger-grade audio games can now explain answers.** A round can carry a short explanation for each choice and for the round itself, which replaces the generic "Correct!" or "Not quite" and is read aloud for children who do not read yet. No game uses it yet; the explanations come with the next content pass.
- Pages and engine files only: no server code, no alter script, no Node restart.

## Release 68 — 2026-10-31 — Brain games: shuffled choices, and a private self-check in Feelings Detective

- **Fix: the right answer is no longer almost always the first choice.** In 14 of the 16 engine-based brain games it used to sit in the first slot in nearly every round, so a student could pass by always tapping the first option. The game engine (`engine-sdk.js`) now shuffles choice order every round, and the order of rounds for games whose rounds are independent. Scenario steps and simulation events keep their order. It also gains support for larger content pools and several versions of a scenario, ready for the content work that follows. Learning events now record which authored round ran.
- **Feelings Detective now practises the child's own feelings.** After each story the child is asked "Has something like this ever happened to you?" and where in their body they would notice the feeling. Answers are never logged, sent or saved. This is what makes the game's Self-awareness label true: before, every story was about someone else.
- Pages and engine files only: no server code, no alter script, no Node restart. Plan and draft scorecard: `docs/tune-your-brain/GAME_REVERIFICATION_PLAN.md` and `GAME_SCORECARD.md`.

## Release 67 — 2026-10-31 — Re-recorded help videos for the Roster and Reports pages

- **Two help videos replaced:** "Manage your teacher roster" and "Reports and exports" were re-recorded so the seat numbers on screen match the Release 66 fix (a deactivated teacher keeps a seat, and the Reports legend now lists inactive teachers). Registry `help-videos.js` is now `?v=7` on all 40 pages that load it.
- No server code and no alter script: pages and assets only, so no Node restart is needed.

## Release 66 — 2026-10-31 — Seat counts agree on every page

- **Fix: the numbers a school admin sees for seats now match everywhere.** A deactivated teacher still holds a seat, but the Roster and Licenses pages left them out of "assigned" while still subtracting them from "available", so the figures did not add up and the percentage differed from the Dashboard. All pages now show the same assigned, available and percent-used.
- **One shared count** (`server/lib/seat-counts.js`) now feeds the Dashboard, Organization, Licenses and Reports pages, the "is there room to invite?" check, and teacher self-registration, so they cannot drift apart again.
- **Fix: an admin holding a seat no longer blocks invitations.** The invite and self-registration checks counted admin-held seats while the pages did not, so a school could be told "No available licenses" while the screen showed a seat free.
- Licenses page gains an Inactive tile; the Reports legend lists inactive teachers; the school-license card on My Licenses says "assigned"; the district teacher count no longer includes admins.
- No alter script and no `npm install`; Node restart needed (done).

## Release 65 — 2026-10-31 — Six more help videos, and fixes to the Brain Games progress dashboard

- **Six new help videos** (Cloudinary, linked in `help-videos.js?v=6`): Sign in with Microsoft (`microsoft-confirm.html`), Build your lesson plan library (`teacher-lesson-plans-browse.html`, `teacher-lesson-plans.html`, `my-license.html`), Buy a teacher license and check out (`licenses.html`), Play and track brain games (`brain-games.html`, `brain-games-progress.html`, `brain-badges.html`), Join the affiliate program (`become-an-affiliate.html`, `affiliate-dashboard.html`), and See how Fixer Nation lines up with your state's standards (`state-standards.html`). Each page now shows the "How-to video" button. The Help Videos page has two new groups, Affiliate partners and Exploring Fixer Nation (37 videos in all).
- **Fix: Brain Games progress dashboard (`brain-games-progress.html`).** It showed 0 Total XP, counted every game as played ("22 Games Played" after one round), and listed no recent sessions even right after a game. It now shows your real XP, only the games you have played, and your recent sessions with their scores.
- No server code and no alter script in this release: pages and assets only, so no Node restart is needed.

## Release 64 — 2026-10-30 — Blog search, teacher confirmation dialogs, and onboarding bug fixes

- **Search bar on the admin Blog Posts list** (`admin-blogs.html`). Type to narrow the list as you go; every word must match somewhere in the post (title, slug, category, tag, series, theme, author, excerpt, keywords, or its status such as draft, scheduled, featured). Shows "Showing X of Y", Escape clears it, and bulk actions only ever touch the rows you can see.
- **Teacher classroom pages use in-page dialogs instead of browser pop-ups** (`fn-confirm.js`, new) for Regenerate Join Code, Archive, Deactivate student, Revoke parent invitation, Remove lesson or game, and Reset quiz. They look the same as the rest of the site and show up in the help videos.
- **Fixes:** renewing (Resend or Extend) an expired invitation now takes a seat back, and says so if every seat is in use; teacher and parent invitation sign-in no longer errors for a Microsoft-only account (it says to use Continue with Microsoft); the Organization page lists only active co-administrators and labels them Primary, Secondary or Read Only (it used to call both "Full Access"); the Licenses page Active filter works; student PINs are checked as 4 to 6 digits on the server too (add student, import, reset, join a class; `lib/pin.js`, `test/pin.test.js`); the Roster has an "Invited, not joined yet" filter; the lesson Progress quiz average counts only students who took the quiz; My Licenses no longer says "Nothing on file yet" to a teacher whose license comes from their school, and shows the School Admin shortcut only to school administrators.
- **Help videos re-recorded and republished:** B1, B5, B8, B9, T1, T3, T4, T5, T6. `help-videos.js?v=5`. No alter script; Node restart needed (`classrooms.js`, `classroom-auth.js`, `school-admin.js`, `school-invite.js`, `parent-invite.js`).

## Release 63 — 2026-10-30 — Help videos, onboarding fixes, and footer regroup

- **Help videos and onboarding fixes.** `help-videos.html` lists how-to videos grouped by audience and task; each video also gets a "How-to video" button on the page it belongs to. The list is one file, `help-videos.js`: paste a video link into a video's `url` and it appears (all 31 videos are live, hosted on Cloudinary at `fne/help/<ID>`, with captions and posters in `help-assets/`; `?preview=1` shows the whole plan). Links added to the footer ("Help Videos", `footer.js` v9) and to the School Admin and District Admin menus (`school-admin-nav.js` v21, `district-admin-nav.js` v8). Plan: `docs/training-videos/VIDEO-PLAN.md`. Fixes: the bulk-invite CSV template now matches what the uploader reads (an unedited template used to drop every row), and the uploader accepts the old header names; the Invitations page shows its "payment pending" banner, pages past the first 25, and a correct sent/skipped/not-sent summary; a Secondary or Read Only admin pressing a blocked button now sees the reason instead of being sent to the sign-in page; teacher and parent sign-in have a working "Forgot your password?" and a resend link for unverified accounts; the setup page says "Choose your password" and offers a way to ask for a new link when one has expired; after a roster import the teacher sees every student's username and PIN once; a deactivated student can be reactivated; the classroom page sends a signed-out teacher to the teacher sign-in; teacher self-registration no longer treats a brand-new license as full (it counted unclaimed placeholder seats). New test file `server/test/school-registration.test.js` (46 tests total). A commit-time check, `server/scripts/videos-to-review.js`, lists which help videos a change could have made out of date (`docs/training-videos/video-watch.json`, `VIDEO-STATUS.md`). Videos cover getting started and sign-in, school administrators (B1-B10), district administrators (C1-C7), teachers (T1-T6), students (S1-S3) and parents (P1); the sign-in video is on all five sign-in pages and "Why can't I invite teachers yet?" is on Invitations. Also fixed while recording: the Create Account button on teacher registration (`education-schools.html`) opened the Log In tab instead of Sign Up; the teacher lesson progress page header always read "Lesson" instead of the lesson's title; the school Branding page sat on "Loading…" forever when a license had no school record, and now shows the reason. `res.cloudinary.com` added to `media-src` in the report-only Content-Security-Policy. `help-videos.js?v=4` on every page that loads it. No alter script; Node restart needed (`school-admin.js`, `school-registration.js`).
- **Footer Explore and Schools columns regrouped (`footer.js` v8).** Research & Alignment and State Standards moved from Explore to Schools (they are for schools evaluating us); Become an Affiliate moved from Schools to Explore (it is a partner route, not a school one); Explore reordered from story to product to routes. All pages bumped to `footer.js?v=8`.

## Release 62 — 2026-10-27 — Footer Access column regrouped

- **Footer "Access" column regrouped and a District Admin link added** (`footer.js` v7). Sign-in links run Student, Teacher, Parent Portal, School Admin, District Admin; privacy and contact links sit in their own "Privacy & Help" group.

## Release 61 — 2026-10-27 — Standards crosswalk goes public, per-district frameworks, and district school fixes

- **State standards / Portrait of a Graduate crosswalk is live.** `state-standards.html` shows only reviewed rows; 13 states are loaded as drafts (517 connections to FNE lessons, games and program themes, applied to every K-5/6-8/9-12 version) and NY and OH are verified and public. Printable one-pager at `state-onepager.html`, admin review page `admin-standards.html`. Details: `docs/standards-crosswalk/DESIGN.md`.
- **Per-district frameworks.** A district admin records their own district's Portrait of a Graduate or SEL framework (`district-admin-standards.html`, new "Portrait of a Graduate" link in the district-admin portal) and suggests FNE lessons/games/program themes for each competency. Nothing is public until an FNE admin writes the rationale for each suggestion and verifies; any district edit takes it back to draft. Verified frameworks show at `state-standards.html?district=ID` (plus a "Districts in this state" list) and `state-onepager.html?district=ID`. The sales-demo district is never public. Schema: `scripts/alter-add-district-frameworks.js`. Requirements and access matrix: `docs/standards-crosswalk/DISTRICT-FRAMEWORKS-REQUIREMENTS.md`.
- **Fix: the "Add" school button on Manage District (`admin-districts.html`).** It did nothing when no school was chosen, and a licensed school with no `schools` row could not be picked. Adding a school now creates its record if needed, points every group-license purchase for the domain at it (`purchases.school_id`, which the concierge flow and branding use), and reports how many licenses, school admins and teachers are linked. A school in another district is never moved; the demo school and district stay apart.
- **New: add a school to a district before it has a license** (Manage > "Add a school with no license yet"). Enter the domain; it links to its licenses, admins and teachers automatically when a group license is sold for that exact domain. Guards: strict domain check, explicit request flag, and a confirm when the domain is within 2 edits of a known one.
- **Two small server fixes:** malformed analytics beacons now get a clean 400 instead of a 500 plus stack trace in `stderr.log`, and a sales-demo invitation fix (`a8eb0c8`, `e3c17d6`).

## Retroactively documented — shipped 2026-08-23 to 2026-09-21, never written up until this cleanup (2026-10-13)

Six features sat in "Unreleased" marked "coded and pushed but not yet deployed" for weeks; a backlog-priority session on 2026-10-13 checked every one directly against production and found **all six were already live**, verified via direct API/page testing, not just git history. They were deployed alongside other work at the time and simply never got their own changelog entry. Dates below are each feature's actual commit date, not today's — these are **not** sequenced into the numbered Release list above to avoid a large mechanical renumbering of every release since; treat them as history, not as "Release 60-65."

- **2026-09-21 — Site-wide accessibility test tooling, plus one real bug fixed** (`cd31405`). New `tests/e2e/accessibility-scan.spec.ts` (informational, not a CI gate) scans 11 representative pages; found real cross-cutting issues everywhere (flagged for a future pass, not fixed) and one real bug fixed immediately: every Tune Your Brain game's progress bar had no accessible name (`game-shell.js`'s `renderProgress()`), fixed with `aria-labelledby`. Confirmed live: `aria-labelledby` present in the deployed `game-shell.js`.
- **2026-09-21 — Tune Your Brain: Sharing Circle + Helper's Choice**, closing Discover's 3-competency SEL gap (`933ddfa`). **Sharing Circle** — Social awareness + Relationship skills, badge **Caring Friend** 🤗. **Helper's Choice** — Responsible decision-making, badge **Honest Helper** ✋. Confirmed live: both slugs present in the live `/api/brain-games` catalog.
- **2026-08-27 — Four fixes** (`8aa3642`): parents are view-only for lesson resources (download path closed server-side, not just hidden in the UI); school/district license admins no longer count toward license totals or rosters; students can save partial quiz progress and resume (`student_quiz_drafts`, a "💾 Save Progress" button); Automations' "Execution History" tab went from a static placeholder to a real backed feature (`automation_executions` table). Confirmed live: quiz draft-save UI on `student-lesson.html`, no "coming soon" text left on `admin-automations.html`.
- **2026-08-26 — Structured license duration + auto-computed expiration** (`036d9ef`). `license_products.duration_days` replaces the old free-text "Valid for 12 months" footer-note convention; every purchase snapshots the product's length at creation time; `effective_date`/`expiration_date` auto-compute on purchase or PO receipt; new daily `quote-expiring-reminder.js` cron; school/district-admin portals show a persistent expiration banner. Confirmed live: the duration dropdown on `admin-licenses.html`'s Edit Product modal.
- **2026-08-24 — Content Safety System Phase 1** (`47005b4`). A pre-publication moderation gateway in front of every UGC surface (community posts/comments/DMs, student reflections, image uploads) — local profanity filter, local image-nudity classifier, optional OpenAI contextual layer off by default. Every category→action threshold is an admin-editable `safety_rules` row. See `CONTENT_SAFETY_IMPLEMENTATION_PLAN.md`. Confirmed live: `admin-content-safety.html` is fully built (Safety Rules, Safety Terms, Contextual AI Moderation toggle), not a placeholder.
- **2026-08-23 — Logo crop tool, SVG upload support, and district branding hierarchy** (`7137a0a`). Non-destructive drag/resize crop tool for school and district logos; sanitized SVG uploads rasterized to the same PNG pipeline as other formats; a new `district_admin` role with its own portal (`district-admin-*.html`) and `admin-districts.html` for creating/assigning districts. Confirmed live: `district-admin-branding.html`'s crop tool, `admin-districts.html`'s create/assign functions.

## Release 60 — 2026-10-20 — Security hardening, Microsoft sign-in confirmation, and sales demo accounts

Result of a full security audit (2026-10-15), deployed and verified live on 2026-10-20 (headers, blocked paths, new routes, and rate-limit client-IP detection all checked against production). **Everyone was signed out once** (session tokens changed). New columns: `admin_users.session_invalidated_at`, `site_users.is_sales_demo`.

- **Account takeover holes closed.** Admin, teacher/parent and student sessions can no longer be swapped for one another (a free account's cookie used to be accepted as an admin session). Microsoft sign-in no longer trusts the email Microsoft reports — a first-time sign-in now confirms by an emailed link, so a throwaway Microsoft tenant can't claim a school principal's account or license seats. Admin sessions are revoked when a password changes; admin login no longer reveals which usernames exist.
- **Injection and abuse protection.** Public form data can no longer run script in an admin's browser (shared escaping across the admin pages, quote-safe helpers everywhere, inline-handler data moved to `data-` attributes); email bodies escape user-supplied text; open-redirect and reset-password XSS via `next=` closed; uploads are identified by their actual bytes and avatars/community images re-encoded, so a disguised HTML/SVG file can't be hosted on the site; login, signup, password-reset, public-form, checkout and analytics endpoints are rate-limited (student PINs lock after 5 failures per username); PINs, join codes and tokens use cryptographic randomness.
- **Access-control fixes.** A teacher could reset any student's quiz data in any school; any community member could read and post comments inside other schools' private groups. Both fixed.
- **Hardening.** Security headers added (CSP is report-only for now), repo internals and server source blocked from the web, stray database files removed, vulnerable dependencies upgraded and the stale lockfile regenerated, QA credentials removed from the repo (rotation script provided).
- **Sales demo accounts.** One login per salesperson that holds teacher, parent, school-admin and district-admin roles against a fake demo district/school/classroom only (`server/scripts/seed-sales-demo-account.js`, dry run by default). The account is confined server-side: no community access, only the demo school/district in the admin portals even if mis-assigned, demo-school invitations limited to safe addresses. Parent access now follows actual parent links, not the single `role` value.
- **"Continue with Microsoft" sign-in** (live since mid-October) — see the confirmation change above.

## Release 59 — 2026-10-06 — Mission Control admin redesign, dashboard Needs Attention, curriculum materials refresh

- **Mission Control: a full visual redesign of all 26 admin pages**, requested after an earlier, more conservative audit-driven polish pass (Tier 1-2 below) was judged too incremental. Inline SVG icon system replacing emoji, per-category nav color-coding (reusing the existing teal/coral/gold brand hues — gold for Sales & Schools, teal for Content, coral for Marketing & CRM), illustrated page introductions, a searchable admin-page finder, an accessible mobile nav drawer, coordinated card/table/form styling, and matching light/dark themes. Login, invitation-accept, and invoice-print pages get matching treatment; invoice print gains a rotated "Paid in full" ink-stamp in place of the old flat badge, and the quote detail modal shows a matching stamp when a quote is Converted. Frontend-only — no server, database, auth, or billing changes; `admin-common.js` untouched.
- **Admin dashboard gets a "Needs Attention" card** (unpaid invoices, invoices whose PO hasn't been received yet, quotes expiring within 7 days) plus a visually-featured top row for Sales Today/Revenue Outstanding/Invoices Outstanding — the first entry point anywhere in the admin backend that answers "what needs my attention today." New `financial-summary` fields, no schema change.
- **Two real bugs found and fixed during rollout**, the second a genuine, previously-unnoticed site-wide gap: (1) a nav category left without an explicit value silently inherited a different category's accent color instead of its own intended neutral treatment; (2) admin HTML pages had **no `Cache-Control` header at all**, so each page's browser cache was governed by heuristics and cached entirely independently of every other page — the reason a hard refresh on one page never fixed a different page that looked identically stale after a deploy. Fixed site-wide via `.htaccess` (`Cache-Control: no-cache, must-revalidate` on all `.html`), not just for admin pages.
- **Every curriculum's "Materials Needed" list replaced** with one shared set of generic Morning Boost lesson-plan usage instructions (`server/scripts/reset-curriculum-materials.js`), per request — this is now shared content, not a per-lesson materials list.
- Also includes a smaller, mechanical first pass (Tier 1-2 of an admin UI/UX audit): deduplicated `.a-filter-select` out of 6 pages into `admin-common.css`, and fixed a real "one focal action per modal" violation in `admin-newsletter.html`'s Purchases & Licenses modal (3 competing primary buttons reduced to one).

`server/routes/dashboard.js` changed (new `financial-summary` fields) — needed a Node app restart. Everything else in this release is static files plus the one-off materials script.

## Release 58 — 2026-10-06 — CRM Roles & Assignments, Groups redesign, and UI polish

- **The CRM contact card (`admin-newsletter.html`) can now show what role a person actually has — teacher, School License Administrator, District Administrator — and the specifics of each.** Previously completely invisible: `site_users.role` wasn't even selected by the CRM's own query, and `school_license_admins`/`district_license_admins` (both keyed by `site_user_id`, never joined into the CRM) meant a District Administrator was indistinguishable from any other contact. New `GET /api/newsletter/contacts/:id/roles` resolves a contact to its site_user by email and fans out to every School/District Admin assignment and every teacher seat held or invited to (grade level, job title, department, subject area — captured at invite time on `school_invitations`, never shown centrally before) plus curriculum-level audience preference (ES/MS/HS/Higher Ed, from `site_user_audiences`). New "Roles & Assignments" section in the Edit Contact modal renders all of it read-only, linking out to `admin-school-admins.html`/`admin-districts.html` for actual management. Editing directly from the CRM card is deliberately deferred.
- Two real bugs found and fixed while verifying this: a **stale-response race condition** (switching contacts quickly before the first fetch resolved could overwrite the modal with the wrong person's data — fixed with a stale-response guard keyed on `editingContactId`), and a **single-role badge that only showed `site_users.role`** (a column that holds whatever role was assigned *most recently*, so someone who's a school admin *and* became a district admin showed only "District Administrator," implying that was their only role). The badge now derives the full set from which sections actually have data.
- **Groups field redesigned**: the old "every group as its own checkbox" layout didn't scale — no search, and a hard `slice(0, 25)` silently hid everything past the 25th group alphabetically even before any search text was typed (with one group per county/batch, that cutoff landed around the C's). Replaced with removable pills for assigned groups plus a typeahead ("+ Add a group…") to add more, no cap.
- **UI polish**: widened the Edit Contact modal (480px → 880px, was forcing a long scroll even before Roles & Assignments made it worse) and fixed the contacts search input, which had no styling class at all (bare browser default) and an off-center icon (replaced an absolutely-positioned emoji `::before` — unreliable across font metrics — with a real flex sibling). `admin-common.css` bumped `v17 → v18` across all 24 pages that reference it.

No schema change beyond `quote_sent_via` (added in Release 57's window). `server/routes/newsletter.js` changed (new `/roles` endpoint, `role` added to the contacts list query) — needs a Node app restart; all other changes are static files.

## Release 57 — 2026-10-05 — Concierge Setup: multi-seat trials, multiple admins, district branding, and invoice tracking fixes

- **District Branding setup added to the Concierge flow.** New Step 5 on `admin-concierge.html`, shown once a District Administrator has been assigned in Step 3. Lets an FNE admin set a starting logo/colors for the district and publish them during onboarding, instead of leaving it on FNE's default look until the district admin logs in and does it themselves. Reuses the exact same logic `district-admin-branding.html` itself calls (`server/lib/branding-editor.js`) under `requireAuth` instead of `requireDistrictAdmin`. Crop is deliberately not exposed here — the district admin can still refine it themselves later from their own portal.

- **Trial products now honor their real seat count instead of being hardcoded to 1.** Every trial purchase, however created, was forced to exactly 1 seat regardless of what `seat_count` the trial product's catalog entry declared — a "30-Day Trial (5 seats)" product silently collapsed to 1 real seat on acceptance, the other 4 never created. Fixed in both the self-service signup path (`checkout.js`) and the quote-acceptance path (`quote-accept.js`): the buyer still auto-claims one seat immediately (so they're never locked out of their own trial), with the rest starting `available` for the invite flow. The Stripe charge itself stays flat at 1x the trial price so a 5-seat trial isn't billed 5x. Also found and closed a related gap: trials are deliberately kept off `school-registration.js`'s domain-based self-registration (any teacher at a matching email domain could otherwise silently claim a spare trial seat with no invitation).

- **Concierge Setup now supports multiple School License Administrators and multiple District Administrators**, matching the existing "+Add another" pattern Step 4 already used for teachers — both roles previously could only ever get one assignment each before the form disappeared for good, even though the underlying tables always supported more than one. Two real bugs surfaced while verifying this showed up correctly on every other admin screen: district-admin detection was keyed off whether the *quote's own buyer* happened to be a district admin (so assigning anyone else reported "not assigned" forever), and assigning a district admin never actually linked the purchase's school to the district (`schools.district_id`), so the district's own school list/count and branding inheritance silently never picked it up. Both fixed — district resolution now follows `purchases.school_id → schools.district_id`, the real relationship.

- **The Concierge page now shows which quote/school it's working on.** The page heading and browser tab title were both static regardless of which quote was loaded; now both read e.g. "Concierge Setup — Lincoln Elementary (#1042)". The "Invite teachers" step also gained a top-right counter — active / invited / available-to-issue against the license's total seat count — after fixing a related bug where the API backing this page never actually selected `seat_count` from the database, so that information was always blank no matter what the real value was.

- **Invoices page: PO Received and Paid now show as two independent pills, plus a Quote # column.** The backend already tracked PO receipt (`po_received_date`) completely separately from payment status — the "Mark PO received" action was always available regardless of amount, but the status display only ever showed one pill. Added the second pill and a Quote # column (traced through `purchases.quote_id → quote_requests.quote_number`) to make it easy to find the quote behind an invoice.

- **New Quote page can now finalize a quote without emailing it**, for deals already agreed by phone. A "Don't email this quote" checkbox on `admin-quotes.html` skips the actual send but still records everything else Send Quote normally does (pricing snapshot, status transition), so the quote is immediately usable from Concierge. A new `quote_sent_via` column (`email`|`phone`) keeps the UI honest about which happened — shows "📞 Agreed by phone" instead of "✓ Sent" where relevant.

- **Fixed a real data-integrity bug found while testing the above: `purchases.payment_status` could get permanently stuck at "pending" even though its invoice was genuinely paid** — silently blocking a school license admin from inviting teachers and blocking teachers from self-registering (`payment_status` gates both, plus several reporting views). Root cause: a $0 quote's invoice is created already `paid` at acceptance time, but the matching purchase row was always hardcoded to `payment_status:'pending'` regardless, and nothing ever went back to reconcile the two. Fixed going forward; a one-off script backfilled the two purchases already stuck in this state on production.

## Release 56 — 2026-10-05 — Concierge Setup (quote-to-license on a customer's behalf) + $0 trial support

- **A new "Concierge Setup" admin flow lets an FNE admin carry a quote all the way to a working license on a customer's behalf.** Previously an admin could create/send a quote and later designate a School or District Administrator directly, but converting the quote itself into a real order required the *customer* to click through `accept-quote.html` themselves, and only a school's own License Administrator could invite teachers. White-glove (phone/email) deals now go through one guided page (`admin-concierge.html`, reached via a "Concierge" button on each priced quote in `admin-quotes.html`):

  1. **Accept via Purchase Order, on the customer's behalf.** The PO-acceptance logic in `quote-accept.js` was extracted into a shared `acceptQuoteViaPO()` so the admin action and the customer's own self-service flow are the exact same code path, not a duplicate — identical purchase/invoice/School-Admin-assignment/email side effects either way, plus one new audit entry naming the admin. **Card payment stays entirely out of this admin flow** (PCI/compliance) — a card-paying customer still always completes their own Stripe checkout via the existing link.
  2. **School License Administrator** — the concierge page just calls the existing `POST /api/admin/school-admins/assign`, pre-filled from the quote's contact. No backend change.
  3. **District Administrator (optional)** — the concierge page calls the existing district create/assign endpoints for a single contact. No backend change, and deliberately no multi-school district-bundling — that's bigger, separate scope if it's ever needed.
  4. **Invite teachers.** The teacher-invitation logic in `school-admin.js` (previously duplicated between its single and bulk routes, and tightly coupled to a logged-in school admin's own session) was extracted into a shared `inviteTeacherToSeat()` (`server/lib/teacher-invitations.js`) — both existing school-admin routes now call it, and a new admin-facing pair of endpoints lets an FNE admin invite into *any* purchase's seats, with the resulting audit entries and emails distinguishable from a school admin's own invites.

  No schema changes — every table involved already existed.

- **The Concierge flow now fully supports $0 trial quotes**, closing three gaps found right after the flow above first shipped:
  - The Concierge button (and the "Quoted" amount column) was checking `quoted_amount_cents` for *truthiness* — a free quote has `quoted_amount_cents = 0`, which is falsy in JS, so the button silently never appeared even though the quote was fully priced. The backend already treated `0` as valid and distinct from "not yet quoted" (`null`); this was a front-end-only bug, fixed by checking presence instead of truthiness everywhere it mattered in `admin-quotes.html`.
  - `acceptQuoteViaPO()` used to always require a PO number and always forced the resulting purchase into `license_status = 'pending'`, waiting on an admin to mark a PO "received." For a free trial there's no PO to collect on and nobody would ever mark one received, so the license would've stayed pending indefinitely. Now PO is only required when `quoted_amount_cents > 0`; a $0 quote creates a `paid` $0 invoice and skips the pending gate entirely, activating immediately.
  - The invite-teachers result (sent/skipped/failed, with per-email detail) was only ever shown in the shared `fnToast` notification, which auto-dismisses after 2.4 seconds — too fast to read once it listed failures. It now also renders in a persistent, dismissible box on `admin-concierge.html` that survives the page's own post-send refresh.

## Release 55 — 2026-09-27 — Affiliate territory requests + coverage map, and a real favicon

- **Affiliate territory requests now go through real admin approval, and the admin page gets a coverage map.** Two connected additions to the existing affiliate/territory system:

  **Territory requests.** Previously every territory assignment was immediate and admin-only — an affiliate had no way to ask for one themselves. New `territory_requests` table (mirrors the existing `affiliate_applications` pattern: a request row, never the real assignment, until reviewed). An approved affiliate can request an additional territory or a replacement for one they hold (`affiliate-dashboard.html`); an admin **Territory Requests** tab (`admin-affiliates.html`) approves or rejects each one. Approving a "change" request revokes the old assignment and applies the new one in the same transaction — a true swap; approving anything else calls the exact same `assignTerritory()` the direct-admin path already uses, so the (deliberately unchanged) exclusivity check applies identically. Rejecting never touches an affiliate's existing approved territories. **County is now mandatory for every territory, everywhere** — a whole-state-only assignment can no longer be created. Real county names for every state (3,143 of them, Census-derived, names-only) now back a real cascading dropdown on the application form, the admin's direct-assign modal, and the new self-service request form — previously county was free text on the admin modal and territory wasn't even askable on the public application form beyond a plain text box.

  **Territory map.** A **Map** tab on `admin-affiliates.html`: a hand-drawn inline SVG US map (no mapping library added — generated once from public-domain Census boundary data, shipped as a static file) colored by how many distinct active affiliates hold a territory in each state, with a legend whose ranges are computed from the actual current data rather than a fixed scale. Click or keyboard-select a state for a detail list of its affiliates below the map; a plain state `<select>` provides the identical action for narrow screens or non-mouse use.

  A real bug surfaced and fixed the same day: territory display names doubled the word "County" ("Albany County County, WY") the first time this ran against real county data — `territoryDisplayName()` used to append " County" to the value, which was correct back when county was free text without it, but the new reference-list values already include it. Fixed, confirmed on a fresh assignment.

- **The site now has a real favicon.** None existed before (every browser tab showed a generic globe icon; `/favicon.ico` 404'd). Cropped from the existing `logo-fne.png` brand mark (the three-people icon, without the wordmark) — no new artwork, no external design tool. Produces `favicon.ico` (16/32/48 multi-size), `favicon-16x16.png`, `favicon-32x32.png`, and `apple-touch-icon.png` (180×180, opaque `--cream` background per Apple's own convention against transparency). Wired into every HTML file's `<head>` via a one-time scripted insertion, not hand-edited per file.

## Release 54 — 2026-09-27 — Campaign send 500, finally resolved (real cause: a missed migration)

- **The long-standing "campaign send throws a bare 500" bug is fixed — but the real cause was never what it looked like.** Every send attempt since batched sending shipped (`6a45b87`, 2026-09-15) — real or test, any recipient count — hit `ER_BAD_FIELD_ERROR: Unknown column 'next_batch_at' in 'SET'`: `server/scripts/alter-add-campaign-batching.js` had simply never been run in production, so the columns that same commit added to `campaigns` never existed on the live table. Confirmed via the real server log after months of it being requested but unobtained, then independently reproduced live with a disposable zero-recipient test send. Fix was a one-off `node scripts/alter-add-campaign-batching.js` run — no code change.

- **A real, separate improvement shipped alongside it: `POST /:id/send` no longer sends any email synchronously inside the web request.** It previously blocked on sending its entire first batch (up to `campaign_batch_size`, default 60) before responding, each recipient over its own un-pooled SMTP connection — a real risk on this shared, resource-capped host on its own merits, even though it turned out not to be what was actually throwing. The route now only marks the campaign `Sending`; the first batch (like every batch after it) is picked up by the existing 5-minute cron. Scheduled campaigns and recurring series are unaffected — they were already cron-triggered.

- **Lesson for next time a bug like this shows up:** a fast (sub-second), 100%-reproducible failure with zero recipients is never a timeout — that one fact would have ruled out the SMTP-pooling theory immediately, before writing a line of code. Reproduce a bug before fixing it, not just after.

## Release 53 — 2026-09-24 — B2B sales-affiliate program (all 4 stages) + two live bug fixes

- **A B2B sales-affiliate program, built and deployed in full: someone applies, an admin approves them with a commission rate and a territory, and they get a referral link that credits sales back to them.** The four business decisions in `docs/AFFILIATE_PROGRAM_SPIKE.md` were settled up front — 90-day last-touch attribution (school purchasing is slow enough that a 30-day cookie would routinely expire before the PO arrived), every purchase type commissionable, approve and reject both email the applicant automatically, and a rejected applicant can reapply whenever they like.

  **Stage 1, the data.** Two new tables (`affiliate_applications`, `affiliates`) plus two nullable columns on `purchases` recording which affiliate earned a sale and what the commission was worth at the time. Commission is snapshotted when the sale happens, so raising someone's rate later never rewrites what they already earned.

  **Stage 2, applying and reviewing.** `become-an-affiliate.html` is a public application form with a honeypot field and a per-IP throttle (the first rate limiting of any kind in this codebase — `contact.js` still has none, a gap worth closing separately). `admin-affiliates.html` has an Applications queue and an Affiliates directory: approve someone and the system creates or promotes their `site_users` account, generates a referral code, and emails them a password-setup link; reject them and they get the reason you typed. Territory exclusivity (one active affiliate per region) is enforced, but territory never decides who earns a commission — only the referral code does.

  **Stage 3, crediting the sale.** A visitor arriving on `?ref=CODE` gets the code stored in a cookie for 90 days (`referral.js`, on all 58 public pages). When a purchase is created, the code is looked up and the commission is worked out and written onto the purchase then and there — card, PO, and quote acceptance all included. An unknown or suspended code just means the sale goes to nobody, which is not an error. The Stripe webhook reads the code from the Stripe session's metadata instead of the cookie, since that call comes from Stripe, not the buyer. A trial converting to an annual license inherits the trial's affiliate when there's no fresher code, since the conversion is where the real money is and it often happens weeks later on a different machine.

  **Stage 3.5, the commission ledger, real territories, and an audit trail.** Every earning gets its own row in a new `affiliate_commissions` table with a status that follows the money — a card sale is approved immediately (Stripe has already taken payment); a purchase-order sale stays **pending** until its invoice is marked paid, then becomes **approved**; cancelling an invoice reverses whatever hasn't been paid out. This replaced an earlier design that credited PO commission the moment the sale was created, before the school's business office had actually paid — a real gap caught by reviewing how fixernation.org handles the same problem. The admin page gained a **Commissions** tab (program totals, a filterable queue, approve/hold/release/mark-paid/reverse) and a **Territories** tab — the old free-text `affiliates.territory` column is gone, replaced by real US states/counties (50 states + DC pre-seeded; counties created on first assignment) so two affiliates can never hold "the same" region under different spellings. Suspending an affiliate frees every territory they hold. An **Activity Log** tab (reusing the existing `school_audit_log` table, not a new one) records who approved/rejected/suspended/assigned/reversed what, and when.

  **Stage 4, the affiliate's own dashboard.** `affiliate-dashboard.html` — read-only referral link with copy button, commission rate, territories, three running totals (pending/owed/paid), and commission history. Reachable from the account-menu dropdown, same as every other portal.

  **Two real bugs found by the user actually using it in production, both fixed the same day.** (1) Approving an application flatly refused anyone who already had a teacher/parent/school-admin/district-admin account, treating `site_users.role` as an exclusive gate — fixed so affiliate status is determined purely by an `affiliates` row's existence, matching the account system's established multi-role pattern elsewhere. (2) That fix itself shipped with a scoping bug (`assignedTerritoryName` read outside the `try` block it was declared in) that 500'd **every** approval — caught immediately by the user trying it live, fixed with an end-to-end test added afterward to close the gap that let it through untested.

  **Deployed and confirmed live 2026-09-24**, re-verified 2026-09-25: `become-an-affiliate.html`, `admin-affiliates.html`, and `affiliate-dashboard.html` all serve 200 in production, `GET /api/affiliate-portal/me` returns 401 (not 404), and a real district-admin affiliate approval succeeded end-to-end. Linked in the footer (Schools column, after Teacher Registration) since announcing the program was a deliberate later decision, not a launch-day one.

## Release 52 — 2026-09-21 — Feelings Detective, first Self-awareness game in any band

- New **Scenario Choice engine** (`engine-scenario-choice.js`) — no existing engine supported multi-select, but genuine Self-awareness content requires allowing more than one plausible feeling per scenario. Two stages per scenario (notice cues, then pick feelings), narrated from day one, scoreless per the evidence-discipline rule against diagnosing an emotion.
- **Feelings Detective** (`brain-feelings-detective.html`, Discover band) — 4 scenarios, each tagging 2 plausible feelings (never just 1), 2 of the 4 adding a seek-help beat. New badge **Cue Spotter** 🔍.
- Fixed a real Discover-band CSS bug found during local verification: choice buttons assumed a single emoji glyph; this game's genuine short-phrase choices broke that layout. Scoped opt-out added, no other Discover content affected.
- **Every one of the 5 CASEL competencies now has coverage in at least one experience band.** Confirmed live via a Playwright spec run against production.

## Release 51 — 2026-09-17 — Team Pick + Group Chat Meltdown (Explore/Challenge second SEL games)

- **Team Pick** (`brain-team-pick.html`, Explore) — picked last for a team in gym class, managing the frustration of feeling left out. CASEL: Self-management, Relationship skills. New badge **Steady Player** 🙋.
- **Group Chat Meltdown** (`brain-group-chat-meltdown.html`, Challenge) — friends joke about an embarrassing video in a group chat, managing the urge to fire back. CASEL: Self-management, Responsible decision-making. New badge **Clear Head** 💬.
- Both reuse `engine-branching-scenario.js` (proven a 5th time) and close the last two open items from the SEL-games-per-band plan — Self-management now has coverage in all 4 experience bands. Confirmed live via 2 Playwright specs run against production.

## Release 50 — 2026-09-17 — First Shift + The Post (Advance SEL games), permanent dead-link fix

- **Permanent fix for a recurring dead-link bug class.** `brain-games.html`'s "Play Now" link for Calm Down Corner was dead — the same bug class as the original 8-game dead-link fix (Release 48), recurring because `GAME_URLS` was a hand-maintained map easy to forget when a new game ships. Fixed for good: the map is gone, every game's URL is now computed as `brain-{slug}.html`, which every game without exception already follows — this bug class can't recur for any future game.
- **First Shift** — a new part-time job, a coworker asks the student to cover for a mistake. CASEL: Responsible decision-making, Relationship skills. New badge **Leadership Builder** 🧑‍💼 — the 8th and last of the blueprint's own §12.3 example badge names.
- **The Post** — a friend wants to repost something that could hurt a classmate's reputation. CASEL: Social awareness, Relationship skills, Self-management. New badge **Digital Ally** 📱.
- Both use `engine-branching-scenario.js` (already proven twice) and close Advance's previously-zero SEL & Character coverage. Confirmed live.

## Release 49 — 2026-09-17 — Calm Down Corner, first Discover-band SEL game

- **Calm Down Corner** (`brain-calm-down-corner.html`) is the first SEL & Character game for the Discover band (previously zero coverage) and the first targeting the Self-management CASEL competency in any band — 4 narrated Audio Choice rounds (a fallen tower, a stuck puzzle piece, a lost swing turn, a spilled drink), each a single-select choice between a calming strategy and two unhelpful-but-not-shamed reactions. New badge **Calm Explorer** 🐢.
- Pushed the Discover CSS prototype further, per explicit direction to keep going: the illustrated background/rounding now extends to the whole game panel (not just the header), a bigger "Replay sound" button, a bigger progress bar, an emoji-prefixed feedback banner, and a second decorative cloud — plus fixing the same "text not scaled by band" bug pattern found earlier, this time in `.fn-shell-feedback`'s font-size.
- Also includes the band-filter bug fix and Discover visual-prototype round 1 from earlier today (Release 48's follow-up).
- Confirmed live 2026-09-17 via a direct API check (catalog row present with correct `band`/`domain`), 2 Playwright specs (Calm Down Corner + a Sound Safari regression check on the shared Audio Choice engine), and a direct reward-wiring check (40 XP, Calm Explorer badge, `earned: true`).

## Release 48 — 2026-09-17 — SEL/domain tagging, real filters on the Brain Games page

- New `brain_games.domain` column (one of the 5 roadmap §6.1 domains per game) and `brain_games.casel_competencies` back two new client-side chip filters on `brain-games.html` — **Band** and **Focus** — reusing the existing `.lesson-chip` UI pattern from `teacher-classroom.html`.
- **Two real bugs found and fixed while designing the filters.** `GAME_URLS` on that page only mapped the 6 legacy game slugs, so every one of the 8 new Tune Your Brain games has been a dead "Play Now" link from this page since launch — missed until now because every e2e test plays games through the classroom-assignment path (`student-game.html`) instead. The hero copy and badge chips also still described the original 6-game "brain-training" product, with no mention of literacy, SEL, or life skills, despite the catalog having tripled in scope — both refreshed.
- Makes explicit (`docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md`'s update) that Self-awareness and Self-management have zero CASEL coverage in any experience band, and that Discover/Advance have zero SEL & Character games at all — with a phased plan to close most of it by reusing the existing Branching Scenario engine, no new engine required except for genuine Self-awareness content.
- Confirmed live 2026-09-17 via a direct API check (all 14 games return correct `domain` values) plus a Playwright check of the actual UI: both filters correctly narrow the grid (Focus→SEL shows exactly Decision Point/Choice Quest; Band→Discover shows exactly Sound Safari), and all 14 "Play Now" links now resolve to a real game page.

## Release 47 — 2026-09-17 — Band/grade game filtering, pilot flag wiring, full spec reconciliation

- **Band/grade-based game filtering.** New `brain_games.band` column (populated for the 8 new games, `NULL` for the 6 band-agnostic legacy ones). `teacher-classroom.html`'s Assign Game dropdown now defaults to a classroom's grade-matched band, with a "Show games for all grade bands" override — a UX guardrail per roadmap §6.3, not an API-level restriction.
- **The `tune_your_brain_pilot_enabled` feature flag now actually does something.** It existed since Phase 1 with a real checker function that nothing ever called — every new game has been visible to every school with no way to pilot a cohort or kill-switch a problem. `GET /api/brain-games` now checks it per school; set to enabled globally in this same deploy so today's visibility didn't change (confirmed: all 14 games still returned post-deploy).
- **Full spec reconciliation published** (`docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md`): only 2 of 8 built games are genuinely SEL & Character, and neither touches the CASEL Self-Awareness or Self-Management competencies — flagged for a real content decision, not started — plus platform gaps (zero admin visibility into this product at any level, zero accessibility test tooling anywhere in the repo, an empty/unwired skill graph, a stale traceability matrix, no CI/error-monitoring/backup docs) standing between this and being genuinely shippable to clients.
- Confirmed live 2026-09-17 via a direct API check (all 14 games still visible with correct `band` values) plus 9 Playwright specs run together against production — all passed clean.

## Release 46 — 2026-09-17 — Tune Your Brain catalog scaling, first slice: 4 more games

- **Choice Quest** (Explore band, Branching Scenario engine — a team-project Issues-to-Answers scenario), **Headline** (Challenge band, Evidence Hunt engine — pick the accurate, non-exaggerated headline from 4 short school-news items), **Money Moves** (Challenge band, Simulation engine — save toward a bike across 4 budget events), and **Critical Read** (Advance band, Evidence Hunt engine — distinguish fact from opinion/inference across 4 mature media-literacy passages) are all live. All 4 reuse engines that already power 2 games each, so this was content + catalog wiring only, same pattern as the Phase 5 vertical slice.
- Each now earns real XP/streaks with zero extra wiring (`brain_games.reward_pipeline` defaults new games to the Phase 6 Reward Service's generic pipeline) plus a new named badge (**Perspective Builder**, **Digital Citizen**, **Problem Solver**, **Source Sleuth**) — confirmed directly in production: all 4 completions correctly awarded 40 XP (25 base + 15 badge) and the exact right badge, `earned: true`.
- Confirmed live 2026-09-17 via 6 Playwright specs run together against production (the 4 new game specs plus `decision-point-assignment.spec.ts`/`reading-detective-assignment.spec.ts` to confirm no regression on the shared engines) — all passed clean.

## Release 45 — 2026-09-17 — Tune Your Brain Phase 6, first slice: Reward Service + teacher report

- **Sound Safari, Reading Detective, Decision Point, and Money Matters now award real XP and badges, and teachers finally get a report.** Previously all 4 gave students zero XP/badges and teachers no report when played through a real classroom assignment — a gap Phase 5's own stated goal had called for but never delivered. New `server/lib/rewards.js` (`awardClassroomCompletion()`, called from `student.js`'s existing game-completion route) awards flat completion XP, feeds the existing streak system, and awards one of 4 new named badges (**Sound Explorer**, **Context Detective**, **Responsible Responder**, **Budget Builder**) on a student's first completion of that game — writing to the same `brain_game_user_progress`/`user_brain_badges` tables the 6 legacy games already use, so the existing student pages (`brain-games-progress.html`, `brain-badges.html`) picked up the new games' rewards with zero frontend changes. A new `brain_games.reward_pipeline` column (`'legacy'` for the 6 existing games, `'classroom_generic'` by default otherwise) keeps the two reward paths from ever double-awarding the same completion.
- **New `teacher-game-report.html`** puts a UI in front of a completions endpoint that's existed server-side since the classroom-assignment feature shipped but never had a frontend caller — per-student play count, first/latest score, and CSV export, linked from a new "Results ↗" on each assigned game in `teacher-classroom.html`.
- **Real concurrency bug found and fixed during verification, not a design flaw:** the first-completion badge check originally re-read `total_completed` in a separate query after the XP upsert — racy when two completions of the same student+game land close together (which happened during this rollout's own regression run, playing Reading Detective for the same QA student from two specs in parallel). Fixed by reading "was this a fresh insert" directly off the upsert's own `affectedRows` instead of a second query.
- Confirmed live 2026-09-17 via 5 Playwright specs run together against production (the new reward spec plus all 4 pilot-game specs, to confirm no regression from the `student.js` route change) — all passed clean.
- Deliberately out of scope for this slice: assignment targeting by skill/range/domain, adaptive controls, cooperative milestones, admin aggregate reporting (blocked on unresolved decision D4), reset/audit tooling, and wiring Decision Point's reflection step into `student_reflections`. See `docs/tune-your-brain/PHASE_STATUS.md`.

## Release 44 — 2026-09-17 — Tune Your Brain Phase 5 vertical slice complete: Reading Detective, Decision Point, Money Matters

- **All 4 vertical-slice pilot games are now live.** Following Sound Safari (Release 43), the remaining 3 games exist through the same real classroom-assignment path, not internal demos, confirmed via 3 new Playwright regression runs against production: **Reading Detective** (`brain-reading-detective.html`, Explore band, Evidence Hunt engine — 4 short mystery passages testing main idea/inference, each a two-stage answer-then-evidence pick), **Decision Point** (`brain-decision-point.html`, Challenge band, Branching Scenario engine — the real 5-step Issues-to-Answers cycle on a peer group-chat-exclusion scenario, with a trusted-adult help option and a private reflection step never transmitted anywhere), and **Money Matters** (`brain-money-matters.html`, Advance band, Simulation engine — a fictional first-apartment budget across 4 decisions, with multiple end states treated as valid successes rather than moralized). Each ships with an idempotent catalog-seed script (`server/scripts/seed-{slug}-catalog-entry.js`) and a Playwright regression test mirroring Sound Safari's (`tests/e2e/{slug}-assignment.spec.ts`).
- **Two real, pre-existing scoring gaps found and fixed in the same pass.** `engine-evidence-hunt.js` never reported its (clearly countable) score to the completion record, unlike `engine-audio-choice.js` — so Reading Detective would have recorded a null `raw_score` despite having one to give. Fixed with the same one-line `scoreInfo` argument Audio Choice already used. While auditing the other 4 engines for the same gap, found it again in `engine-memory.js`/`engine-pattern.js` — both already track an obvious score (`matched` pairs / `correctCount`) but never reported it either. These 2 engines are not new: they already power the 6 existing legacy games in production (Memory Match, Simon Sequence, Number Sequence, Stroop Challenge, etc.), so this fix changes live scoring behavior for games already in front of real students, not just the new pilot slice. Same one-line fix pattern in both.
- No schema change, no server-route change, no app restart required — static HTML/JS plus 3 catalog-row inserts only.

## Release 43 — 2026-09-17 — Sound Safari, the first real Tune Your Brain game, plus a research-error correction

- **Sound Safari is live** — the first real (not-a-demo) Tune Your Brain game, confirmed via a full Playwright regression run against production: a teacher assigns it through `teacher-classroom.html`'s existing Assign Game flow, a student plays it through `student-home.html`/`student-game.html`, and a real, non-null score lands in `student_game_completions` for the first time ever for any game. Placeholder phonics content (initial-sound identification, browser-TTS narrated pending the ElevenLabs decision, D1) on the Audio Choice engine.
- **Two real, pre-existing bugs found and fixed while wiring this up:** (1) the teacher's assign-game dropdown has shown blank labels for every game since it shipped (`g.title` vs. the API's actual `g.name` field); (2) `student-game.html`'s "Mark as Done" button has never once sent a real score — always an empty body, so `student_game_completions.raw_score`/`duration_ms` had never been populated by any game. Fixed generically: `engine-sdk.js` now `postMessage`s real score/duration on completion; `student-game.html` auto-reports it. Purely additive — the 6 legacy games' manual button is untouched.
- **Research-error correction:** an earlier Tune Your Brain planning pass wrongly concluded no shared site-user auth middleware existed anywhere, and built a redundant `server/middleware/siteUserAuth.js`. A real one (`requireSiteAuth`, `server/routes/site-auth.js`) already existed, already used by `classrooms.js`/`parent.js`/`social.js`/`teacher-lesson-plans.js`. Consolidated into `server/lib/site-user.js`, shared by both the existing middleware (zero behavior change) and the new `/api/learning-events` route; the redundant file is deleted.
- New regression test: `tests/e2e/sound-safari-assignment.spec.ts`.

## Release 42 — 2026-09-16 — Five more Tune Your Brain engines (Pattern, Audio Choice, Evidence Hunt, Branching Scenario, Simulation)

Completes the corrected engine list from a spike into the 6 existing legacy games (`docs/tune-your-brain/ENGINE_MAPPING_SPIKE.md`): `engine-pattern.js` (Number Sequence's mechanic), `engine-audio-choice.js` (generalized beyond audio to any stimulus type, so it also covers Stroop Challenge's mechanic), `engine-evidence-hunt.js` (two-stage — pick an answer, then pick the passage sentence that supports it — scored differently if the answer's right but the evidence isn't), `engine-branching-scenario.js` (the real Issues-to-Answers 5-step cycle, every choice tagged unsafe/plausible-incomplete/responsible/multiple-defensible/seek-help, never scored as right/wrong trivia; its reflection step's free text is never transmitted anywhere), `engine-simulation.js` (multi-decision resource simulation with a visible decision log and a non-moralizing debrief — more than one path can succeed). All 6 engines demoed together at `tune-your-brain-shell-demo-engine.html`. Verified via a throwaway Playwright script: full playthroughs complete correctly end-to-end for every engine, zero console errors, keyboard-operable throughout.

## Release 41 — 2026-09-16 — Tune Your Brain Game Engine SDK + first engine (Memory)

New `POST /api/learning-events` (dual-identity like `/api/brain-games`, allowlisted event types, metadata capped and structured-only, never free text) gives engines somewhere real to log evidence. New `engine-sdk.js` (client-side lifecycle runner: shared shell chrome, resume-safe session tracking via `sessionStorage`) and the first real engine, `engine-memory.js` (covers Memory Match + Simon Sequence's mechanic). Verified via a throwaway Playwright script: two different content packs run on the same engine with zero engine-code changes, under two different age bands, keyboard-operable, and a page reload resumes the same session rather than duplicating it. **Real bug caught in the process:** the flip-card CSS had only ever existed as page-local styles inside `brain-memory-match.html`, never in the shared `brain-games.css` — and a `<span class="flip-inner">` turned out invisible once shared, since CSS width/height percentages don't apply to inline elements. Both fixed in the shared stylesheet; `brain-memory-match.html` itself is untouched and confirmed unaffected.

## Release 40 — 2026-09-16 — Tune Your Brain shared design system + accessibility utilities

This codebase had zero shared accessibility infrastructure anywhere. Added `accessibility-utils.js` (reduced-motion toggle, screen-reader live-announcement region, keyboard-activation helper, floating accessibility settings panel) and `game-shell.js` (reusable band-aware builders for header/instructions/progress/feedback/hint/pause-exit/summary), plus four experience-band presentation tokens in `brain-games.css` (Discover/Explore/Challenge/Advance — same teal/coral/serif identity, scaled type/spacing/target-size/motion per band, not four separate brands). Demoed at `tune-your-brain-shells-demo.html`. `brain-games.css` is now cache-busted (`?v=1`) across all 9 pages that reference it. Static files only — no server code touched.

## Release 39 — 2026-09-16 — Tune Your Brain Phase 1 foundation (feature flags, skill graph, learning events)

- A real feature-flag mechanism (`feature_flags`/`feature_flag_schools` — flag name + optional per-school scope), seeded with one disabled flag (`tune_your_brain_pilot_enabled`).
- `skills`/`skill_prerequisites` tables, deliberately empty — a future content-governance phase seeds real content.
- A new `learning_events` table for normalized session/event data (separate from the anonymous, funnel-only `analytics_events`), with a provisional 400-day retention window (`settings.learning_events_retention_days`) and a new nightly purge cron (`purge-learning-events.js`).

## Release 38 — 2026-09-16 — Classroom-PIN students now earn real Brain Games progress and badges

- **The "can play but earns nothing" gap for classroom-PIN students is closed.** Every Brain Games table (`brain_game_sessions`, `brain_game_user_progress`, `user_brain_badges`, `brain_user_streaks`, `brain_game_privacy`) only ever had a `NOT NULL` foreign key to `site_users(id)` — a classroom-PIN student (`fn_student_session`, `classroom_students` table, no `site_users` row at all) could play any of the 6 games but every one of the 12 Brain Games API endpoints returned a hard 401, so nothing was ever saved. Fixed with a parallel nullable `student_id` column on all 5 tables (`server/scripts/alter-add-brain-games-student-support.js`) and a dual-identity resolver in `server/routes/brain-games.js` that accepts either a site-user or a classroom-PIN-student session and writes to whichever identity column applies — exactly one of `user_id`/`student_id` is ever populated per row. `server/db/schema.sql` also gained the full Brain Games schema for the first time (it existed only via the original ad-hoc migration script, so a fresh install never created it).
- **Confirmed live, 2026-09-16**, via the QA classroom-PIN fixture: a real game completion earned real XP (leveled up Beginner→Learner) and two real badges ("First Pair," "Perfect Recall"), both still present on a follow-up `GET /me/badges` call. New regression test: `tests/e2e/brain-games-pin-student.spec.ts`.
- This is the first implementation work package of the much larger "Tune Your Brain" platform-expansion blueprint under review — see `docs/tune-your-brain/` for the full verification report and build plan.

## Release 37 — 2026-09-05 — Fixed HTML campaigns arriving as visible raw code

- **Real bug, reported by the user after go-live: recipients were seeing literal `<!doctype html>...` as visible plain text instead of a rendered email.** Root cause: an admin had pasted a complete custom HTML email template directly into the Quill WYSIWYG editor (Release 32) — Quill, correctly for a WYSIWYG editor, treats pasted plain text that looks like code as literal text and HTML-escapes the angle brackets, so the escaped source itself became the email body. Verified the send pipeline (`mailer.js`) was never the problem — it produces a valid `Content-Type: text/html` message every time.
- **Fix: added a "Visual / HTML Source" toggle** next to the existing Plain Text/HTML toggle, in both the campaign and recurring-series modals. Source mode is a raw textarea, completely independent of Quill's HTML-to-Delta conversion — a full custom template pasted there is sent byte-for-byte, no re-interpretation (which would be lossy anyway for anything Quill has no format for — `<style>` blocks, `<table>` layouts).
- **A second real bug was caught and fixed during verification of the first fix**: the toggle itself always re-synced from Quill on every click, even when Source already held the correct pre-populated content (e.g. right after reopening a saved campaign) — silently destroying it with Quill's lossy re-derivation. Fixed by replacing toggle-time sync with continuous live sync via edit events instead, so switching which view is shown never mutates either one.
- Verified live end-to-end (11 checks): the exact reported scenario (paste a full raw template in Source mode → saved byte-for-byte, no escaping), reopening a saved HTML campaign shows the exact original in Source, and normal Visual-mode typing plus Visual↔Source switching all still work correctly.

## Release 36 — 2026-09-05 — Real admin toggle for the homepage featured lesson + public preview access

- **The homepage "featured lesson" spotlight is now a real admin toggle (⭐ button in `admin-curriculum.html`'s list, `curricula.is_featured`), not a hardcoded title-string match.** Previously `education-portal.html` picked whichever curriculum's title happened to contain the literal text "Take Responsibility for Your Growth" — nothing in the admin UI could change it. Featuring one lesson always un-features whatever was featured before it (a radio button, not a checkbox) via new `PUT /api/curricula/:id/featured`. Also fixed a bug this surfaced: the spotlight's heading, series line, and description were static hardcoded HTML that never actually read from the featured lesson at all — only the resources/video/detail-link were dynamic. New `renderSpotlightHeader()` fixes that, so switching the featured lesson now updates everything on the homepage, not just half of it.
- **The featured lesson is a deliberate public preview — viewable by everyone, including anonymous visitors, quiz included.** All other lessons remain exactly as license-gated as before (the Release 30-era security fix that closed the old public-resource loophole is untouched for every non-featured lesson). Downloading is deliberately excluded from the bypass — same as the existing parent-access pattern, viewing is public but downloading still requires a real teacher license; a new `access.canDownload` flag (distinct from `access.licensed`) keeps `lesson-detail.html` from rendering a Download button that would just get rejected. Both gate points (`gateAccess()` and `GET /:id/file`) read `is_featured` live on every request, so flipping the admin toggle re-locks the old featured lesson and unlocks the new one immediately — no redeploy, no extra step.
- Verified live end-to-end (20 checks): anonymous access confirmed open for the featured lesson's resources/video/quiz and confirmed still fully locked for a comparison lesson; view-vs-download distinction confirmed via `GET /:id/file` (200 without `download=1`, 401 with it); toggling the ⭐ flag confirmed to swap which lesson is open in real time, with mutual exclusivity (never more than one featured); original featured lesson restored afterward.

## Release 35 — 2026-09-05 — Alert FNE admin on school-admin/district-admin assignment + teacher registration

- **Assigning a School License Administrator, assigning a District Administrator, and a teacher accepting their invitation now all alert FNE staff** (`contact_email_sales_alerts`), matching the existing pattern used for new purchases. Previously all three stayed entirely between the people directly involved — FNE never knew unless someone went looking. Deliberately not added to the auto-assignment that happens as part of a group-license purchase checkout, since that purchase already triggers its own sales alert.
- Verified live (district-admin path): assign → alert code path executes cleanly (no error) → cleaned up the throwaway district and test account.

## Release 34 — 2026-09-05 — Footer cross-link to fixernation.org's Positivity Network

- **New "The Positivity Network ↗" link, last item in the footer's Explore column, site-wide (`footer.js`).** Points to the parent brand's homepage (`https://fixernation.org/`), opens in a new tab. Deliberately styled distinctly from the rest of the list — a muted one-line subtitle ("Health, hope & good news — from our parent community") and an outbound-link arrow — so it reads as "there's more beyond FNE" rather than blending in as just another FNE page. This restores, properly this time as an explicit cross-brand link rather than a mis-imported page, the connection that `fnnetwork.html`/the early `blog.html` used to represent before they were removed as fixernation.org leftovers in the 2026-08-20 scope cleanup.
- Verified live via a headless Playwright script: link text/href/target/rel, subtitle text, correct position (8th/last item in Explore), a real click confirmed opening `fixernation.org` in a new tab, and visual screenshots at both desktop and 375px mobile widths.

## Release 33 — 2026-09-05 — Campaign builder: send-test-email + require body on send/schedule

- **New "Send Test" button in both the campaign and recurring-series modals**, next to the email body editor. Sends a real one-off email of whatever's currently composed — no need to save a draft first — via a new `POST /api/campaigns/test-send` that reuses the same send function a real campaign uses (minus the open/click tracking token, since there's no real `campaign_sends` row for a test). Previously the only way to see how an email actually rendered in an inbox was to send it for real to the whole audience.
- **Sending or scheduling now requires a non-empty body** — subject was already required, body never was, so a completely blank campaign or recurring series could go out. A draft can still be saved with no body (still being written); actually sending/scheduling checks both client- and server-side. A recurring series has no draft state, so it's required at creation for that too.
- Verified live end-to-end via a headless Playwright script covering every path: both blocked cases (empty body, empty test-recipient address) on both modals, a real test send to a real address, and normal save/delete still working once a body is present. Then cleaned up.

## Release 32 — 2026-09-05 — Campaign builder: real WYSIWYG editor (Quill)

- **The HTML-format campaign body editor is now a real WYSIWYG (Quill), not a raw textarea with snippet-insertion buttons.** Replaced in both the one-off Campaign modal and the Recurring Campaign (series) modal — the latter previously had no formatting help at all. Quill's own rendering replaces the separate live-preview iframe, since it IS the preview. Plain Text mode is unchanged (still a literal textarea — a WYSIWYG editor doesn't make sense for a body meant to have no markup).
- Quill's image button uploads through the same `/api/uploads` pipeline the blog/curriculum editors use, instead of Quill's default behavior of embedding the file as a base64 data URI (which would bloat every campaign send and get stripped by some mail clients).
- **A real bug was caught and fixed during verification**: the image handler read the cursor position *after* the OS file picker closed, by which point the page had lost focus/selection — every upload landed at the very start of the document instead of at the cursor. Fixed by capturing the selection before opening the file picker.
- Verified live end-to-end with a headless Playwright script driving the real admin UI (not just the API): typing, bold formatting, image upload landing at the correct cursor position with a real `/uploads/` URL, and a full save → close → reopen round-trip preserving all of it — for both the campaign and recurring-series modals. Then cleaned up.

## Release 31 — 2026-09-05 — Contact CSV import: Phone/Company/Notes/Signup Date/Groups

- **The Import Contacts CSV importer now supports the full contact record, not just Name/Email/Address/City/State/Zip/Source.** Phone, Company, Notes, and Signup Date were previously silently dropped even when present in the uploaded file. New **Groups** column accepts one or many group names separated by `|` (e.g. `Teachers|FNE Suspect`).
- **Any group name in the CSV that doesn't already exist is surfaced to the admin before import**, with a yes/no prompt to create it — never created silently, and declining still imports the contact, just without that tag.
- **Existing contacts (matched by email) only ever get blank fields filled in and groups added** — a value already set is never overwritten, and group membership from a CSV is always additive, matching the existing rule that status/source/signup date on an existing contact are never touched by a bulk import.
- Verified live end-to-end against production with a throwaway smoke test covering all four behaviors (new-contact full field transfer, blank-only-fill on re-import, additive group assignment, and the create-vs-skip missing-group choice), then cleaned up.

## Release 30 — 2026-09-05 — Campaign scheduling/recurring deployed + real image upload

- **Campaigns: multi-group audiences, scheduling, and recurring campaigns (coded in Release 29's cycle) is now deployed and live-verified.** A campaign can target one or many audience groups at once (UNION — anyone in any selected group). Alongside "Send Now," a campaign can be scheduled for a future date/time or set up as a recurring campaign (daily/weekly/monthly, admin-set time + timezone, running until paused); every recurrence fires its own independently-tracked campaign occurrence. Verified live end-to-end with an isolated single-recipient smoke test: a scheduled campaign and a daily recurring campaign both fired correctly through the new 5-minute cron and were cleaned up afterward.
- **The campaign body editor's "+ Image" button now does a real upload instead of inserting a placeholder URL.** It previously inserted `<img src="https://www.fixernation.org/path-to-image.jpg">` for the admin to hand-edit. Now opens a file picker, uploads through the existing `/api/uploads` pipeline (same one blog/curriculum editors use), and inserts the real returned URL.

## Release 29 — 2026-08-23 — Proactive/outbound quoting + Quote Content Profiles

- **Admins can now start a quote for a prospect who never asked for one.** A "+ New Quote" button on `admin-quotes.html` opens the exact same modal used to view/edit any quote — full pricing tabs, license tier, term, add-on seats, school domain, status, notes, content profile — just with the contact fields (name, email, school, phone) blank instead of pre-filled from an inbound request. Those contact fields are now editable on every quote, not just new ones, and saving/sending a not-yet-created quote transparently creates the underlying record first — no separate create-then-reopen step. Outbound quotes are tagged "Outbound" in the list so sales can tell them apart from inbound requests.
- **The single global set of 4 quote-email content sections is now a library of named, reusable "Quote Content Profiles"** (e.g. "Standard," "30 Days Free Trial"), managed from a card on `admin-quotes.html`. Every quote picks one; the email always renders that profile's current content (editing a profile updates every quote using it, including on resend). Deleting a non-default profile reassigns any quotes using it back to the default rather than blocking the delete.
- Verified end-to-end against production with a new Playwright spec (`admin-quotes-outbound-and-profiles.spec.ts`): profile CRUD, full pricing parity on the New Quote screen, transparent create-on-save, the Outbound tag, a real send that persists the selected profile, contact fields staying editable post-send, and profile-deletion reassignment.

## Release 28 — 2026-08-22 — FNE scope cleanup, per-child parent portal, mobile nav menu

- **Removed FNE's consumer-membership, service-provider, brand-ambassador, and book content entirely, by explicit owner instruction.** The original repo import in 2026-07-02 accidentally brought over 16 pages actually built for the separate fixernation.org project (a 14-page "-v2" design island, `askthefixer.html`, `fnnetwork.html`), plus real membership/book features that were never actually in scope for Fixer Nation Education, a school-focused SEL platform, not a consumer product. Removed: `join.html`, `service-providers.html`, `brand-ambassador.html`, `my-memberships.html`, `books.html` + its 4 book detail pages + `admin-books.html`, and `blog.html` (the real, active blog is `morning-boost-blog.html`). Morning Boost's access gate switched from an active membership to an active teacher license, matching FNE's real access model — there's no "Members Only"/join-link language left anywhere on the site. The 2 real personal Stripe subscriptions found during this cleanup were cancelled directly through Stripe, not just marked cancelled locally (which would have kept billing indefinitely with no record left in our own system). **This supersedes Release 19's "Members Only" toggle description and Release 18's note that the membership/subscription system was "confirmed deployed and live" — both describe a system that no longer exists.** The `-v2` pages described as "frozen" below and in Release 16 were deleted outright, not left as-is.
- **Parent portal now shows real per-child progress, not one shared classroom view for every parent.** Previously every parent linked to a classroom saw identical content with no way to tell which child they were even looking at. A teacher now sends a specific parent a personal invite for one specific child (from that student's row on `teacher-classroom.html`'s roster); accepting it links that parent to that child specifically, and the parent portal shows one card per child with that child's own lesson-completion progress. The old classroom-wide join-code self-serve flow is gone — invites are the only way in now. (A parent still on the old classroom-wide link would have crashed the portal entirely — found and fixed the same day it shipped.)
- **Added a mobile navigation menu — there wasn't one at all.** Every page's nav (Why FNE, Explore, Lesson Library, Morning Boost, Pricing, Brain Games, Community, and all 4 login links) simply disappeared below 900px wide with no way to get it back, on every page site-wide. Added a hamburger menu with all of the above, plus a follow-up fix for phones where the open panel didn't respond to an actual finger swipe (caught on a real-device test after the initial fix).
- **`admin-downloads.html` now actually has the Reset/Reset All controls it always claimed to have** (see Release 22) — a per-row Reset next to the existing Edit, and a Reset All that respects whichever tab/search filter is currently active instead of wiping everything unconditionally.
- **QA test coverage extended to a real Stripe checkout, the formal quote builder, and Purchase Orders, end to end.** A dedicated `[QA] Test License` product lets the automated suite exercise the actual purchase flow (cart → Stripe test-mode checkout → paid license) and the full quote lifecycle (build → send → accept → PO) instead of only ever testing against real production catalog items.
- **Found and fixed a real school-admin login bug:** an account whose one administrator assignment had been deactivated could sign in successfully, then get bounced straight back to the login page a second later with no error shown at all — the dashboard treats any non-2xx response from its session check as "not logged in," which is exactly what a deactivated assignment returns.

## Release 27 — 2026-08-20 to 2026-08-21 — Security fixes, PO payment gating, session hardening

- **Fixed an unauthenticated, infinitely-reusable school-admin invite link** — anyone holding a quote's accept link (emailed to the buyer, and forwardable/leakable like any email) could use it to create unlimited full administrator accounts on that purchase, forever. Now single-use with a 7-day window matching the link's own stated expiry.
- **Fixed a cross-purchase permission leak**: a school admin's write-permission level was being checked against whichever purchase they'd bought most recently, not the specific purchase an action actually targeted — a read-only assignment on an older purchase could silently inherit write access from a newer one.
- **Purchase-Order-based quote acceptance now actually gates on payment.** Accepting a quote by PO previously activated the license immediately with no invoice and no payment status at all — it now creates a real unpaid invoice and holds the license pending, exactly like the existing direct-PO-checkout path already did. Found the same day: the "Mark PO Received" button had never actually worked in production at all (it queried a database column that was never added), so this whole payment gate had silently done nothing since it shipped — fixed both.
- **Fixed the quote builder undercounting seats and mishandling trial pricing** — an Add-On-Seats-only quote always billed for 1 seat regardless of how many were actually selected (the Add-On tab itself had zero selectable pricing tiers in production, a separate bug found while fixing this), and 90-Day Pilot quotes were becoming permanent licenses that never expired.
- **Hardened session-cookie revocation** — changing or resetting a password now actually invalidates any other device's existing login for that account (previously this only happened on teacher removal); school-admin sessions now get the same check site-user sessions already had.
- **Fixed a stale-content bug on logout** — logging out left the previous page (student rosters, PINs, etc.) fully visible on screen instead of navigating away, a real risk on a shared classroom computer.
- **CRM contact import now updates existing contacts instead of silently skipping them**, and CRM export now respects whatever search/filter is currently active on screen instead of always exporting every contact regardless of what's shown.
- **Fixed Morning Boost's lock screen copy** to describe the actual gate at the time (an active membership) instead of "licensed educators," which had never been the real requirement. (Membership itself was later removed — see Release 28.)
- Classroom archiving now actually revokes student sign-in access (previously cosmetic only), and a student rejoining with the same name/PIN re-authenticates into their existing account instead of silently creating a duplicate.
- A recurrence of a previously-fixed bug (`JSON.stringify()` breaking an HTML `onclick` attribute — see Release 25) turned up on 4 more admin action buttons across the invitations, licenses, and lesson-plans pages — all silently did nothing when clicked, fixed the same way as the original.

## Release 26 — 2026-08-20 — E2E test suite + inquiry form validation fix

- **Fixed the school inquiry form (`school-licensing.html`) showing no error message on invalid input.** Missing fields, a bad email, an incomplete phone number, or a network failure all set the right message text but rendered it into a `display:none` element that a CSS class could never override — visitors got no feedback at all when something needed fixing, the form just silently didn't submit. Found by the new automated test suite below.
- **New automated Playwright test suite** (`tests/`) covers every admin page, the public site, and all four portals (school admin, teacher, student, parent) — 27 spec files, ~101 tests, run against production. `server/scripts/seed-qa-test-accounts.js` provisions the dedicated test accounts it needs and is safe to re-run. Not yet wired into a CI pipeline — run manually before/after a risky deploy.

## Release 25 — 2026-08-05 — School admin + invite flow bug fixes

- **Fixed Resend Welcome and Remove buttons doing nothing on admin-school-admins.html** — root cause was `JSON.stringify(email)` embedding double-quote characters inside a `"`-delimited HTML `onclick` attribute, truncating the attribute at the first inner `"` and producing a JS SyntaxError on click. Fixed by switching to single-quoted string embedding with `esc()` escaping throughout the row-generation template.
- **Fixed school admin welcome email not guiding unverified existing users to set a password** — the `/assign` route was sending the activation (reset-password) link only for brand-new accounts (`isNewUser === true`). Existing users who hadn't yet verified their email (e.g. a teacher later promoted to admin) got only a portal link with no way to log in. Now uses `!user.email_verified` as the condition — same logic already applied in the resend-welcome route.
- **Fixed teacher invite acceptance leaving unverified accounts blocked** — teachers with `email_verified = 0` who tried to sign in on the invite acceptance page hit the login endpoint's 403/unverified error with no escape path. New `POST /api/school-invite/accept-and-verify` endpoint authenticates the password and marks the email verified in one step (accepting the invite via the emailed link proves email ownership), then claims the license seat and issues a session cookie. The invite acceptance page now detects the 403/unverified response from login and routes through this endpoint automatically.
- **Fixed Resend Welcome showing no confirmation** — the previous success path replaced the button with a small "✓ Email sent" pill (easy to miss) and relied on the 2.4-second `fnToast` popup. Both remain, but a persistent green/red banner now also writes into the `#toastEl` div already present on the page, so the outcome stays visible until the admin navigates away.
- **Fixed Remove Teacher on school-admin-roster.html throwing "Unknown column 'session_invalidated_at' in 'SET'"** — the `site_users` table was missing this column, which is used by both teacher-removal routes in `server/routes/school-admin.js` and by `requireSiteAuth` middleware to force-logout removed teachers. The UPDATE failed inside a transaction and rolled back, so no removal happened. Added idempotent migration script `server/scripts/alter-add-session-invalidated-at.js`; column adds `DATETIME NULL DEFAULT NULL` and is checked against `information_schema.COLUMNS` before altering.

## Release 24 — 2026-07-xx — Audience/grade-level filtering + school license admin portal

- **New audience/grade-level filtering on the education portal** — a filter bar above the lesson grid lets guest visitors choose Elementary, Middle School, High School, or Higher Ed; Middle School is the default. Choice persists in `localStorage` across visits. Logged-in teachers who have saved grade-level preferences skip the filter bar entirely — the portal automatically shows their levels. `site_user_audiences` is a new junction table (`site_user_id`, `audience`) backed by `GET/PUT /api/site-auth/me/audiences`.
- **Grade selector step added to teacher registration** — after the eligibility check passes on `education-schools.html`, a new step asks "What grade levels do you teach?" (checkboxes, multi-select) before the account creation form. Selected levels are saved to `sessionStorage` and POSTed to the audiences endpoint immediately after login completes, so the portal is pre-filtered from the first visit.
- **Grade levels visible and editable in both admin views** — `admin-licenses.html`'s seat roster and `school-admin-teachers.html` both show a Grade Levels column per teacher. An edit modal (same pattern as other modals in each page) lets a super-admin or school admin update the levels via `PUT /api/newsletter/seats/:seatId/audiences` or `PUT /api/school-admin/teachers/:siteUserId/audiences`.
- **School license admin portal foundation** — grade levels column ported to `school-admin-roster.html`; resend welcome email for school license admins (sends Set Password link if `email_verified = 0`, portal link otherwise); utilization report corrected to count available/inactive/registered seats accurately; audit log entries now record self-registration and invitation events with actor/action/entity; pending registrations section shows invites opened but not yet completed.
- **Seat and invite flow fixes** — blank seats created on initial purchase now get `status = 'available'` (was previously a missing/wrong status); `school-invite-accept.html` now handles the case where a logged-in user on the wrong account clicks an invite link (prompts sign-out) and correctly routes existing-account holders to the sign-in tab instead of the create-account tab.
- **Reset password marks account verified and issues session cookie** — completing the reset-password flow now sets `email_verified = 1` on the account and sets the `fn_user_session` cookie in the same response, so a new school admin who clicks their activation link lands directly on the school admin dashboard without a second login step.

## Release 23 — 2026-07-xx — Formal quote builder + quote management

- **New admin-quotes.html quote management page** — lists all incoming quote requests with status (New, Quoted, Won, Lost, Declined), contact info, school domain, and requested seat count. Admin can open any request and generate a formal quote or mark it with a status. Requests flow in from the "Request a Formal Quote" form on the public site (existing contact.js endpoint).
- **Formal quote builder** — replaces the old free-text dollar-amount field with a structured builder: choose a license tier (pulled live from the product catalog), add-on seats (where available, at per-seat rate), school-year proration window (full year Jul–Dec, 30-lesson Jan–Mar, 20-lesson Apr–Jun), and 1/2/3-year term with configurable discounts. A live breakdown box shows base price, add-on, proration, and term discount rows with a running total. Multi-year discounts (default 5%/8%) and the quote from-email are admin-configurable from a new "Quote Settings" card on admin-settings.html.
- **Enhanced quote emails** — generated quotes email an itemized HTML breakdown (tier, add-on seats, proration factor, multi-year discount, bold total) with a 30-day validity notice, replacing the previous plain-text amount. Admin can customize two content sections of the quote email (intro paragraph and what's included) via a Quill rich text editor on the quotes page — content saved to the settings table.
- **Quiz import fuzzy title matching** — the import-quiz API endpoint now matches curriculum titles with punctuation-insensitive fuzzy matching, so a CSV with slightly different punctuation than the DB title no longer fails silently.
- **Quick Actions moved to top of admin dashboard** — the Quick Actions card now appears before the stats section for faster access.

## Release 22 — 2026-07-22 — Teacher Downloads dashboard

- **New admin-downloads.html page** — a cross-curriculum teacher download view replacing the per-curriculum-only modal that existed before. A single searchable, paginated table shows every teacher who has ever downloaded a file across all curricula: teacher name, email, resolved school (from CRM company field, falling back to purchase school domain), curriculum title, download count vs. the per-curriculum limit, and last download date. Supports `*` wildcard search across any column (same server-side pattern as the CRM). Per-row Reset and Reset All controls call the existing delete endpoints. A "Downloads" nav link was added to the admin sidebar (alphabetically ordered, present on all admin pages).
- **Fixed search hint alignment** — the wildcard hint text ("Use * as wildcard…") now sits flush below the search bar rather than below the full card header row.

## Release 21 — 2026-07-20 — Curriculum file protection, PDF modal viewer, admin UX fix

- **Curriculum files are now served through a protected API endpoint**, not raw `/uploads/` URLs. Every file open — student handouts, teacher copies, classroom posters, and lesson-plan documents — routes through `GET /api/curricula/:id/file?resource=<name>` (or `?doc=<index>` for lesson-plan documents). The endpoint enforces the access matrix: anonymous visitors can view but not download, licensed teachers can download (counted against the per-curriculum `download_limit` set in the admin), admins are unrestricted. Download counts are tracked in a `curriculum_downloads` table (`curriculum_id`, `teacher_email`, `count`, `last_download`). All four pages that open curriculum files — `education-portal.html`, `lesson-detail.html`, `student-lesson.html`, and the admin curriculum builder — were audited and updated.
- **Files now open in a PDF/image modal viewer** (`pdf-modal.js`) instead of a new browser tab. The modal renders PDF pages as canvas elements via PDF.js 3.11.174 (loaded lazily from cdnjs) and images as `<img>` tags — no native browser PDF viewer, so there is no download button in the viewer UI. Right-click on the modal body is blocked (yields a single-page PNG at most rather than the full file). The raw file URL never appears in the address bar. The shared script is loaded by `education-portal.html`, `lesson-detail.html`, and `student-lesson.html`.
- **Morning Boost Email admin page (`admin-morning-boost-email.html`) theme toggle alignment fixed.** The light/dark toggle was grouped with the page title rather than in the topbar's own flex slot, shifting it off-center. Fixed to match every other admin page: the topbar has exactly three direct flex children (title h1 / theme toggle / user chip), and the "Send Today's Boost" action button was moved into the first card's header row — consistent with the pattern on `admin-blogs.html` and other pages.

## Release 20 — 2026-07-09 — Wildcard search, live curriculum portal, UX polish

- **Admin sign-out bug fixed.** The LiteSpeed reverse proxy was caching an empty response for `/api/auth/me` (recorded when the Node app was momentarily down), causing the admin dashboard to redirect back to the login page a split-second after loading. Fixed with `Cache-Control: no-store` on all `/api` responses and a `Date.now()` cache-busting query parameter on the auth check so LiteSpeed can never serve a stale hit.
- **Wildcard search in admin CRM and Licenses.** The Contacts Management search box and the Memberships grant-modal contact picker now accept `*` (any sequence of characters) and `?` (any single character) as wildcard operators — e.g. `smith*` matches anything starting with "smith", `*edu` matches anything ending in "edu". The Find-a-School domain search in admin-licenses.html also supports wildcards server-side.
- **Blog post Excerpt expanded to 500 characters with a live counter.** The excerpt textarea in the blog post editor now enforces a 500-character cap, shows a running `X / 500` counter that turns red near the limit, and keeps the count accurate when opening an existing post or loading from the Morning Boost calendar. Blog listing cards on the public site now render the full excerpt as written (previously truncated at 110 characters).
- **Membership plan editor explains the Free Trial flow.** The "Trial Days" field now shows a hint: when the value is > 0 the public website shows a "Start Free Trial" button instead of "Buy Now", and the member's card is not charged until the trial ends.
- **National Education Portal now shows live curriculum.** The lesson-plan library grid on `education-portal.html` was previously 9 hardcoded sample cards. It now fetches and renders all published curricula from the admin dashboard. Series filter chips are built dynamically from the actual data and each card links directly to the lesson's detail page.
- **Curriculum overview text preserves formatting on the website.** The Overview field on individual lesson plan pages (`lesson-detail.html`) previously collapsed all paragraph and line breaks into one flat block. Blank lines are now rendered as paragraph breaks and single newlines as `<br>`, matching exactly what the admin typed in the editor.
- **cPanel email directory-harvest attack noted** (task #189): `verify@deliverytruth.com` probed common addresses on 2026-07-04; bounce messages confirmed which exist. Mitigation: configure the default/catch-all address to `:blackhole:` in cPanel → Email → Default Address.

## Release 19 — 2026-07-06 — Morning Boost brought into the admin dashboard (Phase 1)

- **The Morning Boost blog-publishing workflow moves off Wix and into `admin-blogs.html`.** Closed the three real gaps that made a straight replacement impossible before: a post can now belong to **multiple categories at once** (`blog_post_categories`, mirrors the existing tags system — Morning Boost posts land in Morning Boost + Health + Positivity + Wellness simultaneously, matching how they were tagged in Wix), 9 new categories were added to match Wix's real category set (Health, Positivity, Wellness, and the 5 "2D Education"/Business/Government categories), and posts gained **alt text, meta description, and focus keyword** fields (the SEO tab) plus a **"Members Only" toggle** that replaces Wix's Monetize tab — gated posts show a locked preview with a join link to everyone without an active Fixer Nation membership (any plan), enforced server-side in `/api/blog/posts`, same "not just a UI hint" pattern as curriculum license gating.
- **Scheduling now actually schedules.** A post with `published` on and a future Publish Date stays hidden from the public site until that date arrives, instead of going live immediately — matches Wix's "schedule post" step using the fields that already existed, no new column needed.
- **The full 2026 content calendar (205 daily Theme/Series entries, April–December) is imported** into a new `morning_boost_calendar` table. `admin-blogs.html` can load any date's Theme/Series straight into a new post with one click instead of the admin looking it up by hand, and the calendar entry links back to whichever post ends up published for that day. The ~70-term tag vocabulary from the step sheet was pre-seeded too, so tags are picked from checkboxes instead of retyped.
- **New "Morning Boost Studio" page** (`admin-morning-boost.html`) batch-generates a day's voice-over clips via the ElevenLabs API in one action instead of pasting each script into ElevenLabs one at a time. **Not live yet** — needs a real `ELEVENLABS_API_KEY` in `server/.env` (same deferred-but-complete pattern as Stripe) and a voice ID saved on that page.
- **Deliberately deferred (backburner, at the user's request):** automating image generation and video assembly (replacing ChatGPT/Google AI image prompts and the iMovie build) — HandBrake's encoding step is a trivial win whenever that gets picked back up, but the video-assembly piece specifically needs the actual iMovie production layout template to scope, which wasn't available this round.

## Release 18 — 2026-07-06 — Automated emails + membership duration/expiration tracking

- **Six automated emails now fire on real events**, each admin-editable (subject, body, on/off, and reminder timing) from a new "Automations" page: book purchase thank-you, membership purchase thank-you (fires on every real charge — first purchase and every renewal), membership renewal reminder, invoice-paid confirmation, payment-failed/past-due notice, and license seat invite (when a school admin assigns a teacher's email to an open seat). All six use simple `{{mergeField}}` templates and fail silently on their own (an SMTP hiccup never blocks the purchase/invoice/seat action that triggered them).
- **Membership plans now track a real duration** (`duration_days` — e.g. 90 for the book-purchase perk, 30/365 for monthly/annual tiers) instead of just describing it in copy. Each membership's estimated expiration (`ends_at`) is computed at signup/grant and re-anchored on every real renewal charge, shown on the Members tab of `admin-memberships.html`.
- **A new daily cron job** (`server/scripts/send-membership-reminders.js`, run via cPanel Cron Job — this project's first) sends the renewal reminder to anyone within the configured window of their `ends_at`, and expires any membership whose date has passed with no renewal.
- Fixed a real bug surfaced while building this: `admin-memberships.html`'s status dropdown was wiping a membership's `ends_at` back to `NULL` on any status change other than cancel/expire (e.g. `past_due` → `active`) — it now only touches `ends_at` on an actual cancel/expire/reactivate transition.
- Also: the membership/subscription system from the previous session (Free w/ Book, Monthly/Annual Consumer + Service Provider tiers, 2D Education registration, Brand Ambassador — `join.html`, `service-providers.html`, `brand-ambassador.html`, `admin-memberships.html`, Stripe subscription checkout) is confirmed **deployed and live** — this changelog just never got a numbered entry for it at the time. Stripe checkout itself is still not live pending real API keys, same as license checkout.

## Release 17 — 2026-07-05 — Real Contact Us page, removed dead Reviews link

- **New "Contact Us" page**, wired to the footer "Contact" link that previously went nowhere (`href="#"`). Emails a newly admin-configurable "General Contact" address — same Settings card as the other contact-form routing.
- **Removed the dead "Reviews" footer link** (there's no reviews feature on the site) and fixed a books.html section that was mislabeled "Reviews" when it's actually about the included 90-day membership.

## Release 16 — 2026-07-05 — Your Privacy Choices page

- **New "Your Privacy Choices" page**, linked from the footer of every public page (previously a dead link buried under the Request a Quotation form). States plainly that Fixer Nation doesn't sell or share personal information with third parties, explains what actually is collected (contact info submitted directly, and anonymous session analytics with no persistent cookie), and includes a real request form (access / delete / opt-out) that emails a newly admin-configurable "Privacy Requests" address — same Settings card as the Ask The Fixer/Quote routing.
- **A real analytics opt-out toggle** on that page — flips a `localStorage` flag that every page's tracking call checks before firing, so a visitor can turn off anonymous session tracking entirely on their device, not just a symbolic toggle.
- Not legal advice — this reflects what's actually implemented in this codebase (no third-party ad trackers, no data brokers, sessionStorage-only analytics). If that ever changes, this page and its "we don't sell data" framing need to be revisited.

## Release 15 — 2026-07-05 — Configurable contact-form email routing, homepage rename

- **Settings now has a "Contact Email Routing" card**: the admin can set which inbox "Ask The Fixer" and "Request a Formal Quotation" submissions get emailed to, instead of it being hardcoded to `admin@fixernationeducation.com`. Both default to that same address until changed, so nothing changes unless an admin actually edits it.
- **Settings also has a new "Invoice Branding" card**: business name, tagline/footer line, and a logo upload, shown at the top and bottom of every printed/emailed invoice in place of the old hardcoded "Fixer Nation" text. No logo uploaded yet shows the same "FN" mark as before.
- **Homepage renamed from `fixernation-redesign.html` to `index.html`**, and the last leftover "redesign"/mockup wording (the browser tab title, and a placeholder line on the FN Blogs page) was cleaned up — every reference across the site, admin backend, and email-verification links now points to the new name. The bare domain root now resolves directly to the homepage. The frozen `-v2` alternate-design pages are intentionally left as-is (a prior, separate decision — not part of the live site).

## Release 14 — 2026-07-05 — Visitor Paths becomes a traffic funnel

- **Traffic Funnel** replaces the plain stat list at the top of Visitor Paths (`admin-analytics.html`) with a funnel-mapping-style visual: Visited the site → Explored content → Showed buying/contact intent, with the drop-off percentage between each stage called out directly. A date-range picker (7/30/90 days or custom) controls the window, defaulting to the last 30 days.
- A chip row breaks the "intent" stage down by the specific action (added to cart, requested a quote, asked the Fixer), so an admin can see not just how many visitors reached that stage but what they were about to do.
- There's deliberately no "purchased" stage — analytics sessions are anonymous by design with no link to a purchase record, so the funnel stops at intent, not conversion. The existing Top Entry Pages and Most-Opened Objects are unchanged.
- **The per-session "Visitor Path" modal is now a graphical journey map** instead of a plain text list: connected icon nodes showing exactly where a visitor entered, which pages they viewed, and which specific objects they interacted with (a book/product, a curriculum resource, adding to the cart, requesting a quote, Ask The Fixer) — color-coded by category (entry, engagement, buying/contact intent) so the shape of a visit is readable at a glance.

## Release 13 — 2026-07-05 — Admin visual redesign, with a light/dark theme

- **Full visual refresh of the admin backend**: moved off the old generic indigo/navy look to a palette drawn from Fixer Nation's own brand (teal, coral, gold), so the admin dashboard and the public site finally feel like one product. Flatter cards, pill-shaped nav highlights, and softer borders replace the old heavier drop shadows.
- **Dark theme**, toggled from a sun/moon switch in the topbar of every dashboard page. Defaults to the browser's system preference on first visit, then remembers your choice. Every color used across the shared admin stylesheet — cards, tables, pills, modals, buttons, chart bars — has a matching dark-mode value, not just an inverted filter.
- The admin login screen keeps a fixed brand-teal gradient regardless of the dashboard's theme setting (a deliberate exception, matching how most products treat their sign-in screen as a fixed brand moment).

## Release 12 — 2026-07-04 — Admin management, and invoice linking on the Dashboard

- **Admins (Settings)** got a full set of management controls per admin: resend a pending admin's invite email, send an active admin a password-reset link, edit their username/email, or delete their account. An admin can't delete their own account, and the last remaining admin can never be deleted — the site always keeps a way in.
- **Purchase Order Invoices Issued** on the Dashboard's Financial Insights now links out just like "Sales Today"/"Sales All-Time" do for orders: the paid/unpaid/cancelled counts are each a distinct link straight to a pre-filtered Invoices list. The stat label itself was renamed from "Invoices Issued" to "Purchase Order Invoices Issued" for clarity (all invoices on this site come from PO checkouts, not card payments).
- Invoices can now be filtered by status directly on `admin-invoices.html` via a dropdown, in addition to arriving pre-filtered from the Dashboard link.

## Release 11 — 2026-07-04 — Visitor path tracking and a real Insights section

- **New "Visitor Paths" dashboard**: anonymous, session-based tracking of how people navigate the public site — entry page, the sequence of pages visited, and key interactions (book views, add-to-cart, curriculum resource/quiz opens, quote requests, Ask The Fixer submissions). No names, emails, or IP addresses are stored — sessions are pseudonymous and reset when a visitor closes their browser tab. Click any recent session to see its full path.
- Replaced the static "Recommended Insights To Track Next" list on the Dashboard with a real, computed **Insights** section: month-over-month growth, quote-to-sale conversion rate, revenue by category (books vs. single-teacher licenses vs. school/group licenses), days sales outstanding, customer lifetime value, and invoice cancellation rate.

## Release 10 — 2026-07-04 — Bounce/undelivered tracking, click tracking, and per-campaign activity view

- **Bounce/undelivered classification**: a failed send is now recorded as "Bounced" (the mail server permanently rejected the address) or "Undelivered" (a temporary failure or connection issue) instead of one generic "failed" bucket.
- **Link-click tracking** for HTML campaigns: every link in the email body is rewritten to route through a tracking redirect, giving a second, independent signal that an email was actually opened (useful when images are blocked, since pixel tracking alone would miss it).
- **Per-campaign activity view**: click any campaign's subject to see exactly who opened, unsubscribed, bounced, or was undelivered — by email address, not the full recipient list.
- Added a reminder in the campaign composer that open/click tracking only works for HTML campaigns, and Bounced/Undelivered stat cards to the campaigns dashboard.

## Release 9 — 2026-07-04 — Orders dashboard, sales date range, and dashboard polish

- **New Orders dashboard** (`admin-orders.html`, nav link under Licenses): every purchase across every contact, newest first, with a date-range filter. The Financial Insights "N orders" figures on the main Dashboard now link directly into it (Sales Today → today's orders, Sales All-Time → everything).
- **Sales Over Time** now supports a custom start/end date range instead of a fixed 14-day window (still the default).
- **Dashboard sections are collapsible** — Financial Insights and Content can each be hidden, remembered per browser.
- **Campaigns can be duplicated** — a new "Duplicate" action creates a fresh Draft copy of any campaign's subject/body/format/audience, leaving the original's send history and stats untouched.
- Fixed the open-tracking pixel's reliability (some mail clients skip fetching images that are never rendered) and clarified in the campaign list/detail view that plain-text campaigns show "N/A" for opens rather than a misleading "0" — a plain-text email has no HTML to carry a tracking pixel at all.

## Release 8 — 2026-07-04 — Contacts column picker & campaign analytics

- **Contacts Management** (`admin-newsletter.html`): a "🔧 Columns" picker lets the admin choose which table columns to show or hide, remembered per browser. (Ascending/descending column sorting already existed and needed no changes.)
- **Email campaigns now track opens and unsubscribes per send.** A new `campaign_sends` table logs one row per (campaign, recipient) attempt. A tracking-pixel endpoint records opens on HTML campaigns; unsubscribe links now attribute the click back to the specific campaign that caused it. Campaign list, stat cards, and the View Campaign modal all surface Sent/Opened/Open Rate/Unsubscribed.
- Open tracking is pixel-based (plain SMTP has no delivery/open webhooks), so it's directional, not exact — flagged directly in the admin UI.

## Release 7 — 2026-07-04 — Financial Insights dashboard

- **Resend Invoice**: a new action on `admin-invoices.html` emails the invoice (line items + total) to the buyer again.
- **Financial Insights** section added to the main admin Dashboard: sales today/this week/this month/all-time, revenue collected vs. outstanding, average order value, a 14-day sales chart, best-selling item, invoices issued (with paid/unpaid/cancelled breakdown), quotes issued, and active customers in the last 30 days — plus a list of recommended future insights (month-over-month growth, quote-to-sale conversion, revenue by category, days-sales-outstanding, customer lifetime value, cancellation rate).
- "Request a Formal Quotation" submissions are now stored in the database (`quote_requests` table) — previously email-only with no record kept, so "Quotes Issued" is a real number.

## Release 6 — 2026-07-04 — Site-user accounts consolidated into the CRM

- Site-user account status (registered/verified, send password reset, delete account) now lives directly on the matching CRM contact's Edit modal instead of a separate "Registered Site Users" page in Settings — the two records are linked by email since there's no formal database relationship between them.
- Added an ad-hoc "resend verification email" action to every CRM contact row.
- Renamed the CRM page from "Newsletter CRM" to "Contacts Management."

## Release 5 — 2026-07-03 — Contact forms, curriculum resources, and checkout refinements

- "Ask The Fixer" and "Request a Formal Quotation" forms now actually send an email to `admin@fixernationeducation.com` — both were previously non-functional stubs that only showed a fake success message.
- Curriculum builder: replaced the free-text "Estimated Duration" field with structured Lessons/Weeks number fields, and added a distinct file upload per Included Resource (previously all resources pointed at one shared document).
- Lesson quiz: answer options are now lettered (A, B, C…) without revealing the correct answer inline; a separate Answer Key section lists correct answers at the bottom of the quiz.
- Admin invoices: added Cancel (soft, keeps any granted seats/licenses intact) and Delete (hard) actions.
- Cart checkout: school email is only requested for license-product purchases — a book-only order uses the logged-in customer's own account email instead.
- Fixed book-card action buttons (Details/Amazon/Add to Cart) rendering at unequal widths; they now wrap to two lines instead of truncating.
- Real Amazon per-format pricing (Kindle/Hardcover/Paperback) replaces the old generic bulk-pricing tiers on all 4 book detail pages — only formats that actually have a price show up.

## Release 4 — 2026-07-03 — Admin nav, licensing, and invoicing polish

- Alphabetized the admin sidebar nav and moved Settings to the bottom.
- Added "Call For Quote" pricing for license orders over 1,000 seats.
- Added an admin-invite system (email-verified, token-based) so a new admin can be added without sharing the single login.
- Regrouped the admin nav: Dashboard isolated at the top, a divider, then the content-management pages.
- Added invoicing for Purchase Order (PO) checkouts — auto-numbered invoices (`INV-00001` style), a printable invoice view, and Mark Paid/Unpaid that cascades to every purchase the invoice groups.

## Release 3 — 2026-07-03 — CRM overhaul, license catalog, and Purchase Orders

- Added phone, company, and notes fields to CRM contacts, plus a one-off script that imported a real 4,022-contact list from a Constant-Contact-style export.
- Overhauled the CRM contacts table: real search, filtering, sorting, and pagination (previously an unfiltered flat list).
- Added an admin-editable license product catalog (`admin-licenses.html`), a real shopping cart (`cart.html`, works across books and license products together), and a Purchase Order checkout path that grants access immediately without requiring a card.
- Added school-domain license lookup and management for admins — search a school's email domain to see their whole seat roster, adjust seat count, or delete the license entirely if they cancel.
- Full admin editing of customer accounts and licensing (not just add/delete): edit a purchase's notes/seat count, manually register or unregister a seat, edit a customer's name/email, or trigger a password reset on their behalf.

## Release 2 — 2026-07-02 to 2026-07-03 — Licensing & purchase-tracking foundation

- Added purchase/license tracking to the CRM: an admin can log a book, single-teacher-license, or group-license purchase against any contact; group licenses generate open seats that a school administrator fills with teacher emails, either from the admin CRM or self-service (`my-license.html`).
- Signing up with an email that matches a pending seat auto-claims it — the mechanic that drives license-based page access.
- Curriculum lesson documents and quizzes are now gated behind an active teacher license (public preview content — theme, objectives, overview — stays visible either way).
- Built (but not yet deployed — see Unreleased above) self-service Stripe checkout for individual teacher licenses.
- Bulk-imported 71 "Morning Boost" lesson-plan curricula as drafts, ready for review.

## Release 1 — 2026-07-02 — Real backend foundation

- Replaced the original browser-`localStorage`-only admin demo with a real Node/Express + MariaDB backend, hosted on Hosting.com/cPanel.
- Real JWT-cookie admin authentication (replacing a client-side-only demo login with a password visible in page source).
- Wired Books, Curriculum Builder, Blog, Newsletter CRM, and Email Campaigns admin pages to the real database-backed API.
- Real SMTP email sending for campaigns (previously simulated — "Send Now" just logged a fake timestamp).
- Public site-user accounts: sign up, email verification, log in/out, forgot/reset password — with a shared login/signup modal rolled out to every public page.
- Wired book detail pages to the real book records (price, stock status, description, cover, Amazon link).
- Assorted fixes: HTTPS redirect, cache-busting for shared admin JS/CSS, consistent admin nav labels, "View Site" links opening in a new tab.
