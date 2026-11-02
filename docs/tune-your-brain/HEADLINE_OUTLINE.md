# Headline (grades 6-8): the 12-item outline, for your approval

Written 2026-11-01. Outline only: no passage text is written until you approve or edit each line. The design is the one you approved in `READING_GAMES_DESIGN.md` (item 1 is the walking-survey sample). Each run would draw 6 of these 12 and shuffle the headlines.

**How each item works (unchanged):** a short news snippet (4 to 6 sentences with numbers); "Which headline is most accurate?" with three headlines; then "Which sentence best supports your answer?".

**Trap types** for the three wrong headlines (every item uses at least two different kinds, and no item reuses the same pair as the one before):
- **Over** states what the facts say
- **Under** states it
- **Number** mixes up a count and a share, or a number and who it belongs to
- **True but not the point** is accurate but misses the main fact
- **Cause** claims something caused something when the text only says two things happened

**Right-answer style** is varied on purpose so that "pick the careful one" and "pick the bold one" both fail: *bold* (the facts are big), *plain*, or *hedged* (the facts are mixed).

| # | Topic | The facts (what the snippet says) | Right headline (style) | Wrong headlines (trap) | Proving sentence |
|---|---|---|---|---|---|
| 1 | Walking to school (sample) | 54 of 120 this year; 45 of 90 last year; council will ask again | Fewer Students Walk to School Than Last Year, as a Share of Those Surveyed (plain) | More Students Walk Than Last Year (Number); Nearly Half Walk Every Day (Over); Council Plans Spring Survey (True but not the point) | 3rd |
| 2 | Library hours | 180 visits in the month after evening hours began, 120 the month before; evening hours are the only change mentioned | Library Visits Rise 50 Percent After Evening Hours Begin (bold) | Library Visits Double (Over); Library Sees a Small Bump (Under); Longer Hours Make Students Read More (Cause) | 1st |
| 3 | Bake sale | $85 raised toward a $150 goal; club will try again | Bake Sale Raises More Than Half Its Goal, and the Club Plans Another (hedged) | Bake Sale Reaches Its Goal (Over); Bake Sale Barely Raises Anything (Under); Club Raises $150 (Number) | 2nd |
| 4 | Science fair | 48 projects this year, 60 last year; this year only grades 4 to 8 could enter, last year grades 3 to 8 | Fewer Projects This Year, but Fewer Grades Could Enter (hedged) | Science Fair Is Losing Interest (Cause); Science Fair Shrinks by Half (Number); 48 Projects Enter (True but not the point) | 3rd |
| 5 | Cafeteria waste | Food waste per tray fell from 6 ounces to 4.5 ounces after a share table began | Food Waste Falls 25 Percent After Share Table Begins (bold) | Food Waste Falls Slightly (Under); Food Waste Cut in Half (Over); Share Table Is Why Students Eat More (Cause) | 1st |
| 6 | Lunch vote | Of 200 votes: pizza 40 percent, tacos 35 percent, salad 25 percent | Pizza Narrowly Leads the Lunch Vote, With Tacos Close Behind (plain) | Students Overwhelmingly Choose Pizza (Over); Tacos Win the Vote (Number); A Quarter Vote for Salad (True but not the point) | 2nd |
| 7 | School paper | A survey of 40 sixth graders found 12 read the school paper; no other grades were surveyed | Three in Ten Surveyed Sixth Graders Read the School Paper (plain) | Most Students Skip the School Paper (Over); One in Three Students Reads the Paper (Number); Paper Needs a Redesign (Cause) | 3rd |
| 8 | Soccer | Won 5 of 8 games; lost 3 of the last 4; scored 12 goals | Soccer Team Wins Most Games but Has Slumped Lately (hedged) | Perfect Season Ends in Defeat (Over); Team Struggles All Year (Under); Team Scores 12 in a Row (Number) | 2nd |
| 9 | Fundraiser | Raised $1,200 against a $1,000 goal; one class gave $300 | Fundraiser Beats Its Goal by 20 Percent (bold) | Fundraiser Beats Its Goal by 25 Percent (Number); One Class Raises a Quarter of the Money (True but not the point); Fundraiser Reaches Its Goal (Under) | 1st |
| 10 | Rainy-day bikes | 24 bikes in the rack on dry days on average, 9 on rainy days, over 10 school days | Fewer Bikes in the Rack on Rainy Days (plain) | Nobody Bikes in the Rain (Over); Rain Keeps Students From Biking Safely (Cause); 24 Bikes Park at School (True but not the point) | 2nd |
| 11 | Hallway noise | Average hallway noise measured at 65 decibels before and 70 after new floors; the principal says teachers may ask for rugs | Measured Hallway Noise Is 5 Decibels Higher After New Floors (plain) | New Floors Make Hallways Twice as Loud (Over); New Floors Are Too Loud for Learning (Cause); Principal Will Buy Rugs (True but not the point) | 1st |
| 12 | Reading challenge | 300 students signed up; 180 finished (60 percent); last year 150 of 250 finished (also 60 percent) | Same Share of Students Finish the Reading Challenge, Though More Joined (hedged) | More Students Finish Than Ever (Number); Reading Challenge Gets Harder to Finish (Cause); Fewer Finish This Year (Under) | 3rd |

**Spread check:** right-answer styles: bold 3, plain 5, hedged 4. The proving sentence is the 1st in 4 items, the 2nd in 4, the 3rd in 4. Trap types across the 36 wrong headlines: Over 9, Number 8, Cause 7, Under 6, True-but-not-the-point 6. No single kind dominates, so "the loud one is wrong" no longer works.

**Arithmetic checked:** 54/120 is 45 percent and 45/90 is 50 percent; 180 against 120 is 50 percent more; $85 of $150 is about 57 percent (more than half); 6 down to 4.5 ounces is 25 percent less; 12 of 40 is 30 percent; $1,200 over $1,000 is 20 percent more; 70 minus 65 is 5 decibels (and decibels are logarithmic, so "twice as loud" is wrong; the snippet will say only that it measured 5 more); 180/300 and 150/250 are both 60 percent.

**Reading level:** target roughly 860 to 1010 Lexile (the Common Core "current" grades 6 to 8 band), measured with the Flesch-Kincaid proxy in the audit script.

**Writing rules that a test will enforce:** options within 1.4 times each other's length; the right headline longest in at most 2 of 6 draws' worth of items (at most 4 of 12); evidence sentence position spread as above; no dashes; fictional names only.

## What I need from you

1. **Reply with the numbers of any item to change or drop** (or "all fine").
2. **Topics:** any to avoid? Item 10 (rain and safety) and item 11 (noise and learning) touch school-environment topics; both are neutral, but strike them if you would rather not.
3. After approval I write the full text, add the audit and tests, play it in a browser, and bring the finished wording back for your read before anything deploys.
