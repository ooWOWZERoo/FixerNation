# Release 88: Explore games for ages 7-10, built and held for your review

Written 2026-11-02. **Built and tested locally, not committed.** Follows `R88_EXPLORE_TRIM_OUTLINE.md` with all five decisions taken as recommended (the limits as written; feeling words stay and thinking words go; amber for "right answer, weaker proof" in Explore, Challenge and Advance; a visible step count and "Steps finished / Smart choices" in Explore; one release).

## What changed

| File | Change |
|---|---|
| `brain-choice-quest.html`, `brain-team-pick.html`, `brain-peace-table.html`, `brain-fix-it-workshop.html` | All four stories in each game rewritten shorter (every setup, option and feedback line). Keys, ids, answer types, number of options and the reflection step are untouched |
| `brain-reading-detective.html` | Four explanations, three passage sentences and one answer shortened |
| `brain-strength-spotter.html` | Twelve stories and a few "fits less" notes shortened |
| `engine-evidence-hunt.js` (`?v=2`) | "Right answer, weaker proof" takes its look from the wording table: amber (the R85 look) for Explore, Challenge and Advance; red where no band is set |
| `engine-sdk.js` (`?v=5`) | New wording keys: weak-proof look, and the Explore milestone labels |
| `game-shell.js` (now `?v=2`, it had no version number) | `renderProgress` can show a visible "Step 2 of 5" in Explore |
| `engine-branching-scenario.js` (`?v=6`), `engine-scenario-choice.js` (`?v=6`), `engine-audio-choice.js` (`?v=4`), `engine-simulation.js` (`?v=4`) | Pass their word to the progress bar ("Step", "Story", "Question", "Decision"); the scenario games' finished screen reads "Steps finished / Smart choices" in Explore |
| `brain-games.css` (`?v=6`) | The visible count style |
| `server/scripts/explore-limits.js` (new) | The checker for the limits; `server/test/explore-games.test.js` (new) runs it for all six games and guards the two mechanisms |

No server change, no schema change, no restart.

## How the writing was done

The four scenario games were rewritten by four helper agents working in parallel, one file each, from a brief that listed the limits and the test rules; each ran the checker and the writing-rule tests on its own game until both passed. I rewrote Reading Detective and Strength Spotter myself, then read samples from each scenario game (a full Fix-It story and the first steps of Team Pick, Peace Table and Choice Quest) for meaning and tone. **I have not read every one of the roughly 400 changed lines; the tables below are for you to do that.**

## Things to look for when you read

- **Lost small details.** To fit the limits some lines lost a clause. The agents reported: Peace Table story 1 lost "the lunch bell is about to ring"; story 3 lost "At recess"; story 2 moved "Priya thinks the zipper was already loose" into an answer option; Team Pick story 2 lost "by one run" from an option; Fix-It Ana's story dropped "You want to make the school easier for new kids"; Choice Quest story 4 no longer quotes the classmate's question and one option became two short sentences ("Not your problem.").
- **Terse feedback.** Some feedback now reads clipped ("Staying quiet protects you for now, but the hurt stays. Zoe never finds out."). That is the trade for two sentences and 18 words; tell me where it reads too blunt.
- **Fix-It "consider" feedback** must contain a cost word (need, cost, only, take, not); an existing test requires it, so a few lines were worded to include one.
- **Reading Detective "right answer, weak proof"** now says, for example, "Right answer. Look for a stronger clue." in an amber box and then the game's explanation.

## Checks

- `node server/scripts/explore-limits.js`: **0 lines over the limits in all six games** (options 12 words, feedback two sentences and 18 words, setup 22, sentences 12, no hard thinking words, no dashes).
- `cd server && npm test`: **208 pass** (197 before; 11 new). The existing writing-rule tests for Choice Quest, Team Pick, Peace Table and Fix-It (option lengths within 1.4 times, the careful answer longest in at most 2 of 4 steps, types, ids, dashes) still pass, and so does the engine smoke test that runs every game's first screen.
- In the browser (local site): Fix-It Workshop played through all five steps of one problem: the count showed "Step 1 of 5" to "Step 5 of 5", the new step names showed, option lengths were 9 to 12 words, and the finished screen read "Level complete!", "Steps finished", "Smart choices". Reading Detective showed "Question 1 of 4", and a right answer with a wrong proof sentence gave the amber box. Strength Spotter showed "Story 1 of 5" in purple and the story text on screen. Headline (Challenge) shows no count.

## Not checked

- Phone widths; the screen look of the count (the browser pane would not paint a screenshot, so I read it from the page instead).
- The amber look in Challenge and Advance by eye (the same code path as Explore, and the colors are contrast-tested).
- Whether the shorter text still teaches what each step is for; that is your read.
- The other three stories of Reading Detective, and stories beyond the first of Peace Table, Choice Quest and Strength Spotter, were checked by the limits and tests but not played.

## Help video check (at commit)

S2 and S4 are listed by the check on these pages; neither plays an Explore scenario game (S2 embeds Feelings Detective, S4 plays Memory Match), so I expect both still correct; I will record the judgment at commit.

## Deploy (after you approve and I commit)

Static files only: push, cPanel `git pull`, the broad rsync. No restart, no alter script, no `npm install`.

## Before and after, by the numbers

| Game | Lines changed | Options avg words (before, after) | Feedback avg words (before, after) | Setup avg words (before, after) |
|---|---|---|---|---|
| Choice Quest | 120 | 15.9 to 11.1 | 19.3 to 12.0 | 14.2 to 10.3 |
| Team Pick | 123 | 16.7 to 11.0 | 18.2 to 12.1 | 14.2 to 10.9 |
| Peace Table | 110 | 15.1 to 10.5 | 17.6 to 14.0 | 13.6 to 10.8 |
| Fix-It Workshop | 123 | 18.1 to 10.6 | 19.4 to 13.7 | 22.3 to 16.5 |
| Reading Detective | 8 | 7.8 to 7.2 | 20.8 to 13.0 | - to - |
| Strength Spotter | 14 | - to - | 12.3 to 11.6 | 31.0 to 23.8 |

## Choice Quest (120 lines changed)

| Where | Now | New |
|---|---|---|
| story 1, recognize, setup | Your team is building a diorama for the class project. Mia has not finished her part, and the project is due tomorrow. | Your team is making a diorama. Mia has not finished her part, and it is due tomorrow. |
| story 1, recognize, responsible, option | Notice that Mia might be stuck or need help, not just that she is not trying. | Maybe Mia is stuck and needs some help with her part. |
| story 1, recognize, responsible, feedback | Good noticing. There could be more going on than it first looks like. | Good noticing. There may be more going on than you can see. |
| story 1, recognize, plausible_incomplete, option | Mia is being lazy and does not really care about how the project turns out. | Mia is lazy and does not care about the project. |
| story 1, recognize, plausible_incomplete, feedback | Maybe, but that is a guess. It is worth finding out what is really going on first. | Maybe, but that is only a guess. Ask her first. |
| story 1, recognize, plausible_incomplete, option | The project is due soon, so the only thing that matters is getting it finished. | The project is due soon, so only finishing it matters. |
| story 1, recognize, plausible_incomplete, feedback | Finishing matters. If you only look at the deadline, though, you miss what is going on with Mia and how the team can get there together. | Finishing matters, but you would miss what is going on with Mia. |
| story 1, impact, responsible, option | The whole team's project could be unfinished, and Mia might feel embarrassed or stressed too. | The project stays unfinished, and Mia may feel upset. |
| story 1, impact, responsible, feedback | Right. This affects the whole team, including Mia. | Right. It hurts the whole team, including Mia. |
| story 1, impact, plausible_incomplete, option | Only Mia will be in trouble for it, so this is not really a problem for the rest of the team. | Only Mia is in trouble, so it is not the team's problem. |
| story 1, impact, plausible_incomplete, feedback | A team project usually means a team result. It is everyone's problem, not just Mia's. | A team project means a team result. It is everyone's problem. |
| story 1, impact, plausible_incomplete, option | The teacher will probably give the team more time, so there is nothing to worry about yet. | The teacher will give more time, so nobody needs to worry. |
| story 1, impact, plausible_incomplete, feedback | A teacher might. Counting on extra time is a guess, though, and the team and Mia would still have the same problem tomorrow. | Maybe, but extra time is only a guess. The problem would still be there. |
| story 1, consider, setup | What are some ways your team could handle this? | What could your team do about this? |
| story 1, consider, responsible, option | Ask Mia if she needs help, and work out a plan together that fits the time left. | Ask Mia if she needs help and make a plan together. |
| story 1, consider, responsible, feedback | Having a real plan, made together, beats guessing what to do. | A plan made together beats guessing what to do. |
| story 1, consider, plausible_incomplete, option | Finish her part yourself tonight so the project is done on time, without telling her. | Finish her part tonight yourself and do not tell her. |
| story 1, consider, plausible_incomplete, feedback | This solves the deadline, but it skips Mia entirely and does not find out what she actually needs. | That solves the deadline, but it skips Mia and what she needs. |
| story 1, consider, plausible_incomplete, option | Tell the whole team that Mia has not finished, so everyone knows who is holding things up. | Tell the team that Mia is the one holding things up. |
| story 1, consider, plausible_incomplete, feedback | Everyone would know, but it puts Mia on the spot before anyone has asked what is wrong, and it does not give the team a way forward. | It puts Mia on the spot and gives no way forward. |
| story 1, choose, setup | What is the most constructive next step right now? | What is the best next step? |
| story 1, choose, responsible, option | Ask Mia privately if everything is okay and offer to help with her part of the project. | Ask Mia privately if she is okay and offer to help. |
| story 1, choose, responsible, feedback | A private check-in respects Mia and gets you real information before anyone decides anything. | A private check-in is kind and tells you what is really wrong. |
| story 1, choose, multiple_defensible, option | Suggest that the team divide up Mia's remaining work fairly, with her input. | Suggest the team share Mia's work fairly, with her say. |
| story 1, choose, multiple_defensible, feedback | Also a solid move. Fair redivision, with Mia included, keeps this from feeling like a punishment. | Also a good move. Including Mia keeps it from feeling like a punishment. |
| story 1, choose, unsafe, option | Tell the teacher that Mia is ruining the project before you have talked to her. | Tell the teacher Mia is ruining it before you talk to her. |
| story 1, choose, unsafe, feedback | Going straight to blame, without ever asking Mia what is going on, could embarrass her for something that might not even be her fault. | Blaming her before asking could embarrass her for no reason. |
| story 1, choose, seek_help, option | If Mia seems really upset or overwhelmed, let the teacher know so an adult can help. | If Mia seems very upset, tell the teacher to get her help. |
| story 1, choose, seek_help, feedback | Asking a trusted adult for help is a reasonable choice, especially if something bigger than a school project seems to be going on. | Asking a trusted adult is wise when something bigger may be wrong. |
| story 1, reflect, setup | What is one way you could check in with a teammate who seems stuck, next time it happens? | How can you check in with a stuck teammate? |
| story 2, recognize, setup | You borrowed Dev's brand-new marker set to finish a poster. When you open the case at home, one marker has been left uncapped and it has dried out. | You borrowed Dev's new markers for a poster. At home, you find one uncapped and dried out. |
| story 2, recognize, responsible, option | Notice that you feel worried, and that Dev will probably find the dried marker. | You feel worried, and Dev will probably find the dry marker. |
| story 2, recognize, responsible, feedback | Good noticing. Worry is a clue that this matters to you, and facing it early gives you more choices. | Good noticing. Worry tells you this matters, and facing it early helps. |
| story 2, recognize, plausible_incomplete, option | It is only one marker out of many in a big set, so it probably will not matter to Dev. | It is one marker in a big set. Dev will not mind. |
| story 2, recognize, plausible_incomplete, feedback | It might be small, but the set is new and it is Dev's. How big a mistake feels depends on whose thing it is. | It may be small, but it is Dev's new set. |
| story 2, recognize, plausible_incomplete, option | Maybe the marker was already dry when Dev lent you the set, so it is not your problem. | Maybe it was dry when Dev lent it. Not your problem. |
| story 2, recognize, plausible_incomplete, feedback | That could be true, but you do not know it. Guessing that the blame belongs somewhere else can keep you from checking. | That could be true, but you do not know it. Check first. |
| story 2, impact, setup | If you say nothing and return the set, what is likely to happen? | If you return the set and say nothing, what could happen? |
| story 2, impact, responsible, option | Dev may find it later and wonder what happened, and lending you things could get harder. | Dev may find it later, and lending you things gets harder. |
| story 2, impact, responsible, feedback | Yes. Trust grows when people are honest about small things, and it gets harder to rebuild after a surprise. | Yes. Honesty about small things builds trust, and surprises break it. |
| story 2, impact, plausible_incomplete, option | Nothing much, since Dev has other markers and probably will not check every one in the case. | Nothing much, since Dev has other markers and will not check. |
| story 2, impact, plausible_incomplete, feedback | He might not check. But you would be carrying the secret, and the next time he looks, it could be a bigger deal. | He might not check. But you would carry the secret. |
| story 2, impact, plausible_incomplete, option | Dev will be upset for a day, but things will go back to normal once he forgets about it. | Dev will be upset for a day, then he will forget it. |
| story 2, impact, plausible_incomplete, feedback | He may forget. It is more likely he would remember that you knew and said nothing. | He may forget. He is more likely to remember you said nothing. |
| story 2, consider, setup | What are some ways you could handle this? | What could you do about it? |
| story 2, consider, responsible, option | Tell Dev what happened, say sorry, and ask what he would like you to do about it. | Tell Dev what happened, say sorry, and ask how to fix it. |
| story 2, consider, responsible, feedback | Telling him first lets Dev feel respected, and it gives the two of you a chance to fix it together. | Telling him first shows respect and lets you fix it together. |
| story 2, consider, plausible_incomplete, option | Buy a new marker and slip it into the case so Dev never has to know. | Buy a new marker and slip it in so Dev never knows. |
| story 2, consider, plausible_incomplete, feedback | Replacing it is kind, but doing it in secret skips the honest part. Dev still does not get to hear it from you. | Replacing it is kind, but Dev never hears it from you. |
| story 2, consider, plausible_incomplete, option | Return the set, say it was great to use, and let Dev notice the marker on his own. | Return the set and let Dev find the marker on his own. |
| story 2, consider, plausible_incomplete, feedback | This sounds friendly, but it leaves Dev to find the problem alone, and it may feel like you hid it. | That leaves Dev to find the problem alone. It may feel like hiding. |
| story 2, choose, setup | What is the most constructive thing to do right now? | What is the best thing to do now? |
| story 2, choose, responsible, option | Tell Dev about the dried marker when you return the set, and say sorry. | Tell Dev about the dry marker, and say you are sorry. |
| story 2, choose, responsible, feedback | You are honest, you take responsibility, and Dev hears it from you. That is hard to do and it builds trust. | You are honest and Dev hears it from you. That builds trust. |
| story 2, choose, multiple_defensible, option | Offer to replace the marker, and ask Dev if he wants the same color. | Offer to buy a new marker and ask which color he wants. |
| story 2, choose, multiple_defensible, feedback | Also a good move. Offering to make it right, and asking what Dev wants, treats him as the owner of the decision. | Also good. Offering to fix it and asking Dev shows you respect his choice. |
| story 2, choose, unsafe, option | Return the set quietly and hope he never opens that particular marker. | Return the set quietly and hope Dev never finds the marker. |
| story 2, choose, unsafe, feedback | Hoping nobody notices a mistake rarely works, and if Dev finds it first, the silence looks worse than the dried marker. | Hoping nobody notices rarely works. If Dev finds it first, silence looks worse. |
| story 2, choose, seek_help, option | Ask a parent or a teacher how to start the conversation with Dev about it. | Ask a parent or teacher how to start talking to Dev. |
| story 2, choose, seek_help, feedback | Asking a trusted adult for help finding the words is a good idea, especially when you feel nervous about it. | A trusted adult can help you find words when you feel nervous. |
| story 2, reflect, setup | What is one thing you could say to someone when you have made a mistake with something that is not yours? | What could you say after a mistake with something not yours? |
| story 3, recognize, setup | At recess you are playing tag. Ravi keeps changing the rules so that he is never "it". A couple of friends are getting annoyed, and one has started to walk away. | At recess you play tag. Ravi keeps changing the rules so he is never "it". Friends are annoyed, and one walks away. |
| story 3, recognize, responsible, option | Notice that the game feels unfair to several people at once, and not only to one of them. | The game feels unfair to several friends at once. |
| story 3, recognize, responsible, feedback | Good noticing. When more than one person feels the same way, it is worth taking seriously. | Good noticing. When many people feel the same, it matters. |
| story 3, recognize, plausible_incomplete, option | Ravi is just very competitive, so this is how he always plays and there is nothing to do. | Ravi is just competitive, so that is how he plays. |
| story 3, recognize, plausible_incomplete, feedback | Some people play hard to win. A rule that changes for only one person is a different thing, though. | Some people play hard to win. Changing rules for one person is different. |
| story 3, recognize, plausible_incomplete, option | It is only a game, so the best thing is to stop thinking about it and play something else. | It is only a game, so just play something else. |
| story 3, recognize, plausible_incomplete, feedback | Leaving is one choice. It leaves the problem for the friends who stay and for Ravi, who may not see it. | Leaving is one choice. But it leaves the problem for friends who stay. |
| story 3, impact, setup | If the rules keep changing, what is likely to happen to the game? | If the rules keep changing, what will happen to the game? |
| story 3, impact, responsible, option | More friends may quit, the game may fall apart, and Ravi may never learn why people are upset. | More friends may quit, and Ravi may never learn why. |
| story 3, impact, responsible, feedback | Yes. Both the game and the friendships are affected, and Ravi cannot fix what he does not know about. | Yes. The game suffers, and Ravi cannot fix what he does not know. |
| story 3, impact, plausible_incomplete, option | Ravi will notice sooner or later and fix it himself, so nobody needs to do anything yet. | Ravi will notice soon and fix it, so nobody needs to act. |
| story 3, impact, plausible_incomplete, feedback | He might. People often do not see their own habits unless someone tells them kindly. | He might. People often miss their own habits unless someone kindly says so. |
| story 3, impact, plausible_incomplete, option | The annoyed friends will get over it, because tag is over in a few minutes anyway. | The friends will get over it, since tag ends in minutes. |
| story 3, impact, plausible_incomplete, feedback | The feeling may fade, but it can come back the next time, and this happens at recess most days. | The feeling may fade, but it can return. Recess happens most days. |
| story 3, consider, setup | What are some ways you could handle this? | What could you do about it? |
| story 3, consider, responsible, option | Suggest that the group agrees on the rules before the next round starts. | Suggest the group agree on the rules before the next round. |
| story 3, consider, responsible, feedback | Agreeing on rules ahead of time takes the blame off one person and helps every game after this one. | Agreeing first takes blame off one person and helps every game. |
| story 3, consider, plausible_incomplete, option | Tell everyone loudly that Ravi is cheating so that he has to stop right now. | Say loudly that Ravi is cheating so he has to stop. |
| story 3, consider, plausible_incomplete, feedback | It would be noticed, but calling someone out in front of others often makes them defend themselves instead of listen. | Calling someone out makes them defend themselves instead of listening. |
| story 3, consider, plausible_incomplete, option | Quietly start a different game with the friends who are annoyed and leave Ravi out. | Start a new game with the annoyed friends and leave Ravi out. |
| story 3, consider, plausible_incomplete, feedback | That fixes today's game, but Ravi is left out without knowing why, and the problem may come back with someone else. | That fixes today's game. But Ravi is left out and does not know why. |
| story 3, choose, setup | What is the most constructive next step right now? | What is the best next step? |
| story 3, choose, responsible, feedback | A clear request that includes everyone gives Ravi a way to say yes without feeling attacked. | A request that includes everyone lets Ravi say yes without feeling attacked. |
| story 3, choose, multiple_defensible, option | Talk to Ravi alone later and tell him how the rule changes felt. | Talk to Ravi alone later and tell him how it felt. |
| story 3, choose, multiple_defensible, feedback | A private talk can work well, since Ravi will not feel embarrassed. It is slower, and the game may be over by then. | A private talk spares Ravi embarrassment. It is slower, though, and the game may be over. |
| story 3, choose, unsafe, option | Tell the group that Ravi is a cheater and nobody should play with him. | Tell the group Ravi is a cheater and nobody should play. |
| story 3, choose, unsafe, feedback | Labeling Ravi turns a rule problem into a problem about who he is, and a label like that can follow him around. | Labeling Ravi turns a rule problem into a personal one. |
| story 3, choose, seek_help, feedback | A helper can keep things calm and fair when a group cannot settle it alone. That is a good use of an adult. | A helper keeps things calm and fair when a group is stuck. |
| story 3, reflect, setup | What is one fair way to decide the rules before a game starts? | How can a group fairly decide the rules before a game? |
| story 4, recognize, setup | Your friend Lena tells you she is nervous about reading aloud tomorrow. At lunch, another classmate asks you, "Is Lena scared about the reading?" | Lena told you she is nervous about reading aloud tomorrow. At lunch, a classmate asks if she is scared. |
| story 4, recognize, responsible, option | Notice that Lena told you this in trust, and that the question asks you to pass it on. | Lena told you in trust, and you are asked to share. |
| story 4, recognize, responsible, feedback | Good noticing. Spotting that something was shared in trust is the first step to keeping it that way. | Good noticing. Seeing that it was shared in trust helps you keep it. |
| story 4, recognize, plausible_incomplete, option | It is only a feeling about reading, so it is not really a secret and sharing it would be fine. | It is only a feeling about reading, so sharing it is fine. |
| story 4, recognize, plausible_incomplete, feedback | Lena did not say it was a secret, but she chose you to tell. Feelings like nerves are personal. | Lena chose you to tell. Feelings like nerves are personal. |
| story 4, recognize, plausible_incomplete, option | The classmate probably just wants to help, so it is nice to tell them what you know. | The classmate wants to help, so it is nice to tell them. |
| story 4, recognize, plausible_incomplete, feedback | They might mean well. Even so, how Lena feels is hers to share, and you would be answering for her. | They may mean well. Even so, how Lena feels is hers to share. |
| story 4, impact, setup | If Lena finds out you told, what is likely to happen? | If Lena finds out you told, what could happen? |
| story 4, impact, responsible, option | Lena may feel embarrassed, stop telling you things, and feel more nervous about reading tomorrow. | Lena may feel embarrassed and stop telling you things. |
| story 4, impact, responsible, feedback | Yes. Trust is hard to rebuild, and sharing her feeling could make tomorrow harder for her. | Yes. Trust is hard to rebuild, and tomorrow could feel harder. |
| story 4, impact, plausible_incomplete, option | Lena will probably not mind, since lots of people feel nervous about reading aloud. | Lena will not mind, since many kids feel nervous too. |
| story 4, impact, plausible_incomplete, feedback | It is common to feel nervous, but that does not mean she wants other people to know. | Many people feel nervous. That does not mean she wants others to know. |
| story 4, impact, plausible_incomplete, option | Lena may be upset for a bit, but she will understand that you were only trying to help. | Lena may be upset, but she will know you meant to help. |
| story 4, impact, plausible_incomplete, feedback | She might forgive you. She might also wonder what else you will share, and good intentions do not undo the hurt. | She might forgive you. She might also wonder what else you will share. |
| story 4, consider, setup | What are some ways you could answer the classmate? | How could you answer the classmate? |
| story 4, consider, responsible, option | Say, "That is Lena's to share," and then change the subject kindly. | Say, "That is Lena's to share," and kindly change the subject. |
| story 4, consider, responsible, feedback | It is honest and kind. You are not hiding anything, and you are not speaking for Lena. | It is honest and kind, and you do not speak for Lena. |
| story 4, consider, plausible_incomplete, option | Say, "I don't know," even though you do, so the classmate stops asking. | Say "I don't know" even though you do, so they stop asking. |
| story 4, consider, plausible_incomplete, feedback | It ends the question, but it is not true. Being honest and protecting a friend can go together. | That ends the questions, but it is untrue. You can be honest and protect her. |
| story 4, consider, plausible_incomplete, option | Say a little, like "She is a bit worried," so it feels like you are being honest. | Say a little, like "She is a bit worried," to seem honest. |
| story 4, consider, plausible_incomplete, feedback | A little still counts as telling. Once part of it is out, the rest is easy to guess. | A little still counts as telling. The rest is easy to guess. |
| story 4, choose, setup | What is the most constructive next step right now? | What is the best next step? |
| story 4, choose, responsible, option | Tell the classmate it is Lena's to share, then ask Lena if she wants help practicing. | Say it is Lena's to share, then offer her practice help. |
| story 4, choose, responsible, feedback | You protect her privacy, you stay honest, and you offer help. That is what a trusted friend does. | That protects her privacy, keeps you honest, and offers help. |
| story 4, choose, multiple_defensible, option | Tell the classmate you are not sure, then let Lena know someone was asking about her. | Say you are not sure, then tell Lena someone asked about her. |
| story 4, choose, multiple_defensible, feedback | This keeps her feelings private and lets Lena decide what to do. Saying "That is Lena's to share" would be more honest than "I'm not sure." | Her feelings stay private, and Lena can decide. Saying it is hers to share is more honest. |
| story 4, choose, unsafe, option | Tell the classmate that Lena is nervous, since it is probably not a big deal anyway. | Tell the classmate Lena is nervous, since it is no big deal. |
| story 4, choose, unsafe, feedback | Deciding it is not a big deal is making a choice for Lena. She trusted you to keep it. | Calling it no big deal decides for Lena. She trusted you to keep it. |
| story 4, choose, seek_help, option | Ask a teacher for ideas on how to support Lena without sharing her feelings with anyone. | Ask a teacher how to support Lena without sharing her feelings. |
| story 4, choose, seek_help, feedback | A teacher can help you support Lena in ways that keep her feelings private. Asking is a smart move. | A teacher can help you support her and keep her feelings private. |

## Team Pick (123 lines changed)

| Where | Now | New |
|---|---|---|
| story 1, recognize, setup | At recess, your two best friends are picking teams for four-square. They pick almost everyone else first, and you are the last one left standing. | At recess, your two best friends pick teams for four-square. You are the last one picked. |
| story 1, recognize, responsible, option | Notice that you feel hurt and frustrated, and that this is a normal reaction to have. | Notice you feel hurt and frustrated. That is normal. |
| story 1, recognize, responsible, feedback | Naming what you are feeling is the first step to handling it well. | Naming your feeling is the first step to handling it well. |
| story 1, recognize, plausible_incomplete, option | It is just a game of four-square, so there is no real reason to feel anything about it. | It is just a game, so there is nothing to feel. |
| story 1, recognize, plausible_incomplete, feedback | It is okay to feel something even about "just a game". Pretending you do not feel anything does not make the feeling go away. | You can feel something about a game. Hiding it will not make it go away. |
| story 1, recognize, plausible_incomplete, option | Your friends probably did not mean it, so you should push the feeling away and move on. | Your friends did not mean it, so push the feeling away. |
| story 1, recognize, plausible_incomplete, feedback | They may not have meant it. Even so, pushing the feeling away does not make it disappear, and it can come back later. | Maybe they did not mean it. Pushed-down feelings often come back later. |
| story 1, impact, setup | If you let the frustration build up without doing anything about it, what might happen? | If you hold the frustration in and do nothing, what might happen? |
| story 1, impact, responsible, option | The rest of recess could feel worse, and your friends may never know how you feel unless you tell them. | Recess feels worse, and your friends never learn how you feel. |
| story 1, impact, responsible, feedback | Both are true: the feeling can grow, and your friends may never know unless you find a way to say something. | Both can happen. The feeling can grow, and friends cannot guess it. |
| story 1, impact, plausible_incomplete, option | Nothing much, since feelings like that go away on their own in a few minutes, and recess will be over soon. | Nothing. Feelings like this fade fast, and recess ends soon. |
| story 1, impact, plausible_incomplete, feedback | Sometimes they fade fast, but sometimes they do not. Assuming it will always just disappear is not really a plan. | Sometimes it fades fast. Other times it stays, so hoping is not a plan. |
| story 1, impact, plausible_incomplete, option | Your friends will notice something is wrong and come over to ask what happened, without being asked. | Your friends will notice and come ask what is wrong. |
| story 1, impact, plausible_incomplete, feedback | Some friends might. Many do not see how you feel unless you say so, so waiting for them to notice is a risky plan. | Some friends will. Many cannot tell how you feel unless you say so. |
| story 1, consider, setup | What are some ways you could handle feeling left out? | What could you do about feeling left out? |
| story 1, consider, responsible, option | Take a few slow breaths and remind yourself that one moment does not mean your friends dislike you. | Take slow breaths. One moment does not mean they dislike you. |
| story 1, consider, responsible, feedback | A calming strategy like this helps you think clearly before you react. | Calming down first helps you think clearly before you act. |
| story 1, consider, plausible_incomplete, option | Stay quiet through the rest of recess and hope the feeling passes on its own by lunch. | Stay quiet through recess and hope the feeling passes by lunch. |
| story 1, consider, plausible_incomplete, feedback | That might work sometimes, but it does not give you a real plan if the feeling sticks around or happens again. | That may work, but it is no plan if it returns. |
| story 1, consider, plausible_incomplete, option | Walk off to the side and sit out the rest of recess so you do not have to see your friends. | Sit out the rest of recess to avoid seeing your friends. |
| story 1, consider, plausible_incomplete, feedback | Taking a break can help sometimes. Sitting out the whole recess just to avoid your friends can make it feel even more like being left out. | A short break can help. Sitting out all recess can feel even lonelier. |
| story 1, choose, setup | What is the most constructive thing to do right now? | What is the best thing to do right now? |
| story 1, choose, unsafe, option | Say, "Fine, whatever, I did not want to play anyway," and walk off angrily without explaining. | Say, "Fine, I did not want to play anyway," and storm off. |
| story 1, choose, unsafe, feedback | That protects you for a moment, but your friends will only hear the anger. They still will not know why you are upset. | That protects you for now, but your friends only hear anger. |
| story 1, choose, multiple_defensible, option | Take a breath, join the game anyway, and bring it up with your friends later when everyone is calm. | Take a breath, join the game, and talk to them later. |
| story 1, choose, multiple_defensible, feedback | Reasonable. You manage the moment now and still address it later, when it is easier to talk about. | Good plan. You handle the moment now and talk when it is easier. |
| story 1, choose, responsible, option | Take a breath, then tell your friends calmly that being picked last felt bad, with no blame. | Take a breath, then calmly say being picked last felt bad. |
| story 1, choose, responsible, feedback | This manages your own reaction and still opens the door for your friends to understand your side. | You manage your own feelings and help friends understand you. |
| story 1, choose, seek_help, option | If the feeling does not go away, talk to a teacher or family member about how to handle it. | If the feeling stays, talk to a teacher or family member. |
| story 1, choose, seek_help, feedback | Getting another perspective is always a reasonable option, especially if this keeps happening. | A grown-up can help, especially if this keeps happening. |
| story 1, reflect, setup | What is one thing that helps you calm down when you are feeling left out or frustrated? | What is one thing that calms you when you feel left out? |
| story 2, recognize, setup | In kickball, your team loses by one run after you miss an easy catch. A few teammates groan, and your face feels hot. | You miss an easy catch, and your team loses by one run. Teammates groan, and your face feels hot. |
| story 2, recognize, responsible, option | Notice that you feel embarrassed, and maybe a bit angry too, and that this is a normal reaction. | Notice you feel embarrassed and a bit angry. That is normal. |
| story 2, recognize, responsible, feedback | Naming the feeling is the first step. It helps your thinking stay clear while the hot feeling passes. | Naming the feeling helps you think clearly while it fades. |
| story 2, recognize, plausible_incomplete, option | Tell yourself that you do not care at all, because it is only a game and nobody will remember. | Tell yourself you do not care. It is only a game. |
| story 2, recognize, plausible_incomplete, feedback | Saying you do not care can feel safer, but the feeling is still there, and it tends to show up some other way. | Saying you do not care feels safer. The feeling is still there. |
| story 2, recognize, plausible_incomplete, option | Decide the miss was not your fault, because the sun was in your eyes and the ball was fast. | Decide it was not your fault. The sun was in your eyes. |
| story 2, recognize, plausible_incomplete, feedback | Maybe the sun did make it harder. Still, deciding it was all outside you makes it hard to learn from it. | The sun may have made it harder. Blaming it all on outside things stops you learning. |
| story 2, impact, setup | If the feeling takes over, what is likely to happen for the rest of recess? | If the feeling takes over, what might happen at recess? |
| story 2, impact, responsible, option | You may snap at a teammate or walk off upset, and people may remember that more than the miss. | You may snap at someone, and people remember that, not the miss. |
| story 2, impact, responsible, feedback | Yes. A strong feeling can make a small moment bigger than it needs to be. | Yes. A big feeling can make a small moment feel bigger. |
| story 2, impact, plausible_incomplete, option | You will feel bad for a moment, then forget about it, so nothing about the rest of recess changes. | You feel bad for a moment, then forget it. Nothing changes. |
| story 2, impact, plausible_incomplete, feedback | Sometimes it fades fast. Feelings that are ignored often come back at a worse moment. | Sometimes it fades fast. Ignored feelings often return at a worse time. |
| story 2, impact, plausible_incomplete, option | Your teammates will stay annoyed with you, and there is nothing you can do to change that. | Your teammates stay annoyed, and you cannot do anything about it. |
| story 2, impact, plausible_incomplete, feedback | How teammates react depends a lot on what you do next, so you have more say than it feels like. | How teammates feel depends on what you do next. You have a say. |
| story 2, consider, setup | What are some ways you could handle the feeling? | What could you do about the feeling? |
| story 2, consider, responsible, option | Take a few slow breaths and remember that one missed catch does not define you. | Take slow breaths. One missed catch does not make you bad. |
| story 2, consider, responsible, feedback | Calming your body first helps you choose what to do next instead of reacting. | Calming your body first helps you choose, not just react. |
| story 2, consider, plausible_incomplete, option | Stay quiet for the rest of recess so nobody has a chance to say anything more about it. | Stay quiet the rest of recess so nobody can say more. |
| story 2, consider, plausible_incomplete, feedback | Staying quiet may feel safe, but it leaves the hot feeling with you and the team without a word from you. | Quiet feels safe, but you keep the hot feeling to yourself. |
| story 2, consider, plausible_incomplete, option | Joke about it loudly so everyone laughs and the groaning moment is quickly forgotten. | Joke about it loudly so everyone laughs and the moment passes. |
| story 2, consider, plausible_incomplete, feedback | A joke can ease things for some people. If it covers up how you feel, the feeling may still be waiting afterward. | A joke can ease things. If it hides your feeling, it may return. |
| story 2, choose, setup | What is the most constructive next step right now? | What is the best next step right now? |
| story 2, choose, responsible, option | Take a breath, then say to the team, "I missed that one, and I will get the next." | Say calmly, "I missed that one. I will get the next." |
| story 2, choose, responsible, feedback | Owning the miss calmly shows your team you can handle mistakes, and it usually ends the groaning. | Owning the miss shows you can handle mistakes. The groaning usually stops. |
| story 2, choose, multiple_defensible, option | Step aside for a minute to calm down, then rejoin the game when you feel ready. | Step aside to calm down, then rejoin when you are ready. |
| story 2, choose, multiple_defensible, feedback | A short break is a good tool, and rejoining shows you are ready to keep going. | A short break is a good tool. Rejoining shows you are ready. |
| story 2, choose, unsafe, option | Say the ball was bad and the sun was too bright, so it was not your fault. | Blame the ball and the sun. Say it was not your fault. |
| story 2, choose, unsafe, feedback | Excuses may protect you for a moment, but they can make teammates feel you are not taking the game seriously. | Excuses feel safe. Teammates may think you do not take the game seriously. |
| story 2, choose, seek_help, option | Tell the recess helper you are feeling upset and ask for a minute to calm down. | Tell the recess helper you are upset and need a minute. |
| story 2, choose, seek_help, feedback | Telling a helper is a strong move, and you can do it whenever a feeling feels too big. | Telling a helper is strong, and you can do it any time. |
| story 2, reflect, setup | What can you tell yourself the next time you make a mistake in front of other people? | What can you tell yourself after a mistake in front of others? |
| story 3, recognize, setup | You studied all week, but your spelling test score is lower than you hoped. The friend next to you got every word right. | You studied all week, but your spelling score was lower than hoped. Your friend next to you got every word right. |
| story 3, recognize, responsible, option | Notice that you feel disappointed, and maybe a bit jealous too, and that both are normal. | Notice you feel disappointed and a bit jealous. Both are normal. |
| story 3, recognize, responsible, feedback | Naming both feelings is a good start. You can feel disappointed and still be happy for a friend. | Naming both feelings is a good start. You can be glad for a friend too. |
| story 3, recognize, plausible_incomplete, option | Decide that you are just bad at spelling, because all that studying did not help. | Decide you are just bad at spelling, since studying did not help. |
| story 3, recognize, plausible_incomplete, feedback | That is a lot of weight to put on one test. One score tells you about this test, and not much else. | That puts a lot on one test. One score says little about you. |
| story 3, recognize, plausible_incomplete, option | Decide that spelling tests do not matter, so there is no reason to feel anything about it. | Decide spelling tests do not matter, so you feel nothing. |
| story 3, recognize, plausible_incomplete, feedback | It is a quick way to feel better, but you did study, which shows this mattered to you. | That feels better fast, but you did study, so it clearly mattered. |
| story 3, impact, setup | If you decide you are just bad at spelling, what is likely to happen? | If you decide you are bad at spelling, what might happen? |
| story 3, impact, responsible, option | You may study less next week, feel worse about spelling, and miss the chance to get better. | You may study less and miss the chance to get better. |
| story 3, impact, responsible, feedback | Yes. What we believe about ourselves changes how hard we try. | Yes. What you believe about yourself changes how hard you try. |
| story 3, impact, plausible_incomplete, option | You will feel better right away, and that will make it easier to focus on other subjects. | You feel better right away, so you focus on other subjects. |
| story 3, impact, plausible_incomplete, feedback | It may feel better for a moment, but giving up on a skill usually makes it harder later. | It feels better now. Giving up on a skill makes it harder later. |
| story 3, impact, plausible_incomplete, option | Your teacher will notice and give you extra help without you needing to ask for it. | Your teacher notices and gives you extra help without being asked. |
| story 3, impact, plausible_incomplete, feedback | Teachers do notice, but they cannot always tell what a student needs. Asking is much more reliable. | Teachers notice, but cannot always tell what you need. Asking works better. |
| story 3, consider, setup | What are some ways you could handle this? | What could you do about this? |
| story 3, consider, responsible, option | Look at which words you missed and pick a few to practice again tonight. | Check which words you missed and practice a few tonight. |
| story 3, consider, responsible, feedback | A small, clear plan turns a disappointing score into something you can act on. | A small, clear plan gives you something to act on. |
| story 3, consider, plausible_incomplete, option | Ask your friend to quiz you every day until you score as high as they did. | Ask your friend to quiz you daily until you match their score. |
| story 3, consider, plausible_incomplete, feedback | Practicing with a friend can be fun and helpful. Trying to match their score can turn it into a race that adds pressure. | Practicing together is fun. Trying to match their score adds pressure. |
| story 3, consider, plausible_incomplete, option | Study twice as long next week, with no breaks, so that the same thing never happens again. | Study twice as long next week and take no breaks. |
| story 3, consider, plausible_incomplete, feedback | Working harder may help, but a plan with no breaks is hard to keep up. A smaller, steady goal works better. | A plan with no breaks is hard to keep. Small, steady goals work better. |
| story 3, choose, setup | What is the most constructive next step right now? | What is the best next step right now? |
| story 3, choose, responsible, option | Pick three missed words to practice tonight and check how it goes on Friday. | Pick three missed words to practice tonight and check again Friday. |
| story 3, choose, responsible, feedback | A small goal that you can check is how people actually get better at things. | A small goal you can check is how people really get better. |
| story 3, choose, multiple_defensible, option | Ask your teacher for ideas on how to study spelling in a different way. | Ask your teacher for different ways to study your spelling words. |
| story 3, choose, multiple_defensible, feedback | Teachers know many ways to study, and asking shows you care about improving. | Teachers know many ways to study, and asking shows you care. |
| story 3, choose, unsafe, option | Decide that spelling is not for you and stop trying on the next test. | Decide spelling is not for you and give up next time. |
| story 3, choose, unsafe, feedback | Stopping can feel like a relief, but it closes the door on getting better, and a spelling score is only one test. | Quitting feels like relief, but it stops you getting better. |
| story 3, choose, seek_help, option | Tell your friend congratulations and ask how they like to study. | Congratulate your friend and ask how they like to study. |
| story 3, choose, seek_help, feedback | Asking a friend how they study can give you ideas, and it turns a jealous feeling into something useful. | A friend's tips can help, and they turn jealousy into something useful. |
| story 3, reflect, setup | What is one small goal you could set after a result you did not expect? | What small goal could you set after an unexpected result? |
| story 4, recognize, setup | The class play parts are announced. Your friend Zoe gets the lead role you wanted, and you get a small part. | The class play parts are out. Zoe gets the lead you wanted, and you get a small part. |
| story 4, recognize, responsible, option | Notice that you feel let down and a little jealous, and also a bit happy for Zoe. | Notice you feel jealous and let down, but happy for Zoe too. |
| story 4, recognize, responsible, feedback | Mixed feelings are normal. You can be disappointed and still care about your friend. | Mixed feelings are normal. You can be let down and still care. |
| story 4, recognize, plausible_incomplete, option | Tell yourself that it is not fair, and that the teacher picked Zoe for the wrong reasons. | Tell yourself it is not fair and the teacher chose badly. |
| story 4, recognize, plausible_incomplete, feedback | It is easy to feel that way. You do not know the teacher's reasons, though, and blaming them can keep you stuck. | It is easy to feel that way. But you do not know the teacher's reasons. |
| story 4, recognize, plausible_incomplete, option | Tell yourself that you are fine and that it does not bother you at all. | Tell yourself you are fine and it does not bother you. |
| story 4, recognize, plausible_incomplete, feedback | Saying you are fine can feel safer, but a feeling you do not look at tends to pop out later. | Saying you are fine feels safe, but hidden feelings pop out later. |
| story 4, impact, responsible, option | You may pull away from Zoe, enjoy rehearsals less, and miss the fun of being in the play. | You may pull away from Zoe and enjoy rehearsals less. |
| story 4, impact, responsible, feedback | Yes. Feelings you hide can grow into distance between friends. | Yes. Hidden feelings can grow into distance between friends. |
| story 4, impact, plausible_incomplete, option | It will probably fade on its own by the first rehearsal, so nothing else needs to happen. | It fades by the first rehearsal, so nothing else is needed. |
| story 4, impact, plausible_incomplete, feedback | It might. If it does not, you may have already pulled away without meaning to. | It might. If not, you may have pulled away without meaning to. |
| story 4, impact, plausible_incomplete, option | Zoe will notice you are upset and fix it by offering you a bigger part or a favor. | Zoe notices you are upset and gives you a bigger part. |
| story 4, impact, plausible_incomplete, feedback | Zoe cannot change the parts, and expecting her to fix it puts a lot on her. Telling her how you feel is fairer. | Zoe cannot change the parts. Telling her how you feel is fairer. |
| story 4, consider, setup | What are some ways you could handle this? | What could you do about this? |
| story 4, consider, responsible, option | Say congratulations to Zoe, and then put your effort into making your own part great. | Say congratulations to Zoe, then work hard on your own part. |
| story 4, consider, responsible, feedback | You protect the friendship and give yourself something good to work on. | You keep the friendship and give yourself something good to work on. |
| story 4, consider, plausible_incomplete, option | Tell Zoe you are upset, and ask her to turn down the lead so that you can have it. | Ask Zoe to turn down the lead so you can have it. |
| story 4, consider, plausible_incomplete, feedback | Being honest about feelings is good, but asking Zoe to give up her part is not fair to her. | Being honest is good. Asking Zoe to give up her part is not fair. |
| story 4, consider, plausible_incomplete, option | Keep your distance from Zoe at rehearsals until your feelings settle down. | Keep away from Zoe at rehearsals until your feelings settle down. |
| story 4, consider, plausible_incomplete, feedback | A little space can help for a day. A long distance can turn a hard feeling into a lasting gap. | A little space can help for a day. Too much can become a lasting gap. |
| story 4, choose, setup | What is the most constructive next step right now? | What is the best next step right now? |
| story 4, choose, responsible, option | Tell Zoe congratulations, and do your best with your own part in the play. | Tell Zoe congratulations and do your best with your own part. |
| story 4, choose, responsible, feedback | It shows kindness and gives you a clear job. Friends often remember who cheered for them. | That shows kindness and gives you a clear job. Friends remember who cheered for them. |
| story 4, choose, multiple_defensible, option | Tell a trusted friend how you feel first, then talk to Zoe when you feel calmer. | Tell a trusted friend how you feel, then talk to Zoe later. |
| story 4, choose, multiple_defensible, feedback | Talking it through first can help you say what you mean calmly. Just make sure you do get back to Zoe. | Talking first helps you speak calmly. Just be sure to talk to Zoe too. |
| story 4, choose, unsafe, option | Tell others that Zoe only got the lead because she is the teacher's favorite. | Tell others Zoe only got the lead as the teacher's favorite. |
| story 4, choose, unsafe, feedback | Spreading that idea could hurt Zoe and make rehearsals tense for everyone, including you. | Spreading that could hurt Zoe and make rehearsals tense for everyone. |
| story 4, choose, seek_help, option | Ask the teacher what you can work on to earn a bigger part next time. | Ask the teacher how to earn a bigger part next time. |
| story 4, choose, seek_help, feedback | This turns a disappointment into a plan. Teachers usually like being asked. | This turns disappointment into a plan. Teachers usually like being asked. |
| story 4, reflect, setup | What can you do with a feeling like jealousy so that it does not hurt a friendship? | How can you keep jealousy from hurting a friendship? |

## Peace Table (110 lines changed)

| Where | Now | New |
|---|---|---|
| story 1, recognize, setup | Mia and Ben both want the last turn on the classroom computer, and the lunch bell is about to ring. Each says, "I was here first." You are Mia. What do you do first? | Mia and Ben want the last computer turn. Each says, "I was here first." You are Mia. What do you do first? |
| story 1, recognize, responsible, option | Say what happened and how you feel: "I am frustrated, and I think I was next." | Say how you feel: "I'm frustrated. I think I was next." |
| story 1, recognize, responsible, feedback | Saying it calmly lets Ben hear you without feeling attacked, and it names the problem. | Calm words let Ben listen. He hears the problem without feeling attacked. |
| story 1, recognize, plausible_incomplete, option | Say that it is only a computer, so Ben should not care so much about it. | Tell Ben it is only a computer, so he should not care. |
| story 1, recognize, plausible_incomplete, feedback | It may be small to you, but Ben cares. Telling him not to care usually makes things worse. | It may feel small to you, but Ben cares. Telling him not to makes it worse. |
| story 1, recognize, plausible_incomplete, option | Tell Ben that he always does this, so everyone knows what he is like. | Tell Ben he always does this, so everyone knows. |
| story 1, recognize, plausible_incomplete, feedback | "Always" feels like an attack, and it makes people defend themselves instead of listening. | "Always" sounds like an attack. Ben will defend himself instead of listening. |
| story 1, impact, responsible, option | Ben also wants a turn and is also in a hurry, and he feels that he was next. | Ben is in a hurry too and thinks he was next. |
| story 1, impact, responsible, feedback | Seeing his side does not mean giving in. It helps you find a plan that works for both of you. | Seeing his side helps you find a plan for both of you. |
| story 1, impact, plausible_incomplete, option | Ben is just being greedy, so there is nothing to understand about his side. | Ben is just being greedy, so there is nothing to understand. |
| story 1, impact, plausible_incomplete, feedback | Calling him greedy closes the conversation. He may have a good reason to want the turn too. | Calling him greedy shuts the conversation down. He may have a good reason too. |
| story 1, impact, plausible_incomplete, option | Whoever talks the loudest should get the turn, since that is how it usually goes. | Whoever talks the loudest should get the turn, like usual. |
| story 1, impact, plausible_incomplete, feedback | Loud does not mean right. A fair plan does not depend on who is louder. | Loud kids are not always right. A fair plan cannot depend on who is louder. |
| story 1, consider, responsible, option | Share the turn, flip a coin, or split the time, so that both of you get something. | Share the turn, flip a coin, or split the time. |
| story 1, consider, responsible, feedback | A plan that gives both of you something is easier to agree on, and it ends the argument quickly. | Both of you get something. A plan like this ends the argument fast. |
| story 1, consider, plausible_incomplete, option | Ask the teacher to decide right away, without trying to work it out first. | Ask the teacher to decide right away, before trying anything. |
| story 1, consider, plausible_incomplete, feedback | A teacher can help, but trying first shows that you can solve it yourselves. Save the teacher for when you are stuck. | A teacher can help. Try first, and save the teacher for when you are stuck. |
| story 1, consider, plausible_incomplete, option | Take the computer while Ben is not looking, so that the problem is over. | Grab the computer while Ben looks away, so it is over. |
| story 1, consider, plausible_incomplete, feedback | That solves it for you and creates a new problem for Ben. He will feel tricked, and it will get worse. | That fixes it for you and makes a new problem for Ben. He will feel tricked. |
| story 1, choose, responsible, option | Suggest taking turns, five minutes each, and say it calmly and kindly. | Suggest five minutes each, and say it kindly. |
| story 1, choose, responsible, feedback | A calm offer with a clear plan is easy to say yes to, and it treats you both fairly. | A calm offer with a clear plan is easy to accept. It treats you both fairly. |
| story 1, choose, multiple_defensible, option | Suggest a coin flip, and agree ahead of time to accept whatever it says. | Suggest a coin flip, and agree to accept what it says. |
| story 1, choose, multiple_defensible, feedback | Also fair. A coin flip is quick, and agreeing ahead of time keeps it from turning into another argument. | Also fair. A coin flip is quick, and agreeing first stops another argument. |
| story 1, choose, unsafe, option | Grab the mouse and say loudly that the turn is yours and Ben must wait. | Grab the mouse and say the turn is yours. |
| story 1, choose, unsafe, feedback | Grabbing makes Ben angry and may get you both in trouble. It also teaches him not to trust you. | Grabbing makes Ben angry and may get you both in trouble. He may stop trusting you. |
| story 1, choose, seek_help, option | Ask the teacher to help you decide, if the two of you cannot agree. | Ask the teacher to help if you cannot agree. |
| story 1, choose, seek_help, feedback | When you are stuck, asking an adult is smart, and it is not the same as giving up. | Asking an adult when you are stuck is smart. The teacher can help you both. |
| story 2, recognize, setup | Priya borrows Amir's special pencil case, and the zipper breaks. Amir is upset. Priya feels bad, and she thinks the zipper was already loose. You are Priya. What do you do first? | Priya borrowed Amir's special pencil case, and the zipper broke. Amir is upset. You are Priya. What do you do first? |
| story 2, recognize, responsible, option | Say what happened and that you feel bad, and be honest that it broke in your hands. | Say you feel bad and tell him it broke in your hands. |
| story 2, recognize, responsible, feedback | Telling the truth right away shows that you respect Amir and the thing that he lent you. | Telling the truth right away shows you respect Amir and his things. |
| story 2, recognize, plausible_incomplete, option | Say that it was already broken, so it is not your fault at all, and move on. | Say it was already loose, so it is not your fault. |
| story 2, recognize, plausible_incomplete, feedback | It may have been loose, but it broke in your hands. Saying it is not your fault makes Amir feel ignored. | It may have been loose, but it broke in your hands. Amir will feel brushed off. |
| story 2, recognize, plausible_incomplete, option | Hide the pencil case and say nothing, hoping that Amir will not notice it for a while. | Hide the pencil case and hope Amir does not notice. |
| story 2, recognize, plausible_incomplete, feedback | He will notice, and hiding it makes the problem bigger. Honesty is easier than a cover-up. | He will notice, and hiding it makes the problem bigger. Honesty is easier. |
| story 2, impact, responsible, option | The pencil case matters to him, and he feels sad and a little angry. | It matters to him. He feels sad and a little angry. |
| story 2, impact, responsible, feedback | Knowing how it feels for him helps you say sorry in a way that he can hear. | Knowing how he feels helps you say sorry well. |
| story 2, impact, plausible_incomplete, option | It is only a pencil case, so he should not be so upset about it. | It is only a pencil case, so he should calm down. |
| story 2, impact, plausible_incomplete, feedback | It might be small to you, but it is special to him. His feelings are real either way. | It may be small to you, but it is special to him. His feelings are real. |
| story 2, impact, plausible_incomplete, option | He is overreacting, so you can wait until he calms down and then say nothing. | He is overreacting, so wait it out and say nothing. |
| story 2, impact, plausible_incomplete, feedback | Waiting without saying anything can feel like ignoring him. A short, honest sorry helps more. | Staying silent can feel like ignoring him. A short, honest sorry helps more. |
| story 2, consider, responsible, option | Say sorry, offer to help fix or replace it, and ask what would help him most. | Say sorry, offer to fix it, and ask what he wants. |
| story 2, consider, responsible, feedback | Offering to repair it and asking what he wants gives Amir a say in how this ends. | Offering a fix and asking what he wants gives Amir a say. |
| story 2, consider, plausible_incomplete, option | Say sorry quickly and walk away, so that the awkward moment is over for both of you. | Say sorry fast and walk away, so the awkward moment ends. |
| story 2, consider, plausible_incomplete, feedback | Saying sorry is a good start, but walking away leaves Amir with the problem. | Sorry is a good start. Walking away leaves Amir alone with the problem. |
| story 2, consider, plausible_incomplete, option | Offer to give him something else of yours instead, so that you are even. | Give him something else of yours, so you are even. |
| story 2, consider, plausible_incomplete, feedback | A gift is kind, but it may not be what he wants. Asking first is better. | A gift is kind, but it may not be what he wants. Ask first. |
| story 2, choose, responsible, option | Say sorry, say what you will do to help, and ask Amir what he would like. | Say sorry, offer to help, and ask what Amir would like. |
| story 2, choose, responsible, feedback | This is honest, kind and clear, and it gives Amir a real choice. | You are honest and kind, and Amir gets a real choice. |
| story 2, choose, multiple_defensible, option | Ask a grown-up to help the two of you fix the zipper together, and say sorry again. | Say sorry again, and ask a grown-up to help fix the zipper. |
| story 2, choose, multiple_defensible, feedback | Also a good idea. Fixing it together is a way of making it right, and a grown-up may know a trick. | Also a good idea. Fixing it together helps, and a grown-up may know a trick. |
| story 2, choose, unsafe, option | Say that it was already broken, and refuse to talk about it any more. | Say it was already loose, and refuse to talk about it. |
| story 2, choose, unsafe, feedback | Refusing to talk leaves Amir hurt and alone with the problem. It can also end a friendship. | Refusing to talk leaves Amir hurt and alone with the problem. It can end a friendship. |
| story 2, choose, seek_help, option | Ask a teacher how to make it right, if you are not sure what to do. | Ask a teacher how to make it right if you are unsure. |
| story 2, choose, seek_help, feedback | Asking for help is a good choice when you do not know what to do, and teachers have seen this before. | Asking is a good choice when you are unsure. Teachers have seen this before. |
| story 2, reflect, setup | How do you want people to treat something that you lent them? | How do you want people to treat something you lent them? |
| story 3, recognize, setup | At recess, Zoe says to Leo, "You are not in our group today." Leo hears that he is not wanted, and it hurts. You are Leo. What do you do first? | Zoe says, "You are not in our group today." Leo feels unwanted. You are Leo. What do you do first? |
| story 3, recognize, responsible, option | Say what you heard and how it felt, and check that you understood her. | Say what you heard and how it felt. Check you understood. |
| story 3, recognize, responsible, feedback | Saying what you heard gives Zoe a chance to explain, and it keeps hurt feelings from growing. | Zoe gets a chance to explain, and the hurt does not grow. |
| story 3, recognize, plausible_incomplete, option | Say nothing and walk away, and feel sad about it for the rest of the day. | Say nothing and walk away, and feel sad all day. |
| story 3, recognize, plausible_incomplete, feedback | Staying quiet protects you for a moment, but the hurt stays, and Zoe never finds out. | Staying quiet protects you for now, but the hurt stays. Zoe never finds out. |
| story 3, recognize, plausible_incomplete, option | Say something mean back, so that Zoe knows how it feels to be hurt. | Say something mean back, so Zoe knows how it feels. |
| story 3, recognize, plausible_incomplete, feedback | It may feel fair, but it starts a fight, and you might be wrong about what she meant. | It may feel fair, but it starts a fight. You might be wrong about what she meant. |
| story 3, impact, responsible, option | She may not have meant to sting, and she might have meant something different. | She may have meant something different than it sounded. |
| story 3, impact, responsible, feedback | A short sentence can mean different things. Asking is the only way to find out. | A short sentence can mean many things. Asking is the only way to find out. |
| story 3, impact, plausible_incomplete, option | She meant to hurt you, so she must be mean and you should stay away from her. | She meant to hurt you, so she must be mean. Stay away. |
| story 3, impact, plausible_incomplete, feedback | That is a guess, and it may be wrong. Deciding she is mean can end a friendship over a mix-up. | That is a guess, and it may be wrong. A mix-up could end a friendship. |
| story 3, impact, plausible_incomplete, option | It does not matter what she meant, because it hurt either way and that is all that counts. | It does not matter what she meant. It hurt either way. |
| story 3, impact, plausible_incomplete, feedback | How it felt does matter, and so does what she meant. Both can be true and both can be talked about. | How it felt matters, and so does what she meant. You can talk about both. |
| story 3, consider, responsible, option | Ask a calm question, such as "Did you mean that I am not included?" | Ask calmly: "Did you mean I am not included?" |
| story 3, consider, responsible, feedback | A calm question gives her room to explain, and it shows that you want to understand. | A calm question gives her room to explain. It shows you want to understand. |
| story 3, consider, plausible_incomplete, option | Ask your friends to take your side, so that Zoe knows that people agree with you. | Ask friends to take your side, so Zoe knows they agree. |
| story 3, consider, plausible_incomplete, feedback | Taking sides makes the problem bigger and pulls other people in. Talking to Zoe herself works better. | Taking sides makes the problem bigger and pulls others in. Talking to Zoe works better. |
| story 3, consider, plausible_incomplete, option | Avoid Zoe for the rest of the day, so that you do not have to talk about it. | Avoid Zoe all day so you do not have to talk. |
| story 3, consider, plausible_incomplete, feedback | Avoiding her means that the hurt stays. It is easier now, and harder tomorrow. | Avoiding her keeps the hurt alive. It is easier now and harder tomorrow. |
| story 3, choose, responsible, option | Ask Zoe what she meant, and tell her how it sounded to you. | Ask Zoe what she meant, and tell her how it sounded. |
| story 3, choose, responsible, feedback | This is honest and kind, and most mix-ups end with one question like this. | That is honest and kind. One question like this often clears up a mix-up. |
| story 3, choose, multiple_defensible, option | Ask if you can play in the next round, and say that you felt left out. | Ask to play next round, and say you felt left out. |
| story 3, choose, multiple_defensible, feedback | Also a good choice. You say how you feel and ask for what you want, and Zoe can answer easily. | Also a good choice. You say how you feel and ask for what you want. |
| story 3, choose, unsafe, option | Tell other kids that Zoe is unfair, so that they take your side. | Tell other kids Zoe is unfair, so they take your side. |
| story 3, choose, unsafe, feedback | This spreads the hurt and makes Zoe feel attacked. It also keeps you from finding out the truth. | That spreads the hurt and makes Zoe feel attacked. You also miss the truth. |
| story 3, choose, seek_help, option | Tell a teacher if the hurt feeling does not go away after you talk. | Tell a teacher if it still hurts after you talk. |
| story 3, choose, seek_help, feedback | If it still hurts, telling a teacher is a good idea. You do not have to carry it alone. | If it still hurts, tell a teacher. You do not have to carry it alone. |
| story 3, reflect, setup | When has something that you said sounded different from what you meant? | When has something you said sounded different from what you meant? |
| story 4, recognize, setup | In a playground game, Ana says the ball was in and Jin says it was out. Ana says Jin always cheats. Jin says Ana always wins by arguing. You are Ana. What do you do first? | Ana says the ball was in. Jin says out. They blame each other. You are Ana. What do you do first? |
| story 4, recognize, responsible, option | Say what you saw and that you are upset about the call, without any name-calling. | Say what you saw and how you feel. No name-calling. |
| story 4, recognize, responsible, feedback | Saying what you saw keeps the argument about the ball, and not about Jin as a person. | Saying what you saw keeps the argument about the ball. |
| story 4, recognize, plausible_incomplete, option | Say that Jin is a cheater, so that everyone knows what he did. | Say Jin is a cheater, so everyone knows what he did. |
| story 4, recognize, plausible_incomplete, feedback | Name-calling turns an argument about a ball into an argument about who someone is. It is much harder to fix. | Name-calling turns a ball argument into one about who Jin is. That is hard to fix. |
| story 4, recognize, plausible_incomplete, option | Quit the game and say that it is not fun anymore, so that Jin feels bad. | Quit and say the game is no fun, so Jin feels bad. |
| story 4, recognize, plausible_incomplete, feedback | Quitting ends the argument for you, but it ends the game for everyone else too. | Quitting ends the argument for you. It ends the game for everyone else too. |
| story 4, impact, responsible, option | Jin saw it differently, and he also feels accused, which is why he is upset. | Jin saw it differently, and he feels accused too. |
| story 4, impact, responsible, feedback | Two people can watch the same play and see different things, and nobody has to be lying. | Two people can watch the same play and see different things. Nobody has to be lying. |
| story 4, impact, plausible_incomplete, option | He is lying, so there is nothing to listen to on his side and no reason to hear him. | He is lying, so there is no reason to hear his side. |
| story 4, impact, plausible_incomplete, feedback | You cannot know that. Assuming he is lying makes it hard to hear what he actually saw. | You cannot know that. Thinking he lies makes it hard to hear what he saw. |
| story 4, impact, plausible_incomplete, option | Whoever has more friends here is probably right, so it does not matter what he says. | Whoever has more friends here is probably right. |
| story 4, impact, plausible_incomplete, feedback | Having more friends does not make a call right. A fair plan does not depend on who is more popular. | More friends do not make a call right. A fair plan ignores popularity. |
| story 4, consider, responsible, option | Agree on a fair way to decide, such as a do-over or a rule for close calls. | Agree on a fair way, such as a do-over or a rule. |
| story 4, consider, responsible, feedback | A rule for close calls helps this time and every other time, and neither of you has to give in. | A rule for close calls helps this time and next time. Neither of you gives in. |
| story 4, consider, plausible_incomplete, option | Let the loudest player decide, so that the game can keep going quickly. | Let the loudest player decide, so the game keeps going fast. |
| story 4, consider, plausible_incomplete, feedback | That is quick, but it is not fair. Loud is not the same as right. | That is fast, but unfair. Loud players are not always right. |
| story 4, consider, plausible_incomplete, option | Ask a bigger kid who was not there to decide, so that someone with power chooses. | Ask a bigger kid who was not there to decide. |
| story 4, consider, plausible_incomplete, feedback | Someone who did not see it cannot know. Choosing by size is not a fair way to decide. | Someone who did not see it cannot know. Picking by size is not fair. |
| story 4, choose, responsible, option | Suggest a do-over, and agree on a rule for close calls before you play again. | Suggest a do-over, and agree on a rule for close calls. |
| story 4, choose, responsible, feedback | A do-over and a rule settle this call and the next one, and nobody loses. | A do-over and a rule settle this call and the next one. Nobody loses. |
| story 4, choose, multiple_defensible, feedback | Also fair. Someone who watched without a side can help, as long as you both agree to accept their answer. | Also fair. A neutral player helps if you both accept the answer. |
| story 4, choose, unsafe, option | Shout that Jin cheats, and refuse to play unless he says that he did. | Shout that Jin cheats, and quit unless he admits it. |
| story 4, choose, unsafe, feedback | Shouting and demanding make Jin defend himself. The game ends, and the argument is still there. | Shouting makes Jin defend himself. The game ends, and the argument is still there. |
| story 4, choose, seek_help, option | Ask the recess helper to listen to both sides and help you decide. | Ask the recess helper to hear both sides and help. |
| story 4, choose, seek_help, feedback | A recess helper can listen without taking a side, which is exactly what you need when you are stuck. | A recess helper can listen without taking a side. That helps when you are stuck. |
| story 4, reflect, setup | How do you want to be treated when somebody thinks that you did something wrong? | How should people treat you when they think you did wrong? |

## Fix-It Workshop (123 lines changed)

| Where | Now | New |
|---|---|---|
| story 1, recognize, setup | At lunch, the line to pay and get your tray is so long that you only have ten minutes left to eat. Other kids are rushing too, and you want to help fix it. What do you do first? | The lunch line is so slow you get ten minutes to eat. You want to help. What do you do first? |
| story 1, recognize, responsible, option | Watch the line for a few days, time how long it takes, and ask kids and the lunch staff what they notice. | Watch and time the line. Ask kids and lunch staff. |
| story 1, recognize, responsible, feedback | Timing the line and asking people gives you real facts. The lunch staff see things you cannot. | Timing the line gives you facts. Lunch staff see things you cannot. |
| story 1, recognize, plausible_incomplete, option | Ask only your best friends what they think, since they will probably agree with your ideas. | Ask only your best friends. They will agree with you. |
| story 1, recognize, plausible_incomplete, feedback | Your friends' ideas matter, but they see the line from the same spot you do. Other kids and the lunch staff may notice something different. | Friends see the line from your spot. Others may notice more. |
| story 1, recognize, plausible_incomplete, option | Decide that kids are just too slow, and plan to tell everyone to hurry up next week. | Decide kids are too slow. Tell everyone to hurry up. |
| story 1, recognize, plausible_incomplete, feedback | That is a guess, and it blames kids before you know the cause. Looking first usually leads to a better answer. | That is a guess that blames kids. Look first to find the cause. |
| story 1, impact, setup | After a week of timing, you see that the line moves slowly at the start of lunch, when everyone arrives at once. Only one register is open. What is the real problem? | The line is slowest when everyone arrives at once. Only one register is open. What is the problem? |
| story 1, impact, responsible, option | The line is slow at the start because everyone arrives together and only one register is open. | Everyone arrives at once and only one register is open. |
| story 1, impact, responsible, feedback | That is what is really happening, so your ideas can aim right at it. | Yes, that is what is happening. Now your ideas can aim at it. |
| story 1, impact, plausible_incomplete, option | Kids take too long choosing their food, so the real problem is how they behave at lunch time every day. | Kids take too long to pick their food at lunch. |
| story 1, impact, plausible_incomplete, feedback | You timed it, and the register was what slowed things down. Blaming kids would not fix that. | You timed it, and the register slowed things down. Blaming kids would not fix that. |
| story 1, impact, plausible_incomplete, option | The cafeteria is just too small, so there is nothing anyone can do about the line. | The room is too small, so nobody can fix the line. |
| story 1, impact, plausible_incomplete, feedback | The room may be small, but you found a part you can change. Giving up too early skips the best ideas. | The room may be small, but you found something you can change. |
| story 1, consider, setup | You think of three ideas for fixing the line. Which one would you try first? | You have three ideas for fixing the line. Which one do you try first? |
| story 1, consider, multiple_defensible, option | Open a second register for the first ten minutes of lunch, so two lines move at once. | Open a second register for the first ten minutes. |
| story 1, consider, multiple_defensible, feedback | This works fast because more people can pay at once. It needs a staff member for those ten minutes, so someone would have to agree. | Two lines move at once. It needs a staff member to agree. |
| story 1, consider, multiple_defensible, option | Send classes to lunch in two groups, five minutes apart, so fewer kids arrive at the same moment. | Send classes to lunch in two groups, five minutes apart. |
| story 1, consider, multiple_defensible, feedback | This costs no money and fixes the crowd at its start. It changes the schedule, so teachers would need to agree. | It costs no money and spreads out the crowd. Teachers must agree. |
| story 1, consider, multiple_defensible, option | Add a grab-and-go cart with packaged lunches and snacks that kids can pay for very quickly. | Add a grab-and-go cart with packaged lunches and snacks. |
| story 1, consider, multiple_defensible, feedback | This helps kids who want something fast. It does not help everyone, because only some foods fit on a cart. | It helps kids who want something fast. Some foods do not fit on a cart. |
| story 1, choose, setup | Before you change lunch for the whole school, what is the best next step? | Before you change lunch for everyone, what is the best next step? |
| story 1, choose, responsible, option | Try your idea for one week with one grade, then time the line again and ask kids and staff what they think. | Test it for a week with one grade. Time the line again. |
| story 1, choose, responsible, feedback | A small test shows whether the idea works before you change things for everyone, and it lets you fix problems early. | A small test shows if the idea works. You can fix problems early. |
| story 1, choose, multiple_defensible, option | Draw your plan on paper and show it to two kids and one lunch worker before you try anything. | Draw the plan. Show two kids and a lunch worker first. |
| story 1, choose, multiple_defensible, feedback | A paper test can catch mistakes cheaply. You will still need a real trial to know for sure. | A paper test finds mistakes cheaply. You still need a real trial. |
| story 1, choose, unsafe, option | Tell your class to follow your new plan on Monday without asking anyone, because you are sure it will work out well. | Make your class follow your plan Monday. Ask no one. |
| story 1, choose, unsafe, feedback | This skips the people who run lunch, and your plan could cause new problems. Even a good idea needs permission and a test. | This skips the people who run lunch. Even good ideas need a yes and a test. |
| story 1, choose, seek_help, option | Share your idea with the principal or the lunch manager, who can say yes and help set up a trial. | Ask the principal or lunch manager to help set up a trial. |
| story 1, choose, seek_help, feedback | Asking the adults who can approve a change is smart, because they can make a real trial happen. | Adults can approve a change. They can make a real trial happen. |
| story 1, reflect, setup | Think about the people who felt the long line. What did you learn from listening to them that surprised you? | Think about the kids in the long line. What surprised you when you listened to them? |
| story 2, recognize, setup | At recess, the corner of the playground by the fence is always empty, while the big games are loud and crowded. You wonder why nobody goes to the corner. What do you do first? | At recess, the fence corner is always empty. The big games are loud and crowded. What do you do first? |
| story 2, recognize, responsible, option | Watch recess for two days, and ask a few kids what they do instead of going to the corner. | Watch recess for two days. Ask kids what they do instead. |
| story 2, recognize, responsible, feedback | Watching and asking shows you what is really happening on the playground. | Watching and asking shows what is really happening at recess. |
| story 2, recognize, plausible_incomplete, option | Decide the kids are lazy, and plan to tell them to use the whole playground. | Decide the kids are lazy. Tell them to use all the space. |
| story 2, recognize, plausible_incomplete, feedback | That blames kids before you know the reason. They may have a good reason for staying away from the corner. | That blames kids too soon. They may have a good reason to stay away. |
| story 2, recognize, plausible_incomplete, option | Ask only the kids who are already in the big games, since they are the easiest to find. | Ask only kids in the big games. They are easy to find. |
| story 2, recognize, plausible_incomplete, feedback | They are easy to find, but they are not the kids who skip the corner. You need to hear from the ones who stay away. | They do not skip the corner. Ask the kids who stay away. |
| story 2, impact, setup | You learn that the corner has no shade and nothing to do. Some kids who do not like loud games stay inside at recess. What is the real problem? | The corner has no shade and nothing to do. Some kids stay inside to avoid loud games. What is the problem? |
| story 2, impact, responsible, option | The corner has no shade and nothing to do, so kids who want something calm have nowhere to go. | Kids who want calm have no good place to go. |
| story 2, impact, responsible, feedback | That is the real gap, so your ideas can fill it. | That is the gap in the corner. Your ideas can fill it. |
| story 2, impact, plausible_incomplete, option | Kids today just do not like quiet places, so the corner is not worth the trouble of fixing. | Kids do not like quiet places, so skip the corner. |
| story 2, impact, plausible_incomplete, feedback | Some kids you talked to said they wanted something calm. The corner is missing something, not the kids. | Kids you asked want something calm. The corner needs something to offer. |
| story 2, impact, plausible_incomplete, option | The loud games are the problem, so the best fix is to stop the games that make noise. | Loud games cause the problem, so stop them. |
| story 2, impact, plausible_incomplete, feedback | Many kids love those games. Taking them away would help some kids and hurt others. | Many kids love those games. Stopping them would help some kids and hurt others. |
| story 2, consider, setup | You think of three ideas for the corner. Which one would you try first? | You have three ideas for the corner. Which one do you try first? |
| story 2, consider, multiple_defensible, option | Set up a chalk and drawing station with a small table, so kids can make something calm. | Set up a chalk and drawing station with a small table. |
| story 2, consider, multiple_defensible, feedback | This gives kids a quiet activity right away. It needs chalk and a dry day, so it would not work in the rain. | Kids get a quiet activity right away. It needs chalk and a dry day. |
| story 2, consider, multiple_defensible, option | Start a reading nook with donated books and a few mats for kids who want to sit quietly. | Start a reading nook with donated books and mats. |
| story 2, consider, multiple_defensible, feedback | This is peaceful and lasts a long time. It needs books and mats, plus a dry place to keep them. | It is peaceful and lasts a long time. It needs books, mats, and a dry spot. |
| story 2, consider, multiple_defensible, option | Bring out a calm game box with cards and puzzles that a teacher keeps and shares with kids. | Bring out a calm game box with cards and puzzles. |
| story 2, consider, multiple_defensible, feedback | This is easy to store and has something for everyone. It needs a grown-up to look after it. | It is easy to store and fits many kids. It needs a grown-up to look after it. |
| story 2, choose, setup | Before you change the corner for everyone, what is the best next step? | Before you change the corner, what is the best next step? |
| story 2, choose, responsible, option | Open the corner for one week, count who uses it, and ask them what they would change. | Try it a week. Count who comes and ask what to change. |
| story 2, choose, responsible, feedback | A short trial shows whether kids really use it, and their answers tell you what to fix next. | A short trial shows if kids use it. Their answers tell you what to fix. |
| story 2, choose, multiple_defensible, option | Try just one thing first, like the chalk station on dry days, and add more if kids like it. | Try one thing first, like chalk on dry days. Add more later. |
| story 2, choose, unsafe, option | Move the benches and mats to the corner yourself during recess, without asking any adult. | Move the benches and mats yourself at recess. Ask no adult. |
| story 2, choose, unsafe, feedback | Moving school things on your own could cause a mess or an accident, and it skips the people in charge. | Moving school things alone could cause a mess or an accident. Ask an adult first. |
| story 2, choose, seek_help, option | Ask a recess helper or your teacher if you can set it up, and who could keep an eye on the corner. | Ask a recess helper or teacher to say yes and help. |
| story 2, choose, seek_help, feedback | Asking an adult is a good move. They can say yes and find supplies, and they can keep an eye on everyone. | An adult can say yes and find supplies. They can watch over everyone. |
| story 2, reflect, setup | Think about a time you wanted a calm place and could not find one. What did you do, and what would have helped? | Think of a time you wanted a calm place. What did you do, and what would have helped? |
| story 3, recognize, setup | The lost-and-found box by the office is overflowing with coats and lunch boxes, and kids keep losing new things. You want to fix it. What do you do first? | The lost-and-found box is overflowing with coats and lunch boxes. You want to fix it. What do you do first? |
| story 3, recognize, responsible, option | Look at what is in the box, ask a few classes what they have lost, and ask the custodian how often it gets emptied. | Check the box, ask classes what they lost, and ask the custodian. |
| story 3, recognize, responsible, feedback | Each person tells you a different piece of the story. Together they show what is really going on. | Each person tells you a piece of the story. Together they show what is happening. |
| story 3, recognize, plausible_incomplete, option | Say that kids are careless, and plan to remind everyone to keep track of their things. | Say kids are careless. Remind everyone to watch their things. |
| story 3, recognize, plausible_incomplete, feedback | Reminders may help a little, but you have not found out why things stay in the box. Looking first leads to better ideas. | Reminders may help a little. You still do not know why things stay. |
| story 3, recognize, plausible_incomplete, option | Ask only the kids in your own class, since they are the easiest ones for you to reach. | Ask only your own class. They are the easiest to reach. |
| story 3, recognize, plausible_incomplete, feedback | Your class can help, but the box holds things from the whole school. Other classes may know things yours does not. | The box holds things from the whole school. Other classes may know more. |
| story 3, impact, setup | You find that most things sit in the box all year, because nobody knows what is in there. What is the real problem? | Most things sit in the box all year. Nobody knows what is in there. What is the real problem? |
| story 3, impact, responsible, option | Nobody can see what is in the box, so kids do not know that their things are there. | Kids cannot see what is in the box to find their things. |
| story 3, impact, responsible, feedback | If kids cannot see their things, they cannot get them back. Now your ideas can aim at that. | Kids cannot get back what they cannot see. Your ideas can aim at that. |
| story 3, impact, plausible_incomplete, option | Kids lose too many things, so the real problem is that they do not care about their stuff. | Kids lose too many things because they do not care. |
| story 3, impact, plausible_incomplete, feedback | Kids told you they wanted their things back. The trouble is finding them, not caring. | Kids told you they want their things back. The trouble is finding them. |
| story 3, impact, plausible_incomplete, option | The box is too small, so a bigger box would fix everything and make the problem go away. | The box is too small. A bigger box would fix it. |
| story 3, impact, plausible_incomplete, feedback | A bigger box would hold more lost things, but it would not help kids find them. | A bigger box would hold more. It would not help kids find things. |
| story 3, consider, setup | You think of three ideas for helping kids find their things. Which one would you try first? | You have three ideas to help kids find their things. Which one do you try first? |
| story 3, consider, multiple_defensible, option | Take photos of the items and make a photo board in the hallway, so kids can spot their things. | Take photos of lost items and make a hallway photo board. |
| story 3, consider, multiple_defensible, feedback | This lets everyone see what is lost, all week. It takes time to take the photos and keep the board up to date. | Everyone sees what is lost all week. Making photos and updating the board takes time. |
| story 3, consider, multiple_defensible, option | Set up a Friday table at dismissal where kids can look through the lost things for ten minutes. | Set up a Friday table where kids can look for ten minutes. |
| story 3, consider, multiple_defensible, feedback | This is simple and gives kids a real chance to look. It only works on Fridays, so things could wait all week. | It is simple and gives kids a real chance to look. It only works on Fridays. |
| story 3, consider, multiple_defensible, option | Hold a name-label day with stickers, so more things find their way back to their owners. | Hold a name-label day with stickers for coats and boxes. |
| story 3, consider, multiple_defensible, feedback | This helps stop the problem before it starts. It will not help with the things already in the box. | This stops lost things before they start. It does not help what is in the box. |
| story 3, choose, setup | Before you change how the whole school does this, what is the best next step? | Before you change the school, what is the best next step? |
| story 3, choose, responsible, option | Try the photo board for two weeks, count how many things get claimed, and ask kids if it helped. | Try the photo board for two weeks and count what gets claimed. |
| story 3, choose, responsible, feedback | Counting shows whether the idea really works, and the kids' answers tell you what to improve. | Counting shows whether it works. The kids' answers tell you what to improve. |
| story 3, choose, multiple_defensible, option | Try the Friday table for three weeks first, then compare how many things get picked up each time. | Try the Friday table for three weeks. Compare pickups each week. |
| story 3, choose, multiple_defensible, feedback | A few weeks of counting gives you real numbers, and you can switch ideas if it does not work. | A few weeks of counting gives real numbers. You can switch ideas if it fails. |
| story 3, choose, unsafe, option | Throw away everything that looks old so the box looks cleaner, and then start fresh. | Throw out everything that looks old. Start with a clean box. |
| story 3, choose, unsafe, feedback | Those things belong to someone, and some kids may still be looking. Never throw away other people's things without asking. | Those things belong to someone, and kids may still look. Ask before tossing anything. |
| story 3, choose, seek_help, option | Ask the office staff and the custodian if you can put a board on the wall, and who could help take photos. | Ask the office staff for a wall board and photo helpers. |
| story 3, choose, seek_help, feedback | Asking the adults who run the office is wise, because they can approve a spot and help make it work. | Office adults can approve a spot. They can help make it work. |
| story 3, reflect, setup | Think about something you lost and got back. How did it feel, and how could the school make that happen more often? | Think about something you lost and got back. How did it feel? How could the school help that happen more? |
| story 4, recognize, setup | A new student in your class, Ana, got lost twice on her first day because the hallways all look alike. You want to make the school easier for new kids. What do you do first? | On her first day, new student Ana got lost twice. The hallways all look alike. What do you do first? |
| story 4, recognize, responsible, option | Ask two students who joined this year what was hard and what helped, and listen to their answers. | Ask two new kids what was hard and what helped. |
| story 4, recognize, responsible, feedback | Kids who joined recently remember what it felt like, and they can tell you what helped. | Kids who joined lately remember how it felt and what helped. |
| story 4, recognize, plausible_incomplete, option | Ask only the kids who have been here since kindergarten, since they know the school best. | Ask only kids who have been here since kindergarten. |
| story 4, recognize, plausible_incomplete, feedback | They know the building well, but they may have forgotten what it was like to be new. New kids can tell you more. | They know the building but may forget being new. New kids can tell you more. |
| story 4, recognize, plausible_incomplete, option | Decide that new kids should just ask for help, and plan to tell them so on their first day. | Tell new kids to just ask for help on day one. |
| story 4, recognize, plausible_incomplete, feedback | Asking is hard when everything is new and you do not know who to ask. Telling them does not fix what makes it hard. | Asking is hard when you do not know who to ask. Telling them fixes nothing. |
| story 4, impact, setup | You learn that the signs and maps only make sense if you already know the building. What is the real problem? | Ana says the signs make sense only if you know the school. What is the real problem? |
| story 4, impact, responsible, option | The signs and maps only work for kids who already know the school, so new kids feel lost. | Signs and maps only work for kids who know the school. |
| story 4, impact, responsible, feedback | That is what is really going wrong, so your ideas can make the school clearer for new kids. | That is what is going wrong. Your ideas can make the school clearer. |
| story 4, impact, plausible_incomplete, option | New kids are too shy to ask questions, so the real problem is how they feel inside. | New kids are too shy to ask, so they feel lost. |
| story 4, impact, plausible_incomplete, feedback | Feeling shy is real, but the new kids said the signs were confusing. A clearer school would help them feel less shy. | New kids said the signs confuse them. Clearer signs would help shy kids too. |
| story 4, impact, plausible_incomplete, option | Teachers do not give enough directions, so the problem belongs to the teachers to fix. | Teachers give too few directions, so it is their job to fix. |
| story 4, impact, plausible_incomplete, feedback | Teachers help a lot, but they cannot walk every new student around. Better signs would help every day. | Teachers help a lot, but they cannot walk every new kid around. Signs help every day. |
| story 4, consider, setup | You think of three ideas for helping new kids. Which one would you try first? | You have three ideas to help new kids. Which one do you try first? |
| story 4, consider, multiple_defensible, option | Draw a colorful map with each hallway in its own color, so new kids can find their way. | Draw a map with each hallway in its own color. |
| story 4, consider, multiple_defensible, feedback | A map helps right away and anyone can use it. It only works if kids can read it and carry it around. | A map helps right away. It only works if kids read it and carry it. |
| story 4, consider, multiple_defensible, option | Pair each new student with a buddy for the first week who can walk with them to each place. | Give each new student a buddy for the first week. |
| story 4, consider, multiple_defensible, feedback | A buddy gives kindness as well as directions. It needs kids who are ready to help and a way to match them. | A buddy gives kindness and directions. It needs ready helpers and a way to match them. |
| story 4, consider, multiple_defensible, option | Make a first-week passport with a stamp from each place, like the library and the gym. | Make a first-week passport with a stamp for each place. |
| story 4, consider, multiple_defensible, feedback | This makes learning the school feel like a game. It takes time to make, and kids have to remember to bring it. | Learning the school feels like a game. It takes time to make, and kids must bring it. |
| story 4, choose, setup | Before you change things for every new student, what is the best next step? | Before you change things, what is the best next step? |
| story 4, choose, responsible, option | Ask one new student to try your map for a day, then write down what is missing and fix it. | Test your map with a new student, then fix what is missing. |
| story 4, choose, responsible, feedback | A real test with a real new student shows what you missed, and fixing it makes the map better for everyone. | A real test shows what you missed. Fixing it helps every new student. |
| story 4, choose, multiple_defensible, option | Ask a buddy to walk a new student through the passport for one day, and tell you what happened. | Have a buddy guide one new student through the passport. |
| story 4, choose, multiple_defensible, feedback | You learn what works and what is confusing, and the buddy gets to practice being helpful. | You learn what works and what confuses. The buddy practices helping, too. |
| story 4, choose, unsafe, option | Paint colored lines on the hallway floors during lunch, so that the map matches the building. | Paint colored lines on the hallway floors during lunch. |
| story 4, choose, unsafe, feedback | Painting a school floor without permission could cause damage and trouble. Big changes need an adult to say yes first. | Painting school floors without permission could cause damage. Big changes need an adult's yes first. |
| story 4, choose, seek_help, option | Ask the counselor, who knows when new kids arrive, if you can match buddies and try your map. | Ask the counselor to help match buddies and try your map. |
| story 4, choose, seek_help, feedback | Asking the counselor is a good move. They know the new students and can help your idea reach the right kids. | The counselor knows the new students. They can help your idea reach them. |
| story 4, reflect, setup | Think about a time you were new somewhere. What helped you feel welcome, and what do you wish someone had done? | Think about a time you were new. What helped you feel welcome? What do you wish someone had done? |

## Reading Detective (8 lines changed)

| Where | Now | New |
|---|---|---|
| item 1, explanation | The grass smell on her backpack is the clue that points back outside, not to her locker. | The grass smell is the clue. It points back outside, not to her locker. |
| item 2, passage 1 | A new student, Jordan, sat alone at the end of the lunch table. | A new student, Jordan, sat alone at the lunch table. |
| item 2, explanation | Waving right back the moment Jordan was noticed is the clue. That’s what hopeful looks like, not uninterested or angry. | Jordan waves back right away. That looks hopeful, not uninterested or angry. |
| item 3, passage 1 | Ms. Patel found chalk dust footprints leading from the art room to the library. | Ms. Patel found chalk footprints from the art room to the library. |
| item 3, choice | A trail of clues can show where someone went, even if you didn’t see them leave. | A trail of clues can show where someone went. |
| item 3, explanation | That’s the main idea right there: a trail of footprints lets you follow someone’s path even when you didn’t see them walk it. | The footprints are a trail. A trail shows where someone went. |
| item 4, passage 2 | By lunchtime, thick gray clouds had rolled in and the wind picked up. | By lunchtime, thick gray clouds came in and the wind picked up. |
| item 4, explanation | Gray clouds, rising wind, and that frown at the weather app are all pointing the same direction. The plan is about to change. | Gray clouds, strong wind and a frown all point one way. The plan will change. |

## Strength Spotter (14 lines changed)

| Where | Now | New |
|---|---|---|
| story 1, story | Maya's little brother has a necklace knotted into a tight tangle. Maya sits down with him and works on it. It takes ten minutes, and she stays calm the whole time. | Maya's little brother has a tangled necklace. Maya sits down and works on it for ten minutes. She stays calm the whole time. |
| story 2, story | Diego sees a puddle by the playground in the morning. By afternoon it is gone. He wonders where the water went, so he asks his teacher and writes a note in his notebook. | Diego sees a puddle in the morning. By afternoon it is gone. He asks his teacher where it went and writes a note. |
| story 3, story | A new boy named Tomas joins Priya's class. When his eraser breaks, Priya gives him hers. She walks him to the library and introduces him to two classmates. | A new boy, Tomas, joins Priya's class. His eraser breaks, so Priya gives him hers. She walks him to the library and introduces two classmates. |
| story 4, story | At recess, Jo's block tower falls over, and Jo looks upset. Sam says, "That tower was so tall it touched the clouds!" Jo laughs, and then they start building again. | At recess, Jo's block tower falls and Jo looks upset. Sam says, "That tower touched the clouds!" Jo laughs and they build again. |
| story 4, note | Sam's joke was meant to help Jo feel better, so this one fits less. | Sam's joke helped Jo feel better, so this one fits less. |
| story 5, story | Zoe wants to make a free throw in basketball. For three weeks she practices every day after school, and she misses a lot. One day she tries a new way to hold the ball, and it goes in. | Zoe wants to make a free throw. She practices for three weeks and misses a lot. Then a new grip works. |
| story 5, note | Zoe made the shot after weeks of practice, so luck is only a small part of this story. | Zoe made the shot after weeks of practice. Luck is a small part. |
| story 6, story | Omar's friend Lee is sad because his dog is sick. Omar sits next to him and does not say much. Then he asks, "What happened?" and listens to the whole story. | Omar's friend Lee is sad because his dog is sick. Omar sits next to him and says little. Then he asks, "What happened?" and listens. |
| story 7, story | Lila finds three empty cardboard boxes. She cuts a door in one, draws signs on another, and makes up prices for her toys. Then she makes a rule: every customer says hello first. | Lila finds three empty boxes. She cuts a door in one and draws signs on another. Then she makes a rule: customers say hello first. |
| story 8, story | Teo's grandfather gets a letter in English. Teo reads it out loud. Then he explains it again in the language they speak at home. His grandfather smiles and says thank you. | Teo's grandfather gets a letter in English. Teo reads it out loud. Then he explains it in their home language. His grandfather smiles. |
| story 9, story | Ava's group has to make a poster. She asks each person which part they want. She writes the plan down, and when the poster is done she says, "We all did this." | Ava's group makes a poster. She asks each person which part they want. She writes the plan down. Then she says, "We all did this." |
| story 10, story | At recess, Ben wants to join a game, but his voice shakes because he feels nervous. He walks over and says, "Can I play?" When they say yes, he says thank you. | Ben wants to join a game. His voice shakes because he feels nervous. He asks, "Can I play?" They say yes. He says thank you. |
| story 11, story | Nora packs her school bag the night before. She checks her list. Then she remembers that her friend Kit needs a permission slip signed, and she reminds her. | Nora packs her school bag the night before. She checks her list. Then she reminds her friend Kit about a permission slip. |
| story 12, note | Kai counted the change, but the strength here is doing the right thing. Math is a smaller part. | Kai counted the change. The strength here is doing the right thing. Math is a smaller part. |
