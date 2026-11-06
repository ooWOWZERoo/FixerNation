# Release 144: the last 12 games, for your read and ear test

Written 2026-11-06 by Claude. **Built, tested and played in a browser, committed locally, not pushed or deployed.** With these 12 games every grade band has at least two games in every focus: the coverage grid has no cell under two (`node server/scripts/focus-coverage.js`). Content is data in `server/scripts/core-games-last-group.js`; this document is generated from it.

| Game | Band | Focus | What the child does |
|---|---|---|---|
| ⏳ Wait for It | discover | self management | Listen to a waiting problem, then pick what helps you wait. |
| 🛑 Stop and Think | discover | responsible decision making | Listen to a problem, stop and think, then pick the safe choice. |
| 🧗 Stuck on It | explore | self management | Read about someone who is stuck, then pick what helps and find the proof. |
| ⏸️ Peer Pressure Pause | challenge | responsible decision making | Read a pressure situation, pick the best choice, then find the risk that proves it. |
| 🕵️ Tone Detective | challenge | literacy | Read a short passage, name the tone the author uses, then find the line that shows it. |
| 🏷️ Ratio Shop | challenge | math | Compare prices, find sale prices and scale recipes with ratios and percents. |
| ⏰ Deadline Crunch | advance | self management | Read a deadline problem, pick the plan that holds up, then find the proof. |
| ⚖️ Argument Check | advance | literacy | Read a short argument, spot the flaw in its reasoning, then find the weak step. |
| 📈 Graph Match | advance | math | Match a real-life story to the shape of its graph. |
| 📊 Stats Check | advance | math | Find the median, mean, mode and range, and spot a misleading chart or survey. |
| 🗓️ Plan It | advance | thinking | Read jobs and deadlines, pick the order that finishes everything on time, then find the key deadline. |
| 🔀 Switch Board | advance | thinking | Follow a rule that keeps changing, and work out each answer with no clock. |

**What to read (SEL wording):** Wait for It and Stop and Think (spoken, Discover), Stuck on It (Explore), Peer Pressure Pause (Challenge), Deadline Crunch (Advance). The three math games, Tone Detective, Argument Check, Plan It and Switch Board are skills practice; skim them. Listen to the two spoken games in `docs/tune-your-brain/r144-discover-clips-audition.html`.

**How the numbers are made:** Ratio Shop, Stats Check, Plan It and Switch Board compute their answers in code from the numbers in each question, and the tests recompute every one from the text, so an arithmetic mistake cannot ship. Plan It checks all six orders of the three jobs and offers only one that works. Graph Match has no pictures of graphs: the choices describe the shape ("Curve that speeds up") with a small icon.

## ⏳ Wait for It (discover)

1. You want a cookie. Dinner is in ten minutes. What helps you wait?
   Right: Wait for dinner. Others: Sneak a cookie, Shout for it.
2. It is not your turn on the slide. What helps you wait?
   Right: Stand and wait. Others: Cut in line, Cry.
3. Your friend is still talking. You have an idea. What helps?
   Right: Wait to speak. Others: Shout it out, Talk over them.
4. You want to open your gift now. The party is later. What helps?
   Right: Wait for the party. Others: Open it now, Hide it.
5. You want a toy at the store. Your mom says not today. What helps?
   Right: Say okay and wait. Others: Throw a fit, Grab it.
6. You feel mad when you lose a game. What helps?
   Right: Take a deep breath. Others: Hit the table, Throw the game.
7. The lunch line is long. What helps you wait?
   Right: Count to ten. Others: Push ahead, Leave.
8. It is bedtime. You want to stay up. What helps?
   Right: Go to bed now. Others: Hide and play, Argue.
9. A friend has the toy you want. What helps you wait?
   Right: Ask for a turn. Others: Cry, Take it.
10. The puzzle is hard and you feel upset. What helps?
   Right: Rest, then try again. Others: Throw the pieces, Quit.
11. Your teacher says wait until she finishes. What helps?
   Right: Sit quietly. Others: Call her name, Walk away.
12. You want to tell a secret. It is quiet time. What helps?
   Right: Save it for later. Others: Shout it, Whisper loudly.
13. You want the best seat. Others got there first. What helps?
   Right: Pick another seat. Others: Push them, Sulk.
14. You want to play a game. Homework comes first. What helps?
   Right: Do homework first. Others: Play secretly, Say it is done.

## 🛑 Stop and Think (discover)

1. Your ball rolls into the street. What do you do first?
   Right: Ask a grown-up. Others: Run after it, Close your eyes.
2. A stranger offers you candy. What do you do?
   Right: Say no, tell someone. Others: Take it, Go with them.
3. You find a pill on the floor. What do you do?
   Right: Tell a grown-up. Others: Pocket it, Taste it.
4. A snack sits on the hot stove. What do you do?
   Right: Ask a grown-up. Others: Touch it, Reach over it.
5. Your friend wants to climb a very high fence. What do you do?
   Right: Say it is risky. Others: Climb too, Cheer.
6. You see a lost kid crying. What do you do?
   Right: Get a grown-up. Others: Laugh, Walk away.
7. You broke a vase by accident. What do you do?
   Right: Tell the truth. Others: Hide it, Blame the dog.
8. Your friend says skip lining up. What do you do?
   Right: Line up with class. Others: Skip with them, Run away.
9. A dog you do not know runs to you. What do you do?
   Right: Stay calm, back up. Others: Run and scream, Pet it.
10. The floor is wet and has no sign. What do you do?
   Right: Walk slowly. Others: Run, Slide.
11. You want to cross the road. What do you do first?
   Right: Look both ways. Others: Run across, Close your eyes.
12. Your friend says do not tell, but someone is hurt. What do you do?
   Right: Tell a grown-up. Others: Ignore it, Keep the secret.
13. A box of matches is on the table. What do you do?
   Right: Leave it, tell someone. Others: Light one, Play with it.
14. You are mad at your friend. You want to hit. What do you do?
   Right: Stop and use words. Others: Hit, Throw something.

## 🧗 Stuck on It (explore)

1. Leo has worked on a hard math problem for twenty minutes. He rubs his forehead and sighs. His pencil presses so hard that the paper tears. He wants to throw the page away.
   Q: What should Leo do first?
   Right: Breathe slowly and rest a minute.
   Others: Rip up the page and start all over. | Tell himself he is just bad at math.
   Proof sentence: "His pencil presses so hard that the paper tears."

2. Maya is learning to ride a bike. She fell twice and her knee hurts. She says, "I give up. I will never get it." Her dad watches from the porch.
   Q: What would help Maya most?
   Right: Rest, then try again with a goal.
   Others: Quit biking for good, and never fall again. | Ask someone else to ride for her.
   Proof sentence: "She says, "I give up. I will never get it.""

3. Sam has a long book report due on Friday. It is Monday and he has not started. Every time he opens the file, he feels worried. He closes it and plays a game.
   Q: What should Sam do?
   Right: Write one small part today.
   Others: Wait until Thursday night. | Hope the teacher forgets about it.
   Proof sentence: "Every time he opens the file, he feels worried."

4. Nia is stuck on a jump rope trick. Her friends watch and giggle. Her face gets hot and she wants to leave. She notices her breathing is fast.
   Q: What could Nia do?
   Right: Slow her breathing and try again.
   Others: Leave and never try the trick again. | Tell her friends to go away.
   Proof sentence: "She notices her breathing is fast."

5. Ben is building a model, but one piece will not fit. He pushes harder and it cracks. He feels angry at himself. The steps are on the table.
   Q: What should Ben do?
   Right: Stop, breathe and reread the steps.
   Others: Force the next piece in even harder. | Throw the whole model away.
   Proof sentence: "He feels angry at himself."

6. Zoe has twenty spelling words to learn. She feels like it is too much to do. She looks at the whole list and freezes. Her teacher says to try five words at a time.
   Q: What would help Zoe?
   Right: Learn five words, then take a break.
   Others: Skip the list and hope for luck. | Try all twenty words at once.
   Proof sentence: "Her teacher says to try five words at a time."

7. Ravi lost his place in a long reading. His heart is pounding. He wants to put the book down. A friend says, "Take it one page at a time."
   Q: What would help Ravi?
   Right: Read one page, then check in.
   Others: Stop reading for the whole day. | Skip ahead to the end.
   Proof sentence: "A friend says, "Take it one page at a time.""

8. Ella keeps missing the shot in basketball. She slams the ball on the floor. Her coach says, "Take a breath and reset." Ella frowns but listens.
   Q: What should Ella do?
   Right: Take a breath and reset her feet.
   Others: Keep slamming the ball on the floor. | Blame the hoop and walk off.
   Proof sentence: "Her coach says, "Take a breath and reset.""

9. Kai has a science project with many steps. He gets stuck on step three and feels stuck. He decides to write a list of what to do next. His shoulders relax.
   Q: What helped Kai?
   Right: Making a list of small steps.
   Others: Waiting for it to feel easy. | Skipping the hard step for good.
   Proof sentence: "He decides to write a list of what to do next."

10. Ivy is learning a song on the piano. The fast part keeps going wrong. She wants to quit for the day. Her teacher says to play it slowly three times.
   Q: What should Ivy try?
   Right: Play the hard part slowly, a few times.
   Others: Play the whole song much faster. | Stop practicing for the week.
   Proof sentence: "Her teacher says to play it slowly three times."

## ⏸️ Peer Pressure Pause (challenge)

1. Dev's friends plan to skip last period and go to the mall. Dev has a test review in that class on Friday. Last week a student was suspended for skipping. His friends say, "Nobody will notice."
   Q: What is the best choice?
   Right: Say no, and offer to go after school instead.
   Others: Go along, since nobody will notice anything. | Leave quietly without telling his friends why.
   Proof sentence: "Last week a student was suspended for skipping."

2. Maya's group chat starts mocking a classmate's photo. Everyone adds laughing emojis under the post. Maya knows the classmate will probably see it. Her phone buzzes again.
   Q: What is the best choice?
   Right: Leave the chat and message the classmate kindly.
   Others: Add one emoji so the group does not turn on her. | Watch quietly and hope someone else speaks up.
   Proof sentence: "Maya knows the classmate will probably see it."

3. Sam's teammate offers him a drink at a party. Sam does not know what is in it. He has a game early the next morning. Others are watching to see what he does.
   Q: What is the best choice?
   Right: Say no thanks and take a soda instead.
   Others: Take the cup so nobody calls him boring. | Take it and pour it out when no one looks.
   Proof sentence: "Sam does not know what is in it."

4. Lena's friend copies answers from her notebook. He promises to study next time. The teacher warned that copying means a zero for both students. Lena wants to keep the friendship.
   Q: What is the best choice?
   Right: Say no, and offer to study together.
   Others: Let him copy once more since he promised. | Hide the notebook and avoid him all week.
   Proof sentence: "The teacher warned that copying means a zero for both students."

5. Omar's cousin wants him to ride in a car with a new driver. The driver likes to speed on the highway. Omar remembers a crash on that road last year. His cousin says it will be fun.
   Q: What is the best choice?
   Right: Decline the ride and ask a parent to pick him up.
   Others: Ride along because it would be rude to refuse. | Ride along but sit in the back and stay quiet.
   Proof sentence: "Omar remembers a crash on that road last year."

6. Rita's friends dare her to post a mean joke about a teacher. A post can stay online even after it is deleted. The school has a rule about posts like this. Rita does not want to be left out.
   Q: What is the best choice?
   Right: Pass on the dare and suggest a different joke.
   Others: Post it fast and delete it after a minute. | Post it, since it is only a joke among friends.
   Proof sentence: "A post can stay online even after it is deleted."

7. Theo is asked to share his friend's secret with the group. His friend told him in private. The group promises they will not tell anyone. Theo feels pulled in two directions.
   Q: What is the best choice?
   Right: Keep the secret, since it was shared in trust.
   Others: Share it, because the group promised to keep it. | Share only half so it is not really a betrayal.
   Proof sentence: "His friend told him in private."

8. Jada's friends want her to try a risky stunt on her bike. There is no helmet and the ramp is wet. Jada has a recital next week that uses her hands. Everyone is filming.
   Q: What is the best choice?
   Right: Skip it and offer to film from the side.
   Others: Do it once just to prove she is not scared. | Do a smaller version of the same risky stunt.
   Proof sentence: "There is no helmet and the ramp is wet."

9. A group asks Ben to help leave a classmate out of a project. The classmate is new and shy. The project needs all five members. One member says, "He will only slow us down."
   Q: What is the best choice?
   Right: Include the classmate and suggest a job for him.
   Others: Go with the group to keep things simple. | Stay out of it and let them decide.
   Proof sentence: "The project needs all five members."

10. Pia's friends pressure her to stay out past curfew. Her parents said they will stop letting her go out if she breaks it. She trusts her parents and wants more freedom later. The group says, "Just this once."
   Q: What is the best choice?
   Right: Head home on time and say she will join next time.
   Others: Stay out late and say she lost track of time. | Stay out late and turn her phone off.
   Proof sentence: "Her parents said they will stop letting her go out if she breaks it."

## 🕵️ Tone Detective (challenge)

1. The mayor's speech was long, and the crowd shifted in their seats. She read each number as though it were poetry. Nobody could find the point. By the end, even her aide checked a watch.
   Q: What is the narrator's tone?
   Right: Gently mocking, with a smile
   Others: Warm and full of deep admiration | Bitter and full of anger
   Proof sentence: "She read each number as though it were poetry."

2. After the storm, the farmers walked their fields in silence. The corn lay flat like a crushed green sea. One man picked up a single stalk and held it to the light. He whispered, "We will plant again."
   Q: What is the tone of the passage?
   Right: Quietly hopeful after a loss
   Others: Cheerful and carefree about it | Cold and uninterested in it
   Proof sentence: "He whispered, "We will plant again.""

3. The sign said "Please do not touch," so naturally I touched. The vase did not break, but the alarm went off like a siren. Three guards and a tour group turned to stare at me. I smiled and waved, like I had planned it.
   Q: What is the narrator's tone?
   Right: Humorous and teasing of himself
   Others: Serious and full of warning about it | Sad and full of regret
   Proof sentence: "I smiled and waved, like I had planned it."

4. The old house sat at the end of the lane, its windows dark. The gate hung open and creaked in the wind. A cold draft slid along the porch boards. Something moved behind the curtain.
   Q: What is the tone of the passage?
   Right: Tense and eerie, like a warning
   Others: Joyful and welcoming to all guests | Dull and plain with no feeling
   Proof sentence: "Something moved behind the curtain."

5. Grandpa still keeps the radio on the kitchen shelf. He says nothing sounds like it did back then. Every Sunday he hums along to songs we have never heard. His eyes go somewhere far away, soft and bright.
   Q: What is the tone of the passage?
   Right: Nostalgic, with a longing for the past
   Others: Impatient and annoyed with the radio | Frightened and tense about Sunday
   Proof sentence: "He says nothing sounds like it did back then."

6. Our school board has again voted to cut art and music. Once more, people who never visit classrooms made the call. They call it "efficiency," but we call it a loss. Students deserve better than a budget line.
   Q: What is the author's tone?
   Right: Frustrated and critical of the board
   Others: Neutral and fair to both sides of the vote | Amused and relaxed about the vote
   Proof sentence: "Once more, people who never visit classrooms made the call."

7. The coach clapped once, and the whole gym fell quiet. Every player stood straight, eyes forward. He studied the scoreboard for a long moment. Then he said, "I am proud of every one of you."
   Q: What is the tone of the passage?
   Right: Respectful, ending in pride
   Others: Cold and dismissive of the team | Fearful and anxious about a loss
   Proof sentence: "Then he said, "I am proud of every one of you.""

8. The new phone promises to change your life. It is thinner, faster, and costs only twice as much. Apparently the old one, bought last spring, is now a rock. Sign me up for another year of payments.
   Q: What is the author's tone?
   Right: Sarcastic about how much people spend
   Others: Sincere and excited about the new phone | Confused and lost about new phones
   Proof sentence: "Sign me up for another year of payments."

9. The rescue team had only minutes before the tide came in. Boots slammed on the wet sand as they ran. The leader shouted for the ropes again and again. Every second counted.
   Q: What is the tone of the passage?
   Right: Urgent and tense, with time running out
   Others: Relaxed and sleepy in the sun | Humorous and playful all through
   Proof sentence: "Every second counted."

10. When she opened the letter, her hands shook. The words said she had been accepted. She read it twice, then a third time. She laughed, then cried, then laughed again.
   Q: What is the tone of the passage?
   Right: Overjoyed and a little overwhelmed
   Others: Worried and unsure about the news | Bored and distant from the news
   Proof sentence: "She laughed, then cried, then laughed again."

## ⏰ Deadline Crunch (advance)

1. Nora has a history paper due Friday and a quiz on Thursday. She also has a work shift on Wednesday night. She tends to start the paper late and rush it. Her phone keeps buzzing with a group chat.
   Q: Which plan would serve Nora best?
   Right: Block an hour a day for the paper and mute the chat while she works.
   Others: Study for the quiz first, then write the paper on Thursday night. | Check the chat each time it buzzes so she never misses a single thing.
   Proof sentence: "She tends to start the paper late and rush it."

2. Amir is saving for a car and just got paid. His friends invite him to a concert that costs a week's pay. He has $400 saved and wants $1,500 by summer. He tells himself he can catch up later.
   Q: Which plan would serve Amir best?
   Right: Skip the concert and set aside a fixed amount from each paycheck.
   Others: Go to the concert this once, since he can always catch up later on. | Buy the ticket and plan to skip lunch for a month.
   Proof sentence: "He has $400 saved and wants $1,500 by summer."

3. Dana has three tests next week and a part-time job. She plans to study all night on Sunday. The last time she stayed up late, she could not remember anything. She has an hour free after school each day.
   Q: Which plan would serve Dana best?
   Right: Study in short daily sessions and protect her sleep.
   Others: Study all night Sunday, since it worked sometimes. | Skip the job so she has more time for the tests this week.
   Proof sentence: "The last time she stayed up late, she could not remember anything."

4. Eli keeps putting off an application due in ten days. Each time he sits down, he opens social media instead. He feels better for a minute and then worse. He knows the essay needs at least three drafts.
   Q: Which plan would serve Eli best?
   Right: Work in a timed block with his phone in another room.
   Others: Wait until he feels motivated enough to start the essay. | Write one long draft the night before it is due.
   Proof sentence: "Each time he sits down, he opens social media instead."

5. Tia is angry after a friend criticizes her work. She wants to send a long message right now. The last time she did that, it took weeks to repair. She has a deadline in an hour.
   Q: Which plan would serve Tia best?
   Right: Wait until the deadline passes, then reply.
   Others: Send it now to get it all off her chest. | Send a shorter message with fewer harsh words.
   Proof sentence: "The last time she did that, it took weeks to repair."

6. Marcus has practice, homework, and a younger brother to watch after school. He says yes to everything and runs out of time. His grades dropped and he feels worn out. He has not asked anyone for help.
   Q: Which plan would serve Marcus best?
   Right: Drop one activity and ask a parent to share the load.
   Others: Keep saying yes and work harder to catch up. | Stop doing homework until things calm down.
   Proof sentence: "He says yes to everything and runs out of time."

7. Jules wants to get fit and starts with two hours a day. By day three he is sore and skips. He feels he has failed and stops completely. A friend suggests a smaller start.
   Q: Which plan would serve Jules best?
   Right: Restart with twenty minutes a day he can keep.
   Others: Push harder until his body adjusts to two hours. | Wait for a new month to try the same plan.
   Proof sentence: "By day three he is sore and skips."

8. Sana has a big presentation tomorrow and a pile of dishes. She feels anxious and cleans instead of rehearsing. Her notes are still half finished. She has three hours before bed.
   Q: Which plan would serve Sana best?
   Right: Finish her notes first, then rehearse once out loud.
   Others: Clean until she feels calm, then look over the notes. | Rehearse in her head while she does the dishes.
   Proof sentence: "She feels anxious and cleans instead of rehearsing."

9. Owen checks his phone often during study time. Each check takes about two minutes and pulls him away. In an hour he checks it fifteen times. He wants to finish a chapter tonight.
   Q: Which plan would serve Owen best?
   Right: Put the phone out of reach for a full study block.
   Others: Check it only when a message really looks important. | Promise himself to check it less than usual.
   Proof sentence: "In an hour he checks it fifteen times."

10. Priya wants to stop eating lunch alone in her car. She feels nervous about joining the cafeteria crowd. A friend always saves her a seat. She tells herself she will go next week.
   Q: Which plan would serve Priya best?
   Right: Go tomorrow for ten minutes and sit by her friend.
   Others: Wait until she feels ready to join everyone. | Keep eating in the car, since it is calm.
   Proof sentence: "A friend always saves her a seat."

## ⚖️ Argument Check (advance)

1. Our school should ban all phones. Last week a student texted during a test. If phones stay, cheating will take over every class. So banning phones is the only answer.
   Q: What is the flaw in the argument?
   Right: It jumps from one incident to every class.
   Others: It gives so many examples that it becomes unclear. | It attacks the person who owns the phone.
   Proof sentence: "If phones stay, cheating will take over every class."

2. Dr. Reyes says this diet works. She is a famous TV chef with millions of followers. Millions of people cannot be wrong. So everyone should try it.
   Q: What is the flaw in the argument?
   Right: It relies on popularity, not evidence about the diet.
   Others: It uses too much medical language for readers to follow. | It does not name the chef clearly enough.
   Proof sentence: "Millions of people cannot be wrong."

3. My opponent wants more bike lanes. He also failed his driving test twice. A person like that cannot plan a city. Vote for me instead.
   Q: What is the flaw in the argument?
   Right: It attacks the person instead of the bike lane plan.
   Others: It offers evidence from city studies about bike lanes. | It compares two bike lane plans with care.
   Proof sentence: "He also failed his driving test twice."

4. Either we cut the arts budget or the school closes. There is no other choice. The council has to cut the budget. Our community must accept it.
   Q: What is the flaw in the argument?
   Right: It claims there are only two options.
   Others: It explains how a school budget is built. | It lists many options in careful detail.
   Proof sentence: "There is no other choice."

5. Since I started wearing this bracelet, I have not been sick. That is three months with no cold. The bracelet obviously keeps people healthy. Everyone should buy one.
   Q: What is the flaw in the argument?
   Right: It treats two events together as cause and effect.
   Others: It uses a large survey to support the claim. | It admits the bracelet might not work at all.
   Proof sentence: "The bracelet obviously keeps people healthy."

6. Every student who joined the debate club improved their grades. So the club made them smarter. Strong students may be the ones who choose to join. The data cannot say which came first.
   Q: What is the best criticism of the claim that the club improved grades?
   Right: Stronger students may be the ones who join.
   Others: The club meets too late in the day. | Grades are not important to students.
   Proof sentence: "Strong students may be the ones who choose to join."

7. A new study says teens sleep eight hours a night. It surveyed forty students at one school. The study was funded by a mattress company. The company says all teens sleep fine.
   Q: Why should we be careful about the study?
   Right: The sample is small and the funder may be biased.
   Others: Eight hours is always too little for teens. | The study was published much too recently to trust.
   Proof sentence: "The study was funded by a mattress company."

8. The minister said the new road will cut travel time in half. He gave no figures or sources. Everyone nearby agrees it is a great idea. We should build it now.
   Q: What is the weakness in this argument?
   Right: It offers an opinion with no evidence.
   Others: It gives so many sources that readers get lost. | It focuses only on the cost of the road.
   Proof sentence: "He gave no figures or sources."

9. I tried that tutor once and failed my quiz. So tutors do not work. I will not waste more time on them. My friends can help me instead.
   Q: What is the flaw in the argument?
   Right: One experience is used to judge every tutor.
   Others: The tutor was too expensive for a student. | The quiz was too hard to be a fair test.
   Proof sentence: "So tutors do not work."

10. If we let students choose their seats, soon they will choose their grades. Then they will choose the school rules. Before long, nobody will be in charge. So seats must stay assigned.
   Q: What is the flaw in the argument?
   Right: It says one small step leads to a huge chain.
   Others: It backs its claims with data from many schools. | It compares assigned seats to other methods.
   Proof sentence: "If we let students choose their seats, soon they will choose their grades."

## Samples of the generated games

- **Ratio Shop** (20 items, 8 per run). Example: Which is the better buy: 3 notebooks for $4.50, or 5 notebooks for $6.50?
- **Graph Match** (14 items, 6 per run). Example: A gym charges $20 to join and $30 each month. How does the total cost look on a graph?
- **Stats Check** (13 items, 6 per run). Example: Scores: 70, 85, 85, 90, 100. What is the median?
- **Plan It** (10 items, 5 per run). Example: It is 1 pm and you have three jobs to finish, one at a time. Study takes 2 hours and is due by 4 pm. Essay takes 2 hours and is due by 7 pm. Chores takes 2 hours and is due by 6 pm.
- **Switch Board** (24 items, 10 per run). Example: Rule: DOUBLE. Number: 14

## Questions for you

1. **Stop and Think** has safety content (a stranger, a pill, a stove, matches, a strange dog). Is each one right for ages 5 to 8, and is the wording calm enough?
2. **Peer Pressure Pause** names skipping class, a drink at a party, an unsafe car ride and a risky stunt for ages 11 to 13. Are those right for grades 6 to 8?
3. **Argument Check** and **Tone Detective** use made-up examples (a bracelet, a TV chef, a mayor's speech). Any you would change?
4. **Switch Board** has no clock by design. Is a game with only a rule that keeps changing enough "thinking skills" for Advance, or do you want a timed version later?
5. Listen to the clips for Wait for It and Stop and Think.

## Release notes

Deploy: pull, rsync, then the 12 catalog scripts, the badge script (12 new badges) and the focus script. No restart.
