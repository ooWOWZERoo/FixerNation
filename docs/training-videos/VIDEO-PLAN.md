# Training and how-to videos — plan

Agreed 2026-10-29. Short screen recordings (2 to 4 minutes), one task per video, recorded against the sales-demo account so no real school or district appears on screen. Admin onboarding comes first; teachers, students and parents are wave 2.

**Where videos show up**
- A video that belongs to a page is linked on that page (a "How-to video" button, added by `help-videos.js`).
- Every video, linked to a page or not, is on `help-videos.html`, grouped by audience and task.
- The list lives in one file, `help-videos.js`. A video appears on the site only once its `url` is filled in. `help-videos.html?preview=1` shows the whole plan, recorded or not.

**Facts the scripts must respect**
- Sign-in is email and password. There is no separate user ID.
- Admins have no separate email-verification step: setting a password from the emailed link verifies the email and signs them in.
- FNE staff create district admins. School admins come from a purchase, or from FNE or a district admin assigning them.
- The emailed setup link lasts 7 days. "Forgot your password?" sends a 1-hour link.
- School admin levels: Primary (everything), Secondary (can invite but not revoke or remove), Read Only (no changes).
- Microsoft sign-in is on the public login window only, not on the school or district admin login pages.

## Wave 1: admin onboarding

| ID | Video | Page it belongs to |
|---|---|---|
| A1 | Your welcome email and first sign-in | reset-password.html |
| A2 | Forgot your password, or the link expired | school-admin-login.html, district-admin-login.html |
| A3 | Which login page do I use? | teacher-login.html, school-admin-login.html, district-admin-login.html |
| B1 | A tour of the School Admin portal | school-admin-dashboard.html |
| B2 | Invite a teacher | school-admin-invitations.html |
| B3 | Invite many teachers with a CSV | school-admin-invitations.html |
| B4 | Manage invitations | school-admin-invitations.html |
| B5 | Manage your teacher roster | school-admin-roster.html |
| B6 | Brand your school | school-admin-branding.html |
| B7 | Reports and exports | school-admin-reports.html |
| B8 | Safety alert recipients | school-admin-org.html |
| B9 | Permission levels and getting help | school-admin-org.html |
| B10 | Why can't I invite teachers yet? | school-admin-invitations.html |
| C1 | A tour of the District Admin portal | district-admin-dashboard.html |
| C2 | Set district-wide branding | district-admin-branding.html |
| C3 | See your schools and licenses | district-admin-schools.html |
| C4 | Invite and manage school admins | district-admin-schools.html |
| C5 | Record your Portrait of a Graduate (part 1) | district-admin-standards.html |
| C6 | Suggest connections and submit for review (part 2) | district-admin-standards.html |
| C7 | What the public sees | district-admin-standards.html |
| D1 | Accept your quote | accept-quote.html |

Suggested first batch if we film in stages: A1, A2, B1, B2, B4, C1, C3, C4, D1.

## Wave 2: teachers, students, parents

| ID | Video | Page it belongs to |
|---|---|---|
| T1 | Accept your school's invitation | school-invite-accept.html |
| T2 | Register with your school email | education-schools.html |
| T3 | Create a classroom and add students | teacher-classrooms.html, teacher-classroom.html |
| T4 | Assign lessons and brain games | teacher-classroom.html |
| T5 | Read progress and student reflections | teacher-classroom-progress.html, teacher-game-report.html |
| T6 | Reset a student's PIN and invite a parent | teacher-classroom.html |
| S1 | Join your class, then sign in with username and PIN | student-login.html |
| S2 | Do a lesson, a quiz and a brain game | student-home.html, student-lesson.html |
| S3 | Goals and history | student-achievements.html |
| P1 | Accept your invitation and see your child's progress | parent-invite-accept.html, parent-portal.html |

## How the videos are made (same approach as the Fixer Nation Org project)

Decided 2026-10-29. Each video is a **storyboard**: a TypeScript file in `tests/howto/storyboards/<ID>.ts` listing steps. Every step has a line of narration and, optionally, a browser action.

- **Narration:** the macOS voice **Ava (Premium)** at **165 words per minute** (agreed range 160 to 165; `HOWTO_RATE` overrides). One clip per step, so the on-screen action always lines up with what is being said.
- **Recording:** Playwright records a 1280x720 browser with a visible cursor and click ripple, gliding mouse moves and readable typing. `tests/howto/pipeline.ts` is ported from the Org project.
- **Assembly:** ffmpeg (the `ffmpeg-static` npm package, nothing to install) lays each clip at its step's start, compresses to 720p (about 2 MB a minute and a half), and writes a poster image and a WebVTT caption file from the same timings.
- **Where it records:** a **local throwaway copy of the site** (`tests/howto/stack.sh up`: Docker MariaDB, the real server, and a mail catcher), never production. The fictional Riverbend School District data comes from `tests/howto/seed-demo.js`. Emails the site sends land in the mail catcher, and the pipeline shows them on screen from there. Production is never touched; the pipeline refuses a non-local address unless `HOWTO_ALLOW_PROD=1`.
- **Record:** `tests/howto/record.sh B1 B2 ...` (starts a fresh site for each video, so every video starts from the same data). One video: `cd tests && npm run howto -- B1` after `stack.sh up`.
- **Publish:** `cd tests && npm run howto:publish -- B1` copies the captions and poster into `help-assets/` (served by the site), uploads the mp4 to Cloudinary as `fne/help/<ID>`, and fills the video's `url`, `captions` and `poster` into `help-videos.js`. Needs `tests/howto/.env.cloudinary.local` (git-ignored) with the Cloudinary name, key and secret.
- **When a video goes out of date:** `node server/scripts/videos-to-review.js` lists the videos a change could affect; re-run `tests/howto/record.sh <ID>` to remake one.

The `.txt` files in `scripts/` are the first-draft narration for all 31 videos. Where a storyboard exists, the storyboard is the source of truth and the `.txt` is only a draft. `render-narration.sh` renders a draft's audio on its own and is only needed for videos that don't have a storyboard yet.

Storyboards built so far (2026-10-30): all 31 planned videos. All are recorded, uploaded to Cloudinary (fne/help/<ID>) and linked in help-videos.js; they go live when the site is deployed.

Spellings that help Ava: "P-I-N", "C-S-V", "P-O" (say "purchase order" first), "F-N-E", "user I-D", and "support at Fixer Nation Education dot com".

## Where the videos are stored

Decided: **Cloudinary** (the existing account, shared with the Org project, so the free monthly credit pool is shared too; check current terms). The mp4 plays from Cloudinary; the captions and poster are small files in `help-assets/` on the site so captions load same-origin. Videos are recorded at about 2 MB for a minute and a half, so all 31 stay well under 1 GB stored.

- Upload as `fne/help/<ID>` (done by `howto:publish`). Keep the original recordings out of git (`tests/howto-out/` is ignored).
- Add `https://res.cloudinary.com` to `media-src` in the `.htaccess` Content-Security-Policy line (report-only today, so nothing breaks, but it must be there before the policy is enforced).
- Credentials stay in `tests/howto/.env.cloudinary.local`, never in the repo.

## Optional: for FNE staff

Setting up a district (create it, link schools, invite the district admin) and the concierge flow. Internal training, not customer-facing.

## Bugs fixed before filming (2026-10-29)

- Bulk-invite CSV template matched to the uploader (and the uploader accepts old header names).
- Invitations page: "payment pending" banner now shows, the pager works past 25, the bulk result message counts sent, skipped and not-sent correctly.
- A Secondary or Read Only admin pressing a blocked button sees the reason instead of being sent to sign-in (school and district portals).
- Teacher and parent sign-in: working "Forgot your password?" and a resend link for unverified accounts.
- Setup page says "Choose your password" and offers a way to request a new link when the old one has expired.
- Classroom page: usernames and PINs shown once after a roster import; deactivated students can be reactivated; a signed-out teacher goes to the teacher sign-in.
- Teacher self-registration no longer treats a brand-new license as full (test: `server/test/school-registration.test.js`).

Known issues found but not fixed, so scripts should avoid them:
- Seat counts differ between the dashboard, roster and licenses pages. (Each counts a slightly different set of seat states; needs a decision on which count is the one to show.)
- The district dashboard is a stub with one button, and ignores the district picker.
- A PO school needs two FNE staff actions (Mark as Paid, then PO Received) before teachers can be invited.
- The Organization page's co-administrator list includes the signed-in administrator.

Fixed 2026-10-30 (Release 64):
- Resend or Extend on an expired invitation now takes a seat back (and says so if every seat is in use).
- `accept-and-verify` for teacher and parent invites no longer breaks on a Microsoft-only account; it says to sign in with Microsoft.
- The Organization page lists only active co-administrators, labelled Primary, Secondary or Read Only.
- The Licenses page Active filter works.
- Student PINs are checked as 4 to 6 digits on the server (add student, import, reset PIN, join a class).
- The Roster page has an "Invited, not joined yet" filter, and "All teachers" includes them.
- My Licenses no longer says "Nothing on file yet" to a teacher whose seat comes from a school, and shows the School Admin shortcut only to school administrators.
- The teacher classroom and progress pages use in-page dialogs (`fn-confirm.js`) in place of browser pop-ups, so they show in the videos (T3 to T6).
- The Progress page quiz average counts only students who have taken the quiz.

Videos re-recorded for these: B1, B5, B8, B9, T1, T3, T4, T5, T6. Video check outcome: every other flagged video was only touched by the `help-videos.js?v=5` version string or by server changes that show nothing on screen (seat renewal on expired invitations, null-password guard, PIN rules for valid PINs), so they are still correct.

Note: `server/scripts/videos-to-review.js` read `help-videos.js` with a pattern that stopped matching once published entries gained captions and poster fields, so it silently reported nothing for a while (the 2026-10-30 publish commit onward). Fixed in the same commit as this note.

2026-10-30: help-videos.js is now `?v=3` on every page. A3 (which sign-in page) is registered on all five sign-in pages, and B10 (why can't I invite teachers yet) on the Invitations page. parent-login.html now loads help-videos.js. Video check: the changes are only the version string and one added script tag, so no recorded video's content changed.
