# Tune Your Brain — Phase Status

**Read this first in any new session before doing more Tune Your Brain work.** Updated at the end of every work package — if it's stale, something was skipped.

**Also read `GAP_ANALYSIS_2026-09-17.md` and `USABILITY_REVIEW_2026-09-17.md` first** — the first is a full reconciliation between the master blueprint and everything actually built, prompted by a real concern that the games capability isn't yet shippable to clients or competitive with dedicated SEL vendors. It has a prioritized list of what's flagged but not started; several items there (admin visibility, accessibility test tooling, a real SEL self-awareness/self-management game, skill-graph seeding) are bigger and more consequential than anything in this file's own "Not started" rows suggest. The second documents a real filter bug and a Discover-band graphics gap found by loading the actual pages, not just reading the CSS — read it before assuming any band-aware CSS mechanism works as documented.

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
| 7 | Catalog Wave A — Discover/Explore new games + legacy migration | 🟡 Explore's Choice Quest done & deployed, confirmed live 2026-09-17 (Release 46). Word Builder/Number Garden/Feelings Detective (Discover) and Fraction Kitchen (Explore) not started — each needs a new engine (`Build`, `Manipulative`, multi-select `Scenario Choice`) that doesn't exist yet. Legacy migration (Memory Lab/Sequence Lab/Pattern Lab) not started. |
| 8 | Catalog Wave B — Challenge/Advance new games + legacy migration | 🟡 Headline, Money Moves (Challenge) and Critical Read (Advance) done & deployed, confirmed live 2026-09-17 (Release 46) — all 3 reuse existing engines. Legacy migration (Reaction Challenge/Focus Lab) not started. |
| 9 | Content administration / scaled authoring tools | ⬜ Not started |
| 10 | Phase 2 curriculum expansion (14 more games) | ⬜ Not started |
| 11 | District/enterprise readiness | ⬜ Not started |
| 12 | Evidence/validation/continuous improvement | ⬜ Not started |
| 13 | Long-term K-12 platform end state | ⬜ Not started |

## Still-open leadership decisions
See `LEADERSHIP_DECISIONS_REQUIRED.md`. D1 (is ElevenLabs actually live — blocks Phase 5 audio content) and D4 (how aggregate is school-admin visibility — blocks Phase 6 reporting) are the only two still genuinely unanswered.

## What "done" means as of 2026-09-17
Phases 1–3 were pure plumbing. Phase 5 is fully done: all 4 vertical-slice games are deployed and confirmed live. Phase 6's first slice (Reward Service + teacher report) is also deployed and confirmed live (Release 45). Phases 7/8's first slice — 4 more catalog games (Choice Quest, Headline, Money Moves, Critical Read) — is also deployed and confirmed live (Release 46). Band/grade filtering + pilot feature-flag wiring is also deployed and confirmed live (Release 47). `domain`/`casel_competencies` tagging + real filters on `brain-games.html` (plus the dead-link and stale-copy fixes it surfaced) is also deployed and confirmed live (Release 48). A follow-up pass — the band-filter bug fix, the Discover-band visual prototype, and a usability review — is coded and pushed, **not yet deployed**, see Deploy queue.

## Deploy queue
- Band-filter bug fix + Discover-band visual prototype: pure CSS/JS changes to `brain-games.html`/`brain-games.css`, no schema change, no server-route change. rsync only, **no app restart needed**.

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

## Phases 7/8 progress — first slice: Choice Quest, Headline, Money Moves, Critical Read

**User chose to scale the catalog over continuing deeper into Phase 6, then chose hand-coding over Phase 4 tooling — same call as the Phase 5 vertical slice.** Of the 8 remaining flagship games (§14), only 4 reuse engines that already exist: **Choice Quest** (Explore, `engine-branching-scenario.js`), **Headline** and **Money Moves** (Challenge, `engine-evidence-hunt.js`/`engine-simulation.js`), **Critical Read** (Advance, `engine-evidence-hunt.js`). The other 4 (Word Builder, Number Garden, Feelings Detective — Discover; Fraction Kitchen — Explore) each need a genuinely new engine (`Build`, `Manipulative`, a multi-select `Scenario Choice` variant) that doesn't exist yet — real engine-design work, a different and bigger decision than "hand-code more content." Legacy migration (Memory Lab/Sequence Lab/Pattern Lab/Reaction Challenge/Focus Lab, §14.5) is also a separate, different-shaped task (retrofitting *existing* live games, with its own "don't lose earned progress" regression requirement) and isn't started.

- **Choice Quest** (`brain-choice-quest.html`, Explore band) — the same 5-step Issues-to-Answers cycle as Decision Point, adventure-framed per Explore's developmental design (§6.5: friendship repair, inclusion, cooperation) around a team-project scenario rather than Decision Point's peer/digital one.
- **Headline** (`brain-headline.html`, Challenge band) — 4 short, deliberately non-partisan school-news items (per §14.3's acceptance rule), same two-stage answer-then-evidence mechanic as Reading Detective, choosing the accurate headline over exaggerated/misleading distractors.
- **Money Moves** (`brain-money-moves.html`, Challenge band) — a simpler resource set than Money Matters (no credit-score concept, appropriate for grades 6-8): saving toward a bike across 4 events. Numeric ranges were hand-verified (via a throwaway Node script) so every path stays non-negative regardless of earlier choices.
- **Critical Read** (`brain-critical-read.html`, Advance band) — 4 mature media-literacy passages distinguishing fact from opinion/inference and flagging source bias, per §14.4's "does not reduce credibility to a simplistic single signal" acceptance rule.

**A nice side effect of the Phase 6 Reward Service:** `brain_games.reward_pipeline` defaults to `'classroom_generic'` for any new game with zero extra wiring, so all 4 of these get real XP/streaks the moment they're seeded — only new badge rows were needed (appended to the existing `seed-classroom-completion-badges.js`, not a new script): **Perspective Builder** (Choice Quest), **Digital Citizen** (Headline), **Problem Solver** (Money Moves), and **Source Sleuth** (Critical Read, not one of the blueprint's §12.3 example names — none of the remaining ones fit this content — but kept in the same voice).

**Confirmed live 2026-09-17** (Release 46): 6 Playwright specs run together against production — the 4 new game specs plus `decision-point-assignment.spec.ts`/`reading-detective-assignment.spec.ts` to confirm no regression on the shared engines — all passed clean. The reward wiring was also spot-checked directly (a throwaway script, deleted after): all 4 new games correctly awarded 40 XP (25 base + 15 badge) and the exact right badge with `earned: true` on first completion.

## Full spec reconciliation, band/grade filtering + pilot flag wiring

Prompted by asking whether "deepening Phase 6" covers age/grade-based game filtering — it didn't, which led to a full reconciliation between the master blueprint and everything built through Release 46. **See `GAP_ANALYSIS_2026-09-17.md` for the full writeup** — summary here:

- **Band/grade filtering**: new `brain_games.band` column, populated for the 8 new games from each page's own existing default band (legacy games stay `NULL` — never designed for one band). `teacher-classroom.html`'s Assign Game dropdown now defaults to the classroom's grade-matched band with a "Show games for all grade bands" override (§6.3's own rule). UX guardrail only — the API stays unfiltered.
- **The `tune_your_brain_pilot_enabled` feature flag now actually does something** — it existed since Phase 1 with a real checker function but nothing ever called it, so every new game has been visible to every school with no way to pilot a cohort or kill-switch a problem. `GET /api/brain-games` now checks it per-school (via the existing `reward_pipeline='classroom_generic'` marker as the "is this a pilot game" proxy). **Set to enabled globally in the same deploy** so today's visibility doesn't change — this delivers the rollout mechanism without pulling games out from under anyone; scoping it down to specific pilot schools later is a separate decision.
- **The sharpest finding**: of the 8 games built, only 2 (Decision Point, Choice Quest) are genuinely SEL & Character, and neither touches the CASEL Self-Awareness or Self-Management competencies — a gap baked into the blueprint's own Phase 1 catalog, not just a build-order artifact. Flagged as needing its own content/product decision, not started.

**Confirmed live 2026-09-17** (Release 47): a direct API check confirmed all 14 games still return with correct `band` values post-deploy (no visibility regression from the flag going live), plus 9 Playwright specs run together against production — all passed clean.

## SEL × band coverage made explicit, plus real filters on `brain-games.html`

Direct follow-up to the SEL finding above. **See `GAP_ANALYSIS_2026-09-17.md`'s "Update" section for the full CASEL × band matrix** — summary: Self-awareness and Self-management have zero coverage in any band, and Discover/Advance have zero SEL & Character games at all. Most of this is closeable with the existing `engine-branching-scenario.js` (no new engine) — only real Self-awareness content needs the not-yet-built multi-select engine. Recommended phased sequence (content not started, no sign-off yet on specific scenarios): (1) a Self-management game reusing Branching Scenario, (2) an Advance-band SEL game reusing Branching Scenario, (3) the `Scenario Choice` engine + a real Self-awareness game, (4) revisit self-awareness/self-management for every band, not just one each.

Also, while inspecting `brain-games.html` to design the filters: **found and fixed 2 real bugs** — `GAME_URLS` only mapped the 6 legacy slugs, so all 8 new games were dead "Play Now" links from this page (missed until now since every e2e test plays through the classroom-assignment path instead); and the hero copy/badges still described the original 6-game "brain-training" product with zero mention of literacy, SEL, or life skills. New `brain_games.domain` (one of the 5 §6.1 domains per game) and `brain_games.casel_competencies` (`SET`, populated for the 2 SEL games only) back two new client-side chip filters, Band and Focus, reusing the existing `.lesson-chip` pattern from `teacher-classroom.html`.

**Confirmed live 2026-09-17** (Release 48): a direct API check confirmed all 14 games return correct `domain` values, plus a Playwright check of the actual UI — Focus→SEL correctly shows exactly Decision Point/Choice Quest, Band→Discover correctly shows exactly Sound Safari, and all 14 "Play Now" links (including the 8 previously-dead ones) resolve to a real game page.

## Band-filter bug fix + Discover-band visual prototype + usability review (coded, not yet deployed)

The band filter added in Release 48 had a real bug of its own: `g.band === activeBand` excludes every legacy game (`band: NULL`) the instant any specific band chip is active, so cycling through band chips without ever picking "All" only ever surfaced the 8 new games — exactly what got reported. Fixed to match `teacher-classroom.html`'s already-correct predicate (`!g.band || g.band === activeBand`).

**Loaded Sound Safari locally (not just read the CSS) to investigate the Discover-graphics report — found a real, precise bug, not a missing feature.** `.band-aware`'s `calc(1em * var(--band-scale))` font-scaling was being silently overridden by later, equal-specificity rules with fixed pixel values (`.fn-choice-btn { font-size: 15px }`, `.game-page-header .game-icon { font-size: 52px }`) — the band-aware mechanism itself is real and correctly wired (tap-target height genuinely does scale to 56px for Discover), it just never reached the two elements that most needed it. Both fixed to scale with `--band-scale`, which helps every band a little, not just Discover.

**Built a Discover-band visual prototype**, per the user's direction (prototype one band now, decide after seeing it, given 4 reference images showing real illustrated worlds per band rather than a shared skin with size tweaks). CSS-only, scoped to `html[data-band="discover"]`: an illustrated backdrop (sky gradient, sun, hills — all CSS, no image assets) behind a much larger header icon, and the choice list changed from thin list rows to a grid of large square picture cards. **This is a direction prototype, not production art** — full findings, screenshots, and the still-emoji-based caveat are in `USABILITY_REVIEW_2026-09-17.md`.

**Also surfaced:** 3 of the 4 engines (Branching Scenario, Simulation, Evidence Hunt) have zero audio support — only Audio Choice narrates. This directly shapes the SEL-games-per-band list below: genuine Discover-band SEL content needs Audio Choice's narration (simpler, single-select), not Branching Scenario's text-heavy 5-step cycle.

**Not yet deployed** — pure CSS/JS, no schema change, no server-route change, no app restart needed, just rsync.

## SEL games-per-band, scoped (not built)

Per the user's ask for several SEL games per band. **Full table in `GAP_ANALYSIS_2026-09-17.md`'s newest update.** Prioritizes the two bands with zero SEL & Character games today (Discover, Advance) over adding a second game to Explore/Challenge, which already have one each:

- Discover: **Calm Down Corner** (Audio Choice, Self-management) — buildable now. A true Self-awareness game (Feelings Detective) still needs the not-yet-built multi-select `Scenario Choice` engine.
- Advance: **First Shift** and **The Post** (both Branching Scenario) — buildable now, closing Advance's current zero-SEL-coverage gap.
- Explore/Challenge: a second game each, deferred to a later batch.

None of these 3 buildable-now games have been written yet — content design is a real decision each time, same as every prior SEL game.

## Next recommended step
Deploy the bug fix + prototype (see Deploy queue), then decide which of the 3 buildable-now SEL games to write first, whether the Discover visual direction is worth continuing (vs. sourcing real illustration, per `GAP_ANALYSIS_2026-09-17.md`'s original art-direction fork), or pivot to admin-facing Tune Your Brain visibility / accessibility test tooling (both still zero). Worth deciding explicitly rather than defaulting.
