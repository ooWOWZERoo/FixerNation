const express = require('express');
const pool = require('../db/pool');
const { requireStudentAuth } = require('../middleware/studentAuth');

const router = express.Router();
router.use(requireStudentAuth);

// Verify student has an assignment for this curriculum (via their classroom)
async function getAssignment(student, curriculumId) {
  const [rows] = await pool.query(
    'SELECT ca.* FROM classroom_assignments ca WHERE ca.classroom_id = ? AND ca.curriculum_id = ?',
    [student.classroom_id, curriculumId]
  );
  return rows[0] || null;
}

// Full curriculum content for student — always unlocked (teacher's license covers class)
async function loadCurriculum(curriculumId) {
  const [rows] = await pool.query('SELECT * FROM curricula WHERE id = ? AND published = 1', [curriculumId]);
  if (!rows[0]) return null;
  const cur = rows[0];

  const [objectives] = await pool.query('SELECT objective FROM curriculum_objectives WHERE curriculum_id = ? ORDER BY sort_order', [cur.id]);
  const [materials] = await pool.query('SELECT material FROM curriculum_materials WHERE curriculum_id = ? ORDER BY sort_order', [cur.id]);
  const [resources] = await pool.query('SELECT resource, file_path, file_name FROM curriculum_resources WHERE curriculum_id = ?', [cur.id]);
  const [videos] = await pool.query('SELECT name, url, size_label FROM curriculum_videos WHERE curriculum_id = ? ORDER BY sort_order', [cur.id]);
  let documents = [];
  try {
    [documents] = await pool.query('SELECT file_path, file_name FROM curriculum_documents WHERE curriculum_id = ? ORDER BY sort_order', [cur.id]);
  } catch (_) {}

  // Questions WITH their IDs (needed for quiz submission)
  const [questions] = await pool.query(
    'SELECT id, question, correct_index FROM curriculum_quiz_questions WHERE curriculum_id = ? ORDER BY sort_order',
    [cur.id]
  );
  const qIds = questions.map(q => q.id);
  const [options] = qIds.length
    ? await pool.query('SELECT question_id, option_text FROM curriculum_quiz_options WHERE question_id IN (?) ORDER BY sort_order', [qIds])
    : [[]];
  const optsByQ = options.reduce((acc, o) => { (acc[o.question_id] = acc[o.question_id] || []).push(o.option_text); return acc; }, {});

  return {
    id: cur.id,
    title: cur.title,
    series: cur.series,
    shortDescription: cur.short_description,
    overview: cur.overview,
    lessonsCount: cur.lessons_count,
    weeksCount: cur.weeks_count,
    objectives: objectives.map(r => r.objective),
    materials: materials.map(r => r.material),
    resources: resources.map(r => ({ resource: r.resource, filePath: r.file_path || '', fileName: r.file_name || '' })),
    videos: videos.map(r => ({ name: r.name, url: r.url, sizeLabel: r.size_label })),
    documents: documents.map(r => ({ filePath: r.file_path, fileName: r.file_name })),
    quiz: questions.map(q => ({
      id: q.id,
      question: q.question,
      correctIndex: q.correct_index,
      options: optsByQ[q.id] || [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

router.get('/home', async (req, res) => {
  const s = req.student;
  const [assignments] = await pool.query(
    `SELECT ca.id, ca.curriculum_id, ca.sort_order, ca.due_date,
            cur.title, cur.series,
            slp.started_at, slp.completed_at
     FROM classroom_assignments ca
     JOIN curricula cur ON cur.id = ca.curriculum_id
     LEFT JOIN student_lesson_progress slp ON slp.curriculum_id = ca.curriculum_id AND slp.student_id = ?
     WHERE ca.classroom_id = ?
     ORDER BY ca.sort_order, ca.assigned_at`,
    [s.id, s.classroom_id]
  );
  const [gameAssignments] = await pool.query(
    `SELECT cga.id AS assignment_id, cga.game_id, cga.due_date,
            bg.name AS game_title, bg.slug AS game_slug,
            MAX(sgc.completed_at) AS last_completed_at
     FROM classroom_game_assignments cga
     JOIN brain_games bg ON bg.id = cga.game_id
     LEFT JOIN student_game_completions sgc ON sgc.game_assignment_id = cga.id AND sgc.student_id = ?
     WHERE cga.classroom_id = ?
     GROUP BY cga.id, cga.game_id, cga.due_date, bg.name, bg.slug`,
    [s.id, s.classroom_id]
  );
  const [goals] = await pool.query(
    'SELECT * FROM student_goals WHERE student_id = ? ORDER BY created_at DESC',
    [s.id]
  );
  res.json({
    student: { id: s.id, displayName: s.display_name, username: s.username },
    classroom: { id: s.classroom_id, name: s.classroom_name },
    assignments,
    gameAssignments,
    goals,
  });
});

// ---------------------------------------------------------------------------
// Lesson
// ---------------------------------------------------------------------------

router.get('/lesson/:curriculumId', async (req, res) => {
  const assignment = await getAssignment(req.student, req.params.curriculumId);
  if (!assignment) return res.status(403).json({ error: 'Lesson not assigned to your classroom' });

  const cur = await loadCurriculum(req.params.curriculumId);
  if (!cur) return res.status(404).json({ error: 'Lesson not found' });

  const [[progress]] = await pool.query(
    'SELECT * FROM student_lesson_progress WHERE student_id = ? AND curriculum_id = ?',
    [req.student.id, req.params.curriculumId]
  );
  const [quizResponses] = await pool.query(
    'SELECT question_id, selected_option_index, is_correct FROM student_quiz_responses WHERE student_id = ? AND curriculum_id = ? ORDER BY question_id ASC',
    [req.student.id, req.params.curriculumId]
  );
  const [reflections] = await pool.query(
    'SELECT prompt_key, response_text, submitted_at FROM student_reflections WHERE student_id = ? AND curriculum_id = ? ORDER BY submitted_at',
    [req.student.id, req.params.curriculumId]
  );

  res.json({ ...cur, progress: progress || null, quizResponses, reflections });
});

router.post('/lesson/:curriculumId/start', async (req, res) => {
  const assignment = await getAssignment(req.student, req.params.curriculumId);
  if (!assignment) return res.status(403).json({ error: 'Lesson not assigned to your classroom' });

  await pool.query(
    'INSERT INTO student_lesson_progress (student_id, curriculum_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_activity_at = NOW()',
    [req.student.id, req.params.curriculumId]
  );
  res.json({ ok: true });
});

router.post('/lesson/:curriculumId/complete', async (req, res) => {
  const assignment = await getAssignment(req.student, req.params.curriculumId);
  if (!assignment) return res.status(403).json({ error: 'Lesson not assigned to your classroom' });

  await pool.query(
    `INSERT INTO student_lesson_progress (student_id, curriculum_id, completed_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE completed_at = COALESCE(completed_at, NOW()), last_activity_at = NOW()`,
    [req.student.id, req.params.curriculumId]
  );
  res.json({ ok: true });
});

// POST /lesson/:curriculumId/quiz — submit all answers at once
// Body: { answers: [{ questionId, selectedOptionIndex }, ...] }
router.post('/lesson/:curriculumId/quiz', async (req, res) => {
  const assignment = await getAssignment(req.student, req.params.curriculumId);
  if (!assignment) return res.status(403).json({ error: 'Lesson not assigned to your classroom' });

  const { answers } = req.body;
  if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ error: 'answers array required' });

  // Check if already submitted (any response for this curriculum)
  const [[existing]] = await pool.query(
    'SELECT id FROM student_quiz_responses WHERE student_id = ? AND curriculum_id = ? LIMIT 1',
    [req.student.id, req.params.curriculumId]
  );
  if (existing) return res.status(409).json({ error: 'Quiz already submitted' });

  // Load correct answers
  const qIds = answers.map(a => Number(a.questionId));
  const [questions] = await pool.query(
    'SELECT id, correct_index FROM curriculum_quiz_questions WHERE id IN (?) AND curriculum_id = ?',
    [qIds, req.params.curriculumId]
  );
  const correctMap = {};
  questions.forEach(q => { correctMap[q.id] = q.correct_index; });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const results = [];
    for (const a of answers) {
      const qId = Number(a.questionId);
      if (!(qId in correctMap)) continue;
      const isCorrect = Number(a.selectedOptionIndex) === correctMap[qId] ? 1 : 0;
      await conn.query(
        'INSERT IGNORE INTO student_quiz_responses (student_id, curriculum_id, question_id, selected_option_index, is_correct) VALUES (?, ?, ?, ?, ?)',
        [req.student.id, req.params.curriculumId, qId, a.selectedOptionIndex, isCorrect]
      );
      results.push({ questionId: qId, selectedOptionIndex: a.selectedOptionIndex, isCorrect: !!isCorrect, correctIndex: correctMap[qId] });
    }
    await conn.commit();
    const correct = results.filter(r => r.isCorrect).length;
    res.json({ results, score: correct, total: results.length });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.get('/lesson/:curriculumId/quiz-results', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT question_id, selected_option_index, is_correct FROM student_quiz_responses WHERE student_id = ? AND curriculum_id = ?',
    [req.student.id, req.params.curriculumId]
  );
  const correct = rows.filter(r => r.is_correct).length;
  res.json({ responses: rows, score: correct, total: rows.length });
});

// POST /lesson/:curriculumId/reflect
router.post('/lesson/:curriculumId/reflect', async (req, res) => {
  const assignment = await getAssignment(req.student, req.params.curriculumId);
  if (!assignment) return res.status(403).json({ error: 'Lesson not assigned to your classroom' });

  const { promptKey, responseText } = req.body;
  if (!promptKey || !responseText) return res.status(400).json({ error: 'promptKey and responseText required' });

  const [r] = await pool.query(
    'INSERT INTO student_reflections (student_id, curriculum_id, prompt_key, response_text) VALUES (?, ?, ?, ?)',
    [req.student.id, req.params.curriculumId, promptKey, responseText.trim()]
  );
  const [[row]] = await pool.query('SELECT * FROM student_reflections WHERE id = ?', [r.insertId]);
  res.status(201).json(row);
});

router.get('/lesson/:curriculumId/reflect', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT prompt_key, response_text, submitted_at FROM student_reflections WHERE student_id = ? AND curriculum_id = ? ORDER BY submitted_at',
    [req.student.id, req.params.curriculumId]
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

router.get('/goals', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM student_goals WHERE student_id = ? ORDER BY is_achieved, created_at DESC',
    [req.student.id]
  );
  res.json(rows);
});

router.post('/goals', async (req, res) => {
  const { goalText, targetDate } = req.body;
  if (!goalText) return res.status(400).json({ error: 'goalText required' });
  const [r] = await pool.query(
    'INSERT INTO student_goals (student_id, goal_text, target_date) VALUES (?, ?, ?)',
    [req.student.id, goalText.trim(), targetDate || null]
  );
  const [[row]] = await pool.query('SELECT * FROM student_goals WHERE id = ?', [r.insertId]);
  res.status(201).json(row);
});

router.put('/goals/:id', async (req, res) => {
  const [[goal]] = await pool.query('SELECT * FROM student_goals WHERE id = ? AND student_id = ?', [req.params.id, req.student.id]);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { goalText, targetDate, isAchieved } = req.body;
  const achieved = isAchieved === true || isAchieved === 1;
  await pool.query(
    `UPDATE student_goals SET
       goal_text = COALESCE(?, goal_text),
       target_date = ?,
       is_achieved = COALESCE(?, is_achieved),
       achieved_at = ?
     WHERE id = ?`,
    [
      goalText ? goalText.trim() : null,
      targetDate !== undefined ? (targetDate || null) : goal.target_date,
      isAchieved !== undefined ? (achieved ? 1 : 0) : null,
      isAchieved !== undefined ? (achieved && !goal.achieved_at ? new Date().toISOString().slice(0, 19) : (achieved ? goal.achieved_at : null)) : goal.achieved_at,
      goal.id,
    ]
  );
  const [[updated]] = await pool.query('SELECT * FROM student_goals WHERE id = ?', [goal.id]);
  res.json(updated);
});

router.delete('/goals/:id', async (req, res) => {
  await pool.query('DELETE FROM student_goals WHERE id = ? AND student_id = ?', [req.params.id, req.student.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Brain games
// ---------------------------------------------------------------------------

router.get('/games', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT cga.id AS assignment_id, cga.game_id, cga.due_date,
            bg.name AS game_title, bg.slug AS game_slug,
            MAX(sgc.completed_at) AS last_completed_at,
            COUNT(sgc.id) AS completion_count
     FROM classroom_game_assignments cga
     JOIN brain_games bg ON bg.id = cga.game_id
     LEFT JOIN student_game_completions sgc ON sgc.game_assignment_id = cga.id AND sgc.student_id = ?
     WHERE cga.classroom_id = ?
     GROUP BY cga.id, cga.game_id, cga.due_date, bg.name, bg.slug`,
    [req.student.id, req.student.classroom_id]
  );
  res.json(rows);
});

router.post('/games/:gaid/complete', async (req, res) => {
  const [[assignment]] = await pool.query(
    'SELECT cga.* FROM classroom_game_assignments cga WHERE cga.id = ? AND cga.classroom_id = ?',
    [req.params.gaid, req.student.classroom_id]
  );
  if (!assignment) return res.status(404).json({ error: 'Game assignment not found' });

  const { rawScore, durationMs } = req.body;
  const [r] = await pool.query(
    'INSERT INTO student_game_completions (student_id, game_assignment_id, raw_score, duration_ms) VALUES (?, ?, ?, ?)',
    [req.student.id, req.params.gaid, rawScore ?? null, durationMs ?? null]
  );
  const [[row]] = await pool.query('SELECT * FROM student_game_completions WHERE id = ?', [r.insertId]);
  res.status(201).json(row);
});

module.exports = router;
