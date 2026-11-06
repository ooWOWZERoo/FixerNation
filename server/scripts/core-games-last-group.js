// Release 144: the last 12 games that bring every grade band x focus up to two games. Content is data here; build-core-games.js writes each page and
// catalog script from it and server/test/last-group-games.test.js checks it.
//   Self-Management:   Wait for It (Discover, spoken), Stuck on It (Explore), Deadline Crunch (Advance)
//   Responsible Decision-Making: Stop and Think (Discover, spoken), Peer Pressure Pause (Challenge)
//   Literacy:          Tone Detective (Challenge), Argument Check (Advance)
//   Math:              Ratio Shop (Challenge), Graph Match and Stats Check (Advance)
//   Thinking Skills:   Plan It and Switch Board (Advance)
// All sums, orders and statistics are computed in code from the numbers in each item, so they cannot be wrong; the test recomputes them from the text.
// Wrong answers are written about as long as the right one (the test fails if the right answer is the longest in more than 5 of 10 items).
const { round, spread, hunt } = require('./core-games-relationships');

const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr, n, r) => shuffle(arr, r).slice(0, n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function waitForIt() {
  return spread([
    round('You want a cookie. Dinner is in ten minutes. What helps you wait?', ['⏳', 'Wait for dinner', 'wait for dinner'], [['🍪', 'Sneak a cookie', 'sneak a cookie'], ['😠', 'Shout for it', 'shout for it']], 'Waiting a little gets you a better meal.'),
    round('It is not your turn on the slide. What helps you wait?', ['🧍', 'Stand and wait', 'stand and wait'], [['🏃', 'Cut in line', 'cut in line'], ['😭', 'Cry', 'cry']], 'Waiting your turn is fair to everyone.'),
    round('Your friend is still talking. You have an idea. What helps?', ['🤐', 'Wait to speak', 'wait to speak'], [['🗣️', 'Talk over them', 'talk over them'], ['📢', 'Shout it out', 'shout it out']], 'Waiting lets your friend finish.'),
    round('You want to open your gift now. The party is later. What helps?', ['🎁', 'Wait for the party', 'wait for the party'], [['📦', 'Open it now', 'open it now'], ['🙈', 'Hide it', 'hide it']], 'Waiting makes the surprise more fun.'),
    round('You want a toy at the store. Your mom says not today. What helps?', ['👍', 'Say okay and wait', 'say okay and wait'], [['😤', 'Throw a fit', 'throw a fit'], ['🤲', 'Grab it', 'grab it']], 'You can feel sad and still wait.'),
    round('You feel mad when you lose a game. What helps?', ['🌬️', 'Take a deep breath', 'take a deep breath'], [['💥', 'Throw the game', 'throw the game'], ['✊', 'Hit the table', 'hit the table']], 'A deep breath helps you calm down.'),
    round('The lunch line is long. What helps you wait?', ['🔢', 'Count to ten', 'count to ten'], [['🫸', 'Push ahead', 'push ahead'], ['🚶', 'Leave', 'leave']], 'Counting makes waiting easier.'),
    round('It is bedtime. You want to stay up. What helps?', ['🛏️', 'Go to bed now', 'go to bed now'], [['🤫', 'Hide and play', 'hide and play'], ['😠', 'Argue', 'argue']], 'Sleep helps you feel good tomorrow.'),
    round('A friend has the toy you want. What helps you wait?', ['🙋', 'Ask for a turn', 'ask for a turn later'], [['🫳', 'Take it', 'take it'], ['😢', 'Cry', 'cry']], 'Asking and waiting is kind and fair.'),
    round('The puzzle is hard and you feel upset. What helps?', ['😮‍💨', 'Rest, then try again', 'rest then try again'], [['💥', 'Throw the pieces', 'throw the pieces'], ['🚪', 'Quit', 'quit']], 'A short rest helps you try again.'),
    round('Your teacher says wait until she finishes. What helps?', ['🧘', 'Sit quietly', 'sit quietly'], [['📣', 'Call her name', 'call her name'], ['🚶', 'Walk away', 'walk away']], 'Sitting quietly helps you wait.'),
    round('You want to tell a secret. It is quiet time. What helps?', ['💭', 'Save it for later', 'save it for later'], [['🗣️', 'Whisper loudly', 'whisper loudly'], ['📢', 'Shout it', 'shout it']], 'Good things can wait for the right time.'),
    round('You want the best seat. Others got there first. What helps?', ['🪑', 'Pick another seat', 'pick another seat'], [['🫸', 'Push them', 'push them'], ['😒', 'Sulk', 'sulk']], 'Another seat is fine, and it is calm.'),
    round('You want to play a game. Homework comes first. What helps?', ['📚', 'Do homework first', 'do homework first'], [['🎮', 'Play secretly', 'play secretly'], ['🙊', 'Say it is done', 'say it is done']], 'Work first, then play feels better.'),
  ]);
}

function stopAndThink() {
  return spread([
    round('Your ball rolls into the street. What do you do first?', ['🛑', 'Ask a grown-up', 'ask a grown-up'], [['🏃', 'Run after it', 'run after it'], ['🙈', 'Close your eyes', 'close your eyes']], 'Streets can be dangerous, so stop and ask.'),
    round('A stranger offers you candy. What do you do?', ['🙅', 'Say no, tell someone', 'say no and tell someone'], [['🍬', 'Take it', 'take it'], ['🚶', 'Go with them', 'go with them']], 'You stay safe by saying no and telling a grown-up.'),
    round('You find a pill on the floor. What do you do?', ['🧑‍⚕️', 'Tell a grown-up', 'tell a grown-up'], [['👅', 'Taste it', 'taste it'], ['👖', 'Pocket it', 'put it in your pocket']], 'Pills can be harmful, so tell a grown-up.'),
    round('A snack sits on the hot stove. What do you do?', ['🙋', 'Ask a grown-up', 'ask a grown-up'], [['✋', 'Touch it', 'touch it'], ['🫳', 'Reach over it', 'reach over it']], 'Hot things can burn, so ask for help.'),
    round('Your friend wants to climb a very high fence. What do you do?', ['⚠️', 'Say it is risky', 'say it is not safe'], [['🧗', 'Climb too', 'climb too'], ['👏', 'Cheer', 'cheer']], 'A good friend says when something is not safe.'),
    round('You see a lost kid crying. What do you do?', ['🧑‍🏫', 'Get a grown-up', 'get a grown-up'], [['🚶', 'Walk away', 'walk away'], ['😂', 'Laugh', 'laugh']], 'A grown-up can help the lost child.'),
    round('You broke a vase by accident. What do you do?', ['🗣️', 'Tell the truth', 'tell the truth'], [['🙈', 'Hide it', 'hide it'], ['🐶', 'Blame the dog', 'blame the dog']], 'Telling the truth fixes the problem.'),
    round('Your friend says skip lining up. What do you do?', ['🧍', 'Line up with class', 'line up with the class'], [['🏃', 'Skip with them', 'skip with them'], ['🙈', 'Run away', 'run away']], 'Following the rule keeps everyone safe.'),
    round('A dog you do not know runs to you. What do you do?', ['🐕', 'Stay calm, back up', 'stay calm and back up'], [['🤚', 'Pet it', 'pet it'], ['😱', 'Run and scream', 'run and scream']], 'Staying calm is safest with a strange dog.'),
    round('The floor is wet and has no sign. What do you do?', ['🚶', 'Walk slowly', 'walk slowly'], [['🏃', 'Run', 'run'], ['⛸️', 'Slide', 'slide']], 'Walking slowly keeps you from falling.'),
    round('You want to cross the road. What do you do first?', ['👀', 'Look both ways', 'look both ways'], [['🏃', 'Run across', 'run across'], ['🙈', 'Close your eyes', 'close your eyes']], 'Looking first keeps you safe.'),
    round('Your friend says do not tell, but someone is hurt. What do you do?', ['🧑‍🏫', 'Tell a grown-up', 'tell a grown-up'], [['🤐', 'Keep the secret', 'keep the secret'], ['🙄', 'Ignore it', 'ignore it']], 'Someone who is hurt needs help.'),
    round('A box of matches is on the table. What do you do?', ['🙋', 'Leave it, tell someone', 'leave it and tell someone'], [['🔥', 'Light one', 'light one'], ['🎲', 'Play with it', 'play with it']], 'Matches are not toys.'),
    round('You are mad at your friend. You want to hit. What do you do?', ['🗣️', 'Stop and use words', 'stop and use words'], [['👊', 'Hit', 'hit'], ['💥', 'Throw something', 'throw something']], 'Words fix problems and hitting does not.'),
  ]);
}

function stuckOnIt() {
  return hunt('so', [
    [['Leo has worked on a hard math problem for twenty minutes.', 'He rubs his forehead and sighs.', 'His pencil presses so hard that the paper tears.', 'He wants to throw the page away.'], 'What should Leo do first?', 'Breathe slowly and rest a minute.', ['Rip up the page and start all over.', 'Tell himself he is just bad at math.'], 2, 'The torn paper shows how upset he is. A rest helps him think again.'],
    [['Maya is learning to ride a bike.', 'She fell twice and her knee hurts.', 'She says, "I give up. I will never get it."', 'Her dad watches from the porch.'], 'What would help Maya most?', 'Rest, then try again with a goal.', ['Quit biking for good, and never fall again.', 'Ask someone else to ride for her.'], 2, 'She said she gives up. A small goal makes trying again feel possible.'],
    [['Sam has a long book report due on Friday.', 'It is Monday and he has not started.', 'Every time he opens the file, he feels worried.', 'He closes it and plays a game.'], 'What should Sam do?', 'Write one small part today.', ['Wait until Thursday night.', 'Hope the teacher forgets about it.'], 2, 'Worry makes him avoid it. One small part is easier to start.'],
    [['Nia is stuck on a jump rope trick.', 'Her friends watch and giggle.', 'Her face gets hot and she wants to leave.', 'She notices her breathing is fast.'], 'What could Nia do?', 'Slow her breathing and try again.', ['Leave and never try the trick again.', 'Tell her friends to go away.'], 3, 'Fast breathing is a sign to slow down. Calm breathing helps her try again.'],
    [['Ben is building a model, but one piece will not fit.', 'He pushes harder and it cracks.', 'He feels angry at himself.', 'The steps are on the table.'], 'What should Ben do?', 'Stop, breathe and reread the steps.', ['Force the next piece in even harder.', 'Throw the whole model away.'], 2, 'Anger made him push too hard. Stopping and rereading fixes the problem.'],
    [['Zoe has twenty spelling words to learn.', 'She feels like it is too much to do.', 'She looks at the whole list and freezes.', 'Her teacher says to try five words at a time.'], 'What would help Zoe?', 'Learn five words, then take a break.', ['Skip the list and hope for luck.', 'Try all twenty words at once.'], 3, 'The teacher\'s idea makes the list smaller. Small steps feel easier.'],
    [['Ravi lost his place in a long reading.', 'His heart is pounding.', 'He wants to put the book down.', 'A friend says, "Take it one page at a time."'], 'What would help Ravi?', 'Read one page, then check in.', ['Stop reading for the whole day.', 'Skip ahead to the end.'], 3, 'One page at a time makes a big job small.'],
    [['Ella keeps missing the shot in basketball.', 'She slams the ball on the floor.', 'Her coach says, "Take a breath and reset."', 'Ella frowns but listens.'], 'What should Ella do?', 'Take a breath and reset her feet.', ['Keep slamming the ball on the floor.', 'Blame the hoop and walk off.'], 2, 'The coach\'s advice calms her body so she can try again.'],
    [['Kai has a science project with many steps.', 'He gets stuck on step three and feels stuck.', 'He decides to write a list of what to do next.', 'His shoulders relax.'], 'What helped Kai?', 'Making a list of small steps.', ['Waiting for it to feel easy.', 'Skipping the hard step for good.'], 2, 'His shoulders relax once he has a list. A list makes the next step clear.'],
    [['Ivy is learning a song on the piano.', 'The fast part keeps going wrong.', 'She wants to quit for the day.', 'Her teacher says to play it slowly three times.'], 'What should Ivy try?', 'Play the hard part slowly, a few times.', ['Play the whole song much faster.', 'Stop practicing for the week.'], 3, 'Playing slowly makes the hard part easier to learn.'],
  ]);
}

function peerPressurePause() {
  return hunt('pp', [
    [['Dev\'s friends plan to skip last period and go to the mall.', 'Dev has a test review in that class on Friday.', 'Last week a student was suspended for skipping.', 'His friends say, "Nobody will notice."'], 'What is the best choice?', 'Say no, and offer to go after school instead.', ['Go along, since nobody will notice anything.', 'Leave quietly without telling his friends why.'], 2, 'A student was suspended for skipping. That risk is real and he can pick a better time.'],
    [['Maya\'s group chat starts mocking a classmate\'s photo.', 'Everyone adds laughing emojis under the post.', 'Maya knows the classmate will probably see it.', 'Her phone buzzes again.'], 'What is the best choice?', 'Leave the chat and message the classmate kindly.', ['Add one emoji so the group does not turn on her.', 'Watch quietly and hope someone else speaks up.'], 2, 'The classmate will likely see it. Maya can reduce the harm by reaching out.'],
    [['Sam\'s teammate offers him a drink at a party.', 'Sam does not know what is in it.', 'He has a game early the next morning.', 'Others are watching to see what he does.'], 'What is the best choice?', 'Say no thanks and take a soda instead.', ['Take the cup so nobody calls him boring.', 'Take it and pour it out when no one looks.'], 1, 'He does not know what is in the drink, so saying no is the safest option.'],
    [['Lena\'s friend copies answers from her notebook.', 'He promises to study next time.', 'The teacher warned that copying means a zero for both students.', 'Lena wants to keep the friendship.'], 'What is the best choice?', 'Say no, and offer to study together.', ['Let him copy once more since he promised.', 'Hide the notebook and avoid him all week.'], 2, 'Both students would get a zero. Studying together helps him and protects her.'],
    [['Omar\'s cousin wants him to ride in a car with a new driver.', 'The driver likes to speed on the highway.', 'Omar remembers a crash on that road last year.', 'His cousin says it will be fun.'], 'What is the best choice?', 'Decline the ride and ask a parent to pick him up.', ['Ride along because it would be rude to refuse.', 'Ride along but sit in the back and stay quiet.'], 2, 'Speeding and a past crash make the ride risky. A parent can help.'],
    [['Rita\'s friends dare her to post a mean joke about a teacher.', 'A post can stay online even after it is deleted.', 'The school has a rule about posts like this.', 'Rita does not want to be left out.'], 'What is the best choice?', 'Pass on the dare and suggest a different joke.', ['Post it fast and delete it after a minute.', 'Post it, since it is only a joke among friends.'], 1, 'A deleted post can still be seen, so the risk stays.'],
    [['Theo is asked to share his friend\'s secret with the group.', 'His friend told him in private.', 'The group promises they will not tell anyone.', 'Theo feels pulled in two directions.'], 'What is the best choice?', 'Keep the secret, since it was shared in trust.', ['Share it, because the group promised to keep it.', 'Share only half so it is not really a betrayal.'], 1, 'The secret was told in trust, so a promise from others does not change that.'],
    [['Jada\'s friends want her to try a risky stunt on her bike.', 'There is no helmet and the ramp is wet.', 'Jada has a recital next week that uses her hands.', 'Everyone is filming.'], 'What is the best choice?', 'Skip it and offer to film from the side.', ['Do it once just to prove she is not scared.', 'Do a smaller version of the same risky stunt.'], 1, 'No helmet and a wet ramp make a fall likely and serious.'],
    [['A group asks Ben to help leave a classmate out of a project.', 'The classmate is new and shy.', 'The project needs all five members.', 'One member says, "He will only slow us down."'], 'What is the best choice?', 'Include the classmate and suggest a job for him.', ['Go with the group to keep things simple.', 'Stay out of it and let them decide.'], 2, 'The project needs all five members, so leaving him out also hurts the work.'],
    [['Pia\'s friends pressure her to stay out past curfew.', 'Her parents said they will stop letting her go out if she breaks it.', 'She trusts her parents and wants more freedom later.', 'The group says, "Just this once."'], 'What is the best choice?', 'Head home on time and say she will join next time.', ['Stay out late and say she lost track of time.', 'Stay out late and turn her phone off.'], 1, 'Breaking curfew puts future freedom at risk. Leaving on time protects it.'],
  ]);
}

function toneDetective() {
  return hunt('td', [
    [['The mayor\'s speech was long, and the crowd shifted in their seats.', 'She read each number as though it were poetry.', 'Nobody could find the point.', 'By the end, even her aide checked a watch.'], 'What is the narrator\'s tone?', 'Gently mocking, with a smile', ['Warm and full of deep admiration', 'Bitter and full of anger'], 1, 'The narrator pokes fun at the speech. Reading numbers like poetry is a joke.'],
    [['After the storm, the farmers walked their fields in silence.', 'The corn lay flat like a crushed green sea.', 'One man picked up a single stalk and held it to the light.', 'He whispered, "We will plant again."'], 'What is the tone of the passage?', 'Quietly hopeful after a loss', ['Cheerful and carefree about it', 'Cold and uninterested in it'], 3, 'The last line shows hope, even after losing a crop.'],
    [['The sign said "Please do not touch," so naturally I touched.', 'The vase did not break, but the alarm went off like a siren.', 'Three guards and a tour group turned to stare at me.', 'I smiled and waved, like I had planned it.'], 'What is the narrator\'s tone?', 'Humorous and teasing of himself', ['Serious and full of warning about it', 'Sad and full of regret'], 3, 'Smiling and waving after the alarm shows he laughs at himself.'],
    [['The old house sat at the end of the lane, its windows dark.', 'The gate hung open and creaked in the wind.', 'A cold draft slid along the porch boards.', 'Something moved behind the curtain.'], 'What is the tone of the passage?', 'Tense and eerie, like a warning', ['Joyful and welcoming to all guests', 'Dull and plain with no feeling'], 3, 'Something moving behind the curtain builds fear.'],
    [['Grandpa still keeps the radio on the kitchen shelf.', 'He says nothing sounds like it did back then.', 'Every Sunday he hums along to songs we have never heard.', 'His eyes go somewhere far away, soft and bright.'], 'What is the tone of the passage?', 'Nostalgic, with a longing for the past', ['Impatient and annoyed with the radio', 'Frightened and tense about Sunday'], 1, 'Grandpa says nothing sounds like it did back then. That shows longing.'],
    [['Our school board has again voted to cut art and music.', 'Once more, people who never visit classrooms made the call.', 'They call it "efficiency," but we call it a loss.', 'Students deserve better than a budget line.'], 'What is the author\'s tone?', 'Frustrated and critical of the board', ['Neutral and fair to both sides of the vote', 'Amused and relaxed about the vote'], 1, '"Once more" and the criticism of people who never visit classrooms show frustration.'],
    [['The coach clapped once, and the whole gym fell quiet.', 'Every player stood straight, eyes forward.', 'He studied the scoreboard for a long moment.', 'Then he said, "I am proud of every one of you."'], 'What is the tone of the passage?', 'Respectful, ending in pride', ['Cold and dismissive of the team', 'Fearful and anxious about a loss'], 3, 'The coach says he is proud, and the quiet gym shows respect.'],
    [['The new phone promises to change your life.', 'It is thinner, faster, and costs only twice as much.', 'Apparently the old one, bought last spring, is now a rock.', 'Sign me up for another year of payments.'], 'What is the author\'s tone?', 'Sarcastic about how much people spend', ['Sincere and excited about the new phone', 'Confused and lost about new phones'], 3, 'Signing up for more payments is a joke, so the tone is sarcastic.'],
    [['The rescue team had only minutes before the tide came in.', 'Boots slammed on the wet sand as they ran.', 'The leader shouted for the ropes again and again.', 'Every second counted.'], 'What is the tone of the passage?', 'Urgent and tense, with time running out', ['Relaxed and sleepy in the sun', 'Humorous and playful all through'], 3, 'The last line, "every second counted," shows the pressure.'],
    [['When she opened the letter, her hands shook.', 'The words said she had been accepted.', 'She read it twice, then a third time.', 'She laughed, then cried, then laughed again.'], 'What is the tone of the passage?', 'Overjoyed and a little overwhelmed', ['Worried and unsure about the news', 'Bored and distant from the news'], 3, 'Laughing, then crying, then laughing again shows joy that is almost too big.'],
  ]);
}

function deadlineCrunch() {
  return hunt('dc', [
    [['Nora has a history paper due Friday and a quiz on Thursday.', 'She also has a work shift on Wednesday night.', 'She tends to start the paper late and rush it.', 'Her phone keeps buzzing with a group chat.'], 'Which plan would serve Nora best?', 'Block an hour a day for the paper and mute the chat while she works.', ['Study for the quiz first, then write the paper on Thursday night.', 'Check the chat each time it buzzes so she never misses a single thing.'], 2, 'She starts late and rushes. Daily blocks and a muted phone help her avoid that.'],
    [['Amir is saving for a car and just got paid.', 'His friends invite him to a concert that costs a week\'s pay.', 'He has $400 saved and wants $1,500 by summer.', 'He tells himself he can catch up later.'], 'Which plan would serve Amir best?', 'Skip the concert and set aside a fixed amount from each paycheck.', ['Go to the concert this once, since he can always catch up later on.', 'Buy the ticket and plan to skip lunch for a month.'], 2, 'He has a goal and a deadline, so a fixed amount from each check keeps him on track.'],
    [['Dana has three tests next week and a part-time job.', 'She plans to study all night on Sunday.', 'The last time she stayed up late, she could not remember anything.', 'She has an hour free after school each day.'], 'Which plan would serve Dana best?', 'Study in short daily sessions and protect her sleep.', ['Study all night Sunday, since it worked sometimes.', 'Skip the job so she has more time for the tests this week.'], 2, 'All night studying failed before. Short daily sessions use her free hours better.'],
    [['Eli keeps putting off an application due in ten days.', 'Each time he sits down, he opens social media instead.', 'He feels better for a minute and then worse.', 'He knows the essay needs at least three drafts.'], 'Which plan would serve Eli best?', 'Work in a timed block with his phone in another room.', ['Wait until he feels motivated enough to start the essay.', 'Write one long draft the night before it is due.'], 1, 'Social media is the problem, so removing the phone solves it.'],
    [['Tia is angry after a friend criticizes her work.', 'She wants to send a long message right now.', 'The last time she did that, it took weeks to repair.', 'She has a deadline in an hour.'], 'Which plan would serve Tia best?', 'Wait until the deadline passes, then reply.', ['Send it now to get it all off her chest.', 'Send a shorter message with fewer harsh words.'], 2, 'A rushed message caused harm before. Waiting protects the friendship.'],
    [['Marcus has practice, homework, and a younger brother to watch after school.', 'He says yes to everything and runs out of time.', 'His grades dropped and he feels worn out.', 'He has not asked anyone for help.'], 'Which plan would serve Marcus best?', 'Drop one activity and ask a parent to share the load.', ['Keep saying yes and work harder to catch up.', 'Stop doing homework until things calm down.'], 1, 'Saying yes to everything is the cause. Dropping one thing and asking for help fixes it.'],
    [['Jules wants to get fit and starts with two hours a day.', 'By day three he is sore and skips.', 'He feels he has failed and stops completely.', 'A friend suggests a smaller start.'], 'Which plan would serve Jules best?', 'Restart with twenty minutes a day he can keep.', ['Push harder until his body adjusts to two hours.', 'Wait for a new month to try the same plan.'], 1, 'The plan was too big to keep. A smaller plan is one he can follow.'],
    [['Sana has a big presentation tomorrow and a pile of dishes.', 'She feels anxious and cleans instead of rehearsing.', 'Her notes are still half finished.', 'She has three hours before bed.'], 'Which plan would serve Sana best?', 'Finish her notes first, then rehearse once out loud.', ['Clean until she feels calm, then look over the notes.', 'Rehearse in her head while she does the dishes.'], 1, 'Cleaning is avoidance. Finishing the notes first uses her three hours well.'],
    [['Owen checks his phone often during study time.', 'Each check takes about two minutes and pulls him away.', 'In an hour he checks it fifteen times.', 'He wants to finish a chapter tonight.'], 'Which plan would serve Owen best?', 'Put the phone out of reach for a full study block.', ['Check it only when a message really looks important.', 'Promise himself to check it less than usual.'], 2, 'Fifteen checks is a lot of lost time. Keeping the phone away removes the pull.'],
    [['Priya wants to stop eating lunch alone in her car.', 'She feels nervous about joining the cafeteria crowd.', 'A friend always saves her a seat.', 'She tells herself she will go next week.'], 'Which plan would serve Priya best?', 'Go tomorrow for ten minutes and sit by her friend.', ['Wait until she feels ready to join everyone.', 'Keep eating in the car, since it is calm.'], 2, 'She has a friend who saves a seat. A short first visit makes the step smaller.'],
  ]);
}

function argumentCheck() {
  return hunt('ac', [
    [['Our school should ban all phones.', 'Last week a student texted during a test.', 'If phones stay, cheating will take over every class.', 'So banning phones is the only answer.'], 'What is the flaw in the argument?', 'It jumps from one incident to every class.', ['It gives so many examples that it becomes unclear.', 'It attacks the person who owns the phone.'], 2, 'One student texting is used to predict cheating everywhere.'],
    [['Dr. Reyes says this diet works.', 'She is a famous TV chef with millions of followers.', 'Millions of people cannot be wrong.', 'So everyone should try it.'], 'What is the flaw in the argument?', 'It relies on popularity, not evidence about the diet.', ['It uses too much medical language for readers to follow.', 'It does not name the chef clearly enough.'], 2, 'How many people follow her does not show the diet works.'],
    [['My opponent wants more bike lanes.', 'He also failed his driving test twice.', 'A person like that cannot plan a city.', 'Vote for me instead.'], 'What is the flaw in the argument?', 'It attacks the person instead of the bike lane plan.', ['It offers evidence from city studies about bike lanes.', 'It compares two bike lane plans with care.'], 1, 'The driving test has nothing to do with whether the plan is good.'],
    [['Either we cut the arts budget or the school closes.', 'There is no other choice.', 'The council has to cut the budget.', 'Our community must accept it.'], 'What is the flaw in the argument?', 'It claims there are only two options.', ['It explains how a school budget is built.', 'It lists many options in careful detail.'], 1, 'It says there is no other choice without checking other ways to save.'],
    [['Since I started wearing this bracelet, I have not been sick.', 'That is three months with no cold.', 'The bracelet obviously keeps people healthy.', 'Everyone should buy one.'], 'What is the flaw in the argument?', 'It treats two events together as cause and effect.', ['It uses a large survey to support the claim.', 'It admits the bracelet might not work at all.'], 2, 'Not getting sick could be luck. Nothing shows the bracelet caused it.'],
    [['Every student who joined the debate club improved their grades.', 'So the club made them smarter.', 'Strong students may be the ones who choose to join.', 'The data cannot say which came first.'], 'What is the best criticism of the claim that the club improved grades?', 'Stronger students may be the ones who join.', ['The club meets too late in the day.', 'Grades are not important to students.'], 2, 'Better students may join in the first place, so the club may not be the cause.'],
    [['A new study says teens sleep eight hours a night.', 'It surveyed forty students at one school.', 'The study was funded by a mattress company.', 'The company says all teens sleep fine.'], 'Why should we be careful about the study?', 'The sample is small and the funder may be biased.', ['Eight hours is always too little for teens.', 'The study was published much too recently to trust.'], 2, 'Forty students at one school and a mattress company funder weaken the claim.'],
    [['The minister said the new road will cut travel time in half.', 'He gave no figures or sources.', 'Everyone nearby agrees it is a great idea.', 'We should build it now.'], 'What is the weakness in this argument?', 'It offers an opinion with no evidence.', ['It gives so many sources that readers get lost.', 'It focuses only on the cost of the road.'], 1, 'There are no figures or sources, so the claim cannot be checked.'],
    [['I tried that tutor once and failed my quiz.', 'So tutors do not work.', 'I will not waste more time on them.', 'My friends can help me instead.'], 'What is the flaw in the argument?', 'One experience is used to judge every tutor.', ['The tutor was too expensive for a student.', 'The quiz was too hard to be a fair test.'], 1, 'One bad result is treated as proof about all tutors.'],
    [['If we let students choose their seats, soon they will choose their grades.', 'Then they will choose the school rules.', 'Before long, nobody will be in charge.', 'So seats must stay assigned.'], 'What is the flaw in the argument?', 'It says one small step leads to a huge chain.', ['It backs its claims with data from many schools.', 'It compares assigned seats to other methods.'], 0, 'Choosing seats does not lead to choosing grades. The chain has no support.'],
  ]);
}

// ---- generated math and thinking games --------------------------------------------------------------------------------------------------
const money = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));

function ratioShop() {
  const r = rng(71);
  const out = [];
  const choice = (id, label, ok) => ({ id, label, feedback: ok ? 'Right.' : 'Not quite.' });
  // Better buy: two packs of the same item.
  const buys = [['notebooks', 3, 4.5, 5, 6.5], ['juice boxes', 4, 3.2, 6, 5.1], ['pens', 5, 4, 8, 5.6], ['apples', 6, 3.9, 10, 7.5], ['batteries', 4, 6, 6, 8.1], ['granola bars', 8, 5.6, 12, 9]];
  buys.forEach(([thing, n1, p1, n2, p2]) => {
    const u1 = p1 / n1, u2 = p2 / n2, better = u1 < u2 ? 'a' : 'b';
    const q = `Which is the better buy: ${n1} ${thing} for ${money(p1)}, or ${n2} ${thing} for ${money(p2)}?`;
    const unitA = (Math.round(u1 * 100) / 100).toFixed(2), unitB = (Math.round(u2 * 100) / 100).toFixed(2);
    out.push({ stimulusType: 'text', stimulusText: q, choices: shuffle([choice('a', `${n1} for ${money(p1)}`, better === 'a'), choice('b', `${n2} for ${money(p2)}`, better === 'b')], r), correctId: better,
      explanation: `Each costs $${better === 'a' ? unitA : unitB}, and the other costs $${better === 'a' ? unitB : unitA}. The lower price for one is the better buy.`, meta: { kind: 'unit', n1, p1, n2, p2 } });
  });
  // Percent off.
  [[40, 25], [60, 20], [80, 30], [24, 50], [90, 10], [50, 40]].forEach(([price, pct]) => {
    const sale = price * (100 - pct) / 100, off = price * pct / 100;
    const opts = [...new Set([sale, off, price - pct, price + off])].filter((x) => x > 0 && x !== sale);
    const bad = pick(opts, 2, r);
    out.push({ stimulusType: 'text', stimulusText: `A ${money(price)} jacket is ${pct}% off. What is the sale price?`, choices: shuffle([sale, ...bad], r).map((v) => choice(String(v), money(v), v === sale)), correctId: String(sale),
      explanation: `${pct}% of ${money(price)} is ${money(off)}. Take that off to get ${money(sale)}.`, meta: { kind: 'off', price, pct } });
  });
  // Recipe ratios.
  [[2, 3, 6], [3, 2, 9], [4, 5, 12], [2, 5, 8]].forEach(([a, b, newA]) => {
    const ans = b * newA / a;
    const bad = pick([...new Set([ans + 1, ans - 1, ans + b, newA + (b - a), ans * 2])].filter((x) => x > 0 && x !== ans && Number.isInteger(x)), 2, r);
    out.push({ stimulusType: 'text', stimulusText: `A recipe uses ${a} cups of flour for ${b} cups of milk. How much milk goes with ${newA} cups of flour?`, choices: shuffle([ans, ...bad], r).map((v) => choice(String(v), `${v} cups`, v === ans)), correctId: String(ans),
      explanation: `${newA} cups is ${newA / a} times ${a} cups, so use ${newA / a} times ${b} cups: ${ans} cups.`, meta: { kind: 'ratio', a, b, newA } });
  });
  // Percent of an amount.
  [[60, 15], [80, 25], [120, 10], [50, 30]].forEach(([amt, pct]) => {
    const ans = amt * pct / 100;
    const bad = pick([...new Set([ans * 2, ans + 5, amt - ans, pct, ans / 2])].filter((x) => x > 0 && x !== ans && Number.isInteger(x)), 2, r);
    out.push({ stimulusType: 'text', stimulusText: `A meal costs ${money(amt)}. What is a ${pct}% tip?`, choices: shuffle([ans, ...bad], r).map((v) => choice(String(v), money(v), v === ans)), correctId: String(ans),
      explanation: `${pct}% of ${money(amt)} is ${money(ans)}.`, meta: { kind: 'tip', amt, pct } });
  });
  return out;
}

function graphMatch() {
  const SHAPES = { up: ['📈', 'Straight line up'], fast: ['🚀', 'Curve that speeds up'], down: ['📉', 'Straight line down'], flat: ['➖', 'Flat line'], slow: ['🐢', 'Curve that levels off'], fall: ['⤵️', 'Curve that falls then flattens'] };
  const rows = [
    ['A gym charges $20 to join and $30 each month. How does the total cost look on a graph?', 'up', 'The same $30 is added every month, so the total rises in a straight line.'],
    ['A video is shared by 2 people, who each share it with 2 more, and so on. How does the number of viewers look?', 'fast', 'Each step multiplies the number, so it climbs faster and faster.'],
    ['A phone loses $100 of value each year. How does its value look over time?', 'down', 'The same amount is lost each year, so the value falls in a straight line.'],
    ['A savings account earns 5 percent interest each year on a growing balance. How does the balance look?', 'fast', 'Interest is added to a bigger balance each year, so growth speeds up.'],
    ['A plant grows quickly in spring, then slowly as it reaches full size. How does its height look?', 'slow', 'Growth is fast at first and then slows, so the curve levels off.'],
    ['A taxi charges a flat $5 no matter how far you ride. How does the $5 fee look as distance grows?', 'flat', 'The fee stays the same, so the line is flat.'],
    ['A candle burns down at a steady rate. How does its height look as time passes?', 'down', 'The same amount burns each minute, so the height falls in a straight line.'],
    ['A rumor spreads: 1 student knows, then 3, then 9, then 27. How does the number who know look?', 'fast', 'The number triples each step, so the curve climbs faster and faster.'],
    ['A runner starts fast and slows as she tires. How does her total distance look over time?', 'slow', 'The distance still rises, but more slowly, so the curve levels off.'],
    ['A bacteria colony doubles every hour. How does the size of the colony look?', 'fast', 'Doubling is repeated multiplying, so the curve speeds up.'],
    ['Water drains from a tank at 5 liters each minute. How does the water level look?', 'down', 'The same amount leaves each minute, so the level falls in a straight line.'],
    ['A car drives at a steady 60 miles per hour. How does the total distance look over time?', 'up', 'The same distance is added each hour, so the total rises in a straight line.'],
    ['Each hour the medicine in a person\'s blood falls by half. How does the amount look?', 'fall', 'It drops a lot at first and less each hour, so the curve falls and flattens.'],
    ['A library charges a fixed $2 fee per book, no matter how many days it is kept. How does the fee look as days pass?', 'flat', 'The fee does not change with days, so the line is flat.'],
  ];
  const r = rng(83);
  return rows.map(([q, key, why]) => {
    const wrong = pick(Object.keys(SHAPES).filter((k) => k !== key), 2, r);
    const choices = shuffle([key, ...wrong], r).map((k) => ({ id: k, label: `${SHAPES[k][0]} ${SHAPES[k][1]}`, feedback: k === key ? 'Right.' : 'Not quite.' }));
    return { stimulusType: 'text', stimulusText: q, choices, correctId: key, explanation: why };
  });
}

function statsCheck() {
  const r = rng(97);
  const sets = [[70, 85, 85, 90, 100], [12, 15, 15, 18, 20, 22, 25], [3, 7, 7, 9, 14], [40, 45, 50, 55, 60, 90], [6, 8, 9, 9, 11, 13], [22, 24, 24, 26, 30], [5, 5, 6, 8, 11, 15], [100, 110, 115, 120, 160], [18, 20, 21, 21, 23, 28]];
  const stat = { mean: (a) => a.reduce((x, y) => x + y, 0) / a.length, median: (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; }, mode: (a) => { const c = {}; a.forEach((v) => { c[v] = (c[v] || 0) + 1; }); return Number(Object.keys(c).sort((x, y) => c[y] - c[x] || x - y)[0]); }, range: (a) => Math.max(...a) - Math.min(...a) };
  const ask = ['median', 'mean', 'mode', 'range', 'median', 'mean', 'range', 'median', 'mode'];
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const out = sets.map((data, i) => {
    const kind = ask[i], answer = stat[kind](data);
    const others = [...new Set(['median', 'mean', 'mode', 'range'].filter((k) => k !== kind).map((k) => stat[k](data)).concat([answer + 1, answer - 1]))].filter((x) => x !== answer && x > 0);
    const bad = pick(others, 2, r);
    const word = { median: 'median', mean: 'mean (average)', mode: 'mode', range: 'range' }[kind];
    return { stimulusType: 'text', stimulusText: `Scores: ${data.join(', ')}. What is the ${word}?`, choices: shuffle([answer, ...bad], r).map((v) => ({ id: fmt(v), label: fmt(v), feedback: v === answer ? 'Right.' : 'Not quite.' })), correctId: fmt(answer),
      explanation: { median: `The middle value is ${fmt(answer)}.`, mean: `The scores add to ${data.reduce((x, y) => x + y, 0)}. Divide by ${data.length} to get ${fmt(answer)}.`, mode: `${fmt(answer)} appears most often.`, range: `${Math.max(...data)} minus ${Math.min(...data)} is ${fmt(answer)}.` }[kind], meta: { kind, data } };
  });
  // Misleading displays: the claim and the reason.
  const text = (q, right, wrongs, why, key) => ({ stimulusType: 'text', stimulusText: q, choices: shuffle([right].concat(wrongs), r).map((t) => ({ id: t === right ? key : t, label: t, feedback: t === right ? 'Right.' : 'Not quite.' })), correctId: key, explanation: why, meta: { kind: 'claim' } });
  out.push(text('A bar chart starts its side numbers at 90, so scores of 92 and 95 look very different. What is the problem?', 'The axis does not start at zero, so a small gap looks big.', ['The bars are too colorful to compare.', 'The scores are both too high to graph.'], 'Starting at 90 makes a small difference look huge.', 'axis'));
  out.push(text('A survey asks only students who eat in the cafeteria whether lunch is good. What is the problem?', 'The sample leaves out students who do not eat there.', ['The survey asks too few questions.', 'Cafeteria students cannot be surveyed.'], 'The people asked are not a fair picture of all students.', 'sample'));
  out.push(text('A mean of 40 is reported for a group of ages: 10, 12, 14, 16, and 148. What is misleading?', 'One very large value pulls the mean up, so it does not fit the group.', ['The mean is always misleading for ages.', 'Five numbers is too many to average.'], 'The 148 pulls the mean far above the other four ages. The median would fit better.', 'outlier'));
  out.push(text('A company says 9 out of 10 doctors prefer its product, but only 10 doctors were asked. What is the problem?', 'Ten doctors is too small a group to speak for all doctors.', ['Doctors should not be asked their opinions.', 'Nine of ten is too low to be worth reporting.'], 'A very small group may not match the larger population.', 'small'));
  return out;
}

function planIt() {
  const r = rng(101);
  const NAMES = [['Study', 'Essay', 'Chores'], ['Math', 'Lab report', 'Laundry'], ['Practice', 'Reading', 'Dishes'], ['Soccer', 'Project', 'Errands'], ['Quiz prep', 'Slides', 'Cooking'], ['Piano', 'Homework', 'Packing'], ['Training', 'Résumé', 'Cleaning'], ['Review', 'Draft', 'Shopping'], ['Rehearsal', 'Poster', 'Recycling'], ['Research', 'Call', 'Mail']];
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).map((p) => [x].concat(p))));
  const meets = (order, tasks, start) => { let t = start; for (const k of order) { t += tasks[k].h; if (t > tasks[k].due) return false; } return true; };
  const hr = (h) => (h === 1 ? '1 hour' : `${h} hours`);
  const clock = (h) => { const hh = h % 12 === 0 ? 12 : h % 12; return `${hh} ${h >= 12 ? 'pm' : 'am'}`; };
  const out = [];
  for (let i = 0; i < NAMES.length; i++) {
    let tasks, start, good;
    for (let tries = 0; tries < 400; tries++) {
      start = 13 + Math.floor(r() * 2); // 1 pm or 2 pm, in 24-hour numbers
      const h = [1 + Math.floor(r() * 2), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 2)];
      // The earliest-deadline order is feasible by construction; tight deadlines make other orders fail.
      const order = shuffle([0, 1, 2], r);
      let t = start; tasks = [];
      order.forEach((k) => { t += h[k]; tasks[k] = { name: NAMES[i][k], h: h[k], due: t + Math.floor(r() * 2) }; });
      const all = perms([0, 1, 2]);
      const ok = all.filter((p) => meets(p, tasks, start));
      if (ok.length === 1) { good = ok[0]; break; }
    }
    if (!good) throw new Error('could not build a planning puzzle ' + i);
    const wrong = perms([0, 1, 2]).filter((p) => !meets(p, tasks, start));
    const bad = pick(wrong, 2, r);
    const label = (p) => p.map((k) => tasks[k].name).join(', then ');
    const passage = [`It is ${clock(start)} and you have three jobs to finish, one at a time.`].concat(tasks.map((t) => `${t.name} takes ${hr(t.h)} and is due by ${clock(t.due)}.`));
    const earliest = [0, 1, 2].sort((a, b) => tasks[a].due - tasks[b].due)[0];
    const choices = shuffle([good, ...bad], r).map((p, k) => ({ id: `pl${i + 1}-${'abc'[k]}`, text: label(p), order: p.join('') }));
    const right = choices.find((c) => c.order === good.join(''));
    out.push({ passage, question: 'Which order finishes every job on time?', choices: choices.map(({ id, text }) => ({ id, text })), correctChoiceId: right.id, correctEvidenceIndex: 1 + earliest,
      explanation: `${tasks[earliest].name} is due first, so it goes first. Then each job finishes by its deadline.`, plan: { start, tasks: tasks.map((t) => ({ h: t.h, due: t.due })), orders: choices.map((c) => c.order), good: good.join('') } });
  }
  return out;
}

function switchBoard() {
  const r = rng(113);
  const RULES = { add: ['ADD 4', (n) => n + 4], sub: ['SUBTRACT 3', (n) => n - 3], dbl: ['DOUBLE', (n) => n * 2], half: ['HALVE', (n) => n / 2] };
  const out = [];
  let prev = '';
  for (let i = 0; i < 24; i++) {
    let key;
    do { key = Object.keys(RULES)[Math.floor(r() * 4)]; } while (key === prev && r() < 0.7);
    prev = key;
    const n = key === 'half' ? 2 * (3 + Math.floor(r() * 9)) : 5 + Math.floor(r() * 14);
    const ans = RULES[key][1](n);
    const pool = Object.keys(RULES).filter((k) => k !== key).map((k) => RULES[k][1](n)).filter((v) => Number.isInteger(v) && v !== ans && v > 0);
    const bad = pick([...new Set(pool.concat([ans + 1, ans - 1]))].filter((v) => v > 0 && v !== ans), 2, r);
    out.push({ stimulusType: 'text', stimulusText: `Rule: ${RULES[key][0]}. Number: ${n}`, choices: shuffle([ans, ...bad], r).map((v) => ({ id: String(v), label: String(v), feedback: v === ans ? 'Right.' : 'Not quite.' })), correctId: String(ans),
      explanation: `${cap(RULES[key][0].toLowerCase())} ${n} to get ${ans}.`, meta: { rule: key, n } });
  }
  return out;
}

const LAST = [
  { slug: 'wait-for-it', name: 'Wait for It', icon: '⏳', skill: 'Patience and Self-Control', band: 'discover', domain: 'sel', focus: 'self_management', casel: ['self_management'], engine: 'audioChoice', activity: 'wait-for-it-patience', blurb: 'Listen. Pick what helps you wait.', desc: 'Listen to a waiting problem, then pick what helps you wait.', pack: { title: 'Wait for It', roundsPerRun: 5, items: waitForIt() } },
  { slug: 'stop-and-think', name: 'Stop and Think', icon: '🛑', skill: 'Safe Choices', band: 'discover', domain: 'sel', focus: 'responsible_decision_making', casel: ['responsible_decision_making'], engine: 'audioChoice', activity: 'stop-and-think-safe', blurb: 'Listen. Stop and think. Pick the safe choice.', desc: 'Listen to a problem, stop and think, then pick the safe choice.', pack: { title: 'Stop and Think', roundsPerRun: 5, items: stopAndThink() } },
  { slug: 'stuck-on-it', name: 'Stuck on It', icon: '🧗', skill: 'Handling Frustration', band: 'explore', domain: 'sel', focus: 'self_management', casel: ['self_management'], engine: 'evidenceHunt', activity: 'stuck-on-it-frustration', blurb: 'Read what is hard, pick what helps, then find the sentence that shows why.', desc: 'Read about someone who is stuck, then pick what helps and find the proof.', pack: { title: 'Stuck on It', roundsPerRun: 5, items: stuckOnIt() } },
  { slug: 'peer-pressure-pause', name: 'Peer Pressure Pause', icon: '⏸️', skill: 'Choosing Under Pressure', band: 'challenge', domain: 'sel', focus: 'responsible_decision_making', casel: ['responsible_decision_making'], engine: 'evidenceHunt', activity: 'peer-pressure-pause-choices', blurb: 'Read the pressure, pick the best choice, then find the sentence that shows the risk.', desc: 'Read a pressure situation, pick the best choice, then find the risk that proves it.', pack: { title: 'Peer Pressure Pause', roundsPerRun: 5, items: peerPressurePause() } },
  { slug: 'tone-detective', name: 'Tone Detective', icon: '🕵️', skill: 'Author\'s Tone', band: 'challenge', domain: 'literacy', focus: 'literacy', engine: 'evidenceHunt', activity: 'tone-detective-tone', blurb: 'Read the passage, name the tone, then find the line that shows it.', desc: 'Read a short passage, name the tone the author uses, then find the line that shows it.', pack: { title: 'Tone Detective', roundsPerRun: 5, items: toneDetective() } },
  { slug: 'ratio-shop', name: 'Ratio Shop', icon: '🏷️', skill: 'Ratios and Percents', band: 'challenge', domain: 'math', focus: 'math', engine: 'audioChoice', activity: 'ratio-shop-deals', blurb: 'Work out the better buy.', desc: 'Compare prices, find sale prices and scale recipes with ratios and percents.', pack: { title: 'Ratio Shop', roundsPerRun: 8, items: ratioShop() } },
  { slug: 'deadline-crunch', name: 'Deadline Crunch', icon: '⏰', skill: 'Planning and Self-Control', band: 'advance', domain: 'sel', focus: 'self_management', casel: ['self_management', 'responsible_decision_making'], engine: 'evidenceHunt', activity: 'deadline-crunch-plans', blurb: 'Read the problem, pick the plan, then find the sentence that shows why.', desc: 'Read a deadline problem, pick the plan that holds up, then find the proof.', pack: { title: 'Deadline Crunch', roundsPerRun: 5, items: deadlineCrunch() } },
  { slug: 'argument-check', name: 'Argument Check', icon: '⚖️', skill: 'Judging Arguments', band: 'advance', domain: 'literacy', focus: 'literacy', engine: 'evidenceHunt', activity: 'argument-check-flaws', blurb: 'Read the argument, spot the flaw, then find the step that is weak.', desc: 'Read a short argument, spot the flaw in its reasoning, then find the weak step.', pack: { title: 'Argument Check', roundsPerRun: 5, items: argumentCheck() } },
  { slug: 'graph-match', name: 'Graph Match', icon: '📈', skill: 'Modeling Change', band: 'advance', domain: 'math', focus: 'math', engine: 'audioChoice', activity: 'graph-match-shapes', blurb: 'Match the story to the shape of its graph.', desc: 'Match a real-life story to the shape of its graph.', pack: { title: 'Graph Match', roundsPerRun: 6, items: graphMatch() } },
  { slug: 'stats-check', name: 'Stats Check', icon: '📊', skill: 'Data and Statistics', band: 'advance', domain: 'math', focus: 'math', engine: 'audioChoice', activity: 'stats-check-data', blurb: 'Find the number, or spot what is misleading.', desc: 'Find the median, mean, mode and range, and spot a misleading chart or survey.', pack: { title: 'Stats Check', roundsPerRun: 6, items: statsCheck() } },
  { slug: 'plan-it', name: 'Plan It', icon: '🗓️', skill: 'Planning Under Limits', band: 'advance', domain: 'executive', focus: 'thinking', engine: 'evidenceHunt', activity: 'plan-it-order', blurb: 'Read the jobs and deadlines, pick the order that works, then find the deadline that decides it.', desc: 'Read jobs and deadlines, pick the order that finishes everything on time, then find the key deadline.', pack: { title: 'Plan It', roundsPerRun: 5, items: planIt() } },
  { slug: 'switch-board', name: 'Switch Board', icon: '🔀', skill: 'Switching Between Rules', band: 'advance', domain: 'executive', focus: 'thinking', engine: 'audioChoice', activity: 'switch-board-rules', blurb: 'The rule changes. Follow it.', desc: 'Follow a rule that keeps changing, and work out each answer with no clock.', pack: { title: 'Switch Board', roundsPerRun: 10, items: switchBoard() } },
].map((g) => Object.assign({ release: 144 }, g));

module.exports = { LAST };
