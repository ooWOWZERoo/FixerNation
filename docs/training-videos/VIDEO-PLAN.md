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
- Resend or Extend on an expired invitation leaves the seat revoked.
- A Microsoft-only account has no password hash, and `accept-and-verify` (teacher and parent invites) runs `bcrypt.compare` on it without a null check.
- The Organization page lists deactivated co-admins and labels Primary and Secondary both "Full Access".
- The Licenses page "Active" filter returns nothing (it sends `active`, the status is `registered`).
- Seat counts differ between the dashboard, roster and licenses pages.
- The district dashboard is a stub with one button, and ignores the district picker.
- Student PIN length is only checked in the browser.
- A PO school needs two FNE staff actions (Mark as Paid, then PO Received) before teachers can be invited.
