# Help video status

One row per video. Update it in the same commit as any change that touches a video's files (see `video-watch.json`).

How the check works: before every commit, run `node server/scripts/videos-to-review.js` with the changes staged. It lists the videos whose files changed. For each **recorded** one, decide: still correct, or needs re-recording. Write the outcome here and tell the user. Planned videos only need their notes updated.

Status values: `Planned`, `Recorded`, `Needs re-record` (say what changed), `Re-recorded`.

| ID | Video | Group | Status | Last checked (commit) | Notes |
|---|---|---|---|---|---|
| D1 | Accept your quote | Getting started | Planned | | Script and narration rendered 2026-10-29 |
| A1 | Your welcome email and first sign-in | Getting started | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/A1.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| A2 | Forgot your password, or the link expired | Getting started | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/A2.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| A3 | Which sign-in page do I use? | Getting started | Planned | | Script and narration rendered 2026-10-29 |
| B1 | A tour of the School Admin portal | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B1.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| B9 | Permission levels and getting help | School license administrators | Planned | | Script and narration rendered 2026-10-29 |
| B10 | Why can't I invite teachers yet? | School license administrators | Planned | | Script and narration rendered 2026-10-29 |
| B2 | Invite a teacher | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B2.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| B3 | Invite many teachers with a CSV | School license administrators | Planned | | Script and narration rendered 2026-10-29 |
| B4 | Manage invitations | School license administrators | Recorded (local) | | Recorded 2026-10-30 on the local test site by tests/howto/storyboards/B4.ts. Not published: not on Cloudinary, no url in help-videos.js yet. Needs the owner\'s review first. |
| B5 | Manage your teacher roster | School license administrators | Planned | | Script and narration rendered 2026-10-29 |
| B6 | Brand your school | School license administrators | Planned | | Draft script written 2026-10-29. Reset to FNE Default now asks in an in-page dialog ("Yes, reset it"); show it when storyboarding. |
| B8 | Safety alert recipients | School license administrators | Planned | | Draft script written 2026-10-29. Removing an alert recipient exists and asks in an in-page dialog; the draft script does not cover removal yet. |
| B7 | Reports and exports | School license administrators | Planned | | Script and narration rendered 2026-10-29 |
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
