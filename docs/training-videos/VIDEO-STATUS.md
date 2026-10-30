# Help video status

One row per video. Update it in the same commit as any change that touches a video's files (see `video-watch.json`).

How the check works: before every commit, run `node server/scripts/videos-to-review.js` with the changes staged. It lists the videos whose files changed. For each **recorded** one, decide: still correct, or needs re-recording. Write the outcome here and tell the user. Planned videos only need their notes updated.

Status values: `Planned`, `Recorded`, `Needs re-record` (say what changed), `Re-recorded`.

| ID | Video | Group | Status | Last checked (commit) | Notes |
|---|---|---|---|---|---|
| D1 | Accept your quote | Getting started | Planned | | |
| A1 | Your welcome email and first sign-in | Getting started | Planned | | |
| A2 | Forgot your password, or the link expired | Getting started | Planned | | |
| A3 | Which sign-in page do I use? | Getting started | Planned | | |
| B1 | A tour of the School Admin portal | School license administrators | Planned | | |
| B9 | Permission levels and getting help | School license administrators | Planned | | |
| B10 | Why can't I invite teachers yet? | School license administrators | Planned | | |
| B2 | Invite a teacher | School license administrators | Planned | | |
| B3 | Invite many teachers with a CSV | School license administrators | Planned | | |
| B4 | Manage invitations | School license administrators | Planned | | |
| B5 | Manage your teacher roster | School license administrators | Planned | | |
| B6 | Brand your school | School license administrators | Planned | | |
| B8 | Safety alert recipients | School license administrators | Planned | | |
| B7 | Reports and exports | School license administrators | Planned | | |
| C1 | A tour of the District Admin portal | District administrators | Planned | | |
| C2 | Set district-wide branding | District administrators | Planned | | |
| C3 | See your schools and licenses | District administrators | Planned | | |
| C4 | Invite and manage school administrators | District administrators | Planned | | |
| C5 | Record your Portrait of a Graduate (part 1) | District administrators | Planned | | |
| C6 | Suggest connections and submit for review (part 2) | District administrators | Planned | | |
| C7 | What the public sees | District administrators | Planned | | |
| T1 | Accept your school's invitation | Teachers | Planned | | |
| T2 | Register with your school email | Teachers | Planned | | |
| T3 | Create a classroom and add students | Teachers | Planned | | |
| T6 | Reset a student's PIN and invite a parent | Teachers | Planned | | |
| T4 | Assign lessons and brain games | Teachers | Planned | | |
| T5 | Read progress and student reflections | Teachers | Planned | | |
| S1 | Join your class and sign in | Students | Planned | | |
| S2 | Do a lesson and play a brain game | Students | Planned | | |
| S3 | Goals and history | Students | Planned | | |
| P1 | Accept your invitation and see your child's progress | Parents | Planned | | |
