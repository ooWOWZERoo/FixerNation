'use strict';
// Usage: node scripts/import-quiz-from-docx.js /path/to/file.docx
// Reads CURRICULUM: title + Q/A/ANSWER blocks, inserts into curriculum_quiz_questions.
// Idempotent — clears existing questions for the matched curriculum before inserting.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const pool = require('../db/pool');

const docxPath = process.argv[2];
if (!docxPath) {
  console.error('Usage: node scripts/import-quiz-from-docx.js /path/to/file.docx');
  process.exit(1);
}
if (!fs.existsSync(docxPath)) {
  console.error(`File not found: ${docxPath}`);
  process.exit(1);
}

// ── Extract plain text from .docx ──────────────────────────────────────────
function extractText(filePath) {
  const AdmZip = (() => {
    try { return require('adm-zip'); } catch { return null; }
  })();

  if (AdmZip) {
    const zip  = new AdmZip(filePath);
    const xml  = zip.readAsText('word/document.xml');
    return xml.replace(/<w:br[^/]*/g, '\n')
              .replace(/<\/w:p>/g, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x2013;/g, '–').replace(/&#x2014;/g, '—');
  }

  // Fallback: unzip via child_process
  const { execSync } = require('child_process');
  try {
    const xml = execSync(`unzip -p "${filePath}" word/document.xml`, { encoding: 'utf8' });
    return xml.replace(/<w:br[^/]*/g, '\n')
              .replace(/<\/w:p>/g, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x2013;/g, '–').replace(/&#x2014;/g, '—');
  } catch (e) {
    console.error('Could not read .docx file. Make sure the file is a valid .docx.');
    console.error(e.message);
    process.exit(1);
  }
}

// ── Parse questions from plain text ────────────────────────────────────────
function parse(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let curriculumTitle = null;
  const questions = [];
  let current = null;

  for (const line of lines) {
    // CURRICULUM: Some Title Here
    const cm = line.match(/^CURRICULUM\s*:\s*(.+)$/i);
    if (cm) { curriculumTitle = cm[1].trim(); continue; }

    // Q1. Question text  OR  Q1) Question text
    const qm = line.match(/^Q\s*(\d+)\s*[.)]\s*(.+)$/i);
    if (qm) {
      if (current) questions.push(current);
      current = { question: qm[2].trim(), options: [], correctIndex: null };
      continue;
    }

    // A. Option text  (only inside a question block)
    const om = line.match(/^([A-D])\s*[.)]\s*(.+)$/i);
    if (om && current) {
      current.options.push({ letter: om[1].toUpperCase(), text: om[2].trim() });
      continue;
    }

    // ANSWER: B
    const am = line.match(/^ANSWER\s*:\s*([A-D])\b/i);
    if (am && current) {
      const letter = am[1].toUpperCase();
      const idx = ['A','B','C','D'].indexOf(letter);
      if (idx === -1) {
        console.error(`Invalid ANSWER letter "${letter}" for question: ${current.question}`);
        process.exit(1);
      }
      current.correctIndex = idx;
      continue;
    }
  }
  if (current) questions.push(current);

  return { curriculumTitle, questions };
}

// ── Validate ────────────────────────────────────────────────────────────────
function validate({ curriculumTitle, questions }) {
  if (!curriculumTitle) {
    console.error('No CURRICULUM: line found in document. Add one at the top.');
    process.exit(1);
  }
  if (!questions.length) {
    console.error('No questions found. Check that questions start with Q1., Q2., etc.');
    process.exit(1);
  }
  questions.forEach((q, i) => {
    if (q.options.length !== 4) {
      console.error(`Q${i+1} has ${q.options.length} option(s); expected 4 (A–D).`);
      process.exit(1);
    }
    if (q.correctIndex === null) {
      console.error(`Q${i+1} is missing an ANSWER: line.`);
      process.exit(1);
    }
  });
}

// ── Insert ──────────────────────────────────────────────────────────────────
async function run() {
  const text = extractText(docxPath);
  const parsed = parse(text);
  validate(parsed);

  const { curriculumTitle, questions } = parsed;
  console.log(`Curriculum : "${curriculumTitle}"`);
  console.log(`Questions  : ${questions.length}`);

  // Strip punctuation + collapse whitespace for fuzzy title matching
  function normalizeTitle(str) {
    return str.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const connection = await pool.getConnection();
  try {
    // Pass 1: exact match
    let [rows] = await connection.query(
      'SELECT id, title FROM curricula WHERE title = ? LIMIT 1',
      [curriculumTitle]
    );

    // Pass 2: normalized match (ignores punctuation differences)
    if (!rows.length) {
      const [all] = await connection.query('SELECT id, title FROM curricula ORDER BY title');
      const needle = normalizeTitle(curriculumTitle);
      const fuzzy = all.filter(r => normalizeTitle(r.title) === needle);
      if (fuzzy.length === 1) {
        console.log(`Fuzzy match: "${curriculumTitle}" → "${fuzzy[0].title}"`);
        rows = fuzzy;
      } else if (fuzzy.length > 1) {
        console.error(`\nAmbiguous title "${curriculumTitle}" matches multiple curricula:`);
        fuzzy.forEach(r => console.log(`  id=${r.id}  "${r.title}"`));
        process.exit(1);
      } else {
        console.error(`\nNo curriculum found with title "${curriculumTitle}".`);
        console.error('Available curricula:');
        all.forEach(r => console.log(`  id=${r.id}  "${r.title}"`));
        process.exit(1);
      }
    }

    const curriculumId = rows[0].id;
    console.log(`Matched    : id=${curriculumId}\n`);

    await connection.beginTransaction();

    const [del] = await connection.query(
      'DELETE FROM curriculum_quiz_questions WHERE curriculum_id = ?',
      [curriculumId]
    );
    console.log(`Cleared ${del.affectedRows} existing question(s)`);

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const [qRes] = await connection.query(
        'INSERT INTO curriculum_quiz_questions (curriculum_id, question, correct_index, sort_order) VALUES (?, ?, ?, ?)',
        [curriculumId, q.question, q.correctIndex, i]
      );
      for (let oi = 0; oi < q.options.length; oi++) {
        await connection.query(
          'INSERT INTO curriculum_quiz_options (question_id, option_text, sort_order) VALUES (?, ?, ?)',
          [qRes.insertId, q.options[oi].text, oi]
        );
      }
      const correctLetter = ['A','B','C','D'][q.correctIndex];
      console.log(`  Q${i+1} inserted (answer: ${correctLetter}) — ${q.question.slice(0, 60)}${q.question.length > 60 ? '…' : ''}`);
    }

    await connection.commit();
    console.log(`\nDone — ${questions.length} question(s) inserted for "${curriculumTitle}"`);
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
