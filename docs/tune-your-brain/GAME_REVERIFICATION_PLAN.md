# Brain game reverification plan (DRAFT, decision 1 settled)

Written 2026-10-31. Phase 0 (the static half) has been run; see "Phase 0 results" below. Nothing else is built.

**Decided 2026-10-31:** every game, including the six legacy executive-function and maths games, must map to at least one CASEL competency or Portrait of a Graduate attribute, with a written rationale a teacher would accept. A game that cannot be mapped honestly is reworked or hidden, not waved through. Read `PHASE_STATUS.md` and `GAP_ANALYSIS_2026-09-17.md` first for how the catalog got here.

## Goal

Every game in the catalog gets re-checked against five tests and either passes, gets fixed, or comes off the student-facing list. The five tests:

1. **Complete.** It plays start to finish, saves its result, and nothing in it is a placeholder.
2. **Relevant.** It trains a named SEL competency (CASEL) and/or a Portrait of a Graduate attribute, and says how.
3. **Levelled.** It has an assigned grade level or levels, and its content actually fits them.
4. **Deep and mature.** Its content has real substance for its age band, not four quick questions.
5. **Replayable.** A second run does not hand the student the exact same game.

## What I found by reading the code (not yet checked against production data)

There are 22 game pages: 6 older "legacy" games and 16 built on the engine SDK.

- **Replayability is the biggest gap, and it is structural.** The 16 engine games carry their content hard-coded in the page: a fixed list of about 4 rounds or steps each (rough count of `choices:` and `correctId`; the two simulation games are structured differently). The engines never shuffle the order of rounds or the position of choices; only `engine-memory.js` has any randomness. In Sound Safari, for example, the four rounds and four answer positions are identical on every run, so a second run is the same game. This fails test 5 by design, for every engine game except Memory.
- **The 6 legacy games** (Memory Match, Simon Sequence, Number Sequence, Quick Math, Reaction Time, Stroop Challenge) do randomize each run and have easy/medium/hard pickers, so they pass test 5 on the surface. They are the oldest code, they were never tagged with a band or CASEL competency (`band` is NULL by design), and their SEL/PoG relevance is indirect (executive function), so test 2 is the open question for them.
- **Grade level today is one field:** `brain_games.band` (Discover / Explore / Challenge / Advance), set per game, NULL for legacy. There is no explicit grade list and no check that reading level or maths content matches the band.
- **SEL tagging exists** (`domain`, `casel_competencies` on `brain_games`) but I have not read what production holds, so I do not know which games are tagged. The first job in Phase 0 is to read it.
- **Portrait of a Graduate link:** the crosswalk already supports `brain_game` as an alignment target (`standards_alignments.target_type`), but I do not know how many game alignments exist in production, and the rule stands that Claude drafts and a person verifies.
- **Known placeholder:** Sound Safari and other audio games narrate with browser text-to-speech pending decision D1 (ElevenLabs), which fails test 1 until D1 is settled.

## The rubric (what "pass" means)

| Test | Pass means | How it is checked |
|---|---|---|
| 1 Complete | Loads clean (no console errors); plays to the end; reload mid-game resumes without a duplicate session; result lands in the right place for a site user and for a classroom PIN student; XP/badge or teacher report shows it; keyboard-operable; works on phone width; no placeholder text or "coming soon"; audio is real or has a written transcript | Automated playthrough (Playwright) plus a short manual pass |
| 2 Relevant | Tagged with at least one CASEL competency or PoG attribute, with a one-sentence reason a teacher would accept ("practises X by doing Y"); the tag matches what the game actually asks the student to do | Human review of a drafted mapping; stored in `casel_competencies` and, once verified, `standards_alignments` |
| 3 Levelled | Has a band and an explicit grade range; vocabulary, reading load, maths and scenario themes fit that range; not shown outside it | Human review plus a reading-level estimate on the text |
| 4 Deep and mature | Enough distinct content for a real session; decisions have consequences; more than one defensible path where the topic allows; no moralizing; a reflection or debrief; stakes and tone suit the age | Human review against a short depth checklist (below) |
| 5 Replayable | Content pool at least 3 times larger than one run; round order and answer positions vary; scenario games have at least 3 variants; two consecutive runs share at most half their items | Automated: play 5 runs, log the item sequence, compute overlap |

**Depth checklist (test 4):** (a) at least 8 to 10 minutes of meaningful play, or at least 8 decisions; (b) each decision changes something the student can see; (c) a wrong or risky choice teaches, rather than just ending; (d) the vocabulary is one notch above the band, not below it; (e) a closing reflection that is never sent anywhere (existing design rule).

## Verdicts

Each game ends with one verdict, recorded in a scorecard table (`docs/tune-your-brain/GAME_SCORECARD.md`):

- **Keep:** passes all five.
- **Deepen:** passes 1 to 3, fails 4 or 5; needs more content or variety.
- **Rework:** the mechanic does not fit its SEL/PoG claim or its band.
- **Retire (hide):** removed from student lists but kept in the database; never deleted, so assignments and history survive.

## Phases

**Phase 0: Baseline audit (read-only, about one session).**
Read production's `brain_games` rows (band, domain, CASEL, active). Write a small audit script that reads each game page and reports: engine, rounds/steps, whether anything is randomized, band, and any placeholder text. Run an automated playthrough of every game five times and record the overlap between runs. Output: the first draft of the scorecard with tests 1, 3 (band only) and 5 filled in by evidence, and 2 and 4 left for review. No code changes.

**Phase 1: Fix replayability in the engines, once, for all 16 games.**
Add to each engine (Audio Choice, Evidence Hunt, Branching Scenario, Scenario Choice, Simulation, and Pattern) a content-pool option: `pool` plus `roundsPerRun`, shuffled order, shuffled choice positions, and for scenarios a "variant" selector. Old packs without a pool keep working, so nothing breaks. Tests in `server/test` or the e2e folder prove two runs differ. This is the single change that most improves the catalog, and it needs no SEL judgement. The content to fill the pools is Phase 3.

**Phase 2: Human review, in waves by band (Discover, Explore, Challenge, Advance, then legacy).**
For each game I draft: the competency and PoG mapping with a rationale, a grade range, a depth read against the checklist, and a verdict. You (or a reviewer you name) confirm or correct. Claude cannot verify SEL accuracy, in the same way it cannot verify standards. Output: filled scorecard rows and updated `band`, `domain` and `casel_competencies` through a re-runnable seed script.

**Phase 3: Content expansion for every "Deepen" game.**
Write the larger pools and extra scenario variants. Claude drafts; a person reviews anything touching sensitive topics (peer exclusion, group chats, money stress, self-regard) before it ships. One game per release or small batches, so each can be reviewed and rolled back on its own. This is the biggest piece of work: sixteen games times a pool of roughly 12 to 20 items each.

**Phase 4: Re-verify and publish.**
Re-run the Phase 0 audit and the playthroughs; every game needs a verdict of Keep. Verified mappings go into `standards_alignments` through the normal review path, the Tune Your Brain pages are updated, and the help videos for games (S4) are checked for staleness.

## Order of work

Phase 0, then Phase 1 (they are independent of the review; Phase 1 now also includes shuffling choice order, since the first-slot problem is the most urgent finding), then Phase 2 wave by wave. Phase 3 follows each wave. I would start Phase 2 with the SEL games, because that is where the claim to being SEL is made and where depth matters most, and leave the legacy six until last.

## Phase 0 results (run 2026-10-31)

From `node server/scripts/audit-brain-games.js` (read-only; reads the 22 `brain-*.html` pages) and the public catalog at `/api/brain-games`. Still to do for Phase 0: the five-run automated playthroughs, which will confirm these from the student's side.

- **16 of 22 pages never vary between runs; all 16 have fewer than 6 rounds** (4 or 5 each; 43 to 151 words per round). The other 6 are the legacy games, which generate their content at runtime.
- **The right answer is almost always the first choice.** The engines render choices in the order written, with no shuffle. In Reading Detective, Headline, Critical Read, Helper's Choice, Sharing Circle and Calm Down Corner the correct choice is first in all 4 rounds; in Sound Safari it is first in 3 of 4. In the scenario games (Choice Quest, Decision Point, First Shift, The Post) the choice tagged "responsible" is first in every round; in Team Pick and Group Chat Meltdown it is first in 3 of 4 and third in the other. A student can pass by always tapping the first option, without reading. This matters more than the repeat problem: it means the games may not be measuring anything.
- **The two money games** (Money Matters, Money Moves) are 4 events with 2 options each. That is the thinnest content in the catalog.
- **Placeholder / browser text-to-speech** is flagged on Sound Safari and Calm Down Corner.
- **Public catalog:** 22 games live. The 6 legacy games have no band; they carry a domain (executive or math) and a one-line primary skill. Sixteen others carry a band, a domain and a primary skill. The public API does not return `casel_competencies`, so which games are CASEL-tagged is still unread (needs the admin side or database access).
- **Domain labels to check:** Money Matters and Money Moves are tagged "wellness"; Headline and Critical Read "literacy". Whether those labels, and the 14-game seed in `seed-brain-games-domain-values.js` versus the newer games, match what the pages actually teach is a Phase 2 review item.

## Phase 1 results (built 2026-10-31; not yet deployed)

Done in `engine-sdk.js` only: the SDK now builds a fresh copy of each game's content for every run before the engine sees it, so no engine file and no game page changed except a `?v=2` cache tag on the SDK script.

- **Choice order is shuffled every round** in all five engine types (audio choice, evidence hunt, scenario choice, branching scenario, simulation). Opt out with `shuffleChoices: false` on the pack or on a round; keep a "None of these" last with `pinLast: true`.
- **Round order is shuffled** for the engines whose rounds are independent (audio choice, evidence hunt, scenario choice). Scenario steps and simulation events keep their order, because they build on each other.
- **Pools:** `roundsPerRun: N` draws N rounds at random from a bigger list. **Variants:** `variants: [...]` gives a scenario several complete versions and picks one per run. Neither is used by a game yet; they are what Phase 3 content fills.
- **`?seed=123`** on the game's address replays the exact same run, for reviewers and tests (not usable on the local preview server, which strips query strings; fine on the live site).
- **Analytics:** learning events now carry `sourceIndex` (the round's place in the authored list) and `variant`, so reports can still tell which content ran.
- **Tests:** `server/test/engine-content.test.js` (13 tests, 69 in the whole suite). It proves the right answer lands in every slot about equally, nothing is mutated, sequential engines keep order, pools and variants rotate, and every one of the 16 real game pages still has its right answer after shuffling and is no longer first-slot.
- **Browser check:** played Reading Detective (4 of 4, rounds in a different order, right answer first once), Decision Point (all 5 steps in order, responsible choice in slots 0, 1, 0, 0) and Money Matters (events in order, options shuffled) to the end on a local server; no JavaScript errors (the only console errors were 404s for `/api/*`, which the static preview server does not have).
- **What it does not fix:** each game still has only 4 or 5 rounds, so every run is the same content in a different order. Real variety needs the Phase 3 content pools. The right-answer problem is solved for all 16 games.

## Decisions I need from you

1. ~~Does every game need an SEL or PoG link, or only the SEL-domain ones?~~ **Settled: every game.** Original question: The legacy six are executive-function and maths games. Option A: they must map to a CASEL competency such as self-management or a PoG attribute such as critical thinking, with a rationale, or they are marked as "skills practice" and shown separately. Option B: they stay as they are, outside this requirement. I lean A, because you named SEL and PoG as the bar.
2. **Which Portrait of a Graduate is the reference?** PoG is per state and per district here. Options: the verified NY and OH frameworks, any verified framework, or one neutral list of attributes common across them. I lean on the verified NY and OH ones, since those are the only ones a person has signed off.
3. **Grade levels:** keep four bands, or add an explicit grade range per game (for example Grades 3 to 5)? I lean toward keeping the bands as the filter and adding the range as a label teachers see.
4. **What happens to a game that fails?** Deepen it, rework it, or hide it. Does hiding need your sign-off each time? I lean on: hide only with your say-so, deepen by default.
5. **Who reviews SEL content?** You, a teacher you trust, or an outside reviewer. This sets the pace of Phase 2 and 3.
6. **The rubric numbers** (3 times the pool, half overlap, 8 decisions, 8 to 10 minutes): are those right for your standard?
7. **D1 (ElevenLabs):** is the key live? It decides whether the audio games can pass test 1 or must carry a text transcript only.

## What this costs

Phases 0 and 1 are a few sessions of my work and are self-contained. Phase 2 is mostly your time reviewing my drafts. Phase 3 is the long tail: realistically a game or two per sitting once the engines support pools.

## Not covered

- New games. This plan only reverifies what exists.
- Admin visibility into game data (decision D4).
- The reward and XP system itself.
