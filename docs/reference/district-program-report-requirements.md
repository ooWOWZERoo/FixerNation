# District Program Use Report: requirements

Status: **D1 to D12 CONFIRMED by the owner on 2026-11-08, all as recommended (D11 re-checked against NYSED sources, section 14). Phases 1 to 4 are built (Release 161); phase 5 is the customer-facing set (note published, Help answers and video below).** The owner asked for a district page that shows how well schools, teachers and students are using the SEL and Portrait of a Graduate content, for tracking progress, for background data to submit to the state, and as supporting data for grants and other funding. Per the project rule, access, privacy and reporting features get requirements and an access matrix confirmed before any code.

**Name.** The owner's working name was "District Impact Report". I recommend **"Program Use Report"** instead (D1): "impact" promises outcomes, and everything FNE can report is use and evidence of practice (section 3). A funder who reads "impact" will expect results that FNE cannot supply.

## 1. What this is

One new page in the district portal, `district-admin-program-report.html`, answering three questions for a district administrator, **at school level**:

1. **Reach.** Are the licenses being used? How many teachers, classrooms and students are involved?
2. **Dosage.** How much are students doing, and is it steady through the year?
3. **Standards coverage.** Which New York SEL benchmarks and Portrait of a Graduate attributes are students practicing, and where is nothing connected or practiced yet? (This reuses Graduate Evidence; it does not recompute it.)

It ends with an **evidence packet**: a printable one-page summary, a CSV of the same numbers, and a plain "how we count" page. The packet is what goes to a state office, a board, or a grant application.

## 2. What exists and what is missing (checked in the code, 2026-11-08)

| Need | Today |
|---|---|
| Seats bought, registered, expiring | Yes: district dashboard and schools pages (`lib/seat-counts.js`). This is **license** use, not teaching use. |
| Standards coverage by school | Yes: `district-admin-evidence.html` (Graduate Evidence, with the small-group rule). |
| **Adoption and dosage** (classrooms active, students active, lessons and games finished, by school and month) | **Missing.** The school administrator "activity" report is an audit log of administrator actions; "utilization" is seats. Nothing reports what students do, except through Graduate Evidence. |
| **History** (this year against last, month by month) | **Missing.** Student records are removed after each school year; the Graduate Evidence year snapshot saves attribute totals but nothing reads it yet, and nothing saves adoption totals. |
| Export | Only teacher and invitation CSVs for school administrators. |

The raw material for adoption already exists with timestamps: lessons (`student_lesson_progress.started_at`, `completed_at`), assigned games (`student_game_completions.completed_at`), free-play games (`brain_game_sessions`, valid and finished), assignments (`classroom_assignments`, `classroom_game_assignments`), seats (`license_seats`). There is **no student login timestamp**, so "active" can only mean "finished something" (D3).

## 3. The claim, and what the report never says

Same discipline as Graduate Evidence (`pog-evidence-requirements.md` section 2), stated for funders:

- **Allowed:** "412 students finished at least one activity in October", "7 of 9 schools had a classroom in regular use", "62% of students have practiced Empathy" (a student finished an activity FNE connects to it).
- **Never:** outcomes, results, impact, efficacy, improvement, growth, mastery, proficiency, achievement, gains, "evidence-based results", a score or grade for a school, teacher or student, or a ranking of schools. No sentence may say or imply that FNE use caused any change in students.
- The page and every export carry the standing lines: *Fixer Nation's connections to the New York frameworks are its own mapping; New York State and CASEL have not endorsed or certified them.* and *This report describes how the program is being used. It is not an evaluation of student outcomes.*
- **Grants usually ask for outcomes** (discipline referrals, climate surveys, attendance). FNE does not hold those. The packet says plainly that outcome data comes from the district's own sources, and the page can say what FNE counts so the district can set its own measures beside it.
- **Equity and subgroup breakdowns** (by race, income, disability, English learner status) are often required. FNE collects **no demographic data by design** (Student Data Privacy page, section 2), so it **cannot** provide them. The page states this once, in plain words, so a district is not surprised in the middle of an application.

## 4. Definitions (every number on the page, exactly)

Period: a **school year**, 1 August to 31 July, always the current one for the live screens (same owner decision as Graduate Evidence, Release 152; no date picker). Months are calendar months inside it. A classroom belongs to a school by the rule the routes already use: its teacher holds a registered seat on the school's purchase (a teacher with seats at two schools is counted once, under the lowest school id).

| Term | Meaning | Source |
|---|---|---|
| Licensed teachers | Seats purchased for the school, administrators excluded | `lib/seat-counts.js` |
| Activated teachers | Seats in status `registered` | same |
| Classrooms | Non-archived classrooms of activated teachers | `classrooms` |
| Students enrolled | Active students (`is_active = 1`) in those classrooms | `classroom_students` |
| **Active student** (in a period) | Finished at least one activity in the period: a lesson with `completed_at` set, an assigned game with a completion row, or a free-play game session that is finished and valid. Started-but-unfinished does not count. One student finishing ten things is one active student. | progress tables |
| **Reach** | Active students as a share of students enrolled | derived |
| **Active classroom** (in a month) | At least one student finished an activity that month | derived |
| **Classroom in regular use** (in a month) | Students finished activities in at least **3 different weeks** of that month (setting, D4) | derived |
| **Teaching teacher** (in a period) | An activated teacher with at least one active classroom in the period. A count only, never a name. | derived |
| Activities finished | Lessons completed plus games finished (each student, once per activity per period); also shown **per active student** so a big school and a small one can be read side by side | derived |
| Attribute practiced / touched / no connection | Exactly as in Graduate Evidence | `lib/pog-evidence.js` |

Nothing here is a composite score. Each number stands alone, and the report never adds them into one index.

## 5. What the page shows

1. **Headline row** (district total): schools licensed, activated teachers of licensed, classrooms active this month, students enrolled, **reach**, activities finished this school year.
2. **Month by month** (August to July): students active, activities finished, classrooms in regular use, as a simple bar series with a text table behind it (accessible; no colour-only meaning). The current month is marked "so far".
3. **School table**: one row per school (name, activated of licensed teachers, students enrolled, reach, classrooms in regular use last full month, activities finished per active student, attributes practiced) with a **"Needs support"** flag (D4) and a link to that school's detail. Sorted alphabetically by default; the user may sort by any column. No ranking order is shown by default.
4. **Standards coverage**: a compact version of the Graduate Evidence view (each attribute: share of students who practiced it, or "No FNE activity connected yet"), with a link to the full Graduate Evidence page. The ten SEL benchmarks are **grouped under NYSED's three SEL goals** (Goal 1 self-awareness and agency: 1A to 1C; Goal 2 social awareness and relationships: 2A to 2D; Goal 3 intentional decision-making: 3A to 3C), because that is how NYSED organizes them (section 14). The framework names, source links and the date FNE verified them are shown.
5. **How we count** (a closed section, also its own printable page): the definitions above in plain words, the claim lines (section 3), the small-group rule, and the limits (no outcomes, no subgroups).
6. **Evidence packet**: "Print or save as PDF" (one letter page, same auto-fit approach as `state-onepager.html`), "Download CSV" (section 7).

## 6. Rules that must not erode

1. **School level and up only.** No teacher name or email, no student name or id, no classroom name, anywhere on the page, in the CSV, or in the print view. A classroom is only ever a count.
2. **Small groups are hidden.** Any figure computed from fewer than **N students** (the existing `pog_evidence_min_group`, default 10) is replaced by "Fewer than N students", and such schools are merged into an "Other schools combined" row until nothing under N remains (the `groupWithMinimum` rule). **Teacher-based figures** (activated, teaching) are hidden for any school with fewer than **5 activated teachers** (new setting `program_report_min_teachers`, default 5, never below 3), because "1 of 2 teachers is teaching" points at a person. Merging, not hiding one row, so the hidden figure cannot be worked out by subtraction.
3. **Verified connections only** for anything about attributes (same SQL gate as Graduate Evidence).
4. **No outcomes language** (section 3), enforced by a test over the page's strings, the print view and the CSV header, like `release-notes.test.js` does for the notes.
5. **Every query is scoped by the viewer**, resolved server-side from the verified session (`req.districtAdmin.districtIds`), never from a client-sent id alone. A school or district id that is not theirs answers 404, never 403 (same as the other district routes).
6. **Read-only.** The only writes are the monthly adoption snapshot (section 8), which holds school-level counts, never an id of a student or a teacher.
7. **No AI** writes, scores or summarises anything in the report or the packet.
8. **NYSED's use limit is honored in how the report reads:** NYSED says the SEL indicators are not meant for diagnosis, grading student performance, or exclusionary or punitive practices (section 14). The report is school-level, never per student, never a grade, and says so.
9. **Randomness, rate limits, errors:** follow `CLAUDE.md` (`typeof` on every request field, `lib/rate-limit.js` on the endpoints and the export).

## 7. The evidence packet

- **Print view** (one letter page, auto-fit): district name, school year, "as of" date, the headline numbers, the month-by-month table, the standards coverage list, the framework names with their official source links, the claim lines, and the date generated. It names no school that was merged into "Other schools combined".
- **CSV** (`GET /api/district-admin/program-report/export`): sections for headline, months, schools and attributes, with a header block giving the district, school year, generated date, the definitions in one paragraph, and the two claim lines. A suppressed cell is blank and the column says `suppressed`; a cell is never `0` when it means "hidden".
- **How we count** page: stands alone so a state office, a board or a funder can read the method without the rest of the page.
- **What it cannot be:** a state submission file. See D11: no export in a state's own format until a district tells us what it actually submits.

## 8. History: the monthly adoption snapshot (D7)

Student records are removed after each school year (`student-data-retention-requirements.md`), so a "progress over time" view only exists if totals are saved as we go. Proposed: `scripts/snapshot-program-use.js` (dry run by default, cron on the 1st of each month at a quiet hour, idempotent) writes one row per school (purchase) and month into **`program_use_snapshots`**:

`school_year_start, month, purchase_id, district_id, teachers_licensed, teachers_activated, teachers_teaching, classrooms, classrooms_active, classrooms_regular, students_enrolled, students_active, lessons_completed, games_finished`

Counts only: no student id, no teacher id, no names, no text. Written once for a finished month and **never recomputed** (a later run would read purged data and overwrite true totals), the same rule as the Graduate Evidence year snapshot. A **one-time backfill** for the current school year reads the live tables (they hold timestamps), so the first version of the page already has months to show instead of waiting a year. The small-group rule is applied when the numbers are **read**, not when they are saved. The Graduate Evidence year snapshot (`pog_evidence_snapshots`) becomes readable here too, for "this year against last year" attribute coverage, which is the first time anything reads it.

## 9. Access matrix

| Role | Own district's report | One school's detail | Export / print | Other districts |
|---|---|---|---|---|
| District administrator | YES (districts they administer) | YES | YES | NO (404) |
| School administrator | NO (not in v1) | Own school only, **phase 4** | Own school only, phase 4 | NO |
| FNE staff (`requireAuth`) | YES, any district, for support and demos | YES | YES | n/a |
| Sales-demo district administrator | Demo district only, demo data | demo only | demo only | NO |
| Teacher, student, parent, anonymous | NO | NO | NO | NO |

A district administrator with more than one district uses the selector the other district pages use.

## 10. Decisions to confirm

| # | Question | Recommended |
|---|---|---|
| D1 | Name | **Program Use Report** (not "Impact"): it reports use and evidence of practice, never outcomes |
| D2 | Level of detail | School level and district totals only; no teacher-level or student-level view (a teacher-level view is a separate, later decision) |
| D3 | What "active" means | Finished at least one activity in the period; started-only does not count; no login tracking |
| D4 | "Regular use" and "Needs support" | A classroom is in regular use in a month when students finished activities in at least 3 different weeks. A school is flagged when fewer than half of its classrooms were in regular use in the last full month. Both numbers are FNE settings (`program_report_regular_weeks`, `program_report_low_use_pct`), not hard-coded |
| D5 | Small groups | Students: the existing minimum (10). Teachers: new minimum of 5 activated teachers per school (never below 3) |
| D6 | Period | Current school year, month by month, plus last year from snapshots; no date picker |
| D7 | Save history | Yes: monthly school-level snapshot starting now, with a one-time backfill of this school year |
| D8 | Exports | Browser print to PDF and a CSV, both carrying the definitions and claim lines; no server-side PDF |
| D9 | Claim wording | The two standing lines in section 3, owner-approved before anything is published; anything about outcomes or equity breakdowns says plainly that FNE does not hold that data |
| D10 | School administrators | Same report scoped to their own school, in a later phase |
| D11 | The state | **Re-checked 2026-11-08 (section 14): no mandated New York SEL reporting form found; the packet stays a neutral attachment, grouped by NYSED's three goals.** Still ask two or three districts which funder format they have before building any format-specific export |
| D12 | Frameworks | New York only, as Graduate Evidence; a district's own framework is out of scope until the report is proven |

## 11. Out of scope (this version)

Outcomes of any kind (referrals, attendance, climate, test results); subgroup or demographic breakdowns (FNE holds none); teacher-level or classroom-level views and names; student-level views; ranking or scoring schools; comparisons with other districts; automatic submission to a state or funder; narrative or grant text written by AI; emailed digests; server-side PDF; states other than New York.

## 12. Build phases

| Phase | What | Needs |
|---|---|---|
| 0 | Owner answers D1 to D12; ask two or three districts what they submit to the state and funders (D11) | The owner |
| 1 | `lib/program-use.js`: the definitions above as plain portable SQL on `node:sqlite` (tests: active student, finished-once, regular-use weeks, scoping by district and school, merge and suppression for students and teachers, demo isolation, every access-matrix row), `GET /api/district-admin/program-report`, the page with tiles, month table and school table, the print view, a link from the district portal menu (bump the nav version) | D1 to D6 |
| 2 | `program_use_snapshots` + `scripts/snapshot-program-use.js` + one-time backfill + cron line; the page reads snapshots for past months and last year | D7 |
| 3 | CSV export, the "How we count" page, last year against this year for attributes (first reader of `pog_evidence_snapshots`) | D8, D9 |
| 4 | School administrator version for their own school | D10 |
| 5 | Customer-facing: release note (draft until the owner reads it), Help answer, how-to video, `videos-to-review.js` check, CHANGELOG, `PROJECT.md` | each phase |

New settings: `program_report_regular_weeks`, `program_report_low_use_pct`, `program_report_min_teachers` (an admin screen like the Graduate Evidence minimum, from the start). New tables: none until phase 2 (`program_use_snapshots`). Phases 1 and 2 each need a Node restart; phase 2 needs an alter script run first.

## 13. What I do not know

- **What a state or a funder requires.** I believe Portrait of a Graduate and SEL implementation reporting is not standardized in New York, but I have not verified that, and grant forms vary widely. D11 exists so the packet is shaped by what districts actually submit, not by my guess.
- **Whether a small district's raw monthly counts in the snapshot table count as de-identified** for each district's data agreement. They hold no ids, but the retention requirements (D5) should be re-read with that table in mind before phase 2 ships.
- **How many districts and schools will have enough students for the small-group rule to leave a useful report.** A district with a few small schools will see mostly merged rows, which is the rule working, but the owner should know it before a sales demo.

## 14. D11 check against NYSED sources (2026-11-08)

The owner pasted a summary of New York grant and reporting formats (generated text with links) and asked me to check D11 against it. I read the NYSED documents it cites rather than trusting the summary. **Checked against the primary documents:**

| Claim in the pasted summary | What the source says |
|---|---|
| SEL: NYS does not mandate one rigid SEL reporting form; local formats should align to the NYS SEL Benchmarks | **Supported.** The NYSED SEL Benchmarks (revised November 2022) describe the indicators as "recommended for voluntary use". I found no reporting mandate in them or in the 2019 implementation guide. |
| Map to three goals: intrapersonal, interpersonal, decision-making | **Supported in substance.** The benchmarks are organized in three goals: Goal 1 self-awareness (identity, agency), Goal 2 social awareness and interpersonal skills (relationships, belonging), Goal 3 intentional decision-making (safety, well-being, community). Our ten benchmarks (1A to 3C) already sit under them. **That a grant update "must" map to them is not stated in what I read.** |
| Data must not be used for diagnosis, grading or punitive practice | **Supported.** The benchmarks say the indicators "are not meant to be used for diagnostic purposes, to grade student performance, or as a justification for exclusionary or punitive practices". This matches the report's design (school level, no per-student view). |
| Focus on systemic, school-wide implementation using NYSED's systemic implementation rubric | **Partly.** NYSED's 2019 guide to systemic whole-school SEL implementation includes a **sample** implementation rubric (its Appendix A) "used as part of a self-assessment and planning process". It is a sample, voluntary, and a district self-assessment: FNE cannot produce rubric levels and should not claim to. The report's reach and dosage numbers can be **evidence a district cites** in its own self-assessment. |
| State grants over $10,000 must use the NYS Contract for Grants (Face Page, Appendix A, Attachments A-1, C Work Plan, D Payment and Reporting Schedule) | **Format confirmed, scope not.** The NYS Grants Management page lists those components and says grants under $10,000 use a Letter of Agreement. It does not say school districts' NYSED grants use it, and a third-party summary of NYSED's own funding process describes a separate "Application for Funds". **Which format applies depends on the specific grant**, so D11 stands: ask the district. |
| PoG reporting is tied to the PLAN pilot, portfolios, capstones, community projects | **Not confirmed.** The NYSED Portrait of a Graduate page lists the PLAN Pilot and Regionalization among connected initiatives, and states no reporting requirement. I could not confirm the portfolio or capstone deliverables from NYSED sources. PLAN is a different thing from FNE (performance-based assessment); FNE's report is supporting evidence of practice, not a PLAN deliverable. |
| The six attribute names (Academic Readiness, Creative Innovation, Critical Thinking, ...) | **Do not use.** The summary's names differ from the official framework FNE holds and has verified (Academically Prepared, Creative Innovator, Critical Thinker, Effective Communicator, Global Citizen, Reflective and Future Focused). The report always uses the verified framework's wording. |

**What changed because of the check:** (1) the standards section now groups the ten SEL benchmarks under NYSED's three goals; (2) the report states NYSED's use limit (rule 8); (3) the packet is described as something a district can attach to a work plan or progress report, never as a state form; (4) the "How we count" page says plainly that FNE does not produce NYSED rubric levels. D11 itself stands: build no format-specific export until a district names the funder format.

## 15. As built: phase 1 (Release 161, 2026-11-08)

- **Library** `server/lib/program-use.js` (the definitions in section 4 as plain portable SQL; tests: `test/program-use.test.js`, 13) and **route** `server/routes/program-report.js` at `/api/program-report`: `GET /district?districtId=` (district administrator, own districts only) and `GET /staff/district/:districtId` (FNE staff). Another district's id answers 404; no login answers 401. The answer carries the usage numbers plus `standards`, which is Graduate Evidence's own `groupedReport` for the same schools.
- **Counting:** active = finished something (lesson completed, assigned game finished, or free-play game finished and valid); removed students are left out; a student's activity counts once per month so the months add up to the year; classrooms are those of teachers with a registered seat, a classroom whose teacher holds seats at two schools counts once under the lowest school id; a classroom is in regular use in a month when finishes fall in at least `program_report_regular_weeks` different Monday-start weeks.
- **Small groups, as built:** schools under the student minimum (`pog_evidence_min_group`, default 10) are merged into "Other schools combined" until the combined row reaches it; a district under it shows no figures at all (only seat facts). A school with fewer than `program_report_min_teachers` (default 5, never below 3) activated teachers hides its teacher counts, its classroom counts and its support flag (shown as "Hidden: fewer than N teachers"). A school with no students yet is shown (zero reveals no one).
- **Support flag:** a school is marked when fewer than `program_report_low_use_pct` percent (default 50) of its classrooms were in regular use in the last full month; in August there is no full month, so rows say "Too early to tell". The wording is "Needs support", never a score or a rank; the table is alphabetical by default.
- **Settings:** staff set the three thresholds in Settings > Program Use Report (`GET`/`PUT /api/settings/program-report`, clamped on every read).
- **Page:** `district-admin-program-report.html` (district portal menu, nav v13): tiles, month by month, school table (sortable), standards coverage with the SEL benchmarks grouped under NYSED's three goals (the shared `graduate-evidence-view.js`, now v2, `opts.goals`), a "How we count" section, the standing claim lines, and a print view. A test scans the page for outcome, score, rank or grade words.
- **Customer-facing:** a draft release note (`program-use-report`), two draft Help answers (`program-report-what`, `program-report-small-schools`), and how-to video C9 (recorded locally, not published).
- **Not built (later phases):** monthly adoption snapshots and the one-time backfill (phase 2), so history for earlier school years and "this year against last"; the CSV export, a stand-alone "How we count" page and the prior-year attribute comparison (phase 3); the school administrator version (phase 4). Until phase 2, months of the current school year are computed from live classroom activity (so a student the teacher later removes disappears from earlier months), and earlier school years are not available.

## 16. As built: phases 2 to 4 (Release 161, 2026-11-08)

The owner asked for phases 2 to 4 in the same session, so all four shipped as one release (Release 161).

- **Phase 2, history.** Table `program_use_snapshots` (`scripts/alter-create-program-use-snapshots.js`, also in `schema.sql`): one row per school and month, saved by `scripts/snapshot-program-use.js` (dry run by default; `--apply`; `--backfill` for every finished month of the current school year, run once; cron on the 1st at 04:15 from `setup-cron-jobs.sh`). It holds counts only (month totals and year-to-date totals of students and teachers, enrollment and classrooms at the time, seats) and **no id, name or text**; a month already saved is never touched again; the first of August saves July of the year that just ended. Rows backfilled from live activity are marked `source = 'backfill'`, and the page says how many months of last year were filled in that way (a student removed before the backfill is missing from those months). The small-group rules are applied when rows are **read**. `lastYearReport()` builds last year from saved rows only, with no support flag, and returns `null` (so the page shows no section) when nothing was saved. The cron also runs `snapshot-pog-evidence.js --apply` on 1 August (the Graduate Evidence year snapshot, whose first reader is now this report).
- **Phase 3, the packet.** `GET /api/program-report/district/export` (and `/staff/district/:id/export`, `/school/export`): a CSV with a header block (title, school year, as-of date, generated date, the link to the method page, one paragraph of definitions, the three claim lines), then headline, month by month, schools and standards coverage for this year and, when saved, last year. A hidden figure is the word `suppressed`, never 0; a cell starting with `=`, `+`, `-` or `@` is defused so a spreadsheet cannot run it; commas and quotes are escaped; it names no teacher, classroom or student. `program-report-how-we-count.html` is a **public** method page (definitions, small-group rules, what the report cannot tell you, the claim lines) a district can link from a board packet. Last year's attribute coverage comes from `pog_evidence_snapshots` (`snapshotStandards()`: classrooms are mapped to schools by today's teacher seats, merged under the same small-group rule, with the framework and attribute names as saved that year; an attribute with no connection that year says so).
- **Phase 4, school administrators.** `GET /api/program-report/school?purchaseId=` (+ `/school/export`) behind `requireSchoolAdmin`: only the purchases in the viewer's own session, anything else is a 404; one school, so no school table and no last-year section; the same small-group rules (a school under 10 students shows no figures; under 5 activated teachers hides teacher and classroom figures). Page `school-admin-program-report.html`, menu entry, `school-admin-nav.js` v27.
- **Shared code:** `program-report-view.js` draws everything both pages show; `graduate-evidence-view.js` v2 groups the SEL benchmarks under NYSED's three goals when asked.
- **Tests:** `test/program-use.test.js` (22), `test/program-report-page.test.js` (6; scans every page, the view and the public method page for outcome, score, ranking or grade words, and compiles every inline script).
- **Still open:** a how-to video for the school administrator version; a decision on whether district staff want last year's *per-month* figures broken down by school (the page shows last year's totals and a by-school table, not a month-by-school grid); and a state or funder specific export, which waits for a district to name its format (D11).
