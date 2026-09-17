# Tune Your Brain — Full Spec Reconciliation, 2026-09-17

Requested after asking whether "deepening Phase 6" would cover age/grade-based game filtering — it didn't, which prompted a full reconciliation between the master blueprint (`FNE_TUNE_YOUR_BRAIN_MASTER_IMPLEMENTATION_ROADMAP.md`) and everything actually built through Release 46. The concern raised: the games capability is "far from shippable to clients" and "not competitive to other SEL games companies," and SEL must stay "in the forefront" of built and future games.

This document is the reconciliation. It is a snapshot as of 2026-09-17 — re-verify against `PHASE_STATUS.md` before trusting it in a later session, since both will drift as work continues.

## Method

Read the full master blueprint directly (every section, including ones not read earlier this session: §3-5 vision/principles, §6.1-6.2 five domains/learning-science rules, §7-8 visual/audio/accessibility direction, §9 full platform architecture, §15 phases 9-13, §16-20 Definition of Done/Testing/Metrics/Governance/Risks, §23-25). Cross-checked two research passes: one over the secondary planning docs in this directory, one over the live codebase (schema, routes, admin pages, test tooling).

## Finding 1 — SEL is one of five domains by design, and badly under-served even on its own terms

§6.1 defines five domains, not one: **Literacy & Communication**, **Math & Applied Numeracy**, **Thinking & Executive Skills**, **SEL & Character**, **Wellness & Life Skills**. SEL was never meant to be the entire product — so the current game mix isn't a drift from spec on domain balance alone.

Of the 8 new pilot/catalog games built (Sound Safari, Reading Detective, Decision Point, Money Matters, Choice Quest, Headline, Money Moves, Critical Read):

| Domain | Games | Count |
|---|---|---|
| Literacy & Communication | Sound Safari, Reading Detective, Headline, Critical Read | 4 |
| Wellness & Life Skills (financial) | Money Matters, Money Moves | 2 |
| **SEL & Character** | **Decision Point, Choice Quest** | **2** |
| Thinking & Executive Skills | *(only the 6 legacy games)* | 0 new |
| Math & Applied Numeracy | *(Fraction Kitchen not built)* | 0 |

**The sharper problem, specific to competing with SEL-focused vendors:** §6.4 maps SEL internally to the 5 CASEL competencies — Self-awareness, Self-management, Social awareness, Relationship skills, Responsible decision-making. Decision Point and Choice Quest both hit Social awareness / Relationship skills / Responsible decision-making. **Neither touches Self-awareness or Self-management at all.**

This is not just a build-order gap — it's baked into the blueprint's own Phase 1 catalog (§14):
- **Feelings Detective** (Discover band) is the *only* planned game targeting emotion vocabulary/self-awareness, and it needs a brand-new engine (`Scenario Choice`, multi-select) that doesn't exist yet.
- **There is no planned Phase-1 game at all for Self-management** (coping strategies, emotional regulation, impulse control). The closest concept, "Life Balance Simulator," sits in the far-future Phase 10 list (§15, roughly a dozen phases and multiple engine-builds away).

A second, sharper gap: `engine-branching-scenario.js`'s `freeReflection` step is designed so its text is **never transmitted anywhere** — confirmed in the engine's own code comments. This means teachers currently get *zero* visibility into SEL reflection content from Decision Point or Choice Quest, even though §13.2 explicitly requires teacher reporting to distinguish "academic response evidence from SEL reflection." Right now the SEL games give teachers **less** visibility than the academic ones (which show real scores). That undercuts an "SEL is our differentiator" position — dedicated SEL vendors typically do give teachers reviewed reflection visibility.

**Recommendation (not started — needs a content/product decision, not blind engineering):**
1. Design and build one or more games targeting Self-Awareness and Self-Management specifically — this is a real content-design conversation (what's the scenario? what band?), not something to build without your input on concept.
2. Decide whether/how to route SEL reflections through the existing content-safety gateway (`server/lib/safety/gateway.js`) so teachers get real, reviewed evidence instead of nothing. This is a genuine data-handling decision (student free-text, safety review, retention) — worth its own conversation.
3. Consider whether cooperative classroom-wide SEL milestones (§12.4: "the class practiced 500 words," "completed 100 kindness missions" — 0% built today) belong in an earlier slice than the roadmap currently implies, given how many SEL competitors lean on classroom-culture features.

## Finding 2 — Platform infrastructure gaps that block real shippability

These aren't "more content" gaps — they're the difference between a working demo and something you can respons­ibly hand a paying school.

- **The pilot feature flag (`tune_your_brain_pilot_enabled`) was completely inert until this pass** — seeded disabled in the DB, a real and correct `isFeatureEnabled()` checker written in `server/lib/feature-flags.js`, but nothing ever called it. Every one of the 8 new games has been visible to every school since launch, with no way to pilot with a permissioned cohort (§17.4 requires exactly this) or kill-switch a problem. **Fixed in this pass** — see "What changed" below.
- **Zero admin visibility, at every level.** Confirmed via grep: no `admin-*.html`, `district-admin-*.html`, or `school-admin-*.html` file mentions Tune Your Brain at all — no menu link, no page, nothing. This is bigger than "Phase 6's aggregate admin reporting is blocked by unresolved decision D4" (`LEADERSHIP_DECISIONS_REQUIRED.md`) — FNE staff and school/district admins currently have no way to know this product exists, let alone see usage. **Not started.**
- **No accessibility test tooling anywhere in this entire repository, for anything** — not just Tune Your Brain. No axe-core or pa11y dependency, no dedicated a11y test file under `tests/`. §8 targets WCAG 2.2 AA; nothing has ever been automatedly checked against it, for any page on the site. `accessibility-utils.js` (Phase 2) is real, used runtime code (reduced motion, live-region announcements, keyboard activation) — but that's a mechanism for developers to use correctly, not verification that they did. **Not started**, and bigger than a Tune Your Brain fix.
- **The internal skill graph (§9.6) is empty and completely unwired.** `skills`/`skill_prerequisites` have zero seed rows; grep confirms no game content pack anywhere references a skill ID. The full content-pack contract (§9.5 — roughly 25 required fields per content item, including skill IDs, standards mappings, review/approval state, versioning, ordered hint levels) is nowhere near met. Every content pack shipped so far is a bare JS literal with none of this metadata. This is Phase 4/9 territory and a real, large undertaking. **Not started.**
- **`BLUEPRINT_TRACEABILITY_MATRIX.md` is stale** — a frozen Phase-0 snapshot still marking things "MISSING" that are now built and deployed (accessibility utilities, the four experience bands, the learning-event model, the PIN-student reward fix). It's substantial (189 lines, 24 traced requirements) and deserves dedicated attention, not a rushed pass appended here. **Flagged, not refreshed in this pass.**
- **Orphaned operational gaps, flagged once at Phase 0 and never revisited:** no error-monitoring service, no backup/rollback documentation, no CI (every deploy this session has been verified by manually re-running Playwright specs by hand, not a gate). Not games-specific, but real production risk for a "shippable to clients" bar. **Not started.**
- **The legacy-game rubric pass was never done.** Reaction Time's and Stroop Challenge's speed-pressure feedback needs a direct gameplay review before those two can honestly be called "preserved and evolved" (§14.5) rather than just relabeled. **Not started.**

## What changed in this pass

1. **Band/grade-based game filtering.** New `brain_games.band` column, populated for the 8 new games from each page's own existing default band; the 6 legacy games stay `NULL` ("show for every band" — they were never designed for one specific band). `teacher-classroom.html`'s Assign Game dropdown now defaults to the classroom's grade-matched band, with a visible "Show games for all grade bands" override, per §6.3's own rule that bands are defaults, not restrictions. This is a UX guardrail, not a security boundary — the API remains unfiltered by band, so a teacher can still assign anything.
2. **The pilot feature flag now actually gates something.** `GET /api/brain-games` resolves the requester's school and checks `tune_your_brain_pilot_enabled`, hiding the 8 new games (identified via the existing `reward_pipeline='classroom_generic'` marker) when the flag is off for that school. **The flag was simultaneously set to enabled globally** as part of this same deploy, so today's actual visibility doesn't change — this delivers the *mechanism* for a future controlled rollout without silently pulling games out from under anyone. Whether to later scope it down to specific pilot schools is your call, not something done unasked.

## Explicitly not started — needs an explicit decision before work begins

- New SEL game(s) targeting Self-Awareness / Self-Management (Finding 1).
- Routing SEL reflections through the content-safety gateway (Finding 1).
- Admin-facing Tune Your Brain visibility at any level (FNE/district/school).
- Accessibility test tooling (repo-wide, not games-specific).
- Skill-graph seeding and real content governance (Phase 4/9 — draft/review/publish workflow, standards mapping).
- CI, error monitoring, backup/rollback documentation.
- Legacy-game (Reaction Time, Stroop Challenge) rubric review.
- Full `BLUEPRINT_TRACEABILITY_MATRIX.md` refresh.
- Cooperative classroom-wide SEL milestones (§12.4).
- The 4 remaining catalog games needing new engines (Word Builder, Number Garden, Feelings Detective, Fraction Kitchen) and the 6-game legacy migration (§14.5).

---

## Update, 2026-09-17 (later same day) — SEL × band coverage, made explicit, plus filters

Follow-up after re-raising the SEL gap directly: is Finding 1 above concrete enough to act on? Mapping the 5 CASEL competencies (§6.4) against the 4 experience bands, using only what's actually built:

| | Discover | Explore | Challenge | Advance |
|---|---|---|---|---|
| Self-awareness | none | none | none | none |
| Self-management | none | none | none | none |
| Social awareness | none | Choice Quest | Decision Point | none |
| Relationship skills | none | Choice Quest | Decision Point | none |
| Responsible decision-making | none | Choice Quest | Decision Point | none |

Two things stand out: **Self-awareness and Self-management have zero coverage in any band**, and **Discover and Advance have zero SEL & Character games at all** — only Explore and Challenge have one each, and even those only cover 3 of 5 competencies.

**Most of this doesn't need a new engine.** `engine-branching-scenario.js` (already proven twice, in Decision Point and Choice Quest) is a 5-step decision cycle — it fits Self-management scenarios (recognizing frustration or stress, considering coping strategies, choosing one, reflecting) and an Advance-band SEL scenario (workplace/relationship/digital-life decisions per §6.5's own Advance progression) just as well as it fits peer/social scenarios. **Only genuine Self-awareness content** — naming or recognizing emotions from ambiguous cues, where more than one feeling can be valid — **actually needs the not-yet-built multi-select engine** (`Scenario Choice`, the blueprint's own "Feelings Detective" design).

### Recommended phased path forward (not started — sequence proposed, not building content blind)

1. **Self-management, reusing Branching Scenario.** No new engine needed. Fills the single biggest gap (zero coverage in any band) with the least engineering risk.
2. **Advance-band SEL, reusing Branching Scenario.** No new engine needed. Fills the other completely-empty band.
3. **The `Scenario Choice` engine + a real Self-awareness game** (the Feelings Detective concept). The one gap that genuinely needs new engine work, since it requires multi-select that no current engine supports.
4. **Revisit Self-awareness and Self-management for the other bands too.** CASEL competencies apply at every grade level, not just once each — the end state is meaningful coverage across all 4 bands, not "5 competencies × 1 band each."

Content design for 1-2 still needs a real conversation (what's the scenario, what band specifics) before building — same reasoning as Finding 1's original recommendation.

### Filters added to `brain-games.html`

The catalog page had zero filtering and two real bugs, found while designing the filter UI: (a) `GAME_URLS` only mapped the 6 legacy slugs, so all 8 new games were dead "Play Now" links from this page (never caught before, since every e2e test plays games through the classroom-assignment path instead); (b) the hero copy and badge chips still described the original 6-game "brain-training" product with no mention of literacy, SEL, or life skills, despite the catalog having tripled in scope. Both fixed. New `brain_games.domain` column (one of the 5 §6.1 domains per game) and `brain_games.casel_competencies` (a `SET`, populated only for the 2 SEL games) back two new client-side chip filters — Band and Focus — reusing the existing `.lesson-chip` pattern from `teacher-classroom.html`. `casel_competencies` is stored now but not yet exposed as its own filter; with only 2 SEL games sharing near-identical competency tags today, a competency-level filter would be closer to decoration than a real feature — revisit once items 1-3 above land.

---

## Update, 2026-09-17 (later same day) — SEL games-per-band, scoped

The band filter itself had a real bug of its own — see `USABILITY_REVIEW_2026-09-17.md` for the fix — reported alongside two asks: several SEL games per band (not just one gap-filler each), and a full usability review. That review, done by loading Sound Safari locally rather than just reading the CSS, also surfaced that 3 of the 4 game engines (`engine-branching-scenario.js`, `engine-simulation.js`, `engine-evidence-hunt.js`) have zero audio support — which matters directly here, since Branching Scenario's text-based 5-step cycle conflicts with Discover's own "no reading required, spoken support" rule (§7.2). It's the right engine for Explore/Challenge/Advance SEL content; a genuine Discover-band SEL game needs `engine-audio-choice.js`'s existing narration instead (a simpler, single-select mechanic), or a future audio extension to Branching Scenario.

**Scoped list, prioritizing the two bands with zero SEL & Character games today** (Discover, Advance) over adding a second game to bands that already have one (Explore has Choice Quest, Challenge has Decision Point):

| Band | Concept | Engine | CASEL competencies | Status |
|---|---|---|---|---|
| Discover | **Calm Down Corner** — a frustrating moment (a block tower falls), pick the best calming strategy | Audio Choice (narrated, single-select) | Self-management | **Written and live** |
| Discover | A true emotion-recognition game (the "Feelings Detective" concept — more than one feeling can be valid) | needs the not-yet-built multi-select `Scenario Choice` engine | Self-awareness | Blocked, no engine |
| Advance | **First Shift** — a new part-time job, a coworker asks you to cover for their mistake | Branching Scenario | Responsible decision-making, Relationship skills | **Written and live** |
| Advance | **The Post** — a friend wants to repost something that could hurt a classmate's reputation | Branching Scenario | Social awareness, Relationship skills, Self-management (peer pressure) | **Written and live** |
| Explore | **Team Pick** — picked last for a team, manage the frustration of feeling left out | Branching Scenario | Self-management, Relationship skills | **Written, pushed, not yet deployed** |
| Challenge | **Group Chat Meltdown** — friends joke about an embarrassing moment in a group chat, manage the urge to fire back | Branching Scenario | Self-management, Responsible decision-making | **Written, pushed, not yet deployed** |

**Update:** all 3 buildable-now games from the first batch (Calm Down Corner, First Shift, The Post) are live. **Update, 2026-09-17 (later still):** Explore's and Challenge's second SEL games (Team Pick, Group Chat Meltdown) are now also written, closing the Self-management gap in both bands — coded and pushed, see `PHASE_STATUS.md`'s Deploy queue for the deploy steps. Every band now has real Self-management coverage. Remaining open item: genuine Self-awareness content anywhere, still blocked on the not-yet-built multi-select `Scenario Choice` engine (the "Feelings Detective" concept).

**A repeat of the dead-link bug, found and fixed permanently this time:** `brain-games.html`'s `GAME_URLS` map didn't get Calm Down Corner's entry added when that game was created — the exact same bug class as the original 8-game dead-link fix, just recurring on a 9th game because a hand-maintained map has to be remembered every time. Fixed by removing the map entirely: every game's URL is now computed as `'brain-' + slug + '.html'`, which every game without exception already follows. This closes the whole bug class permanently, not just this one instance.
