# Game defects from the games audit: requirements

Status: **BUILT as Release 136 (2026-11-06).** The owner answered "Yes, build all" and then approved the Reading Detective passages (`docs/tune-your-brain/READING_DETECTIVE_FOR_REVIEW.md`). All six defects are fixed. Source: `docs/reference/games-grade-focus-audit.md` (section F, question 10). Nothing is committed.

All six were checked against the code again. Two of the audit's numbers were re-measured by trying every possible run (below).

## What was confirmed

| # | Defect | Confirmed? | Evidence |
|---|---|---|---|
| 1 | Number Sequence: the "quadratic" pattern cannot be solved | **Yes** | `brain-number-sequence.html:206`: every term adds a **new** `rand(1,5)` (`a*i*i + b*i + rand(1,5)`), so the terms follow no rule. Shown on Hard only, one of five pattern types, so about **1 Hard question in 5 has no answer** a player can work out. The page labels it "Quadratic pattern" |
| 2 | Money Moves and Money Matters: the goal cannot be reached in some runs | **Yes, measured** | Each run draws 6 of 14 events (Moves) or 7 of 14 (Matters). I tried **every possible draw** (3,003 and 3,432) with a perfect player who can only pick choices the money allows. The goal is **unreachable in 35.0% of Moves draws (1,050)** and **42.7% of Matters draws (1,464)**. In the worst Moves draw the best possible savings is $20, which is what the player starts with. The end screen still says "try a different mix", which is false in those runs |
| 3 | Reading Detective is below grade level | **Partly** | Not confirmed as such: a rough reading-level count of the four passages gives about grade 4 to 7, which fits Explore (3 to 5). **What is confirmed:** there are only **4 items and every run plays the same four**, each passage is three short sentences (about 30 words), and in **all four items the correct answer is the longest of the three choices** (50, 51, 45 and 56 characters; the other two choices are 30 to 43 characters). A child can pick the longest answer and win |
| 4 | Same and Different: stale header comment | **Yes, fixed** | The comment said "4 are drawn per run"; the pack draws 5 (`roundsPerRun: 5`) from a pool of 12. Comment corrected |
| 5 | Story games: "ask an adult" choices not counted as good choices | **Yes** | `engine-branching-scenario.js:114`: the "Smart choices" tally counts only `responsible` and `multiple_defensible`. The `seek_help` choices (36 choices across 9 games: Choice Quest, Community Voice, Fix-It Workshop, First Shift, Idea Lab, Peace Table, Perspective Swap, Team Pick, The Post) score 0 even though their feedback says "a wise choice". The tally is only a line on the end screen; nothing else reads it |
| 6 | Memory Match cards have no screen-reader labels | **Yes, fixed** | Cards were `div`s with `aria-label="Card 3"` and a click handler: no keyboard focus, and a flipped card never said what it showed |

## Fixed now (4 and 6)

- **Memory Match** (`brain-memory-match.html`): each card is a real `<button>`, reachable with Tab and played with Enter or Space; its label says "Card 3, face down", then "Card 3, lion", then "Card 3, lion, matched"; every picture has a spoken name; a hidden status line announces "Match. lion. 9 pairs left." and "No match. Both cards are face down again."; a visible focus ring. Scoring, timing and the layout are unchanged (checked in the preview: 20 buttons, labels change as cards flip, a matched pair is marked disabled, a mismatch turns face down again).
- **Same and Different**: comment now says 5 of 12.
- Tests: `server/test/game-defects.test.js` (new).

## Proposed fixes (need your answer)

### 1. Number Sequence quadratic: one constant per sequence

Pick the constant once (`const c = rand(1,5)`) and use `a*i*i + b*i + c`. Every Hard quadratic question then has one answer (it can be found from the differences between neighbouring numbers). Nothing else changes. No data or scoring change; past results stay as they were. **Recommended: yes.** (Whether Number Sequence is tagged Thinking Skills or Math is a separate decision from the audit.)

### 2. Money Moves and Money Matters: always include the income events

Lowering the goal does not work: in the worst draw nothing can be saved at all, so every goal would be trivial. The reachability test shows what does work: **always include the events that bring money in.**

| Game | Always include | Result (every draw tried) |
|---|---|---|
| Money Moves | "Your $40 allowance arrives" | goal reachable in **all 1,287** draws that include it (0 failures) |
| Money Matters | the paycheck and the $400 tax refund | goal reachable in **all** draws that include both (0 failures); the tax refund alone cuts failures from 42.7% to 4.9% |

How: a small addition to `engine-sdk.js`: an optional `alwaysInclude: true` on an event, so the run draws the pinned events first and fills the rest at random (still in story order). Only packs that use the flag change; every other game is untouched. Money Moves then draws 5 more events at random from the other 13 (one is pinned), and Money Matters 5 more from the other 12 (two are pinned); a run is still 6 and 7 events long. The end-screen wording stays as it is. A test tries every draw of both games and fails if any draw cannot reach its goal, so this cannot come back.

Cost to know about: `engine-sdk.js` goes from v5 to v6 on the 26 pages that load it, and the money pages' events keep the same places in the authored list so learning-event `sourceIndex` stays comparable. **Recommended: yes.** Alternative: leave the games as they are and change only the end message when a run could not reach the goal (honest, but players still lose 35 to 43 percent of runs through no choice of their own).

### 3. Reading Detective: a bigger pool, balanced answers

Grow the pool from 4 passages to about 12 at grade 3 to 5 level (longer passages, 4 to 6 sentences, a mix of main idea, inference and evidence), draw 5 per run (`roundsPerRun: 5`, which the SDK already supports), and write the three choices at about the same length with the correct one in a random place (the SDK already shuffles). I will write the 8 new passages in `docs/tune-your-brain/READING_DETECTIVE_FOR_REVIEW.md`, as with the other games, and humanize the wording; **nothing goes live until you have read them.** Recommended: yes. The audit also flagged Explore Literacy as thin; this makes Reading Detective a fuller game but does not by itself add the second Literacy game.

### 5. Story games: count "ask an adult" as a smart choice

Change the tally to count `seek_help` with `responsible` and `multiple_defensible`. The label stays "Smart choices". `plausible_incomplete` and `unsafe` still do not count. One line in `engine-branching-scenario.js` (engine file, v bump on the pages that load it). Matches what the feedback already tells the child. **Recommended: yes.**

## Tests and release notes (after you confirm)

- Tests in `server/test`: quadratic always solvable (the constant second difference holds); every draw of both money games can reach its goal; `alwaysInclude` is honoured and changes no other pack; the summary counts `seek_help`; Reading Detective has the pool, balanced lengths and a correct answer that is not always the longest.
- CHANGELOG Release 136, PROJECT.md game notes, `docs/tune-your-brain/GAME_SCORECARD.md` line for the money games.
- Cache numbers: `engine-sdk.js?v=6` and `engine-branching-scenario.js` on every page that loads them (grep the exact references). No server code, no schema, no restart: static files only.
- Videos: `node server/scripts/videos-to-review.js` before committing; the student-game videos (S2, S4) may list because pages' `?v=` numbers move. The money games and the story games have no video of their own as far as the map shows; this will be confirmed and recorded in `docs/training-videos/VIDEO-STATUS.md`.

## Open questions for the owner

1. **Number Sequence:** fix the quadratic as above? (Recommended: yes.)
2. **Money games:** always include the income events (recommended), or only change the end message?
3. **Reading Detective:** write 8 new passages for your review? (Recommended: yes.)
4. **Story games:** count "ask an adult" as a smart choice? (Recommended: yes.)
5. The pinned events keep their place in the authored story order (the allowance and the paycheck are already first; the tax refund comes fifth). Is that fine, or should the tax refund also move to the start? (Recommended: leave the order as the authors wrote it.)
