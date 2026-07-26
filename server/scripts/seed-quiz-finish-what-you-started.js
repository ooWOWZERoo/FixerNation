'use strict';
// One-shot script: insert quiz questions for "Finish What You Started 7-17-#85"
// Run from server/ directory after activating the Node env.
// Idempotent — clears existing questions for this curriculum before inserting.

const pool = require('../db/pool');

const TITLE = 'Finish What You Started';
const SERIES = '7-17-#85';

const QUESTIONS = [
  {
    question: 'What is the central message of today\'s Morning Boost?',
    correctIndex: 0, // A
    options: [
      'Finishing what you started strengthens character and follow-through',
      'Starting with excitement is more important than finishing',
      'It is best to move on whenever a task becomes repetitive',
      'Responsibility only matters when someone is watching',
    ],
  },
  {
    question: 'Why does the lesson say finishing often tests character?',
    correctIndex: 1, // B
    options: [
      'Because the beginning of every task is always the hardest part',
      'Because motivation can fade when the work becomes longer, harder, or less exciting',
      'Because finishing means the work must be perfect',
      'Because completed work does not require effort',
    ],
  },
  {
    question: 'In this lesson, what does follow-through mean?',
    correctIndex: 2, // C
    options: [
      'Starting many tasks so you always feel busy',
      'Waiting until you feel motivated before taking action',
      'Staying responsible enough to complete what matters',
      'Choosing the easiest task and ignoring the rest',
    ],
  },
  {
    question: 'How can unfinished responsibilities affect a student\'s progress?',
    correctIndex: 1, // B
    options: [
      'They always create stronger confidence automatically',
      'They can weaken trust, momentum, and personal responsibility',
      'They make perseverance unnecessary',
      'They prove that starting is enough',
    ],
  },
  {
    question: 'What should a student do when they feel tempted to stop before finishing?',
    correctIndex: 0, // A
    options: [
      'Pause, take a breath, and return to what needs follow-through',
      'Start something new so the work feels exciting again',
      'Quit before the task becomes uncomfortable',
      'Ignore the responsibility until someone else handles it',
    ],
  },
  {
    question: 'The lesson says finishing what you started does not mean everything has to be perfect. What does it mean?',
    correctIndex: 2, // C
    options: [
      'Rushing through the ending without care',
      'Only working when the task feels easy',
      'Following through responsibly with steady effort',
      'Avoiding work that takes patience',
    ],
  },
  {
    question: 'Which statement best connects this lesson to effort and perseverance?',
    correctIndex: 2, // C
    options: [
      'Perseverance means only trying when the outcome is guaranteed',
      'Effort matters most when it is seen by other people',
      'Strong effort includes continuing after the excitement wears off',
      'Perseverance is unnecessary when a task feels repetitive',
    ],
  },
  {
    question: 'Which question from the lesson can help a student regain focus?',
    correctIndex: 1, // B
    options: [
      'How can I avoid this responsibility?',
      'What do I need to finish today?',
      'What is the easiest thing to quit first?',
      'Who can I blame for this taking longer?',
    ],
  },
  {
    question: 'According to the lesson, what does completed work help build?',
    correctIndex: 0, // A
    options: [
      'Confidence, character, discipline, and trust',
      'Avoidance, excuses, and delay',
      'A habit of stopping halfway',
      'The belief that follow-through does not matter',
    ],
  },
  {
    question: 'What is today\'s approved affirmation?',
    correctIndex: 2, // C
    options: [
      'I only begin when I feel ready.',
      'I stop when work becomes boring.',
      'I finish what I started. I stay steady and follow through.',
      'I leave difficult tasks unfinished.',
    ],
  },
];

async function run() {
  const connection = await pool.getConnection();
  try {
    // Find the curriculum
    const [rows] = await connection.query(
      'SELECT id, title, series FROM curricula WHERE title = ? AND series = ? LIMIT 1',
      [TITLE, SERIES]
    );

    if (!rows.length) {
      // Fall back to title-only match in case series is stored differently
      const [fallback] = await connection.query(
        'SELECT id, title, series FROM curricula WHERE title = ? LIMIT 5',
        [TITLE]
      );
      if (!fallback.length) {
        console.error(`No curriculum found with title "${TITLE}". Available rows with similar titles:`);
        const [all] = await connection.query('SELECT id, title, series FROM curricula ORDER BY title');
        all.forEach(r => console.log(`  id=${r.id}  title="${r.title}"  series="${r.series}"`));
        process.exit(1);
      }
      console.log('Exact series match not found. Candidates:');
      fallback.forEach(r => console.log(`  id=${r.id}  title="${r.title}"  series="${r.series}"`));
      console.log('Update SERIES constant in this script to match the correct row, then rerun.');
      process.exit(1);
    }

    const curriculumId = rows[0].id;
    console.log(`Found curriculum id=${curriculumId} — "${rows[0].title}" (${rows[0].series})`);

    await connection.beginTransaction();

    // Clear existing questions (cascades to options via FK)
    const [del] = await connection.query(
      'DELETE FROM curriculum_quiz_questions WHERE curriculum_id = ?',
      [curriculumId]
    );
    console.log(`Cleared ${del.affectedRows} existing question(s)`);

    // Insert questions and options
    for (let i = 0; i < QUESTIONS.length; i++) {
      const q = QUESTIONS[i];
      const [qResult] = await connection.query(
        'INSERT INTO curriculum_quiz_questions (curriculum_id, question, correct_index, sort_order) VALUES (?, ?, ?, ?)',
        [curriculumId, q.question, q.correctIndex, i]
      );
      for (let oi = 0; oi < q.options.length; oi++) {
        await connection.query(
          'INSERT INTO curriculum_quiz_options (question_id, option_text, sort_order) VALUES (?, ?, ?)',
          [qResult.insertId, q.options[oi], oi]
        );
      }
      console.log(`  Q${i + 1} inserted (correct: ${String.fromCharCode(65 + q.correctIndex)})`);
    }

    await connection.commit();
    console.log(`\nDone — ${QUESTIONS.length} questions inserted for curriculum id=${curriculumId}`);
  } catch (err) {
    await connection.rollback();
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    connection.release();
    await pool.end();
  }
}

run();
