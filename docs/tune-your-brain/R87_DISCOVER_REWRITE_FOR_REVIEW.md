# Release 87: Discover games for ages 5-6, built and held for your review

Written 2026-11-02. **Built and tested locally, not committed.** Follows `R87_DISCOVER_REWRITE_OUTLINE.md` with all six decisions taken as recommended: choices spoken and captioned, a "Show the words" button, pictures and bigger rows in Feelings Detective, no color-as-answer, Sound Safari stop-gap wording, and "You got it!" / "Try another one." The strings went through the humanize pass; one header changed (below).

## What changed

| File | Change |
|---|---|
| `engine-audio-choice.js` (`?v=3`) | Speaks the story and question, then each answer left to right; replay plays all of it; every outcome is spoken (and cuts off the story if a child answers early); optional caption under each picture; a "Show the words" button (logged as a hint, like Replay); Discover wording for the outcome lines and summary labels; emoji are stripped before the voice sees any text |
| `engine-scenario-choice.js` (`?v=5`) | Discover only: speaks its prompts, the "good looking" line, the feedback sentence and the closing line; a "Show the words" button for the story; Discover wording for the summary labels. Other bands play as before |
| `engine-sdk.js` (`?v=4`) | New wording keys (outcome lines, summary labels, words button), with Discover values |
| `brain-games.css` (`?v=5`) | Caption tiles, the words box, bigger text rows for Feelings Detective (22px, 64px tall, dark outline) |
| Six Discover pages | New stories, captions, headers, feedback and help lines (below) |
| 36 pages | Cache numbers |

No server change, no schema change, no restart.

## The words as built

Same as the outline, with these differences:
- **Feelings Detective header:** "Look at the clues. Then pick how they feel." (the outline's "Look. Think. How do they feel?" was three clipped sentences in a row, which the humanize pass flags).
- **Helper's Choice, item 1 caption:** "Into your bag" (was "Put it in your bag", five words; captions stop at four).
- **Same and Different captions:** the existing short words, with these changes: "Big city", "Small town" (was "Grew up in a city/town"), "A special treat" (was "Getting a special treat"). Two feedback lines and two explanations were trimmed so they fit the new 15-word limit (rounds 2, 4, 6 and 9).
- **Sound Safari examples changed on purpose.** The old rounds 3 and 4 said the example word and the right answer were the same ("like in turtle", then the turtle was the answer; likewise butterfly), so a child could pick the word they had just heard. Now round 3 says "Tiger starts with tuh" and the right picture is the turtle; round 4 says "Ball starts with buh" and the right picture is the butterfly. Rounds 1 and 2 (moon, sun) were already fine.
- **Sound Safari spoken line:** "Mmm. Moon starts with mmm. Which picture starts with mmm?" then the picture names ("Monkey. Cat. Fish."). On screen the button shows: Which picture starts with the same sound as "moon"?

## What I checked in the browser (local site, speech replaced by a recorder so I could read what would be spoken)

- **Calm Down Corner:** replay speaks "A puzzle piece will not fit. You feel grumpy. What helps you feel calm? Count to five. Give up. Throw it."; the captions show under the pictures; Show the words reveals the story and flips to "Hide the words"; answering shows and speaks "You got it!".
- **Sharing Circle:** screenshot shows the dark thick outlines, pictures with captions, and the Replay and Show the words buttons.
- **Feelings Detective:** the whole first story: story and prompt and clues spoken on replay; the story words stay hidden until the button is pressed (I caught and fixed a bug where they were showing at the start); "Good looking! Now think about the feeling." is spoken; the feelings screen speaks its prompt and the feelings; the feedback line is spoken; the private check-in prompt and options are spoken. The clue rows are 22px with a 3px dark outline.
- **Sound Safari:** speaks the sound line and the picture names; words button shows the question; a wrong tap shows and speaks "Try another one."
- **Same and Different:** story and question and the three captions are spoken; the feedback and explanation are spoken after the tap.
- **Helper's Choice:** only covered by the tests and the shared engine (same code path as Calm Down Corner and Sharing Circle).

## Two bugs found while building, both fixed

1. A function the audio engine needs on its first screen was declared too late, so all four audio games showed no game at all. The existing tests could not see it because they read engine files as text. I added `server/test/engine-mount-smoke.test.js`, which actually runs every engine's first screen against every real game on a stand-in browser; I checked it fails when I put the bug back.
2. The story text was visible at the start in Feelings Detective because a style rule outranked the "hidden" attribute. Fixed, and a test now guards the rule.

## Tests

`cd server && npm test`: **197 pass** (158 before). New: `discover-games.test.js` (word limits, captions on every picture, no dashes, no hard words, the engines speak the question, answers and feedback, privacy of the check-in) and `engine-mount-smoke.test.js` (26). One existing test changed on purpose: Feelings Detective used to be pinned to the engine's default prompts; it now supplies its own, and the defaults stay in the engine for other packs. The Same and Different tests now compare caption length instead of label length (labels are just pictures now).

## Not checked, and what I need from you

- **How it sounds.** I cannot hear the browser voice. Please listen on a Chromebook and an iPad: that "Mmm. Moon starts with mmm" and "Tuh. Tiger starts with tuh" sound like the letter sounds and not like "um" or "tug"; that stories are not rushed and answers are clearly separate; that the voice does not read emoji or symbols (they are stripped, but check). If a voice is poor, the human recording replaces it with no code change.
- **Speed.** A spoken wrong answer now holds the screen about 2.6 seconds, a right answer about 2.7 (it used to move on after 0.6 to 1.3). Say if that feels slow.
- **Phone widths, and the other rounds of each game** (I played one round of each, plus the whole first story of Feelings Detective).
- **Spoken Same and Different feedback is still long** (feedback plus explanation, about 25 words, up to about 10 seconds). It was that long before; I trimmed four lines but did not cut it further.
- **Ages:** Discover is labelled K-2 in the catalog and this release is written for ages 5-6; second graders may find it easy.

## Help video check (at commit)

S2 embeds Feelings Detective but only clicks "Mark as Done", so I expect it still correct; S4 plays Memory Match. I will run `node server/scripts/videos-to-review.js` at commit and record the judgment.

## Deploy (after you approve and I commit)

Static files only: push, cPanel `git pull`, the broad rsync. No restart, no alter script, no `npm install`.
