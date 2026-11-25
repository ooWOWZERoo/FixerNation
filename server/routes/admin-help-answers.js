// Help center answers, the staff side (Support > Help Content). Requirements and access matrix:
// docs/reference/help-support-tools-requirements.md, section A.
//
//   GET    /api/admin/help-answers              every override row (published, draft and deleted), full text
//   PUT    /api/admin/help-answers/:id          save one answer (creates the row the first time); the id is never changed
//   DELETE /api/admin/help-answers/:id          revert to the original: remove the row, so the file's answer shows again
//   GET    /api/admin/help-answers/:id/versions earlier saves of one answer, newest first
//
// Every route is requireAuth (the admin account). Each save keeps the earlier version and writes the audit log by id only.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const { validId, cleanAnswer, toEntry, AUDIENCES } = require('../lib/help-answers');
const { CATEGORIES } = require('../lib/support');

const router = express.Router();
const COLUMNS = 'id, status, audiences, topic, help_topic, video, question, answer, steps, sort_order, updated_by, updated_at';

function auditHelp(req, action, id, extra = {}) {
  return audit(pool, {
    actorType: 'admin', actorId: req.user && req.user.userId, action, entityType: 'help_answer', entityId: null,
    reason: id, ipAddress: clientIp(req), ...extra,
  });
}

// GET /api/admin/help-answers
router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM help_answers ORDER BY sort_order, created_at, id`);
  res.json({
    audiences: AUDIENCES, helpTopics: Object.keys(CATEGORIES),
    answers: rows.map(r => ({ ...toEntry(r), status: r.status, updatedAt: r.updated_at })),
  });
});

// PUT /api/admin/help-answers/:id
router.put('/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!validId(id)) return res.status(400).json({ error: 'That answer id is not valid.' });
  const clean = cleanAnswer(req.body);
  if (clean.error) return res.status(400).json({ error: clean.error, errors: clean.errors });
  const v = clean.value;
  const [[existing]] = await pool.query(`SELECT ${COLUMNS} FROM help_answers WHERE id = ? LIMIT 1`, [id]);
  const adminId = req.user && req.user.userId;
  if (existing) {
    await pool.query(
      'INSERT INTO help_answer_versions (answer_id, snapshot, saved_by) VALUES (?, ?, ?)',
      [id, JSON.stringify({ ...toEntry(existing), status: existing.status }), adminId || null]);
    await pool.query(
      `UPDATE help_answers SET status = ?, audiences = ?, topic = ?, help_topic = ?, video = ?, question = ?, answer = ?, steps = ?,
              updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [v.status, v.audiences.join(','), v.topic, v.helpTopic, v.video, v.question, v.answer, JSON.stringify(v.steps), adminId || null, id]);
  } else {
    await pool.query(
      `INSERT INTO help_answers (id, status, audiences, topic, help_topic, video, question, answer, steps, sort_order, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, v.status, v.audiences.join(','), v.topic, v.helpTopic, v.video, v.question, v.answer, JSON.stringify(v.steps), 0, adminId || null]);
  }
  await auditHelp(req, existing && existing.status !== v.status ? `help_answer_${v.status}` : (existing ? 'help_answer_edited' : 'help_answer_created'), id,
    { prevValue: existing ? { status: existing.status } : null, newValue: { status: v.status } });
  res.json({ ok: true, id, warnings: clean.warnings });
});

// DELETE /api/admin/help-answers/:id  (revert to the original in help-center.js; a brand-new answer is deleted for good only through status)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!validId(id)) return res.status(400).json({ error: 'That answer id is not valid.' });
  const [[existing]] = await pool.query(`SELECT ${COLUMNS} FROM help_answers WHERE id = ? LIMIT 1`, [id]);
  if (!existing) return res.status(404).json({ error: 'Nothing to revert.' });
  await pool.query(
    'INSERT INTO help_answer_versions (answer_id, snapshot, saved_by) VALUES (?, ?, ?)',
    [id, JSON.stringify({ ...toEntry(existing), status: existing.status }), (req.user && req.user.userId) || null]);
  await pool.query('DELETE FROM help_answers WHERE id = ?', [id]);
  await auditHelp(req, 'help_answer_reverted', id, { prevValue: { status: existing.status } });
  res.json({ ok: true });
});

// GET /api/admin/help-answers/:id/versions
router.get('/:id/versions', requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!validId(id)) return res.status(400).json({ error: 'That answer id is not valid.' });
  const [rows] = await pool.query(
    `SELECT v.id, v.snapshot, v.saved_at, a.username AS saved_by_name
     FROM help_answer_versions v LEFT JOIN admin_users a ON a.id = v.saved_by
     WHERE v.answer_id = ? ORDER BY v.id DESC LIMIT 30`, [id]);
  const versions = rows.map(r => {
    let snap = {};
    try { snap = JSON.parse(r.snapshot); } catch { snap = {}; }
    return { id: r.id, savedAt: r.saved_at, savedBy: r.saved_by_name || '', entry: snap };
  });
  res.json({ versions });
});

module.exports = router;
