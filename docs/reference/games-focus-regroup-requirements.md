# Requirements: regroup the games by focus (DRAFT for the owner's review)

Written 2026-11-06 by Claude. **Nothing is built.** This follows the project's requirements-before-code rule: confirm it, then build once. Evidence and reasoning are in `docs/reference/games-grade-focus-audit.md` (sections A to H); this file turns the owner's decisions into a buildable specification.

## 1. Decisions already made by the owner (2026-11-06)

1. "Focus" means the **five domains** on the games page, then (later the same day) the SEL games are regrouped by the **five CASEL competencies**: Self-Awareness, Self-Management, Social Awareness, Relationship Skills, Responsible Decision-Making.
2. The skills games stay outside the competencies. **Skills practice is the core three only: Literacy, Math, Thinking Skills.** Science, social studies, typing and mouse skills are parked.
3. Every grade band x focus needs **at least two games**.
4. Wellness & Life Skills is **dropped as a separate focus** (recommendation in the audit, section G1.4; to be confirmed here, see question Q1).

## 2. Goal

A teacher or student filtering the games page by "Focus" sees eight honest categories, and every game sits in exactly one. Each focus has at least two games in every grade band, and each game's focus matches what the player actually does (audit, section B).

## 3. The focus list (eight values)

| Group | Focus value | Label shown on the page |
|---|---|---|
| SEL & Character | `self_awareness` | Self-Awareness |
| SEL & Character | `self_management` | Self-Management |
| SEL & Character | `social_awareness` | Social Awareness |
| SEL & Character | `relationship_skills` | Relationship Skills |
| SEL & Character | `responsible_decision_making` | Responsible Decision-Making |
| Skills practice | `literacy` | Literacy |
| Skills practice | `math` | Math |
| Skills practice | `thinking` | Thinking Skills |

The competency definitions the owner supplied (shown to teachers as a one-line help text on each competency chip) are the working definitions. Where wording is visible on a public page it needs the owner's sign-off.

## 4. Data model

- **New column `brain_games.focus`**, `ENUM('self_awareness','self_management','social_awareness','relationship_skills','responsible_decision_making','literacy','math','thinking') NULL`. One value per game. This is the single field the page, the grid and the audit use.
- **Keep** `domain` (`literacy, math, executive, sel, wellness`) and `casel_competencies` (SET of up to five) unchanged. `casel_competencies` becomes the **secondary** competency list; `domain` stays so existing code, tests and reports keep working. `wellness` stays in the enum, unused.
- **Consistency rule (test-enforced):** if `domain = 'sel'` then `focus` is one of the five competencies and, if `casel_competencies` is set, `focus` is a member of it; otherwise `focus` is `literacy`, `math` or `thinking`, and `domain` agrees (`literacy`; `math`; `executive` maps to `thinking`).
- Migration follows the project pattern: a one-off idempotent `server/scripts/alter-add-brain-games-focus.js` (check `information_schema.COLUMNS`, catch `ER_DUP_FIELDNAME`), plus the same column in `server/db/schema.sql` for fresh installs. A second idempotent script `server/scripts/seed-brain-games-focus-values.js` writes the table in section 5, in the style of `seed-brain-games-domain-values.js`. Run the alter script **before** restarting the Node app.
- The `STATIC_GAMES` fallback list in `server/routes/brain-games.js` (the six legacy games, returned if the database tables are missing) gets the same `focus` values.
- `GET /api/brain-games` (public) additionally returns `focus` for each game. It already returns `band` and `domain`. No new access rules: the catalog is already public, and it exposes no student data.

## 5. Primary focus for every game (the retag table)

\* = low confidence: the focus counts only if the change in the last column is made (see section 7).

| Game | Band | Today (domain / CASEL) | New `focus` | Secondary (`casel_competencies`) | Change needed |
|---|---|---|---|---|---|
| Calm Down Corner | Discover | sel / self_management | self_management | | none |
| Feelings Detective\* | Discover | sel / self_awareness | self_awareness | social_awareness | make the own-feelings step central and scored or reflected, not two end taps |
| Sharing Circle | Discover | sel / social_awareness, relationship_skills | social_awareness | relationship_skills | none |
| Same and Different | Discover | sel / social_awareness | social_awareness | | none (fix stale header comment) |
| Helper's Choice | Discover | sel / responsible_decision_making | responsible_decision_making | | none |
| Sound Safari | Discover | literacy | literacy | | none |
| Team Pick | Explore | sel / self_management, relationship_skills | self_management | relationship_skills | none |
| Strength Spotter\* | Explore | sel / self_awareness | self_awareness | | make the own-strengths step central |
| Peace Table | Explore | sel / relationship_skills, social_awareness | relationship_skills | social_awareness | none |
| Choice Quest | Explore | sel / social_awareness, relationship_skills, responsible_decision_making | responsible_decision_making | social_awareness | none |
| Fix-It Workshop | Explore | sel / responsible_decision_making, social_awareness | responsible_decision_making | | none (step 3 has no wrong answer; optional rewrite) |
| Reading Detective | Explore | literacy | literacy | | expand from 4 to 12 items at grade 3-5 level (optional, see audit B) |
| Memory Match | Explore | executive | thinking | | none |
| Simon Sequence | Explore | executive | thinking | | none |
| Group Chat Meltdown | Challenge | sel / self_management, responsible_decision_making | self_management | responsible_decision_making | none |
| Money Moves\* | Challenge | sel / self_management, responsible_decision_making | self_management | responsible_decision_making | fix draws that cannot reach the goal (35%) |
| Values Compass\* | Challenge | sel / self_awareness, responsible_decision_making | self_awareness | | make the own-values step central; drop responsible_decision_making |
| Say It Another Way | Challenge | sel / relationship_skills, social_awareness | relationship_skills | social_awareness | none |
| Decision Point | Challenge | sel / social_awareness, relationship_skills, responsible_decision_making | responsible_decision_making | social_awareness, relationship_skills | none (one fixed scenario; add a pool, optional) |
| Headline | Challenge | literacy | literacy | | none |
| Stroop Challenge | Challenge | executive | thinking | | none |
| Reaction Time | Challenge | executive | thinking | | add a no-go element (tap on green, not on red); otherwise it has no honest focus (see Q3) |
| Number Sequence | Challenge | executive | **math** (changed) | | fix the unsolvable "quadratic" pattern; `domain` also becomes `math` |
| Quick Math | Challenge | math | math | | grade 3-5 content only; consider moving to Explore (Q4) |
| Money Matters\* | Advance | sel / self_management, responsible_decision_making | self_management | responsible_decision_making | fix draws that cannot reach the goal (43%) |
| Perspective Swap | Advance | sel / social_awareness, relationship_skills | social_awareness | relationship_skills | none |
| Community Voice | Advance | sel / responsible_decision_making, relationship_skills | relationship_skills | responsible_decision_making | none |
| First Shift | Advance | sel / responsible_decision_making, relationship_skills | responsible_decision_making | relationship_skills | none |
| The Post | Advance | sel / social_awareness, relationship_skills, self_management | responsible_decision_making | social_awareness, relationship_skills | **drop self_management, add responsible_decision_making** |
| Idea Lab | Advance | sel / responsible_decision_making, relationship_skills | responsible_decision_making | | drop relationship_skills |
| Critical Read | Advance | literacy | literacy | | none |

Also record the corrections from the audit (section C2) in `casel_competencies`: Feelings Detective gains `social_awareness`; Sharing Circle's primary is `social_awareness`.

## 6. Pages and behaviour

1. **`brain-games.html` (public catalog).** Replace the five "Focus" domain chips with the eight values above, shown in two labelled groups ("SEL & Character" with its five chips, "Skills practice" with its three). "All" stays. Cards show the focus as the kind tag instead of "SEL & Character" / "Skills practice". The existing "Grade band" filter, band sort and "New" tag are unchanged. Filtering by a focus with no game shows the existing "No games match these filters" message. The hero badges (Literacy, Math, Thinking Skills, SEL & Character, Wellness & Life Skills) are updated to match the new list; drop the Wellness badge.
2. **`teacher-classroom.html` (assign game).** Today it filters by band only. Add the same focus selector so a teacher can pick "a Self-Management game for this grade". The band default and the "Show games for all grade bands" checkbox stay.
3. **Student pages.** No change. Students keep seeing assigned games only.
4. **Admin.** No admin page edits games today (tags come from scripts). Nothing to add; the new column is changed only by the seed script.
5. **Teacher reports** (`teacher-game-report.html`, school and district reports): check whether any groups by domain and add focus where useful. This is the one place I have not yet confirmed; see Q6.
6. **Copy.** Where the competency names appear on public pages, keep "CASEL-aligned, not CASEL-certified" (master plan 6.4). All new visible wording (chip labels, help text, card tags) is student- and teacher-facing copy: draft it, run it through the humanize pass, and have the owner read it before deploy.

## 7. Content changes this depends on
**Owner decision (2026-11-06): the fixes are included in this release** (open question Q7 answered). The regroup is a relabel; the star-marked rows only count if their game changes. Another session has already written a separate requirements file for the defects found in the audit: `docs/reference/game-defects-fix-requirements.md` (Release 136). To avoid building anything twice, this release **depends on that file** for the fixes it already covers, and adds only what it does not.

| Fix | Where it is specified | Status |
|---|---|---|
| Number Sequence: make the "quadratic" pattern solvable (one constant per sequence) | `game-defects-fix-requirements.md`, defect 1 | **done in Release 136** (commit `2a02894`, live) |
| Money Moves and Money Matters: pin the income events so the goal is always reachable | same file, defect 2 (`alwaysInclude`, `engine-sdk.js` v6) | **done in Release 136** |
| Memory Match screen-reader labels; Same and Different header comment | same file, defects 4 and 6 | **done in Release 136** |
| Story games count "ask an adult" as a smart choice | same file, defect 5 | **done in Release 136** (`engine-branching-scenario.js` v7) |
| Reading Detective: bigger pool, balanced answers | same file, defect 3 | **done in Release 136** (Reading Detective now has 12 passages) |
| **Reaction Time: add a no-go element** | **section 7a below** | **new, in this file only** |
| **Number Sequence: re-tag to Math** | section 5 (retag table) | new, in this file only |
| **Feelings Detective, Strength Spotter, Values Compass: make the own-self step central** | not specified anywhere yet | needs its own short outline for the owner before any wording is written (see 7b) |

Order of work (decided and done): Release 136 (commit `2a02894`) is deployed and checked on production. This release is **137**. **Version numbers to bump from (checked 2026-11-06 with grep over every `.html`):** `engine-sdk.js?v=6` on 26 pages, `engine-branching-scenario.js?v=7` on 12 pages, `brain-games.css?v=7` on 36 pages, `game-shell.js?v=3` on 27 pages; re-grep the exact strings before editing. After 136 landed, this release then bumps them once; the focus column, seed script and page changes follow. They touch different files except `engine-sdk.js?v=` and the page version numbers, which must be bumped once, not twice (grep the exact references before committing).

### 7a. Reaction Time: add a no-go element (new)

Today Reaction Time is a processing-speed game; the only inhibition is not tapping early. To be an honest Thinking Skills (inhibition) game it needs trials where the correct response is **not** to tap.

- **Mechanic:** keep the 5 "go" rounds and the false-start rule. Add decoy rounds mixed in at random positions: the target shows a **different** signal (a red target with a hand or "STOP" mark, not colour alone) for about 1.2 seconds, then resets. Tapping on a decoy is a **no-go error**; not tapping is correct. Decoys per run: Easy 1, Medium 2, Hard 3. They are extra trials, so the run still has 5 go rounds.
- **Not by colour alone:** the decoy must differ by shape or word as well as colour (colour-blind players; the audit already flags colour-only signals in Stroop and Simon).
- **Scoring and badges unchanged for a clean run:** `validTimes` still holds only go-round times; the server score formula (`brain-games.js`, average reaction time) and the badge criteria `reaction_avg_max`, `false_starts_zero`, `reaction_consistent` keep working. New optional metrics `noGoTrials` and `noGoErrors` are stored with the session. Whether a no-go error should also lower the score is the owner's call (Q9); default: reported, not penalised, so no earned badge or level changes.
- **Copy:** the how-to-play text and the end screen mention the new "don't tap on STOP" rule and report no-go errors. New visible wording needs the humanize pass and the owner's read.
- **Tests:** go times only in `validTimes`; the no-go error counter; the existing metric validation (`t < 80 || t > 10000`) still passes; the decoy never appears as the first trial and never twice in a row.
- **Video:** check `docs/training-videos/video-watch.json`; Reaction Time is not in the S4 list, but `node server/scripts/videos-to-review.js` is run anyway before commit.

### 7b. Own-self step for the three self-awareness games (to outline first)

Feelings Detective (K-2), Strength Spotter (3-5) and Values Compass (6-8) each have a private own-self check that is two unscored taps after each story. To count as Self-Awareness, that step has to become a main part of a run (for example one clear "your turn" screen each run with its own prompt and a reflection line shown back to the child, never logged, sent or saved, as the existing private self-check rule requires). Because it changes SEL content, the project's outline-first rule applies: I write a one-page outline per game for the owner's approval before any wording or code.

## 8. Resulting coverage and what is still missing

With the table in section 5 (primary only, minimum two per cell), the SEL grid is:

| Band | Self-Awareness | Self-Management | Social Awareness | Relationship Skills | Resp. Decision-Making |
|---|---|---|---|---|---|
| Discover | 1 (-1) | 1 (-1) | 2 | 0 (-2) | 1 (-1) |
| Explore | 1 (-1) | 1 (-1) | 0 (-2) | 1 (-1) | 2 |
| Challenge | 1 (-1) | 2 | 0 (-2) | 1 (-1) | 1 (-1) |
| Advance | 0 (-2) | 1 (-1) | 1 (-1) | 1 (-1) | 3 |

**20 SEL games missing** (25 if the five starred games do not qualify). Skills practice (strict counts, after Number Sequence moves to Math): Literacy 1 in every band; Math 0 / 0 / 2 / 0; Thinking 0 / 2 / 1 / 0. Concepts for every gap are in the audit, sections G5 and H3-H5; the cheapest first wave is H5. This regroup does not build any of them.

## 9. Acceptance criteria

1. Every active game has a `focus`; the consistency rule in section 4 passes for all 31.
2. The games page shows the eight chips in two groups, filters correctly by band and focus together, and shows no Wellness chip.
3. `GET /api/brain-games` returns `focus` for each game; the static fallback does too.
4. A test reads the seed table and the seed scripts and fails if a game's `focus` is not in its `casel_competencies` (for SEL) or disagrees with its `domain`, and fails if a catalog game has no `focus`.
5. `node server/scripts/audit-brain-games.js` (or a new check) prints the band x focus grid and lists every cell under two games, so the owner's minimum can be checked after each release.
6. The alter script is safe to run twice and does not touch other columns.
7. No change to student data, XP, badges, assignments or access control.
8. Completeness: a test compares the slugs in the retag table, the `brain-*.html` game pages and the catalog seed scripts and fails if any differ (31 today). After the seed script runs, it lists every active game with no `focus` and the list must be empty.

## 9a. Completeness check: no game left out (done 2026-11-06)

The owner approved the draft on 2026-11-06 on the condition that no game is left out. I compared three independent lists by slug and they are identical, 31 each:

1. **Game pages in the repo:** every `brain-*.html` except the hub, progress and badges pages (`brain-games.html`, `brain-games-progress.html`, `brain-badges.html`) = 31.
2. **Catalog entries:** 25 `server/scripts/seed-<slug>-catalog-entry.js` files plus the six older games created in `alter-brain-games.js` = 31. These are the only places that `INSERT INTO brain_games` (the one other hit is a test fixture).
3. **The retag table in section 5** = 31 rows: Discover 6, Explore 8, Challenge 10, Advance 7. Every one of the 25 card descriptions in `lib/brain-game-copy.js` is also in the table.

Nothing is missing in either direction. Not counted as games, on purpose: the four internal demo pages `tune-your-brain-*.html` (not in the catalog, not assignable); `student-game.html` (the frame that plays a game); `teacher-game-report.html` (results page).

**What I could not check from the repo:** the production `brain_games` table itself. If a row exists there that no script in the repo created (for example one added by hand), it would not appear above. The seed script therefore must, when it runs, print every `active = 1` row that has no `focus` after the update, and exit with a warning so the owner sees it.

**Guard against future omissions:** a game added later without a `focus` must fail a test (criterion 4 below) and show up in the seed script's warning, so "no game left out" stays true as the catalog grows.

## 10. Rollout

One release, in this order: commit; push (from the Mac); cPanel pull; rsync (HTML and JS changed: `brain-games.html`, `teacher-classroom.html`); alter script, then seed script (with the nodevenv prefix, from `server/`); **restart the Node app** (route change); curl the catalog API and the games page. Per the project rule, the exact command blocks are given with the commit message. Before committing, run `node server/scripts/videos-to-review.js`: help video S4 (games page) lists `brain-games.html` and `server/routes/brain-games.js`, so it must be judged and `VIDEO-STATUS.md` updated. Add a `CHANGELOG.md` entry and update `PROJECT.md` (Brain Games section) and `SEL_POG_COVERAGE.md`.

## 10a. Owner answers (2026-11-06): the spec is confirmed; this is Release 137

| Q | Answer |
|---|---|
| Q1 | Drop Wellness & Life Skills as a separate focus (eight focuses) |
| Q2 | One primary focus per game; secondary competencies do not count toward the minimum |
| Q3, Q9 | Add the Reaction Time no-go element; decoy errors are reported and recorded, not penalised |
| Q4 | Quick Math moves to Explore |
| Q5 | Strict: Feelings Detective, Strength Spotter and Values Compass count only after their own-self step is fixed; the two money games count now (fixed in Release 136) |
| Q6 | No report change (checked: no teacher, school or district report groups games by focus or band) |
| Q8 | Claude drafts the public wording; the owner reads it before deploy |
| Q11 | The three own-self steps (7b) are a **separate later release**; Release 137 is the relabel, Number Sequence re-tag, Quick Math re-band and Reaction Time no-go |

## 11. Open questions for the owner

- **Q1. Wellness.** Confirm Wellness & Life Skills is dropped as a focus, and that Self-Management now owns breathing, stress and goal-setting ideas. (Alternative: keep it as a ninth, unrequired focus.)
- **Q2. One focus per game.** This design gives each game exactly one primary focus, with the SET as secondary. Is that right, or should a game be able to count in two focuses at once?
- **Q3. Reaction Time.** Add the no-go element (recommended), keep it with no focus, or retire it?
- **Q4. Quick Math band.** It is grade 3-5 content tagged Challenge. Move it to Explore, or write grade 6-8 content?
- **Q5. Starred games.** Do the five starred games count now (lenient) or only after their content change (strict)?
- **Q6. Reports.** Should teacher and school reports show focus? **Checked in code (2026-11-06): no teacher, school or district report groups games by domain or band**; only the catalog API, `brain-games.html` and `teacher-classroom.html` (band filter) read those fields. Recommendation: no report change in this release.
- ~~Q7. Scope of this release.~~ **Answered: include the fixes** (section 7: the defects file's fixes plus Reaction Time no-go and the Number Sequence re-tag).
- **Q8. Public wording.** The competency chip labels and help text are new public copy: do you want to draft them or have me draft them for your read?
- **Q9. Reaction Time no-go errors:** reported only (recommended, no earned badge changes) or also a score penalty?
- ~~Q10. Two requirement files.~~ **Answered (2026-11-06): Release 136 (the defects file) ships first; the regroup follows as its own later release.** The regroup release is therefore built on top of 136's `engine-sdk.js` and page version numbers, so it bumps them once more at that point, after 136 is deployed and verified.
