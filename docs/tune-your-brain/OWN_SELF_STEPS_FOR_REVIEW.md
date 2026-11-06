# "Your turn" finales for Strength Spotter and Values Compass: wording for your read (Release 138)

Written 2026-11-06 by Claude. **Built, tested and played in a browser, but not committed or deployed.** You approved the outlines (`docs/reference/own-self-steps-outlines.md`) with the recommended answers; this is the wording and behaviour they produced, for your read before anything deploys. Generated from the pages themselves, so it matches what a child will see. Feelings Detective is a separate release (it needs recorded clips and your ear test).

**What every part shares:** nothing the child picks is logged, sent or saved (only "this step was reached" and "answered"); there is always a "not sure" answer; no free text; nothing is scored; the card is built on screen from their own picks and read aloud. The finale replaces the old two questions after every story.

**What to check as you read:** (1) the growth steps in Strength Spotter are advice to a child, so read each one; (2) the six tradeoff scenarios and their cards in Values Compass (no right answer; the cards only describe the choice); (3) the closing lines.

## Strength Spotter (Explore, grades 3-5)

**Per story:** one tap after each story. "Is this strength like you?" Yes / A little / Not yet. No second question, no closing line. Stories per run: 4 of 12 (was 5).

**Your turn intro (read aloud):** "Now it is your turn. Only you see what you pick."

### Step 1: pickMany

Prompt: "Pick up to two strengths that sound like you." Button: "These sound like me". Up to 2.

- Patience
- Persistence
- Kindness
- Courage
- Curiosity
- Responsibility
- Listening
- Creativity
- I'm not sure yet (always available)

### Step 2: pickOne

Prompt: "Where have you used it lately?"

- At school → card: "I use {s1.first|lower} at school."
- At home → card: "I use {s1.first|lower} at home."
- With friends → card: "I use {s1.first|lower} with friends."
- In a sport or hobby → card: "I use {s1.first|lower} in a sport or hobby."
- Somewhere else → card: "I use {s1.first|lower} in other places."
- I'm not sure (always available)

### Step 3: pickOne

Prompt: "Pick one small way to grow your {s1.first|lower}." (if they were not sure earlier: "Pick one small step you could try.")


One small way to grow it, depending on the first strength picked:

- **patience:** "Count to five before you answer someone."  |  "Ask for one more minute when you feel rushed."  |  "Take one slow breath before you start the next thing."
- **persistence:** "Try a hard thing one more time before you quit."  |  "Break a big job into three small steps."  |  "Ask someone how they kept going on something hard."
- **kindness:** "Do one kind thing for someone every day this week."  |  "Notice who looks left out and say hello."  |  "Say thank you to someone who helped you."
- **courage:** "Say your idea out loud in class once."  |  "Try one thing you have been nervous about."  |  "Ask for help when something feels too big."
- **curiosity:** "Ask one new question about something you like."  |  "Read or watch something about a topic you know little about."  |  "Try one thing a new way and see what happens."
- **responsibility:** "Finish one job at home without being reminded."  |  "Write down what you need to bring tomorrow."  |  "Tell the truth when you make a mistake."
- **listening:** "Look at the speaker and wait until they finish."  |  "Say back what you heard before you answer."  |  "Ask one question about what someone just said."
- **creativity:** "Draw, build or write something new this week."  |  "Make up a second way to solve a problem."  |  "Change one thing in a game or story to make it yours."
- **if they were not sure:** "Notice one thing you did well today."  |  "Ask someone what they think you are good at."  |  "Try something new this week and see how it feels."

### Result card: "My strength card"

- "My strength: {s1|lower}." (only when s1 was answered)
- "{s2}" (only when s1 and s2 was answered)
- "My next step: {s3|lower}" (only when s3 was answered)
- If nothing can be built: "That is fine. Strengths can take time to notice."
- Closing line: "Everyone has strengths, and they can grow. Only you see this card."
- Button: "Finish"

## Values Compass (Challenge, grades 6-8)

**Per story:** one tap after each story. "Does this value matter to you?" Yes / A little / Not sure. No second question, no closing line. Stories per run: 4 of 12 (was 5).

**Your turn intro (read aloud):** "Now it is your turn. Only you see what you pick."

### Step 1: rank

Prompt: "Pick the three values that matter most to you right now, in order." Button: "These are my top three". Up to 3.

- Honesty
- Fairness
- Loyalty
- Respect
- Responsibility
- Courage
- Independence
- Generosity
- I'm not sure yet (always available)

### Step 2: tradeoff

Prompt after the setup: "Which would you protect?" Options: the two actions below, plus "It depends". The game picks the pair that overlaps the child's ranked values most; with no ranking it uses the first.

- **honesty and loyalty.** Setup: "A friend broke a school rule and asks you to say they were with you. The truth could get them in trouble."
  - honesty: "Tell the truth, even if your friend is upset." → card: "When honesty and loyalty pulled apart, I leaned toward honesty."
  - loyalty: "Cover for your friend this one time." → card: "When honesty and loyalty pulled apart, I leaned toward loyalty."
  - it depends → card: "When honesty and loyalty pulled apart, I said it depends."
- **fairness and loyalty.** Setup: "Your friend sits on the committee that picks a contest winner. They ask you to vote for their entry, but another entry is better."
  - fairness: "Vote for the entry you think is better." → card: "When fairness and loyalty pulled apart, I leaned toward fairness."
  - loyalty: "Vote for your friend's entry." → card: "When fairness and loyalty pulled apart, I leaned toward loyalty."
  - it depends → card: "When fairness and loyalty pulled apart, I said it depends."
- **honesty and respect.** Setup: "A classmate shows you a poem they are proud of. You think it needs work, and they ask what you think."
  - honesty: "Say plainly what needs work, in a kind way." → card: "When honesty and respect pulled apart, I leaned toward honesty."
  - respect: "Talk about what works and leave out the rest." → card: "When honesty and respect pulled apart, I leaned toward respect."
  - it depends → card: "When honesty and respect pulled apart, I said it depends."
- **independence and responsibility.** Setup: "You want Saturday for your own project. Your family needs you to watch your little brother."
  - independence: "Work on your project and offer to help another day." → card: "When independence and responsibility pulled apart, I leaned toward independence."
  - responsibility: "Watch your brother and work on the project later." → card: "When independence and responsibility pulled apart, I leaned toward responsibility."
  - it depends → card: "When independence and responsibility pulled apart, I said it depends."
- **generosity and fairness.** Setup: "Your group earned a reward for finishing first. A friend in another group worked just as hard and got nothing."
  - generosity: "Share part of your reward with your friend." → card: "When generosity and fairness pulled apart, I leaned toward generosity."
  - fairness: "Keep it, because your group earned it." → card: "When generosity and fairness pulled apart, I leaned toward fairness."
  - it depends → card: "When generosity and fairness pulled apart, I said it depends."
- **courage and respect.** Setup: "Most of your class is voting one way. You disagree, and saying so might upset some classmates."
  - courage: "Share your view calmly anyway." → card: "When courage and respect pulled apart, I leaned toward courage."
  - respect: "Stay quiet this time to keep things calm." → card: "When courage and respect pulled apart, I leaned toward respect."
  - it depends → card: "When courage and respect pulled apart, I said it depends."

### Step 3: pickOne

Prompt: "Where did you act on {top.first|lower} this week?" (if they were not sure earlier: "Where did you act on something you care about this week?")

- At school → card: "This week I acted on {top.first|lower} at school."
- At home → card: "This week I acted on {top.first|lower} at home."
- Online → card: "This week I acted on {top.first|lower} online."
- With friends → card: "This week I acted on {top.first|lower} with friends."
- Not yet → card: "I have not acted on {top.first|lower} yet this week, and that is okay."
- I'm not sure (always available)

### Result card: "My compass"

- "My top three: {top|lower}." (only when top was answered)
- "{trade}" (only when trade was answered)
- "{where}" (only when top and where was answered)
- If nothing can be built: "That is fine. Values can take time to sort out."
- Closing line: "Values can change as you grow. Only you see this."
- Button: "Finish"

## Questions for you

1. Are the 24 growth steps right in tone for grades 3 to 5 (advice, not instruction)? Any to cut or change?
2. Values Compass: are the six tradeoff scenarios suitable for grades 6 to 8, and is "It depends" an acceptable third answer on each?
3. Is it right that the Values Compass card says which value they leaned toward ("I leaned toward loyalty")? It describes a choice in a made-up situation, not the child.
4. Anything the child could read as a judgment of them (for example "Not yet" in Strength Spotter's per-story tap)?
