# Help centre (support phase 4): requirements

Status: BUILT as Release 123 (2026-11-05). Owner confirmed the plan and all five recommended answers. Every first-draft answer is `reviewed: false` until the owner reads it at `help.html?preview=1`. Follows phases 1 to 3 (support requests, support console, error capture). No access control is involved: it is a public page of written answers. What needs confirming is how the content is kept and who approves it.

## Goal

Most people who get stuck have one of a few dozen problems. A searchable page of short, accurate answers (with the matching help video where one exists) lets them fix it themselves, and a clear "Still stuck? Get help" button sends the rest to the support inbox with the right topic already chosen.

## What it is

- **`help.html`** (Help centre): a search box, a row of audience tabs (Everyone, School administrators, District administrators, Teachers, Students, Parents), and a list of questions. Opening a question shows a short answer (2 to 4 sentences, plain words), numbered steps where there are steps, a "Watch the video" button when a recorded help video covers it, and "Still stuck? Get help" (opens `support.html?topic=...`).
- **`help-center.js`** (single list, like `help-videos.js`): every entry has an id, audience, topic, question, answer, optional steps, optional video id, the Get help topic, and `reviewed: true/false`. Visitors see only reviewed entries; `help.html?preview=1` shows the drafts so the owner can read them first. Search matches the question, answer and topic words, in the browser, with no server call.
- **Where it is linked:** footer ("Help centre", beside Help Videos and Get help), the School and District admin portal menus (next to Help videos), the top of the Get help page ("Check these answers first", with the most common ones for the visitor's topic), and the Contact page.
- **What it learns:** opening an answer records an anonymous `faq_open` event with the entry id through the analytics the site already has (no personal data, no new table), so you can see which answers are used and which questions need a new one.

## Content (first draft, about 30 entries, written from how the system really behaves)

Everyone: which sign-in page to use; forgot my password; my reset or verification link expired (reset links last 1 hour, verification links 24 hours); I never got the email; sign in with Microsoft and the confirmation email; my account says it is closed.
School administrators: why I cannot invite teachers yet; an invitation expired or was never opened (resend, extend, revoke); how seats are counted and what happens when a teacher leaves; permission levels; set up school branding.
District administrators: add a school administrator; a school administrator cannot sign in (reset or resend); record the Portrait of a Graduate.
Teachers: accept an invitation; register with a school email; create a classroom and add students; a student cannot sign in (wrong PIN, the 5-try lockout that clears after 15 minutes or by Unlock, reset the PIN); invite a parent and what to do when the link expires; lesson library limits and swaps; community groups.
Students: my PIN does not work or says locked (ask your teacher; they can unlock you); I forgot my username.
Parents: my invitation link does not work (ask the teacher; we can also extend it); what I can see; how my child's data is protected (link to the student data privacy page).

Every answer is checked against the code and the existing help videos before it is marked reviewed. Numbers that an owner can change in Settings (lesson limits, idle times) are written without a number ("your library has a limit; the page shows it").

## Also in this phase

- The **2-year retention delete** for support requests (agreed in phase 1, not yet built): requests and their messages older than 2 years are deleted automatically (done the same way as the 30-day error delete, when a new request arrives), with a line in the audit log. No new page.

## Not in this phase

An admin page to edit answers in the browser (answers live in `help-center.js` and change through a release), translations, chat, a ticket-deflection counter in the inbox.

## Decisions for the owner

1. **Keep answers in `help-center.js` (reviewed by you before they show), not in an admin editor.** Recommended: yes. It matches how help videos work, needs no new tables, and every change is reviewed and versioned. The cost: you ask me to change an answer. An in-browser editor can be a later phase if you want to write answers yourself.
2. **Nothing is public until you review it.** Recommended: yes. I draft all entries, you read them at `help.html?preview=1`, and I flip them to reviewed.
3. **The five link places above.** Recommended: yes.
4. **Record which answers are opened** (anonymous, existing analytics). Recommended: yes.
5. **Include the 2-year delete in this release.** Recommended: yes.

## As built (Release 123)

- `help.html` and `help-center.js` (first draft of 32 answers; see "Seeded in Release 124" below). Everyone shows all; a role shows its own plus the "everyone" ones. Search matches every word in the question, answer, steps and topic.
- Links: footer ("Help center"), `school-admin-nav.js` and `district-admin-nav.js` (menu item, opens `help.html?aud=school` or `?aud=district`), a pointer on `contact.html`, and "Check these answers first" on `support.html` (reviewed answers for the chosen topic; hidden when there are none).
- `faq_open` event: `fnTrackEvent('faq_open', <entry id>)`, so entry ids must never change.
- 2-year delete: `purgeOldRequests()` in `lib/support.js`, called after a new request is saved.
- Answers worth a second look when you review: seat release after removing a teacher, what each administrator level can do (the answer points to the video instead of listing them), and the teacher self-registration answer.
- Support how-to videos G1, G2 and G3 (see `docs/training-videos/VIDEO-PLAN.md`).

## Seeded in Release 124 (2026-11-05)

The Help center showed nothing to visitors because every answer was still `reviewed: false`. It was seeded from four sources (the how-to video scripts, the public pages, the code's own error messages and rules, and the existing list) into **197 answers: 180 published and 17 drafts**. Each published answer was written from a source that states it outright; the numbers were checked against the code (200 invitations per upload, 8-character passwords, 7-day welcome links, 14-day invitations, 5 resends, the 90-day affiliate credit, 3 frameworks with 60 standards, the 2 MB logo, 5 files of 100 MB in Community, the sign-in and join-code limits, the 90 percent seat warning, the 30-day banner and the district dashboard flags).

- Entries are written with `E(...)` (published) or `D(...)` (draft) in `help-center.js`; the header comment explains the fields.
- **Drafts (hidden until the owner reads them at `help.html?preview=1`):** every price, every promise about response or setup time, privacy and data wording taken from the privacy pages, the research and CASEL claims, and the Parents' Bill of Rights wording.
- No answer tells anyone to email us: the site has no public support email. Contact goes through Get help or the Contact page (a test enforces it).
- Found while reading the code: after a trial ends, the Convert to Annual Access button is still shown, but pressing it says "No active trial found." The FAQ explains it; the button probably should be hidden.
- Conflicts between public pages left out of the FAQ: whether parents can see quiz scores (for-parents.html versus the Parents' Bill of Rights), who can read student reflections, and whether parents get an invitation or a code.
- Questions the public pages do not answer (the owner can supply answers): the full price list, refunds and cancellation, a phone number or office hours, supported devices and browsers, Chromebook and iPad use, renewal steps, data retention periods, Google Classroom or Clever and single sign-on, training, accessibility and languages, free trials or demos, the lesson scope and sequence, discounts, tax forms and invoices, security certifications.

## Owner-supplied answers (Release 125, 2026-11-05)

Pricing: contact for a quote. Refunds: case by case. Trials and demos: case by case. Discounts and tax forms: contact for guidance. Renewals: reminders before expiry with full instructions. Office hours: 8 a.m. to 5 p.m., Monday through Friday; reached through the Contact page (replies by email). Devices: any device with a functional browser, Chrome preferred. Training and accessibility: contact for guidance. Google Classroom, Clever and single sign-on: the owner did not know the terms; answered from the code instead (none exist; Microsoft sign-in for adults; usernames and PINs for students).

**Open problem:** the owner's statement "student data is retained during the school year and purged at the end of it" is not what the system does. The only scheduled deletion is Brain Games activity older than about 400 days (`server/scripts/purge-learning-events.js`). Classrooms, students, lesson progress, quiz answers and reflections are kept until a teacher archives or an administrator deletes them. The answer `student-data-retention` is a draft until either a year-end purge is built (a data-handling decision, so requirements first) or the wording is changed to match.
Still unanswered by the owner: a time zone for the office hours, whether a public email address or phone number should be listed.
