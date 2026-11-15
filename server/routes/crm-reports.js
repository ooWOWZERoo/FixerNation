// Sales CRM reports (phase 7; mounted at /api/crm/reports). Read-only: the six reports in lib/crm-reports.js, each with its definition and window.
// Everyone with a CRM role sees the numbers (like the Overview). The CSV export is CRM Admin only, holds summary numbers only (no contact, account or deal
// name, no email, no id), and every export writes one audit row naming the report and the window (never the figures).
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { dateOnly } = require('../lib/crm-common');
const R = require('../lib/crm-reports');

const router = express.Router();

const day = (d) => d.toISOString().slice(0, 10);

// ?range=all, or ?from=YYYY-MM-DD&to=YYYY-MM-DD (either may be left out). With nothing given: the last 90 days. Returns { win } or { error }.
function parseWindow(q) {
  if (q.range === 'all') return { win: { from: null, to: null } };
  const hasFrom = q.from !== undefined && q.from !== '', hasTo = q.to !== undefined && q.to !== '';
  const from = hasFrom ? dateOnly(String(q.from)) : null;
  const to = hasTo ? dateOnly(String(q.to)) : null;
  if (hasFrom && !from) return { error: 'The start date must be a real date (YYYY-MM-DD).' };
  if (hasTo && !to) return { error: 'The end date must be a real date (YYYY-MM-DD).' };
  if (from && to && from > to) return { error: 'The start date is after the end date.' };
  if (!hasFrom && !hasTo) {
    const now = new Date();
    return { win: { from: day(new Date(now.getTime() - 89 * 86400000)), to: day(now) } };
  }
  return { win: { from, to } };
}

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const w = parseWindow(req.query);
  if (w.error) return res.status(400).json({ error: w.error });
  res.json({ window: w.win, windowLabel: R.windowLabel(w.win), reports: await R.runAll(pool, w.win) });
});

router.get('/:key/export', requireAuth, requireCrm('export'), async (req, res) => {
  if (!R.KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Not found' });
  const w = parseWindow(req.query);
  if (w.error) return res.status(400).json({ error: w.error });
  const report = await R.runReport(pool, req.params.key, w.win);
  await crmAudit(req, { action: 'crm_report_exported', entityType: 'crm_report', next: { report: req.params.key, from: w.win.from, to: w.win.to } });
  const stamp = w.win.from || w.win.to ? `${w.win.from || 'start'}_to_${w.win.to || 'today'}` : 'all-time';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="crm-${req.params.key}-${stamp}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send(R.toCsv(report));
});

router.get('/:key', requireAuth, requireCrm('view'), async (req, res) => {
  if (!R.KEYS.includes(req.params.key)) return res.status(404).json({ error: 'Not found' });
  const w = parseWindow(req.query);
  if (w.error) return res.status(400).json({ error: w.error });
  res.json(await R.runReport(pool, req.params.key, w.win));
});

module.exports = router;
