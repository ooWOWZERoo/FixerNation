const express = require('express');
const standards = require('../lib/standards');
const { limiter } = require('../lib/rate-limit');

// Public, read-only. Everything returned here has been verified by an FNE admin -- the
// filtering lives in lib/standards.js's SQL, not in this file, so a draft cannot be
// returned by any route added here later. See docs/standards-crosswalk/DESIGN.md.
const router = express.Router();
router.use(limiter({ name: 'standards-public', windowMs: 60 * 1000, max: 120 }));

// GET /api/standards/overview -- the coverage matrix: which jurisdictions have a verified finding.
router.get('/overview', async (req, res) => {
  res.json(await standards.getPublicOverview());
});

// GET /api/standards/states/:code -- one state's verified frameworks, items and FNE alignments.
router.get('/states/:code', async (req, res) => {
  let data;
  try { data = await standards.getPublicState(req.params.code); }
  catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); throw err; }
  if (!data) return res.status(404).json({ error: 'No verified standards information for that state yet' });
  res.json(data);
});

// GET /api/standards/districts/:id -- one district's verified frameworks, items and FNE connections.
// The sales-demo district is excluded in lib/standards.js's SQL, so it answers 404 like any unknown id.
router.get('/districts/:id', async (req, res) => {
  const data = await standards.getPublicDistrict(req.params.id);
  if (!data) return res.status(404).json({ error: 'No verified framework for that district yet' });
  res.json(data);
});

module.exports = router;
