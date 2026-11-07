# Student data retention and deletion: requirements

Status: **DECISIONS CONFIRMED 2026-11-06 (owner accepted the recommended defaults for D1 to D9, the "about 13 months" Brain Games wording and the "overwritten within 14 days" backup wording).** Phases 0 and 2 are built (Release 146); phases 3 to 5 are not. Written because the owner said student data is purged at the end of the school year, and no such purge existed. Per the project rule, requirements are confirmed before any code for access, privacy or deletion.

## 1. Goal

What Fixer Nation says about how long it keeps student data, and what the system actually does, must be the same thing. Pick the rule, say it once in plain words, then make the code do exactly that.

## 2. What happens today (checked in the code, 2026-11-06)

| Fact | Where |
|---|---|
| **No end-of-year purge exists.** Nothing deletes classrooms, students, progress, quiz answers, reflections or goals on a schedule. | no script; `PROJECT.md` ("nothing else is deleted at expiry") |
| **Removing a student only hides them.** The teacher's "remove" sets `classroom_students.is_active = 0`; the name, PIN hash and every record stay forever. | `routes/classrooms.js` (`DELETE /:id/students/:sid`) |
| **Archiving a classroom only hides it** (`classrooms.archived_at`). Nothing is deleted. | `routes/classrooms.js` |
| **No page or route hard-deletes a student or classroom.** Only a one-off QA cleanup script does. Deleting happens only if staff run SQL by hand. | grep of `routes/`, `lib/` |
| **A license ending deletes nothing.** Seats go inactive; classrooms, rosters and lesson picks stay. | `scripts/expire-school-licenses.js` |
| **A teacher's account closing leaves their classrooms behind.** `classrooms.teacher_site_user_id` has no foreign key, so the students stay with no owner. | `scripts/alter-classroom.js` |
| **The only automatic deletion of student-linked data** is Brain Games activity (`learning_events`) older than 400 days (`learning_events_retention_days`, nightly `purge-learning-events.js`). | `scripts/purge-learning-events.js` |
| **Other automatic deletions** are not about students: support requests after 2 years, error reports after 30 days. | `lib/support.js`, `lib/client-errors.js` |
| **Backups keep deleted data for a while:** 7 days of database dumps, 14 days of changed files. | `scripts/backup-nightly.js` |
| **There is no student data export.** Teachers read progress on screen; the only CSV exports are teacher and invitation lists for school admins. | `routes/school-admin.js` |

### Good news for building a purge

One `DELETE` of a `classroom_students` row already removes nearly everything about that student through foreign-key cascades (section 3). Deleting a `classrooms` row cascades to its students. So the purge is mostly "delete the right classrooms or students, on a schedule, with a safety net", not a large new data model.

## 3. What student data exists

A student is a **classroom-PIN student** (`classroom_students`): a display name, a username, a PIN hash, and a classroom. No email, ever.

| Data | Table | Removed when the student row is deleted? |
|---|---|---|
| Name, username, PIN hash, student number | `classroom_students` | (this is the row) |
| Lesson progress | `student_lesson_progress` | Yes (cascade) |
| Quiz answers, saved drafts | `student_quiz_responses`, `student_quiz_drafts` | Yes |
| Reflections (free text the child wrote) | `student_reflections` | Yes |
| Goals (free text) | `student_goals` | Yes |
| Game completions | `student_game_completions` | Yes |
| Brain Games sessions, progress, badges, streaks, privacy choices | `brain_game_sessions`, `brain_game_user_progress`, `user_brain_badges`, `brain_user_streaks`, `brain_game_privacy` | Yes |
| Learning events | `learning_events` | Yes |
| Parent invitations for the child | `parent_student_invitations` | Yes |
| Parent-to-child link | `parent_classroom_links.student_id` | **Set to null, not deleted** (the parent's own account and classroom link stay) |
| Content safety log (who, which classroom, category, severity; **no student text** is stored, only a short reason) | `safety_scans`, `safety_findings`, `safety_incidents`, `safety_alerts` | **No.** `author_student_id` has no foreign key, so the log keeps a number that points at nothing after the student is gone |
| Staff lookups of student data | `school_audit_log` (by id, no names) | No (by design) |
| Student PIN lockout counters | server memory only | Cleared by restart |

Not student data, and never touched by a student purge: teacher, parent, school-admin and district-admin accounts (`site_users`), purchases and licenses, CRM contacts, support requests, the Community.

## 4. What the public pages say today

- **Help center draft `student-data-retention`** (hidden): "Student data is kept during the school year and purged at the end of it." **Not true today.**
- **Help center `data-deletion`** (published, Release 140): "We will delete any data you ask us to, for any user." True, but done by staff by hand. There is no tool for it.
- **Student Data Privacy page, section 6:** only says schools can submit deletion requests. Silent on how long data is kept. The Privacy Policy points to this page for students.
- **Privacy Policy section 5** covers support requests (2 years), error reports (30 days) and accounts/orders. Nothing about student data.
- The Brain Games 400-day rule is not mentioned anywhere public.

So the only false statement is the hidden draft. The public pages are incomplete, not wrong.

## 5. Access matrix (proposed)

| Action | Student | Parent | Teacher (owns the class) | School admin | District admin | FNE staff |
|---|---|---|---|---|---|---|
| See the date a classroom's data will be deleted | No | No | Yes, own classes | Yes, own school's classes | Yes, own district's (view only) | Yes, all |
| Keep a classroom for another year (change its Academic Year) | No | No | Yes | No (asks the teacher) | No | Yes (on request) |
| Download a class's records before deletion | No | No | Yes, own classes | Yes, own school's classes | No | Yes (on request) |
| Delete one student's data now | No | No | Yes, own class, with a confirmation | No | No | Yes, by request, written to the audit log |
| Delete a whole classroom's data now | No | No | Yes, own class, typed confirmation | No | No | Yes, by request |
| Turn the scheduled purge on or off, change the grace days | No | No | No | No | No | Yes (Settings) |
| See a dry-run list of what the next purge would delete | No | No | No | No | No | Yes |
| Ask for deletion of a child's data | No | Yes (Get help or Contact page) | Yes | Yes | Yes | n/a |

Second-level scope: every classroom or student id in these routes is checked against the verified session (teacher owns the class; school admin's school; district admin's district), 404 never 403. The student session has no route here at all. The two auth systems stay separate.

## 6. Proposed behavior (if the owner chooses to build the purge)

1. **School year.** A school year runs 1 August to 31 July. A classroom's year comes from its Academic Year (Release 133 list). A classroom with no year gets the year it was created in, and the teacher is told what we assumed.
2. **Grace period.** Student data is deleted **60 days after the school year ends** (about 30 September), so teachers have the summer to download records and the start of the next year to move a class forward. The number is a setting (`student_data_purge_grace_days`, default 60).
3. **Keep a class.** A teacher keeps a classroom by editing its Academic Year to the next year. That is the existing Edit Classroom box, so nothing new to learn, and it is deliberate.
4. **Warnings.** A banner on the teacher's Classrooms page from 1 July, then reminders by email at 60, 30 and 7 days before deletion (a new automation, sent through `fireAutomation`). The banner names the classes and the date. Parents are not emailed (their view comes from the school).
5. **Download.** A teacher can download one classroom's records as a CSV: lesson completion, quiz scores, game completions. Reflections and goals are a separate checkbox, since they are the child's own words. Names are included because the teacher already sees them.
6. **The purge.** A nightly cron script, `purge-student-data.js`, **dry run by default** (`--apply` to delete), like the other one-off scripts. It lists each classroom due, then deletes in one transaction per classroom: the classroom's students (cascades do the rest, with explicit deletes as a backstop so tests can prove it), the parent links for those students, and parent invitations. The classroom shell (name, grade level, year, teacher, archived) stays so teachers see an empty, labeled class. The scheduled run is off until the owner switches it on (`student_data_purge_enabled`, default off) and has read one dry-run report.
7. **Removed students.** When a teacher removes a student, their data is deleted after **30 days** (undo possible inside that window), instead of kept forever.
8. **What stays after a purge.** (a) The classroom shell. (b) A **de-identified year summary** per classroom (number of students, lessons completed, quiz percent correct, games played; no names, no ids) so school and district reports and our own "no outcome research yet" gap do not lose their history. (c) The content safety log, with the student number left dangling, for **2 years**, then deleted (same period as support requests). (d) The audit log by id, no names.
9. **Backups.** Deleted data remains in the nightly dumps for up to 7 days and in changed-file copies for up to 14. The public statement says "backup copies are overwritten within 14 days". The same rule must apply when offsite backups are built.
10. **Audit.** One `school_audit_log` row per classroom purged: classroom id, count of students and rows, no names or text.
11. **Orphans.** Classrooms whose teacher account is gone follow the same schedule, so they do not live forever.

### Rules that must not erode

- The purge deletes only `classroom_students` data and its dependents. It never touches `site_users`, `purchases`, licenses, CRM, support requests or the Community.
- Dry run is the default. The scheduled job does nothing unless the setting is on.
- A student session (PIN login) has no way to start, stop or see a purge.
- A classroom's own year decides its date. Staff cannot silently shorten it; they can only change the grace setting (logged).
- The sales demo and QA accounts follow the same code path (tests use them), but real schools are never used for testing.
- Public wording changes in the same release as the behavior it describes, never before.

## 7. Wording

**Right now (no code change, one small static release).** Publish the Help center answer and add a paragraph to Student Data Privacy section 6 that matches today:

> We keep student information while a school uses Fixer Nation. When a teacher removes a student, the student is hidden but not erased. We delete a student's data, or a whole classroom's, when the school or a parent asks, for any user. Brain Games activity older than about 13 months is deleted automatically. Backup copies are overwritten within 14 days.

**After the purge is live.** Replace it with the rule in section 6 (deleted about 60 days after the school year ends, with a download first; teachers can keep a class; de-identified totals remain). All visible copy goes through the humanize step before publishing.

## 8. Build plan

| Phase | What | Needs |
|---|---|---|
| 0 | **Built (Release 146).** Interim wording on the Help center and Student Data Privacy page. Static files only. | |
| 1 | **Done.** Decisions D1 to D9 accepted | |
| 2 | **Built (Release 146).** `scripts/report-student-retention.js` (read-only, counts only) and `lib/student-retention.js` (the date rules the purge will reuse). Run it on production and read it before phase 3. | |
| 3 | Teacher download (CSV), the banner and the three reminder emails, the 30-day removed-student rule | Phase 1 |
| 4 | `purge-student-data.js` (dry run default), settings, audit rows, cron line, a read-only status block for staff | Phases 2 and 3, and the owner reading one dry-run report |
| 5 | Switch the public wording to the real rule; video check (S3 goals and history, T3, T6 and any that show removing a student) | Phase 4 live |

Tests (real SQL via `node:sqlite`): a classroom due is purged and one not due is untouched; a kept class (year moved forward) survives; dry run deletes nothing; a second run changes nothing; parents and teachers survive; the parent link's `student_id` becomes null and no parent account is removed; the audit row has no names; removed-student timing; a classroom with no year; route scope (404 for another teacher's class).

## 9. Decisions (all accepted as recommended, 2026-11-06)

| # | Question | Recommended default |
|---|---|---|
| D1 | Build the year-end purge, or change the wording to match today and stop there? | Both, in order: interim wording now (phase 0), then build the purge |
| D2 | When does deletion happen? | 60 days after 31 July for that classroom's school year (about 30 September); a setting |
| D3 | Classroom with no Academic Year | Use the school year it was created in, and tell the teacher |
| D4 | How does a teacher keep a class for another year? | Move its Academic Year forward (existing Edit Classroom box); no cap on how many times |
| D5 | What survives a purge? | Classroom shell and de-identified year totals; safety log 2 years; audit log |
| D6 | Teacher download before deletion | Yes, CSV of progress; reflections and goals as a separate tick box |
| D7 | Students a teacher removes | Deleted 30 days later (undo inside that window) |
| D8 | Deleting when a license ends (district contracts often ask for deletion "on termination") | Not automatic; on request within 90 days, said plainly in privacy paperwork |
| D9 | Send reminder emails to teachers at 60, 30 and 7 days before | Yes; school admins see the same list on their dashboard, no emails to them |

Also confirm: the 13-month wording for Brain Games activity (the code says 400 days), and whether the public statement may say "backup copies are overwritten within 14 days".

## 10. Notes for phase 3 (found while building phase 2)

- **There is no record of when a student was removed.** `classroom_students` has only `is_active`, so the 30-day rule (D7) needs a new `removed_at` column (an `alter-*.js` script, also in `schema.sql`). Students already removed have no date: treat them as removed on the day the column is added, so they are deleted 30 days after that, not immediately.
- The report counts removed students separately so we can see how many exist before deciding nothing more is needed.
- Phase 4's purge reuses `lib/student-retention.js` (`classroomSchoolYear`, `purgeDate`, `isDue`) so the report, the banner, the emails and the purge cannot disagree.

## 11. Not decided here

- Parents' right to inspect records (the `ferpa-requests` draft): a separate answer, but the teacher download in phase 3 is the first tool that can serve it.
- Offsite backups and their retention (separate backlog item; must match section 6, point 9).
- Deleting a teacher's or parent's own account data on request (works today by staff action; no change proposed).
