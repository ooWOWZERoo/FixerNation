# "Your turn" steps for the three Self-Awareness games: outlines (DRAFT for the owner)

Written 2026-11-06 by Claude. **Nothing is built and no wording is written.** This follows the outline-first rule: you approve (or change) each outline, then I write the full text, add the tests, play it in a browser, and bring the finished wording back for your read before anything deploys. Context: Release 137 tagged Feelings Detective, Strength Spotter and Values Compass as Self-Awareness but marked them `pending` in `server/lib/brain-game-focus.js`, because in each one the scored work is about *other* people and the child's own part is two unscored taps after every story. Reference: `docs/reference/games-grade-focus-audit.md` (sections B and G) and `games-focus-regroup-requirements.md` (7b).

## 1. What "Self-Awareness" has to mean here (from the owner's definition)

Recognising your own emotions, thoughts and values, and how they influence behaviour. Key skills: identifying feelings, accurate self-perception, recognising strengths, self-confidence. So each game needs a part where the child **names something about themselves** (a feeling, a strength, a value), links it to their own life, and sees a result built from their own picks. It must not be graded: there is no right answer about yourself.

## 2. Privacy rules that do not change (existing, from `engine-scenario-choice.js`)

- The child's picks are **never logged, sent or stored**. The only thing recorded is that the step was reached (the existing `self_check` event pattern).
- **No free text.** Every answer is a tap on a fixed option, always with a "not sure" choice. A child can skip nothing but is never forced to pick something that does not fit.
- No score, no right or wrong colours, no comparison with other children, nothing visible to teachers or parents. The summary may say the step was done, not what was picked.
- No diagnosing, no mood tracking, no medical wording. Where feelings can be big (Feelings Detective, Strength Spotter's "not yet" answers, Values Compass), the closing line points to a trusted grown-up in a calm, non-alarming way, the same way the games already do.

## 3. The shared change (one build, three games)

The "own turn" is a new stage in `engine-scenario-choice.js`, driven by a small config in each game page (the way `selfCheck` is today), so it is written once:

- A **finale** of 3 steps shown once at the end of a run (not after every story), made of typed steps: `pickOne`, `pickMany(max)` and `rank(top N)`.
- A **result card** built on screen from the child's own picks (client side only), read aloud in the Discover game. This is the fix for "nothing changes whatever you answer": what the child picks decides what the closing card says.
- The old two-tap check after each story shrinks to **one quick tap** ("like me?"), so the run does not get longer. Stories per run drop by one to make room for the finale.
- Versions to bump when built: `engine-scenario-choice.js` (currently `?v=6`) and the three game pages; Feelings Detective also needs new recorded clips (see below).
- **Why this matters for the next step:** these are the only Self-Awareness games, and even when all three count there will be **one per band for Discover, Explore and Challenge and none for Advance**; the minimum is two. Because the finale is a config, a second Self-Awareness game per band can be a pure "own turn" game with a new stage engine already built (concepts in the audit, section G5: My Feelings Today, What Helps Me, Know Your Triggers, Know Yourself).

## 4. Outline 1: Feelings Detective (Discover, K-2)

**Today:** 12 scenarios, 4 per run. The child reads a character's situation, picks clues, picks the feelings that fit; then, after every story, "Has this happened to you?" (Yes / No / Not sure) and "Where would you feel it in your body?". Longest run in Discover (20 to 24 taps). The two checks are unscored and change nothing.

**New run (about 3 stories plus a finale):**

1. **Stories (3 per run, not 4).** Unchanged content. After each story only one tap: "Has this happened to you?" Yes / No / Not sure (voiced, as now).
2. **My turn, step 1: "How do you feel right now?"** The same eight feeling faces used in the game, tap one (or two). Includes "I'm not sure". Voiced.
3. **My turn, step 2: "Where do you feel it?"** A simple body picture (tummy, chest, face, hands, somewhere else), tap one. This is the existing body question, now about the feeling they just chose.
4. **My turn, step 3: "What helps?"** Four helpers: take slow breaths, tell a grown-up, move around, sit somewhere quiet. Tap one; the screen says more than one can help. This links feeling to action (and touches Self-Management lightly) without being the main skill.
5. **Result: "My feeling card".** One picture card built from the child's picks and read aloud in three short pieces ("I feel nervous. I feel it in my tummy. Slow breaths help me."). Closing line: "Only you see this card." Nothing is saved or shared.

**Age fit:** tap-only, no reading required, about 3 more taps than today's per-story checks but one story fewer, so the run is the same length or shorter.
**Content to write:** about 12 short lines (prompts, four helper lines, closing). **Audio:** the card needs short connector clips ("I feel", "I feel it in my", "helps me") plus the eight feeling words and five body words; the feeling and body words largely exist already. Clips are made with `server/scripts/build-discover-audio.js --audio` on your Mac (Ava), and the build stays an owner ear-test item.
**Self-Awareness test:** the child names their own current feeling, locates it in their body and links it to a helping action: identifying feelings, one of the owner's key skills.

## 5. Outline 2: Strength Spotter (Explore, grades 3-5)

**Today:** 12 stories, 5 per run. The child ticks the behaviours in a story and the strengths it shows (about other characters), then a two-tap private check after every story ("Do you use a strength like this?", "Where do you use it?").

**New run (4 stories plus a finale):**

1. **Stories (4 per run, not 5).** Unchanged content. After each story one tap: "Is this strength like you?" Yes / A little / Not yet. ("Not yet" is the growth answer; there is no wrong tap.)
2. **My turn, step 1: "Pick up to two strengths you use."** From the strengths that appeared in the game (about 10: patience, persistence, kindness, courage, curiosity, responsibility, listening, creativity, leadership, humour). "Not sure yet" is always there.
3. **My turn, step 2: "Where have you used it lately?"** School, home, with friends, in a hobby or sport, somewhere else, not sure.
4. **My turn, step 3: "Pick one small way to grow it."** Three short options written for that strength (for example for patience: count to five before answering; ask for one more minute; take a breath first). The child picks one. This is what makes the step more than a tick-box: the options depend on the strength they chose.
5. **Result: "My strength card."** On screen: "My strength: patience. I use it at home. This week I will count to five before answering." Closing: "Everyone has strengths, and they can grow. Only you see this card."

**Age fit:** about 6 taps in the finale; reading load stays at the Explore limits already enforced by `explore-games.test.js` (options 12 words, feedback 2 sentences and 18 words).
**Content to write:** about 10 strengths x 3 small-step options = about 30 short lines, written with balanced lengths and no "best" option (all three are fine). This is the one outline that needs a meaningful amount of new SEL wording, so I would write it as a separate review document for you.
**Self-Awareness test:** recognising your own strengths and picking a way to grow one: accurate self-perception and self-efficacy.

## 6. Outline 3: Values Compass (Challenge, grades 6-8)

**Today:** 12 stories, a pool drawn per run. The child reads what a character does and ticks the values behind it (about other people), then a generic private check ("Does this matter to you?", "Where does it show up in your life?"). It also carried a Responsible Decision-Making tag that the audit found unearned (removed in Release 137).

**New run (stories plus a finale):**

1. **Stories (one fewer per run).** Unchanged content. After each story one tap: "Does this value matter to you?" Yes / A little / Not sure.
2. **My turn, step 1: "Pick the three values that matter most to you right now."** From the values that appeared in the run (about 8 to 10), tap three in order. "Right now" is deliberate: values change.
3. **My turn, step 2: "When two of your values collide."** A short tradeoff scenario that pits two values the child just chose (for example honesty and loyalty: a friend asks you to cover for them). The child picks which they would protect, with "it depends" always allowed. No right answer, and the feedback only describes the cost of each choice. Six prepared scenarios cover the value pairs; the game picks the one that overlaps the child's top three most, and falls back to a default.
4. **My turn, step 3: "Where did you act on your top value this week?"** School, home, online, with friends, not yet, not sure.
5. **Result: "My compass."** On screen: the child's top three, and a line such as "When honesty and loyalty pulled apart, you leaned toward honesty. Values can change as you grow." Closing: "Only you see this."

**Age fit:** grade 6 to 8 vocabulary; the finale is about 6 taps. The tradeoff step is the thinking piece and is why this version is Self-Awareness (values and how they influence behaviour) rather than the old label-the-character task.
**Content to write:** 6 tradeoff scenarios (short, school and friend situations, no real people or brands) plus about 10 lines of prompts and closings; I would write these as a separate review document for you.
**Self-Awareness test:** identifying your own values, seeing how they pull against each other, and noticing when you act on them.

## 7. What changes in the tables when these ship

- The three games lose `pending` in `server/lib/brain-game-focus.js` and start counting: Self-Awareness becomes Discover 1, Explore 1, Challenge 1, Advance 0.
- Tests added: the finale never logs which option was picked (the same kind of source check the existing self-check has); the card is built only from the picks; stories per run and the step order; word limits (Discover and Explore tests already exist); no free-text field.
- Release notes, the video check (Feelings Detective is played in help video S2) and the usual deploy steps. Feelings Detective also needs a clip build and an owner ear test.

## 8. Decisions I need from you

1. **Finale once per run, shorter story count (recommended), or keep the per-story check as is and add the finale on top?** Recommended keeps run length in line with today (Feelings Detective is already the longest Discover game).
2. **Feelings Detective: one feeling or up to two?** (Recommended: up to two; children often feel two things.)
3. **Strength Spotter: are growth steps ("count to five before answering") the right tone,** or should the third step be only "where you use it" with no suggestion? The steps are what make the step more than a tick-box, but they are advice to a child, so they need your read.
4. **Values Compass: rank the top three, or pick just one?** (Recommended: top three, then one tradeoff.)
5. **Result cards:** screen only (recommended, nothing to save or print), or also a printable version a teacher could use in class? A printable card would mean the child's picks leave the screen, which breaks the current privacy rule, so I recommend against it.
6. **Order:** one release with all three, or Feelings Detective first (it needs recordings and your ear test, so it will take longest)? Recommended: Strength Spotter and Values Compass together, Feelings Detective in its own release.
7. **Second Self-Awareness game per band:** queue these next, built on the same finale? (Recommended: yes, after these three ship.)

## 9. How I will proceed once you approve

For each approved outline: write the wording in a review document (held uncommitted), add the engine stage and tests, play it in a browser, then bring the wording back for your read. Nothing deploys before you have read the text.
