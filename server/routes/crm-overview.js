// Sales CRM Overview: one request for the numbers on the front page (mounted at /api/crm/overview).
// Every figure comes from the same code the lists use: Suspect / Prospect / Customer from lib/crm-classification.js (test addresses left out), pipeline
// from one row per open deal (each deal has one stage and one value, so nothing counts twice), and the "needs a decision" lists from the review queries.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const cls = require('../lib/crm-classification');
const { listQuoteGaps } = require('../lib/crm-quotes');
const { daysSince } = require('../lib/crm-common');

const router = express.Router();
const LIST = 8;

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const now = cls.sqlNow();
  const counts = await cls.classificationCounts(pool);

  const [open] = await pool.query(
    `SELECT o.id, o.amount_cents, s.stage_key, s.label, s.sort_order, COALESCE(o.probability_override, s.default_probability) AS prob, o.owner_admin_id
     FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open'`);
  let gross = 0, weighted = 0, unvalued = 0, mine = 0, unowned = 0;
  const byStage = new Map();
  for (const r of open) {
    const st = byStage.get(r.stage_key) || { key: r.stage_key, label: r.label, sortOrder: r.sort_order, count: 0, grossCents: 0 };
    st.count++;
    if (r.amount_cents === null || r.amount_cents === undefined) unvalued++;
    else { gross += Number(r.amount_cents); weighted += Math.round(Number(r.amount_cents) * Number(r.prob) / 100); st.grossCents += Number(r.amount_cents); }
    byStage.set(r.stage_key, st);
    if (Number(r.owner_admin_id) === Number(req.crm.adminId)) mine++;
    if (!r.owner_admin_id) unowned++;
  }

  const dealCols = `o.id, o.name, o.next_step, o.next_step_due_at, o.stage_entered_at, o.owner_admin_id, a.name AS account_name, ow.username AS owner_name, s.label AS stage_label`;
  const dealFrom = `FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id JOIN crm_pipeline_stages s ON s.id = o.stage_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id`;
  const shape = r => ({ id: r.id, name: r.name, accountName: r.account_name, stage: r.stage_label, ownerName: r.owner_name || null, nextStep: r.next_step || null, nextStepDueAt: r.next_step_due_at || null, daysInStage: daysSince(r.stage_entered_at) });

  const overdueWhere = "o.state = 'open' AND o.next_step_due_at IS NOT NULL AND o.next_step_due_at < ?";
  const [[{ n: overdueN }]] = await pool.query(`SELECT COUNT(*) AS n FROM crm_opportunities o WHERE ${overdueWhere}`, [now]);
  const [overdue] = await pool.query(`SELECT ${dealCols} ${dealFrom} WHERE ${overdueWhere} ORDER BY o.next_step_due_at ASC, o.id LIMIT ${LIST}`, [now]);
  const missingWhere = "o.state = 'open' AND (o.next_step IS NULL OR o.next_step = '')";
  const [[{ n: missingN }]] = await pool.query(`SELECT COUNT(*) AS n FROM crm_opportunities o WHERE ${missingWhere}`);
  const [missing] = await pool.query(`SELECT ${dealCols} ${dealFrom} WHERE ${missingWhere} ORDER BY o.stage_entered_at ASC, o.id LIMIT ${LIST}`);

  const review = await cls.listPurchasesNeedingReview(pool);
  const noDeal = await listQuoteGaps(pool, { gap: 'no_deal', limit: LIST, offset: 0 });
  const noContact = await listQuoteGaps(pool, { gap: 'no_contact', limit: LIST, offset: 0 });

  res.json({
    counts,
    pipeline: { openCount: open.length, grossCents: gross, weightedCents: weighted, openWithoutValue: unvalued, myOpen: mine, unowned, byStage: [...byStage.values()].sort((a, b) => a.sortOrder - b.sortOrder) },
    nextSteps: { overdue: { total: Number(overdueN), items: overdue.map(shape) }, missing: { total: Number(missingN), items: missing.map(shape) } },
    decisions: {
      purchases: { total: review.length, items: review.slice(0, LIST) },
      quotesWithoutDeal: { total: noDeal.total, items: noDeal.rows },
      quotesWithoutContact: { total: noContact.total, items: noContact.rows },
    },
  });
});

module.exports = router;
