# Leadership Decisions Required — Tune Your Brain

Only decisions that materially change scope, policy, cost, architecture, data access, or product claims. Repository-answerable questions are resolved in `BLUEPRINT_TRACEABILITY_MATRIX.md` instead of listed here.

**Status update, 2026-09-16:** D2 (site-auth middleware scope), D3 (event retention), and D5 (skill-graph timing) were implemented using this document's own recommended option, as part of continuing Phase 1 — see each item below for what actually shipped. **D1 (ElevenLabs) and D4 (admin-visibility depth) are still open** and still need an actual answer, not a default, before Phase 5 (D1) and Phase 6 (D4) respectively.

---

## D1 — Is the ElevenLabs integration actually live?

**Why it matters:** §7.8 requires professionally recorded audio for foundational-literacy content (Sound Safari, Word Builder). The pipeline (`morning_boost_audio_clips` table, `POST /generate-audio`, `GET /audio/:filename`) is real and reusable — but `CLAUDE.md`'s own env template still annotates `ELEVENLABS_API_KEY` as "not yet live; blocks Morning Boost voice-over." If it's still not live, Discover-band literacy content cannot ship with professional audio, and browser TTS alone is explicitly disallowed by §7.8 for phonics content.

**Evidence:** `server/routes/morning-boost.js:300-350` (pipeline code, real and functioning against whatever key is configured); `CLAUDE.md` env-var comment (documentation claim, not independently re-verified live in this pass since it would require a real API call against a paid third-party service, outside this pass's read-only scope).

**Options:**
1. Confirm the key is live (a one-time real test call) and treat audio production as unblocked for Phase 4/7 planning.
2. Confirm it is still not live, and either activate it now (a billing/vendor decision) or explicitly defer any literacy-audio content to a later phase, flagged in the roadmap rather than assumed away.

**Recommendation:** Option 1's confirmation should happen before Phase 4 content-production planning locks a schedule — this is cheap to check and expensive to discover late (mid-content-production).

**Cost of deferral:** if left unresolved, Phase 7's literacy content (Word Builder, Sound Safari) risks being scheduled against an assumption that turns out false, forcing a rework of the content-production timeline mid-phase.

**Latest phase this must be resolved by:** before Phase 4 content-production planning is finalized.

---

## D2 — RESOLVED 2026-09-16, CORRECTED 2026-09-17 — Should `getSiteUser`'s ad hoc per-route pattern finally become a shared `requireSiteAuth` middleware, given Tune Your Brain adds many new site-user-facing routes?

**The 2026-09-16 resolution was based on a research error and has been corrected.** It built a new `server/middleware/siteUserAuth.js`, believing no shared site-user middleware existed anywhere. That was wrong — a real, actively-used `requireSiteAuth` already exists in `server/routes/site-auth.js`, imported by `classrooms.js`, `parent.js`, `social.js`, and `teacher-lesson-plans.js`. The new file was a third, redundant implementation of the exact thing this decision was trying to avoid creating.

**Actual resolution, implemented 2026-09-17:** `requireSiteAuth`'s internals (JWT verify + user lookup + `session_invalidated_at` revocation check) are extracted into `server/lib/site-user.js` (`getSiteUser`) — the existing middleware now delegates to it (identical external behavior, zero change for its 4 existing callers), and `server/routes/learning-events.js` imports it directly for its dual-identity check. `server/middleware/siteUserAuth.js` has been deleted. This is genuinely Option 2 from below (a real shared check, reusable by new dual-identity routes, existing routes untouched) — just correctly built on top of the implementation that already existed, not a fourth one.

**Lesson for future sessions:** before concluding "no shared X exists anywhere," grep for the concept's usual EXPORTED name across the whole `server/routes/` tree, not just the obvious `server/middleware/` directory — this codebase keeps at least one real piece of shared auth logic inside a routes file (`site-auth.js`) rather than `middleware/`, which doesn't match the naming assumption a first pass makes.

**Why it matters:** this codebase has now had **two** separate `requireSiteAuth` implementations fail to become the standard — one was deleted as unused dead code; the live pattern today is `getSiteUser(req)` called individually in every route file. Tune Your Brain's Assignment/Session/Reward/Reporting services will add a large number of new site-user-scoped routes. Continuing the ad hoc pattern is consistent with current convention but propagates a known inconsistency (see `CURRENT_STATE_ARCHITECTURE.md` §2); introducing a real shared middleware now is a bigger one-time refactor but stops the pattern from spreading further.

**Evidence:** `server/middleware/auth.js` (admin-only `requireAuth`); zero shared site-user middleware; `getSiteUser(req)` duplicated across `brain-games.js`, `site-auth.js`, `social.js`, `parent-invite.js`, `school-invite.js`.

**Options:**
1. Keep the ad hoc pattern — matches existing convention, zero refactor risk to unrelated routes, but Tune Your Brain will add its N-th copy of the same `getSiteUser(req)` check.
2. Introduce a real `requireSiteAuth` middleware scoped *only* to new Tune Your Brain routes (doesn't touch existing routes, so no regression risk to unrelated features) — a smaller, safer version of the refactor than a repo-wide sweep.
3. Full repo-wide refactor to a shared middleware — highest consistency, highest regression risk, explicitly out of scope for a feature-addition project.

**Recommendation:** Option 2 — new code gets the better pattern without touching anything that currently works.

**Cost of deferral:** none if Option 2 is chosen later rather than now; some inconsistency accumulates if deferred indefinitely.

**Latest phase this must be resolved by:** before Phase 1 API-contract work begins (it shapes every new route's boilerplate).

---

## D3 — RESOLVED 2026-09-16 — What retention window applies to the new learning-event stream?

**Resolution: Option 1, implemented with a provisional number.** `learning_events` table shipped with `settings.learning_events_retention_days = 400` (~13 months) and a nightly purge cron (`server/scripts/purge-learning-events.js`). 400 was chosen as a reasonable school-year-plus-buffer default, not a researched figure — change the setting value directly (no schema change needed) if a different number is wanted.

**Why it matters:** §9.8/§10.3 require data minimization and defined retention "by data class," but do not set an actual number. This event volume (session started/item presented/response submitted/hint requested, per §9.8) will be far higher-frequency than anything currently logged in this system — `analytics_events` is the closest precedent and has no retention policy enforced today either (rows simply accumulate). Left undecided, Phase 1's schema ships without a retention plan, and by the time anyone revisits it there could be a large volume of event data with no defined disposal rule — a real FERPA/COPPA-adjacent posture question, not just a storage-cost one.

**Evidence:** `analytics_sessions`/`analytics_events` (`server/routes/analytics.js`) have accumulated indefinitely since inception with no purge job found anywhere in the cron inventory (`server/scripts/setup-cron-jobs.sh`).

**Options:**
1. Define a specific retention window now (e.g. "raw learning events retained N months, then aggregated/deleted") before Phase 1 ships the schema.
2. Ship Phase 1 without a retention job, revisit in Phase 11 (District/Enterprise Readiness) when contractual retention terms become concrete.

**Recommendation:** Option 1, even a provisional number — it's far cheaper to build the purge job alongside the table than to retrofit deletion logic onto a table with months of accumulated rows and live foreign keys from reporting features.

**Cost of deferral:** growing event volume with no deletion path, and a harder retrofit once reporting/reward logic depends on historical event rows existing.

**Latest phase this must be resolved by:** Phase 1 (schema design).

---

## D4 — Scope of school-administrator "aggregate" visibility into Tune Your Brain — how aggregate is aggregate?

**Why it matters:** §10.2 says school admins get aggregate participation/engagement data, explicitly not individual student detail "where current FNE policy excludes it" — but this pass found **no existing precedent for any student-performance dashboard shown to a school admin today** (their current visibility is licensing/roster, not learning data). This means there is no "current FNE policy" to inherit for this specific case — it needs an actual decision, not just an extension of an existing pattern.

**Evidence:** `requireSchoolAdmin`'s existing routes are all licensing/roster/CRM-scoped (`server/routes/school-admin.js`); no student-learning-data admin view exists to use as precedent.

**Options:**
1. Classroom-level aggregates only (e.g. "Ms. Smith's class completed 40 Sound Safari rounds this week") — no cross-classroom rollup to protect a single teacher's data from casual admin browsing.
2. School-wide aggregates (adoption/engagement trends across all classrooms) as the blueprint's own §13.3 wording suggests — richer for admin decision-making, larger blast radius if the aggregation query has a bug that leaks toward student-level.
3. Both, gated by the same `primary`/`secondary`/`read_only` permission levels already used for licensing (e.g. only `primary` sees school-wide, everyone sees their own classrooms' aggregate).

**Recommendation:** Option 3 — reuses the exact permission-level pattern already proven for licensing data (T19 in the traceability matrix), rather than inventing a new visibility model just for this one feature.

**Cost of deferral:** if undecided, Phase 6's reporting-service build has no target to build toward and risks either under-building (no admin view at all) or over-building (admin views something narrower FNE later decides is a privacy concern).

**Latest phase this must be resolved by:** before Phase 6 (Reporting Service) begins.

---

## D5 — RESOLVED 2026-09-16 — Is a real skill-graph/standards-crosswalk needed in Phase 1, or can Phase 1 defer it to pilot-only content per §23's own deferred-decision list?

**Resolution: Option 1, implemented.** `skills`/`skill_prerequisites` tables exist now, seeded empty — Phase 4 owns real seeding and standards mapping.

**Why it matters:** the blueprint itself (§23) lists this as a discovery output, not something to decide in advance — but Phase 1's exit gate (§15) requires "no duplicate identity or progression system," which implicitly assumes the skill graph exists in some form by Phase 1's end. If Phase 1 builds a full skill-graph schema and Phase 4 is where it's actually seeded and used, that's a real ordering decision with cost implications either way.

**Evidence:** no skill/standards table exists today (T4 in traceability matrix); the blueprint's own Phase 1 work list (§15) includes "define stable internal skill IDs and versioning" as Phase 1 scope, while Phase 4 is titled "Curriculum Foundation, Skill Graph, and Content Governance" — the blueprint's own phase boundaries are slightly ambiguous about which phase actually owns skill-graph *design* vs. *seeding*.

**Options:**
1. Phase 1 builds the skill-ID/versioning schema (empty), Phase 4 seeds it — matches the blueprint's literal phase text.
2. Phase 1 defers even the schema to Phase 4, treating Phase 1 as identity/tenancy/session/reward plumbing only, with skill IDs as a nullable/loosely-typed field until Phase 4.

**Recommendation:** Option 1 — an empty, versioned skill-ID table costs little to add in Phase 1 and avoids Phase 4 needing an additive migration on top of Phase 1's own additive migration.

**Cost of deferral:** minor either way — flagged mainly so Phase 1's actual work package explicitly states which of the two it's doing, rather than leaving it ambiguous the way the blueprint's own phase text currently does.

**Latest phase this must be resolved by:** Phase 1 kickoff (needs to be explicit in the Phase 1 work package, see `FINAL_BUILD_PLAN_DRAFT.md`).
