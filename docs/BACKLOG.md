# Backlog

Things we have agreed to do later. Newest section first. Nothing here is started unless it says so. When an item is done, move it to `CHANGELOG.md` as part of its release and delete it here.

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
- [ ] **Student data retention** (see the Help center section above) must be settled before the Privacy Policy promises anything about it; it deliberately points to the Student Data Privacy page.

## Help center and support (added 2026-11-06)

Where it stands: Help center live with 191 published answers and 18 drafts (Release 125). Support requests, support console, error capture and the Get help videos (published in Release 145) are built. These are the loose ends.

### Needs a decision from the owner

- [ ] **Student data retention.** The owner said student data is purged at the end of the school year. Nothing does that today: the only scheduled deletion is Brain Games activity older than about 400 days (`server/scripts/purge-learning-events.js`). Classrooms, students, progress, quiz answers and reflections stay until a teacher archives or an administrator deletes them. Choose one: (a) write requirements for a year-end purge (a data-handling decision, so requirements and confirmation come first; it would also need a plain-language rule for what "end of year" means and what a teacher can still export), or (b) change the wording to match what really happens. The FAQ answer `student-data-retention` stays a draft until then, and the Student Data Privacy page should be checked at the same time.
- [ ] **Office hours details.** The FAQ says 8 a.m. to 5 p.m., Monday through Friday. Add the time zone, and say whether to list a public email address or phone number (the site has neither today).
- [ ] **Read and decide on the 18 drafts** at `help.html?preview=1`, then publish or change them: `student-data-retention`, `student-no-email`, `student-data-collected`, `student-data-sale-ads`, `ferpa-requests`, `data-deletion`, `privacy-paperwork`, `site-visitor-privacy`, `content-focus`, `parent-preview`, `outcome-evidence`, `casel-alignment`, `teacher-seat-cost`, `teacher-single-license-price`, `quote-response-time`, `setup-time`, `parent-access-cost`, `district-licensing`. (Privacy and legal wording, research claims, prices and promised timings.)
- [ ] **Public pages that disagree with each other** (the FAQ leaves these out until they are settled): whether parents can see quiz scores (`for-parents.html` says yes, the Parents' Bill of Rights says completion only); who can read student reflections (`for-students.html`, the Bill of Rights and `how-it-works.html` differ); whether parents get an invitation or a code (`for-parents.html` versus `education-portal.html`); price statements (`for-schools.html` says contact us, `education-schools.html` shows $149 and $0).
- [ ] **Facts the FAQ still cannot answer** (the site does not say, and the owner has not supplied them): the lesson scope and sequence before buying, how many Brain Games there are and whether they need a login, use at home or offline, languages, security certifications and sub-processor list, nonprofit or charter discounts, how to update billing details or get a receipt, what happens if someone forgets which email they bought with, whether an individual license can be reimbursed by a school or used for more than one classroom.

### Ready to do when the owner says go

- [ ] **Record M5, the staff community-moderation video.** The page now has a Remove button for comments (Release 145), so the video can be planned: storyboard in `tests/howto/storyboards/M5.ts`, entry in `help-videos.js` and `video-watch.json`, then publish with the owner's OK.
- [ ] **Review the Help center answers with fresh eyes after a few weeks of use**: use the anonymous `faq_open` counts (analytics) to see which answers are opened, add answers for the questions people send to Get help instead, and trim ones nobody opens.

### Later, if it proves useful

- [ ] An in-browser editor for Help center answers (today they change through a release in `help-center.js`).
- [ ] Email or text alerts for error spikes (the Errors tab only shows counts today).
- [ ] A read-only "view as" for staff (needs its own access requirements first).
