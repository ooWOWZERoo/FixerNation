# Brain game scorecard (DRAFT; every verdict needs the owner's confirmation)

Phase 2 of `GAME_REVERIFICATION_PLAN.md`. Written 2026-10-31 by Claude from reading each game's content, the audit (`node server/scripts/audit-brain-games.js`) and New York's verified frameworks (`server/data/standards/NY.json`). **Claude drafts; the owner reviews and signs off all SEL content.** Nothing here has been entered into the database or the crosswalk. No game has a New York alignment yet (the NY data holds 35 alignments, all to lessons).

Reference points used:
- **NY SEL Benchmarks:** 1A emotions and actions · 1B identity · 1C goals, learn from mistakes · 2A empathy · 2B similarities and differences · 2C communicate across differences · 2D conflict · 3A safety, well-being, context in decisions · 3B decision-making skills · 3C act for school and community well-being.
- **NY Portrait of a Graduate:** AP Academically Prepared · CI Creative Innovator · CT Critical Thinker · EC Effective Communicator · GC Global Citizen · RF Reflective and Future Focused.
- **Grades:** the master plan already fixes the bands (`MASTER_PLAN.md` section 6.3): Discover K-2, Explore 3-5, Challenge 6-8, Advance 9-12. That settles the grade-level question without a new field; per-game labels below narrow it where the content warrants.
- **Depth checklist** (from the plan): (a) 8+ decisions or 8-10 minutes; (b) each decision changes something visible; (c) a wrong choice teaches; (d) vocabulary one notch above the band; (e) a private closing reflection.

## Wave 1: Discover (K-2), five games

| Game | 1 Complete | 2 Relevant (NY) | 3 Levelled | 4 Deep | 5 Replayable | Draft verdict |
|---|---|---|---|---|---|---|
| Calm Down Corner | Fails: browser voice | Pass: SEL 1A direct; PoG RF supporting | K-2 fits | Fails (a)(b)(c)(e) | Fails: 4 fixed rounds | **Deepen** |
| Sharing Circle | Fails: browser voice | Pass: SEL 2A direct, 3C supporting; PoG GC supporting | K-2 fits | Fails (a)(b)(c)(e) | Fails | **Deepen** |
| Helper's Choice | Fails: browser voice | Pass: SEL 3A and 1C direct, 3B supporting; PoG GC direct, RF supporting | K-2 fits | Fails (a)(b)(c)(e) | Fails | **Deepen** |
| Feelings Detective | Fails: browser voice | Now matches: reading others' feelings is SEL 2A (direct) and the new private self-check practises the child's own (SEL 1A direct); PoG EC and RF supporting | Grades 1-2 | Passes (c) and now (e); fails (a) | Fails | **Deepen** (self-check added 2026-10-31, wording awaiting your review) |
| Sound Safari | **Fails: voice cannot say the sound** | No SEL link; PoG AP only | K-1 | Fails | Fails | **Deepen; owner decision on the SEL rule** |

### What is true across all five (and probably the whole catalog)

1. **Every game is 4 rounds, about 1 to 2 minutes.** Depth test (a) fails everywhere in this band.
2. **Feedback never teaches.** The audio-choice engine says "Correct!" or "Not quite, take another look" for every round, so a wrong answer explains nothing. The scenario engines already carry per-choice feedback; audio choice does not support it. A small engine addition (optional `feedback` on each choice, shown after the answer) would fix test 4(b) and (c) for four of these five games. I recommend it as the first Phase 3 change.
3. **The wrong answers are caricatures** (yell, kick, laugh, hide, blame, point and whisper). A five-year-old can pick the right one from the picture alone, so the game measures little. Better distractors are plausible but incomplete choices, as the older scenario games already use (`plausible_incomplete`).
4. **No game closes with a private reflection** (test 4e), which Branching Scenario already supports.
5. **Narration is the visitor's browser voice**, so test 1 fails for all five until the Ava (Premium) audio is rendered (decision 7 in the plan).

### Calm Down Corner (`calm-down-corner`, self-management)
- **Content:** four situations (tower falls, puzzle piece, someone took your swing turn, spilled juice), always the question "Which one would help you feel calm?". Choices are emoji, with a spoken label. One right answer each: slow breaths, count to five, ask a grown-up, take a break.
- **Relevance:** it links an emotion to a regulating action, which is NY 1A. Self-regulation is also the heart of CASEL self-management; NY has no separate self-management benchmark beyond 1C. PoG: Reflective and Future Focused, as supporting only.
- **Problems:** the angry-face emoji gives away the wrong answer, so a child can pass without listening. Only one strategy is ever right, so it teaches four separate answers rather than a toolkit of options. It never asks the child to name the feeling first.
- **Fix (Phase 3):** pool of 12 or more situations, multiple valid strategies per round (several correct picks), a "what are you feeling?" first step, a one-line explanation per choice, a closing "which one would you try?" reflection.

### Sharing Circle (`sharing-circle`, kindness)
- **Content:** four scenes (a classmate crying over a lost toy, a new kid watching alone, a friend trips and others laugh, a scared little brother), always "What is a kind thing to do?".
- **Relevance:** empathy and acting on it is NY 2A (direct) and 3C (supporting); PoG Global Citizen (supporting).
- **Problems:** it never asks how the other person feels, so the empathy step (the point of 2A) is skipped. Kindness is a single action with no result shown. Nothing touches 2B (similarities and differences), though the "new kid" scene could. The one realistic wrong answer ("tell him to stop being scared") is the best item in the game; the rest are cartoon wrong answers.
- **Fix:** add a "how does she feel?" step before the choice, show what happens next, mix in subtler wrong answers, and widen the pool.

### Helper's Choice (`helpers-choice`, responsibility)
- **Content:** four situations about honesty and follow-through (a found dollar, spilled paint, a promised chore, a friend asking you to say a false thing).
- **Relevance:** the strongest NY fit of the three: owning a mistake (1C), weighing impact on others (3A), making a decision (3B). PoG Global Citizen (acts responsibly and ethically) is a direct match; Reflective supporting.
- **Problems:** "give it to the teacher" is presented as the only right way to handle a found dollar, and children may also have good reasons to ask whose it is first. The friend-pressure scene is the richest one but gets the same one-tap treatment. Same caricature wrong answers.
- **Fix:** allow more than one defensible response where the topic permits it, give the friend-pressure scene a short follow-up ("your friend is upset, now what?"), widen the pool.

### Feelings Detective (`feelings-detective`, catalog label: Self-awareness)
- **Content:** four stories about other children (Maya, Sam, Jordan, Priya). Step one: notice which cues are really there. Step two: pick every feeling that could fit; two are always plausible and one is a poor fit, with a gentle redirect. Never scored right or wrong. Two stories add a "tell a trusted grown-up" step.
- **Why it is the best-designed of the five:** it asks for evidence before a feeling, accepts more than one answer, and does not diagnose. It passes test 4(c).
- **The mismatch:** the catalog and the roadmap say this game supplies the first Self-awareness (CASEL) coverage, but the child is never asked about their own feelings; every story is about someone else. What it trains is reading other people's emotions, which is Social awareness (NY 2A) with emotion vocabulary as support (1A). This is a tagging error that matters, because the SEL coverage claim ("every CASEL competency now has a game") rests on it.
- **Decided 2026-10-31: option B, built.** After each story the child gets a private check-in ("Has something like this ever happened to you?" Yes / No / Not sure, then "If you felt this way, where in your body would you notice it?"), then a short closing line. Answers are never logged, sent or saved (only that the step was reached), and there are no free-text boxes for K-2 children. Tested: a full browser playthrough with the page's network calls captured showed 32 learning events and none containing an answer. **The wording is yours to approve** (it is the SEL content you review). Original options: (A) retag it Social awareness and treat Self-awareness as uncovered in Discover; or (B) keep the tag and add a private "has something like this happened to you? how did your body feel?" step, never saved (the reflection pattern already exists). I recommend B, because it keeps the game's strength and makes the claim true.
- **Other problems:** the "poor fit" feeling is always obviously opposite to the cues (excited vs slumped shoulders), and there are only four stories.

### Sound Safari (`sound-safari`, phonemic awareness)
- **Content:** four initial-sound rounds (/m/ monkey, /s/ snake, /t/ turtle, /b/ butterfly), three emoji pictures each.
- **Blocking defect:** the narration text read by the browser voice is `Listen: the /m/ sound, like in "moon."`. A text-to-speech voice is likely to read the slashes or say the letter name ("em") rather than the sound /m/; I cannot listen to what each browser actually says, so this needs a quick ear test by you on a school Chromebook and an iPad. Phonemic awareness needs the real isolated sound. Switching to Ava (Premium) does not fix this by itself. Apple's voices accept phoneme markup that may produce a clean /m/, which I would test first (you would need to listen); if it sounds wrong, a human recording of the isolated sounds is needed. The ElevenLabs route had the same risk.
- **Relevance:** this is a literacy skill, not SEL. The only honest New York mapping is PoG Academically Prepared (supporting). I cannot map it to a SEL benchmark without stretching.
- **Decision for you:** the rule you set is that every game maps to SEL or PoG. Is "Academically Prepared, supporting" enough for a literacy game, or should it be labelled "skills practice" and shown apart from the SEL list?
- **Fix:** test phoneme-accurate audio first; pool of at least 16 sounds with picture choices that avoid look-alike words; start with isolated sounds before words.

## Decisions I need for this wave

1. ~~Feelings Detective: retag or add a self-reflection step?~~ **Settled: B, built; please review the wording** (in `brain-feelings-detective.html`, `selfCheck`).
2. ~~Sound Safari~~ **Decided 2026-10-31: keep as a reading-skills game.** It stays in the catalog under the Literacy domain with its loose New York link (PoG Academically Prepared, supporting) and is not counted as an SEL game. The audio blocker (the isolated /m/ sound) and the pool expansion still stand.
3. ~~Mappings~~ **Accepted by the owner 2026-10-31** (all five Discover rows, as drafted). They are still not entered in the crosswalk: that needs the normal verify step on `admin-standards.html`, done when you want them public.
4. ~~Audio-choice engine feedback~~ **Approved and built 2026-10-31** (`engine-audio-choice.js`): optional `feedback` on each choice and `explanation` on each round replace the generic "Correct!"/"Not quite", are read aloud for audio rounds, and stay on screen longer. No game uses it yet; writing the lines is Phase 3 content, for you to review.
5. **Next wave:** Explore (Choice Quest, Team Pick, Reading Detective), then Challenge, then Advance, then the legacy six.

## Wave 2: Explore (grades 3-5), three games

| Game | 1 Complete | 2 Relevant (NY) | 3 Levelled | 4 Deep | 5 Replayable | Draft verdict |
|---|---|---|---|---|---|---|
| Choice Quest | Passes (text, no audio dependency) | Pass: SEL 3B and 2A direct, 2D supporting; PoG CT and EC supporting | Grades 3-5 fits | Best in the catalog: passes (b)(c)(e); fails (a) | Fails: one story | **Deepen (more stories): 3 new stories written, awaiting review** |
| Team Pick | Passes | Pass: SEL 1A direct, 2C and 2D supporting; PoG RF direct | Grades 3-5 fits | Passes (b)(c)(e); fails (a) | Fails: one story | **Deepen (more stories): 3 new stories written, awaiting review** |
| Reading Detective | Passes | PoG CT direct (it practises citing evidence); no SEL link beyond one item | Reads easier than Grades 3-5 (my judgement, not measured) | Fails (a)(b); passes (c) in part | Fails | **Deepen (harder passages, better wrong answers)** |

### A finding that shuffling does not fix: the right answer is usually the longest
I measured it. In the six scenario games (Choice Quest, Team Pick, Decision Point, Group Chat Meltdown, First Shift, The Post) the "responsible" choice is the longest or tied-longest option in **18 of 24** decision steps. In the three evidence games (Reading Detective, Headline, Critical Read) the correct answer is the longest option in **12 of 12** rounds. A child, or a quick reader, can pass by choosing the longest line. Phase 1 stopped the first-slot shortcut; this is the next one. The fix is in the writing, not the engine: wrong answers need the same length and detail as right ones, and some right answers should be short. I would make "balance the lengths" a rule when the pools are written, and add a check to the audit script so it can never come back unnoticed.

### Choice Quest (`choice-quest`, empathy and responsible decisions)
- **Content:** one story. A teammate, Mia, has not finished her part of a class diorama due tomorrow. Five steps in the Issues-to-Answers cycle: recognise, understand the impact, consider options, choose, reflect. Every choice has its own feedback that explains the effect, there are two defensible best moves at the final step, a "tell a trusted adult" option, and a private closing reflection.
- **Strengths:** the strongest teaching design in the catalog. Wrong answers are explained ("a guess, find out first"), not just marked. It is the model the Discover games should grow toward.
- **Relevance:** NY 3B (use decision-making skills to shape outcomes) and 2A (empathy: Mia may be stuck) direct; 2D (resolving conflict) supporting. PoG: Critical Thinker (weighs evidence before judging Mia) and Effective Communicator (the private check-in), both supporting.
- **Problems:** a single story, so a second run is identical. Steps 1 to 3 offer two choices, and the wrong one is a strawman ("Mia is just lazy"), so the right one is guessable by tone and length. Only the final step has real alternatives.
- **Fix:** three or four more stories using the `variants` support from Phase 1 (for example a friend left out of a game, a shared item broken, a rumour starting); give steps 1 to 3 three options each with a plausible wrong one.

### Team Pick (`team-pick`, self-management)
- **Content:** one story. In gym class your two best friends pick teams and you are chosen last. Same five-step cycle, with per-choice feedback and a private reflection ("what helps you calm down?").
- **Relevance:** naming the feeling and choosing a response is NY 1A (direct); telling friends calmly without blame is 2C and 2D (supporting). PoG Reflective and Future Focused (reflects, keeps supportive relationships, makes responsible decisions) is a direct fit.
- **Sensitivity (your call as SEL reviewer):** being picked last is a real experience for some children. The game handles it gently and offers a trusted-adult step, but this is the kind of story you should read once as the adult responsible for it.
- **Problems:** one story; the "unsafe" choice ("never playing with them again") is melodramatic and the best answers are the longest.
- **Fix:** more stories, a more believable wrong answer, balanced lengths.

### Reading Detective (`reading-detective`, reading comprehension)
- **Content:** four three-sentence passages (a lost lunchbox, a new student, chalk footprints, a picnic and clouds). The child picks an answer, then the sentence that proves it.
- **Relevance:** the "show me where it says that" step is the Critical Thinker quality in New York's Portrait (analyzes information, weighs evidence), a direct fit, so it satisfies your every-game rule without any SEL stretch. One passage (Jordan, the new student) is a real social-emotional inference.
- **Problems:** the passages are short and the sentences simple; they read closer to grade 2-3 than 3-5 (my judgement; I have not run a readability measure). Wrong answers are often silly ("School will be canceled", "chalk drawings are always messy"), so a child can eliminate them without reading. The correct answer is the longest in all four rounds.
- **Fix:** longer passages (five to eight sentences) with some inference that needs two sentences, plausible wrong answers, a pool of 12 or more, and a measured reading level before each passage ships.

### Decisions for this wave
1. **Choice Quest and Team Pick:** may I draft three new stories for each (title and outline first, full text only after you approve the outline)?
2. **Team Pick sensitivity:** are you comfortable with the "picked last" story as written?
3. **Length balance:** may I add the length check to the audit script and make "balance the lengths" a standing rule for all new content?
4. **Mappings for this wave:** accept as drafted?
