# Scenario Choice Engine Spike

Scoping pass for the one remaining CASEL gap flagged repeatedly in `GAP_ANALYSIS_2026-09-17.md`: genuine **Self-awareness** content. Every other competency now has coverage in every band (Calm Down Corner, First Shift, The Post, Team Pick, Group Chat Meltdown all target Self-management/Social awareness/Relationship skills/Responsible decision-making). Self-awareness has zero coverage anywhere, and the blueprint is explicit that it needs a mechanic none of the 6 existing engines provide: **multi-select**, not single-select-then-lock.

This is a design/scoping pass only — no code written. Mirrors `ENGINE_MAPPING_SPIKE.md`'s format.

## What the blueprint actually specifies (§14.1, Feelings Detective)

> **Core loop:** view brief illustrated context → notice face/body/situation cues → select possible feeling(s) → learn that context and perspective matter.
> **Developmental design:** never teach that facial expression alone proves emotion.
> **Evidence:** cue identification and reasoning level, not diagnosis.
> **Acceptance:** allows more than one plausible feeling when scenario supports ambiguity; includes help-seeking in appropriate situations.

Two things worth flagging up front:
1. **"Scenario Choice" is the blueprint's own name for this (§14.1), but it does not appear in §9.3's formal 14-engine catalog table at all** — same kind of gap `ENGINE_MAPPING_SPIKE.md` found with Memory/Pattern being missing from the blueprint's own Phase 3 starter list. We're scoping this from the §14.1 prose spec, not a catalog entry.
2. **§5.6 (Evidence discipline) directly constrains this engine**: FNE must not claim to "measure CASEL competencies as a validated assessment" or "diagnose... mental-health conditions." A single-correct-answer scoring model (right/wrong feeling) would violate this. This has to be scoreless in the same sense Branching Scenario already is — evidence of engagement and reasoning, never a "correct emotion" grade.

## Why no existing engine covers this

Read all 3 choice-based engines (`engine-branching-scenario.js`, `engine-evidence-hunt.js`, and Audio Choice via Calm Down Corner's usage) to confirm, rather than assume:

| Engine | Selection model | Why it doesn't fit |
|---|---|---|
| Branching Scenario | Single-select, click locks the choice immediately, auto-advances after feedback | No concept of "select several, then submit" — `pickChoice()` disables the whole list on first click |
| Evidence Hunt | Single-select twice (answer, then evidence), same click-locks-immediately pattern | Same limitation, plus its scoring model (`answerCorrect && evidenceCorrect`) assumes exactly one correct answer — directly conflicts with "allows more than one plausible feeling" |
| Audio Choice | Single-select, narrated | Same limitation; useful here only for its **narration/replay** pattern, not its selection model |

The gap is real, not a naming mismatch: every existing engine's core interaction is "tap one thing, it locks in." Feelings Detective needs "tap several things, then confirm" — a genuinely different widget (checkbox-group semantics, not radio-group), which none of the 6 built engines have any code path for.

**The SDK itself needs zero changes.** `engine-sdk.js`'s `mount(container, {contentPack, band, onEvidence, onComplete})` contract is already selection-model-agnostic — it just needs a new engine module registered against it, same as every engine before it.

## Recommended interaction design

Two-stage per scenario, reusing Evidence Hunt's proven **two-stage-per-item** shape but swapping the second stage's selection model from single-select to multi-select — this satisfies the blueprint's two separate evidence dimensions ("cue identification" AND "reasoning level") as two distinct, separately-logged stages instead of collapsing them into one guess:

1. **Notice stage** — show the illustrated context (narrated, per the audio requirement below) plus 3-4 candidate cue statements ("Her voice is quiet," "She's looking at the ground," "Her friend just walked away"). Multi-select: pick every cue actually present in the scene. This stage has real ground truth (cues are either shown in the scenario or not) — it's the one place a right/wrong signal is legitimate, framed as "notice," not "score."
2. **Feelings stage** — given those cues, multi-select from a set of feeling words. Each content-authored feeling in the option set is tagged `plausible` or `less-fitting` (never "correct"/"incorrect" — matching Branching Scenario's existing type-tagging convention, e.g. `unsafe`/`responsible`/`plausible_incomplete`). More than one `plausible` tag per scenario is expected and normal, per the acceptance rule.
3. **Feedback** — never says "right"/"wrong." For a `less-fitting` pick, feedback redirects to the mismatched cue ("Notice that her voice was quiet, not loud — that's more often a sign of X than Y"), same non-punitive tone Branching Scenario already uses for `plausible_incomplete`. Always includes a line reinforcing "more than one feeling can make sense here" when the scenario has 2+ `plausible` tags.
4. **Optional help-seeking beat** — per the acceptance rule ("includes help-seeking in appropriate situations"), a subset of scenarios (not all — some are just "notice a cue," e.g. someone looking proud) end with a lightweight prompt: "If this feeling gets hard to handle, what could you do?" using the same `seek_help`-style option Branching Scenario already has a type for. Not every scenario needs this — content-author judgment per scenario, same as Branching Scenario's `choose` step doesn't force a `seek_help` option into every game.

**No numeric score, no `scoreInfo` passed to `onComplete`** — same choice Branching Scenario already made, for the same §5.6 reason. Summary lines report engagement, not accuracy: e.g. `{ value: scenariosCompleted, label: 'Scenarios explored' }`, `{ value: cuesNoticed, label: 'Cues noticed' }`. Never a "correct feelings" count.

## Content pack shape (proposed)

Mirrors the existing engines' file-header comment convention:

```js
// contentPack shape:
// { title, scenarios: [{
//     context: 'Maya's block tower just fell for the third time.', // narrated
//     illustration: '🏗️',  // or an image ref, per band's asset convention
//     cues: [
//       { id, text: 'She let out a loud sigh.', present: true },
//       { id, text: 'She is smiling.', present: false },
//       { id, text: 'She stepped back from the tower.', present: true },
//     ],
//     feelings: [
//       { id, text: 'Frustrated', tag: 'plausible' },
//       { id, text: 'Disappointed', tag: 'plausible' },
//       { id, text: 'Excited', tag: 'less_fitting' },
//     ],
//     reinforcement: 'More than one feeling can be true at the same time...',
//     seekHelp?: { prompt: '...', text: '...' },  // omitted when a scenario doesn't need it
// }] }
```

## Hard requirement: audio from day one, not retrofitted later

Feelings Detective is placed in §14.1 as a **Discover-band** flagship game. `GAP_ANALYSIS_2026-09-17.md` already hit this exact wall once with Branching Scenario ("Discover's own 'no reading required, spoken support' rule (§7.2)... Branching Scenario... has zero audio support"), which is why Discover's own SEL game (Calm Down Corner) had to use Audio Choice instead. **Scenario Choice must not repeat that mistake** — narration (context, each cue statement, each feeling word, replay control) needs to be built into the engine from its first version, reusing Audio Choice's proven play/replay UI pattern, not bolted on after a text-only v1 ships and gets used at Discover band anyway.

Scoping this in from day one also means the engine is reusable at Explore/Challenge/Advance later (per the gap analysis's own item 4, "revisit Self-awareness for the other bands too") without a second retrofit — those bands can simply not play the narration by default, same optionality Audio Choice already has.

## New UI primitives needed (real, scoped work — not free)

`game-shell.js`'s `FnGameShell` has no multi-select/checkbox component today — every existing `renderX` helper assumes single-select-then-lock. Two additions needed:

1. A toggleable choice button state, distinct from the existing `.selected` (which is a *locked, disabled* state in every current engine). Multi-select needs a button that can be toggled on and back off freely before submission — new CSS state (e.g. `.fn-choice-btn.toggled[aria-pressed="true"]`), not a reuse of `.selected`.
2. A "Confirm" / submit control that only becomes actionable once at least one option is picked (both the cue stage and the feelings stage need their own submit action, since neither should auto-advance on the first click the way every existing engine does).

Both are additive CSS/markup, no changes to `.fn-choice-list`'s existing layout or to any other engine's rendering.

## Evidence/reward wiring (matches existing pattern, no new decisions needed)

- `onEvidence('response_submitted', { scenarioIndex, stage: 'cues', selectedCueIds })` and a second call for the feelings stage — same shape as Evidence Hunt's two-call-per-item pattern.
- `reward_pipeline` stays `classroom_generic` (default) — no new reward-service work, same as every game since Phase 6's first slice.
- Needs its own `seed-{slug}-catalog-entry.js` and a `seed-classroom-completion-badges.js` entry, same as every prior game.
- No `student_reflections`/content-safety-gateway involvement — this stays structured multi-select, no free text, same posture Branching Scenario already takes (its file-header comment already documents *why* free text would need the gateway if ever added; this engine simply never adds free text in the first place).

## Decisions made, then built

1. **Two-stage per scenario — confirmed.** Built exactly as recommended: notice cues, then pick feelings, as two separate multi-select steps.
2. **4 scenarios for the first slice — confirmed.** Matches Calm Down Corner's precedent.
3. **Engine registered as `scenarioChoice`** (`engine-scenario-choice.js`), matching the existing camelCase convention.

**Built and verified locally** (loaded via the static-preview trick, played through all 4 scenarios including both the `less_fitting`-pick redirect path and both seek-help beats, confirmed the scoreless summary). One real bug found and fixed during that verification, not by code review alone:

**Real bug: Discover-band's global `.fn-choice-list`/`.fn-choice-btn` CSS assumes a single emoji glyph per choice (60px font, 130px-tall grid cells) — every existing Discover game (Calm Down Corner) uses emoji labels with the real text in `aria-label` for exactly this reason.** Scenario Choice's cues/feelings are genuinely short phrases and sentences, not reducible to one emoji without misleading simplification (the game's own developmental-design rule prohibits implying one visual proves a feeling). This produced illegible, overlapping 2-column text on first load. Fixed with a `.long-text`/`.long-text-list` opt-out pair in `brain-games.css`, scoped to `html[data-band="discover"]` only — reverts those specific buttons to the default block/left-aligned/band-scaled text style other bands already use, without touching Calm Down Corner or any other Discover content.

Also confirmed while building: **no new CSS was actually needed for the toggle-on/off multi-select state itself** — the existing `.selected` class (used elsewhere for a locked, disabled choice) works fine as a plain toggle class too, since its own CSS never depends on `:disabled`. The spike's assumption that a new toggle-state class was needed didn't hold up once building against the real CSS — worth remembering as a general lesson: verify a CSS assumption against the actual stylesheet before scoping "new CSS needed" as real work.
