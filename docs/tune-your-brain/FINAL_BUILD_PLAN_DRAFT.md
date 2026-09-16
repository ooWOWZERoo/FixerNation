# Final Build Plan Draft — Tune Your Brain

This is the corrected, evidence-backed build plan. It keeps the blueprint's own phase numbering and intent (`MASTER_PLAN.md` §15) where verification confirmed it's sound, and calls out every place verification changed the plan. See `BLUEPRINT_TRACEABILITY_MATRIX.md` for the requirement-level evidence behind each change, and `LEADERSHIP_DECISIONS_REQUIRED.md` for D1–D5, referenced by ID below.

## Verified end state

Unchanged from the blueprint's own §3/§25 vision: an 18-experience (12 new + 6 evolved), 4-band, 5-domain learning-through-games platform, built on reusable engines and governed content, with classroom-PIN students earning real progress/rewards for the first time. Verification found nothing that challenges this destination — only how to get there safely, and in what order.

## Architecture decisions (corrected from blueprint defaults)

1. **T17 (PIN-student schema fix) moves from "Phase 6 reward-service work" to the concrete first Phase 1 deliverable.** It's an additive migration (nullable `student_id` beside every brain-games table's existing `user_id`) plus a code-path branch everywhere those tables are read or written. This is exactly the kind of thing the assignment's own quality bar calls "expensive to retrofit" — doing it first, before any new game or engine touches these tables, avoids two migrations instead of one.
2. **T16 (feature flags): build the smallest real mechanism, not a generic system.** A `feature_flags` table keyed by flag name + optional school/cohort scope, checked server-side per request. Rejected alternative: stretching the existing `settings` key/value table to carry cohort scope — it has no concept of "which schools" today and forcing that in would make `settings` harder to reason about for its existing, unrelated uses (contact routing, invoice branding).
3. **T18 (event model): new tables, not `analytics_events`.** `analytics_sessions`/`analytics_events` stay exactly as they are (anonymous, pre-login, funnel-scoped) — a new `learning_events`-family schema is built fresh, scoped by tenant/identity-type/session/skill/content-version, with D3's retention window decided at the same time it's created.
4. **T14 (component reuse decisions):** Reward Service extends the existing brain-games XP/badge tables (post-T17 fix) rather than a new reward table; Audit Service extends `school_audit_log`'s existing actor/action/entity shape rather than a parallel audit table; Assignment Service extends `classroom_assignments`/`classroom_game_assignments` rather than a third assignment table; Content Administration, Skill Graph, and Progression Service are genuinely new — no existing table to extend.
5. **D2 (site-user auth):** new Tune Your Brain routes get a real `requireSiteAuth` middleware, scoped only to new routes — existing routes keep their current `getSiteUser(req)` pattern untouched, so this is additive, not a refactor of working code.
6. **T5/T15 (engine-mapping spike):** before Phase 3's engine count is locked, a short spike (see Phase 0 follow-up below) reads all 6 existing games' actual client-side implementations to confirm which of the 14 proposed engines they map onto. This determines Phase 3's actual initial-engine list, which may differ from the blueprint's own suggested six (Audio Choice, Build, Manipulative, Evidence Hunt, Branching Scenario, Simulation) if the legacy games don't cleanly need all of those first.

## Revised phases and work packages

**Phase 0 — Repository Forensics and Baseline: substantially complete via this verification pass.** Remaining Phase 0 follow-up before Phase 1 begins:
- The T5/T15 engine-mapping spike (read all 6 existing game client implementations).
- D1's one-time real ElevenLabs API confirmation.
- A rubric pass on the 6 legacy games' actual in-play feedback/timing behavior (T6), not just their badge copy.

**Phase 1 — Architectural Foundation and Data Contracts.** Concrete first work package (see below) is T17's schema fix. Also in scope per architecture decisions above: `feature_flags` table (T16), `learning_events` schema + retention job (T18, D3), skill-ID/versioning table seeded empty per D5 Option 1, and the scoped `requireSiteAuth` middleware (D2). Exit gate unchanged from blueprint (§15): migrations apply/roll back safely in a test copy; tenant isolation and permission tests pass; a `classroom_students.id` can hold real progress/rewards; no duplicate identity/progression system created (verified explicitly against `school_audit_log`, `classroom_assignments`, and the brain-games reward tables by name, per T14).

**Phase 2 — Shared Design System and Four Experience Shells.** Unchanged in intent from blueprint. **Added scope, not in the blueprint's original Phase 2 list:** the shared accessibility utility module (T13) — reduced-motion, keyboard/focus, non-drag, caption/transcript patterns — must be built here, in the shell layer, because verification found **no existing accessibility utility anywhere in the codebase** to extend. This is a real addition to Phase 2's workload, not a detail deferred to QA.

**Phase 3 — Game Engine SDK and Normalized Session Runtime.** Initial engine list to be finalized by the Phase 0 spike (T5/T15) rather than assumed as the blueprint's suggested six. Everything else (lifecycle contract, engine registry, save/resume, idempotent rewards) unchanged.

**Phase 4 — Curriculum Foundation, Skill Graph, and Content Governance.** Unchanged, except: skill-ID table already exists empty from Phase 1 (D5) — Phase 4's job is seeding and the review/publish workflow, not table design. Content Administration (T14) is fully net-new here, no existing draft/review/publish precedent to extend (`curricula.published` today is a plain boolean, not a state machine).

**Phase 5 — Vertical Slice Pilot.** Unchanged (Sound Safari / Reading Detective / Decision Point / Money Matters). **Gate added:** D1 (ElevenLabs) must be resolved before this phase's content production starts, since Sound Safari is audio-dependent.

**Phase 6 — Assignments, Progression, Goals, Rewards, and Reporting.** Unchanged in scope, but D4 (how aggregate is "aggregate" for school admins) must be decided before this phase's reporting-service work begins, and T23 (server-authoritative PIN-compatible rewards) falls out of Phase 1's T17 fix rather than needing separate design here.

**Phase 7/8 — Phase 1 Catalog, Waves A & B.** Unchanged sequencing. Legacy migration work (Memory Lab, Reaction Challenge, Sequence Lab, Focus Lab, Pattern Lab, Math) includes the T6 feedback/timing rubric pass and the T17-dependent PIN-reward backfill for existing play history, not just new-skin work.

**Phase 9–13.** Unchanged from blueprint — verification found nothing in these later phases that current repository facts would contradict; they're appropriately scoped as "after the platform proves stable," which none of this pass's findings challenge.

## Dependencies and critical path

```text
Phase 0 spike (engine mapping, ElevenLabs check)
        ↓
Phase 1 (T17 schema fix → feature flags → learning_events → skill-ID table → requireSiteAuth)
        ↓
Phase 2 (shells + accessibility utility, NEW scope) ──┐
        ↓                                              │
Phase 3 (engine SDK, informed by Phase 0 spike)         │
        ↓                                              │
Phase 4 (skill graph seeding + content governance) ←────┘
        ↓
Phase 5 (vertical slice — gated on D1 for Sound Safari)
        ↓
Phase 6 (reporting — gated on D4) ── Phase 7/8 (catalog waves, gated on T6 legacy rubric)
        ↓
Phase 9–13 (unchanged)
```

The critical path runs through Phase 1's T17 fix — nothing downstream (rewards, reporting, PIN parity in any new game) can be built correctly until that migration exists, which is exactly why it's promoted to Phase 1's first concrete deliverable rather than left in Phase 6.

## Test plan and phase gates

Per-phase gates are unchanged from blueprint §15 with one addition: **Phase 1's exit gate gets an explicit PIN-parity acceptance test** — "a `classroom_students.id` earns a real badge end-to-end with zero `site_users` involvement" — as a named, checkable test, not just the blueprint's more general "PIN students can be represented correctly" language.

Automated layers (§17.1) and required end-to-end personas (§17.2) are adopted as-is — this repo already has a 59-spec Playwright suite and an established QA-fixture pattern (`seed-qa-test-accounts.js`) that the new personas (Discover/Explore/Challenge/Advance PIN students, multi-classroom teacher, School Safety Admin) can extend directly, following the same fixture-per-role convention already in use.

**No CI exists today** (confirmed absent) — the blueprint's own §4/known-context item ("Playwright coverage... historically required manual execution") is confirmed still true. This build plan does not propose adding CI as an in-scope Tune Your Brain deliverable (out of scope per the assignment's own boundaries), but flags it in the risk register as a real ongoing exposure given how much new test surface this project adds.

## Feature-flag and release strategy

Per architecture decision 2: a new `feature_flags` table (Phase 1), checked server-side. Recommended flags: `tune_your_brain_pilot_enabled` (school/cohort-scoped, gates the entire new experience-band UI), and per-experience flags for each of the 12 new flagship games so Wave A/B content can go live incrementally without a deploy per game.

## Curriculum/content production plan

Sequenced per blueprint Phases 4/7/8/9/10, with D1 (audio) and T10 (scenario-scoring taxonomy) resolved before Phase 4 content authoring starts, and the T6 legacy-game rubric pass completed before Phase 7/8 migration work is called done (not just before new-game content ships).

## Accessibility plan

Built at the shell/engine level in Phase 2/3 (T13), not deferred to per-game QA — this is the single most consequential correction this verification pass makes to the blueprint's implicit sequencing, since §8's requirements apply to literally every one of the 18 catalog experiences and there is currently zero shared infrastructure to build them on.

## Security/privacy plan

- Reuse `server/lib/safety/gateway.js` for any open-text mechanic (T20) — do not build a second screening path.
- New `learning_events` schema explicitly excludes free-text reflection content (T18); reflections stay in the existing `student_reflections` table, already gated by the safety pipeline.
- D3's retention window decided at table-creation time, not retrofitted.
- Any new site-user route follows D2's scoped `requireSiteAuth` middleware.
- OWASP ASVS/Top 10/API Security Top 10 controls (see `REFERENCE_REGISTER.md`) apply to every new API surface added in Phase 1 onward — highest-risk areas per this pass's findings: the new reward-write endpoints (forgery/idempotency risk, mitigated by server-authoritative design already planned) and the new PIN-student-compatible endpoints (tenant-isolation risk, given PIN students have historically been a separate, less-audited identity path).

## Pilot and evidence plan

Unchanged from blueprint §12 (Evidence, Validation, and Continuous Improvement) — usability and content-validity review before any outcome claims, matching the evidence-discipline posture already live in `research.html`/`how-it-works.html` (T7, T8).

## Operational/support plan

**Gap identified, not previously flagged by the blueprint:** no error-monitoring service and no backup/rollback documentation exist anywhere in this repository today. This predates Tune Your Brain and is not this project's responsibility to fully solve, but the new cron job(s) this project will likely add (e.g. a nightly badge-criteria sweep or event-retention purge per D3) should log to the same `~/logs/*.log` convention already used by the 6 existing cron jobs, so at least manual troubleshooting stays consistent with current practice.

## Complexity and risk by phase

| Phase | Complexity | Confidence | Primary risk |
|---|---|---|---|
| 0 (follow-up spike) | S | high | Engine-mapping spike reveals legacy games need engines outside the proposed 14 |
| 1 | L | medium | T17 migration touches every brain-games table; must not lose existing site-user progress |
| 2 | L | medium | Accessibility utility is genuinely new work, easy to under-scope | 
| 3 | M | medium | Engine count depends on Phase 0 spike outcome |
| 4 | L | medium | Content-governance workflow is fully new; no existing draft/review/publish precedent |
| 5 | M | medium | Gated on D1; audio content quality risk if ElevenLabs isn't actually live |
| 6 | M | medium | D4 must be resolved or reporting scope drifts mid-build |
| 7/8 | XL | medium | 12 new + 6 migrated experiences is genuinely large content-production work |
| 9–13 | XL | low (appropriately, this far out) | Unchanged from blueprint's own framing — correctly sequenced after stability is proven |

Effort is intentionally given as complexity/confidence, not calendar estimates — this repo has no historical velocity data for content-production or curriculum-review work to calibrate dates against, and false-precision schedules would misrepresent that.

## Definition of done

Adopted as-is from blueprint §16, with T13 (accessibility) and T17 (PIN parity) call-outs added as explicit, named acceptance checks rather than folded into the general "accessibility" and "data/privacy/security" bullet lists.

## Recommended first implementation work package

**Phase 1, Work Package 1: PIN-student reward-linkage migration.**

- Add nullable `student_id` columns (FK to `classroom_students.id`) alongside the existing `user_id` on `brain_game_sessions`, `brain_game_user_progress`, `user_brain_badges`, `brain_user_streaks`, `brain_game_privacy` — mirroring the exact pattern already used for `parent_classroom_links.student_id` per this project's own prior history.
- Add a `requireEitherAuth`-style helper (or extend `getSiteUser`'s call sites) so the 12 brain-games endpoints accept either `fn_user_session` or `fn_student_session`, writing to whichever identity column is populated.
- Update `awardBadges()`/`evaluateBadgeCriteria()` to branch on identity type where a query currently assumes `user_id`.
- New regression test: a classroom-PIN student session completes a Memory Match round and receives a real, persisted badge — zero `site_users` involvement.
- Also add `server/db/schema.sql` entries for all brain-games tables while touching this area — they were never added despite this repo's own "always update schema.sql" convention, and this work package touches every one of them anyway.

This is small enough to implement and verify in one session, and structurally representative of the rest of the build (an additive migration + a dual-identity code path + a real end-to-end regression test) — exactly the profile the assignment's own quality bar asks for.
