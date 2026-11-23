// Sales CRM notes: what staff learned or did, written on a deal, an account or a contact (mounted at /api/crm/notes).
// Anyone with a CRM role can read them (they feed the timeline). Writing follows the phase 3 matrix: Read-only never; Sales on deals they can edit and on any
// account or contact; a note is edited or deleted only by the person who wrote it (or a CRM Admin). Notes are staff-typed text, shown through esc() on the page.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { text, oneOf, paging } = require('../lib/crm-common');
const S = require('../lib/crm-subjects');
const CH = require('../lib/crm-contact-history'); // G16: a logged call, email or meeting marks the person as contacted

const router = express.Router();
const KINDS = ['note', 'call', 'email', 'meeting'];
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
// How long a note may be: 10000 characters, doubled from 5000 on 2026-11-23. The body columns are TEXT (about 65,000 bytes), so nothing in the database changes. Keep the two page inputs in crm-panels.js the same.
const MAX_BODY = 10000;

const NOTE_SELECT = `SELECT n.*, ${S.SUBJECT_COLS}, au.username AS author_name
  FROM crm_notes n ${S.SUBJECT_JOIN('n')} LEFT JOIN admin_users au ON au.id = n.created_by_admin_id`;

function noteView(n, req) {
  const mine = Number(n.created_by_admin_id) === Number(req.crm.adminId);
  const writable = S.canWriteRow(req, n);
  return {
    id: n.id, kind: n.kind, body: n.body, authorName: n.author_name || null, createdAt: n.created_at, updatedAt: n.updated_at,
    // G14: a note that was changed after it was written says so to everyone with access; the earlier text is for a CRM Admin only (GET /:id/history).
    editedAt: n.edited_at || null, canSeeHistory: !!n.edited_at && req.crm.role === 'admin',
    subject: S.subjectView(n),
    // Admin may change any note; Sales only their own, and only where they can still write the subject.
    canEdit: writable && (req.crm.role === 'admin' || mine),
  };
}

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const f = S.listFilter(req.query, 'n');
  if (f.error) return res.status(400).json({ error: f.error });
  const { page, size, offset } = paging(req.query, { defaultSize: 25, maxSize: 100 });
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM crm_notes n WHERE ${f.where}`, f.params);
  const [rows] = await pool.query(`${NOTE_SELECT} WHERE ${f.where} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`, [...f.params, size, offset]);
  res.json({ notes: rows.map(n => noteView(n, req)), total: Number(total), page, pageSize: size });
});

router.post('/', requireAuth, requireCrm('write'), async (req, res) => {
  const b = req.body || {};
  const r = await S.resolveSubject(b);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!S.canWriteResolved(req, r.subject)) return res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
  const body = text(b.body, MAX_BODY);
  if (!body) return res.status(400).json({ error: 'Write the note first.' });
  const kind = b.kind === undefined ? 'note' : oneOf(b.kind, KINDS);
  if (!kind) return res.status(400).json({ error: `The kind must be one of: ${KINDS.join(', ')}.` });
  const c = r.subject.cols;
  const [ins] = await pool.query('INSERT INTO crm_notes (opportunity_id, account_id, contact_id, kind, body, created_by_admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [c.opportunity_id, c.account_id, c.contact_id, kind, body, req.crm.adminId, sqlNow()]);
  // The audit row says a note was added to a subject, never what it said: notes can hold things staff would not want copied into a second log.
  await CH.touchForNote(pool, r.subject, kind, sqlNow());
  await crmAudit(req, { action: 'crm_note_created', entityType: 'crm_note', entityId: ins.insertId, next: { subject: r.subject.kind, subjectId: r.subject.id, kind } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

async function loadForChange(req, res) {
  const n = await S.loadItem('crm_notes', req.params.id);
  if (!n) { res.status(404).json({ error: 'Note not found' }); return null; }
  const mine = Number(n.created_by_admin_id) === Number(req.crm.adminId);
  if (!S.canWriteRow(req, n) || (req.crm.role !== 'admin' && !mine)) {
    res.status(403).json({ code: 'not_your_note', error: 'Only the person who wrote a note, or a CRM Admin, can change it.' });
    return null;
  }
  return n;
}

router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const n = await loadForChange(req, res);
  if (!n) return;
  const b = req.body || {};
  const f = {};
  if (b.body !== undefined) { f.body = text(b.body, MAX_BODY); if (!f.body) return res.status(400).json({ error: 'A note cannot be empty. Delete it instead.' }); }
  if (b.kind !== undefined) { f.kind = oneOf(b.kind, KINDS); if (!f.kind) return res.status(400).json({ error: `The kind must be one of: ${KINDS.join(', ')}.` }); }
  const cols = Object.keys(f);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  // G14: when the words or the kind change, the text it had before is kept (crm_note_versions), and the note says it was edited. A database without the history table yet just saves.
  const textChanged = (f.body !== undefined && f.body !== n.body) || (f.kind !== undefined && f.kind !== n.kind);
  const now = sqlNow();
  let kept = false;
  if (textChanged) {
    try {
      await pool.query('INSERT INTO crm_note_versions (note_id, body, kind, changed_by_admin_id, created_at) VALUES (?, ?, ?, ?, ?)', [n.id, n.body, n.kind, req.crm.adminId, now]);
      kept = true;
    } catch (err) { if (!isMissing(err)) throw err; }
  }
  const sets = [...cols.map(k => `${k} = ?`), 'updated_at = ?'], vals = [...cols.map(k => f[k]), now];
  if (kept) { sets.push('edited_at = ?', 'edited_by_admin_id = ?'); vals.push(now, req.crm.adminId); }
  await pool.query(`UPDATE crm_notes SET ${sets.join(', ')} WHERE id = ?`, [...vals, n.id]);
  await crmAudit(req, { action: 'crm_note_updated', entityType: 'crm_note', entityId: n.id });
  res.json({ ok: true });
});

// G14: the earlier versions of a note, newest first. CRM Admin only (the same action as the audit log); the text of an old version is the note's own words, so it is never put
// in the audit row. Declared before the routes that change a note.
router.get('/:id/history', requireAuth, requireCrm('audit_view'), async (req, res) => {
  const n = await S.loadItem('crm_notes', req.params.id);
  if (!n) return res.status(404).json({ error: 'Note not found' });
  let rows = [];
  try { [rows] = await pool.query('SELECT v.id, v.body, v.kind, v.created_at, au.username AS changed_by FROM crm_note_versions v LEFT JOIN admin_users au ON au.id = v.changed_by_admin_id WHERE v.note_id = ? ORDER BY v.id DESC LIMIT 100', [n.id]); }
  catch (err) { if (!isMissing(err)) throw err; }
  await crmAudit(req, { action: 'crm_note_history_viewed', entityType: 'crm_note', entityId: n.id, next: { versions: rows.length } });
  res.json({ current: { body: n.body, kind: n.kind, editedAt: n.edited_at || null }, versions: rows.map(v => ({ id: v.id, body: v.body, kind: v.kind, changedBy: v.changed_by || null, at: v.created_at })) });
});

router.delete('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const n = await loadForChange(req, res);
  if (!n) return;
  try { await pool.query('DELETE FROM crm_note_versions WHERE note_id = ?', [n.id]); } catch (err) { if (!isMissing(err)) throw err; } // a note's earlier versions go with it
  await pool.query('DELETE FROM crm_notes WHERE id = ?', [n.id]);
  await crmAudit(req, { action: 'crm_note_deleted', entityType: 'crm_note', entityId: n.id });
  res.json({ ok: true });
});

module.exports = router;
