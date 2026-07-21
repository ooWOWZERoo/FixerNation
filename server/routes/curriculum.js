const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');
const { getSiteUser, hasActiveLicense } = require('../lib/access');

const router = express.Router();

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
  const [resourceRows] = await pool.query('SELECT curriculum_id, resource, file_path, file_name FROM curriculum_resources WHERE curriculum_id IN (?)', [ids]);
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
    resources: (resourcesByC[c.id] || []).map(r => ({ resource: r.resource, filePath: r.file_path || '', fileName: r.file_name || '' })),
    videos: (videosByC[c.id] || []).map(r => ({ name: r.name, url: r.url, sizeLabel: r.size_label })),
    documents: (documentsByC[c.id] || []).map(r => ({ filePath: r.file_path, fileName: r.file_name })),
    quiz: (questionsByC[c.id] || []).map(q => ({
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
  const wantsAll = req.query.all === 'true' && !!getAuthUser(req);
  const [rows] = wantsAll
    ? await pool.query('SELECT * FROM curricula ORDER BY sort_order ASC, created_at DESC')
    : await pool.query('SELECT * FROM curricula WHERE published = 1 ORDER BY sort_order ASC, created_at DESC');
  const curricula = (await attachChildren(rows)).map(serialize);
  res.json({ curricula: await gateAccess(curricula, req) });
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM curricula WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Curriculum not found' });
  const [curriculum] = await attachChildren(rows);
  const [gated] = await gateAccess([serialize(curriculum)], req);
  res.json({ curriculum: gated });
});

// File serving access rules:
//   Student Handout  — anyone can view; download requires a teacher license
//   Classroom Poster — anyone can view; download requires a teacher license
//   Teacher Copy     — requires teacher license for view AND download
//   Quiz + Answer Key — requires teacher license for view AND download
//   Lesson plan docs (?doc=) — requires teacher license for view AND download
// ?resource=<type>  curriculum_resources file
// ?doc=<index>      curriculum_documents file
// &download=1       attachment mode — checked and tracked for licensed teachers
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

  let file_path, file_name;

  if (docIndex !== null) {
    // Lesson plan documents — always require teacher license
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
    // Public-viewable resources — anyone can open these in the modal viewer
    const PUBLIC_VIEW_RESOURCES = ['Student Handout', 'Classroom Poster'];

    // Quiz + Answer Key and all non-public resources require teacher license even to view
    if (!licensed && (resourceType === 'Quiz + Answer Key' || !PUBLIC_VIEW_RESOURCES.includes(resourceType))) {
      return siteUser
        ? res.status(403).json({ error: 'A teacher license is required to access this resource' })
        : res.status(401).json({ error: 'Sign in to access this resource' });
    }

    // Student Handout / Classroom Poster: downloading still requires a teacher license
    if (forceDownload && !licensed) {
      return siteUser
        ? res.status(403).json({ error: 'A teacher license is required to download files' })
        : res.status(401).json({ error: 'Sign in to download files' });
    }

    const [rows] = await pool.query(
      'SELECT file_path, file_name FROM curriculum_resources WHERE curriculum_id = ? AND resource = ?',
      [id, resourceType]
    );
    if (!rows[0] || !rows[0].file_path) return res.status(404).json({ error: 'File not found' });
    file_path = rows[0].file_path;
    file_name = rows[0].file_name;
  }

  // Licensed teachers on an explicit download: check limit and record
  if (forceDownload && licensed && !isAdmin && siteUser) {
    const [curRows] = await pool.query('SELECT download_limit FROM curricula WHERE id = ?', [id]);
    const limit = curRows[0] ? (curRows[0].download_limit || 0) : 0;

    if (limit > 0) {
      const [existing] = await pool.query(
        'SELECT count FROM curriculum_downloads WHERE curriculum_id = ? AND teacher_email = ?',
        [id, siteUser.email]
      );
      const currentCount = existing[0] ? existing[0].count : 0;
      if (currentCount >= limit) {
        return res.status(429).json({ error: 'Download limit reached', count: currentCount, limit });
      }
    }

    await pool.query(
      `INSERT INTO curriculum_downloads (curriculum_id, teacher_email, count, last_download)
       VALUES (?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE count = count + 1, last_download = NOW()`,
      [id, siteUser.email]
    );
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
      'INSERT INTO curriculum_resources (curriculum_id, resource, file_path, file_name) VALUES ' + resources.map(() => '(?, ?, ?, ?)').join(', '),
      resources.flatMap(r => [id, r.resource, r.filePath || null, r.fileName || null])
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
  const [rows] = await pool.query('SELECT teacher_email, count, last_download FROM curriculum_downloads WHERE curriculum_id = ?', [req.params.id]);
  res.json({ downloads: rows.map(r => ({ teacherEmail: r.teacher_email, count: r.count, lastDownload: r.last_download })) });
});

router.post('/:id/downloads', requireAuth, async (req, res) => {
  const teacherEmail = (req.body && req.body.teacherEmail || '').trim().toLowerCase();
  if (!teacherEmail) return res.status(400).json({ error: 'Teacher email is required' });

  const [curriculumRows] = await pool.query('SELECT download_limit FROM curricula WHERE id = ?', [req.params.id]);
  if (!curriculumRows[0]) return res.status(404).json({ error: 'Curriculum not found' });
  const limit = curriculumRows[0].download_limit || 0;

  const [existingRows] = await pool.query('SELECT count FROM curriculum_downloads WHERE curriculum_id = ? AND teacher_email = ?', [req.params.id, teacherEmail]);
  const currentCount = existingRows[0] ? existingRows[0].count : 0;

  if (limit > 0 && currentCount >= limit) {
    return res.json({ ok: false, reason: 'limit_reached', count: currentCount, limit });
  }

  const newCount = currentCount + 1;
  await pool.query(
    `INSERT INTO curriculum_downloads (curriculum_id, teacher_email, count, last_download) VALUES (?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE count = ?, last_download = NOW()`,
    [req.params.id, teacherEmail, newCount]
  );
  res.json({ ok: true, count: newCount, limit });
});

router.delete('/:id/downloads', requireAuth, async (req, res) => {
  if (req.query.teacherEmail) {
    await pool.query('DELETE FROM curriculum_downloads WHERE curriculum_id = ? AND teacher_email = ?', [req.params.id, req.query.teacherEmail.trim().toLowerCase()]);
  } else {
    await pool.query('DELETE FROM curriculum_downloads WHERE curriculum_id = ?', [req.params.id]);
  }
  res.json({ ok: true });
});

module.exports = router;
