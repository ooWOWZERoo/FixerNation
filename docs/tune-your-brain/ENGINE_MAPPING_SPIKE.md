# Engine Mapping Spike — Phase 0 Follow-Up (T5/T15)

Read all 6 existing game client implementations (`brain-memory-match.html`, `brain-reaction-time.html`, `brain-simon-sequence.html`, `brain-stroop-challenge.html`, `brain-quick-math.html`, `brain-number-sequence.html`) to determine which of the blueprint's 14 proposed engines (§9.3) they actually map onto, before locking Phase 3's initial engine list.

## Mapping

| Game | Core mechanic (as actually coded) | Best-fit blueprint engine | Fit quality |
|---|---|---|---|
| Memory Match | Flip cards, recall which pair was seen where | **Memory** ("Recall locations/items/sequences") | Clean |
| Simon Sequence | Watch a growing pattern, reproduce it in order from memory | **Memory** (sequence-recall variant, same engine, different content shape than pair-matching) | Clean |
| Number Sequence | Infer the rule behind a numeric pattern, fill the blank | **Pattern** ("Infer and apply a rule") | Clean |
| Stroop Challenge | Perceive a stimulus (ink color), select from a small fixed button set, timed | **Audio Choice** ("Listen and select"), generalized | Needs the engine broadened — the mechanic is "perceive and select," not audio-specific. Recommend renaming/generalizing to cover any stimulus modality. |
| Quick Math | See a computed problem, type a numeric answer, submit | **Build** ("Construct...equations"), loosely | Weak — Quick Math isn't constructing anything piece-by-piece, it's a direct numeric-response task. Build's own accessibility variations (keyboard/list modes) happen to suit a numeric input fine, so it's usable, just not a great conceptual fit. |
| Reaction Time | Wait for a signal, tap as fast as possible, penalize early taps | **None of the 14.** | No fit. This is a pure timed-vigilance/motor-response task; nothing in the blueprint's engine catalog covers it. |

## Conclusion — Phase 3's initial engine list is corrected

The blueprint's own suggested Phase 3 starter set (§15: Audio Choice, Build, Manipulative, Evidence Hunt, Branching Scenario, Simulation) includes **zero** of the two cleanest-fitting engines (Memory, Pattern) — which together cover 3 of the 6 live games for free — and includes Manipulative, which nothing in the Phase 5 pilot slice or the 6 legacy games currently needs.

**Corrected initial 6 for Phase 3**, balancing legacy-migration reuse against the Phase 5 vertical-slice pilot's own needs (Sound Safari→Audio Choice, Reading Detective→Evidence Hunt, Decision Point→Branching Scenario, Money Matters→Simulation):

1. **Memory** — Memory Match + Simon Sequence
2. **Pattern** — Number Sequence
3. **Audio Choice** (generalized to any stimulus modality, not audio-only) — Stroop Challenge + Sound Safari (pilot)
4. **Evidence Hunt** — Reading Detective (pilot)
5. **Branching Scenario** — Decision Point (pilot)
6. **Simulation** — Money Matters (pilot)

**Genuinely deferred, not solved by this list:**
- **Reaction Time has no home.** Recommend a new, lightweight "Timed Response" engine when Phase 7/8 migrates it — cheap to build (just a countdown + click-timing primitive), but it's net-new scope the blueprint's 14-engine catalog didn't anticipate. Flagging here rather than silently forcing it into an ill-fitting engine.
- **Quick Math** stays a **Build** engine variant — usable, not ideal. Worth revisiting if Build's real design (once built for Phase 7's Word Builder) turns out too heavy for a simple numeric-response task.
- **Manipulative** dropped from the initial 6 — nothing in scope through Phase 5 needs it. Add it when Phase 7's Number Garden/Fraction Kitchen actually require it.

This directly supersedes `FINAL_BUILD_PLAN_DRAFT.md`'s placeholder language ("initial engine list to be finalized by the Phase 0 spike") — the corrected list above is what Phase 3 is now building against.
