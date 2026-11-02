# Recommendations on the items waiting for the owner (2026-11-01)

**Owner's answer, 2026-11-01:** keep using the Ava (Premium) voice for now, with the licence finding below understood; every other recommendation approved. So: Team Pick moved to recess, summary count renamed, Decision Point's best answer swapped, Money Moves reworked, the three reading games go ahead (Headline first), the district dashboard is built to the revised thresholds, and B10 is re-recorded. Phonics sounds still need a human recording (an Ava voice cannot be relied on for isolated sounds), and the licence question stays open for a later decision.

Research done 2026-11-01: web sources (listed at the end), Apple's own macOS licence (read in full text), and our own code and data. I am not a lawyer, and where a source is a vendor's own report or a forum quoting a licence, I say so.

## The one finding that changes an earlier decision

**Apple's macOS licence does not allow public or commercial use of its system voices, and Ava (Premium) is a system voice.** I read section 2.F of the macOS Tahoe 26 licence in Apple's own PDF. In my words: the voices may be used while running macOS and to make your own projects for personal, non-commercial use, and nothing else is permitted. It names recording, publishing and redistributing the voices, and it says this applies in profit, non-profit, public-sharing and commercial settings alike. Apple's Big Sur and earlier licences carry the same limit, so it is long-standing.

What this touches:
- **The decision I recorded on 2026-10-31** (game audio rendered with Ava Premium) rests on a wrong assumption. I called the licence "worth a check" last time; the check says no.
- **The 37 published help videos** are narrated with Ava and are public.
- **The sibling FNO project** uses the same pipeline.

I did not find a separate licence for downloaded Premium voices; I would treat them as covered by the same clause until Apple says otherwise in writing.

**Recommendation:** stop adding new Ava audio now, decide a licensed voice (below), and re-voice the videos on a schedule rather than in a panic. Enforcement against a small publisher is unlikely, but a school district's vendor review is exactly where a question like this surfaces, and the clause is not ambiguous.

## Who we are building for (this drives every choice below)

| Audience | What they need from us | What it means here |
|---|---|---|
| K-2 children (Discover) | Everything spoken, tiny reading load, safe to be wrong | Real audio is not a nicety; it is how the game works. Accurate sounds matter most in Sound Safari. |
| Grades 3-5 (Explore) | Stories with some depth, a trusted adult option, fair-sounding choices | Length-balanced options, a story set that changes each run |
| Grades 6-8 (Challenge) | Peer and digital dilemmas, autonomy, no lecturing | Choices that respect the other person's agency (Decision Point), real arithmetic (Money Moves) |
| Grades 9-12 (Advance) | Realistic, adult-world judgment | Evidence games at college-prep reading level |
| Teachers | Assignable, safe, shows what the class did | No SEL "scores" on children. Today the teacher report shows a score only for games that have one (`raw_score`); the scenario games send none. Good. |
| School administrators | Seats, invitations, no surprises | Done this session (seat counts, PO rule) |
| District administrators | Is it used, is it renewing, does it fit our Portrait | The dashboard decision below |
| District privacy and procurement staff | Minimum data, clear contracts | New York Education Law 2-d applies to us as a third-party contractor: counts-only reporting is the safe default |
| FNE staff (you) | Content you can sign off on, few manual steps | The review documents; the PO change |

## Recommendations, item by item

### 1. Audio and voice (new, and the ear test)

**Phonics is a different problem from narration.** My search found a Microsoft support thread reporting that text-to-speech often gets a single isolated sound wrong (in one case a vowel tag produced the letter name instead of the sound) and a classroom phonics guide telling teachers to avoid adding a "schwa" after consonant sounds ("muh" for /m/). I found no source that recommends synthetic voices for isolated phonemes, and Apple's own phoneme markup (`[[inpt PHON]]`) is documented for the older voices; a forum thread says the newer voices ignore it, and I found nothing on Premium voices specifically.

**Recommendation:**
- **Sound Safari and any phonics: a human recording.** The set is tiny (the game uses 4 sounds now and would use about 16; English has about 44). You, or a teacher you trust, can record them on a phone in a quiet room. I turn them into clean small files with ffmpeg. This also removes the licensing question for the part that matters most.
- **Narration lines for games** (the "Which one would help you feel calm?" sentences): choose a **commercially licensed voice**. Options to evaluate, none verified by me for current terms: ElevenLabs on a **paid** plan (sources agree the free plan is non-commercial and paid plans grant commercial rights, and you already have an ElevenLabs integration for Morning Boost, so check what your account is), or a major cloud speech service whose terms allow commercial use. For K-2, a human recording of the fixed lines is also realistic, because there are only a few dozen.
- **Help videos:** do not re-record all 37 at once. Order: choose the voice, re-voice the five most-viewed first, then the rest as they are re-recorded for other reasons (B10 and B5 are already due).
- **Ear test (yours, later):** on one Chromebook and one iPad, open `brain-sound-safari.html` and listen to rounds 1 to 4 with the sound on. Write down for each round what you heard (the sound /m/, or "em", or "slash m slash"). Five minutes.

### 2. Re-approve the rewritten Mia and "picked last" stories

**Recommendation: approve both, with two small edits to Team Pick.**
- The rewrite did what it set out to do (balanced lengths, a third believable wrong answer, the unsafe choice now believable). Item-writing research is consistent that equal-length options matter: the longest option being correct is a well-known test-taking cue, and the standard advice is to make options about the same length and keep every distractor plausible (Haladyna and colleagues' guideline review, plus university item-writing guides).
- **Edit 1, setting:** change "In gym class" to "At recess". The "captains pick teams in front of everyone" practice is one physical-education researchers and the former national PE association have long classed as inappropriate, and a 2016 study found students picked last disliked it. A curriculum a school adopts should not model a teacher-run version of it. Peer-led recess teams are just as relatable for grades 3-5 and avoid the problem.
- **Edit 2, the summary label:** the Choice Quest and Team Pick summary screens say "Responsible choices: N". The research on social-emotional assessment is consistent: it is not ready for high-stakes or scoring uses, it works best formatively, and it should not be used to screen for deficits. Our teacher report shows no SEL score, which is right, but the child sees a count. Rename it "Choices that helped" or drop it.

### 3. Decision Point, step 4: which answer is "best"

**Recommendation: swap them.** Make **"Ask Sam directly"** the best answer and "add Sam back yourself and quietly mention the last two updates" an "also good" answer whose feedback names the risk (Sam may have left on purpose, you may not be allowed to add people, and it decides for Sam without asking).
- **Why:** the New York SEL benchmark we mapped to, 2C, is about communicating with empathy, and the whole cycle the game teaches starts with finding out what is going on before acting. Adding someone to a chat without asking is a recognised problem in school e-safety guidance (one UK school handout lists "added to chats without permission" among common group-chat issues), and Common Sense Education's grade-4 group-chat lesson centres the power of bystanders, which fits asking over acting for someone. These are supporting sources, not a study proving ask-first is better; the strongest reason is the SEL principle of agency.
- **Cost:** two edited lines of feedback and a label swap. Tiny.

### 4. Money Moves: rework

**Recommendation: yes, rework.** The game's ending ignores one of its two counters (Spending Money), has no percentages despite its "Budgeting & Percentages" label, and offers four obvious binary choices.
- **Why it is worth doing well:** percent problems with simple interest, tax and discounts sit in grade 7 of the Common Core maths standards (7.RP.3, which the other states' versions confirm, and New York's Next Generation standards are built on the same base; I could not retrieve New York's exact wording, so check it against the NYSED document before you cite it). Personal finance is also a live policy area in New York (bills proposing required financial literacy in grades 4-8 and a high-school course were introduced in 2025; I could not confirm they passed). That gives the game a real curriculum anchor: PoG Academically Prepared for the maths, Reflective and Future Focused for goal-setting, and SEL 1C (set goals, learn from mistakes).
- **Design I would use:** a pool of 14 events and 6 per run; a mix of a percent discount, sales tax, simple interest on savings, "save 10 percent first", a surprise cost, a group gift, a subscription, and a needs-versus-wants choice; both counters matter at the end (running out of spending money is a real consequence, not a failure message); at least three different successful endings; a debrief that explains the arithmetic without moralising about spending. Fictional person, fictional amounts, and no personal financial advice (the game must never read like advice).

### 5. The three reading games: go ahead

**Recommendation: yes, build all three, starting with Headline.** Evidence Hunt is already the same shape as the "evidence-based selected response" items used on state reading tests (a question, then "which part of the text supports that"). That design is respectable and our version is simpler, so the quality lever is the distractors: those assessments describe wrong answers as common misconceptions, misreadings and casual reading, not as silly options, which is the exact fix the samples use.
- **Reading level targets:** the Common Core bands published with Lexile ranges give us measurable targets: grades 4-5 about 740-1010L, grades 6-8 about 925-1185L, grades 9-10 about 1050-1335L (these are the "stretch" bands; the "current" bands are lower: 645-845L, 860-1010L, 960-1115L). Lexile itself says there is no one-to-one link between a number and a grade, and one literacy researcher argues the bands are aspirational, so I would use them as a range to land inside, measured with a free Flesch-Kincaid proxy in the audit script because I cannot compute Lexile for free.
- **Your reactions to the samples:** I think the Reading Detective sample (the bean sprouts) is at the right difficulty for grades 3-4, the Headline sample (the walking survey) is right for grade 7 because it needs division, and the Critical Read sample (the app report) suits grades 10 and up because it asks the reader to reject both the naive and the cynical reading. If you read them and one feels easy or hard, say which.
- **Safe topics:** school, science, media, money, community. I would avoid health claims in Critical Read items (a fictional supplement or app that "cures" something is realistic but touches advice).

### 6. District dashboard

**Recommendation on your four questions:**
1. **Counts only, no teacher names: yes.** New York Education Law 2-d governs vendors that receive student, teacher and principal data (our contracts must state the exclusive purposes of use, and the safe pattern is the minimum a purpose needs). I found nothing specific about dashboards in it, so this is judgement: a district administrator needs adoption and renewal facts, not individual teachers' names. Counts are enough and keep our exposure small.
2. **Thresholds: change them.** Make "expiring" **90 days** (district budget and renewal conversations start well before the school year, and 60 is late; this is my judgement, not a sourced figure). Keep "above 90 percent of seats" but treat it as good news ("ask to add seats"). **Add the one the research says districts care about most: low adoption.** Education-technology usage studies (the vendor LearnPlatform's own reports, so treat the numbers as indicative) have for years found that a large share of paid licenses are never activated or barely used; the figures cited were roughly a third never activated in 2017 data and about $1 billion a year in unused licenses by 2019. So alert on "seats assigned under 25 percent, 60 days after purchase".
3. **Portrait of a Graduate status: yes, include it.** In New York the Portrait of a Graduate is statewide, and the crosswalk (district frameworks, connections FNE has verified) is what separates us from a generic SEL product. A single tile ("Portrait of a Graduate: 3 of 6 attributes have verified FNE connections") answers the question a curriculum director will actually ask. It only appears once a district has a published framework.
4. **Order of work: after the PO change, which is done.**

**One caution for later:** seats are not usage. A school can have every seat assigned and nobody opening a lesson, which is the adoption gap in the research. The first version should say "assigned" honestly. The next step is a "teachers who used FNE in the last 30 days" figure, which needs us to count lesson views, and that is a separate, explicit data decision.

### 7. Help video B10

**Recommendation: hold the re-record until the voice is chosen** (a week or two), because a new Ava recording adds exposure. The live video says a PO school needs two staff steps, which is no longer true; the harm is small (a school owner reading a wrong aside about PO timing). If you would rather fix it now, re-record with Ava once and re-voice it with the other videos later.

### 8. Your hands-on checks, in order of risk

1. **District frameworks (highest risk, never run end to end):** sign in as the demo district admin, open "Portrait of a Graduate", add a framework and a standard, suggest a connection, tick the confirmation, submit; then on `admin-standards.html` write the rationale and verify. If anything looks wrong, send the Network-tab JSON.
2. **Release 64/65 pages:** blog search, teacher in-page dialogs, affiliate dashboard, the Brain Games progress dashboard. Ten minutes; signed in as each role.
3. **The /m/ ear test:** above.
4. **After the next deploy:** play Choice Quest twice and Reading Detective twice and confirm the stories and choice order differ.

## A suggested order for the next two weeks

1. You: approve the two Team Pick edits and the Decision Point swap (one reply). I apply, test and bring back the exact text.
2. You: decide the voice (record phonics yourself; pick a licensed voice for narration). I add the pipeline switch and a one-line licence note in the repo.
3. Me: build the district dashboard to the revised thresholds; start the three reading games (Headline first) as outlines for your approval.
4. Me: Money Moves rework as an outline for your approval.
5. You: the district-frameworks test (the biggest unknown) and the Release 64/65 click-through.

## Sources and how much to trust them

- **Apple macOS Tahoe 26 licence, section 2.F** ([apple.com PDF](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)): primary source, read in full. Not legal advice.
- **Voice licensing history:** an Apple developer-forum thread on AVSpeechSynthesizer ([thread](https://developer.apple.com/forums/thread/812285)) and Apple Community posts quoting the Catalina and Big Sur licences: secondary.
- **TTS and isolated sounds:** [Microsoft Q&A thread](https://learn.microsoft.com/en-us/answers/questions/2116545/inconsistencies-in-ipa-pronunciation-in-text-to-sp), [Azure SSML pronunciation docs](https://docs.azure.cn/en-us/ai-services/speech-service/speech-synthesis-markup-pronunciation), Apple's legacy [phoneme markup docs](https://developer.apple.com/library/archive/documentation/mac/Sound/Sound-201.html), an [Apple Community thread](https://discussions.apple.com/thread/5571835): all indirect; no source recommends synthetic voices for isolated phonemes.
- **ElevenLabs commercial use:** vendor-neutral pricing summaries ([Orb](https://www.withorb.com/blog/eleven-labs-pricing), [Smallest.ai](https://smallest.ai/blog/elevenlabs-pricing-plans-cost-what-you-get-in-2026)): check ElevenLabs' own terms. I did not verify any other provider's terms.
- **Item-writing research:** [Haladyna, Downing and Rodriguez 2002 summary](https://bookdown.org/stefanmosjos/manualesitems/_book/haladyna-2002.html), [UConn guide](https://cetl.uconn.edu/resources/assessment-of-learning/assessment-design/developing-multiple-choice-questions/), [Learning Guild article](https://www.learningguild.com/articles/how-to-fix-3-common-flaws-in-multiple-choice-questions). The "longest answer" cue is stated in the guides; the exact rule is not in Haladyna's own words.
- **Evidence-based selected response:** [Nebraska grade 5 ELA sampler](https://www.education.ne.gov/wp-content/uploads/2017/07/Grade_5_ELA_Sampler.pdf), [Tennessee item types](https://tn.gov/content/dam/tn/education/documents/tnready_item_types_2017-18.pdf).
- **Reading bands:** [Lexile grade-level FAQ](https://lexile.com/wp-content/uploads/2017/08/T1.4.FAQ_LM-and-Grade-Levels.pdf), [Shanahan on Literacy](https://www.readingrockets.org/blogs/shanahan-on-literacy/which-text-levels-should-we-teach).
- **Choosing teams in PE:** [Merrimack College scholarworks](https://scholarworks.merrimack.edu/health_facpubs/23) (reports the 2013 journal article), [BYU study](https://scholarsarchive.byu.edu/facpub/3025). I did not find a current SHAPE America position statement with the exact wording.
- **SEL assessment cautions:** [NCIEA](https://www.nciea.org/blog/the-center-is-getting-emotional-about-assessment-2/), [RAND commentary](https://www.rand.org/pubs/commentary/2019/02/measuring-social-emotional-skills-carefully.html), [Buros guide](https://buros.org/sites/unl.edu.cehs.educational-psychology.buros/files/media/file/SEL%20Assessments%20Combined.pdf). I did not retrieve CASEL's own assessment guide.
- **Group chats:** [Common Sense Education, Group Chat Dynamics](https://www.commonsense.org/education/digital-literacy/group-chat-dynamics), [AAP guidance](https://www.aap.org/en/patient-care/media-and-children/center-of-excellence-on-social-media-and-youth-mental-health/qa-portal/qa-portal-library/qa-portal-library-questions/group-chats-and-online-messaging/). Research on group chats was done with teens and adults, not young children (the AAP says so).
- **District usage and licences:** [EdWeek Market Brief on unused licences](https://marketbrief.edweek.org/marketplace-k-12/latest-ed-tech-usage-report-shows-improvements-still-1-billion-waste-k-12/), [eLearning Inside](https://news.elearninginside.com/27-of-edtech-product-licenses-go-unused-learnimpact-report/). Vendor-produced; figures from 2017 to 2019.
- **Data privacy:** [N.Y. Education Law 2-d](https://newyork.public.law/laws/n.y._education_law_section_2-d), [OGS guidance on vendor responsibilities](https://ogs.ny.gov/how-your-contract-can-meet-school-vendor-responsibilities-protecting-student-information). I found nothing specific to dashboards.
- **Financial education:** [2021 National Standards for Personal Financial Education](https://www.ksde.gov/Portals/0/CSAS/CSAS%20Home/Financial%20Literacy/2021%20National%20Standards%20for%20Personal%20Financial%20Education.pdf), [Common Core 7.RP.3 as adopted elsewhere](https://www2.cde.ca.gov/cacs/id/web/481). New York's own wording was not retrieved.
