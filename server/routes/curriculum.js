const express = require('express');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');
const { getSiteUser, hasActiveLicense, hasParentAccessToCurriculum } = require('../lib/access');

const quizUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseQuizDocx(buffer) {
  const zip = new AdmZip(buffer);
  const raw = zip.readAsText('word/document.xml');
  const text = raw
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x2013;/g, '–').replace(/&#x2014;/g, '—');

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let curriculumTitle = null;
  const questions = [];
  let current = null;

  for (const line of lines) {
    const cm = line.match(/^CURRICULUM\s*:\s*(.+)$/i);
    if (cm) { curriculumTitle = cm[1].trim(); continue; }

    const qm = line.match(/^Q\s*(\d+)\s*[.)]\s*(.+)$/i);
    if (qm) {
      if (current) questions.push(current);
      current = { question: qm[2].trim(), options: [], correctIndex: null };
      continue;
    }

    const om = line.match(/^([A-D])\s*[.)]\s*(.+)$/i);
    if (om && current) { current.options.push(om[2].trim()); continue; }

    const am = line.match(/^ANSWER\s*:\s*([A-D])\b/i);
    if (am && current) {
      current.correctIndex = ['A','B','C','D'].indexOf(am[1].toUpperCase());
      continue;
    }
  }
  if (current) questions.push(current);

  const errors = [];
  if (!curriculumTitle) errors.push('Missing CURRICULUM: line.');
  questions.forEach((q, i) => {
    if (q.options.length !== 4) errors.push(`Q${i+1}: expected 4 options, found ${q.options.length}.`);
    if (q.correctIndex === null || q.correctIndex === -1) errors.push(`Q${i+1}: missing or invalid ANSWER: line.`);
  });
  if (errors.length) throw new Error(errors.join(' '));
  if (!questions.length) throw new Error('No questions found. Ensure questions start with Q1., Q2., etc.');

  return { curriculumTitle, questions };
}

const router = express.Router();

function toSqlLike(q) {
  if (!q.includes('*') && !q.includes('?')) return '%' + q + '%';
  return q.replace(/\*/g, '%').replace(/\?/g, '_');
}

// Strips the actual downloadable content (lesson document + quiz) from each
// curriculum unless the requester is an admin or a site_user with an active
// license seat. Everything else (theme, series, overview, objectives,
// materials list, resource labels, video) stays visible as a public preview.
async function gateAccess(curricula, req) {
  const isAdmin = !!getAuthUser(req);
  const siteUser = isAdmin ? null : await getSiteUser(req);
  const licensed = isAdmin || await hasActiveLicense(siteUser && siteUser.id);
  return curricula.map(c => ({
    ...c,
    documents: licensed ? c.documents : [],
    quiz: licensed ? c.quiz : [],
    access: { licensed, loggedIn: isAdmin || !!siteUser },
  }));
}

async function attachChildren(curricula) {
  if (curricula.length === 0) return curricula;
  const ids = curricula.map(c => c.id);

  const [audienceRows] = await pool.query('SELECT curriculum_id, audience FROM curriculum_audiences WHERE curriculum_id IN (?)', [ids]);
  const [objectiveRows] = await pool.query('SELECT curriculum_id, objective FROM curriculum_objectives WHERE curriculum_id IN (?) ORDER BY sort_order', [ids]);
  const [materialRows] = await pool.query('SELECT curriculum_id, material FROM curriculum_materials WHERE curriculum_id IN (?) ORDER BY sort_order', [ids]);
  const [resourceRows] = await pool.query('SELECT curriculum_id, resource, file_path, file_name, download_limit FROM curriculum_resources WHERE curriculum_id IN (?)', [ids]);
  const [videoRows] = await pool.query('SELECT curriculum_id, name, url, size_label FROM curriculum_videos WHERE curriculum_id IN (?) ORDER BY sort_order', [ids]);
  let documentRows = [];
  try {
    [documentRows] = await pool.query('SELECT curriculum_id, file_path, file_name FROM curriculum_documents WHERE curriculum_id IN (?) ORDER BY sort_order', [ids]);
  } catch (_) { /* table may not exist yet — migration pending */ }
  const [questionRows] = await pool.query('SELECT id, curriculum_id, question, correct_index FROM curriculum_quiz_questions WHERE curriculum_id IN (?) ORDER BY sort_order', [ids]);
  const questionIds = questionRows.map(q => q.id);
  const [optionRows] = questionIds.length
    ? await pool.query('SELECT question_id, option_text FROM curriculum_quiz_options WHERE question_id IN (?) ORDER BY sort_order', [questionIds])
    : [[]];

  const group = (rows, key) => rows.reduce((acc, r) => { (acc[r[key]] = acc[r[key]] || []).push(r); return acc; }, {});
  const audiencesByC = group(audienceRows, 'curriculum_id');
  const objectivesByC = group(objectiveRows, 'curriculum_id');
  const materialsByC = group(materialRows, 'curriculum_id');
  const resourcesByC = group(resourceRows, 'curriculum_id');
  const videosByC = group(videoRows, 'curriculum_id');
  const documentsByC = group(documentRows, 'curriculum_id');
  const optionsByQ = group(optionRows, 'question_id');
  const questionsByC = group(questionRows, 'curriculum_id');

  return curricula.map(c => ({
    ...c,
    audiences: (audiencesByC[c.id] || []).map(r => r.audience),
    objectives: (objectivesByC[c.id] || []).map(r => r.objective),
    materials: (materialsByC[c.id] || []).map(r => r.material),
    resources: (resourcesByC[c.id] || []).map(r => ({ resource: r.resource, filePath: r.file_path || '', fileName: r.file_name || '', downloadLimit: r.download_limit || 0 })),
    videos: (videosByC[c.id] || []).map(r => ({ name: r.name, url: r.url, sizeLabel: r.size_label })),
    documents: (documentsByC[c.id] || []).map(r => ({ filePath: r.file_path, fileName: r.file_name })),
    quiz: (questionsByC[c.id] || []).map(q => ({
      id: q.id,
      question: q.question,
      correctIndex: q.correct_index,
      options: (optionsByQ[q.id] || []).map(o => o.option_text),
    })),
  }));
}

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    series: row.series,
    shortDescription: row.short_description,
    overview: row.overview,
    lessonsCount: row.lessons_count,
    weeksCount: row.weeks_count,
    downloadLimit: row.download_limit,
    published: !!row.published,
    createdAt: row.created_at,
    audiences: row.audiences,
    objectives: row.objectives,
    materials: row.materials,
    resources: row.resources,
    videos: row.videos,
    documents: row.documents,
    quiz: row.quiz,
  };
}

router.get('/', async (req, res) => {
  const isAdmin = !!getAuthUser(req);
  const wantsAll = req.query.all === 'true' && isAdmin;
  let rows;
  if (wantsAll) {
    [rows] = await pool.query('SELECT * FROM curricula ORDER BY sort_order ASC, created_at DESC');
  } else {
    const siteUser = await getSiteUser(req);
    // Licensed non-admin teachers with ≥1 plan selection see only their library
    if (siteUser && siteUser.role !== 'parent' && await hasActiveLicense(siteUser.id)) {
      const [selRows] = await pool.query(
        'SELECT curriculum_id FROM teacher_lesson_plans WHERE site_user_id = ?',
        [siteUser.id]
      );
      if (selRows.length > 0) {
        const ids = selRows.map(r => r.curriculum_id);
        [rows] = await pool.query(
          `SELECT * FROM curricula WHERE published = 1 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY sort_order ASC, created_at DESC`,
          ids
        );
      }
    }
    if (!rows) {
      [rows] = await pool.query('SELECT * FROM curricula WHERE published = 1 ORDER BY sort_order ASC, created_at DESC');
    }
  }
  const curricula = (await attachChildren(rows)).map(serialize);
  res.json({ curricula: await gateAccess(curricula, req) });
});

router.get('/downloads', requireAuth, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset   = (page - 1) * limit;
    const rawQ     = (req.query.q || '').trim();
    const userType = req.query.userType || 'teacher';

    let whereSQL    = "WHERE cd.user_type = ?";
    let whereParams = [userType];

    if (rawQ) {
      const pat = toSqlLike(rawQ);
      whereSQL += ` AND (
        cd.user_email LIKE ? OR
        su.first_name LIKE ? OR
        su.last_name  LIKE ? OR
        CONCAT(COALESCE(su.first_name,''), ' ', COALESCE(su.last_name,'')) LIKE ? OR
        nc.company    LIKE ? OR
        c.title       LIKE ? OR
        c.series      LIKE ?
      )`;
      whereParams.push(...Array(7).fill(pat));
    }

    const joinSQL = `
      FROM curriculum_downloads cd
      LEFT JOIN curricula c            ON c.id    = cd.curriculum_id
      LEFT JOIN site_users su          ON su.email = cd.user_email
      LEFT JOIN newsletter_contacts nc ON nc.email = cd.user_email
    `;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM (SELECT 1 ${joinSQL} ${whereSQL} GROUP BY cd.curriculum_id, cd.user_email, cd.user_type, cd.resource_type) _cnt`,
      whereParams
    );

    const [rows] = await pool.query(`
      SELECT
        cd.curriculum_id                               AS curriculumId,
        cd.user_email                                  AS userEmail,
        cd.user_type                                   AS userType,
        cd.resource_type                               AS resourceType,
        cd.count,
        cd.last_download                               AS lastDownload,
        su.first_name                                  AS firstName,
        su.last_name                                   AS lastName,
        c.title                                        AS curriculumTitle,
        c.series,
        COALESCE(nc.company, MAX(p.school_domain), '') AS school
      ${joinSQL}
      LEFT JOIN license_seats ls ON ls.registered_site_user_id = su.id
      LEFT JOIN purchases p      ON p.id = ls.purchase_id
      ${whereSQL}
      GROUP BY cd.curriculum_id, cd.user_email, cd.user_type, cd.resource_type, cd.count, cd.last_download,
               su.first_name, su.last_name, c.title, c.series, nc.company
      ORDER BY cd.last_download DESC
      LIMIT ? OFFSET ?
    `, [...whereParams, limit, offset]);

    res.json({ downloads: rows, total, page, pages: Math.ceil(total / limit) || 1, limit });
  } catch (err) {
    console.error('GET /downloads error:', err.message);
    res.status(500).json({ error: 'Could not load downloads.' });
  }
});

router.post('/import-quiz', requireAuth, quizUpload.single('quiz'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!req.file.originalname.toLowerCase().endsWith('.docx')) {
    return res.status(400).json({ error: 'File must be a .docx document.' });
  }
  let parsed;
  try {
    parsed = parseQuizDocx(req.file.buffer);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  const { curriculumTitle, questions } = parsed;

  function normalizeTitle(str) {
    return str.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  let [rows] = await pool.query('SELECT id, title FROM curricula WHERE title = ? LIMIT 1', [curriculumTitle]);
  if (!rows.length) {
    const [all] = await pool.query('SELECT id, title FROM curricula ORDER BY title');
    const needle = normalizeTitle(curriculumTitle);
    const fuzzy = all.filter(r => normalizeTitle(r.title) === needle);
    if (fuzzy.length === 1) {
      rows = fuzzy;
    } else {
      return res.status(404).json({
        error: `No curriculum found matching "${curriculumTitle}".`,
        available: all.map(r => r.title),
      });
    }
  }
  const curriculumId = rows[0].id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM curriculum_quiz_questions WHERE curriculum_id = ?', [curriculumId]);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const [qRes] = await connection.query(
        'INSERT INTO curriculum_quiz_questions (curriculum_id, question, correct_index, sort_order) VALUES (?, ?, ?, ?)',
        [curriculumId, q.question, q.correctIndex, i]
      );
      for (let oi = 0; oi < q.options.length; oi++) {
        await connection.query(
          'INSERT INTO curriculum_quiz_options (question_id, option_text, sort_order) VALUES (?, ?, ?)',
          [qRes.insertId, q.options[oi], oi]
        );
      }
    }
    await connection.commit();
    res.json({ ok: true, curriculumTitle, curriculumId, questionsInserted: questions.length });
  } catch (err) {
    await connection.rollback();
    console.error('import-quiz error:', err.message);
    res.status(500).json({ error: 'Database error during import.' });
  } finally {
    connection.release();
  }
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM curricula WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Curriculum not found' });
  const [curriculum] = await attachChildren(rows);
  const [gated] = await gateAccess([serialize(curriculum)], req);
  res.json({ curriculum: gated });
});

// File serving access rules:
//   Student Handout  — anyone can view; download requires teacher license or parent access
//   Classroom Poster — anyone can view; download requires teacher license or parent access
//   Teacher Copy     — requires teacher license or parent access (view + download)
//   Quiz + Answer Key — requires teacher license only (no parent access)
//   Lesson plan docs (?doc=) — requires teacher license only (no parent access)
// ?resource=<type>  curriculum_resources file
// ?doc=<index>      curriculum_documents file
// &download=1       attachment mode — checked and tracked for licensed teachers and parents
const PARENT_ACCESSIBLE_RESOURCES = ['Teacher Copy', 'Student Handout', 'Classroom Poster'];

router.get('/:id/file', async (req, res) => {
  const id = req.params.id;
  const resourceType = req.query.resource;
  const docIndex = req.query.doc !== undefined ? parseInt(req.query.doc, 10) : null;
  const forceDownload = req.query.download === '1';

  if (!resourceType && docIndex === null) {
    return res.status(400).json({ error: 'resource or doc query param required' });
  }

  const isAdmin = !!getAuthUser(req);
  const siteUser = isAdmin ? null : await getSiteUser(req);
  const licensed = isAdmin || !!(siteUser && await hasActiveLicense(siteUser.id));

  const isParent = !isAdmin && !!(siteUser && siteUser.role === 'parent');
  const parentCanView = isParent && resourceType && PARENT_ACCESSIBLE_RESOURCES.includes(resourceType)
    && await hasParentAccessToCurriculum(siteUser.id, id);

  let file_path, file_name;

  if (docIndex !== null) {
    // Lesson plan documents — teacher license only, no parent access
    if (!licensed) {
      return siteUser
        ? res.status(403).json({ error: 'A teacher license is required to access lesson plan documents' })
        : res.status(401).json({ error: 'Sign in to access this file' });
    }
    let docRows = [];
    try {
      [docRows] = await pool.query(
        'SELECT file_path, file_name FROM curriculum_documents WHERE curriculum_id = ? ORDER BY sort_order',
        [id]
      );
    } catch (_) {}
    const doc = docRows[docIndex];
    if (!doc || !doc.file_path) return res.status(404).json({ error: 'Document not found' });
    file_path = doc.file_path;
    file_name = doc.file_name;
  } else {
    const PUBLIC_VIEW_RESOURCES = ['Student Handout', 'Classroom Poster'];

    // Quiz + Answer Key and non-public resources require teacher license to view (not parents)
    if (!licensed && (resourceType === 'Quiz + Answer Key' || !PUBLIC_VIEW_RESOURCES.includes(resourceType))) {
      if (!parentCanView) {
        return siteUser
          ? res.status(403).json({ error: 'A teacher license is required to access this resource' })
          : res.status(401).json({ error: 'Sign in to access this resource' });
      }
    }

    // Public resources: downloading requires teacher license or parent access
    if (forceDownload && !licensed && !parentCanView) {
      return siteUser
        ? res.status(403).json({ error: 'A teacher license is required to download files' })
        : res.status(401).json({ error: 'Sign in to download files' });
    }

    const [rows] = await pool.query(
      'SELECT file_path, file_name, download_limit FROM curriculum_resources WHERE curriculum_id = ? AND resource = ?',
      [id, resourceType]
    );
    if (!rows[0] || !rows[0].file_path) return res.status(404).json({ error: 'File not found' });
    file_path = rows[0].file_path;
    file_name = rows[0].file_name;

    // Per-resource download limit check (teachers and parents)
    if (forceDownload && !isAdmin && siteUser && (licensed || parentCanView)) {
      const resourceLimit = rows[0].download_limit || 0;
      if (resourceLimit > 0) {
        const userType = isParent ? 'parent' : 'teacher';
        const [existing] = await pool.query(
          'SELECT count FROM curriculum_downloads WHERE curriculum_id = ? AND user_email = ? AND user_type = ? AND resource_type = ?',
          [id, siteUser.email, userType, resourceType]
        );
        const currentCount = existing[0] ? existing[0].count : 0;
        if (currentCount >= resourceLimit) {
          return res.status(429).json({ error: 'Download limit reached', count: currentCount, limit: resourceLimit });
        }
      }
    }
  }

  // Record explicit downloads for teachers and parents
  if (forceDownload && !isAdmin && siteUser && (licensed || parentCanView)) {
    const userType = isParent ? 'parent' : 'teacher';
    const resolvedResourceType = resourceType || 'lesson_plan_doc';
    try {
      await pool.query(
        `INSERT INTO curriculum_downloads (curriculum_id, user_email, user_type, resource_type, count, last_download)
         VALUES (?, ?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE count = count + 1, last_download = NOW()`,
        [id, siteUser.email, userType, resolvedResourceType]
      );
    } catch (err) {
      console.error('curriculum_downloads insert error:', err.message);
    }
  }

  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  const filename = path.basename(file_path);
  const absolutePath = path.join(uploadsDir, filename);

  res.setHeader('Content-Disposition',
    `${forceDownload ? 'attachment' : 'inline'}; filename="${file_name || filename}"`);
  res.sendFile(absolutePath, { dotfiles: 'deny' }, function(err) {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found on disk' });
  });
});

router.put('/reorder', requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (let i = 0; i < ids.length; i++) {
      await connection.query('UPDATE curricula SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
    }
    await connection.commit();
    res.json({ ok: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

async function replaceChildren(connection, id, c) {
  await connection.query('DELETE FROM curriculum_audiences WHERE curriculum_id = ?', [id]);
  await connection.query('DELETE FROM curriculum_objectives WHERE curriculum_id = ?', [id]);
  await connection.query('DELETE FROM curriculum_materials WHERE curriculum_id = ?', [id]);
  await connection.query('DELETE FROM curriculum_resources WHERE curriculum_id = ?', [id]);
  await connection.query('DELETE FROM curriculum_videos WHERE curriculum_id = ?', [id]);
  await connection.query(
    'DELETE FROM curriculum_quiz_questions WHERE curriculum_id = ?',
    [id]
  ); // cascades to curriculum_quiz_options via FK

  const audiences = Array.isArray(c.audiences) ? c.audiences : [];
  if (audiences.length) {
    await connection.query('INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES ' + audiences.map(() => '(?, ?)').join(', '), audiences.flatMap(a => [id, a]));
  }

  const objectives = Array.isArray(c.objectives) ? c.objectives : [];
  for (let i = 0; i < objectives.length; i++) {
    await connection.query('INSERT INTO curriculum_objectives (curriculum_id, objective, sort_order) VALUES (?, ?, ?)', [id, objectives[i], i]);
  }

  const materials = Array.isArray(c.materials) ? c.materials : [];
  for (let i = 0; i < materials.length; i++) {
    await connection.query('INSERT INTO curriculum_materials (curriculum_id, material, sort_order) VALUES (?, ?, ?)', [id, materials[i], i]);
  }

  const resources = Array.isArray(c.resources) ? c.resources : [];
  if (resources.length) {
    await connection.query(
      'INSERT INTO curriculum_resources (curriculum_id, resource, file_path, file_name, download_limit) VALUES ' + resources.map(() => '(?, ?, ?, ?, ?)').join(', '),
      resources.flatMap(r => [id, r.resource, r.filePath || null, r.fileName || null, r.downloadLimit || 0])
    );
  }

  const videos = Array.isArray(c.videos) ? c.videos : [];
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    await connection.query(
      'INSERT INTO curriculum_videos (curriculum_id, name, url, size_label, sort_order) VALUES (?, ?, ?, ?, ?)',
      [id, v.name || '', v.url || '', v.sizeLabel || '', i]
    );
  }

  const quiz = Array.isArray(c.quiz) ? c.quiz : [];
  for (let i = 0; i < quiz.length; i++) {
    const q = quiz[i];
    const [qResult] = await connection.query(
      'INSERT INTO curriculum_quiz_questions (curriculum_id, question, correct_index, sort_order) VALUES (?, ?, ?, ?)',
      [id, q.question || '', q.correctIndex || 0, i]
    );
    const options = Array.isArray(q.options) ? q.options : [];
    for (let oi = 0; oi < options.length; oi++) {
      await connection.query(
        'INSERT INTO curriculum_quiz_options (question_id, option_text, sort_order) VALUES (?, ?, ?)',
        [qResult.insertId, options[oi] || '', oi]
      );
    }
  }

  try {
    await connection.query('DELETE FROM curriculum_documents WHERE curriculum_id = ?', [id]);
    const documents = Array.isArray(c.documents) ? c.documents.slice(0, 5) : [];
    for (let i = 0; i < documents.length; i++) {
      const d = documents[i];
      if (d.filePath) {
        await connection.query(
          'INSERT INTO curriculum_documents (curriculum_id, file_path, file_name, sort_order) VALUES (?, ?, ?, ?)',
          [id, d.filePath, d.fileName || '', i]
        );
      }
    }
  } catch (_) { /* curriculum_documents table may not exist yet — migration pending */ }
}

router.post('/', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.title || !Array.isArray(c.audiences) || c.audiences.length === 0) {
    return res.status(400).json({ error: 'Title and at least one audience are required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO curricula (title, series, short_description, overview, lessons_count, weeks_count, download_limit, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.title, c.series || '', c.shortDescription || '', c.overview || '', c.lessonsCount || null, c.weeksCount || null, c.downloadLimit || 0, c.published ? 1 : 0]
    );
    await replaceChildren(connection, result.insertId, c);
    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM curricula WHERE id = ?', [result.insertId]);
    const [curriculum] = await attachChildren(rows);
    res.status(201).json({ curriculum: serialize(curriculum) });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.title || !Array.isArray(c.audiences) || c.audiences.length === 0) {
    return res.status(400).json({ error: 'Title and at least one audience are required' });
  }

  const [existing] = await pool.query('SELECT id FROM curricula WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Curriculum not found' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE curricula SET title=?, series=?, short_description=?, overview=?, lessons_count=?, weeks_count=?, download_limit=?, published=?
       WHERE id=?`,
      [c.title, c.series || '', c.shortDescription || '', c.overview || '', c.lessonsCount || null, c.weeksCount || null, c.downloadLimit || 0, c.published ? 1 : 0, req.params.id]
    );
    await replaceChildren(connection, req.params.id, c);
    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM curricula WHERE id = ?', [req.params.id]);
    const [curriculum] = await attachChildren(rows);
    res.json({ curriculum: serialize(curriculum) });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM curricula WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Curriculum not found' });
  res.json({ ok: true });
});

// --- Download-limit simulator ---

router.get('/:id/downloads', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        cd.user_email,
        cd.user_type,
        cd.resource_type,
        cd.count,
        cd.last_download,
        su.first_name,
        su.last_name,
        nc.company           AS school_company,
        MAX(p.school_domain) AS school_domain
      FROM curriculum_downloads cd
      LEFT JOIN site_users su          ON su.email = cd.user_email
      LEFT JOIN newsletter_contacts nc ON nc.email = cd.user_email
      LEFT JOIN license_seats ls       ON ls.registered_site_user_id = su.id
      LEFT JOIN purchases p            ON p.id = ls.purchase_id
      WHERE cd.curriculum_id = ?
      GROUP BY cd.id, cd.user_email, cd.user_type, cd.resource_type, cd.count, cd.last_download,
               su.first_name, su.last_name, nc.company
      ORDER BY cd.last_download DESC
    `, [req.params.id]);
    res.json({
      downloads: rows.map(r => ({
        userEmail:    r.user_email,
        userType:     r.user_type,
        resourceType: r.resource_type,
        firstName:    r.first_name  || '',
        lastName:     r.last_name   || '',
        school:       r.school_company || r.school_domain || '',
        count:        r.count,
        lastDownload: r.last_download,
      })),
    });
  } catch (err) {
    console.error('/:id/downloads error:', err.message);
    res.status(500).json({ error: 'Could not load download records.' });
  }
});

router.post('/:id/downloads', requireAuth, async (req, res) => {
  const userEmail    = ((req.body && req.body.userEmail) || '').trim().toLowerCase();
  const userType     = (req.body && req.body.userType) || 'teacher';
  const resourceType = (req.body && req.body.resourceType) || 'any';
  if (!userEmail) return res.status(400).json({ error: 'userEmail is required' });

  // Look up limit for the specific resource (if a named resource)
  let limit = 0;
  if (resourceType && resourceType !== 'any' && resourceType !== 'lesson_plan_doc') {
    const [resRows] = await pool.query(
      'SELECT download_limit FROM curriculum_resources WHERE curriculum_id = ? AND resource = ?',
      [req.params.id, resourceType]
    );
    limit = resRows[0] ? (resRows[0].download_limit || 0) : 0;
  }

  const [existingRows] = await pool.query(
    'SELECT count FROM curriculum_downloads WHERE curriculum_id = ? AND user_email = ? AND user_type = ? AND resource_type = ?',
    [req.params.id, userEmail, userType, resourceType]
  );
  const currentCount = existingRows[0] ? existingRows[0].count : 0;

  if (limit > 0 && currentCount >= limit) {
    return res.json({ ok: false, reason: 'limit_reached', count: currentCount, limit });
  }

  const newCount = currentCount + 1;
  await pool.query(
    `INSERT INTO curriculum_downloads (curriculum_id, user_email, user_type, resource_type, count, last_download)
     VALUES (?, ?, ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE count = ?, last_download = NOW()`,
    [req.params.id, userEmail, userType, resourceType, newCount]
  );
  res.json({ ok: true, count: newCount, limit });
});

router.put('/:id/downloads', requireAuth, async (req, res) => {
  const { userEmail, userType, resourceType, count } = req.body || {};
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });
  const newCount = parseInt(count, 10);
  if (isNaN(newCount) || newCount < 0) return res.status(400).json({ error: 'count must be a non-negative integer' });
  const email    = userEmail.trim().toLowerCase();
  const uType    = userType || 'teacher';
  const rType    = resourceType || 'any';
  await pool.query(
    `INSERT INTO curriculum_downloads (curriculum_id, user_email, user_type, resource_type, count, last_download)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE count = ?`,
    [req.params.id, email, uType, rType, newCount, newCount]
  );
  res.json({ ok: true, count: newCount });
});

router.delete('/:id/downloads', requireAuth, async (req, res) => {
  const { userEmail, userType, resourceType } = req.query;
  if (userEmail) {
    const uType = userType || 'teacher';
    const rType = resourceType || null;
    if (rType) {
      await pool.query(
        'DELETE FROM curriculum_downloads WHERE curriculum_id = ? AND user_email = ? AND user_type = ? AND resource_type = ?',
        [req.params.id, userEmail.trim().toLowerCase(), uType, rType]
      );
    } else {
      await pool.query(
        'DELETE FROM curriculum_downloads WHERE curriculum_id = ? AND user_email = ? AND user_type = ?',
        [req.params.id, userEmail.trim().toLowerCase(), uType]
      );
    }
  } else {
    await pool.query('DELETE FROM curriculum_downloads WHERE curriculum_id = ?', [req.params.id]);
  }
  res.json({ ok: true });
});

module.exports = router;
