const express = require('express');
const standards = require('../lib/standards');
const { requireAuth } = require('../middleware/auth');

// FNE-admin only. Create/edit research, and the review actions (verify / unverify) that
// decide what the public endpoints may show. Every verify records which admin did it.
// See docs/standards-crosswalk/DESIGN.md.
const router = express.Router();
router.use(requireAuth);

// Validation errors from lib/standards.js carry a status; anything else is a real failure.
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res) ?? { ok: true }); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); throw err; }
};
const num = (v) => Number(v);

router.get('/overview', wrap(() => standards.getAdminOverview()));
// Admin-only "preview as a visitor": the public page's data, drafts included and marked.
router.get('/preview/overview', wrap(() => standards.getPreviewOverview()));
router.get('/preview/states/:code', wrap(async (req) => {
  const d = await standards.getPreviewState(req.params.code);
  if (!d) { const e = new Error('Nothing loaded for that state yet'); e.status = 404; throw e; }
  return d;
}));
router.get('/states/:code', wrap((req) => standards.getAdminState(req.params.code)));

// Coverage (one row per jurisdiction)
router.put('/coverage/:code', wrap((req) => standards.upsertCoverage(req.params.code, req.body || {})));
router.post('/coverage/:code/verify', wrap(async (req) => { await standards.verifyCoverage(req.params.code, req.user.userId); }));
router.post('/coverage/:code/unverify', wrap(async (req) => { await standards.unverifyCoverage(req.params.code); }));

// Frameworks and items
router.post('/frameworks', wrap((req) => standards.createFramework(req.body || {})));
router.get('/frameworks/:id', wrap((req) => standards.getAdminFramework(num(req.params.id))));
router.put('/frameworks/:id', wrap((req) => standards.updateFramework(num(req.params.id), req.body || {})));
router.delete('/frameworks/:id', wrap(async (req) => { await standards.deleteFramework(num(req.params.id)); }));
router.put('/frameworks/:id/items', wrap((req) => standards.upsertItems(num(req.params.id), (req.body || {}).items)));
router.delete('/items/:id', wrap(async (req) => { await standards.deleteItem(num(req.params.id)); }));
router.post('/frameworks/:id/verify', wrap(async (req) => { await standards.verifyFramework(num(req.params.id), req.user.userId); }));
router.post('/frameworks/:id/unverify', wrap(async (req) => { await standards.unverifyFramework(num(req.params.id)); }));

// Alignments (FNE content <-> a standard)
router.put('/alignments', wrap((req) => standards.upsertAlignment(req.body || {})));
router.delete('/alignments/:id', wrap(async (req) => { await standards.deleteAlignment(num(req.params.id)); }));
router.post('/alignments/:id/verify', wrap(async (req) => { await standards.verifyAlignment(num(req.params.id), req.user.userId); }));
router.post('/items/:id/verify-alignments', wrap((req) => standards.verifyAlignmentsForItem(num(req.params.id), req.user.userId)));
router.post('/alignments/:id/unverify', wrap(async (req) => { await standards.unverifyAlignment(num(req.params.id)); }));

module.exports = router;
