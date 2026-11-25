// The Help center's edited answers, public side (docs/reference/help-support-tools-requirements.md, section A).
//
//   GET /api/help-center   { entries: [published answers staff changed or added], hidden: [ids of answers staff un-published or deleted] }
//
// The page applies this on top of the list in help-center.js (FNHelpCenter.apply). Drafts and deleted rows are never sent: only the id of
// one that overrides a file answer, so the page can hide the file's copy. No history, no author, no dates.
const express = require('express');
const pool = require('../db/pool');
const { toEntry } = require('../lib/help-answers');

const router = express.Router();

router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, status, audiences, topic, help_topic, video, question, answer, steps FROM help_answers ORDER BY sort_order, created_at, id`);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    entries: rows.filter(r => r.status === 'published').map(toEntry),
    hidden: rows.filter(r => r.status !== 'published').map(r => r.id),
  });
});

module.exports = router;
