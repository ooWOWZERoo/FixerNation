# Tune Your Brain — Phase Status

**Read this first in any new session before doing more Tune Your Brain work.** Updated at the end of every work package — if it's stale, something was skipped.

Legend: ✅ done & deployed · 🟡 coded & pushed, not yet deployed · ⬜ not started

| Phase | What it is | Status |
|---|---|---|
| 0 | Repository forensics & baseline verification | ✅ Done (`docs/tune-your-brain/BLUEPRINT_VERIFICATION_REPORT.md` etc.) |
| 1 | Architectural foundation — PIN-student reward fix | ✅ Done & deployed, confirmed live 2026-09-16 (Release 38) |
| 1 | Architectural foundation — feature flags, skill-graph tables, `learning_events`, shared site-auth helper | ✅ Done & deployed, confirmed live 2026-09-16 |
| 2 | Shared design system + 4 experience-band tokens + accessibility utilities | 🟡 Coded & pushed 2026-09-16 — **needs deploy** (static files only, no restart) |
| 3 | Game Engine SDK + normalized session runtime | 🟡 Coded & pushed 2026-09-16 — **needs deploy** (new API route + static files, restart needed) |
| 4 | Skill graph seeding + content governance workflow | ⬜ Not started (empty tables exist from Phase 1) |
| 5 | Vertical slice pilot — first 4 real playable games (1 per band) | ⬜ Not started |
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

## What "done" does NOT mean yet
No new game exists. No student, teacher, or admin can see or play anything different from before this work started. Phases 1–2 are exclusively backend/frontend plumbing — the first actually-playable new thing arrives in Phase 5.

## Deploy queue (not yet run on production)
1. Phase 2 static files (`git pull` + rsync — no restart needed).
2. Phase 3: `git pull` + rsync + **Node restart** (new `/api/learning-events` route added to `server/app.js`).

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

## Next recommended step
Phase 3's exit gate is now fully met (multiple engines proven, not just one). Move to Phase 4: skill graph seeding + content governance workflow — the empty `skills`/`skill_prerequisites` tables from Phase 1 need real content and a draft/review/publish workflow before Phase 5's actual pilot content can be authored against them.
