# Tune Your Brain — Phase Status

**Read this first in any new session before doing more Tune Your Brain work.** Updated at the end of every work package — if it's stale, something was skipped.

Legend: ✅ done & deployed · 🟡 coded & pushed, not yet deployed · ⬜ not started

| Phase | What it is | Status |
|---|---|---|
| 0 | Repository forensics & baseline verification | ✅ Done (`docs/tune-your-brain/BLUEPRINT_VERIFICATION_REPORT.md` etc.) |
| 1 | Architectural foundation — PIN-student reward fix | ✅ Done & deployed, confirmed live 2026-09-16 (Release 38) |
| 1 | Architectural foundation — feature flags, skill-graph tables, `learning_events`, shared site-auth helper | ✅ Done & deployed, confirmed live 2026-09-16 |
| 2 | Shared design system + 4 experience-band tokens + accessibility utilities | ✅ Done & deployed, confirmed live 2026-09-16 (Release 40) |
| 3 | Game Engine SDK + normalized session runtime, all 6 engines | ✅ Done & deployed, confirmed live 2026-09-16/17 (Releases 41-42) |
| 4 | Skill graph seeding + content governance workflow | ⬜ Not started (empty tables exist from Phase 1) |
| 5 | Vertical slice pilot — first 4 real playable games (1 per band) | ✅ Done & deployed, confirmed live 2026-09-17 via Playwright regression against production (Releases 43-44). All 4 games built. |
| 6 | Assignments/progression/goals/rewards/reporting | ✅ First slice done & deployed, confirmed live 2026-09-17 via Playwright regression against production (Release 45): classroom-generic Reward Service + teacher game report. Rest of the phase (assignment targeting, adaptive controls, cooperative milestones, admin aggregate reports, reset/audit tooling) not started. |
| 7 | Catalog Wave A — Discover/Explore new games + legacy migration | ⬜ Not started |
| 8 | Catalog Wave B — Challenge/Advance new games + legacy migration | ⬜ Not started |
| 9 | Content administration / scaled authoring tools | ⬜ Not started |
| 10 | Phase 2 curriculum expansion (14 more games) | ⬜ Not started |
| 11 | District/enterprise readiness | ⬜ Not started |
| 12 | Evidence/validation/continuous improvement | ⬜ Not started |
| 13 | Long-term K-12 platform end state | ⬜ Not started |

## Still-open leadership decisions
See `LEADERSHIP_DECISIONS_REQUIRED.md`. D1 (is ElevenLabs actually live — blocks Phase 5 audio content) and D4 (how aggregate is school-admin visibility — blocks Phase 6 reporting) are the only two still genuinely unanswered.

## What "done" means as of 2026-09-17
Phases 1–3 were pure plumbing. Phase 5 is fully done: all 4 vertical-slice games are deployed and confirmed live. Phase 6's first slice (Reward Service + teacher report) is also now deployed and confirmed live (Release 45).

## Deploy queue
Empty — everything through Release 45 is confirmed live as of 2026-09-17.

## Engine mapping spike (done)
See `ENGINE_MAPPING_SPIKE.md`. Key finding: the blueprint's own suggested Phase 3 starter engines (Audio Choice, Build, Manipulative, Evidence Hunt, Branching Scenario, Simulation) missed the two cleanest-fitting engines for the 6 legacy games (**Memory**, **Pattern**) entirely, and included one (Manipulative) nothing needs yet. Corrected list: Memory, Pattern, Audio Choice (generalized to any stimulus), Evidence Hunt, Branching Scenario, Simulation.

## Phase 3 progress
Built and verified (via a throwaway Playwright script — screenshots + interaction checks, then deleted): `engine-sdk.js` (lifecycle runner + resume-safe session tracking + `learning_events` logging), `engine-registry` (built into the SDK itself), and the first real engine, **Memory** (`engine-memory.js`), covering Memory Match + Simon Sequence per the spike. Proved the exit gate: two distinct content packs ("Shapes," "Numbers") run on the same engine with zero engine-code changes, under two different bands (Discover/Advance), keyboard-operable, and a page reload resumes the same session (no duplicate). New server route `POST /api/learning-events` (dual-identity, same principle as brain-games.js) gives engines somewhere real to log evidence.

**Real bug caught and fixed during this work, worth remembering:** the flip-card CSS (`.flip-card`/`.card-grid` and friends) had only ever existed as page-local styles inside `brain-memory-match.html`'s own `<style>` block — never in the shared `brain-games.css`. Assumed-shared classes turned out not to be shared at all. Added proper versions to `brain-games.css` now that a second consumer (the Memory engine) needs them. Also hit and fixed a real inline-vs-block CSS bug: `<span class="flip-inner">` is inline by default, so its `width:100%/height:100%` were silently ignored (percentages don't apply to inline elements) — fixed by forcing `display:block` in the shared rule so this can't recur regardless of which tag a future engine uses.

**All 6 corrected-list engines are now built** (`engine-memory.js`, `engine-pattern.js`, `engine-audio-choice.js`, `engine-evidence-hunt.js`, `engine-branching-scenario.js`, `engine-simulation.js`), each registered with `FnEngineSDK` and demoed at `tune-your-brain-shell-demo-engine.html`. Every one of the 4 pilot-slice engines (Audio Choice, Evidence Hunt, Branching Scenario, Simulation) and both legacy-migration engines (Memory, Pattern) is now real and verified, not stubbed:

- **Evidence Hunt** implements the blueprint's explicit acceptance rule (§14.2) — a correct answer WITH the right supporting evidence is recorded and scored differently from a correct guess without it (two-stage: pick an answer, then pick the supporting sentence).
- **Branching Scenario** implements the real Issues-to-Answers 5-step cycle as structured fields (not free text), tags every choice by type (unsafe/plausible-incomplete/responsible/multiple-defensible/seek-help) per T10, and never scores SEL as right/wrong trivia. Its "reflect" step's free text is deliberately never sent anywhere — shown locally only, per T20/§10.6.
- **Simulation** tracks a real resource state across multiple decisions with a visible decision log and a debrief that doesn't moralize the outcome — multiple paths can succeed, per §14.3.
- **Audio Choice** was generalized to any stimulus type (text or audio) rather than staying audio-only, so it covers Stroop Challenge's visual-stimulus mechanic too, not just future audio content.

All 6 verified via a throwaway Playwright script (screenshotted, then deleted): full playthroughs completed correctly end-to-end (Branching Scenario's all 5 steps, Simulation's all 3 events with correct resource math, Evidence Hunt's two-stage scoring), zero console/page errors, keyboard-operable throughout.

## Phase 5 progress — Sound Safari (Discover band)

**Built through the REAL classroom-assignment flow, not another internal-only demo.** `brain-sound-safari.html` uses `engine-audio-choice.js` with placeholder phonics content (4 initial-sound rounds, browser-TTS narrated pending D1). It's a real, assignable catalog entry: `server/scripts/seed-sound-safari-catalog-entry.js` adds a `brain_games` row (reusing the existing catalog table per the blueprint's own "extend, don't duplicate" rule — its actual gameplay logs through `/api/learning-events`, not the legacy XP/badge tables that table is normally paired with). A teacher assigns it exactly like any of the 6 existing games (`teacher-classroom.html`'s Assign Game modal); a student opens it from `student-home.html` exactly like today.

**Two real, pre-existing gaps found and fixed while wiring this up:**
1. `teacher-classroom.html`'s assign-game dropdown read `g.title`, but `GET /api/brain-games` returns `g.name` — every game's label in that dropdown has been blank/undefined since it shipped. One-line fix.
2. `student-game.html`'s "Mark as Done" button has always sent an empty body (`{}`) to `/api/student/games/:id/complete` — `student_game_completions.raw_score`/`duration_ms` have never once been populated by any game, ever, despite the column existing. Fixed generically: `engine-sdk.js` now `postMessage`s real score/duration to the parent frame on completion, and `student-game.html` listens for it and auto-reports — purely additive (the manual button still works exactly as before for the 6 legacy games, which never post this message).

**Real research error caught and fixed in the same pass:** the original Phase 0/1 verification claimed no shared site-user auth middleware existed anywhere. Wrong — `server/routes/site-auth.js` has a real, already-used `requireSiteAuth` (imported by `classrooms.js`/`parent.js`/`social.js`/`teacher-lesson-plans.js`), just not in `server/middleware/` where the search looked. This had already led to building a redundant third implementation for D2 — now fixed: the real one's internals are extracted into `server/lib/site-user.js`, shared by both. See `LEADERSHIP_DECISIONS_REQUIRED.md` D2's corrected entry.

**Confirmed live 2026-09-17**: `tests/e2e/sound-safari-assignment.spec.ts` run against production — teacher assigns via the real API, student plays via the real UI, a real (non-null) score lands in `student_game_completions`. Test passed clean on the first fully-deployed attempt (an earlier attempt caught a real deploy gap: `rsync` hadn't actually copied new files into `public_html` — see the deploy-troubleshooting thread earlier in this session for the diagnostic pattern if this recurs).

## Phase 5 progress — Reading Detective, Decision Point, Money Matters

**Same real-assignment pattern as Sound Safari, hand-coded per explicit user decision** (not deferred to Phase 4 tooling). Each is a `brain-{slug}.html` page + an idempotent `server/scripts/seed-{slug}-catalog-entry.js` + an e2e test mirroring `sound-safari-assignment.spec.ts`:

- **Reading Detective** (`brain-reading-detective.html`, Explore band, `engine-evidence-hunt.js`) — 4 short mystery/inference passages, two-stage answer-then-evidence per item per §14.2's acceptance rule.
- **Decision Point** (`brain-decision-point.html`, Challenge band, `engine-branching-scenario.js`) — the real 5-step Issues-to-Answers cycle on a peer group-chat-exclusion scenario, choices spanning unsafe/plausible-incomplete/responsible/multiple-defensible/seek-help per §6.6's scoring rule, a trusted-adult option present per the sensitive-scenario rules, and a `freeReflection` step (never transmitted, per the engine's existing design).
- **Money Matters** (`brain-money-matters.html`, Advance band, `engine-simulation.js`) — a fictional persona's first-apartment budget across 4 events (repair emergency, subscription audit, bonus allocation, savings-vs-credit tradeoff); `debrief()` treats multiple end states as valid successes per §14.4's "don't moralize" acceptance rule.

**Two real, pre-existing scoring gaps found and fixed, not just one:** `engine-evidence-hunt.js`'s `onComplete()` never passed the optional `scoreInfo` second argument, unlike `engine-audio-choice.js` — so despite having a clear countable score (`evidenceSupported` out of `items.length`), Evidence Hunt would have reported `raw_score: null` for every completion, same as the legitimately-scoreless Branching Scenario/Simulation engines. Fixed with a one-line addition (`{ score: evidenceSupported, maxScore: items.length }`), matching Audio Choice's existing contract. A follow-up pass then found the identical gap in `engine-memory.js` (`{ score: matched, maxScore: pairCount }`) and `engine-pattern.js` (`{ score: correctCount, maxScore: items.length }`) — both fixed the same way. These 2 engines already power the 6 existing legacy games in production (Memory Match, Simon Sequence, Number Sequence, Stroop Challenge, etc.), so this fix changes live scoring behavior for games already in front of real students, not only the new pilot games.

**Confirmed live 2026-09-17**: `tests/e2e/reading-detective-assignment.spec.ts`, `decision-point-assignment.spec.ts`, and `money-matters-assignment.spec.ts` all ran clean against production on the first attempt after deploy (rsync + the 3 catalog-seed scripts, no app restart needed). Reading Detective's completion carries a real non-null `raw_score` (the Evidence Hunt fix); Decision Point and Money Matters correctly show a null `raw_score` with a real non-null `duration_ms`, since Branching Scenario and Simulation are intentionally scoreless by design (SEL/financial outcomes aren't reduced to right/wrong).

## Phase 6 progress — first slice: Reward Service + teacher report

**Chosen over Phase 4** (see prior entry) because the 4 pilot games gave students zero XP/badges and teachers no report at all — a gap Phase 5's own stated goal called for but never delivered. Full Phase 6 (§15) is large; this is a deliberately bounded first slice, same pacing as Phase 3 (2 releases) and Phase 5 (2 releases). See "Out of scope" below for what's deliberately deferred.

**Research finding that shaped the design:** the legacy reward pipeline (`brain-games.js`'s `PUT /sessions/:token/complete`) is deeply tied to legacy-mechanic-specific scoring and a `brain_game_sessions` lifecycle the 4 new games never create — retrofitting them into it would mean awkward special-casing. Instead: a new, engine-agnostic reward path, triggered from the one place both legacy and new games already converge when played via a classroom assignment (`student.js`'s `POST /games/:gaid/complete`), writing to the **same** `brain_game_user_progress`/`user_brain_badges`/`brain_user_streaks` tables the legacy pipeline uses — which means the existing student pages (`brain-games-progress.html`, `brain-badges.html`) show the new games' rewards with **zero frontend changes**, confirmed by reading their actual query code (`/me/progress`/`/me/badges` read those tables directly, no `brain_game_sessions` dependency).

**Part A — Reward Service:**
- New `server/lib/rewards.js`: `XP_LEVELS`/`getLevelFromXP`/`getNextLevel`/`updateStreak` extracted verbatim from `brain-games.js` (zero behavior change there), plus new `awardClassroomCompletion()` — flat 25 XP per completion (no accuracy bonus yet, see "Out of scope"), reuses the existing streak system, and awards a "first completion of this game" badge via a new `first_classroom_completion` criteria type.
- New `brain_games.reward_pipeline` column (`server/scripts/alter-add-reward-pipeline.js`) — `'legacy'` for the 6 existing games (so they're never double-rewarded), `'classroom_generic'` by default for everything else, including any future game with zero extra wiring.
- New badges (`server/scripts/seed-classroom-completion-badges.js`), using the exact names the blueprint proposes in §12.3: **Sound Explorer**, **Context Detective**, **Responsible Responder**, **Budget Builder** — one per pilot game.
- `student.js`'s completion route now looks up `reward_pipeline` and calls the new function when it's `'classroom_generic'`.

**Part B — Teacher report:** `GET /:id/game-assignments/:gaid/completions` (`classrooms.js`) already existed server-side with **zero frontend caller** — confirmed via grep. New `teacher-game-report.html` (mirrors `teacher-classroom-progress.html`'s existing stat-boxes + data-table pattern) is pure presentation on top of it: per-student play count, first/latest score, last-played time, plus CSV export. New "Results ↗" link added per assigned game in `teacher-classroom.html`, mirroring the existing lesson "Progress ↗" link.

**PIN-student parity is already inherent, not something to build:** `classroom_game_assignments`/`student_game_completions` are PIN-classroom-only end to end (confirmed via code search — no site-user-student path exists there at all), so there's no dual-identity gap to close for this slice, unlike `brain-games.js`'s own `getPrincipal()` resolver.

**Out of scope for this slice (flagged, not started):** assignment targeting by skill/range/domain/duration/scenario and individual/group assignment; adaptive lock/override controls (§11.3); cooperative classroom milestones (§12.4); admin aggregate reporting (blocked on unresolved decision **D4**, `LEADERSHIP_DECISIONS_REQUIRED.md`); full reset/audit tooling (§13.4); wiring Decision Point's `freeReflection` step into the existing `student_reflections` table (a real, separate content-safety-gateway decision — deliberately not bundled in here); forwarding `maxScore` through the postMessage chain to unlock accuracy-weighted bonus XP later.

**Real concurrency bug found and fixed during verification:** `awardFirstCompletionBadge()` originally re-read `total_completed` in a separate query after the XP upsert to decide "is this the very first completion" — racy when two completions of the same student+game land close together, which happened for real when this slice's own regression run played Reading Detective for the same QA student from two specs in parallel. Fixed by reading `isFirstCompletion` directly off the upsert's own `affectedRows` (1 = fresh INSERT, 2 = update via `ON DUPLICATE KEY`) instead of a second query.

**Worth remembering for future test-writing on this system:** `GET /api/brain-games/me/*` resolves identity via `getPrincipal()`, which tries a site-user (teacher) cookie *before* a student cookie — so checking a PIN-student's progress/badges from the same browser context used to sign in as a teacher (as every other e2e helper in this suite safely does, since none of them call this particular dual-purpose resolver as "the student") silently reads back the teacher's own progress instead. `tests/e2e/classroom-generic-reward.spec.ts` works around this with an isolated `browser.newContext()` for the student portion, and creates a disposable student per run (deleted after) rather than reusing the shared QA fixture student, since the badge is only ever awarded on a genuinely first-ever completion.

**Confirmed live 2026-09-17** (Release 45): `tests/e2e/classroom-generic-reward.spec.ts` plus all 4 pilot-game specs run together against production — all 5 passed clean, no regression from the `student.js` route change.

## Next recommended step
Decide whether to continue Phase 6 (assignment targeting / adaptive controls / cooperative milestones — D4 still blocks admin reporting) or move to Phase 4/7/8 to scale the catalog — worth deciding explicitly rather than defaulting, per this project's own established pattern.
