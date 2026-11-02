# New games for the thin SEL and Portrait of a Graduate areas: proposals (outline stage, for your approval)

Written 2026-11-01 by Claude. **Nothing is built.** This follows the outline-first rule: you approve a game's concept, then I write the full text, add the tests, play it in a browser and bring the finished wording back for your read before anything deploys. The gap numbers come from `SEL_POG_COVERAGE.md` (generated from `GAME_SCORECARD.md`).

## The gaps these target

| Gap today | Live games | What is missing |
|---|---|---|
| NY SEL 1B Identity and agency | 0 direct, 0 supporting | Nothing asks a child to think about their own strengths, interests or what shapes them |
| NY SEL 2B Similarities and differences | 0 direct, 0 supporting | Nothing helps a child notice and value differences between people |
| NY SEL 2C Communicating across differences | 0 direct, 4 supporting | The games choose actions; none practises how to say something |
| NY SEL 3C Acting for school and community | 1 direct, 2 supporting | Only Decision Point. Nothing about starting or planning a group effort |
| Portrait: Creative Innovator | 0 direct, 0 supporting | No game asks for or compares ideas |
| Portrait: Effective Communicator | 0 direct, 4 supporting | The same as 2C |
| Portrait: Academically Prepared | 0 direct, 3 supporting | By design, since literacy and maths games are skills practice; not a gap to fix with SEL games |

## Six proposals

Each reuses an engine that is already built, so there is no new engine code. Every game follows the standing writing rules: balanced option lengths, believable wrong answers, feedback that explains the effect, a private closing reflection, fictional names, a pool so no two runs match.

### 1. Same and Different (Discover, K-2): SEL 2B direct, 2A supporting
- **What the child does:** meets two children (for example Ana, who has a big family and loves soccer, and Ben, who has a small family and loves drawing). Picks one thing the two have in common and one thing that is different, then picks a kind way to play together.
- **Engine:** audio choice with per-choice feedback and a round explanation (built 2026-10-31); read aloud with the Ava voice like the other Discover games.
- **Content:** a pool of 12 pairs, 4 per run. Differences are everyday and neutral (foods, games, home languages, helpers at home, glasses or a wheelchair named plainly and kindly). No stereotypes and no ranking of differences.
- **Why it matters:** NY 2B asks children to notice similarities and differences; no live game touches it.
- **Review needed from you:** the list of differences used at K-2, and the wording around bodies and families.

### 2. Strength Spotter (Explore, grades 3-5): SEL 1B direct, 1C supporting; Portrait RF direct, CI supporting
- **What the child does:** reads short stories where a child uses a strength (patience, curiosity, drawing, helping, persistence). Picks the strength shown, then sees how it helped. Closes with a private check ("Do you use a strength like this? Where?") that is never logged, sent or saved, the same rule as the Feelings Detective check-in.
- **Engine:** scenario choice (evidence first, then a choice), with the existing private self-check support.
- **Content:** a pool of 12 stories, 5 per run. Strengths are not only school skills (humour, noticing, leading, listening).
- **Why it matters:** NY 1B (identity and agency) has no coverage, and a game about strengths gives it without asking children to share anything.
- **Review needed from you:** the self-check wording and the strength list.

### 3. Fix-It Workshop (Explore, grades 3-5): Portrait CI direct, SEL 3C direct
- **What the child does:** a school problem (a long lunch line, a quiet corner of the playground, a lost-and-found nobody checks). Five steps in the design cycle: who is affected, what the real problem is, brainstorm ideas, pick one and make it, test and improve. At the idea step several options are defensible and the child picks the one they like and says why; feedback names the strength and the trade-off of each, never "wrong".
- **Engine:** branching scenario (the five-step shape you already approved, with the reflection step), using story variants.
- **Content:** four problems at first; each has 3 or 4 believable ideas per step.
- **Why it matters:** it is the only way in this catalog to get Creative Innovator as a direct link, and it carries NY 3C because the fix helps the school.
- **Limit to say plainly:** a multiple-choice game can compare ideas but cannot judge a child's own original idea. It teaches the process and the trade-offs. A free-text idea step would be a separate, privacy-reviewed decision.

### 4. Say It Another Way (Challenge, grades 6-8): SEL 2C direct, 2D and 1A supporting; Portrait EC direct
- **What the child does:** reads a situation and three drafts of a message (a text to a friend who is upset about a plan, a note to a teacher about a due date, a reply to someone who sees an issue differently). Picks the draft that this person would hear best, then picks the phrase that shows why.
- **Engine:** evidence hunt (the same "pick, then prove it" shape as Headline, with balanced options and varied right answers). No new engine.
- **Content:** a pool of 12 situations, 6 per run. Wrong drafts are tempting for different reasons: too blunt, too vague, so apologetic it hides the point, a "you always" blame, and one that sounds kind but never says what you need.
- **Why it matters:** this is the first game that practises how to say something. It supports both the SEL gap (2C) and Effective Communicator.
- **Review needed from you:** the situations, since several touch conflict and feelings.

### 5. Perspective Swap (Advance, grades 9-12): SEL 2B and 2C direct, 2A supporting; Portrait GC direct
- **What the child does:** a group has a plan that works for most people and not for one (a deadline on a day a teammate's family observes a holiday, a team chat that only works for fast typers, a trip that assumes everyone can afford it). The child sees the situation from two teammates in turn, then chooses how the group can adjust so everyone can take part.
- **Engine:** branching scenario in the five-step cycle with story variants.
- **Content:** four stories at first. Differences are drawn from faith, language, money, ability and interests, written without naming real groups or making any group the problem.
- **Why it matters:** NY 2B and 2C at the grade 9 to 12 level are not covered by any live game, and Advance has the least SEL.
- **Sensitivity (your call as SEL reviewer):** this is the most delicate of the six. I would write it only with your outline approval for each story, and with a neutral, plural approach.

### 6. Community Voice (Advance, grades 9-12): SEL 3C direct, 2C supporting; Portrait GC and EC direct
- **What the child does:** you want the school or a club to change something (a later bus, a quieter study space, more fresh options in the cafeteria). Five steps: listen to who is affected, check the facts, plan how to ask, present to a decision maker and handle a "no", reflect on what you would do next.
- **Engine:** branching scenario in the five-step cycle with story variants.
- **Content:** four stories at first, each with a different decision maker and a different kind of pushback.
- **Why it matters:** the only game aimed at NY 3C as a main skill at this level, and it combines Global Citizen with Effective Communicator.
- **Review needed from you:** neutral topics, so it stays non-partisan.

## What the six would do for coverage

After all six, the projection in `SEL_POG_COVERAGE.md` shows 2B and 2C with two direct games, 3C with two, Effective Communicator with two and Creative Innovator with one. Still thin after these six: **1B** (one direct game), **Creative Innovator** (one direct game) and **2D** (resolving conflict, one direct). Each of those would need a second game; Say It Another Way and a future conflict story could cover 2D, and a second design-cycle game (Advance band) could cover Creative Innovator.

## Suggested order and effort

1. **Say It Another Way** and **Fix-It Workshop** first: they close the largest gaps (Effective Communicator, Creative Innovator, 2C, 3C) and use engines that are already proven.
2. **Strength Spotter** and **Same and Different** next: they cover 1B and 2B, with careful wording but low technical risk.
3. **Community Voice** and **Perspective Swap** last, because the Advance band is where other work (The Post rework, Money Matters rework, Critical Read) also queues up.

Each game is roughly the size of the Choice Quest or Headline work: an outline of the pool, then your approval, then the full text, tests, a browser play-through and a review document.

## What I need from you

1. Approve, change or drop each of the six concepts (by number).
2. Confirm the order, or tell me which to start with.
3. Confirm that new games enter the catalog with draft SEL and Portrait links only, with the crosswalk entries added later through the normal verify step on `admin-standards.html`.
