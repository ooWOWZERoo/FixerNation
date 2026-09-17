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
| 5 | Vertical slice pilot — first 4 real playable games (1 per band) | 🟡 1 of 4 built & deployed (Sound Safari, Discover band), confirmed live 2026-09-17 via full Playwright regression (Release 43). 3 to go. |
| 6 | Assignments/progression/goals/rewards/reporting | ⬜ Not started |
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
Phases 1–3 were pure plumbing — but Phase 5 shipped one real, playable game (Sound Safari) that a teacher can assign and a student can actually play today, confirmed via a full Playwright run against production, not just a manual check. 3 of the 4 vertical-slice games still don't exist (Reading Detective, Decision Point, Money Matters).

## Deploy queue
Empty — everything through Release 43 is confirmed live as of 2026-09-17.

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

## Next recommended step
Build the remaining 3 vertical-slice games (Reading Detective/Explore, Decision Point/Challenge, Money Matters/Advance) the same way — through the real assignment flow, not as demos — or move to Phase 4's content-governance workflow if hand-coding 3 more content packs directly in HTML feels like the wrong direction before that tooling exists. Worth deciding explicitly rather than defaulting.
