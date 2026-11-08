# Release notes: Graduate Evidence (Release 151)

**Status: DRAFT. Do not send yet.** The release note itself is now a public page on the site (`release-notes.html?note=graduate-evidence`, text in `release-notes.js`); these are the email drafts that point to it. Releases 151 and 152 are live in production (checked 2026-11-07). A Word version of this file, with the same text, is `2026-11-graduate-evidence.docx` in this folder.

## Before you send (internal)

- [ ] **Verify the New York connections** in `admin-standards.html` (after running `node scripts/import-standards.js NY` on cPanel). Until then many attributes show "No Fixer Nation activity is connected to this yet", which would make this note look like a feature that does not work. Send it once the page looks full.
- [ ] **Publish the three how-to videos** (T9 teachers, B11 school administrators, C8 district administrators), then put each link where `{videoLink}` appears below. The re-recorded tour videos B1 and C1 should go up first or at the same time, because their menus now have a Graduate Evidence link.
- [ ] **Read and publish the two draft Help answers** (`graduate-evidence-what`, `graduate-evidence-privacy`) at `help.html?preview=1`, so the note's "questions?" link lands on something.
- [ ] **Look at one real classroom** on the live site (Assignments tab ideas box, Graduate Evidence tab) and confirm literacy games such as Critical Read appear under Try next (they need a grade band set in the database).
- [ ] **The school year is always the current one** (no picker). The ideas box is optional and sits on the Assignments tab; the emails say so.
- [ ] **Confirm the small-group rule still says 10** (setting `pog_evidence_min_group`). The note says "very small groups", so a change does not make it wrong.
- [ ] **Who gets which email.** The teacher email goes to the Teachers group in the CRM. The administrator email goes to school administrators and district administrators (check the group names in `admin-newsletter.html`; there is no group seeded under that name today). Send from Campaigns, so opens and unsubscribes are tracked. Do not send to the sales-demo or QA accounts.
- [ ] **Timing.** Send on a school day morning, not on a Friday afternoon. Teachers can try it straight away, so the same day the videos are live is best.

## Why it matters (the value points, for you)

| Audience | What it gives them | What it replaces |
|---|---|---|
| Teachers | A clear view of which graduate attributes their class has practiced, plus optional ideas for what to assign next (matched to their grade levels, one-click Assign). | Guessing from lesson lists, or building their own tracking sheet. |
| School administrators | One place to see how practice is spread across classrooms and which attributes no activity has reached, plus a printable page for a principal or board. | Asking each teacher for a status update. |
| District administrators | The same picture across all schools, ready for Portrait of a Graduate and social emotional learning reporting. | Asking each school to collect something new. |

Competitor note (internal): other graduate-profile tools ask students or teachers to upload evidence by hand. This one fills in from work students already do in lessons and games, so nobody has extra work. Do not say that in the customer note by name; the value is in the benefit, not the comparison.

---

## The customer note

### Subject lines

- Teachers: New: see which graduate attributes your students have practiced
- School and district administrators: New: graduate attribute practice for your whole school or district

### Email to teachers

Hi {firstName},

Every classroom now has a Graduate Evidence tab. It shows which of New York's graduate attributes and social emotional learning benchmarks your students have practiced this year.

There's nothing extra to do. A student counts once they finish a lesson or game that Fixer Nation connects to an attribute, so it fills in from the work you've already assigned. When you're deciding what to assign next, the Assignments tab can offer a few ideas for the attributes your class hasn't practiced yet. It's only a suggestion, and you choose.

It shows practice, not how well a student did, and student names stay on your usual progress pages.

Here's a short video that walks through it: {videoLink}

The full release note is on our website: https://fixernationeducation.com/release-notes.html?note=graduate-evidence

### Email to school and district administrators

Hi {firstName},

School and district administrators now have a Graduate Evidence page in the portal menu. It shows how many students have practiced each of New York's graduate attributes and social emotional learning benchmarks this school year, and it prints on one page for a principal or a board.

Your teachers don't have to do anything. The counts come from the lessons and games they already assign. You see counts and percentages only, never a student's or a teacher's name, and very small groups are combined so no one can be picked out.

Here's a short video: {videoLink}

The full release note is on our website: https://fixernationeducation.com/release-notes.html?note=graduate-evidence

### Release notes page (for a "What's new" page or a long-form post)

#### Graduate Evidence

Graduate Evidence turns the lessons and games your students already do into a picture of which graduate attributes they have practiced. It uses New York's Social Emotional Learning Benchmarks and Portrait of a Graduate.

**For teachers.** See at a glance which attributes your class has practiced. When you're not sure what to assign next, ask for a few ideas matched to your grade levels, and assign one in a click. There's no extra data entry.

**For school administrators.** See how practice is spread across your classrooms and which attributes no activity has touched yet. Print a one-page report for your principal or board.

**For district administrators.** See the same picture across your schools. Bring evidence to your Portrait of a Graduate or social emotional learning reporting without asking schools to collect anything new.

**What to know.** Graduate Evidence shows evidence of practice: a student finished an activity that Fixer Nation connects to an attribute. It isn't a test, and it doesn't show how well a student did. The connections are Fixer Nation's own mapping, and neither New York State nor CASEL has endorsed them. New York comes first. Some attributes will say that no activity is connected yet while we finish checking connections. Administrators see counts only, and very small groups are combined.

**Where to find it.** Teachers: open a classroom. On the Assignments tab, select Show me ideas under Not sure what to assign? The Graduate Evidence tab shows every attribute. School and district administrators: select Graduate Evidence in your portal menu.

Questions? Use Get help from any page, or see the Help center.
