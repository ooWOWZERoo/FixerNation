// Sales CRM Overview: one request for the numbers on the front page (mounted at /api/crm/overview).
// Every figure comes from the same code the lists use: Suspect / Prospect / Customer from lib/crm-classification.js (test addresses left out), pipeline
// from one row per open deal (each deal has one stage and one value, so nothing counts twice; a deal with a test address on a quote or as its main contact is left out, as in Reports), and the "needs a decision" lists from the review queries.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const cls = require('../lib/crm-classification');
const { listQuoteGaps } = require('../lib/crm-quotes');
const { daysSince, dateOnly, quarterBounds } = require('../lib/crm-common');
const reports = require('../lib/crm-reports');
const growth = require('../lib/crm-growth');
const accountRel = require('../lib/crm-account-relationship');
const { DEAL_REAL_SQL } = require('../lib/crm-reports'); // the same test-address rule the Reports use (punch list B2)

const router = express.Router();
const LIST = 8;

// G8: the cards the first build lacked (FR-REP-01). Each one is a number from the same rules the lists and Reports use, never summed twice and never a zero that means
// "unknown". A card whose data this server does not have yet (an older install) is null and the page says so. "Inbox unread" waits for the email phase, which is not built.
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
async function card(fn) { try { return await fn(); } catch (err) { if (isMissing(err)) return null; throw err; } }
const NOT_TEST_BUYER = "NOT (LOWER(TRIM(c.email)) LIKE '%@example.com')";
const WIN_DAYS = 90;

async function buildCards(today) {
  const day = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const { from, to, label } = quarterBounds(today);
  const out = {};

  // A Customer organization (decision D4): a school or district account with a qualifying paid purchase for that school, or for a school in that district. Qualifying purchases that
  // name no school cannot be placed, so they are counted apart as "unresolved" and never guessed into an account.
  out.customerOrganizations = await card(async () => {
    const [[u]] = await pool.query(`SELECT COUNT(*) AS n ${cls.PURCHASES_FROM} JOIN newsletter_contacts c ON c.id = p.contact_id WHERE ${cls.QUALIFYING_SQL} AND ${NOT_TEST_BUYER} AND p.school_id IS NULL`);
    return { count: (await accountRel.customerAccountIds(pool)).size, unresolvedPurchases: Number(u.n) };
  });

  out.expectedClosings = await card(async () => {
    const [rows] = await pool.query(
      `SELECT o.amount_cents FROM crm_opportunities o WHERE o.state = 'open' AND o.expected_close_date IS NOT NULL AND o.expected_close_date >= ? AND o.expected_close_date <= ? AND ${DEAL_REAL_SQL}`, [from, to]);
    const valued = rows.filter(r => r.amount_cents !== null && r.amount_cents !== undefined);
    return { period: label, from, to, count: rows.length, grossCents: valued.reduce((t, r) => t + Number(r.amount_cents), 0), withoutValue: rows.length - valued.length };
  });

  // Open quotes: sent, not accepted, not replaced by a newer revision, not closed, on an open deal or on no deal. Revisions are not added together: a replaced one is not open.
  out.openQuotes = await card(async () => {
    const [rows] = await pool.query(
      `SELECT q.quoted_amount_cents FROM quote_requests q LEFT JOIN crm_opportunities o ON o.id = q.opportunity_id
       WHERE q.quote_sent_at IS NOT NULL AND q.accepted_at IS NULL AND q.version_status <> 'superseded' AND q.status IN ('new', 'contacted')
         AND (q.quote_valid_until IS NULL OR q.quote_valid_until >= ?) AND (o.id IS NULL OR o.state = 'open') AND NOT (LOWER(TRIM(q.email)) LIKE '%@example.com')`, [today]);
    const priced = rows.filter(r => r.quoted_amount_cents !== null && r.quoted_amount_cents !== undefined);
    return { count: rows.length, totalCents: priced.reduce((t, r) => t + Number(r.quoted_amount_cents), 0), unpriced: rows.length - priced.length };
  });

  out.unpaidInvoices = await card(async () => {
    const [rows] = await pool.query(`SELECT i.total_cents FROM invoices i JOIN newsletter_contacts c ON c.id = i.contact_id WHERE i.status = 'unpaid' AND ${NOT_TEST_BUYER}`);
    return { count: rows.length, totalCents: rows.reduce((t, r) => t + Number(r.total_cents || 0), 0) };
  });

  // Renewals due: paid group licenses (the generator's own source rule) ending within its lead time and not already renewed by a later license, plus the open renewal deals.
  out.renewalsDue = await card(async () => {
    const sources = (await growth.sourcePurchases(pool, today)).filter(p => String(p.expiration_date).slice(0, 10) >= today).slice(0, 500);
    let ending = 0;
    for (const p of sources) if (!(await growth.alreadyRenewed(pool, p, await growth.resolveSchool(pool, p)))) ending++;
    const [[d]] = await pool.query(`SELECT COUNT(*) AS n FROM crm_opportunities o WHERE o.state = 'open' AND o.opp_type = 'renewal' AND ${DEAL_REAL_SQL}`);
    return { licensesEnding: ending, windowDays: growth.LEAD_DAYS, openRenewalDeals: Number(d.n) };
  });

  // Win rate: the Reports' own winners-over-closed figure for the last 90 days. No closed deals in the window is "no rate yet" (null), never 0%.
  out.winRate = await card(async () => {
    const w = await reports.runReport(pool, 'winloss', { from: day(-(WIN_DAYS - 1)), to: today });
    return { percent: w.totals.winRate, won: w.totals.won, lost: w.totals.lost, days: WIN_DAYS };
  });
  return out;
}

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const now = cls.sqlNow();
  const today = dateOnly(req.query.today) || now.slice(0, 10); // the person's own day when the page sends it
  const counts = await cls.classificationCounts(pool);

  const [open] = await pool.query(
    `SELECT o.id, o.amount_cents, s.stage_key, s.label, s.sort_order, COALESCE(o.probability_override, s.default_probability) AS prob, o.owner_admin_id
     FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open' AND ${DEAL_REAL_SQL}`);
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

  const overdueWhere = `o.state = 'open' AND o.next_step_due_at IS NOT NULL AND o.next_step_due_at < ? AND ${DEAL_REAL_SQL}`;
  const [[{ n: overdueN }]] = await pool.query(`SELECT COUNT(*) AS n FROM crm_opportunities o WHERE ${overdueWhere}`, [now]);
  const [overdue] = await pool.query(`SELECT ${dealCols} ${dealFrom} WHERE ${overdueWhere} ORDER BY o.next_step_due_at ASC, o.id LIMIT ${LIST}`, [now]);
  const missingWhere = `o.state = 'open' AND (o.next_step IS NULL OR o.next_step = '') AND ${DEAL_REAL_SQL}`;
  const [[{ n: missingN }]] = await pool.query(`SELECT COUNT(*) AS n FROM crm_opportunities o WHERE ${missingWhere}`);
  const [missing] = await pool.query(`SELECT ${dealCols} ${dealFrom} WHERE ${missingWhere} ORDER BY o.stage_entered_at ASC, o.id LIMIT ${LIST}`);

  const review = await cls.listPurchasesNeedingReview(pool);
  const noDeal = await listQuoteGaps(pool, { gap: 'no_deal', limit: LIST, offset: 0 });
  const noContact = await listQuoteGaps(pool, { gap: 'no_contact', limit: LIST, offset: 0 });

  res.json({
    counts,
    cards: await buildCards(today),
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
