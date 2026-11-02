# Release 89: Challenge and Advance polish, the older games, and the games page, built and held for your review

Written 2026-11-02. **Built and tested locally, not committed.** Follows `R89_CHALLENGE_ADVANCE_LEGACY_CATALOG_OUTLINE.md` with all six decisions taken as recommended (the small-polish scope; bands for the older games; Reaction Time's tiers; the Money Moves swaps; band-colored tags plus a stripe; step count for Challenge and Advance). The strings went through the humanize pass; it removed three-item lists from four headers (First Shift, The Post, Community Voice, Idea Lab) and the "Nice read." opener from Values Compass.

## What changed

| Where | Change |
|---|---|
| 13 Challenge and Advance pages | A distinct header on each; the spaced hyphens used as dashes, the praise openers and the soothing lines removed; Decision Point's one 46-word feedback cut to 20 words; Values Compass prompts; Money Moves' three young events; both money games' "slow start" ending now gives numbers |
| `game-shell.js` (`?v=3`) | Step count: "Step 2 of 5" in Explore **and Challenge**, a quiet "2 / 5" in Advance, nothing in Discover |
| Six older game pages | Simon Sequence: "Not that one. You reached round 5." and "How far can you get?"; Reaction Time: tiers "Top tier / Solid / Average" (the time still shows above) and "False start. Wait for green."; Memory Match: "End game"; four dashes removed from the instructions of Simon, Reaction Time and Stroop |
| `brain-games.html`, `brain-games.css` (`?v=7`) | Each card gets a 6px stripe in its group's color and a tinted tag (Discover yellow, Explore lilac, Challenge blue, Advance dark slate); headers and the coral Play Now are unchanged |
| `server/lib/brain-game-copy.js` (new) | The 25 plain descriptions and the six older games' bands, in one place |
| `server/scripts/update-brain-game-copy.js` (new) | One-off, safe to run twice: updates descriptions and sets the six bands; prints what it changed |
| 25 `seed-*-catalog-entry.js` and `seed-brain-games-band-values.js` | Same descriptions and bands, so a fresh install matches production |
| `server/scripts/older-games-lines.js` (new), 2 new test files | The checker and the tests for the rules above (231 tests pass; 208 before) |

**Needs the update script run once on the server (no restart, no schema change):** until you run it, the games page keeps the old descriptions and the six older games stay band-less.

## One behavior change you should know about

The teacher's classroom page lists games for the class's grade band by default and shows a game that has **no band** to every class. Now that the six older games have a band, a **K-2 class will no longer see Quick Math, Number Sequence, Reaction Time or Stroop by default** (and a **grade 6 to 12 class will no longer see Memory Match or Simon Sequence**) unless the teacher ticks "Show games for all grade bands". That is how every other game already behaves; say if you would rather leave these six band-less after all (the update script's six bands are one table in `server/lib/brain-game-copy.js`).

## What I checked

- `node server/scripts/older-games-lines.js`: **0 lines break a rule in all 13 games** (it flagged ten before: four in Group Chat Meltdown, one each in Decision Point's praise opener and long feedback, First Shift, The Post, Values Compass, and the two money debriefs).
- `cd server && npm test`: **231 pass**. One side effect: the two money games' ending tests identify an ending by its first sentence, so the "slow start" ending keeps a constant first sentence ("You are off to a slow start.") and the numbers come in the second.
- In the browser (local site): Money Moves plays through with "Decision 1 of 6" and the new header and ends on the numbers; First Shift shows "1 / 5" in cyan and its new header; four sample cards built with the page's own card code showed the right stripe and tag colors (computed styles; the real card list needs the database, which the local site does not have).
- Not played by eye: the other twelve games' new headers, Simon Sequence and Reaction Time result lines, the games page with real data, phone widths.

## What to read

The three tables below: every new header, every new description. The few changed lines inside the games are small: the ten lines from the checker, the three Money Moves events, and Values Compass's three prompts.

## Help video check (at commit)

S4 walks the games page and plays Memory Match; the page now has colored tags and stripes and Memory Match is tagged Explore, so the recording will look different from the page; the narration is about playing and tracking games, so I expect it still correct (I will record that at commit).

## Deploy (after you approve and I commit)

Push; cPanel `git pull`; the broad rsync; then, in the cPanel Terminal with the nodevenv active, run `node scripts/update-brain-game-copy.js` once from the server folder. No Node restart (the games page reads the database on each load), no schema change, no `npm install`.

## The 13 game headers

| Game | Now | New |
|---|---|---|
| decision-point | Work through what’s happening, who it affects, and what to do about it. | A classmate is being left out. Decide what you notice and what to do. |
| group-chat-meltdown | Work through what happened in the chat, how you are feeling, and what to do about it. | The chat turned on you. Decide how to answer before you type. |
| headline | Read the story, pick the most accurate headline, then find the sentence that proves it. | Read the story, pick the most accurate headline, then find the sentence that proves it. |
| money-moves | Manage your allowance and odd-job money toward a savings goal. Every run brings different choices, and there is more than one way to do it well. | Save toward a goal and keep some spending money. More than one path works. |
| say-it-another-way | Read the situation, pick the message this person would hear best, then find the sentence that shows why. | Read the situation, pick the message this person would hear best, then find the sentence that shows why. |
| values-compass | Notice what someone does, spot the values it shows, then think about your own. | Notice what someone does, name the values behind it, then think about your own. |
| critical-read | Read closely, judge the claim, then find the sentence that actually supports your judgment. | Read closely, judge the claim, then find the sentence that actually supports your judgment. |
| first-shift | Work through what is happening at your new job, who it affects, and what to do about it. | A coworker asks you to cover for them. Decide what you owe the team and the truth. |
| the-post | Work through what is happening online, who it affects, and what to do about it. | A rumor is spreading. Decide what you would share and what you would report. |
| money-matters | Manage Jordan's first few months on a budget. There is more than one way to do it well. | Manage Jordan's first months on a budget. More than one path works. |
| perspective-swap | See a group plan from two teammates' sides, then choose how the group can adjust so everyone can take part. | Two teammates see one plan two ways. Hear both, then adjust it so everyone can take part. |
| community-voice | Listen, check the facts, plan a respectful ask, and speak up for a change at school or in town. | Pick a problem you can change, then make an ask people can say yes to. |
| idea-lab | Find the real need, weigh three workable ideas, and test one small before you launch. | Find the real need, then test one small idea before you launch. |

## The 25 games-page descriptions

| Game | Now | New |
|---|---|---|
| calm-down-corner | Listen to a frustrating moment, then pick what would help you feel calm. A Tune Your Brain SEL experience. | Listen to what happened, then pick what helps you feel calm. |
| choice-quest | Work through a real Issues-to-Answers cycle on a team-project situation. A Tune Your Brain catalog experience. | Work through a team-project problem: see what is happening, who it affects and what to do. |
| community-voice | Listen, check the facts, plan a respectful ask, and speak up for a change at school or in town. A Tune Your Brain SEL experience. | Pick a problem you can change, then make an ask people can say yes to. |
| critical-read | Judge real claims for evidence, bias, and source reasoning, then prove your judgment from the text. A Tune Your Brain catalog experience. | Judge real claims for evidence, bias and sources, then prove your judgment from the text. |
| decision-point | Work through a real Issues-to-Answers cycle on a peer situation — recognize, understand impact, consider options, choose, and reflect. A Tune Your Brain pilot experience (Phase 5). | A classmate is being left out. Decide what you notice and what to do. |
| feelings-detective | Notice real cues in a scene, then pick every feeling that plausibly fits. A Tune Your Brain SEL experience. | Look at the clues in a scene, then pick every feeling that fits. |
| first-shift | Work through a real Issues-to-Answers cycle on a workplace integrity situation. A Tune Your Brain SEL experience. | A coworker asks you to cover for them. Decide what you owe the team and the truth. |
| fix-it-workshop | Find a problem at school, listen to the people it affects, and try a small fix. A Tune Your Brain experience. | Find a problem at school, listen to the people it affects, and try a small fix. |
| group-chat-meltdown | Work through a real Issues-to-Answers cycle on an online group-chat conflict. A Tune Your Brain SEL experience. | The chat turned on you. Decide how to answer before you type. |
| headline | Read a short story, pick the most accurate headline, then prove it with evidence from the text. A Tune Your Brain catalog experience. | Read a short story, pick the most accurate headline, then prove it with the text. |
| helpers-choice | Listen to what happened, then pick the responsible thing to do. A Tune Your Brain SEL experience. | Listen to what happened, then pick the right thing to do. |
| idea-lab | Find the real need, weigh three workable ideas, and test one small before you launch. A Tune Your Brain experience. | Find the real need, then test one small idea before you launch. |
| money-matters | Manage a fictional first budget through real tradeoffs — savings, credit, and unexpected costs. A Tune Your Brain pilot experience (Phase 5). | Manage a first budget through real tradeoffs: savings, credit and surprise costs. |
| money-moves | Manage allowance and chore money toward a savings goal, with real tradeoffs along the way. A Tune Your Brain catalog experience. | Save toward a goal and keep some spending money. More than one path works. |
| peace-table | Two kids disagree. Say what happened, listen, and find a fair plan together. A Tune Your Brain SEL experience. | Two kids disagree. Say what happened, listen, and find a fair plan together. |
| perspective-swap | See a group plan from two teammates sides, then choose how the group can adjust so everyone can take part. A Tune Your Brain SEL experience. | Two teammates see one plan two ways. Hear both, then adjust it so everyone can take part. |
| reading-detective | Read the clues in a short mystery, pick your answer, then prove it with evidence from the text. A Tune Your Brain pilot experience (Phase 5). | Read the clues in a short mystery, pick your answer, then prove it with the text. |
| same-and-different | Listen to the story, then tap what is the same, what is different, or the kind thing to do. A Tune Your Brain SEL experience. | Listen to the story, then tap what is the same, what is different, or the kind thing to do. |
| say-it-another-way | Read a real situation, pick the message this person would hear best, then find the sentence that shows why. A Tune Your Brain SEL experience. | Read a situation, pick the message this person would hear best, then find the sentence that shows why. |
| sharing-circle | Listen to what happened, then pick the kind thing to do. A Tune Your Brain SEL experience. | Listen to what happened, then pick the kind thing to do. |
| sound-safari | Listen for a sound, then find the picture that starts with the same sound. A Tune Your Brain pilot experience (Phase 5). | Listen for a sound, then find the picture that starts with the same sound. |
| strength-spotter | Notice what someone does, spot the strengths it shows, then think about your own. A Tune Your Brain SEL experience. | Notice what someone does, spot the strengths it shows, then think about your own. |
| team-pick | Work through a real Issues-to-Answers cycle on being picked last for a team. A Tune Your Brain SEL experience. | Work through being picked last for a team: what you feel, what could happen and what to do. |
| the-post | Work through a real Issues-to-Answers cycle on a digital-citizenship and peer-reputation situation. A Tune Your Brain SEL experience. | A rumor is spreading. Decide what you would share and what you would report. |
| values-compass | Notice what someone does, spot the values it shows, then think about your own. A Tune Your Brain SEL experience. | Notice what someone does, name the values behind it, then think about your own. |
