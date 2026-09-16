# Blueprint Verification Report — Tune Your Brain

## Executive conclusion

The blueprint (`MASTER_PLAN.md`) is **fundamentally sound and buildable** on top of this codebase. Its non-negotiable principles, phase sequencing, and evidence-discipline posture already match how this specific product actually talks about itself in production — that's a real, positive signal, not a coincidence to be assumed. The one genuine architectural conflict found (classroom-PIN students cannot earn brain-games rewards under the *current* database schema — a hard foreign-key constraint, not just a missing auth check) is exactly the kind of thing the blueprint itself says should be resolved in Phase 1, not deferred. Recommendation: **go**, with the corrections below folded into Phase 0/1 rather than treated as blockers.

## Verification scope and limitations

This pass verified: full read of the 1,812-line blueprint; two Explore-agent passes over the repository (architecture/permissions/Brain-Games/PIN-student code, and docs/testing/deployment conventions); direct repository reads of migration scripts, middleware, and route files; live, read-only production checks (public-page crawl of `fixernationeducation.com` and `fixernation.org`; authenticated curl checks using this project's own existing `@example.com` QA fixtures, comparing a licensed-teacher session against a classroom-PIN-student session against the same brain-games endpoints); and a full external-reference pass (26 sources — see `REFERENCE_REGISTER.md`).

**Not done in this pass, flagged rather than silently skipped:** a line-by-line read of the 6 existing games' client-side JS (needed before Phase 3's engine list is finalized — see T5/T15 in the traceability matrix and the Phase 0 follow-up in `FINAL_BUILD_PLAN_DRAFT.md`); a real live call confirming whether `ELEVENLABS_API_KEY` is actually active (D1); and school-admin permission-level (`primary`/`secondary`/`read_only`) live curl verification specifically for Tune Your Brain's future admin-reporting surface, since that surface doesn't exist yet to test against.

## Sources reviewed

- Primary: `FNE_TUNE_YOUR_BRAIN_MASTER_IMPLEMENTATION_ROADMAP.md` (in full, 1,812 lines).
- Repository: `CLAUDE.md`, `PROJECT.md`, `CHANGELOG.md`, `CONTENT_SAFETY_IMPLEMENTATION_PLAN.md`, `server/db/schema.sql`, `server/app.js`, `server/routes/brain-games.js`, `server/routes/student.js`, `server/routes/morning-boost.js`, `server/middleware/{auth,studentAuth,schoolAdminAuth,districtAdminAuth}.js`, `server/lib/{session,settings,safety/gateway}.js`, `server/scripts/{alter-brain-games,alter-classroom,alter-add-curriculum-featured,alter-add-student-quiz-drafts,setup-cron-jobs.sh}`, `tests/playwright.config.ts`, `tests/e2e/helpers/auth.ts`, `server/package.json`, `tests/package.json`.
- Live production: `fixernationeducation.com` (home, `/brain-games.html`, `/how-it-works.html`, `/research.html`, `/robots.txt`, `/sitemap.xml`), `fixernation.org` (home), plus authenticated `GET /api/brain-games/me/progress`, `/me/badges`, and `GET /api/student/games` via both a site-user and a classroom-PIN-student session.
- External: 26 sources across SEL, accessibility, privacy, curriculum standards, learning science, and security — full citations in `REFERENCE_REGISTER.md`.

## Verified current architecture and behavior

See `CURRENT_STATE_ARCHITECTURE.md` for the full write-up. Highlights most load-bearing for this verification:

- **"Tune Your Brain" is already the live production name** of the existing 6-game feature (`brain-games.html` H1, badge `cross-ultimate` named "Tune Your Brain Master"). The blueprint is evolving something real and already named, not launching a new brand.
- **The 6 games' real identity** doesn't match the blueprint's own shorthand exactly (`memory-match`, `reaction-time`, `simon-sequence`, `stroop-challenge`, `quick-math`, `number-sequence` vs. "Memory, Reaction, Sequences, Focus, Math, Patterns").
- **The classroom-PIN reward gap is a hard schema constraint**, confirmed live: a PIN-student session gets a clean `401 {"error":"Login required"}` from every brain-games endpoint, while an identical request with a site-user session returns full progress/badge data. Every brain-games table has a real `FOREIGN KEY ... REFERENCES site_users(id)` — there is structurally no way to record a `classroom_students.id`'s progress today.
- **`requireSiteAuth` does not exist**, contradicting this repo's own `CLAUDE.md`. It was deleted as unused dead code in a prior session; site-user auth today is ad hoc `getSiteUser(req)` per route.
- **No feature-flag framework, no shared accessibility utility, no error-monitoring service, no backup/rollback documentation** exist anywhere in this codebase. All four are real, verified absences — not undocumented-but-present capabilities.
- **No CI** — 59 Playwright specs run manually against production, matching the blueprint's own remembered fact.
- **No `-v2` files or navy/amber CSS remain** — the blueprint's "frozen redesign" risk has nothing left to protect.

## Blueprint alignment summary

Full item-by-item disposition is in `BLUEPRINT_TRACEABILITY_MATRIX.md`. Rollup: 7 items ALIGNED, 5 PARTIAL, 9 MISSING, 1 CONFLICT, 2 RESEARCH-DEPENDENT, 1 LEADERSHIP DECISION, 2 flagged DUPLICATIVE-risk. No item was found OBSOLETE in the sense of "actively wrong for this codebase" — the one candidate for obsolescence (the frozen-v2-revival risk) is better described as *already resolved*, since there is nothing left to revive.

## Material conflicts and resolutions

**The classroom-PIN reward-linkage conflict (T17)** is the only genuine architecture-vs-blueprint conflict found. Both sides: the blueprint's non-negotiable rule (§10.1) forbids solving this with weakened auth, shadow profiles, or browser-stored authority — correctly, since any of those would reopen exactly the kind of tenant-isolation risk this project has fixed multiple times before in its own history (per project memory, several prior sessions found and fixed real cross-role/cross-tenant leaks). The only safe fix is a real additive migration plus a dual-identity code path everywhere brain-games tables are touched — genuine, non-trivial engineering work, not a quick patch. **Resolution:** promote this from "Phase 6 reward-service work" to Phase 1's concrete first deliverable (see `FINAL_BUILD_PLAN_DRAFT.md`), since every downstream phase's reward/reporting/PIN-parity work depends on it existing first.

## Curriculum/SEL findings

FNE's *existing* evidence-discipline posture already matches the blueprint's §5.6/§6.4 requirements almost verbatim — `research.html` states outcome statistics reflect "published national research on social-emotional learning generally," explicitly "not presented as outcomes of Fixer Nation Education programs," and that the CASEL competency mapping is "thematic alignment... not a formal review, endorsement, or certification by CASEL." This is a real, positive finding: the discipline the blueprint asks for is not new to this team. The Issues-to-Answers 5-step cycle is already live, word-for-word, in `how-it-works.html`, matching the blueprint's §6.6 exactly — the Branching Scenario engine's content schema should encode these 5 steps as structured fields to keep game-form and lesson-form delivery of the same framework recognizably consistent.

Two open items, not blockers: (1) the 12 new flagship games' actual instructional design (learning objective, scaffold fading, feedback hierarchy) can only be rubric-reviewed once they're built — this report cannot certify designs that don't exist yet, only the *written* spec, which is sound; (2) the 6 legacy games' actual in-play feedback/timing behavior (does Reaction Time or Stroop Challenge's speed pressure risk violating §5.5's "speed should not dominate unless it's the explicit objective"?) needs a direct gameplay review before they're declared "preserved and evolved," not just a badge-copy read.

## Accessibility findings

**This is the single largest gap this verification surfaced.** No shared accessibility utility (reduced motion, keyboard/focus management, non-drag alternatives, caption/transcript patterns) exists anywhere in the codebase today. Given §8's WCAG 2.2 AA target applies to all 18 catalog experiences across 4 presentation bands, building this once at the shell/engine layer (Phase 2/3) rather than per-game later is the single highest-leverage sequencing correction in this whole report. `REFERENCE_REGISTER.md` §2 confirms WCAG 2.2 (W3C Recommendation, December 2024) as the correct technical target, and separately confirms that public K-12 districts — FNE's actual customers — are themselves subject to a DOJ ADA Title II rule requiring WCAG 2.1 AA web/mobile conformance, with compliance deadlines now extended to April 2027/2028 per a 2026 DOJ interim rule found in this pass. That rule binds districts, not FNE directly, but districts will very plausibly flow it into procurement contract language — a real, externally-driven reason this isn't optional polish.

## Privacy/security findings

COPPA (FTC, most recent rule text dated April 22, 2025) and FERPA/PPRA (via `studentprivacy.ed.gov`) are the operative federal floor. **A materially useful finding**: Pennsylvania has **no enacted state-specific student-data-privacy statute** — SB 378 ("Student Data Privacy and Protection Act") was tabled June 3, 2026 and did not advance. This means FERPA/PPRA/COPPA are currently the actual legal floor for a PA-relevant vendor, not a stricter state law layered on top — worth confirming this hasn't changed by the time Phase 1 ships, since the bill could be reintroduced. On the technical-security side, OWASP ASVS/Top 10/API Security Top 10 map cleanly onto the new API surface this expansion requires (progress-sync, reward-write, and reporting endpoints) — the highest-risk categories for this specific build are broken object-level authorization (given the PIN-student dual-identity code paths T17 introduces) and reward/score forgery (already mitigated by this project's existing server-authoritative design pattern, which should be preserved, not weakened, for the new engines).

## Hosting/operational findings

No error-monitoring service and no backup/rollback documentation exist anywhere in this repository — a pre-existing gap, not something Tune Your Brain introduces, but worth leadership's awareness given how much new schema/event-volume this expansion adds. The existing 6-cron-job inventory (`setup-cron-jobs.sh`) and its flat-log-file convention is a fine pattern to extend for any new Tune Your Brain job (e.g. an event-retention purge), but it means troubleshooting a production issue in this feature will be exactly as manual as it is for everything else in this codebase today.

## Recommended blueprint amendments

1. Promote the PIN-student schema fix (T17) to Phase 1's first concrete work package, not Phase 6.
2. Add the shared accessibility utility explicitly to Phase 2's scope — it isn't in the blueprint's own Phase 2 work list today.
3. Correct the 6 legacy games' names to their real slugs when the traceability/content docs reference them.
4. Resolve D1 (ElevenLabs live status) before Phase 4 content-production planning is finalized, not assumed.
5. Decide D2–D5 (site-auth middleware scope, event-retention window, admin-aggregate visibility depth, skill-graph Phase-1-vs-Phase-4 ownership) explicitly rather than leaving them implicit in the blueprint's current phase text.

## Go/no-go assessment

**Go**, on Phase 0's remaining follow-up items (engine-mapping spike, D1 confirmation, legacy-game rubric pass) plus Phase 1's revised first work package (T17), as detailed in `FINAL_BUILD_PLAN_DRAFT.md`. No finding in this pass rises to a reason to halt or fundamentally redesign the blueprint's destination — every gap found is a sequencing or scoping correction, not evidence the platform can't be built as envisioned.
