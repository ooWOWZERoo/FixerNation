# Release 86: wording that fits each age group (outline, for your approval)

Written 2026-11-02. Outline only: nothing is built until you approve or edit it. Second release from `GAME_LANGUAGE_COLOR_AUDIT.md` (section 3b). **Shared wording only.** The games' own stories, options and headers are Releases 87 to 89.

## The problem in one paragraph

The words a player sees around the content ("Nice work!", "Correct, and well-supported by the text!", "Logged. Moving to the next decision...", "Recognize the Issue") are written once, inside five shared engine files, so a 16-year-old in Critical Read gets the same cheerful lines as a first grader. Only the scenario engine lets a game override its wording; the other four do not. Two real bugs sit alongside: the two money games show a green "correct" box after every choice, even poor ones, and the story text in the "notice and pick" games (Strength Spotter, Values Compass) is read aloud but never shown on screen.

## How it is built

1. **One copy table in `engine-sdk.js`** (it loads before every engine and already receives the band): `FnEngineSDK.t(key, band, contentPack)`. Lookup order: the game's own `contentPack.copy[key]`, then the band's string, then today's string. So an unbanded page, an unknown band, or a key I did not write keeps the current wording exactly.
2. **Engines call `t(...)` instead of hard-coded strings** (evidence hunt, simulation, branching scenario; the SDK's run-complete screen). The engines get `band` from the SDK, which already passes it.
3. **Branching step labels** come from the table by band, with a per-game `contentPack.stepLabels` override (for the games whose flow does not fit the generic labels).
4. **A `neutral` feedback look** (soft surface, plain border, normal text color) for "decision recorded" messages. It uses colors the R85 themes already define, so no new hooks.
5. **Story text on screen** in the scenario engine for Explore, Challenge and Advance (new `.fn-story-text` rule, 16px, left-aligned, under the emoji). Discover is audio-led and stays as it is until Release 87.
6. **New test `server/test/band-copy.test.js`:** every key has today's wording as its default; unknown band falls back; a pack override wins; no dashes and no string over 12 words; the branching engine has a label for all five steps in every band; and no engine file still contains an old hard-coded string.
7. Cache numbers: `engine-sdk.js` `?v=2` to `?v=3` (28 pages), each changed engine bumped (evidence hunt currently has no version number, so it gets `?v=1`), `brain-games.css` `?v=3` to `?v=4` (the story style and the neutral look).

No server change, no schema change, no restart.

## The wording (draft; this is what you approve)

Plain, short, no dashes. A blank means that band keeps today's wording because no game of that group uses that engine.

| Where | Discover | Explore | Challenge | Advance |
|---|---|---|---|---|
| Finished screen title (now "Nice work!") | You did it! | Level complete! | Run complete | Debrief |
| Button after it (now "Play again") | Play again | Play again | Run it again | Try again |
| Evidence games: right answer and right proof (now "Correct, and well-supported by the text!") | | Right, and you found the proof! | Correct. The text backs it up. | Sound judgment. The passage supports it. |
| Right answer, weaker proof (now "Right answer, but that's not the strongest evidence.") then the game's explanation | | Right answer. Look for a stronger clue. | Right answer, but another sentence proves it better. | Right conclusion, weaker evidence. A stronger sentence is available. |
| Wrong answer with no explanation (now "Not quite — take another look at the passage.") | | Not yet. Look at the story again. | Not quite. Reread the passage. | That does not hold up. Reread the passage. |
| Proof question (now "Which sentence best supports your answer?") | | Which sentence proves your answer? | (unchanged) | Which sentence best supports your conclusion? |
| Evidence summary labels (now Evidence-supported / Right answer, weak evidence / Missed) | | Found the proof / Right, weak proof / Not yet | (unchanged) | Supported / Weakly supported / Not supported |
| After each money-game choice (now a green "Logged. Moving to the next decision...") | | | Decision locked in. Next up. | Noted. Next decision. |
| Branching step labels (now Recognize the Issue / Understand the Impact / Consider Possible Answers / Choose a Responsible Response / Reflect and Reinforce) | | What is happening? / Who does it affect? / What could you do? / Pick your best move / Think it over | Spot the issue / Weigh the impact / List your options / Make the call / Reflect | Situation / Stakes / Options / Decision / Debrief |
| Branching feedback when a choice has none (now "Thanks for choosing.") | | Thanks for picking. | Choice recorded. | Noted. |
| Reflection box hint (now "Type a few words about what you'd take away from this...") | | What will you remember? | What is your takeaway? | Your takeaway. Private, not saved. |

**Per-game step labels** (three Advance games and one Explore game whose flow the generic labels do not fit):
- Idea Lab: The need / The ideas / The trade-offs / The test / What you learned
- Community Voice: The problem / The facts / The ask / The pitch / What you learned
- Perspective Swap: Your view / Their view / The gap / A fair plan / Reflect
- Fix-It Workshop (Explore): Spot the problem / Hear from people / Think of fixes / Pick one to try / What you learned

**Screen-reader text:** "Your reflection (private, not saved in this demo)" and "This reflection is private and is not sent anywhere in this demo" say "demo" about a real game and contain a dash. They change for every band, including the default: "Your reflection. Private, not saved." and "This reflection is private and is not sent anywhere."

## What does not change in this release

- The six Discover games' wording (Release 87), including the audio engine's "Correct!" and "Not quite — take another look."
- Any story, option, header or explanation inside a game, except the four step-label overrides above.
- The scenario engine's default prompts (Feelings Detective's wording is pinned by a test and belongs to Release 87).
- The legacy games.
- What gets logged or saved: reflections and self-checks stay private; no event changes.

## Decisions for you

1. **The wording table:** approve, or mark lines to change. The riskiest ones are Advance's "Debrief" as the finished-screen title and "Sound judgment. The passage supports it." (confident, mature, but a little stiff).
2. **Story text on screen** for Strength Spotter and Values Compass (and any later game on that engine) in Explore and up: yes? Today a player with sound off, or a deaf player, sees only an emoji and the clue buttons. I recommend yes.
3. **Neutral look after money-game choices** instead of green: yes? A poor choice then no longer gets a success box.
4. **"Demo" wording in the screen-reader text** fixed for all bands, including the default: yes?
5. **Discover's story-on-screen** (Feelings Detective shows no story text, by design for non-readers): leave for Release 87, where I will propose it alongside the spoken-question fix. OK?

## After you approve

Build it, run `cd server && npm test` (the new test plus the existing 144), play one game per engine and band in the browser (Critical Read, Headline, Money Matters, Money Moves, First Shift, Idea Lab, Strength Spotter, Values Compass, Choice Quest), hold it uncommitted with a review note for your read, then commit as Release 86. Help-video check at commit: S2 and S4 watch some of these pages; I expect them to stay correct but will judge it then.
