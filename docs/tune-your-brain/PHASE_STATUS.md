# Tune Your Brain — Phase Status

**Read this first in any new session before doing more Tune Your Brain work.** Updated at the end of every work package — if it's stale, something was skipped.

Legend: ✅ done & deployed · 🟡 coded & pushed, not yet deployed · ⬜ not started

| Phase | What it is | Status |
|---|---|---|
| 0 | Repository forensics & baseline verification | ✅ Done (`docs/tune-your-brain/BLUEPRINT_VERIFICATION_REPORT.md` etc.) |
| 1 | Architectural foundation — PIN-student reward fix | ✅ Done & deployed, confirmed live 2026-09-16 (Release 38) |
| 1 | Architectural foundation — feature flags, skill-graph tables, `learning_events`, shared site-auth helper | ✅ Done & deployed, confirmed live 2026-09-16 |
| 2 | Shared design system + 4 experience-band tokens + accessibility utilities | 🟡 Coded & pushed 2026-09-16 — **needs deploy** (static files only, no restart) |
| 3 | Game Engine SDK + normalized session runtime | ⬜ Not started |
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

## Next recommended step
Phase 3: Game Engine SDK. Before locking which 6 engines to build first, the plan calls for a short spike reading the 6 existing games' client-side code to see which of the 14 proposed engines they actually map onto — that spike hasn't been done yet and should happen first.
