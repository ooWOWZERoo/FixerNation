# Games audit: grade band x focus (DRAFT for the owner)

Written 2026-11-06 by Claude. **Nothing is built, changed or committed.** This is a read-only audit of the 31 Tune Your Brain games, done from the code (not from the labels), plus a gap list and game ideas. Dev machine has no database copy, so tags come from the seed scripts and page code; production should match (the catalog scripts were run, per the release notes) but I have not checked production.

**How strict I was:** a game counts toward a focus only if what the player actually does trains that focus. Each game gets one of three verdicts:

- **FIT**: the tag matches the real goal.
- **PARTIAL**: related, but the game mainly trains something else. Not counted in the strict grid.
- **MISMATCH**: the tag is wrong. Not counted.

Each game was read in full by a sub-audit (one per grade band), and I re-read the code behind every disputed call (Number Sequence, Reaction Time, Group Chat Meltdown, Quick Math, Feelings Detective).

**Owner decision (2026-11-06): "focus" means the five domains** (Literacy, Math, Thinking Skills, SEL & Character, Wellness & Life Skills). Sections D1 and E1/E2 are therefore the working grid and gap list. D2 and E3 (the CASEL competency view) are kept as reference only; question 1 in section F is answered.

## Short answer

- **SEL & Character is covered everywhere** (3 to 5 solid games in every band), even after mismatches are removed.
- **Every other focus is thin.** With strict counting, 11 combinations are below two games even before Wellness, and Wellness & Life Skills has **no game in any band** (4 more combinations). That is 15 of the 20 combinations in the grid, and about **24 games** missing in total (16 if Wellness is dropped).
- **Three tags are wrong at the focus level** (Number Sequence, Idea Lab, Fix-It Workshop). **Four more are only partial** (Money Moves, Money Matters, Values Compass, Reaction Time). **Several CASEL competency tags are wrong or unearned**, notably Feelings Detective and The Post.
- The grade bands are defined in one place only by convention (see section A). The focus list is defined in one place, but "focus" could also mean the finer SEL competency; I give both views.

---

## A. Definitions: grade bands and focus types

### Grade bands (four)

Defined in several places that agree with each other; there is no single constants file.

| Band | Grades | Where defined |
|---|---|---|
| Discover | K-2 | `brain-games.html:131` `var BAND_GRADES = { discover: 'K-2', explore: '3-5', challenge: '6-8', advance: '9-12' };` |
| Explore | 3-5 | same line |
| Challenge | 6-8 | same line |
| Advance | 9-12 | same line |

Other places that define them:
- `server/db/schema.sql:1072`: `band ENUM('discover','explore','challenge','advance') NULL` on `brain_games`.
- `docs/tune-your-brain/MASTER_PLAN.md` section 6.3: "Default grades" K-2, 3-5, 6-8, 9-12, and "Grade bands are defaults, not ability labels."
- `teacher-classroom.html:757` `GRADE_TO_BAND` maps classroom grade (Pre-K to College) to a band; the assign-game list hides other bands unless "Show games for all grade bands" is ticked.
- `docs/tune-your-brain/GAME_LANGUAGE_COLOR_AUDIT.md` notes the owner's earlier brief used ages (5-6, 7-10, 11-13, 14-18) which do not line up with K-2 and 3-5. The site shows grades.
- The page default for a game is the `band = params.get('band') || 'X'` line in each `brain-*.html`; it agrees with the catalog tag for all 25 engine games. `?band=` only changes wording, never content, so **every game belongs to exactly one band** (a game cannot count for two).
- The six older games had no band until Release 89. `server/lib/brain-game-copy.js` `LEGACY_BANDS` now gives them one: Memory Match and Simon Sequence = explore; Number Sequence, Quick Math, Reaction Time, Stroop = challenge. This is a label for the tag and filter only; their difficulty is not written for those grades.

### Focus types (five)

The games page has two filters, labelled "Grade band" and "**Focus**" (`brain-games.html:87-93`). "Focus" is the `domain` column:

| Value | Label on the page | Where defined |
|---|---|---|
| `literacy` | Literacy | `server/db/schema.sql:1073` `domain ENUM('literacy','math','executive','sel','wellness') NULL` |
| `math` | Math | `brain-games.html:127` `DOMAIN_LABELS = { literacy: 'Literacy', math: 'Math', executive: 'Thinking Skills', sel: 'SEL & Character', wellness: 'Wellness & Life Skills' }` |
| `executive` | Thinking Skills | same line; master plan 6.1 calls it "Thinking & Executive Skills" |
| `sel` | SEL & Character | same line |
| `wellness` | Wellness & Life Skills | same line |

`MASTER_PLAN.md` section 6.1 lists the same five ("Literacy & Communication, Math & Applied Numeracy, Thinking & Executive Skills, SEL & Character, Wellness & Life Skills").

**There is no definition of what belongs in Wellness & Life Skills** beyond the name, and no creativity value exists in the list (Idea Lab and Fix-It Workshop are creative problem-solving games with nowhere honest to sit).

### A finer SEL focus (also in the code)

SEL games carry a second tag, `casel_competencies` (schema.sql:1074, a SET of `self_awareness`, `self_management`, `social_awareness`, `relationship_skills`, `responsible_decision_making`). The earlier docs also map games to New York SEL benchmarks (1A to 3C) and Portrait of a Graduate attributes (`docs/tune-your-brain/SEL_POG_COVERAGE.md`, generated by `server/scripts/sel-pog-coverage.js`). The owner's wording ("specific SEL focus") may mean these. The main grid below uses the five domains (what the page calls Focus); section D2 adds a CASEL view of SEL.

---

## B. Full game inventory (31 games)

Tags are from `server/scripts/seed-<slug>-catalog-entry.js` (CASEL for Choice Quest, Decision Point, Money Matters and Money Moves from `seed-brain-games-domain-values.js`; legacy six from `alter-brain-games.js`, `seed-brain-games-domain-values.js` and `lib/brain-game-copy.js`). Every game's file is `brain-<slug>.html` in the repo root. "Run" = what one play shows.

**Verdict column = focus (domain) verdict.** CASEL notes are in the last column; CASEL problems are collected in section C2.

### Discover (K-2): 6 games, all audio-led

| Game | Tagged focus / CASEL | Engine, content, run | What the player really does | Verdict | Notes |
|---|---|---|---|---|---|
| Calm Down Corner | sel / self_management | audio-choice; 18 rounds, 5 per run | Hears a situation that names a feeling, taps one of 3 ways to calm down. 13 of 18 right answers are real regulation strategies (breathing, counting, quiet corner); 4 are ask-for-help | **FIT** | Knowledge of strategies, not practice. Passable by avoiding the aggressive options |
| Sharing Circle | sel / social_awareness, relationship_skills | audio-choice; 18 rounds, 5 | "What is kind?" Hears what happened, taps the kind act; wrong options are openly unkind | **FIT** | Social awareness fits. relationship_skills is only supporting (single acts of kindness, no communication) |
| Helper's Choice | sel / responsible_decision_making | audio-choice; 18 rounds, 5 | Hears a situation, taps the right thing to do; about half the answers are "tell the teacher or the truth" | **FIT** | Rule-recall at K-2 level, which is age-appropriate |
| Feelings Detective | sel / self_awareness | scenario-choice (not scored); 12 scenarios, 4 per run | Reads a character's situation, picks the clues, then picks every feeling that fits. After each story an unscored private check asks "Where would you feel it in your body?" | **FIT** (domain) | **CASEL MISMATCH**: the main task is reading *a character's* feelings (social awareness). Only the 2-tap private check is about the child's own feelings. Longest run (20-24 taps) |
| Same and Different | sel / social_awareness | audio-choice; 24 rounds, 5 per run | Hears about two children, taps what is the same, what is different, or the kind way to play together. 16 of 24 rounds are real same/different comparison; 8 are "kind choice" | **FIT** | Header comment in the file is stale (says 12 rounds, 4 per run) |
| Sound Safari | literacy | audio-choice; 77 rounds, 6 per run | Hears a sound, taps the picture that starts with it. Ear only (pictures carry no text); 19 consonant sounds, no vowels | **FIT** | Phonemic awareness. Phonics needs a human recording for the owner's ear-test; vowels not covered |

### Explore (3-5): 8 games

| Game | Tagged focus / CASEL | Engine, content, run | What the player really does | Verdict | Notes |
|---|---|---|---|---|---|
| Choice Quest | sel / social_awareness, relationship_skills, responsible_decision_making | branching scenario; 4 stories, 1 per run, 5 steps | Walks a peer problem: what is happening, who it affects, what could you do, choose, reflect (private) | **FIT** | RDM is direct (whole structure). Social awareness is one step of five; relationship skills supporting. Won by picking the "kind, ask first" option |
| Team Pick | sel / self_management, relationship_skills | branching scenario; 4 stories, 1 per run | Every story starts with a feeling (picked last, missed catch, low spelling score, lost the lead); picks "notice the feeling, breathe, then speak" over "storm off" | **FIT** | Regulation strategies are the content, but the player only chooses what a character does. "Notice you feel X" is step 1 in all 4 stories, so it can be won by pattern |
| Fix-It Workshop | sel / responsible_decision_making, social_awareness | branching scenario; 4 problems, 1 per run | Runs a school-problem design cycle: spot, hear from people, think of fixes, pick one to try, reflect. Step 3 has three options, **all** acceptable (no wrong answer) | **MISMATCH** | It is design thinking (its own file header says it practises Creative Innovator). RDM only shows in step 4 (small test with permission). Social awareness is weak: the facts are handed to the player. Better home: creative problem-solving |
| Strength Spotter | sel / self_awareness | scenario-choice; 12 stories, 5 per run | Reads a short story, ticks the behaviours present, ticks the strengths shown, then answers a private "Do you use a strength like this?" | **FIT** (domain) | **CASEL partial**: the scored work is spotting strengths in *other* characters; the own-strengths check is two unscored taps. Best self-awareness fit in the band, but loose |
| Peace Table | sel / relationship_skills, social_awareness | branching scenario; 4 conflicts, 1 per run | You are one of two kids in a disagreement: say it with an I-message, see the other side, find a fair plan, choose | **FIT** | Best match of any SEL game to its tags (conflict resolution; step 2 is explicit perspective-taking). Tone words ("always", "greedy") give the wrong answers away |
| Reading Detective | literacy | evidence-hunt; **4 items**, all shown every run | Reads a 3-sentence passage, picks 1 of 3 answers, taps the sentence that proves it | **FIT** (thin) | Correct answer is the longest in 4 of 4 items; passages are about grade 1-3 reading level; distractors are absurd. The thinnest game in the band |
| Memory Match | executive | self-contained (no engine) | Concentration: flip cards, find pairs. 8, 10 or 15 pairs by difficulty | **FIT** | Visuospatial memory more than working memory; can be finished by flipping systematically. Difficulty spans K-adult, "Explore" is a label |
| Simon Sequence | executive | self-contained | Repeat a growing colour sequence; one mistake ends the run | **FIT** | Forward span memory. Not Explore-specific (works K-adult). Colour-only squares, no sound |

### Challenge (6-8): 10 games

| Game | Tagged focus / CASEL | Engine, content, run | What the player really does | Verdict | Notes |
|---|---|---|---|---|---|
| Decision Point | sel / social_awareness, relationship_skills, responsible_decision_making | branching scenario; **1 fixed scenario**, 5 steps | A classmate is being left out: notice, who it affects, options, choose, reflect | **FIT** | RDM direct; the other two supporting. No content pool (same run every time) |
| Group Chat Meltdown | sel / self_management, responsible_decision_making | branching scenario; **1 fixed scenario** | The chat turned on you. Notice your embarrassment and urge to reply, "put your phone down for a few minutes", then choose a reply | **FIT** | The best self-management content in the catalog (steps 1-3 are about noticing the urge and pausing). Recognition only; the step-4 keyed answer is "message one friend", not the pause. No pool |
| Say It Another Way | sel / relationship_skills, social_awareness | evidence-hunt; 12 situations, 6 per run | Reads a situation and 4 drafts of a message, picks the one this person would hear best, then taps the phrase that shows why | **FIT** | First game that practises *how to say* something. Recognition only; distractor types are learnable |
| Money Moves | sel / self_management, responsible_decision_making | simulation; 14 events, 6 per run | Saves toward a goal while keeping spending money; arithmetic is printed in about half the prompts | **PARTIAL** | A budgeting game. Self-management is goal planning, not impulse control. Only 65% of draws can reach the goal. Moved from `wellness` to `sel` by the owner 2026-11-01 |
| Values Compass | sel / self_awareness, responsible_decision_making | scenario-choice; 12 stories | Reads what a character does, ticks the values behind it, then a generic unscored check about the child's own values | **PARTIAL** | About 95% of play is labelling a character's values. "Own values" is two unscored taps. RDM: the characters decide, the player only labels. One "less fitting" value per story is plainly negative, so ticking the nicer words passes |
| Headline | literacy | evidence-hunt; 12 items, 6 per run | Reads a short story, picks the most accurate headline, taps the proof | **FIT** | Media literacy. 8 of 12 items lean on percent arithmetic |
| Number Sequence | **executive** | self-contained | Finds the missing number in a pattern; 3 of 5 pattern types print the rule ("+5 each step") | **MISMATCH** | It is pattern arithmetic: **math**. Nothing trains inhibition, working memory or switching. **Bug**: the "quadratic" type adds a fresh random 1-5 to every term, so the answer cannot be worked out (about a 1-in-5 guess on a timer) |
| Quick Math | math | self-contained | Arithmetic against a 60 or 90 s clock; + - x / with numbers up to 99 and 12 x 12 | **FIT** (focus) | Content is grade 3-5 level (no fractions, decimals, negatives, ratios), so it is thin for grades 6-8 |
| Reaction Time | executive | self-contained | Wait for green, tap; 5 rounds, average. Tapping early is a "false start" | **PARTIAL** | Simple reaction time (processing speed and motor). The only inhibition is not tapping during a 0.7-4 s wait; no no-go stimulus or decoy |
| Stroop Challenge | executive | self-contained | Name the ink colour, ignoring the word | **FIT** | Classic inhibition task. "Hard" only adds 15 s; colour-only (colour-blind unfriendly) |

### Advance (9-12): 7 games

| Game | Tagged focus / CASEL | Engine, content, run | What the player really does | Verdict | Notes |
|---|---|---|---|---|---|
| First Shift | sel / responsible_decision_making, relationship_skills | branching scenario; 4 stories, 1 per run | First-job ethics: a coworker asks you to lie, double-booked shift, rude customer, cash pay with no paperwork | **FIT** | RDM direct. Relationship skills only supporting; story 4 (cash pay) has none |
| The Post | sel / social_awareness, relationship_skills, self_management | branching scenario; 4 stories | Digital citizenship: rumor meme, AI-written teammate work, phishing giveaway, embarrassing tag | **FIT** (domain) | **CASEL MISMATCH**: nothing trains self-management; the competency it trains most (RDM) is not tagged. Story 3 is a phishing quiz |
| Money Matters | sel / self_management, responsible_decision_making | simulation; 14 events, 7 per run | First-budget simulation: savings, checking, card debt, interest; dollar effects are spelled out in the prompts | **PARTIAL** | A financial-literacy simulation. No temptation or impulse is tested. **43% of possible draws cannot reach the goal by any path** |
| Perspective Swap | sel / social_awareness, relationship_skills | branching scenario; 4 stories | Two steps are literally "what do you notice from her side / their side" (holiday clash, a quiet teammate's culture, cost, a hard-of-hearing teammate), then a fair plan | **FIT** | Cleanest social-awareness fit in Advance. Blame words give the wrong answers away |
| Community Voice | sel / responsible_decision_making, relationship_skills | branching scenario; 4 stories | Civic advocacy: ask who is affected, get numbers, shape a specific ask, handle a "no" | **FIT** | Civic communication; RDM ("contributing to community") and relationship skills both lean direct |
| Idea Lab | sel / responsible_decision_making, relationship_skills | branching scenario; 4 stories | Design thinking: find the real need, research, compare three equally acceptable directions, run a small trial | **MISMATCH** | Creative problem-solving, no SEL competency specifically. The file header says it practises Creative Innovator. Step 3 is unscored. relationship_skills not earned |
| Critical Read | literacy | evidence-hunt; 12 items, 6 per run | Judges what a source and its design can support, then taps the sentence that proves it | **FIT** | The only Advance game with real scoring. Step 1 can be passed by avoiding the "too strong" and "worthless" extremes |

### Things that apply to most story games (all branching-scenario games)

- Each game has 4 whole stories and the player sees **one** per run (Decision Point and Group Chat Meltdown have one only).
- Everything except an `unsafe` option shows as green "correct" feedback with an explanation; there is almost no scoring. A player who picks "the calm, ask-first, kind" option wins every round without needing the tagged skill. This is a content-design trait, not a tag error, but it limits how "specifically" any of these trains its focus.
- The audit script (`node server/scripts/audit-brain-games.js`) separately reports that the best answer is the longest option in 17 of 18 rounds of Calm Down Corner and Helper's Choice, 18 of 18 in Sharing Circle and 22 of 24 in Same and Different. The Discover audio games are read aloud to non-readers, so length is not visible to the child, but the content has not been rebalanced.

---

## C. Mismatches and partial fits

### C1. Focus (domain) tags

| Game | Today | Problem (one line) | What it really fits |
|---|---|---|---|
| Number Sequence | executive (Challenge) | Pattern arithmetic with rules printed on screen; trains no executive skill | **math** (also has an unsolvable "quadratic" bug) |
| Idea Lab | sel (Advance) | Design-thinking process; no SEL competency is the main skill; step 3 has no wrong answer | Creative problem-solving. No domain value exists for it |
| Fix-It Workshop | sel (Explore) | Same structure as Idea Lab; RDM appears in one step of five | Creative problem-solving |
| Money Moves | sel (Challenge) | Budgeting and percentages, not impulse control | Financial literacy: `wellness` (its original tag, and the master plan puts financial under Wellness & Life Skills) or `math`. Owner chose `sel` on 2026-11-01 |
| Money Matters | sel (Advance) | Financial-literacy simulation with the arithmetic printed in the prompt | Same as above |
| Values Compass | sel (Challenge) | Labelling a character's values; own-values part is unscored | SEL identity (NY 1B) but only loosely self-awareness |
| Reaction Time | executive (Challenge) | Processing speed plus motor; no no-go element | "Thinking skills" only in the loosest sense. Needs a no-go/decoy element to be an inhibition game |

Verdicts: Number Sequence, Idea Lab, Fix-It Workshop = **MISMATCH**. The other four = **PARTIAL** (strict grid does not count them; the lenient grid does).

### C2. CASEL competency tags inside SEL (the owner's "specific SEL focus")

| Game | Tag | Real fit | Suggested tag change (not applied) |
|---|---|---|---|
| Feelings Detective | self_awareness | The main task reads a *character's* feelings = social_awareness. Own-feelings check is supporting | social_awareness primary, self_awareness supporting |
| The Post | self_management | Not trained. RDM is the main skill but untagged | drop self_management; add responsible_decision_making |
| Values Compass | self_awareness, responsible_decision_making | self_awareness weak; RDM none | self_awareness (weak) only |
| Idea Lab | relationship_skills | "Ask a wide group" is user research, not relationship skills | RDM only (or move out of SEL, see C1) |
| Fix-It Workshop | social_awareness | Facts are handed over; no perspective to interpret | RDM only (or move out of SEL) |
| Strength Spotter | self_awareness | Scored work is about others; own check is unscored | keep, but label as supporting |
| First Shift | relationship_skills | Supporting only; one story has none | keep, mark supporting |
| Sharing Circle | relationship_skills | Supporting only (no communication skills) | social_awareness primary |
| Choice Quest | social_awareness, relationship_skills | RDM direct; the other two are single steps | keep, RDM primary |
| Money Moves, Money Matters | self_management | Goal planning only, no impulse test | supporting at best |
| Team Pick | self_management | Strategy knowledge, not practice | keep (the cleanest match after Group Chat Meltdown) |

---

## D. Coverage grid

### D1. Grade band x Focus (the page's two filters)

Cells show **count of games that genuinely fit (FIT only)** / count if PARTIAL games are also allowed. Games are counted in the band the catalog gives them. Cells under 2 are marked GAP with how many games are missing.

| | Literacy | Math | Thinking Skills | SEL & Character | Wellness & Life |
|---|---|---|---|---|---|
| **Discover (K-2)** | 1 / 1 **GAP (-1)** | 0 / 0 **GAP (-2)** | 0 / 0 **GAP (-2)** | 5 / 5 ok | 0 / 0 **GAP (-2)** |
| **Explore (3-5)** | 1 / 1 **GAP (-1)** | 0 / 0 **GAP (-2)** | 2 / 2 ok | 4 / 4 ok | 0 / 0 **GAP (-2)** |
| **Challenge (6-8)** | 1 / 1 **GAP (-1)** | 1 / 1 **GAP (-1)** | 1 / 2 **GAP (-1)** (ok if Reaction Time counts) | 3 / 5 ok | 0 / 0 **GAP (-2)** |
| **Advance (9-12)** | 1 / 1 **GAP (-1)** | 0 / 0 **GAP (-2)** | 0 / 0 **GAP (-2)** | 4 / 5 ok | 0 / 0 **GAP (-2)** |

Which games are in each cell:

- **Discover**: Literacy = Sound Safari. SEL = Calm Down Corner, Sharing Circle, Helper's Choice, Feelings Detective, Same and Different.
- **Explore**: Literacy = Reading Detective (thin). Thinking = Memory Match, Simon Sequence. SEL = Choice Quest, Team Pick, Strength Spotter, Peace Table (Fix-It Workshop removed as a mismatch).
- **Challenge**: Literacy = Headline. Math = Quick Math (too easy for the band). Thinking = Stroop (+ Reaction Time if partial counts; Number Sequence removed). SEL = Decision Point, Group Chat Meltdown, Say It Another Way (+ Money Moves, Values Compass if partial counts).
- **Advance**: Literacy = Critical Read. SEL = First Shift, The Post, Perspective Swap, Community Voice (+ Money Matters if partial counts; Idea Lab removed).

For comparison, **as tagged today** (before this audit) the counts were SEL 5/5/5/6, Literacy 1/1/1/1, Thinking 0/2/3/0, Math 0/0/1/0, Wellness 0 everywhere.

Re-homing options that change the grid:
- **Number Sequence to math**: Challenge Math becomes 2 (Quick Math + Number Sequence), once the quadratic bug is fixed.
- **Quick Math to Explore**: its content is grade 3-5 level. Explore Math becomes 1; Challenge Math would then need Number Sequence (fixed) plus one new game.
- **Money Moves and Money Matters to Wellness & Life Skills** (their original tag): Wellness becomes 1 in Challenge and 1 in Advance. SEL stays at 3 and 4 FIT games, still at least 2.
- **Reaction Time given a no-go element** (tap on green, not on red): becomes a real inhibition game and closes Challenge Thinking.

### D2. Supplementary view: SEL x CASEL competency x band

Only needed if "focus" means the finer SEL competency. Counts **games whose main skill is that competency (direct)**, from my reading of each game, not from the tag. Supporting links are not counted. (The older `docs/tune-your-brain/SEL_POG_COVERAGE.md` uses New York's benchmarks and the owner-accepted mapping; it was written before this audit and I did not change it.)

| | self_awareness | self_management | social_awareness | relationship_skills | responsible_decision_making |
|---|---|---|---|---|---|
| **Discover** | 0 (Feelings Detective is supporting) **GAP -2** | 1 Calm Down Corner **GAP -1** | 3 Sharing Circle, Feelings Detective, Same and Different | 0 **GAP -2** | 1 Helper's Choice **GAP -1** |
| **Explore** | 0 (Strength Spotter is supporting) **GAP -2** | 1 Team Pick **GAP -1** | 1 Peace Table **GAP -1** | 1 Peace Table **GAP -1** | 1 Choice Quest **GAP -1** |
| **Challenge** | 0 (Values Compass is weak) **GAP -2** | 1 Group Chat Meltdown **GAP -1** | 0 **GAP -2** | 1 Say It Another Way **GAP -1** | 1 Decision Point **GAP -1** |
| **Advance** | 0 **GAP -2** | 0 (money games partial) **GAP -2** | 1 Perspective Swap **GAP -1** | 0 (Community Voice leans direct) **GAP -2** | 3 First Shift, The Post, Community Voice |

Read this as: SEL has plenty of games, but they pile up on responsible decision-making and social awareness. Self-awareness has no direct game in any band, and relationship skills and self-management are thin everywhere. 18 of the 20 cells are under two. If the owner means this view, the SEL gap list is its own, longer list (section E3).

---

## E. Gaps and proposed games

Minimum is 2 per cell. All proposals reuse an existing engine where I say so. **Wellness is held back from design until the owner defines it (question 2 below)**; the Wellness ideas are placeholders that stay inside the master plan's rule of "no medical claims". Ideas that the master plan already approved but never built are marked **(plan)**.

### E1. Gap list by cell

| Band | Focus | Have | Missing |
|---|---|---|---|
| Discover | Literacy | 1 | 1 |
| Discover | Math | 0 | 2 |
| Discover | Thinking Skills | 0 | 2 |
| Discover | Wellness | 0 | 2 |
| Explore | Literacy | 1 | 1 |
| Explore | Math | 0 | 2 |
| Explore | Wellness | 0 | 2 |
| Challenge | Literacy | 1 | 1 |
| Challenge | Math | 1 | 1 |
| Challenge | Thinking Skills | 1 | 1 |
| Challenge | Wellness | 0 | 2 |
| Advance | Literacy | 1 | 1 |
| Advance | Math | 0 | 2 |
| Advance | Thinking Skills | 0 | 2 |
| Advance | Wellness | 0 | 2 |
| | **Total** | | **24 (16 without Wellness)** |

### E2. Proposals (short; none is built or approved)

**Literacy**

| Band | Idea | Mechanic and what it trains | Age notes | Adapt something existing? |
|---|---|---|---|---|
| Discover | **Rhyme Time** | Hear a word, tap the picture that rhymes (audio-choice). Trains phonological awareness (rhyme), which is distinct from Sound Safari's first sounds | No reading; spoken; 3 choices. Phonics audio wants a human recording (owner's earlier decision) | Reuses Sound Safari's clip pipeline and engine. Alternative: **Word Builder (plan)**, blend sounds into a word, but it needs a Build engine |
| Explore | **Word Clues** | Read a short passage with a hard word, pick its meaning, tap the clue that shows it (evidence-hunt). Trains vocabulary in context | Passages at genuine grade 3-5 level | Also **expand Reading Detective** from 4 to 12 items at grade 3-5 level with balanced option lengths, so it is no longer thin |
| Challenge | **Tone Detective** | Pick the author's tone or purpose, tap the words that show it (evidence-hunt). Trains author's craft, which Headline's main-idea work does not | Short articles, speeches and reviews | Reuses Headline's engine |
| Advance | **Argument Check** | Spot the claim, the reasoning and the weak step (a missing link or a fallacy), then tap the evidence (evidence-hunt). Trains argument analysis | Must stay clear of Critical Read's "source and study design" ground | Reuses Critical Read's engine |

**Math**

| Band | Idea | Mechanic and what it trains | Age notes | Adapt? |
|---|---|---|---|---|
| Discover | **Number Garden (plan)** | Hear a number, tap or place that many objects; the garden grows. Counting and quantity | No time pressure; large targets; direct-entry alternative | New (the plan wants a Manipulative engine; a choice-based first cut uses audio-choice) |
| Discover | **More or Fewer** | See two groups, tap the one with more (or fewer). Number sense and comparing | Spoken prompt, picture groups of 1-10 | Audio-choice |
| Explore | **Fraction Kitchen (plan)** | Use recipe quantities and visual models to compare and combine fractions | Recipe theme; non-drag controls | New (Manipulative) |
| Explore | **Word Problem Workshop** | Read a short problem, pick the operation, tap the numbers that matter (evidence-hunt). Applied numeracy | Grade 3-5 contexts | Reuses Quick Math's number ranges; or **move Quick Math to Explore** |
| Challenge | **Ratio Shop** | Compare unit prices and percent-off deals to find the best buy. Ratios and percents | Real prices; no timer | Fix Number Sequence and re-tag it as math for the other slot |
| Advance | **Graph Match** | Match a real-life story to a linear, exponential or quadratic graph and say what the slope means. Functions and modelling | Uses data teens meet (phone plans, growth) | New |
| Advance | **Stats Check** | Mean, median and spread, then spot the misleading chart (evidence-hunt). Data reasoning | Keep apart from Critical Read, which is about sources | Reuses the evidence-hunt engine |

**Thinking Skills (executive function)**

| Band | Idea | Mechanic and what it trains | Age notes | Adapt? |
|---|---|---|---|---|
| Discover | **Robot Says** | Hear "Robot says tap the star" or just "tap the moon"; tap only when the robot says (go/no-go). Inhibition and listening | Spoken, no reading; a miss is a gentle replay, not a fail | New, audio-choice-like |
| Discover | **Simon Sequence, Discover version** | Same game with animal pictures and sounds, capped at 5, no game-over | Needs a K-2 skin | **Adapt Simon Sequence** (cheapest) |
| Challenge | **Reaction Time with a no-go** | Tap on green, **not** on red decoys. Turns it into an inhibition game | Keep the best-of-5 average | **Adapt Reaction Time** (cheapest). Alternative: **Switch It**, sort by colour, then by shape when the rule changes (cognitive flexibility) |
| Advance | **Plan It** | Schedule six tasks with dependencies and a deadline; undo allowed; scored on how efficient the plan is. Planning and prioritising | Realistic exam-week or job-shift theme | New (Strategy engine in the plan) |
| Advance | **Update It** | A slowed "2-back" task: tap when a letter matches the one two back. Working-memory updating | Adjustable speed; no time-out penalty | New. Memory Match hard and Stroop hard do not change with age, so they do not fill the slot |

**Wellness & Life Skills (placeholders until defined)**

| Band | Idea | Mechanic and what it trains | Age notes |
|---|---|---|---|
| Discover | **Breathing Buddy** | Follow an animal's breathing pace for 3 breaths (Guided Activity engine). A body routine, not feelings, so it does not duplicate Calm Down Corner | Skip and pause, captions |
| Discover | **Healthy Habits Helper** | Hear a daily situation, tap the habit that helps (sleep, water, washing hands, moving) (audio-choice) | Spoken; no body-shaming |
| Explore | **Sleep and Screens Detective** | Pick the evening routine that helps sleep (evidence-hunt) | No medical claims |
| Explore | **Fuel Up** | Match snacks and meals to "go", "grow" and "sometimes" without diet or weight language | Needs the owner's wording review |
| Challenge | **Balance Board** | A 7-day planner: homework, sleep, movement, friends, screens, with an energy meter (simulation) | Reuses the simulation engine |
| Challenge | **Habit Builder** | Pick one tiny habit, plan its cue and a backup, see a simulated week | Overlaps SEL self-management slightly; keep to body and routine habits |
| Advance | **Life Admin Day** | Simulate a first month on your own: appointments, groceries, insurance, sleep (simulation) | Teens' real tasks |
| Advance | **Label Check** | Read a nutrition or medication label and pick the safe choice (evidence-hunt) | No medical advice; label-reading only |

If the owner moves **Money Moves and Money Matters** back to Wellness & Life Skills, Challenge and Advance each need only 1 new Wellness game instead of 2.

### E3. If "focus" means the CASEL competency (D2)

That would add 18 cells under two (a different, finer grid). The fastest closers are small content changes, not new games: fix the tags in C2, add one more story pool to existing games, and then build new games only for what stays empty. Candidate new games, one line each:
- **Self-awareness** (none in any band): "My Strengths Gallery" (Discover, pick pictures of what you are good at, spoken), a real own-strengths step in Strength Spotter (Explore, a private choice that changes the next story), "Values Ladder" (Challenge, rank your own values and see a tradeoff), "Know Your Triggers" (Advance, a private reflection on stress cues).
- **Relationship skills** (Discover, Advance): "Asking Nicely" (Discover, say a polite request or apology), "Repair It" (Advance, choose the words for an apology or a boundary).
- **Self-management** (Advance): "Deadline Crunch" (Advance, pause, plan and stick to a goal under temptation).
- **Social awareness** (Challenge): "Walk in Their Shoes" (Challenge, pair of viewpoints on one event).

---

## F. Open questions for the owner

1. **ANSWERED: the five domains.** (Was: does "focus" mean the five domains on the games page, or the finer SEL competency / NY benchmark?) I used the domains for the main grid (that is what the page calls "Focus") and gave the CASEL view in D2. The answer changes the size of the job from about 24 games to 24 plus SEL cells.
2. **Is Wellness & Life Skills a required focus, and what is in it?** No game has it today, no document defines it beyond the name, and the money games (once Wellness) were moved to SEL by you on 2026-11-01. Do you want them back in Wellness, kept in SEL, or both counted?
3. **Where do creative problem-solving games go?** Idea Lab and Fix-It Workshop have no honest domain. Add a "Creativity" value, accept them under Thinking Skills, or keep them in SEL with RDM only? (Your Portrait of a Graduate mapping already counts them for Creative Innovator.)
4. **Strictness:** should PARTIAL games (Money Moves, Money Matters, Values Compass, Reaction Time) count? Strict says no; lenient closes only Challenge Thinking Skills.
5. **One band per game, or allow two?** A game is in exactly one band today. Memory Match, Simon Sequence, Quick Math and Stroop work across bands by difficulty setting. Allowing a game to count in two bands would close a few cells cheaply, but would blur "grade band".
6. **Legacy six:** do the older games count toward the minimum? Their band is a label and none was written for its grades (Quick Math is grade 3-5 content). Do you want Quick Math re-banded to Explore, and Memory Match and Simon given Discover versions?
7. **Quality bar for counting:** Reading Detective (4 items), Decision Point and Group Chat Meltdown (1 fixed scenario each) are thin, and the four story games show 1 of 4 stories per run. Should a game need a minimum content pool before it counts as one of the two?
8. **Tag fixes:** should I change the tags in C2 (for example, Feelings Detective to social awareness, The Post to responsible decision-making)? That also changes `SEL_POG_COVERAGE.md`, which you accepted earlier. I changed nothing.
9. **Planned but unbuilt games:** Word Builder, Number Garden and Fraction Kitchen are in the approved master plan (section 14) and would close three cells. Build those first, or the cheaper adaptations?
10. **Defects found along the way, outside this audit (tell me if you want a follow-up):** Number Sequence's quadratic pattern cannot be solved; Money Moves cannot reach its goal in 35% of draws and Money Matters in 43%; Reading Detective is below grade level; Same and Different's header comment is stale; the story-game summary does not count "ask an adult" choices as good choices; Memory Match cards have no screen-reader labels.

---

## G. Recommendation: regroup the SEL games by the five CASEL competencies (added 2026-11-06)

**Status: recommendation only, not applied.** Based on the owner's pasted definitions of the five competencies, the master plan (section 6.4 already says SEL content "should map internally to the five broad CASEL competency areas") and `GAP_ANALYSIS_2026-09-17.md`, which already measured SEL coverage as competency x band.

### G1. What I recommend

1. **Do not force all 31 games into the five competencies.** Ten games are skills practice and have no honest competency: Sound Safari, Reading Detective, Headline, Critical Read (literacy), Quick Math, Number Sequence (math), Memory Match, Simon Sequence, Reaction Time, Stroop (thinking skills). Forcing them in would recreate the mismatches this audit is meant to remove. The owner's 2026-10-31 decision already treats them as "skills practice" that does not count toward SEL coverage.
2. **Make the Focus filter two-level.** Five competency chips for the 21 SEL games (Self-Awareness, Self-Management, Social Awareness, Relationship Skills, Responsible Decision-Making) and one "Skills practice" group holding Literacy, Math and Thinking Skills.
3. **Give each SEL game one primary competency** (the grid needs exactly one) and keep the existing multi-value `casel_competencies` as the secondary list. Today that column is a SET, is never shown on the games page, and a game can carry up to three values, so it cannot drive a grid.
4. **Retire Wellness & Life Skills as a separate focus.** The pasted Self-Management definition covers stress management, deep breathing, goal-setting and organisational skills, which is where the Wellness ideas (Breathing Buddy, Balance Board, Habit Builder, Life Admin Day) belong. This also answers open question 2 and removes 8 of the 24 missing games from the Wellness cells. Both money games then sit under Self-Management through goal-setting.
5. **Apply the owner's minimum of two to the 20 competency x band cells**, and keep a smaller, separate target for Skills practice (the 16 games in E1, to be decided).

### G2. The pasted definitions loosen three of my earlier verdicts

I read Self-Management narrowly (impulse control and regulation). The pasted list also names **goal-setting and organisational skills** under Self-Management, and **identifying problems and analysing situations** under Responsible Decision-Making. Under those definitions:

- **Money Moves and Money Matters** become acceptable Self-Management games (goal-setting, planning); they were PARTIAL. The printed arithmetic and the unreachable-goal draws are still defects.
- **Idea Lab and Fix-It Workshop** become acceptable Responsible Decision-Making games (identify the real problem, weigh options, small test with permission); they were MISMATCH. Step 3 having no wrong answer still limits how much they teach.
- **Strength Spotter** (recognising strengths) and **Values Compass** (values) sit under Self-Awareness, but both remain weak there because the scored work is about *other* people and the own-strengths and own-values taps are unscored.

### G3. Proposed primary competency for every SEL game

\* = low confidence; counts only if the fix in the last column is made.

| Band | Self-Awareness | Self-Management | Social Awareness | Relationship Skills | Responsible Decision-Making |
|---|---|---|---|---|---|
| Discover | Feelings Detective\* (name emotions; make the own-feelings step a real, central step) | Calm Down Corner | Sharing Circle, Same and Different | none | Helper's Choice |
| Explore | Strength Spotter\* (make the own-strengths step scored or central) | Team Pick | none (Peace Table and Choice Quest carry it as secondary) | Peace Table | Choice Quest, Fix-It Workshop |
| Challenge | Values Compass\* (make the own-values step central) | Group Chat Meltdown, Money Moves\* | none | Say It Another Way | Decision Point |
| Advance | none | Money Matters\* | Perspective Swap | Community Voice | First Shift, The Post, Idea Lab |

### G4. Resulting grid (primary only) and gaps to the minimum of two

| Band | Self-Awareness | Self-Management | Social Awareness | Relationship Skills | Resp. Decision-Making | Missing |
|---|---|---|---|---|---|---|
| Discover | 1 (-1) | 1 (-1) | 2 | 0 (-2) | 1 (-1) | 5 |
| Explore | 1 (-1) | 1 (-1) | 0 (-2) | 1 (-1) | 2 | 5 |
| Challenge | 1 (-1) | 2 | 0 (-2) | 1 (-1) | 1 (-1) | 5 |
| Advance | 0 (-2) | 1 (-1) | 1 (-1) | 1 (-1) | 3 | 5 |

That is **20 games missing** (25 if none of the five low-confidence games qualifies). The weakest spots are Social Awareness in Explore and Challenge and Relationship Skills in Discover. All three of those cells have no game even supporting that competency as its main skill.

### G5. Ideas for the gap cells (one line each; concepts only)

- **Discover.** Self-Awareness: "My Feelings Today" (private check-in: pick a face and where you feel it; unscored). Self-Management: "Wait for It" (choose how to wait; or Breathing Buddy). Relationship Skills: "Asking Nicely" (choose the words to ask to join or say sorry) and "Team Tower" (take turns and share jobs). Responsible Decision-Making: "Stop and Think" (name the problem, predict what happens next, pick the safe choice).
- **Explore.** Self-Awareness: "What Helps Me" (private: pick what helps you learn and focus). Self-Management: "Stuck on It" (frustration on a hard task: breaks, persistence, small goals). Social Awareness: "Walk in My Shoes" and "Many Ways to Be" (appreciating differences). Relationship Skills: "Team Mission" (divide jobs, listen, handle a disagreement).
- **Challenge.** Self-Awareness: "Know Your Triggers" (private stress and trigger check). Social Awareness: "Other Side of the Screen" (online empathy) and "Walk in Their Shoes". Relationship Skills: "Speak Up Kindly" (assertive messages and boundaries). Responsible Decision-Making: "Peer Pressure Pause" (a second scenario game; Decision Point has one fixed scenario).
- **Advance.** Self-Awareness: "Know Yourself" (rank your own values and see the tradeoff) and "Stress Signals". Self-Management: "Deadline Crunch" (plan and hold a goal under temptation). Social Awareness: "Many Voices" (bias, culture, power). Relationship Skills: "Repair It" (choose the words for an apology, feedback or a boundary).

Most can reuse the branching-scenario, audio-choice or scenario-choice engines. Each should keep the standing writing rules (balanced option lengths, believable wrong answers, a private reflection) and needs the owner's read before it goes live.

### G6. What the change touches

- **Data:** a one-off `server/scripts/alter-add-brain-games-primary-competency.js` (idempotent, `information_schema` check) and a matching line in `schema.sql`; a seed or update script setting the primary for all 31 games (null for the ten skills games).
- **Pages:** `brain-games.html` filter chips and card tag; `teacher-classroom.html` assign list; the teacher game report if it groups by domain. `domain` stays for the skills games and the existing `casel_competencies` SET stays as the secondary list. The `wellness` value stays dormant in the enum.
- **Docs:** `SEL_POG_COVERAGE.md`, `GAP_ANALYSIS_2026-09-17.md` matrix and `docs/reference` notes.
- **Public wording:** "CASEL-aligned, not CASEL-certified" must stay wherever competencies are shown (master plan 6.4). The competency labels on the public page are student-facing copy that needs the owner's sign-off.
- The state crosswalk (`standards_items.casel_competency`) already uses the same five values, so competency tags on games line up with the existing standards data and the sales material.

---

## H. Suggestions: core skills games for the younger bands (added 2026-11-06)

**Owner decision (2026-11-06): core three only.** Skills practice is Literacy, Math and Thinking Skills. Science, social studies, typing and mouse-skills ideas below are **PARKED** (not in scope, not proposed for the minimum-of-two). Robot Path stays on the list only as a Thinking Skills (planning and sequencing) game.

**Status: suggestions only, nothing built or approved.** "Core skills" here means the skills practice side of the catalog (literacy, math, thinking skills and other school topics), as opposed to the SEL games. Today the younger bands have almost none: **Discover has 1 skills game (Sound Safari) and Explore has 3 (Reading Detective, Memory Match, Simon Sequence, with the last two being legacy games with no grade-specific design).** Nothing exists yet for K-2 math, K-2 reading beyond first sounds, or any other school topic.

### H1. Rules I would apply to all of them

1. **Three levels inside a band.** Discover spans K, 1 and 2, which are very different. Each Discover skills game should have Level 1 / 2 / 3 (K / grade 1 / grade 2), chosen by the teacher or by `?level=`, with content written for each. The master plan already calls for a phonics progression ("D1-D7 foundational reading progression", section 14.1, Word Builder).
2. **Spoken and no-reading for Discover.** Prompts and answers are read aloud and the child taps; the existing audio engine, clip pipeline (`build-discover-audio.js`) and Ava voice carry over. Phonics sounds need a human recording and the owner's ear test (earlier decision, still open). Anything that depends on exact sounds should be recorded, not synthesised.
3. **Balanced content and pools.** Same standing writing rules as the other games: balanced option lengths, believable wrong answers, and a pool large enough that two runs differ (Sound Safari has 77 rounds, 6 per run). The thin 4-item games are the pattern to avoid.
4. **Standards link.** The site already maps content to state standards and Portrait of a Graduate. Each new skills game should name the standard skill it practises (for example K-2 foundational reading and counting skills). Claude drafts that mapping; the owner or a standards reviewer verifies it, as with the crosswalk.
5. **No clock for the youngest.** Untimed in Discover; optional timer from Explore.

### H2. Engines that already exist but no live game uses

- **Pattern engine** (`engine-pattern.js`: show a sequence, pick what comes next) and **Memory engine** (`engine-memory.js`: pair matching). Only the internal demo page loads them; the live Number Sequence and Memory Match are the older self-contained pages. These make patterns and memory games for K-5 cheap.
- **Audio-choice** (hear it, tap it) and **evidence-hunt** (answer, then tap the proof) already run the other games.
- **Not built:** a Build engine (tiles) and a Manipulative engine (move counters and shapes), which the plan names for Word Builder, Number Garden and Fraction Kitchen. Choice-based first versions of those games can ship without them.

### H3. Discover (K-2)

| Topic | Game idea | What the child does | Engine | Effort |
|---|---|---|---|---|
| Phonics | **Letter Sounds** | Sees a letter, hears three sounds, taps the one it makes (and the reverse). Separates a letter's name from its sound | audio-choice | Low |
| Phonics | **Rhyme Time** | Hears a word, taps the picture that rhymes | audio-choice | Low |
| Phonics | **Word Builder (plan)** | Hears a word and taps sound tiles in order to blend it (cat = c, a, t). Level 3 uses digraphs | Build (new) or choice-based first version | High / Low |
| Phonics | **Syllable Clap** | Hears a word, taps 1, 2 or 3 for the syllable count | audio-choice | Low |
| Reading | **Sight Word Safari** | Hears a common word (the, said, was) and taps it among three | audio-choice | Low |
| Reading | **Listen and Tell** | Hears a 3-sentence story, answers who, what or where by tapping a picture. Listening comprehension before decoding | audio-choice | Medium |
| Math | **Number Garden (plan)** | Hears a number, taps or places that many objects; the garden grows | audio-choice (first cut), Manipulative (later) | Low / High |
| Math | **More or Fewer** | Sees two groups, taps the one with more (or fewer, or the same) | audio-choice | Low |
| Math | **Add It Up** | Joins or takes away pictures within 5, 10 then 20 and taps the total | audio-choice | Low |
| Math | **Shape Safari** | Hears a shape name, taps the shape; later sorts by sides and corners | audio-choice | Low |
| Math | **Clock and Coins** (level 3) | Hour and half hour on a clock; counting pennies, nickels and dimes | audio-choice | Medium |
| Thinking | **Pattern Parade** | Sees colours or shapes in a pattern (red, blue, red, ?) and taps what comes next; AB, ABC, then growing patterns | Pattern engine | Low |
| Thinking | **Animal Match** | Flips cards to find pairs; 3, then 4 then 6 pairs, no timer | Memory engine | Low |
| Science | PARKED: **Sort It Out** | Sorts pictures into living or not living, plants or animals, hot or cold | audio-choice / sort | Low |
| Social studies | PARKED: **Helpers and Places** | Matches a community helper to the job, or a place to what you do there | audio-choice | Low |
| Typing and tools | PARKED: **Mouse and Tap Skills** | Practises tapping, dragging and scrolling with a friendly task before other games | New | Low |

### H4. Explore (3-5)

| Topic | Game idea | What the student does | Engine | Effort |
|---|---|---|---|---|
| Reading | **Word Clues** | Reads a passage with a hard word, picks its meaning, taps the clue | evidence-hunt | Low |
| Reading | **Reading Detective, expanded** | Grows from 4 to 12 items at real grade 3-5 reading level | evidence-hunt (existing) | Low |
| Reading | **Word Parts** | Prefixes, suffixes and roots (un-, -ful, bio-): builds meaning from parts | choice | Low |
| Reading | **Fact or Opinion** | Reads a statement or short text, sorts it, taps the words that show why | evidence-hunt | Low |
| Language | **Fix the Sentence** | Picks the correction for capitals, punctuation or subject and verb agreement | choice | Low |
| Language | **Spelling Patterns** | Picks the correctly spelled word and the rule (doubling, silent e, -ing and -ed) | choice | Low |
| Math | **Fraction Kitchen (plan)** | Uses recipe amounts and visual models to compare and add fractions | Manipulative (new) or choice | High / Medium |
| Math | **Times Table Trail** | Multiplication and division facts, untimed first, with a short optional timer | adapt Quick Math | Low |
| Math | **Word Problem Workshop** | Picks the operation and taps the key numbers in a short problem | evidence-hunt | Low |
| Math | **Place Value Park** | Reads and builds numbers to 1,000,000; rounds | choice | Medium |
| Math | **Measure It** | Chooses units and reads rulers; converts within a system; area and perimeter on a grid | choice | Medium |
| Math | **Graph Detective** | Reads bar and picture graphs and taps the data that answers the question | evidence-hunt | Low |
| Thinking | **Pattern Lab** | Finds the rule in number or shape patterns and tables; sentence rules ("add 3") | Pattern engine | Low |
| Thinking | **Robot Path** | Plans a short list of moves to guide a robot to a goal (sequencing, loops). Computational thinking | Strategy (new) | Medium |
| Science | PARKED: **Fair Test** | Picks the experiment where only one thing changes, and what the result shows | evidence-hunt | Low |
| Social studies | PARKED: **Map Master** | Compass, map key and scale; finds a place from clues | choice | Medium |
| Typing | PARKED: **Home Row Hero** | Short typing drills with a focus on accuracy over speed | New | Medium |

### H5. Recommended first wave (closes the earlier gaps with the least engineering)

| Band | Games | Why first |
|---|---|---|
| Discover | **Rhyme Time**, **Letter Sounds** (literacy); **More or Fewer**, **Add It Up** (math); **Pattern Parade**, **Animal Match** (thinking) | All use an engine that exists today. Six games close Discover's Literacy, Math and Thinking Skills cells (the cells were 1, 0 and 0) |
| Explore | **Word Clues** (literacy); **Times Table Trail**, **Word Problem Workshop** (math) | Use existing engines and number logic; close the Literacy and Math cells (1 and 0). Thinking Skills is already at two |
| Later | Word Builder, Number Garden, Fraction Kitchen, Robot Path | Need a new engine, but the master plan already approves the first three |

### H6. What to settle before any of these are written

- ~~Topics beyond literacy, math and thinking~~ **Answered: core three only.** The parked rows stay in the tables for reference.
- **Levels inside Discover:** one game with K / grade 1 / grade 2 levels, or separate games per grade?
- **Voice for phonics:** the owner's Ava (Premium) decision and the pending ear test of letter sounds; real recordings are recommended for phonics.
- **Standards:** which standards set to name (Common Core-style national skills, or per-state like the SEL crosswalk).
