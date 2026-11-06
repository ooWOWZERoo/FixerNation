# Release 141: the 14 new games, for your read and ear test

Written 2026-11-06 by Claude. **Built, tested and played in a browser, not committed to GitHub or deployed.** You asked for the 14 games named in my last two suggestions: nine core-skills games for Discover and Explore, and a second Self-Awareness game in every band (two in Advance). Content for all of them is data in `server/scripts/build-core-games.js`; this document is generated from it, so it matches what children see.

**What to do:** (1) read the five Self-Awareness check-ins in full (section 3: that is SEL wording, which you sign off); (2) skim the skills games (section 2); (3) listen to the 6 spoken Discover games in `docs/tune-your-brain/r141-discover-clips-audition.html` (open the file on your Mac): 259 new recorded clips, which I can check for length but not hear.

## 1. The 14 games

| Game | Band | Focus | Engine | Pool and run |
|---|---|---|---|---|
| 🎵 Rhyme Time | discover | literacy | audioChoice | 18 rounds, 5 per run |
| 🔤 Letter Sounds | discover | literacy | audioChoice | 14 rounds, 5 per run |
| ⚖️ More or Fewer | discover | math | audioChoice | 16 rounds, 5 per run |
| ➕ Add It Up | discover | math | audioChoice | 18 rounds, 5 per run |
| 🎨 Pattern Parade | discover | thinking | audioChoice | 16 rounds, 5 per run |
| 🐱 Animal Match | discover | thinking | memory | 8 animals, 4 pairs (?pairs=3, 4 or 6) |
| 🔎 Word Clues | explore | literacy | evidenceHunt | 12 rounds, 5 per run |
| ✖️ Times Table Trail | explore | math | audioChoice | 24 rounds, 8 per run |
| 🧮 Word Problem Workshop | explore | math | evidenceHunt | 12 rounds, 5 per run |
| 🪞 My Feelings Today | discover | self awareness | scenarioChoice | 3 questions, then a card |
| 🧠 What Helps Me | explore | self awareness | scenarioChoice | 3 questions, then a card |
| 🧭 Know Your Triggers | challenge | self awareness | scenarioChoice | 3 questions, then a card |
| 🔭 Know Yourself | advance | self awareness | scenarioChoice | 3 questions, then a card |
| 📡 Stress Signals | advance | self awareness | scenarioChoice | 3 questions, then a card |

All are in the coverage grid as counted games. Discover now has 3 literacy, 2 math, 2 thinking-skills and 2 Self-Awareness games; Explore has 2 literacy, 3 math and 2 Self-Awareness; Challenge and Advance each have 2 Self-Awareness. Everything else in the grid is unchanged (22 game slots are still under two; `node server/scripts/focus-coverage.js`).

## 2. Core-skills games (skim)

### Rhyme Time (K-2)

Hear "Which one rhymes with key?" with the picture of the key shown; pick one of three pictures. 18 rounds, e.g.:

- Which one rhymes with cat? → hat (others: moon, snake)
- Which one rhymes with hat? → bat (others: dish, rock)
- Which one rhymes with bat? → cat (others: pear, sun)
- Which one rhymes with dog? → log (others: mouse, chair)
- Which one rhymes with frog? → dog (others: ball, rock)
- Which one rhymes with cake? → snake (others: balloon, ball)
- Which one rhymes with moon? → spoon (others: dog, frog)
- Which one rhymes with balloon? → moon (others: fish, car)
- Which one rhymes with boat? → coat (others: frog, pear)
- Which one rhymes with goat? → boat (others: spoon, cake)
- Which one rhymes with fish? → dish (others: book, snake)
- Which one rhymes with clock? → sock (others: goat, frog)
- Which one rhymes with rock? → sock (others: hat, bear)
- Which one rhymes with mouse? → house (others: star, log)
- Which one rhymes with bee? → tree (others: log, fish)
- Which one rhymes with key? → bee (others: spoon, mouse)
- Which one rhymes with bear? → chair (others: spoon, sock)
- Which one rhymes with pear? → bear (others: coat, car)

### Letter Sounds (K-2)

Hear "Dog starts with which letter?" with the picture shown; pick the letter (upper or lower case). Letters: B D F H K L M N P R S T Z W. Look-alike letters (b/d/p) are never offered together. This is the opposite direction to Sound Safari (word to letter, not sound to picture). It needs your ear test on how Ava says the letter names ("bee", "dee", "eff", "aitch", "kay", "el", "em", "en", "pee", "are", "ess", "tee", "zee", "double you").

### More or Fewer (K-2)

Two groups of pictures (up to 10); "Which group has more cookies?" or "fewer". 16 rounds, always two clearly different counts.

### Add It Up (K-2)

Spoken number stories within 12, adding and taking away, e.g. "One birds are in a tree. One more fly in. How many now?" 18 rounds; wrong answers are one or two off.

### Pattern Parade (K-2)

The pattern is shown ("💧 💧 🍃 💧 💧 ❓") and spoken; pick what comes next. Patterns: AB, AAB, ABC, ABB, AABB, with colors, shapes and nature pictures. 16 rounds.

### Animal Match (K-2)

Flip cards to find matching animals (the memory engine that already existed, with a Discover skin). 4 pairs by default; `?pairs=3`, `4` or `6` changes it. No clock, no sound.

### Word Clues (grades 3-5): the 12 passages

1. The elephant was enormous. It was bigger than the truck beside it. The children had to look up to see its face.
   Q: What does the word "enormous" mean?
   Right: Very large in size. | Others: Very old and gray. | Very loud and busy.
   Proof sentence: "It was bigger than the truck beside it."

2. Dad packed the glass vase with care. It was fragile, and one bump could break it. He wrapped it in three thick towels.
   Q: What does the word "fragile" mean?
   Right: Easy to break or damage. | Others: Heavy and hard to lift. | Bright and full of color.
   Proof sentence: "It was fragile, and one bump could break it."

3. Water was scarce in the desert town. People saved every drop they could find. Some days there was barely enough to drink.
   Q: What does the word "scarce" mean?
   Right: Hard to find; not enough. | Others: Too cold to drink. | Wasted by everyone.
   Proof sentence: "Some days there was barely enough to drink."

4. Sam was reluctant to jump into the cold lake. He stood at the edge for a long time. He kept saying, "Maybe later."
   Q: What does the word "reluctant" mean?
   Right: Not wanting to do something. | Others: Very excited to start. | Too tired to move at all.
   Proof sentence: "He kept saying, "Maybe later.""

5. The museum had an ancient coin. It was made more than two thousand years ago. Visitors could see it behind glass.
   Q: What does the word "ancient" mean?
   Right: Very, very old. | Others: Very shiny and new. | Very small and light.
   Proof sentence: "It was made more than two thousand years ago."

6. Mia was cautious on the icy path. She took small steps and held the rail. She did not want to slip.
   Q: What does the word "cautious" mean?
   Right: Careful to stay safe. | Others: Quick and full of fun. | Sleepy and slow to wake.
   Proof sentence: "She took small steps and held the rail."

7. The puppy was frantic when the door shut. It ran in circles and barked loudly. It could not sit still.
   Q: What does the word "frantic" mean?
   Right: Wildly upset and rushed. | Others: Calm and half asleep. | Proud of what it did.
   Proof sentence: "It ran in circles and barked loudly."

8. Leo found a peculiar rock in the creek. It was purple and shaped like a star. He had never seen one like it.
   Q: What does the word "peculiar" mean?
   Right: Strange or not usual. | Others: Plain, gray and dull. | Heavy and wet and cold.
   Proof sentence: "He had never seen one like it."

9. The table was sturdy. Four grown-ups could stand on it without a wobble. It had been in the family for years.
   Q: What does the word "sturdy" mean?
   Right: Strong and steady. | Others: Small and easy to move. | Old and a little rusty.
   Proof sentence: "Four grown-ups could stand on it without a wobble."

10. The new kitten was timid. It hid under the couch when visitors came. It only came out when the room was quiet.
   Q: What does the word "timid" mean?
   Right: Shy and easily scared. | Others: Loud and full of play. | Hungry and looking for food.
   Proof sentence: "It hid under the couch when visitors came."

11. After the long hike, the family was famished. They ate three plates of pasta without stopping. Nobody left a single bite.
   Q: What does the word "famished" mean?
   Right: Very, very hungry. | Others: Very tired and sore. | Very cold and wet.
   Proof sentence: "They ate three plates of pasta without stopping."

12. The ocean looked vast from the top of the cliff. Blue water stretched in every direction. Ships looked like tiny dots.
   Q: What does the word "vast" mean?
   Right: Huge and wide open. | Others: Quiet and very still. | Warm and a bit salty.
   Proof sentence: "Blue water stretched in every direction."

### Word Problem Workshop (grades 3-5): the 12 problems

1. Ava has 14 stickers. She gives 6 to her cousin. How many does she have left?
   Right: 14 − 6 | Proof sentence: "She gives 6 to her cousin." | Giving some away takes some off, so subtract. 14 − 6 = 8.
2. There are 8 rows of chairs. Each row has 6 chairs. How many chairs are there in all?
   Right: 8 × 6 | Proof sentence: "Each row has 6 chairs." | Equal rows join together, so multiply. 8 × 6 = 48.
3. Sam saved $12 in May. He saved $9 in June. How much did he save in all?
   Right: 12 + 9 | Proof sentence: "He saved $9 in June." | Putting two amounts together means add. 12 + 9 = 21.
4. Mr. Cruz has 45 pencils. He shares them equally among 5 tables. How many pencils are at each table?
   Right: 45 ÷ 5 | Proof sentence: "He shares them equally among 5 tables." | Sharing equally means divide. 45 ÷ 5 = 9.
5. A bakery made 36 muffins. It sold 18 before noon. How many muffins are left?
   Right: 36 − 18 | Proof sentence: "It sold 18 before noon." | Some were sold, so take them away. 36 − 18 = 18.
6. Each bag holds 7 apples. Mia buys 9 bags. How many apples does she have?
   Right: 9 × 7 | Proof sentence: "Mia buys 9 bags." | Equal bags join together, so multiply. 9 × 7 = 63.
7. A book has 120 pages. Leo read 45 pages on Monday. How many pages are left?
   Right: 120 − 45 | Proof sentence: "Leo read 45 pages on Monday." | The pages he read come off the total. 120 − 45 = 75.
8. 24 students line up in 4 equal lines. How many students are in each line?
   Right: 24 ÷ 4 | Proof sentence: "24 students line up in 4 equal lines." | Equal lines share the students, so divide. 24 ÷ 4 = 6.
9. A store had 58 red balloons. It also had 27 blue balloons. How many balloons are there in all?
   Right: 58 + 27 | Proof sentence: "It also had 27 blue balloons." | Two groups together means add. 58 + 27 = 85.
10. Tia ran 3 miles each day. She did this for 5 days. How many miles did she run in all?
   Right: 3 × 5 | Proof sentence: "She did this for 5 days." | The same amount each day means multiply. 3 × 5 = 15.
11. A ribbon is 72 inches long. It is cut into 8 equal pieces. How long is each piece?
   Right: 72 ÷ 8 | Proof sentence: "It is cut into 8 equal pieces." | Equal pieces from one whole means divide. 72 ÷ 8 = 9.
12. Ben had $30. He bought a game for $18. How much money does he have now?
   Right: 30 − 18 | Proof sentence: "He bought a game for $18." | Spending takes money away, so subtract. 30 − 18 = 12.

### Times Table Trail (grades 3-5)

24 facts (multiplication to 10 x 10 and division), 8 per run, no clock. Wrong answers are common slips (one group too many or too few, or off by one).

## 3. The five Self-Awareness check-ins (SEL wording: please read all of it)

Each is a short check-in with no stories: three questions about the child, then a card built on screen from their picks. Nothing picked is logged, sent or saved; every question has a "not sure"; there is no free text and no scoring. They are short (about a minute), so they work as a quick routine or a warm-up.

### 🪞 My Feelings Today (discover, focus self awareness)

**Opening 1 of 3:** "Think about this morning. Only you see what you pick." Step 1 prompt: "How did you feel this morning? Pick one or two."

**Step 1 (pickMany)** Button: "I picked these".
- 😊 Happy → card: "I feel happy."
- 😢 Sad → card: "I feel sad."
- 😡 Angry → card: "I feel angry."
- 😨 Scared → card: "I feel scared."
- 😟 Nervous → card: "I feel nervous."
- 🤩 Excited → card: "I feel excited."
- 😎 Proud → card: "I feel proud."
- 😌 Calm → card: "I feel calm."
- I'm not sure

**Step 2 (pickOne)**: "Where do you feel it in your body?"
- My tummy → card: "I feel it in my tummy."
- My chest → card: "I feel it in my chest."
- My face → card: "I feel it in my face."
- My hands → card: "I feel it in my hands."
- Somewhere else → card: "I feel it somewhere else."
- I'm not sure

**Step 3 (pickOne)**: "What helps you with this feeling? Pick one."
- 🌬️ Slow breaths → card: "Slow breaths help me."
- 🗣️ Tell a grown-up → card: "Telling a grown-up helps me."
- 🏃 Move around → card: "Moving around helps me."
- 🤫 Sit somewhere quiet → card: "Sitting somewhere quiet helps me."
- I'm not sure

**Card "My feeling card":** "{item}", "{f2}", "{f3}". Empty card: "That is okay. Feelings can be hard to name." Closing: "Only you see this card. Grown-ups you trust can help with big feelings."

**Opening 2 of 3:** "Think about school today. Only you see what you pick." Step 1 prompt: "How do you feel at school? Pick one or two."

**Opening 3 of 3:** "Think about playing with friends. Only you see what you pick." Step 1 prompt: "How do you feel when you play? Pick one or two."

### 🧠 What Helps Me (explore, focus self awareness)

Intro: "This is about you. Only you see what you pick."

**Step 1 (pickMany)**: "Pick up to two things that help you learn." Button: "These help me".
- Moving a little first
- Drawing or doodling
- Talking it through
- Writing it down
- Working with a friend
- A quiet spot
- A short break
- A list of steps
- I'm not sure yet

**Step 2 (pickOne)**: "When is it hardest to focus?"
- When it is noisy
- When I am tired
- When the work is long
- When I am worried
- When I do not get it
- I'm not sure

**Step 3 (pickOne)**: "What could you try this week?"
- Ask for a quiet spot
- Take a short break each 15 minutes
- Make a list of steps first
- Work with a friend
- Draw it before I write
- I'm not sure

**Card "What helps me":** "What helps me learn: {w1|lower}.", "It is hardest for me to focus {w2|lower}.", "This week I will try this: {w3|lower}.". Empty card: "That is fine. You can find out what helps as you go." Closing: "Knowing what helps is a strength. Only you see this card."

### 🧭 Know Your Triggers (challenge, focus self awareness, also self management)

Intro: "This check-in is about you. Only you see your answers."

**Step 1 (pickMany)**: "Pick up to three things that make stress rise for you." Button: "These are mine".
- Deadlines
- Being left out
- Arguments
- Being compared to others
- Plans changing
- A bad grade
- Feeling watched
- Too much to do
- I'm not sure yet

**Step 2 (pickOne)**: "What do you notice first when stress rises?"
- My chest feels tight
- My thoughts race
- I get short with people
- I go quiet
- I want to avoid it
- I sleep badly
- I'm not sure

**Step 3 (pickOne)**: "What could help you notice it sooner?"
- A quick body check
- Naming the feeling
- A short pause
- Writing it down
- Telling someone I trust
- I'm not sure

**Card "My triggers":** "What raises my stress: {t1|lower}.", "First I notice: {t2|lower}.", "What could help me notice sooner: {t3|lower}.". Empty card: "That is fine. Triggers can take time to spot." Closing: "Noticing comes first. If stress feels too big, talk to an adult you trust."

### 🔭 Know Yourself (advance, focus self awareness)

Intro: "This is about what matters to you. Only you see what you pick."

**Step 1 (rank)**: "Pick the three priorities that matter most to you right now, in order." Button: "These are my top three".
- Health
- Family
- School
- Friends
- Money
- Fun
- Helping others
- Independence
- I'm not sure yet

**Step 2 (tradeoff)**: "Which would you protect?"
- health / school: "It is the night before a big exam. You can sleep or keep studying until midnight." → "Get a full night of sleep." or "Keep studying a few more hours." or "It depends"
- family / friends: "Your family dinner and a friend's party are on the same Saturday night." → "Go to the family dinner." or "Go to the party." or "It depends"
- money / fun: "You have a free weekend. You can work an extra shift or go on a trip with friends." → "Work the extra shift." or "Go on the trip." or "It depends"
- helping / independence: "A neighbor asks for help all afternoon. You planned that time for your own project." → "Help your neighbor." or "Keep the time for your project." or "It depends"
- school / fun: "A game night is on the same evening as a big assignment." → "Finish the assignment first." or "Go to game night." or "It depends"
- family / independence: "Your family wants you home. You have a chance to try something new on your own." → "Stay close to your family." or "Take the chance to go it alone." or "It depends"

**Step 3 (pickOne)**: "How did your week match {top.first|lower}?"
- A big choice did → card: "This week a big choice matched {top.first|lower}."
- A small choice did → card: "This week a small choice matched {top.first|lower}."
- Not yet → card: "My week did not match {top.first|lower} yet, and that is okay."
- I'm not sure

**Card "My priorities":** "My top three: {top|lower}.", "{trade}", "{week}". Empty card: "That is fine. Priorities can take time to sort out." Closing: "Priorities change as you do. Only you see this."

### 📡 Stress Signals (advance, focus self awareness, also self management)

Intro: "This check-in is about you. Only you see your answers."

**Step 1 (pickMany)**: "Which signs show up when stress builds? Pick up to three." Button: "These show up".
- Tight shoulders or jaw
- Headaches or a tight stomach
- Thoughts that will not slow down
- Thinking the worst will happen
- Snapping at people
- Pulling away from friends
- Putting things off
- Scrolling to avoid it
- I'm not sure yet

**Step 2 (pickOne)**: "Which kind of sign is easiest for you to miss?"
- Signs in my body
- Signs in my thoughts
- Signs in what I do
- I'm not sure

**Step 3 (pickOne)**: "What could help you check in earlier?"
- A two minute check-in each day
- A friend who knows my signs
- A note on my phone
- Slow breathing before big tasks
- I'm not sure

**Card "My stress signals":** "Signs I notice: {s1|lower}.", "The easiest kind for me to miss: {s2|lower}.", "What could help me check in earlier: {s3|lower}.". Empty card: "That is fine. Signs can take time to spot." Closing: "Everyone feels stress. If it is hard to handle, talk to a trusted adult or a counselor."

## 4. Questions for you

1. **Discover audio:** please listen to the clips (letter names in Letter Sounds and the "I feel…" cards in My Feelings Today first).
2. **Know Your Triggers and Stress Signals (grades 6-12):** the closing lines point to a trusted adult or counselor. Is the tone right, and is anything too close to a mental-health screening?
3. **Know Yourself:** the six tradeoff scenarios (sleep or study, family or friends, and so on) and their "It depends" answer.
4. **Thin games:** the five check-ins take about a minute. Do you want them deepened (more steps, or a second moment in the day) before they go live?
5. **Letter Sounds** tests the first letter of a word, not an isolated sound. Isolated sounds need the human recording you have not decided on.

## 5. Release notes

New database rows: run the 14 `seed-*-catalog-entry.js` scripts, then `seed-classroom-completion-badges.js` (14 new badges), then `seed-brain-games-focus-values.js` (confirms the focus). The audio engine is v7 and the check-in engine v9; the games page needs no change (it lists whatever the catalog holds).
