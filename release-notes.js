/* Release notes: the one list of customer-facing notes, shown by release-notes.html (the index and each note's own page).

   TO ADD A NOTE: add an entry at the TOP of NOTES (newest first), in plain words a teacher, principal or parent would use. Write what
   changed and why it helps, not how it was built (the internal record is CHANGELOG.md). A note about a change a customer can see on the
   site should ship with the change; see docs/release-notes/README.md.

   N(id, published, date, releases, title, audiences, summary, overview, sections, where, videos)
     id         never change it: it is in links people have been sent (release-notes.html?note=<id>)
     published  true = visitors see it. false = a draft, shown only at release-notes.html?preview=1 until the owner has read it.
                Anything about privacy, data, prices, legal wording or promises starts as a draft.
     date       YYYY-MM-DD, the day it went live
     releases   the internal release numbers, shown small ("Release 152")
     audiences  who it matters to, any of: teachers, school, district, families
     sections   { new: [item], changed: [item], fixed: [item], know: [text] }  where item = { title, who: [audiences], body }
     where      one sentence: where to find it on the site
     videos     help video ids from help-videos.js; the note shows each one once it has been recorded and published

   Claims about Graduate Evidence say "evidence of practice" (a student finished an activity connected to an attribute). Never write
   mastery, growth, proficient, achieved, outcomes or a score about it. Bump ?v=N on the script tags in release-notes.html when this changes. */
(function () {
  'use strict';

  var AUDIENCES = [
    { id: 'teachers', title: 'Teachers' },
    { id: 'school', title: 'School administrators' },
    { id: 'district', title: 'District administrators' },
    { id: 'families', title: 'Parents and students' }
  ];
  var EVERYONE = ['teachers', 'school', 'district', 'families'];

  function N(id, published, date, releases, title, audiences, summary, overview, sections, where, videos) {
    return { id: id, published: published, date: date, releases: releases, title: title, audiences: audiences, summary: summary,
      overview: overview, sections: sections || {}, where: where || '', videos: videos || [] };
  }
  function item(title, who, body) { return { title: title, who: who, body: body }; }

  var NOTES = [
    N('quote-decline', false, '2026-11-16', '', 'You can now decline a quote from the quote page', ['school', 'district'],
      'The quote page has a quiet "Decline this quote" link, with an optional reason, so you can tell us no without writing an email.',
      'If you are not going ahead with a quote, you can say so on the quote page: choose "Decline this quote", add a reason if you like, and we are told. The link then stops accepting that quote, and our team can help you with a different quote if you want one. If you declined by mistake, write to us and we can put the quote back.',
      {
        new: [
          item('Decline a quote', ['school', 'district'], 'A "Decline this quote" link sits at the bottom of the quote page. It opens a small box for an optional reason. Nothing is charged and nothing is set up.'),
          item('A clear page afterward', ['school', 'district'], 'Anyone who opens the link again sees that the quote was declined and who to write to if that was a mistake.')
        ],
        know: [
          'A declined quote cannot be accepted from the link. Our team can put it back for you.',
          'Your reason goes to our team only.'
        ]
      },
      'On the Accept your quote page, from the link in your quote email.', ['D1']),
    N('district-reorder-request', false, '2026-11-16', '', 'District administrators can ask to renew a license or change its seats', ['district'],
      'A new page in the District Admin portal lets you ask us to renew a license or change how many seats it has, and shows where each request stands.',
      'On the new Renew or change seats page, pick a school\'s license and tell us whether you want to renew it as it is or change the number of seats. Our team reviews every request, sends you a quote with the price, and nothing is bought until you accept that quote. You can see each request\'s status on the same page, and you can cancel one while it is still waiting.',
      {
        new: [
          item('Ask to renew or change seats', ['district'], 'Choose a license, then choose renew as it is or type the number of seats you want. You can add a note. You do not see or set a price: we send a quote for that.'),
          item('See where a request stands', ['district'], 'Each request shows as waiting, approved, declined or cancelled. If we decline one, you see our reason on the page and get it by email.')
        ],
        know: [
          'Sending a request does not buy anything or change your license. Your license and seats stay as they are until you accept a quote.',
          'One request can wait for each license at a time. Cancel the waiting one if you want to change it.'
        ]
      },
      'In the District Admin portal, on Renew or change seats.', []),
    N('quote-request-newsletter', false, '2026-11-15', '', 'Asking for a quote no longer signs you up for our newsletter', ['teachers', 'school', 'district'],
      'Asking for a quote doesn\'t add you to the newsletter, and a license paid by card now starts the day we get your payment.',
      'When you ask for a quote, we use your details to answer you and nothing else. You only get our newsletter if you sign up for it yourself. If you pay for a quote by card, your license term now starts the day your payment arrives, not the day you first pressed the card button.',
      { changed: [
        item('Quote requests and the newsletter', ['teachers', 'school', 'district'], 'Asking for a quote no longer adds you to the newsletter list.'),
        item('Card payments and license dates', ['school', 'district'], 'A license paid by card starts on the day we receive the payment.')
      ], know: ['People who are already on the newsletter list stay on it.'] },
      'On the quote request form, and on the accept-your-quote page.', ['D1']),
    N('quote-signer', false, '2026-11-14', '', 'Accepting a quote now records who accepted it', ['school', 'district'],
      'The accept page asks for your full name, and an older quote link tells you when a newer version has replaced it.',
      'Before you accept a quote, you type your full name and, if you like, your title. We keep that with the date and a record of exactly what the quote said, so it is clear later who agreed to what. If we send you a revised quote, the older link stops working and points you to the new one.',
      {
        new: [
          item('Your name on the quote', ['school', 'district'], 'The page asks for your full name (needed) and your title (optional), whether you pay by purchase order or by card. We save them with the time and the quote details you were shown. We do not store your IP address.'),
          item('Older quote links say so', ['school', 'district'], 'When we send a revised quote, the earlier link shows "This quote has a newer version" and points you to the new email. Nothing is charged or set up from the older link.')
        ],
        know: [
          'If the accept page was already open in your browser before this change, reload it once before you submit.',
          'Typing your name records who accepted. We have not had a lawyer review the wording around it yet, so this note does not say anything about its legal effect.'
        ]
      },
      'The Accept your quote page, from the link in your quote email.',
      ['D1']),
    N('game-voice', false, '2026-11-08', 'Release 167', 'A new, warmer voice for every game', ['teachers', 'families'],
      'Every Tune Your Brain game that speaks now uses one new voice, and more games speak, including the games for older students.',
      'We replaced the voices in the games with one warmer voice that is easier to follow. Games that used to sound robotic on some devices now play a recorded voice on every device.',
      {
        new: [
          item('One new voice in every game', ['teachers', 'families'], 'Stories, questions, answers and feedback in the audio-led games for younger children, and the sounds and words in Sound Safari, are all recorded again in the new voice.'),
          item('Recorded voice for older students\' games', ['teachers', 'families'], 'Strength Spotter, Values Compass, Know Yourself, Know Your Triggers, Stress Signals and What Helps Me now read their stories and questions aloud in the recorded voice. Before, they used whatever voice the device had, which often sounded robotic.')
        ],
        fixed: [
          item('Add It Up says one correctly', ['teachers', 'families'], 'Stories with the number one now read "One bird is in a tree. One more flies in." instead of "One birds are in a tree", on screen and in the recording.'),
          item('Letters and sounds', ['teachers', 'families'], 'Letter names in Letter Sounds and the sounds in Sound Safari are now said the way children are taught them.')
        ],
        know: [
          'The finished card in Strength Spotter, Values Compass, Know Yourself, Know Your Triggers, Stress Signals and What Helps Me is built from your student\'s own words, so it is shown on screen and not read aloud.',
          'If a recording ever fails to load, the game stays quiet. It no longer switches to the device\'s voice.'
        ]
      },
      'Games page, then any game that speaks.',
      []),
    N('favorites', true, '2026-11-08', 'Release 165', 'Save lessons and games, and see them all in My favorites', EVERYONE,
      'Star any lesson or game, and find everything you\'ve saved, along with Morning Boost posts, on one My favorites page.',
      'Anyone with a Fixer Nation account can now star lessons and games. The My favorites link in your account menu opens one page with everything you\'ve saved, including Morning Boost posts, with a filter for each.',
      {
        new: [
          item('Star a lesson', EVERYONE, 'Select the star on a lesson card in the Lesson Library, or Save on the lesson\'s own page. Teachers also see Save on each card when they browse lessons to add to their library, so they can keep one without adding it yet.'),
          item('Star a game', EVERYONE, 'Select the star on a game card on the games page, or Save on the game\'s own page.'),
          item('One page for everything you\'ve saved', EVERYONE, 'Open My favorites from your account menu. Filter by lessons, games or Morning Boost posts, and remove a star right there. An Undo button stays for a few seconds.')
        ],
        changed: [
          item('My favorites in the menu', EVERYONE, 'The link used to open only your Morning Boost posts. It now opens the combined page.')
        ],
        know: [
          'Favorites are private. No one else sees what you\'ve saved, and they follow you to any device you sign in on.',
          'You can keep up to 500 lessons and 500 games.',
          'Students who sign in with a classroom code don\'t have favorites, because their teacher chooses their games.',
          'If a saved lesson needs a license you no longer have, it stays in your list and says it needs one.'
        ]
      },
      'Account menu, then My favorites. Stars are on the Lesson Library, the games page, and each lesson and game page.',
      []),
    N('parent-portal-games', true, '2026-11-08', 'Release 164', 'Parents can see assigned games and how a lesson connects to SEL', ['families', 'teachers'],
      'The Parent Portal now lists the games your child\'s teacher assigned and whether your child has played each one, and every lesson page shows the state goals it supports.',
      'Parents who are linked to a classroom now see two additions. Each child has a Games section that lists the games the teacher assigned and whether the child has played them. Each lesson page has a new section that explains which state SEL and Portrait of a Graduate goals the lesson supports.',
      {
        new: [
          item('Games your child\'s teacher assigned', ['families', 'teachers'], 'In the Parent Portal, each child has a Games section. A game shows Played or Not played yet. You never see a score, a time or which answers your child gave. Select a game to read about it.'),
          item('How a lesson connects to state goals', ['families'], 'On a lesson page, open the section called How this lesson connects to SEL and Portrait of a Graduate. It lists the state goals the lesson supports and why, and links to the state\'s own document.')
        ],
        know: [
          'Parents see completion only, the same as for lessons. Reflections and quiz answers stay with the teacher.',
          'Fixer Nation does not know which state a school is in, so the lesson section lists each state we have checked.',
          'The connections are Fixer Nation\'s own mapping. No state education agency or CASEL has reviewed or endorsed it, and the state\'s document is always the source of truth.'
        ]
      },
      'Parent Portal, under each child. Open any lesson from there to see its connections.',
      []),
    N('game-pages', true, '2026-11-08', 'Release 163', 'A page for every game', EVERYONE,
      'Every Tune Your Brain game now has its own page with what it practices, the grades it is for and how it connects to state standards, and you can share the link with anyone.',
      'On the games page, each game card has a new About button. It opens a page for that one game: what students practice, the grade band, and the state standards our team has checked it against. The page is open to anyone, so a teacher can send the link to a parent or a principal who has no account.',
      {
        new: [
          item('A page for each game', EVERYONE, 'Select About on any game card. You see the game\'s name and description, the grade band, what it builds, and a Play now button. Teachers who are signed in also see a shortcut to their classrooms, where they can assign it.'),
          item('Standards connections in one place', ['teachers', 'school', 'district'], 'The page lists each state standard the game connects to, says whether it is a direct match or a supporting one, gives the reason, and links to the state\'s own document. Only connections our team has checked appear.'),
          item('From the standards page to the game', ['school', 'district'], 'On the SEL & Portrait of a Graduate page, a game\'s name is now a link to its page.')
        ],
        know: [
          'The connections are Fixer Nation\'s own mapping. No state education agency or CASEL has reviewed or endorsed them, and the state\'s document is always the source of truth.',
          'A game with no checked connections says so on its page.',
          'Playing without signing in does not save scores. Students who are signed in through their class still play from their own classroom page.'
        ]
      },
      'Open the games page and select About on any game, or open the SEL & Portrait of a Graduate page and select a game name.',
      []),
    N('program-use-report', true, '2026-11-08', 'Release 161', 'Program Use Report for districts and schools', ['district', 'school'],
      'See how your schools are using Fixer Nation this school year, month by month and compared with last year, with a printable page and a download for your board or a grant report.',
      'The Program Use Report gives district administrators one page that shows how much Fixer Nation is being used across their schools: how many teachers have activated their seats, how many students have finished a lesson or game, and how that changes from month to month. Below that it shows which New York social emotional learning benchmarks and graduate attributes students have practiced. School administrators get the same report for their own school. Every figure is a count, and no teacher or student is named. The report describes how the program is used. It does not evaluate student outcomes.',
      {
        new: [
          item('Use across your district, by school', ['district'], 'Select Program Use Report in your portal menu. Tiles show teachers activated, students enrolled, and the share of students who finished at least one activity this school year. A school table shows each school, and marks a school Needs support when few of its classrooms are in regular use.'),
          item('Month by month, and last school year', ['district'], 'See students active, activities finished, and classrooms in regular use for each month. Fixer Nation now saves these totals every month, so last school year stays on the page after student records are removed. Months from this school year are filled in from classroom activity, so last year may have a few of those.'),
          item('Standards coverage under New York\'s three goals', ['district', 'school'], 'The same Graduate Evidence view, with the social emotional learning benchmarks grouped under the three goals the state uses. Last year\'s coverage appears beside this year\'s once it has been saved.'),
          item('Download, print, and share the method', ['district', 'school'], 'Download a CSV of the same numbers, or print the page to PDF. A plain "How we count" page explains every number and what the report can\'t tell you, and you can link to it from a board packet or a grant report.'),
          item('A version for each school', ['school'], 'School administrators select Program Use Report in their menu to see their own school: teachers activated, students active, use by month, and standards coverage.')
        ],
        know: [
          'Schools with very few students are combined into one row, and schools with only a few activated teachers hide their teacher and classroom figures, so no one can be picked out. A downloaded figure that is hidden says suppressed instead of showing 0.',
          'The report shows how the program is used. It doesn\'t measure student outcomes, and Fixer Nation holds no demographic information, so figures can\'t be split by group. Measures such as attendance or climate surveys come from your own data.',
          'The connections to New York\'s frameworks are Fixer Nation\'s own mapping. Neither New York State nor CASEL has endorsed them. New York\'s social emotional learning benchmarks are voluntary and the state has no required reporting form that we know of, so this is supporting information to attach to your own report. Check your state education agency and your funding program for what to submit. Fixer Nation does not produce rating levels for the state\'s implementation rubric, but these counts can support your own self-assessment.',
          'The first school year shows only the months since the report was switched on, filled in from classroom activity. If a teacher removed a student, that student is left out of those months.'
        ]
      },
      'District administrators and school administrators: select Program Use Report in your portal menu.',
      ['C9']),

    N('my-graduate-portrait', true, '2026-11-08', 'Releases 157 and 159', 'My Graduate Portrait', ['teachers', 'school', 'district', 'families'],
      'Students get their own page showing which graduate skills they have practiced this school year, and can pin a few of their own words to it.',
      'My Graduate Portrait is a page each student sees when they sign in. It uses the same New York frameworks as Graduate Evidence and the same rule: a skill counts as practiced once the student has finished a lesson or game that Fixer Nation connects to it. The student sees the names of the activities behind each skill, and up to three of their own reflections or goals if they choose to pin them. Students and their families can also print a one-page keepsake of it. The portrait is a record of what a student has done. It never gives a grade and never compares one student with another.',
      {
        new: [
          item('A portrait page for every student', ['families', 'teachers'], 'Students select My Graduate Portrait on their home page. Each skill shows whether they have practiced it, with the games and lessons that count. A skill that says Not practiced yet only means nothing connected to it has been finished so far.'),
          item('A one-page keepsake to print or save', ['families', 'teachers'], 'Students select Print or save my keepsake on their portrait. A parent or guardian linked to the student can open the same keepsake from the parent portal. It fits on one letter page and shows each skill with the games and lessons that count. Fixer Nation doesn\'t keep a copy, so families save or print it themselves.'),
          item('Pin up to three of their own words', ['families', 'teachers'], 'A student can pin a reflection or a goal they wrote this school year and show it beside a skill if they like. They can remove a pin whenever they want, and the original reflection or goal stays where it was.')
        ],
        changed: [
          item('A switch for teachers', ['teachers'], 'In Edit Details for a classroom, teachers can turn the keepsake off for that class, for example during testing. It\'s on by default, and the portrait page itself stays available.')
        ],
        know: [
          'The portrait shows evidence of practice: a student finished an activity that Fixer Nation connects to a skill. It isn\'t a test, and it doesn\'t show how well a student did.',
          'The connections are Fixer Nation\'s own mapping to New York\'s frameworks. Neither New York State nor CASEL has endorsed them. For now every student sees New York\'s frameworks.',
          'Pinned words show only on the student\'s own page and on the keepsake the student prints. Parents and school and district administrators don\'t see them, and teachers read reflections and goals on the usual progress pages, as before.',
          'The portrait page shows the current school year. The keepsake shows the school year of the student\'s classroom, so it still prints after the new school year starts.',
          'Parents see the keepsake but not the student\'s portrait page. When a student\'s records are removed, their portrait and any pinned words go with them.'
        ]
      },
      'Students: sign in and select My Graduate Portrait on your home page, or at the top of My Goals & History.',
      ['S5', 'S6']),

    N('graduate-evidence', true, '2026-11-07', 'Releases 151 and 152', 'Graduate Evidence', ['teachers', 'school', 'district'],
      'See which of New York\'s graduate attributes and social emotional learning benchmarks your students have practiced, and get optional ideas for what to assign next.',
      'Graduate Evidence turns the lessons and games your students already do into a picture of which graduate attributes they have practiced. It uses New York\'s Social Emotional Learning Benchmarks and Portrait of a Graduate. A student counts once they finish a lesson or game that Fixer Nation connects to an attribute, so nobody has extra data to enter.',
      {
        new: [
          item('Ideas for what to assign next', ['teachers'], 'On a classroom\'s Assignments tab, select Show me ideas under Not sure what to assign? We pick up to three games or lessons for your grade levels that would add practice for attributes your class hasn\'t practiced yet. Each idea lists the attributes it adds, and you can assign one in a click. It\'s only a suggestion.'),
          item('A Graduate Evidence tab for every classroom', ['teachers'], 'See every attribute, with how many of your students have practiced it. Student names stay on your usual progress pages.'),
          item('A Graduate Evidence page for your school', ['school'], 'Select Graduate Evidence in your portal menu to see how many students have practiced each attribute, classroom by classroom. It prints on one page for your principal or board.'),
          item('The same picture across your schools', ['district'], 'See attribute practice school by school, ready for your Portrait of a Graduate or social emotional learning reporting.')
        ],
        know: [
          'Graduate Evidence shows evidence of practice: a student finished an activity that Fixer Nation connects to an attribute. It isn\'t a test, and it doesn\'t show how well a student did.',
          'The connections are Fixer Nation\'s own mapping to New York\'s frameworks. Neither New York State nor CASEL has endorsed them.',
          'New York comes first. Some attributes say that no activity is connected yet while we finish checking connections.',
          'Administrators see counts and percentages only, never a student\'s or a teacher\'s name. Very small groups are combined so no one can be picked out.',
          'Every screen shows the current school year automatically.'
        ]
      },
      'Teachers: open a classroom, then use the Assignments tab for ideas or the Graduate Evidence tab for every attribute. School and district administrators: select Graduate Evidence in your portal menu.',
      ['T9', 'B11', 'C8']),

    N('prices-and-wording', true, '2026-11-07', 'Releases 147 and 150', 'Prices and wording that match how Fixer Nation works', EVERYONE,
      'License prices now come from one price list, a single teacher can buy a license from the registration page, and several pages now describe parents and students accurately.',
      'We checked our public pages against what the product really does and fixed the places where they disagreed.',
      {
        new: [
          item('Buy an individual license from the registration page', ['teachers'], 'If your school has no license on file, you can now buy an individual license for one educator, valid for 12 months, from the Teacher Registration page. The terms and refund line show before you pay.'),
          item('Prices come from one list', ['school', 'district'], 'The For Schools page now shows the price we\'ve set for each plan. Where a plan is quote-only, the page says Contact us for a quote.')
        ],
        changed: [
          item('Parents see completion only', ['families'], 'The For Parents page no longer promises quiz scores or skill growth. Parents see which lessons their child has started and finished. Answers and reflections stay with the teacher, as the Parents\' Bill of Rights says.'),
          item('Reflections are for the assigning teacher', ['families', 'school'], 'The For Students page no longer says school administrators can read reflections. Only the teacher who assigned the lesson can.'),
          item('Parents join by invitation', ['families', 'teachers'], 'Pages that mentioned a parent code now say what really happens. Your child\'s teacher sends a personal invitation by email, one for each child.'),
          item('Individual licenses and classrooms', ['teachers'], 'We removed wording that suggested an individual license covers only one classroom.')
        ],
        fixed: [
          item('The Buy Solo button', ['teachers'], 'On the Teacher Registration page, Buy Solo used to send teachers to a cart that refused the order. It now takes them to checkout.')
        ]
      },
      'The Teacher Registration, For Schools, For Parents and For Students pages.', []),

    N('brain-games', true, '2026-11-06', 'Releases 137 to 144', 'More Brain Games, with every grade band covered', ['teachers', 'families'],
      'The Brain Games library now has 67 games, grouped by focus, with at least two games in every focus for every grade band.',
      'We added 36 games and organized the library so it\'s easier to find the right one for your class.',
      {
        new: [
          item('Browse by focus', ['teachers'], 'The Brain Games page filters by the five social emotional competencies (Self-Awareness, Self-Management, Social Awareness, Relationship Skills and Responsible Decision-Making) and by skills practice (Literacy, Math and Thinking Skills). Each card names its focus, and you can pick a focus when you assign a game.'),
          item('36 new games', ['teachers', 'families'], 'Reading and math games for the younger bands, a second Self-Awareness game in every band, ten Relationship Skills and Social Awareness games, and twelve more across Self-Management, Responsible Decision-Making, literacy, math and thinking skills.'),
          item('Read aloud for the youngest players', ['teachers', 'families'], 'Every Discover game is read aloud in a recorded voice, so children who are still learning to read can play on their own.'),
          item('"Your turn" check-ins', ['teachers', 'families'], 'Feelings Detective, Strength Spotter and Values Compass now end with a short check-in where the child says how they feel or what they value, then sees a card built from their own picks. Nothing they pick is logged, sent or saved, and there\'s always an I\'m not sure answer.')
        ],
        changed: [
          item('Reaction Time has STOP signs', ['teachers', 'families'], 'Between the green rounds, a red STOP sign sometimes appears, and the right move is to not tap. The sign differs by word and shape, not only by color.'),
          item('Tags that match what each game practices', ['teachers'], 'We corrected the focus on several games. Quick Math, for example, moves to the Explore band because its numbers are at a third to fifth grade level.')
        ]
      },
      'The Brain Games page, and the Assign Brain Game picker in any classroom.', []),

    N('help-center', true, '2026-11-06', 'Releases 123 to 145', 'A Help center, and a clearer way to ask for help', EVERYONE,
      'Search more than 200 plain answers, watch short how-to videos, and send a request when you need a person.',
      'Most questions we hear now have a written answer, and the Get help page points you to likely answers before you write to us.',
      {
        new: [
          item('The Help center', EVERYONE, 'Search answers by topic and by who you are: school administrator, district administrator, teacher, student or parent. Many answers have steps, and some link to a short video.'),
          item('Get help', EVERYONE, 'Choose a topic and we show likely answers first. If you still need a person, send a request. Replies appear on the page, and signed-in people see a New reply tag when one arrives.'),
          item('Answers for your role', EVERYONE, 'When you\'re signed in, answers written for your role come first.'),
          item('How-to videos on asking for help', EVERYONE, 'Two short videos show how to ask for help and follow your request, signed in or not.')
        ],
        changed: [
          item('Ended trials', ['teachers'], 'An ended trial no longer offers Convert to Annual Access. The card says the trial has ended and links to the Licenses page.')
        ]
      },
      'Help center and Get help are in the footer on every page, and in the School Admin and District Admin portal menus.', ['G1', 'G2']),

    N('student-data-kept', true, '2026-11-06', 'Release 146', 'Student data: what we keep, and for how long', ['school', 'district', 'families'],
      'The Student Data Privacy page and a Help answer now say plainly how long student information is kept.',
      'We rewrote this wording so it matches what really happens today.',
      {
        changed: [
          item('What we keep', ['school', 'district', 'families'], 'We keep student information while a school uses Fixer Nation. Removing a student hides them from the class, but it doesn\'t erase their records.'),
          item('When we delete', ['school', 'district', 'families'], 'We delete a student\'s records, or a whole classroom\'s, when the school or a parent asks. Brain Games activity older than about 13 months is deleted automatically. Backup copies are overwritten within 14 days.')
        ],
        know: ['We don\'t yet delete student records automatically at the end of each school year, and these pages don\'t promise that.']
      },
      'The Student Data Privacy page, section 6, and the Help center answer "How long is student data kept?"', [])
  ];

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // '2026-11-07' -> 'November 7, 2026' (read as text, so a time zone cannot move the day)
  function formatDate(d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : String(d || ''); }
  function monthOf(d) { var m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }

  function visible(preview) { return NOTES.filter(function (n) { return preview || n.published; }); }
  function byId(id) { for (var i = 0; i < NOTES.length; i++) if (NOTES[i].id === id) return NOTES[i]; return null; }
  function forAudience(notes, aud) { return !aud || aud === 'everyone' ? notes : notes.filter(function (n) { return n.audiences.indexOf(aud) !== -1; }); }
  // [{ month: 'November 2026', notes: [...] }] in the order given (newest first)
  function byMonth(notes) {
    var out = [];
    notes.forEach(function (n) {
      var m = monthOf(n.date);
      if (!out.length || out[out.length - 1].month !== m) out.push({ month: m, notes: [] });
      out[out.length - 1].notes.push(n);
    });
    return out;
  }
  function audienceTitle(id) { for (var i = 0; i < AUDIENCES.length; i++) if (AUDIENCES[i].id === id) return AUDIENCES[i].title; return id; }

  window.FNReleaseNotes = { audiences: AUDIENCES, notes: NOTES, visible: visible, byId: byId, forAudience: forAudience, byMonth: byMonth,
    formatDate: formatDate, audienceTitle: audienceTitle };
})();
