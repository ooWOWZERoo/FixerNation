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

    N('student-data-kept', false, '2026-11-06', 'Release 146', 'Student data: what we keep, and for how long', ['school', 'district', 'families'],
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
