// Sales CRM files: documents attached to a deal, an account or a contact (mounted at /api/crm/files).
// Read-only has no access at all (files can hold POs, W-9s and contracts). CRM Admin: every file. Sales: files on deals they can edit, and on any account or
// contact. The bytes are never at a public URL: the download route below is the only way to read one. Rules and the matrix: docs/reference/sales-crm-update-requirements.md.
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { paging } = require('../lib/crm-common');
const { sniffFile } = require('../lib/upload-safety');
const F = require('../lib/crm-files');
const S = require('../lib/crm-subjects');

const router = express.Router();

// The upload lands in a temp name first; its real type is read from its bytes before anything is kept. Auth and the role check run BEFORE this, so a request
// that is not allowed never writes a byte to disk.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { F.ensureDirs(); cb(null, F.incomingDir()); } catch (e) { cb(e); } },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${require('crypto').randomBytes(6).toString('hex')}.part`),
  }),
  limits: { fileSize: F.MAX_BYTES, files: 1, fields: 8, fieldSize: 512, parts: 12 },
});
function receive(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is bigger than 15 MB.' });
    return res.status(400).json({ error: 'The upload did not work. Try again with one file.' });
  });
}
function discard(file) { if (file && file.path) { try { fs.unlinkSync(file.path); } catch { /* already gone */ } } }

const FILE_SELECT = `SELECT f.*, ${S.SUBJECT_COLS}, u.username AS uploader_name
  FROM crm_attachments f ${S.SUBJECT_JOIN('f')} LEFT JOIN admin_users u ON u.id = f.uploaded_by_admin_id`;

// May this person open or remove this file's subject? (Admin: always. Sales: deals they can edit, any account or contact.)
const mayReach = (req, row) => S.canWriteRow(req, row);

function fileView(f, req) {
  const mine = Number(f.uploaded_by_admin_id) === Number(req.crm.adminId);
  return {
    id: f.id, name: f.original_name, kind: f.kind, sizeBytes: Number(f.size_bytes), uploadedAt: f.created_at, uploadedBy: f.uploader_name || null,
    subject: S.subjectView(f),
    checklistItemId: f.checklist_item_id ? Number(f.checklist_item_id) : null, // G15: the procurement step it is attached to
    canDelete: req.crm.role === 'admin' || mine,
  };
}

// ---- List (names only; the bytes come from the download route) --------------------------------------------------------------------

router.get('/', requireAuth, requireCrm('files'), async (req, res) => {
  const f = S.listFilter(req.query, 'f');
  if (f.error) return res.status(400).json({ error: f.error });
  const { page, size, offset } = paging(req.query, { defaultSize: 25, maxSize: 100 });
  const where = [f.where];
  const params = [...f.params];
  // Sales never see the files of a deal that belongs to someone else, even inside an account's list.
  if (req.crm.role !== 'admin') { where.push('(f.opportunity_id IS NULL OR so.owner_admin_id IS NULL OR so.owner_admin_id = ?)'); params.push(req.crm.adminId); }
  const w = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM crm_attachments f LEFT JOIN crm_opportunities so ON so.id = f.opportunity_id WHERE ${w}`, params);
  const [rows] = await pool.query(`${FILE_SELECT} WHERE ${w} ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  res.json({ files: rows.map(r => fileView(r, req)), total: Number(total), page, pageSize: size, maxBytes: F.MAX_BYTES });
});

// ---- Upload -----------------------------------------------------------------------------------------------------------------------

router.post('/', requireAuth, requireCrm('files'), receive, async (req, res) => {
  const file = req.file;
  try {
    if (!file) return res.status(400).json({ error: 'Choose a file to attach.' });
    const r = await S.resolveSubject(req.body || {});
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (!S.canWriteResolved(req, r.subject)) return res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
    // G15: a file may be attached to one of THIS deal's procurement steps as it is uploaded.
    let itemId = null;
    if ((req.body || {}).checklistItemId !== undefined && String((req.body || {}).checklistItemId) !== '') {
      itemId = Number(/^\d{1,10}$/.test(String(req.body.checklistItemId)) ? req.body.checklistItemId : NaN);
      if (!itemId || r.subject.kind !== 'opportunity') return res.status(400).json({ error: 'Pick one of this deal\u2019s own checklist steps.' });
      const [[it]] = await pool.query('SELECT id FROM crm_opportunity_checklist_items WHERE id = ? AND opportunity_id = ?', [itemId, r.subject.id]);
      if (!it) return res.status(400).json({ error: 'Pick one of this deal\u2019s own checklist steps.' });
    }
    const c = r.subject.cols;
    const col = r.subject.kind === 'opportunity' ? 'opportunity_id' : r.subject.kind === 'account' ? 'account_id' : 'contact_id';
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM crm_attachments WHERE ${col} = ?`, [r.subject.id]);
    if (Number(n) >= F.MAX_FILES_PER_SUBJECT) return res.status(409).json({ code: 'too_many_files', error: `This record already has ${F.MAX_FILES_PER_SUBJECT} files. Delete one first.` });

    // The type is decided from the bytes. The name and Content-Type the browser sent are never believed.
    const detected = sniffFile(file.path);
    if (!detected || !F.ALLOWED_KINDS.has(detected.kind)) return res.status(415).json({ error: 'That file type is not allowed. Use a PDF, an image (PNG, JPG, GIF, WebP) or a Word document.' });
    if (!file.size) return res.status(400).json({ error: 'That file is empty.' });

    const stored = F.newStoredName();
    fs.renameSync(file.path, F.pathFor(stored));
    let id;
    try {
      const [ins] = await pool.query(
        `INSERT INTO crm_attachments (opportunity_id, account_id, contact_id, original_name, stored_name, kind, mime, size_bytes, uploaded_by_admin_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.opportunity_id, c.account_id, c.contact_id, F.safeOriginalName(file.originalname), stored, detected.kind, detected.mime, file.size, req.crm.adminId, sqlNow()]);
      id = ins.insertId;
      if (itemId) await pool.query('UPDATE crm_attachments SET checklist_item_id = ? WHERE id = ?', [itemId, id]);
    } catch (err) {
      try { fs.unlinkSync(F.pathFor(stored)); } catch { /* not kept */ }
      throw err;
    }
    await crmAudit(req, { action: 'crm_file_added', entityType: 'crm_file', entityId: id, next: { subject: r.subject.kind, subjectId: r.subject.id, kind: detected.kind, sizeBytes: file.size } });
    res.status(201).json({ ok: true, id });
  } finally {
    discard(file); // a no-op once the file has been moved into place
  }
});

// ---- Download (the only way to read a file) ---------------------------------------------------------------------------------------

async function loadFile(req, res) {
  const f = await S.loadItem('crm_attachments', req.params.id);
  // A file on someone else's deal answers exactly like a missing one for Sales, so ids cannot be probed.
  if (!f || !mayReach(req, f)) { res.status(404).json({ error: 'File not found' }); return null; }
  return f;
}

// G15: attach a file the deal already has to one of its procurement steps (or take it off, with checklistItemId null). Only within the same deal; the same rule as every file change.
router.post('/:id/attach', requireAuth, requireCrm('files'), async (req, res) => {
  const f = await loadFile(req, res);
  if (!f) return;
  const b = req.body || {};
  if (!f.opportunity_id) return res.status(400).json({ error: 'Only a file on a deal can be attached to a checklist step.' });
  let itemId = null;
  if (b.checklistItemId !== null && b.checklistItemId !== undefined && b.checklistItemId !== '') {
    itemId = Number(/^\d{1,10}$/.test(String(b.checklistItemId)) ? b.checklistItemId : NaN);
    const [[it]] = itemId ? await pool.query('SELECT id FROM crm_opportunity_checklist_items WHERE id = ? AND opportunity_id = ?', [itemId, f.opportunity_id]) : [[null]];
    if (!it) return res.status(400).json({ error: 'Pick one of this deal\u2019s own checklist steps.' });
  }
  await pool.query('UPDATE crm_attachments SET checklist_item_id = ? WHERE id = ?', [itemId, f.id]);
  await crmAudit(req, { action: 'crm_file_attached', entityType: 'crm_file', entityId: f.id, next: { checklistItemId: itemId } });
  res.json({ ok: true });
});

router.get('/:id/download', requireAuth, requireCrm('files'), async (req, res) => {
  const f = await loadFile(req, res);
  if (!f) return;
  const full = F.pathFor(f.stored_name);
  let stat = null;
  try { stat = full ? fs.statSync(full) : null; } catch { stat = null; }
  if (!stat || !stat.isFile()) return res.status(404).json({ error: 'The file is missing from the server.' });
  res.set({
    'Content-Type': F.servedType(f.kind, f.mime),
    'Content-Length': String(stat.size),
    'Content-Disposition': F.attachmentHeader(f.original_name),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  await crmAudit(req, { action: 'crm_file_downloaded', entityType: 'crm_file', entityId: f.id });
  fs.createReadStream(full).on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); }).pipe(res);
});

router.delete('/:id', requireAuth, requireCrm('files'), async (req, res) => {
  const f = await loadFile(req, res);
  if (!f) return;
  const mine = Number(f.uploaded_by_admin_id) === Number(req.crm.adminId);
  if (req.crm.role !== 'admin' && !mine) return res.status(403).json({ code: 'not_your_file', error: 'Only the person who uploaded a file, or a CRM Admin, can delete it.' });
  await pool.query('DELETE FROM crm_attachments WHERE id = ?', [f.id]);
  const full = F.pathFor(f.stored_name);
  if (full) { try { fs.unlinkSync(full); } catch { /* already gone */ } }
  await crmAudit(req, { action: 'crm_file_deleted', entityType: 'crm_file', entityId: f.id, prev: { kind: f.kind, sizeBytes: Number(f.size_bytes) } });
  res.json({ ok: true });
});

module.exports = router;
