# Reading Detective, Headline and Critical Read: redesign (DRAFT awaiting owner approval)

Written 2026-10-31. Design and one sample item per game only; no game has been changed. The owner approved doing this work ("YES" to longer passages and better wrong answers); this note says how, so you can correct the approach before I write 12 items per game.

## What is wrong today (from `GAME_SCORECARD.md`)

- **A pattern beats reading.** In Headline and Critical Read the right answer is always the careful, hedged one and the wrong ones are loud extremes; in Reading Detective the wrong ones are silly. A student can pass by tone.
- **The right answer is the longest option in every round** (12 of 12 across the three games).
- **The supporting sentence sits in the same few places** (Headline: second sentence in 3 of 4 items).
- **Passages are short and plain** (3 sentences each), below the band they are tagged for. Four items per game, always in the same set.

## Rules for every new item (a test enforces the measurable ones)

1. **Wrong answers must each be tempting for a different reason.** At least two of these per item, never the same pair every time: *true but not the point*, *over-states*, *under-states* (the cynical over-correction), *mixes up a number or who did what*, *needs information the text does not give*.
2. **Hedged is not always right.** In about a third of items the correct answer is the bold or plain one, because the facts are bold or plain.
3. **Balanced length:** the right answer is the longest in at most 1 of 3 items, and no option is more than 1.4 times another's length.
4. **The supporting sentence moves around:** spread across first, middle and last, with items where it takes two sentences read together.
5. **Passage length by band:** Reading Detective (grades 3-5) 5 to 7 sentences; Headline (grades 6-8) 4 to 6 sentences with numbers that need a little arithmetic; Critical Read (grades 9-12) 5 to 7 sentences with a source, a claim and a gap.
6. **Reading level is measured**, not guessed: I will add a Flesch-Kincaid grade estimate to the audit script and report it per item; the target is the band's own range, plus or minus one grade.
7. **Pools:** 12 items per game, 6 drawn per run (`roundsPerRun`), so two runs share about half their items at most.
8. **No real people, schools or brands;** invented names, mixed.
9. **Feedback explains the thinking** (using the per-choice `feedback` and the round `explanation` the audio engine already supports for audio games; the evidence engine already has `explanation`), never just "correct".

## One sample item each (for your reaction to difficulty and tone)

**Reading Detective (grades 3-5)** — *passage:* Maya's class planted bean seeds in two cups on Monday. She put one cup on the sunny windowsill and the other inside a dark cupboard. By Friday, the windowsill cup had a tall green sprout. The cupboard cup had a pale, thin sprout that was bending toward a crack of light by the door. Maya wrote in her notebook, "Plants lean toward light." Her teacher asked how she knew.
*Question:* What did Maya most likely notice that made her write that?
- *(right)* The sprout in the cupboard was bending toward the crack of light by the door.
- The sprout on the windowsill was taller, so light must make plants grow faster.
- The sprout in the cupboard was pale because it had not been given any water.
*Supporting sentence:* the fourth. *Why the wrong ones tempt:* the second is true but answers a different question; the third needs information the passage never gives.

**Headline (grades 6-8)** — *snippet:* A school survey asked students whether they walk to school. This year 54 of 120 students said yes. Last year 45 of 90 students said yes. The student council plans to ask again in the spring.
*Question:* Which headline is most accurate?
- *(right)* Fewer Students Walk to School Than Last Year, as a Share of Those Surveyed
- More Students Walk to School Than Last Year
- Nearly Half of Students Walk to School Every Day
*Supporting sentence:* the third (45 of 90 is 50 percent; 54 of 120 is 45 percent). *Why the wrong ones tempt:* the first wrong headline is true as a count (54 is more than 45) and false as a share; the second rounds 45 percent up and invents "every day".

**Critical Read (grades 9-12)** — *passage:* A wellness company's report says users of its app "improved focus by 40 percent." The report is based on 200 users who chose to take a focus quiz before and after 30 days of use. There was no group of non-users to compare against, and the quiz was written by the company.
*Question:* Which conclusion does the passage best support?
- *(right)* Users scored higher after 30 days, but the report cannot show that the app caused it.
- The app clearly works, since a 40 percent improvement is large.
- The report is worthless, because a company wrote it about its own product.
*Supporting sentence:* the third. *Why the wrong ones tempt:* one is the naive reading, one is the cynical over-correction; the right answer sits between them, but not because it is hedged: it is the only one the evidence allows.

## What I would build, in order

1. Add the reading-level estimate and the "supporting sentence position" check to the audit script (read-only).
2. Draft 12 items per game as an outline (the trap type of each wrong answer, the supporting sentence position, the topic), for your approval, then full text.
3. Put each pool in its page with `roundsPerRun: 6`, add tests (length balance, spread of evidence positions, distinct trap types, reading level in range), play each game through in a browser, and bring the finished text back for your read.

## Decisions for you

1. **Do the three samples feel right** in difficulty and tone for their bands?
2. **Topics:** school life, science, media, money, community news. Anything you want avoided or added (for example no health claims, or more science)?
3. **Go ahead with the outlines** (step 2) for all three games, or start with one?
