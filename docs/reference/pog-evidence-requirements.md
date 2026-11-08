# Graduate Evidence report (Portrait of a Graduate and SEL evidence of practice): requirements

Status: **D1 to D9 CONFIRMED by the owner on 2026-11-07 (all as recommended). Phases 1 to 4 built the same day, not yet committed or deployed; phase 0 (verifying the New York connections) and phase 5 (snapshot at purge) are open.** Per the project rule, access, privacy and student-data features get requirements and an access matrix confirmed before any code.

Owner decisions already made (2026-11-07): the claim language is **"evidence of practice"**; start with **New York** only (the first district and its teachers are in New York); idea 2 ("My Graduate Portrait") comes after this, planned with all three persistence options including the lifelong portrait.

## 1. What this is

A report that joins two things FNE already holds:

- **Verified connections** (`standards_alignments`): this lesson or game connects to this New York SEL benchmark or Portrait of a Graduate attribute, `direct` or `supporting`, with a written rationale a person verified.
- **Student activity**: lessons finished, games finished.

It answers, with no uploading by anyone: **"How many students in this classroom, school or district have practiced each graduate attribute, and where is there nothing yet?"** Teachers also get the next step: a suggested activity for each gap, assignable in one click.

## 2. The claim, and what we never say

Everything the report shows is **evidence of practice**: a student finished an activity FNE connects to an attribute. It is not mastery, growth, a score, or a measure of the student's skill.

- Allowed: "62% of students have practiced Empathy" or "completed an activity connected to".
- Never: "62% are empathetic", "mastered", "proficient", "achieved", "growth", "score", or a rating of any student.
- The connection is **FNE's own thematic mapping**, not an endorsement or certification by New York State or CASEL (same disclaimer as the public standards page and `research.html`).
- Quiz scores, accuracy, time spent, reflections, goals and game scores are **not** used. A finished activity counts once, however well it went.
- The blueprint rule (section 5.6) already forbids presenting FNE as a validated assessment; this report must read the same way in its headings, tooltips, emails and printed page.

## 3. Definitions

| Term | Meaning |
|---|---|
| Framework | Today: *New York State Social Emotional Learning Benchmarks (Equity Revisions)* (10 benchmarks, 1A to 3C) and *New York State Portrait of a Graduate* (6 attributes: Academically Prepared, Creative Innovator, Critical Thinker, Effective Communicator, Global Citizen, Reflective and Future Focused). Both are shown side by side. |
| Item | One benchmark or attribute. |
| Activity | A lesson (curriculum) or a Brain Game. |
| Finished | Lesson: `student_lesson_progress.completed_at` is set. Game: a row in `student_game_completions` (assigned game) **or** a `brain_game_sessions` row with `status = 'completed'` and `validation_status = 'valid'` (free play). One student finishing the same activity ten times counts once. |
| Practiced an item | The student finished at least one activity whose **verified** connection to that item is `direct`. |
| Touched an item | The student finished at least one `supporting` activity for that item but no `direct` one. Shown separately and lighter, never added into "practiced". |
| Students counted | Active students (`classroom_students.is_active = 1`) in the classroom(s) in scope. Removed students are left out of both the top and the bottom of every percentage. |
| Period | A school year, 1 August to 31 July (same rule as `lib/student-retention.js`). Default: the current school year; the previous year is selectable. Activity is placed by its finish date. |
| No connection yet | An item with **no verified connection of that kind** shows "No FNE activity connected yet", never 0%. Zero practice and no content are different facts and the report must not blur them. |

**Grade versions.** A lesson connection is a claim about the lesson and applies to every grade version (K-5, 6-8, 9-12), expanded through `lessonVersionsByStem()` in `lib/standards.js`. A student who finishes the elementary copy counts. Higher-education copies are never counted toward K-12 items.

## 4. Rules that must not erode

1. **Only verified connections in a verified framework count.** Enforced in the SQL (`review_status = 'verified'` on the alignment and on its framework), not in the page. A draft can never move a number. (Same rule as every public standards query.)
2. **The state-framework path filters `district_id IS NULL`.** A district's own framework is out of scope for the first version (section 10) and must not leak into state numbers.
3. **No student is ever named or identifiable in a school or district view.** Counts and percentages only.
4. **Small groups are hidden.** In school and district views, any figure computed from fewer than **N students** (setting `pog_evidence_min_group`, default 10) shows "Fewer than N students" instead. A classroom smaller than N is folded into its school total; a school smaller than N is folded into the district total. A teacher's own classroom is exempt (the teacher already sees those students).
5. **Reflections, goals, quiz answers and game scores never enter this report.** Not even counts of them.
6. **Parents, students and anonymous visitors have no access.**
7. **Sales-demo accounts**: the demo district can run the report on its demo data (useful in a demo); demo data never mixes into anyone else's numbers because every query is scoped to the viewer's own classrooms, school or district.
8. **Every query is scoped by the viewer**, resolved server-side from the verified session, never from a client-sent classroom, school or district id alone. A second-level id (`:classroomId`) is checked against the verified parent (teacher owns it; classroom belongs to a school or district the admin controls). Someone else's id answers 404, never 403.
9. **Nothing here writes student data.** The feature reads. The only write is the de-identified year snapshot (section 7).
10. **Randomness, rate limits, errors**: follow `CLAUDE.md` (no `jwt` calls; `typeof` check on request input before regex; `lib/rate-limit.js` on the endpoints).

## 5. Access matrix (role by view)

| Role | Own classroom | A school | A district | Printable report | Assign a suggested activity |
|---|---|---|---|---|---|
| Teacher with a working license | YES (own classrooms only; archived ones within the chosen period) | NO | NO | own classroom only | YES, to their own classroom, with the existing assignment rules |
| School admin | NO | YES, the schools in their `purchaseIds` (same scope as the existing activity report) | NO | YES | NO |
| District admin | NO | YES, schools in their district | YES, own district only | YES | NO |
| FNE admin (`requireAuth`) | YES (any, for support) | YES | YES | YES | NO |
| Teacher without a working license | NO | NO | NO | NO | NO |
| Student, parent, anonymous | NO | NO | NO | NO | NO |
| Sales-demo account | demo data only | demo only | demo only | demo only | demo only |

A teacher whose classrooms span two licenses sees all their classrooms; a school admin sees only classrooms of teachers holding a seat on the school's purchase (the path `routes/school-admin.js` already uses). A school admin never sees another school's classrooms.

## 6. What each person sees

**Teacher (a "Graduate evidence" card on the classroom page).** For the selected classroom and school year: the 6 attributes and 10 benchmarks, each with "practiced by 14 of 22 students", a lighter "touched by 3 more", or "No FNE activity connected yet". Under each item that is low or empty: up to three **suggested activities** (verified `direct` first; matching the classroom's grade level for lessons and the game's grade band for games; not already assigned), each with an **Assign** button that uses the existing assignment endpoints (`classroom_assignments` for lessons, `classroom_game_assignments` for games). No new student-name list: names stay on the existing progress pages.

**School admin and district admin (a "Graduate Evidence" page).** Per item: the percent of students practiced, by school (district admin) or by grade level and classroom (school admin), with the small-group rule applied; a "classrooms with no practice yet" count (a number, not a list of teachers); the framework name with its source link and the date FNE verified it.

**Printable report** (one letter page, auto-fit, same approach as `state-onepager.html`): framework name and link, period, the definition of "evidence of practice", per-item figures, the "FNE's own mapping, not an endorsement" line, groups hidden by the small-group rule footnoted, date generated. It has no signature and no claim that a district has "met" anything.

## 7. Retention fit (student-data-retention-requirements.md, decision D5)

Student records are purged about 30 September after the school year ends, but **de-identified year totals survive**. This feature depends on that: when the purge ships (retention phase 4), it must first write one row per classroom, school year and item: students counted, practiced, touched, activities finished. No student id, no name. The report reads the live data for the current period and the snapshot for any period after a purge, so last year's report still prints after the data is gone. Until the purge exists, everything is live. Snapshot rows are never recomputed after a purge.

## 8. Dependencies on data we do not have yet (blocking)

The report is only as true as the verified connections behind it. From the New York research file (`server/data/standards/NY.json`, 35 draft connections; production may have more through the admin):

| Item | Connections in the research file | Direct? |
|---|---|---|
| SEL 1B Identity and agency, 2B Similarities and differences | none | n/a |
| PoG Academically Prepared, Creative Innovator | none | n/a |
| SEL 2A Empathy, 2C Communicating across difference, 3C Acting for the community | supporting only | no direct |
| PoG Effective Communicator, Global Citizen | supporting only | no direct |

`docs/tune-your-brain/SEL_POG_COVERAGE.md` already maps 25 live games to the New York benchmarks (including direct links for 1B and 2B), but it is a draft and "nothing here is entered in the crosswalk". About 40 games were also added after the crosswalk was researched. **Phase 0 is data work: I draft the missing New York connections (games and lessons) with rationales; the owner verifies them in `admin-standards.html`.** Until then the report shows "No FNE activity connected yet" for those items, which is honest, and the sales story should not promise all 16 items.

## 9. Decisions to confirm

| # | Question | Recommended |
|---|---|---|
| D1 | What counts as "practiced"? | At least one finished `direct` activity; `supporting` only counts as "touched", shown lighter and kept separate. |
| D2 | Smallest group shown outside a teacher's own classroom | 10 students, a setting (`pog_evidence_min_group`). |
| D3 | Does the teacher card list students who have not practiced an item? | No. Counts plus suggested activities; names stay on the existing progress pages. |
| D4 | Period | School year, 1 August to 31 July. **Changed 2026-11-07 (owner): always the current school year, worked out from today's date; no year picker anywhere, and a `?year=` in a URL is ignored.** |
| D5 | Show both New York frameworks together | Yes, side by side: SEL benchmarks and Portrait of a Graduate. |
| D6 | Count free play as well as assigned games | Yes, any finished valid game session counts, once per game per student. |
| D7 | Who verifies the New York connections I draft | The owner, in the admin, as for every crosswalk row; this is phase 0 and blocks a trustworthy launch. |
| D8 | Year snapshot at purge | De-identified totals per classroom, school year and item, kept indefinitely (consistent with retention D5), written by the purge before it deletes. |
| D9 | The demo district runs the report on demo data | Yes. |

## 10. Out of scope (this version)

Mastery or growth claims; any per-student score; states other than New York; **a district's own framework** (the tables already support it through `standards_frameworks.district_id`, and the report's framework parameter is designed to take one later; each district needs FNE to write and verify the rationales first); server-side PDF generation (the printable page uses the browser's print); email digests; the student-facing portrait (idea 2, its own requirements document).

## 11. Build phases

| Phase | What | Needs |
|---|---|---|
| 0 | Draft the missing New York connections; owner verifies them in the admin | D7 |
| 1 | `lib/pog-evidence.js`: the join as plain portable SQL (no `NOW()`, no `ON DUPLICATE KEY`), unit tests on `node:sqlite` covering: draft connections never count, grade-version expansion, finish-once, removed students, small-group suppression, demo isolation, every access-matrix row | D1 to D6 |
| 2 | Teacher card and "Assign" on the classroom page, plus routes with scope checks and rate limiting | |
| 3 | School and district admin page, nav entry (bump the version number on the shared nav files), printable report | |
| 4 | Help center answer (draft until the owner reads it), `videos-to-review.js` check, CHANGELOG, `PROJECT.md`, Mission Control wording | |
| 5 | De-identified snapshot written by the retention purge | retention phase 4 |

New settings: `pog_evidence_min_group`. New tables: none until phase 5 (`pog_evidence_snapshots`). No Node restart is needed for static pages; routes need one.

## 12. As built (2026-11-07)

- **Library** `server/lib/pog-evidence.js` (tests: `test/pog-evidence.test.js`, 15) and **routes** `server/routes/pog-evidence.js` mounted at `/api/graduate-evidence` (tests: `test/pog-evidence-routes.test.js`, 10, covering every row of the access matrix). Teacher: `GET /classroom/:id`. School admin: `GET /school?purchaseId=`. District admin: `GET /district?districtId=`. FNE staff: `GET /staff/classroom/:id`, `/staff/school/:purchaseId`, `/staff/district/:districtId` (same small-group rule). All answer 404 for an id outside the viewer's scope, 400 for a bad `?year=`.
- **Screens:** a "Graduate Evidence" tab on `teacher-classroom.html` (with one-click Assign using the existing assignment routes); `school-admin-evidence.html` and `district-admin-evidence.html` (nav entries added, nav scripts bumped to school-admin-nav v25 and district-admin-nav v11). The admin pages print cleanly (browser Print; no server PDF). Shared drawing code: `graduate-evidence-view.js?v=1`. Two draft Help answers (`graduate-evidence-what`, `graduate-evidence-privacy`), `help-center.js?v=11`.
- **Labels:** a school's groups are "Classroom 1, 2, ..." (never a name a teacher typed); a district's groups are its schools.
- **Setting:** `pog_evidence_min_group` (default 10, clamped to 5 to 100 in code so it cannot be switched off). There is **no admin screen for it yet**; it is changed in the settings table.
- **Not built:** the year snapshot at purge (phase 5, waits for retention phase 4); a district's own framework; states other than New York (the library takes a state code, the routes pass 'NY').

## 13. Addendum, 2026-11-07 (Release 152): the optional "ideas" box and the current school year

Owner decisions: (1) offer the evidence at the moment a teacher decides what to assign, as an option the teacher chooses to use; (2) the school year is always the current one, with no picker.

- **Placement.** The Assignments tab opens with a card, "Not sure what to assign?", collapsed until the teacher selects "Show me ideas". The Assign Lesson and Assign Brain Game pickers carry a "Not sure what to assign? Get ideas" link that closes the picker and opens the card. The Graduate Evidence tab (every attribute) sits right after Assignments, and the card links to it ("See every attribute").
- **What it suggests** (`bestNextSteps` in `lib/pog-evidence.js`, returned as `nextSteps` by `GET /api/graduate-evidence/classroom/:id`): up to three verified `direct` activities, chosen greedily so each pick adds at least one attribute the earlier picks did not; a "gap" is an attribute with a direct activity that not every student has practiced. Ties go to the attribute fewer students have practiced, then games over lessons, then title. Each pick lists the attributes it adds. Matched to the teacher's grade levels, and never anything the classroom already has (any grade version of a lesson counts as already assigned). No AI.
- **Rules that stay:** the claim is evidence of practice; the box says "adds practice for", never "improves", "should" or "behind"; a classroom with no students, or one that has practiced everything connected, gets a plain message instead of picks; nothing is ever assigned without the teacher pressing Assign; no student is named; verified connections only. Access is unchanged (teacher, own classroom, working license).
- **School year.** `currentSchoolYearStart()` decides; every view says "School year 2026–2027" in plain text. The library still takes a year as a parameter (tests, and the later snapshot of past years), but no route accepts one.
