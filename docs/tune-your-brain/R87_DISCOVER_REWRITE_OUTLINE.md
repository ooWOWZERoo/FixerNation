# Release 87: the six Discover games for ages 5-6 (outline, for your approval)

Written 2026-11-02. Outline only: no game text is changed until you approve or edit it. Third release from `GAME_LANGUAGE_COLOR_AUDIT.md`. Colors (R85) and the shared wording table (R86) are live; this release is the Discover games' own words, plus the audio fixes they need.

## What is wrong today (from the audit and a second read of the code)

1. **The question is never spoken.** The audio engine speaks only `stimulusText`. In Calm Down Corner, Sharing Circle, Helper's Choice and Sound Safari the question ("What is a kind thing to do?", "Which picture starts with that same sound?") sits in `transcript`, which only a screen reader gets. A child hears the story and is never asked anything.
2. **The answers are never spoken either.** Each tile is a bare emoji. A child who cannot read must guess what 🤫, ⏸️, 📵 or 👉 means. (The meaning exists only as hidden `aria` text.)
3. **Feedback is silent** ("Correct!" / "Not quite — take another look.") in four of the six games; only Same and Different speaks it.
4. **Sentences are too long** for ages 5-6: stories run 10 to 43 spoken words, with words like "responsible", "frustrated", "embarrassed".
5. **Feelings Detective loses the Discover look.** Its cues are sentences, so the engine marks them `long-text`, which switches off the big-tile styling; they render as small 15px rows.
6. **Sound Safari** reads "/m/" aloud through the browser voice, which may say "slash m slash"; its human recording is on your list, so this release only gives it a stop-gap.
7. Deaf and hard-of-hearing children get no words at all on screen in five of the six games.

## What gets built

**Audio engine** (`engine-audio-choice.js`):
- Speaks the story, then the question, then the choices, left to right ("Ask if they are okay. Walk away. Laugh."). Replay plays all of it.
- Speaks the feedback after every answer, in every Discover game. New Discover wording from the R86 table: right = "You got it!", not yet = "Try another one." (replacing "Correct!" / "Not quite — take another look."). The game's own explanations stay and are spoken after.
- Optional one-to-three-word **caption under each emoji** (new `choice.caption`, 18px bold) for children who are starting to read.
- A **"Show the words"** button next to Replay that reveals the story and question in large type. Logged as a hint, like Replay.
- Summary labels in Discover words ("Got it", "Try again", "Score").

**Scenario engine, Discover only** (`engine-scenario-choice.js`):
- Speaks its prompts ("What do you see?") and the feedback sentence, not just the story and clues.
- Summary labels in Discover words (Stories, Clues found, Times you picked two feelings, Times you checked in).

**CSS** (`brain-games.css`): a readable big-row style for Feelings Detective's text choices (22px, 64px tall, the R85 dark outline), and the caption style.

**Tests:** a new `discover-games.test.js` that holds the six games to the rules in this outline (see the end); the one existing test that pins Feelings Detective to the engine's default prompts changes on purpose, because the game now supplies its own.

**Cache numbers:** `engine-audio-choice.js` `?v=3`, `engine-scenario-choice.js` `?v=5`, `engine-sdk.js` `?v=4`, `brain-games.css` `?v=5`.

No server change, no schema change, no restart.

## The words (before and after)

Rules I am writing to: **short sentences, one idea each, about 8 words or fewer; concrete words; no abstract feeling words where a simple one works; the question always ends the spoken line; each answer 1 to 3 words.** Header lines become two short sentences.

### Calm Down Corner (question: "What helps you feel calm?")
| # | Now | Proposed story | Answer captions |
|---|---|---|---|
| 1 | Your tower just fell down and you feel frustrated. | Your tower fell down. You feel mad. | Deep breaths / Yell / Knock more down |
| 2 | A puzzle piece will not fit and you feel annoyed. | A puzzle piece will not fit. You feel grumpy. | Count to five / Throw it / Give up |
| 3 | Someone took your turn on the swing and you feel upset. | Someone took your turn on the swing. You feel upset. | Ask a grown-up / Push and cry / Keep it inside |
| 4 | You spilled your juice by accident and you feel embarrassed. | You spilled your juice. Your face feels hot. | Calm spot / Yell "Not fair" / Kick something |
Header now: "Listen to what happened, then pick what would help you feel calm." Proposed: **"Listen. Pick what helps you feel calm."**

### Sharing Circle (question: "What is kind?")
| # | Now | Proposed story | Captions |
|---|---|---|---|
| 1 | A classmate is crying because they lost their favorite toy at recess. | A friend lost a toy. They are sad. | Help look / Walk away / Laugh |
| 2 | Your friend group is playing a game, and a new kid is standing alone watching. | A new kid stands alone. Your friends are playing. | Invite them / Ignore them / Whisper |
| 3 | Your friend trips and drops their lunch tray, and other kids start laughing. | Your friend dropped a tray. Kids laugh. | Help pick up / Laugh too / Walk away |
| 4 | Your little brother is scared of the thunderstorm outside. | Your little brother is scared of the storm. | Sit with him / Keep playing / Say "Stop it" |
Header proposed: **"Listen. Pick the kind thing."**

### Helper's Choice (question: "What is the right thing to do?"; "responsible" is dropped)
| # | Now | Proposed story | Captions |
|---|---|---|---|
| 1 | You find a dollar bill on the classroom floor. | You find a dollar on the floor. | Tell the teacher / Keep it quiet / Put it in your bag |
| 2 | You accidentally knock over a cup of paint and it spills on the table. | You spilled paint on the table. | Tell and clean up / Hide it / Blame someone |
| 3 | You promised to feed the class fish, but you are busy playing. | You said you would feed the fish. You are playing. | Feed the fish / Skip it / Get grumpy (the ⏸️ tile becomes 🐟) |
| 4 | Your friend wants you to say you both finished your worksheet, but you did not finish yours. | Your friend says, "Say we both finished." You did not finish. | Tell the truth / Go along / Get mad |
Header proposed: **"Listen. Pick the right thing to do."**

### Feelings Detective (scenario engine; 4 stories)
Clues shrink to six words or fewer with a small picture; feelings get a face. Same four stories, same right and less-fitting answers.

| Story | Context (proposed) | Clues (✓ happens, ✗ does not) | Feelings (less fitting marked) |
|---|---|---|---|
| Maya | Maya's friend did not save her a seat. | 👀 She looks down at her tray. ✓ / 😂 She laughs loudly. ✗ / 🪑 She sits all alone. ✓ | 😢 Sad / 😔 Left out / 🤩 Excited (less fitting: "Excited looks bouncy and loud.") |
| Sam | Sam is getting a puppy this weekend! | 🦘 He jumps up and down. ✓ / 🙉 He covers his ears. ✗ / 😁 He talks fast and smiles big. ✓ | 😆 Excited / 😊 Happy / 😟 Nervous (less fitting: "Nervous looks quiet and still. Sam is full of energy.") |
| Jordan | Jordan's team lost the game. | 😞 His shoulders slump. ✓ / 🦶 He kicks the ground. ✓ / 🤝 He high-fives the other team. ✗ | 😠 Frustrated / 😢 Disappointed / 😎 Proud (less fitting: "Proud feels good. Jordan looks upset.") |
| Priya | Priya starts at a new school today. | 🤝 She holds her mom's hand tight. ✓ / 👀 She looks at everything. ✓ / 🏃 She runs ahead alone. ✗ | 😬 Nervous / 🧐 Curious / 🥱 Bored (less fitting: "Bored looks sleepy. Priya is watching closely.") |

Prompts: "What do you see?" / "Good looking! Now think about the feeling." / "How might they feel? Pick one or more." / buttons "I see these" and "I picked these" (the "(s)" goes). Feedback sentences cut to one short line each ("Sad and left out can both be true."). Help lines: "If a friend leaves you out again, what could you do?" / "Tell a grown-up you trust, like a teacher." and "If losing makes you want to quit, what could help?" / "Talk to a coach, teacher or family member." Private check-in: "Has this happened to you?" / "Where would you feel it in your body?" / closing "You checked in with yourself! No one sees what you picked." / "Only you see your answers." Nothing about the private check-in is ever logged or saved; that does not change.

### Sound Safari (4 rounds; names of the pictures are spoken, no captions, because the skill is listening)
Spoken line becomes (stop-gap until your human recording): "Mmm. Moon starts with mmm. Which picture starts with mmm?" Likewise "Sss. Sun...", "Tuh. Turtle...", "Buh. Butterfly...". Choices are spoken by name ("Monkey. Cat. Fish."). Header proposed: **"Listen. Find the picture that starts the same."** The "slash m slash" risk disappears because the symbols are not in the spoken text any more. I cannot judge how the browser voice sounds; that is your ear test on the Chromebook and iPad.

### Same and Different (12 rounds; 4 per run; story shortened to about 20 words including the question)
| # | Proposed spoken story (question last) |
|---|---|
| 1 | Ana loves soccer. She has a dog. Ben loves drawing. He has a dog too. What is the same? |
| 2 | Mia wears glasses. Leo does not. They both like red. What is different? |
| 3 | Kofi eats rice. Lena eats a sandwich. They both have a little sister. What is the same? |
| 4 | Sam is new. He speaks Spanish at home. Ana wants to play with him. What could Ana do? |
| 5 | Nina has noodles. Omar has bread and cheese. They sit at the same table. What is different? |
| 6 | Leo uses a wheelchair. His class plays tag. What could the class do? |
| 7 | Zuri has braids. Eli has short hair. They both love to dance. What is the same? |
| 8 | Priya lives with her grandma and dad. Tom lives with his two moms. Both have people who love them. What is different? |
| 9 | Ben likes quiet games. Ana likes loud, running games. Ana wants to play with Ben. What could Ana do? |
| 10 | Hana grew up in a big city. Raul grew up in a small town. Both feel nervous on the first day. What is the same? |
| 11 | Ada's family puts candles on a cake. Jin's family eats long noodles. Both have a birthday and a treat. What is different? |
| 12 | Maya wants blocks. Dev wants tag. They want to play together. What is a kind way to decide? |
Choice pictures stay as they are, with the existing short words ("A dog", "Glasses") becoming the captions. Feedback and explanations are trimmed to about 12 words each so the spoken answer stays under about 15 seconds. The three round kinds (4 same, 4 different, 4 kind) and the "wrong answers are true of one child or both" rule do not change.
Header proposed: **"Listen to the story. Tap your answer."**

## What does not change

Every game's right answers, the shuffling and pool sizes, the SEL and Portrait of a Graduate mapping, what gets logged (the private check-in stays unlogged), the badges, and the colors from R85. Grades 2 and up will find these easy; the target is ages 5-6.

## Rules the new test will enforce

Spoken lines of eight words or fewer per sentence and 25 words or fewer in all (including the question); every item ends with a question; every emoji tile has a one-to-three-word caption or spoken name; Feelings Detective clues at seven words or fewer; no dashes; none of: responsible, frustrated, embarrassed, constructive, perspective, annoyed, disappointed (except as a feeling answer in Feelings Detective, where naming it is the lesson); every feedback line at 15 words or fewer.

## Decisions for you

1. **Speak the answers and add captions.** Recommended: the engine reads the choices aloud, and tiles get a short caption (not in Sound Safari). Alternative: audio only, or captions only.
2. **"Show the words" button** for deaf and hard-of-hearing children, and for adults checking over a child's shoulder. Recommended: yes.
3. **Feelings Detective: pictures on the clues and feelings, bigger rows.** Recommended: yes. Alternative: words only, in bigger type.
4. **Color as the answer** ("tap the red one"): your brief asked for it, but red and yellow tile edges would clash with the green and red feedback colors and with the "right or wrong" meaning. Recommended: no, keep the neutral dark outline. Say if you want it anyway.
5. **Sound Safari stop-gap wording now**, rather than waiting for your human recording. Recommended: yes; the recording replaces it later with no code change (`stimulusAudioUrl` already works).
6. **Discover's feedback words**, "You got it!" and "Try another one." OK?

## After you approve

Write the full text (every story, caption, feedback and explanation) and the engine and CSS changes, run `cd server && npm test`, play all six in the browser (speech cannot be judged there; you will need to listen on a Chromebook and an iPad), hold it uncommitted with a review document for your read, then commit as Release 87. The help videos S2 (it embeds Feelings Detective) and S4 are checked at commit.
