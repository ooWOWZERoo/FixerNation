// Sales CRM prospect import (punch list G22, mounted at /api/crm/import). People arrive as rows parsed in the browser from a CSV; the server plans and writes them (lib/crm-import.js).
// Who may do what: everyone with a CRM role can read the review queue and the import history; CRM Admin and Sales can preview, import and decide a queued row (the same people who can
// add a person by hand); Read-only never. Imports are Suspects, not subscribed to the newsletter, and nothing is ever merged or overwritten.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { sqlNow } = require('../lib/crm-classification');
const { paging, oneOf } = require('../lib/crm-common');
const I = require('../lib/crm-import');

const router = express.Router();
const fail = (res, err) => {
  if (err instanceof I.Refusal) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
  throw err;
};

// What an import WOULD do, row by row (the first 200 rows are described, the counts cover all of them). Writes nothing.
router.post('/preview', requireAuth, requireCrm('write'), async (req, res) => {
  try {
    const p = await I.plan(pool, (req.body || {}).rows);
    res.json({ counts: p.counts, max: I.MAX_ROWS, rows: p.rows.slice(0, 200).map(r => ({ index: r.index, decision: r.decision, problem: r.problem || null, email: r.input.email || '', name: r.input.name || '', organization: r.input.organization || '', accountNote: r.accountNote || null, linksToAccount: !!r.accountId, candidates: (r.candidates || []).map(c => ({ name: c.name, email: c.email, reason: c.reason })) })) });
  } catch (err) { fail(res, err); }
});

router.post('/run', requireAuth, requireCrm('write'), async (req, res) => {
  try {
    const out = await I.run(pool, (req.body || {}).rows, { batchName: (req.body || {}).batchName, adminId: req.crm.adminId, now: sqlNow() });
    res.status(201).json({ ok: true, ...out });
  } catch (err) { fail(res, err); }
});

// ?state=waiting (default)|same_person|different_person|skipped
router.get('/review', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 20, maxSize: 50 });
  try { res.json({ ...(await I.listReview(pool, { state: oneOf(req.query.state, ['waiting', 'same_person', 'different_person', 'skipped']) || 'waiting', limit: size, offset })), page, pageSize: size }); } catch (err) { fail(res, err); }
});

router.post('/review/:id/resolve', requireAuth, requireCrm('write'), async (req, res) => {
  try { res.json({ ok: true, ...(await I.resolveReview(pool, req.params.id, { action: (req.body || {}).action, contactId: (req.body || {}).contactId, adminId: req.crm.adminId, now: sqlNow() })) }); } catch (err) { fail(res, err); }
});

// The last 20 imports and what each did (counts only).
router.get('/batches', requireAuth, requireCrm('view'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT b.id, b.name, b.total_rows, b.added, b.already_there, b.queued, b.left_out, b.created_at, u.username FROM crm_import_batches b LEFT JOIN admin_users u ON u.id = b.created_by_admin_id ORDER BY b.id DESC LIMIT 20');
    res.json({ batches: rows.map(r => ({ id: Number(r.id), name: r.name, total: Number(r.total_rows), added: Number(r.added), alreadyThere: Number(r.already_there), queued: Number(r.queued), leftOut: Number(r.left_out), at: r.created_at, by: r.username || null })) });
  } catch (err) { if (I.isMissing && I.isMissing(err)) return res.status(503).json({ error: 'Importing people is not available yet.', code: 'not_available' }); if (err && (err.code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(String(err.message)))) return res.status(503).json({ error: 'Importing people is not available yet.', code: 'not_available' }); throw err; }
});

module.exports = router;
