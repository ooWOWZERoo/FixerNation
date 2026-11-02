# Release 88: the six Explore games for ages 7-10 (outline, for your approval)

Written 2026-11-02. Outline only: no game text is changed until you approve or edit it. Fourth release from `GAME_LANGUAGE_COLOR_AUDIT.md`. Colors (R85), the shared wording table (R86) and the Discover games (R87) are live; this release trims the Explore games' own words so a seven-to-ten-year-old can scan them.

The six games: **Choice Quest, Team Pick, Peace Table, Fix-It Workshop** (scenario games with four stories each), **Reading Detective** (4 passages), **Strength Spotter** (12 stories).

## What is wrong today (measured on the current text)

Words per line, averaged over every story in the game:

| Game | Story setup (longest) | Answer options (avg, longest) | Feedback after a pick (avg, longest) | Options over 12 words |
|---|---|---|---|---|
| Choice Quest | 14 (31) | 16 (21) | 19 (27) | 61 of 65 |
| Team Pick | 14 (25) | 17 (21) | 18 (26) | 63 of 65 |
| Peace Table | 14 (36) | 15 (19) | 18 (22) | 62 of 65 |
| Fix-It Workshop | 23 (39) | 18 (24) | 20 (25) | 65 of 65 |
| Reading Detective | 7 | 8 (16) | 21 (23) explanation | 1 of 12 |
| Strength Spotter | 31 (38) story | 6 (10) clues | 12 (18) feedback | 0 of 48 |

Reading Detective and Strength Spotter are close to right already; the four scenario games are the problem: three options of 15 to 24 words, then 18 to 27 words of feedback, five times a story. The estimated reading grade is about 5 to 6 (it should sit near grade 3 to 4 for ages 7-10). Thinking words that a child has to decode: "constructive" (8 times), "overwhelmed" (2), "perspective" (1), "affects" (3), "reaction" (3), "assume" (1).

Also found in this pass:
1. **Reading Detective shows "right answer, weak evidence" in red** as if it were wrong. R85 already added an amber "partial" look; nothing uses it yet.
2. **Nothing counts up on screen.** The progress bar has no visible number, so there is no sense of "step 2 of 5" or a level being finished (your brief asks for gamified milestones).

## The rules I will write to

| Line | Explore target (today) |
|---|---|
| Answer option | **12 words or fewer** (avg 15 to 18); one idea; starts with a verb where it can |
| Feedback after a pick | **Two sentences, 18 words or fewer in all** (avg 18 to 20, up to 27); the first sentence says what happens, the second says why |
| Story setup | **22 words or fewer, the question last** (Fix-It averages 23, up to 39) |
| Any sentence | **12 words or fewer** |
| Reading Detective explanation | 16 words or fewer (21 now) |
| Strength Spotter story | 25 words or fewer (31 now) |
| Word choice | swap thinking words: constructive to helpful, overwhelmed to "too much", perspective to "side", affects to "changes" or "hurts"; **keep feeling words** (frustrated, embarrassed, nervous, left out): naming them is the lesson at this age |

Everything else is unchanged: the stories, the five-step cycle, which option is responsible, plausible but incomplete, unsafe, defensible or seek-help, the type of every feedback line, the order after shuffling, and what is logged. Balanced option lengths (the longest within 1.4 times the shortest), "the careful answer is the longest in at most 2 of 4 steps", no dashes and fictional names still hold; the existing tests enforce them. Shortening the options will actually make balancing easier.

## Before and after (two of the worst from each game)

| Game | Now | Proposed |
|---|---|---|
| Fix-It Workshop, story setup (39 words) | At lunch, the line to pay and get your tray is so long that you only have ten minutes left to eat. Other kids are rushing too, and you want to help fix it. What do you do first? | The lunch line is so long you only get ten minutes to eat. You want to fix it. What do you do first? (21) |
| Fix-It Workshop, option (24) | Look at what is in the box, ask a few classes what they have lost, and ask the custodian how often it gets emptied. | Check the box. Ask classes what they lost. Ask the custodian. (11) |
| Fix-It Workshop, feedback (25) | This works fast because more people can pay at once. It needs a staff member for those ten minutes, so someone would have to agree. | More kids can pay at once. A staff member has to agree. (12) |
| Team Pick, story setup (25) | At recess, your two best friends are picking teams for four-square. They pick almost everyone else first, and you are the last one left standing. | Your best friends pick teams for four-square. You are picked last. (12) |
| Team Pick, option (21) | Walk off to the side and sit out the rest of recess so you do not have to see your friends. | Sit out recess so you do not see your friends. (10) |
| Team Pick, feedback (26) | Taking a break can help sometimes. Sitting out the whole recess just to avoid your friends can make it feel even more like being left out. | A short break can help. Hiding all recess makes you feel more left out. (14) |
| Choice Quest, option (21) | It is only one marker out of a big set, so it probably will not matter to Dev. | It is one marker in a big set. Dev will not mind. (11) |
| Choice Quest, feedback (27) | Everyone would know, but it puts Mia on the spot before anyone has asked what is wrong, and it does not give the team a way forward. | Everyone would know. Mia feels on the spot and nothing gets fixed. (13) |
| Peace Table, story setup (36) | (long two-kid scene, 36 words) | Cut to two short scenes of about 20 words with the question last |
| Peace Table, feedback (22) | Saying it calmly lets Ben hear you without feeling attacked, and it names the problem. | A calm voice helps Ben listen. It also names the problem. (11) |
| Reading Detective, explanation (20) | Waving right back the moment Jordan was noticed is the clue. That's what hopeful looks like, not uninterested or angry. | Jordan waves back right away. That looks hopeful, not bored or angry. (12) |
| Strength Spotter, story (33) | Diego sees a puddle by the playground in the morning. By afternoon it is gone. He wonders where the water went, so he asks his teacher and writes a note in his notebook. | Diego sees a puddle in the morning. By afternoon it is gone. He asks his teacher where it went. (19) |

(Full text for every line goes into the review document after you approve; these are samples, not the whole job. The full job is about 500 lines across the four scenario games, plus 4 Reading Detective explanations and 12 Strength Spotter stories.)

## Two small mechanisms (so the colors and milestones from your brief show up)

1. **Amber for "right answer, weak proof."** In the evidence engine, when the answer is right but the proof is not, Explore (and, with the same one-line change, Challenge and Advance) shows the amber look from R85 instead of red, and the sentence stays: "Right answer. Look for a stronger clue." An unbanded page keeps today's red. Wired through the R86 wording table (a new key), so each band decides.
2. **A visible step count in Explore.** Next to the progress bar: "Step 2 of 5" (scenario games) or "Question 2 of 4" (Reading Detective), in the same small type as the other labels. The finished screen for Explore keeps "Level complete!" and gets milestone labels: **Steps finished** and **Smart choices** in place of "Steps completed" and "Choices that helped" (scenario games). Other bands keep today's labels.

Both need small edits in `engine-evidence-hunt.js`, `engine-branching-scenario.js`, `game-shell.js` and `engine-sdk.js` (with new cache numbers), plus `brain-games.css` for the count.

## Tests

A new `explore-games.test.js` holds the six games to the table above (option, feedback, setup and sentence limits; no listed thinking words; no dashes), alongside the existing writing-rule tests for Choice Quest, Team Pick and Peace Table, and the engine smoke test from R87 that runs every first screen. Where the existing tests pin wording I will list the change in the review note.

## Decisions for you

1. **The limits** (options 12, feedback 18 in two sentences, setup 22, sentences 12): OK, or tighter?
2. **Feeling words stay, thinking words go.** OK? (Alternative: also swap "frustrated" and "embarrassed" for "mad" and "face feels hot", as in Discover.)
3. **Amber for "right answer, weak proof"**, in Explore, Challenge and Advance: yes?
4. **Visible step count and "Steps finished / Smart choices"** in Explore: yes? (Challenge and Advance can follow in Release 89.)
5. **One release or two.** Recommended: one, with a review document per game. Alternative: R88 for the four scenario games, then a smaller release for Reading Detective, Strength Spotter and the two mechanisms.

## After you approve

Write every line, check the counts with a script, run `cd server && npm test`, play each game in the browser (a full story of each scenario game, one Reading Detective round, two Strength Spotter stories), hold it uncommitted with a review document that shows each changed line next to the old one, then commit as Release 88. The help videos S2 and S4 are checked at commit.
