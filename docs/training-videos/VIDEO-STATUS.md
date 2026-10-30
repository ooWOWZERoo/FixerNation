# Help video status

One row per video. Update it in the same commit as any change that touches a video's files (see `video-watch.json`).

How the check works: before every commit, run `node server/scripts/videos-to-review.js` with the changes staged. It lists the videos whose files changed. For each **recorded** one, decide: still correct, or needs re-recording. Write the outcome here and tell the user. Planned videos only need their notes updated.

Status values: `Planned`, `Recorded`, `Needs re-record` (say what changed), `Re-recorded`.

| ID | Video | Group | Status | Last checked (commit) | Notes |
|---|---|---|---|---|---|
| D1 | Accept your quote | Getting started | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/D1.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Starts on the real quote email (sent by acting as FNE staff). Pays by purchase order; the card tab is shown but not used (no Stripe keys on the test site). |
| A1 | Your welcome email and first sign-in | Getting started | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/A1.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| A2 | Forgot your password, or the link expired | Getting started | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/A2.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| A3 | Which sign-in page do I use? | Getting started | Planned | | Script and narration rendered 2026-10-29 |
| B1 | A tour of the School Admin portal | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B1.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| B9 | Permission levels and getting help | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B9.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Recorded as a Read Only administrator (Robin Hale, made off-camera) so the blocked-button message is real. Avoids the Primary/Secondary 'Full Access' label (known issue). |
| B10 | Why can't I invite teachers yet? | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B10.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Recreates the three causes with SQL during recording: unpaid invoice, all seats used, and no school record/domain. Record again after any change to the invitation or dashboard messages. |
| B2 | Invite a teacher | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B2.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| B3 | Invite many teachers with a CSV | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B3.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Uses a made-up 5-row CSV: 3 new teachers, 1 already invited, 1 missing a last name. Downloading the template is pointed at, not clicked (nothing shows on screen). |
| B4 | Manage invitations | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B4.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| B5 | Manage your teacher roster | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B5.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Pending seats never appear on the Roster page (no filter includes them), so the draft's Revoke-a-pending-seat scene was dropped; the video points to the Pending tile and Invitations instead. |
| B6 | Brand your school | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B6.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Uses a made-up Maple Elementary logo drawn off-camera. Branding page now shows its load error in place of the spinner (school-admin-branding.html, 2026-10-30); that only affects the error path, so this video is still correct. |
| B8 | Safety alert recipients | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B8.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Adds a catch-all and a Bullying-only recipient on example.com addresses; the co-administrator list on the page includes the signed-in admin. |
| B7 | Reports and exports | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B7.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. Activity Log paging is shown with 60 extra demo entries added off-camera. Utilization shows only the donut and legend (no plan name or monthly table appear on the demo). |
| C1 | A tour of the District Admin portal | District administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/C1.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| C2 | Set district-wide branding | District administrators | Planned | | Draft script written 2026-10-29. Reset to FNE Default now asks in an in-page dialog ("Yes, reset it"); show it when storyboarding. |
| C3 | See your schools and licenses | District administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/C3.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| C4 | Invite and manage school administrators | District administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/C4.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| C5 | Record your Portrait of a Graduate (part 1) | District administrators | Planned | | Script and narration rendered 2026-10-29 |
| C6 | Suggest connections and submit for review (part 2) | District administrators | Planned | | Script and narration rendered 2026-10-29 |
| C7 | What the public sees | District administrators | Planned | | Draft script written 2026-10-29. Delete framework now asks in an in-page dialog ("Yes, delete it"); the demo district is never public, see the script header. |
| T1 | Accept your school's invitation | Teachers | Planned | | Script and narration rendered 2026-10-29 |
| T2 | Register with your school email | Teachers | Planned | | Script and narration rendered 2026-10-29 |
| T3 | Create a classroom and add students | Teachers | Planned | | Script and narration rendered 2026-10-29 |
| T6 | Reset a student's PIN and invite a parent | Teachers | Planned | | Script and narration rendered 2026-10-29 |
| T4 | Assign lessons and brain games | Teachers | Planned | | Script and narration rendered 2026-10-29 |
| T5 | Read progress and student reflections | Teachers | Planned | | Script and narration rendered 2026-10-29 |
| S1 | Join your class and sign in | Students | Planned | | Script and narration rendered 2026-10-29 |
| S2 | Do a lesson and play a brain game | Students | Planned | | Script and narration rendered 2026-10-29 |
| S3 | Goals and history | Students | Planned | | Script and narration rendered 2026-10-29 |
| P1 | Accept your invitation and see your child's progress | Parents | Planned | | Script and narration rendered 2026-10-29 |
