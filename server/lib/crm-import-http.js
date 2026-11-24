// The request handlers for the people importer, shared by the Customer Hub's own routes (routes/crm-import.js, behind requireCrm) and the merged Contacts screen's routes
// (routes/contact-screens.js, behind requireCrmRole, which keep working with the Hub switched off: decision D7). Each handler expects req.crm = { role, adminId } from the gate in front of it,
// and works out whether the Hub is on itself: with it off, an import leaves the Organization column, the label and the owner alone (lib/crm-import.js, withCrm).
const pool = require('../db/pool');
const { sqlNow } = require('./crm-classification');
const { crmAudit } = require('./crm-audit');
const { paging, oneOf } = require('./crm-common');
const { isCrmEnabled } = require('./crm-permissions');
const I = require('./crm-import');
const U = require('./crm-import-undo'); // undo an import: CRM Admin only, people it created and nobody has touched

const fail = (res, err) => {
  if (err instanceof I.Refusal) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  throw err;
};

// What an import WOULD do, row by row (the first 200 rows are described, the counts cover all of them). Writes nothing.
async function preview(req, res) {
  try {
    const p = await I.plan(pool, (req.body || {}).rows, { withCrm: await isCrmEnabled() });
    res.json({ counts: p.counts, max: I.MAX_ROWS, missingGroups: p.missingGroups, rows: p.rows.slice(0, 200).map(r => ({ index: r.index, decision: r.decision, problem: r.problem || null, email: r.input.email || '', name: r.input.name || '', organization: r.input.organization || '', city: r.input.city || '', state: r.input.state || '', source: r.input.source || '', groups: r.input.groups || [], accountNote: r.accountNote || null, linksToAccount: !!r.accountId, suggestedAccounts: (r.suggestedAccounts || []).map(a => ({ id: a.id, name: a.name, state: a.state })), pickedAccountId: r.input.pickedAccountId && r.accountId === r.input.pickedAccountId ? r.accountId : null, candidates: (r.candidates || []).map(c => ({ name: c.name, email: c.email, reason: c.reason })) })) });
  } catch (err) { fail(res, err); }
}

async function run(req, res) {
  try {
    const b = req.body || {};
    const out = await I.run(pool, b.rows, { batchName: b.batchName, adminId: req.crm.adminId, now: sqlNow(), createMissingGroups: b.createMissingGroups === true, withCrm: await isCrmEnabled() });
    res.status(201).json({ ok: true, ...out });
  } catch (err) { fail(res, err); }
}

// ?state=waiting (default)|same_person|different_person|skipped
async function review(req, res) {
  const { page, size, offset } = paging(req.query, { defaultSize: 20, maxSize: 50 });
  try { res.json({ ...(await I.listReview(pool, { state: oneOf(req.query.state, ['waiting', 'same_person', 'different_person', 'skipped']) || 'waiting', limit: size, offset })), page, pageSize: size }); } catch (err) { fail(res, err); }
}

async function resolve(req, res) {
  try { res.json({ ok: true, ...(await I.resolveReview(pool, req.params.id, { action: (req.body || {}).action, contactId: (req.body || {}).contactId, adminId: req.crm.adminId, now: sqlNow(), withCrm: await isCrmEnabled() })) }); } catch (err) { fail(res, err); }
}

// The last 20 imports and what each did (counts only).
async function batches(req, res) {
  try {
    // The undo columns are newer than the table: an install that has not run the undo update still lists its imports (without them).
    let rows, withUndo = true;
    try { [rows] = await pool.query('SELECT b.id, b.name, b.total_rows, b.added, b.already_there, b.queued, b.left_out, b.created_at, b.undone_at, b.undo_removed, b.undo_kept, u.username FROM crm_import_batches b LEFT JOIN admin_users u ON u.id = b.created_by_admin_id ORDER BY b.id DESC LIMIT 20'); }
    catch (err) { if (!U.isMissing(err)) throw err; withUndo = false; [rows] = await pool.query('SELECT b.id, b.name, b.total_rows, b.added, b.already_there, b.queued, b.left_out, b.created_at, u.username FROM crm_import_batches b LEFT JOIN admin_users u ON u.id = b.created_by_admin_id ORDER BY b.id DESC LIMIT 20'); }
    const tracked = withUndo ? await U.trackedCounts(pool) : null;
    res.json({ undoAvailable: !!tracked, batches: rows.map(r => ({ id: Number(r.id), name: r.name, total: Number(r.total_rows), added: Number(r.added), alreadyThere: Number(r.already_there), queued: Number(r.queued), leftOut: Number(r.left_out), at: r.created_at, by: r.username || null,
      undoable: !!tracked && !r.undone_at && (tracked.get(Number(r.id)) || 0) > 0, undoneAt: r.undone_at || null, undoRemoved: r.undone_at ? Number(r.undo_removed || 0) : null, undoKept: r.undone_at ? Number(r.undo_kept || 0) : null })) });
  } catch (err) { if (I.isMissing && I.isMissing(err)) return res.status(503).json({ error: 'Importing people is not available yet.', code: 'not_available' }); if (err && (err.code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(String(err.message)))) return res.status(503).json({ error: 'Importing people is not available yet.', code: 'not_available' }); throw err; }
}

// Undo an import (CRM Admin only: the same people who may erase a person). Two steps: the preview says how many would go and why the others stay, and changes nothing; the undo needs
// { confirm: true } and can be done once. Only people THIS import created are ever removed, and only while untouched; a person with anything of their own is kept.
const undoFail = (res, r) => res.status(r.status).json({ error: r.error, code: r.code || undefined });
async function undoPreview(req, res) {
  const r = await U.preview(pool, req.params.id);
  if (r.error) return undoFail(res, r);
  res.json(r);
}
async function undo(req, res) {
  if (!req.body || req.body.confirm !== true) return res.status(400).json({ error: 'Look at the preview first, then confirm.' });
  const r = await U.undo(pool, req.params.id, { adminId: req.crm.adminId, now: sqlNow() });
  if (r.error) return undoFail(res, r);
  // Counts only: no name and no email goes into the log.
  await crmAudit(req, { action: 'crm_import_undone', entityType: 'crm_import', entityId: Number(req.params.id), next: { removed: r.removed, kept: r.kept, gone: r.gone, keptByReason: Object.fromEntries(r.keptByReason.map(k => [k.reason, k.count])) } });
  res.json({ ok: true, ...r });
}

module.exports = { preview, run, review, resolve, batches, undoPreview, undo };
