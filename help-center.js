/* Help center: the one list of questions and answers (Release 123). Shown by help.html and, for a few, at the top of support.html.

   TO ADD OR CHANGE AN ANSWER: edit the entry below. Keep answers short (2 to 4 sentences), in plain words, and check them against how the
   site really works. New and changed entries start with  reviewed: false  : visitors do not see them until the owner has read them at
   help.html?preview=1 and the flag is switched to true.
   Fields: id (never change it: it is what the anonymous "faq_open" count records), for (who it is for: 'everyone', 'school', 'district',
   'teacher', 'student', 'parent'), topic, q (the question), a (the answer), steps (optional list), video (optional help video id from
   help-videos.js), help (the Get help topic to pre-select: cant_sign_in, invitation_or_seat, students_or_classroom, parents,
   billing_or_license, something_broke, other).
   Numbers an owner can change in Settings (lesson limits, idle times) are NOT written here as numbers. Bump the ?v=N on the script tags
   in help.html and support.html when this file changes. */
(function () {
  'use strict';

  var AUDIENCES = [
    { id: 'everyone', title: 'Everyone' },
    { id: 'school', title: 'School administrators' },
    { id: 'district', title: 'District administrators' },
    { id: 'teacher', title: 'Teachers' },
    { id: 'student', title: 'Students' },
    { id: 'parent', title: 'Parents' }
  ];

  var ENTRIES = [
    // ---- Signing in (everyone)
    { id: 'which-sign-in', for: ['everyone'], topic: 'Signing in', reviewed: false, help: 'cant_sign_in', video: 'A3',
      q: 'Which sign-in page do I use?',
      a: 'Teachers, school administrators, district administrators, parents and students each have their own sign-in page, and all five links are in the footer. If you are not sure which one is yours, the person who invited you can tell you.' },
    { id: 'forgot-password', for: ['everyone'], topic: 'Signing in', reviewed: false, help: 'cant_sign_in', video: 'A2',
      q: 'I forgot my password.',
      a: 'Use the forgot password link on your sign-in page, enter your email, and we will send you a link to choose a new one. The link works for one hour. Students do not have passwords: ask your teacher for a new PIN.' },
    { id: 'link-expired', for: ['everyone'], topic: 'Signing in', reviewed: false, help: 'cant_sign_in', video: 'A2',
      q: 'My reset or verification link says it has expired.',
      a: 'Password reset links last one hour and email verification links last 24 hours. Ask for a new one from your sign-in page. If the new email does not come, see "I never got the email".' },
    { id: 'no-email', for: ['everyone'], topic: 'Signing in', reviewed: false, help: 'cant_sign_in',
      q: 'I never got the email.',
      a: 'Look in your spam or junk folder first, and check that you used the same address your school invited. Some school mail systems block outside email, so your IT team may need to allow messages from fixernationeducation.com. If it still has not arrived after a few minutes, send us a request. We can give you a one-time link directly, so you do not have to wait for the email.' },
    { id: 'microsoft', for: ['everyone'], topic: 'Signing in', reviewed: false, help: 'cant_sign_in', video: 'A4',
      q: 'How does Sign in with Microsoft work?',
      a: 'Choose Continue with Microsoft in the sign-in box. The first time, we email a confirmation link to the address on your account. Open it and press the button to finish. After that, one click signs you in.' },
    { id: 'ask-for-help', for: ['everyone'], topic: 'Getting help', reviewed: false, help: 'other', video: 'G1',
      q: 'How do I send you a request, and where do I read the reply?',
      a: 'Open Get help from the footer, choose a topic, and describe what is happening. If you are signed in we already know who you are. When we reply, you will see a New reply tag beside your request on the same page, and you can add to the conversation from there. Please do not put student names, PINs or passwords in a request.' },
    { id: 'check-reply', for: ['everyone'], topic: 'Getting help', reviewed: false, help: 'other', video: 'G2',
      q: 'I sent a request without signing in. How do I see the answer?',
      a: 'Replies are shown on the Get help page, not emailed. Go back to Get help, find the box that says Already sent a request, and enter the reference you were given and the email address you used. You will see the whole conversation and can answer from there. Your confirmation email also has the reference.' },
    { id: 'account-closed', for: ['everyone'], topic: 'Signing in', reviewed: false, help: 'cant_sign_in',
      q: 'It says my account has been closed.',
      a: 'An account is closed when we remove the person from our records, for example when someone leaves a school. You cannot sign in until it is reopened. If this is a mistake, send us a request with the email address on the account.' },

    // ---- School administrators
    { id: 'school-cant-invite', for: ['school'], topic: 'Teachers and seats', reviewed: false, help: 'invitation_or_seat', video: 'B10',
      q: 'Why can\'t I invite teachers yet?',
      a: 'Invitations open once your license is active. While a payment or a purchase order is still pending, or on some trial licenses, the invite button stays off, and the page tells you which case applies. If you think your license should be active, send us a request.' },
    { id: 'school-invite-expired', for: ['school'], topic: 'Teachers and seats', reviewed: false, help: 'invitation_or_seat', video: 'B4',
      q: 'A teacher\'s invitation expired, or they never opened it.',
      a: 'Invitations last 14 days. On the Invitations page you can resend one, extend it, or revoke it, and the status badge shows where each one stands.' },
    { id: 'school-teacher-left', for: ['school'], topic: 'Teachers and seats', reviewed: false, help: 'invitation_or_seat', video: 'B5',
      q: 'A teacher left. How do I free their seat?',
      a: 'On your teacher roster, remove the teacher. Their seat goes back to your pool, so you can invite someone else. You can also deactivate a teacher for a while and reactivate them later.' },
    { id: 'school-levels', for: ['school'], topic: 'Your portal', reviewed: false, help: 'invitation_or_seat', video: 'B9',
      q: 'What do the administrator permission levels mean?',
      a: 'Primary, Secondary and Read Only administrators can each do different things. The video explains each level, and the Organization page shows who holds which one. For more seats or a renewal, send us a request.' },
    { id: 'school-branding', for: ['school'], topic: 'Branding and settings', reviewed: false, help: 'other', video: 'B6',
      q: 'How do I add my school\'s logo and colors?',
      a: 'Open Branding, upload your logo, choose your colors, check the preview, and publish. Teachers and students see the new look once you publish.' },
    { id: 'school-safety-alerts', for: ['school'], topic: 'Branding and settings', reviewed: false, help: 'other', video: 'B8',
      q: 'Who gets student safety alerts?',
      a: 'You choose. On the Organization page, add the people who should get an email when a safety alert comes up, and remove anyone who should not.' },

    // ---- District administrators
    { id: 'district-add-admin', for: ['district'], topic: 'School administrators', reviewed: false, help: 'invitation_or_seat', video: 'C4',
      q: 'How do I add a school administrator?',
      a: 'On Schools, pick the school, enter the person\'s name and email, and send the invitation. From the same row you can later resend the welcome email, send a password reset, edit, or remove them.' },
    { id: 'district-admin-cant-sign-in', for: ['district'], topic: 'School administrators', reviewed: false, help: 'cant_sign_in', video: 'C4',
      q: 'A school administrator can\'t sign in.',
      a: 'Find them on Schools. If they have not finished setting up, choose Resend Welcome. If they have signed in before, choose Reset Password. Either one sends a fresh link.' },
    { id: 'district-pog', for: ['district'], topic: 'Portrait of a Graduate', reviewed: false, help: 'other', video: 'C5',
      q: 'How do we record our Portrait of a Graduate?',
      a: 'Add your framework and its standards first, then suggest where our lessons and games fit, and send it for review. Two short videos walk through each part.' },

    // ---- Teachers
    { id: 'teacher-accept-invite', for: ['teacher'], topic: 'Getting in', reviewed: false, help: 'invitation_or_seat', video: 'T1',
      q: 'How do I accept my school\'s invitation?',
      a: 'Open the email from your school administrator and choose the link. Create a password or use Microsoft, and you land in your teacher portal. The link works for 14 days. If it has expired, ask your school administrator to resend it.' },
    { id: 'teacher-register', for: ['teacher'], topic: 'Getting in', reviewed: false, help: 'invitation_or_seat', video: 'T2',
      q: 'Can I register myself with my school email?',
      a: 'Yes. Use Teacher Registration in the footer and sign up with your school email address. If you have trouble getting access after that, send us a request with your school name.' },
    { id: 'teacher-classroom', for: ['teacher'], topic: 'Classrooms and students', reviewed: false, help: 'students_or_classroom', video: 'T3',
      q: 'How do I create a classroom and add students?',
      a: 'On My Classrooms, create the classroom, then add students one at a time or paste a list. Each student gets a username and a PIN. You can also share the classroom\'s join code so students join on their own.' },
    { id: 'teacher-student-cant-sign-in', for: ['teacher'], topic: 'Classrooms and students', reviewed: false, help: 'students_or_classroom', video: 'T6',
      q: 'A student can\'t sign in.',
      steps: [
        'Check that they are typing their username, not their name. You can see it on the Students tab.',
        'If they forgot the PIN, select Reset PIN beside their name and give them the new one.',
        'If the page says they are locked, five wrong tries in a row locks a username for about 15 minutes. Select Unlock beside their name to let them try again right away.'
      ],
      a: 'Most sign-in trouble is a wrong PIN or a username typed as a name.' },
    { id: 'teacher-invite-parent', for: ['teacher'], topic: 'Classrooms and students', reviewed: false, help: 'parents', video: 'T6',
      q: 'How do I invite a parent?',
      a: 'On the Students tab, select Invite Parent beside the student, enter the parent\'s email, and add a short note if you like. The link works for 14 days. Parents see whether each lesson is done and the lesson resources, but not quiz answers or what their child wrote.' },
    { id: 'teacher-parent-link-expired', for: ['teacher'], topic: 'Classrooms and students', reviewed: false, help: 'parents', video: 'T6',
      q: 'A parent\'s invitation link expired.',
      a: 'Revoke the old invitation in the list below the students, then invite the parent again. If you would rather not, send us a request and we can extend it by 14 days.' },
    { id: 'teacher-library', for: ['teacher'], topic: 'Lessons', reviewed: false, help: 'other', video: 'T7',
      q: 'My lesson library is full, or I can\'t remove a lesson.',
      a: 'Your library has a limit on how many lessons it holds and how many times you can swap one out. The page shows both numbers. If you need more room, send us a request.' },
    { id: 'teacher-community', for: ['teacher'], topic: 'Community', reviewed: false, help: 'other', video: 'M1',
      q: 'How do I find and join my community groups?',
      a: 'Open Community and use Browse to find groups for your school and interests. Your school\'s group is private to the people at your school.' },

    // ---- Students
    { id: 'student-pin', for: ['student'], topic: 'Signing in', reviewed: false, help: 'students_or_classroom',
      q: 'My PIN doesn\'t work, or it says I\'m locked.',
      a: 'Make sure you typed your username, not your name. If it still fails, ask your teacher. They can give you a new PIN or unlock you right away. If you wait about 15 minutes, the lock goes away on its own.' },
    { id: 'student-username', for: ['student'], topic: 'Signing in', reviewed: false, help: 'students_or_classroom',
      q: 'I forgot my username.',
      a: 'Ask your teacher. Your username is on your class list.' },
    { id: 'student-join', for: ['student'], topic: 'Getting started', reviewed: false, help: 'students_or_classroom', video: 'S1',
      q: 'How do I join my class?',
      a: 'Open Student Login, choose Join a Classroom, and type the join code your teacher gave you. Add your name and choose a PIN of 4 to 6 digits. Write down your username and PIN, because you need both to sign in next time.' },

    // ---- Parents
    { id: 'parent-link', for: ['parent'], topic: 'Getting started', reviewed: false, help: 'parents', video: 'P1',
      q: 'My invitation link doesn\'t work.',
      a: 'Invitation links last 14 days. If yours has expired or will not open, ask your child\'s teacher to invite you again, or send us a request with your child\'s class and we will help.' },
    { id: 'parent-see', for: ['parent'], topic: 'Getting started', reviewed: false, help: 'parents', video: 'P1',
      q: 'What can I see about my child?',
      a: 'You can see whether each lesson is done and the lesson resources. You cannot see quiz answers or what your child wrote.' },
    { id: 'parent-privacy', for: ['parent'], topic: 'Privacy', reviewed: false, help: 'other',
      q: 'How is my child\'s information protected?',
      a: 'Students sign in with a username and PIN, with no email address. Only the student, their teacher and authorized Fixer Nation staff can see their information. Read the Student Data Privacy page for the full details.' }
  ];

  function visible(preview) {
    return ENTRIES.filter(function (e) { return preview || e.reviewed; });
  }
  function byId(id) { for (var i = 0; i < ENTRIES.length; i++) if (ENTRIES[i].id === id) return ENTRIES[i]; return null; }
  function forAudience(entries, aud) {
    if (!aud || aud === 'everyone') return entries;
    return entries.filter(function (e) { return e.for.indexOf(aud) !== -1 || e.for.indexOf('everyone') !== -1; });
  }
  // Matches every typed word against the question, answer and topic (case-insensitive).
  function search(entries, text) {
    var words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return entries;
    return entries.filter(function (e) {
      var hay = (e.q + ' ' + e.a + ' ' + e.topic + ' ' + (e.steps || []).join(' ')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  window.FNHelpCenter = { audiences: AUDIENCES, entries: ENTRIES, visible: visible, byId: byId, forAudience: forAudience, search: search };
})();
