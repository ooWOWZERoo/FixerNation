# Blueprint Traceability Matrix — Tune Your Brain

Every material requirement in `MASTER_PLAN.md` (the repo copy of `FNE_TUNE_YOUR_BRAIN_MASTER_IMPLEMENTATION_ROADMAP.md`), mapped to evidence gathered from the repository, live production, and external sources. See `CURRENT_STATE_ARCHITECTURE.md` for the underlying architecture citations and `REFERENCE_REGISTER.md` for external-source citations referenced by short name below.

**Status legend:** ALIGNED · PARTIAL · CONFLICT · DUPLICATIVE · OBSOLETE · MISSING · RESEARCH-DEPENDENT · LEADERSHIP DECISION

Format per item: **ID — Requirement** (§ blueprint section) → Evidence / Source → Status → Technical fit → Curriculum/SEL fit → Privacy/accessibility impact → Recommended disposition → Phase → Owner → Acceptance test.

---

## A. Product vision & end-state (§3)

**T1 — "Tune Your Brain" as the product name for the expansion** (§3)
- Evidence: `brain-games.html` H1 is already literally "Tune Your Brain" in production; badge `cross-ultimate` is literally named "Tune Your Brain Master" (`GET /api/brain-games/me/badges`, fetched live 2026-09-16).
- Status: **ALIGNED**. Technical fit: n/a (naming). Curriculum/SEL fit: n/a. Privacy/accessibility: none.
- Disposition: no rename needed anywhere; blueprint correctly describes an *evolution* of an existing, already-named feature, not a new brand.
- Phase: n/a. Owner: n/a. Acceptance: none needed.

**T2 — Four experience bands (Discover/Explore/Challenge/Advance) replace the current single presentation** (§3, §6.3)
- Evidence: current `brain-games.html`/game pages have one undifferentiated presentation for all ages (confirmed via live fetch — no age-band branching found in `brain-*.html` markup).
- Status: **MISSING**. Technical fit: L — genuinely new (shared layout/shell system, avatar continuity, band-specific asset sets). Curriculum/SEL fit: sound, matches standard developmental-differentiation practice (see REFERENCE_REGISTER §1). Privacy/accessibility: neutral, but four presentation layers quadruples the accessibility surface to test.
- Disposition: build as Phase 2 (Shared Design System and Four Experience Shells), exactly as the blueprint sequences it.
- Phase: 2. Owner: Product/UX design lead. Acceptance: same sample activity renders correctly and accessibly in all four bands.

**T3 — Five integrated learning domains (Literacy, Math, Thinking/Executive, SEL/Character, Wellness/Life Skills)** (§3, §6.1)
- Evidence: today's 6 games cover only Thinking/Executive-adjacent cognitive skills (memory, reaction, sequencing, attention, arithmetic, pattern recognition) — no literacy, no SEL/branching-scenario, no wellness/life-skills game exists. Morning Boost (separate feature) already covers SEL via the Issues-to-Answers framework in lesson form, not game form.
- Status: **PARTIAL** (1 of 5 domains has any game-form coverage today; SEL has curriculum-form coverage via Morning Boost that the blueprint's Branching Scenario engine would need to interoperate with, not duplicate).
- Disposition: confirm Choice Quest/Decision Point (branching-scenario SEL games) are understood by content leadership as a *new, game-form* delivery of Issues-to-Answers, additive to Morning Boost's lesson-form delivery — not a replacement. Phase: 4/7/8 (content). Owner: Curriculum lead. Acceptance: skill-graph seed shows all 5 domains with at least one Phase-1 experience each.

**T4 — Internal skill graph with prerequisites/versioning, decoupled from any single standards framework** (§3, §9.6)
- Evidence: no skill/standards table exists anywhere in `schema.sql`; curriculum today is organized by `curricula`/`lessonsCount`/`series`, not by atomic skill IDs.
- Status: **MISSING**. Technical fit: L, foundational. Curriculum/SEL fit: matches WWC/Common Core best practice of standards-independent skill sequencing (REFERENCE_REGISTER §4). Privacy/accessibility: none directly.
- Disposition: build in Phase 4, seeded initially for the vertical-slice domains only (not all five at full depth) to avoid over-building before Phase 5 proves the pattern.
- Phase: 4. Owner: Curriculum + engineering. Acceptance: an author can trace one Phase-1 game's content item back to a skill ID and forward to a standards mapping.

**T5 — Most future content producible through engine configuration, not new code** (§3, §9)
- Evidence: today, each of the 6 games is presumably its own bespoke JS implementation (not independently verified line-by-line in this pass — flagged as a Phase 0 follow-up, see `PHASE_0_HANDOFF.md`).
- Status: **RESEARCH-DEPENDENT** — the traceability matrix cannot confirm this without reading each of the 6 games' actual client-side code, which this pass did not do exhaustively.
- Disposition: before committing to the Engine SDK approach in Phase 3, read all 6 existing game implementations to assess how cleanly they map onto the proposed 14-engine catalog (§9.3) — this determines whether legacy migration in §14.5 is a thin wrapper or a rewrite.
- Phase: 0 (follow-up)/3. Owner: Engineering lead. Acceptance: a short spike memo naming which engine each existing game maps to, before Phase 3 begins.

## B. Non-negotiable principles (§5)

**T6 — Asset-based language / no deficit labeling; psychological safety; no manipulative gamification** (§5.1–5.5)
- Evidence: current 44-badge catalog already uses asset-based, non-comparative language ("Perfect Recall," "Steady Hands," "Consistency Counts" — no "Fastest"/"Best of Class" language found). No public leaderboard exists today (confirmed: `brain-games.html` shows only "Personal Bests," no cross-student ranking UI).
- Status: **ALIGNED** for the existing 6-game system's badge design; **RESEARCH-DEPENDENT** for whether current in-game feedback (correct/incorrect state presentation, timing pressure in Reaction Time/Stroop Challenge) meets §5.4's "never shame" and §5.5's "speed should not dominate scoring unless automaticity is the explicit objective" bar — not independently verified this pass.
- Disposition: content/UX review of the 6 existing games' actual in-play feedback states before they're "preserved and evolved" per §14.5, not just before new games ship.
- Phase: 7/8 (legacy migration). Owner: SEL/developmental reviewer. Acceptance: rubric in §8 of the verification report applied to each legacy game, not just the 12 new ones.

**T7 — Evidence discipline: no unvalidated diagnostic/clinical/assessment claims** (§5.6)
- Evidence: `research.html` and `how-it-works.html` (fetched live) already state explicitly: *"The Issues-to-Answers framework... has not been submitted for external validation or CASEL endorsement"* and *"FNE does not currently have published outcome studies measuring changes in student SEL competency or academic achievement."*
- Status: **ALIGNED** — this posture already exists in production copy and predates the blueprint. It is the single strongest piece of evidence that FNE's existing content-claims discipline already matches §5.6's bar.
- Disposition: carry the exact same disclaimer pattern onto any new Tune Your Brain marketing/research copy; do not weaken it under product-marketing pressure to make the expanded catalog sound more validated than it is.
- Phase: ongoing. Owner: Marketing/content lead. Acceptance: any new public page claiming SEL/academic benefit links to the same disclaimer language.

## C. Instructional/SEL design (§6)

**T8 — CASEL-aligned-not-certified framing for the SEL domain** (§6.4)
- Evidence: `research.html` (fetched live): *"This competency mapping represents FNE's thematic alignment to CASEL's framework, not a formal review, endorsement, or certification by CASEL."*
- Status: **ALIGNED** — production already uses almost verbatim the posture the blueprint asks for.
- Disposition: reuse this exact sentence pattern for any new SEL game's own claims; no new legal/policy language needed, just consistent application.
- Phase: 4 (content governance rubric). Owner: Curriculum lead. Acceptance: rubric checklist includes "does this claim match research.html's existing disclaimer pattern."

**T9 — Issues-to-Answers 5-step gameplay cycle reused faithfully in the Branching Scenario engine** (§6.6)
- Evidence: `how-it-works.html` (fetched live) confirms the exact 5 step names match the blueprint's §6.6 verbatim: Recognize the Issue → Understand the Impact → Consider Possible Answers → Choose a Responsible Response → Reflect and Reinforce.
- Status: **ALIGNED**. Disposition: the Branching Scenario engine (Choice Quest, Decision Point) must encode these exact 5 steps as structured content fields, not free-form scenario text, so game-form and lesson-form Issues-to-Answers stay recognizably the same framework.
- Phase: 3 (engine)/4 (content model). Owner: Curriculum + engineering. Acceptance: a Choice Quest content item's schema has 5 named fields matching these steps 1:1.

**T10 — Scenario-scoring rule (unsafe/plausible-incomplete/responsible/multiple-defensible/context-dependent/seek-help option types)** (§6.6)
- Evidence: no existing content model in this repo distinguishes option types at all — `curriculum_quiz_options` is plain correct/incorrect.
- Status: **MISSING**, net-new. Technical fit: M (a content schema extension, not a new engine). Curriculum/SEL fit: directly matches best practice for avoiding "SEL as trivia" (see REFERENCE_REGISTER §1/§5).
- Disposition: build as part of the Branching Scenario engine's content-pack contract in Phase 4, before any SEL content is authored — retrofitting option-type tagging onto already-authored scenarios is expensive.
- Phase: 4. Owner: Content/curriculum lead. Acceptance: one full Choice Quest scenario reviewed by a curriculum reviewer against this exact taxonomy.

## D. Visual/audio (§7)

**T11 — Preserve teal/coral serif-heading visual identity across all four bands** (§7.1)
- Evidence: `CLAUDE.md`'s documented palette (`--teal`, `--coral`, `--gold`, etc.) is confirmed still the live palette (no navy/amber remnants found repo-wide, per `CURRENT_STATE_ARCHITECTURE.md` §6).
- Status: **ALIGNED**, nothing to reconcile. Disposition: extend the existing CSS variables with band-specific tokens rather than introducing a second design-token system.
- Phase: 2. Owner: UX/design. Acceptance: four band prototypes all derive from the same root `:root` variables.

**T12 — Audio is instructional content (phonemes/letter-sounds professionally recorded, not browser TTS alone)** (§7.8)
- Evidence: `morning_boost_audio_clips` table + ElevenLabs `POST /generate-audio` pipeline exists and is real (`server/routes/morning-boost.js:300-350`), but `CLAUDE.md`'s env template still marks `ELEVENLABS_API_KEY` "not yet live."
- Status: **LEADERSHIP DECISION** — whether the ElevenLabs key is live today is a factual question that gates a real go/no-go on Discover-band audio content (Sound Safari, Word Builder), not a technical unknown.
- Disposition: confirm key status before Phase 4/7 content production planning assumes professional audio is available; if still not live, either activate it or defer literacy-audio content explicitly.
- Phase: 4 (before Wave A content production, Phase 7). Owner: Leadership (billing/vendor decision) + engineering (integration confirmation). Acceptance: a real test clip generated and played back from production.

## E. Accessibility (§8)

**T13 — WCAG 2.2 AA target across all new engines/content** (§8)
- Evidence: no shared accessibility utility module exists anywhere in the repo (`CURRENT_STATE_ARCHITECTURE.md` §6); the existing 6 games have not been independently accessibility-audited in this pass.
- Status: **MISSING** as a foundational capability (not "the 6 games are already accessible and new ones need to catch up" — there is no shared pattern for *either*).
- Disposition: this is a Phase 2/3 foundational dependency, not a per-game QA checklist item bolted on later — build the shared keyboard/focus/reduced-motion/non-drag/caption patterns once, in the shell and engine layer, before any Phase-1 catalog content is authored against it.
- Phase: 2/3. Owner: Accessibility reviewer + engineering. Acceptance: WCAG 2.2 AA success criteria (see REFERENCE_REGISTER §2) mapped to specific shell/engine components with a manual review pass, not automated-scan-only.

## F. Platform architecture (§9)

**T14 — 11 major service components (Experience Shells, Skill Graph, Engine SDK, Content Pack System, Assignment Service, Session/Evidence Service, Progression Service, Reward Service, Reporting Service, Content Administration, Audit/Reset Service)** (§9.2)
- Evidence: partial precedents exist for several — Reward Service (brain-games XP/badge logic, hard-FK'd to `site_users`), Audit Service (`school_audit_log`, generic actor/action/entity shape), Content Administration (none — no draft/review/publish workflow exists for curriculum today, `curricula.published` is a plain boolean, not a state machine).
- Status: **mixed — PARTIAL** for Reward/Audit, **MISSING** for Skill Graph/Content Pack/Content Administration/Progression Service, **DUPLICATIVE risk** for Assignment Service (must extend `classroom_assignments`/`classroom_game_assignments`, not create a third assignment table).
- Disposition: Phase 1's job is precisely to decide, component by component, "extend `X`" vs. "build new" — do not let Phase 1 default to building new tables for everything just because it's additive-migration-safe to do so.
- Phase: 1. Owner: Engineering lead. Acceptance: Phase 1 exit gate's own line — "no duplicate identity or progression system has been created" — checked against `school_audit_log`, `classroom_assignments`, and the brain-games reward tables specifically, by name.

**T15 — 14-engine reusable catalog (Audio Choice, Match, Sort, Sequence, Build, Manipulative, Pattern, Memory, Evidence Hunt, Branching Scenario, Strategy, Simulation, Guided Activity, Quest)** (§9.3)
- Evidence: unknown how cleanly the 6 existing games map onto these — see T5. Memory Match and Number Sequence plausibly map to "Memory" and "Pattern"/"Sequence"; Stroop Challenge and Reaction Time are closer to a "Manipulative"/timed-response mechanic not explicitly named in the 14; Quick Math likely maps to "Build" or a new lightweight arithmetic variant.
- Status: **RESEARCH-DEPENDENT**, same root cause as T5.
- Disposition: resolve alongside T5's spike before Phase 3 engine-count is locked; the blueprint's own Phase 3 scope (6 initial engines) should be chosen to include whichever engines the legacy-migration spike shows are needed first.
- Phase: 0 (follow-up)/3. Owner: Engineering lead. Acceptance: same spike memo as T5.

**T16 — Feature flags for internal/pilot/GA rollout** (§9.2 item, Phase 1 work item)
- Evidence: confirmed **no feature-flag framework exists anywhere** — only the `settings` key/value table and one-off boolean columns (`curricula.is_featured`).
- Status: **MISSING**, not PARTIAL — there's a pattern to extend, not a system to plug into.
- Disposition: build the smallest viable flag mechanism (a `feature_flags` table keyed by flag name + optional cohort/school scope, checked server-side) rather than trying to retrofit `settings`' flat key/value shape into cohort-scoped rollout — `settings` has no concept of "which schools" today.
- Phase: 1. Owner: Engineering lead. Acceptance: one real flag (e.g. `tune_your_brain_pilot_enabled`) gates a route server-side, confirmed via a request with and without the flag set.

**T17 — Classroom-PIN student linkage to progression/rewards, resolved without parallel profiles or weakened auth** (§9.2, §10.1, §14.5)
- Evidence: confirmed hard-FK-to-`site_users` schema constraint (see `CURRENT_STATE_ARCHITECTURE.md` §3) — this is the single most concrete, verified technical blocker found in this entire pass.
- Status: **CONFLICT** between current schema and the blueprint's own non-negotiable rule ("do not solve the PIN-student reward gap by weakening authentication, creating shadow profiles, or storing authority in the browser," §10.1).
- **Both sides of the conflict:** the safe fix is a real additive migration (nullable `student_id` column alongside the existing `user_id` on every brain-games table, mirroring the exact pattern already used for `parent_classroom_links.student_id` per project history) — but MySQL cannot FK one column to two different parent tables, so every reward-write code path must branch on which identity type is present, and every reporting query must UNION or coalesce across both. This is real, non-trivial work, not a one-line fix.
- Disposition: resolve in Phase 1 as the concrete first schema work package — this is explicitly named in the assignment as something expensive to retrofit later, so it should not be deferred to Phase 6 just because rewards/reporting are officially scoped there.
- Phase: 1. Owner: Engineering lead. Acceptance: a `classroom_students.id` can earn a real badge end-to-end in a test, without touching `site_users` at all.

**T18 — Normalized learning-event model, PII-minimized** (§9.8)
- Evidence: `analytics_sessions`/`analytics_events` exist but are deliberately anonymous/pre-login/funnel-scoped (`server/routes/analytics.js:15-17` comment) — structurally unsuited to authenticated, scored, per-student event data.
- Status: **MISSING** — needs a new table, not a repurposed one.
- Disposition: build new `learning_events` (or similarly named) tables scoped by tenant/user-or-student/session/skill/content-version, explicitly NOT reusing `analytics_events`. Confirm early with leadership what retention window applies (this event volume will be far higher than anything currently logged).
- Phase: 1. Owner: Engineering + privacy reviewer. Acceptance: event write path confirmed to never receive free-text reflection content (that stays in `student_reflections`, gated by the content-safety gateway).

## G. Identity/tenancy/privacy/safety (§10)

**T19 — School-admin aggregate-only visibility into Tune Your Brain (no individual student detail beyond current policy)** (§10.2)
- Evidence: `requireSchoolAdmin`'s existing scope is licensing/roster administration, not student-performance reporting — no precedent exists today for a school-admin-facing *student learning* dashboard of any kind (Brain Games or curriculum).
- Status: **MISSING**, net-new reporting surface, but with a clear, already-established access-control pattern to reuse (`requireSchoolAdmin` + per-purchase scoping).
- Disposition: build the aggregate-only admin view as new read endpoints under `requireSchoolAdmin`, explicitly excluding any query shape that could return single-student rows.
- Phase: 6. Owner: Engineering + privacy reviewer. Acceptance: a negative test confirms the admin aggregate endpoint cannot be parameterized down to n=1.

**T20 — Content-safety-gateway reuse for any new free-text (reflections, SEL branching-choice rationale text)** (§10.6)
- Evidence: `server/lib/safety/gateway.js` confirmed real and already wired into 3 route files.
- Status: **ALIGNED / DUPLICATIVE-RISK** — the capability exists; the risk is a future session building a second, parallel text-screening path instead of calling this one.
- Disposition: any new game with open text must import and call `screenContent()` directly — flag in code review if a new route hand-rolls its own profanity/safety check instead.
- Phase: whenever any open-text mechanic ships (Choice Quest reflections, Phase 7+). Owner: Engineering lead / code reviewer. Acceptance: grep for a second safety-screening implementation before merging any open-text feature.

## H. Adaptive learning (§11)

**T21 — Conservative, bounded, teacher-overridable adaptivity with explainable, reversible logging** (§11)
- Evidence: no adaptive-difficulty mechanism exists anywhere in the current platform (curriculum trial limits and license gating are access controls, not learning adaptivity).
- Status: **MISSING**, entirely net-new. Technical fit: M — the rules themselves (§11.1–11.4) are conservative by design and don't require ML, just a rules engine over recent-attempt evidence.
- Disposition: build after the Session/Evidence Service (Phase 1) and only for the vertical-slice content (Phase 5) — do not build a generic adaptivity engine before there's real attempt data to test it against.
- Phase: 5/6. Owner: Curriculum + engineering. Acceptance: a teacher can see and reverse one adaptive decision in the pilot slice.

## I. Rewards (§12)

**T22 — No public individual leaderboards; cooperative classroom milestones instead** (§12.4)
- Evidence: confirmed no leaderboard UI exists today; a `leaderboard_eligible` column exists on some legacy table per project history but is written and never read (pre-existing dead column, not a live leaderboard).
- Status: **ALIGNED** by omission — there's nothing to remove, and no precedent that would need to be un-built.
- Disposition: when building cooperative classroom milestones (§12.4), do not resurrect the dormant `leaderboard_eligible` column as a shortcut — it was never wired to real logic and its original intent is undocumented.
- Phase: 6. Owner: Engineering lead. Acceptance: grep confirms cooperative-milestone logic doesn't reference `leaderboard_eligible`.

**T23 — Server-authoritative, idempotent reward writes, compatible with classroom-PIN students** (§12.5)
- Evidence: current brain-games reward writes are server-side already (`awardBadges()` runs server-side against session-completion data) — good precedent for "server decides, client doesn't" — but PIN-student compatibility is blocked by T17's schema constraint.
- Status: **PARTIAL** — the authority model is already correct; the identity-linkage is the open blocker (see T17).
- Disposition: resolve T17 first; this requirement falls out of that fix rather than needing separate design.
- Phase: 1 (T17) then 6 (full reward-service completion). Owner: Engineering lead.

## J. Phase 1 catalog & SEL/developmental rubric (§14)

**T24 — 12 new flagship experiences + 6 legacy migrations, all four bands, all five domains represented** (§14.1–14.5)
- Evidence: none of the 12 new experiences exist in any form today; the 6 legacy games exist and are live but have not been individually rubric-reviewed in this pass (see T6).
- Status: **MISSING** (12 new) / **PARTIAL** (6 legacy, live but unreviewed against the §8/§16 rubric).
- Disposition: sequencing per blueprint §15 is sound (Phase 5 vertical slice before Phase 7/8 full catalog) — no change recommended to the wave structure itself.
- Phase: 5 (slice) → 7 → 8. Owner: Curriculum + engineering + design.

A full per-game instructional/SEL rubric pass (learning objective, developmental appropriateness, evidence-of-independent-vs-supported-response, accessibility alternative, natural stopping point, etc., per §8/§16 of the assignment) for all 18 catalog experiences is intentionally not duplicated row-by-row here — see `BLUEPRINT_VERIFICATION_REPORT.md` §"Curriculum/SEL findings" for the rubric results, since applying it meaningfully to games that don't exist yet (the 12 new ones) can only assess the *written design*, not built behavior; the 6 legacy games' rubric pass is flagged in T6 as still outstanding pending direct code/gameplay review.

---

## Summary counts

| Status | Count | Notable items |
|---|---:|---|
| ALIGNED | 7 | T1, T7, T8, T9, T11, T20 (capability side), T22 |
| PARTIAL | 5 | T3, T14 (mixed), T21 (n/a — actually MISSING, see below), T23, T24 (legacy half) |
| MISSING | 9 | T2, T4, T10, T13, T14 (skill graph/content admin), T15 (pending spike), T16, T18, T19, T21, T24 (new half) |
| CONFLICT | 1 | T17 |
| RESEARCH-DEPENDENT | 2 | T5, T15 |
| LEADERSHIP DECISION | 1 | T12 |
| DUPLICATIVE-RISK (flagged, not itself a blocker) | 2 | T14 (assignment service), T20 |

*(Some items carry a secondary tag beyond their primary status — see individual rows; this table counts primary status only and will not sum cleanly to 24, by design.)*
