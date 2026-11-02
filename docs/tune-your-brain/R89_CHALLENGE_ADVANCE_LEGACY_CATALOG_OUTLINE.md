# Release 89: Challenge and Advance polish, the six older games, and the games page (outline, for your approval)

Written 2026-11-02. Outline only: nothing is built until you approve or edit it. Last release from `GAME_LANGUAGE_COLOR_AUDIT.md`. Colors (R85), the wording table (R86), Discover (R87) and Explore (R88) are live.

**A correction to the audit.** The audit said Challenge and Advance games lean on praise openers ("Good catch.", "Right."). I measured every feedback line: 5 of about 300 start that way (Decision Point 1, First Shift 2, The Post 2). The older groups' text is not too long either: Advance stories are meant to be nuanced. So this release is smaller than the audit suggested for the 13 Challenge and Advance games, and larger for the six older games and the games page.

## 1. The 13 Challenge and Advance games: what is actually left

| Finding | Where | Proposed fix |
|---|---|---|
| **The same header sentence is reused.** "Work through what is happening..., who it affects, and what to do about it." appears on Decision Point, Group Chat Meltdown, First Shift and The Post; several others use a three-part list ("Listen, check the facts, plan a respectful ask, and speak up...") | 13 game headers | One distinct line per game (examples below) |
| **Spaced hyphens used as dashes in visible text** ("That is a completely normal reaction - recognizing it is the first step.") | Group Chat Meltdown (3 lines), Decision Point (1), First Shift and The Post (a few each) | Rewritten as two sentences; the existing no-dash tests then cover them |
| **Soothing or praise lines in older games** | Group Chat Meltdown "completely normal reaction"; Money Matters "that is normal for a first apartment"; Money Moves "that is normal for a first season"; Decision Point and First Shift open one line each with "Right."; The Post opens two with "Good" | Consequence first, or a number: "$600 in, $540 out. Thin margin, but workable." |
| **Decision Point feedback runs long for 11-13** (average 24 words, the longest 46; 9 of 10 lines over 16) | Decision Point | Trim to 30 words or fewer and three sentences; the story and answers stay |
| **Values Compass sounds like Explore** ("Good noticing. Now think about the values this shows." / "I've noticed these" / "I've picked my values") | Values Compass prompts | "Nice read. Now name the values behind it." / "These are my clues" / "These are my values" |
| **Two Money Moves events read young** (a cartoon lunch box at $18, selling old toys and books) | Money Moves events 9 and 13 (and 11, a $20 toy) | Same numbers, older things: a phone case ($10 plain, $18 with a design); selling old clothes and games; a $20 pair of headphones, 30 percent off |
| **No step count outside Explore** (R88 said these could follow) | all branching, evidence and scenario games | Challenge shows "Step 2 of 5" as Explore does; Advance shows a quiet "2 / 5" with no word |

Header lines I would write (one per game; wording only, no change to play):

| Game | Now | Proposed |
|---|---|---|
| Decision Point | Work through what's happening, who it affects, and what to do about it. | A classmate is being left out. Decide what you notice, what it costs and what to do. |
| Group Chat Meltdown | Work through what happened in the chat, how you are feeling, and what to do about it. | The chat turned on you. Decide how to answer before you type. |
| First Shift | Work through what is happening at your new job, who it affects, and what to do about it. | A coworker asks you to cover for them. Decide what you owe the job, the team and the truth. |
| The Post | Work through what is happening online, who it affects, and what to do about it. | A rumor is spreading. Decide what you would share, report or ignore. |
| Community Voice | Listen, check the facts, plan a respectful ask, and speak up for a change at school or in town. | Pick a problem you can change, get the facts and make an ask people can say yes to. |
| Idea Lab | Find the real need, weigh three workable ideas, and test one small before you launch. | Find the real need, compare ideas and test one small before you launch. |

(The rest follow the same pattern; every line goes through the humanize pass and the full set is in the review note.)

## 2. The six older games (no band today)

Current wording that does not fit older players: Simon Sequence "❌ Wrong! Game over."; Reaction Time's ladder "⚡ Lightning fast! / 👍 Nice! / 🙂 Good" and "False start — try to wait for green." (has a dash); Memory Match "Give Up"; the spaced hyphens in several result lines.

**Decision for you: give them a band?** Today they appear under every grade-band filter with no band tag and sort last. My suggestion, so the games page is consistent and each game has the tone that fits: **Memory Match and Simon Sequence = Explore; Number Sequence, Quick Math, Reaction Time and Stroop Challenge = Challenge.** This sets the catalog band (the tag, the filter, the sort position); it does **not** re-skin the games, which keep their own look. Stroop must keep its bright colors anyway.

| Game | Now | Proposed (with the band above) |
|---|---|---|
| Simon Sequence | ❌ Wrong! Game over. | Not that one. You reached round 5. |
| Simon Sequence | See how far you can go! | How far can you get? |
| Reaction Time | ⚡ Lightning fast! / 👍 Nice! / 🙂 Good | 210 ms, top tier / 260 ms, solid / 340 ms, average (fixed cutoffs, shown with the time) |
| Reaction Time | False start — try to wait for green. | False start. Wait for green. |
| Number Sequence, Quick Math | ✓ Correct! / ✗ Answer was 12 | unchanged (already plain) |
| Stroop Challenge | Your brain will try to trick you! | unchanged (good for 11-13) |
| Memory Match | animal and food emoji, "Give Up" | unchanged for Explore; "Give Up" becomes "End game" |

## 3. The games page (`brain-games.html`)

- **Band tags get a color** (the R85 palette): Discover yellow, Explore lilac, Challenge blue, Advance dark slate, each with high-contrast text; and a **thin band-colored stripe on top of each card.** The card headers and the coral "Play Now" button stay as they are (brand look and the main call to action). Alternative: full band-colored headers (stronger, but white-on-color contrast needs care).
- **Card descriptions lose the internal wording.** 19 descriptions end with "A Tune Your Brain SEL experience." or "A Tune Your Brain pilot experience (Phase 5)."; some say "Issues-to-Answers cycle"; one has a missing apostrophe ("two teammates sides"). Example: "Work through a real Issues-to-Answers cycle on a peer situation — recognize, understand impact, consider options, choose, and reflect. A Tune Your Brain pilot experience (Phase 5)." becomes "Work through a problem with a classmate: spot it, think about who it affects, weigh your options, choose and reflect."
- **Grades or ages on the tag:** keep "Discover (K-2)" (teachers think in grades). Your brief's ages (5-6, 7-10, 11-13, 14-18) are approximate to the same groups; I would not show both.
- **Level names** (Beginner to Master) stay the same for every band; I would leave them.

Descriptions live in the database, so this needs a small one-off script (`server/scripts/update-brain-game-copy.js`, safe to run twice) that updates the descriptions and, if you agree, the six older games' bands. The seed scripts are updated too so a fresh install matches. No schema change, no Node restart; you run the script once in the cPanel Terminal.

## What does not change

The stories, answer types and best answers; the colors; anything logged or saved; the older games' look and play; the Discover and Explore games.

## Tests

A new check holds the 13 games' headers and visible lines to "no dashes or spaced hyphens", extends the existing writing rules, and covers the new count; the catalog script gets a test that it only updates the listed slugs and is idempotent; existing Challenge and Advance writing tests, the smoke test and the R86 wording tests keep running.

## Decisions for you

1. **Is this scope right**, given the correction above (small edits to the 13 games, not a rewrite)?
2. **Give the six older games a band** (Memory Match and Simon = Explore; the other four = Challenge), catalog tag only?
3. **Reaction Time's ladder** as proposed (time shown with "top tier / solid / average")?
4. **Money Moves**: swap the three young events (same numbers)?
5. **Games page:** band-colored tags plus a stripe (recommended), or full colored headers?
6. **Step count for Challenge ("Step 2 of 5") and Advance ("2 / 5").** OK?

## After you approve

Write the 13 headers and the few lines, the legacy copy, the page changes and the update script; run `cd server && npm test`; play one game per band and the catalog page in the browser; hold it uncommitted with a review note; then commit as Release 89. At deploy you would run the update script once. The help video **S4** (Play and track brain games) walks the games page and plays Memory Match, so I expect to judge that the colored tags change what the page looks like but not what the video says; I will decide at commit whether it needs re-recording.
