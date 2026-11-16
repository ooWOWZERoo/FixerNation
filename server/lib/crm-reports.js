// Sales CRM reports (phase 7; spec: docs/reference/sales-crm-update-requirements.md, "Phase 7 spec"). Six read-only reports, each with its definition and date window.
//
// Hard rules, all tested:
//  - One row per distinct deal or per purchase. Quotes, revisions, committee members and accounts are never joined into a total (a deal with three quote revisions
//    or a contact in two accounts counts once). Where a deal is asked about its quotes or purchases, it is an EXISTS test, not a join.
//  - Money comes only from qualifying paid purchases (lib/crm-classification.js QUALIFYING_SQL), never from a quote, a deal value or an invoice.
//  - Test addresses (@example.com) are left out, the same way the Overview leaves them out.
//  - Nothing here writes. Every function takes a `conn` and returns plain data; the SQL is portable so the tests run it on node:sqlite.
//  - No score, no hot / warm / cold wording. A report says what it counted and over which dates.
const { QUALIFYING_SQL, PURCHASES_FROM, TEST_ADDRESS_SQL } = require('./crm-classification');

const KEYS = ['funnel', 'pipeline', 'winloss', 'timeinstage', 'sourcetopaid', 'reconciliation'];
const ID_LIMIT = 20;
const UNOWNED = 'Unassigned';

// ---- small helpers ---------------------------------------------------------------------------------------------------------------

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const dollars = (cents) => (cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2));
const num = (v) => Number(v || 0);
const toMs = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getTime();
  const t = new Date(String(v).replace(' ', 'T') + (String(v).includes('T') || String(v).endsWith('Z') ? '' : 'Z')).getTime();
  return Number.isNaN(t) ? null : t;
};
const days = (a, b) => {
  const x = toMs(a), y = toMs(b);
  return x === null || y === null || y < x ? null : (y - x) / 86400000;
};
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A report window is { from, to } as YYYY-MM-DD (either may be null = no limit). `to` is the whole of that day.
function windowSql(column, win) {
  const sql = [], params = [];
  if (win && win.from) { sql.push(`${column} >= ?`); params.push(`${win.from} 00:00:00`); }
  if (win && win.to) { sql.push(`${column} <= ?`); params.push(`${win.to} 23:59:59`); }
  return { sql: sql.length ? ` AND ${sql.join(' AND ')}` : '', params };
}
const windowLabel = (win) => (!win || (!win.from && !win.to) ? 'All time' : `${win.from || 'the start'} to ${win.to || 'today'}`);

// Punch list B4: renewals and expansions used to be counted with new business in every funnel, win rate and weighted figure. A report can now be limited to one deal type
// (win.type; anything else, or no type, means every type, as before). Only the five deal reports take it; the label says which type was counted.
const DEAL_TYPES = { new_business: 'New business', renewal: 'Renewals', expansion: 'Expansions', cross_sell: 'Cross-sell' };
const typeOf = (win) => (win && Object.prototype.hasOwnProperty.call(DEAL_TYPES, win.type) ? win.type : null);
const typeSql = (win) => (typeOf(win) ? ` AND o.opp_type = '${typeOf(win)}'` : '');
const typeLabel = (win) => (typeOf(win) ? ` · Deal type: ${DEAL_TYPES[typeOf(win)]}` : '');

// A deal is real unless one of its quotes, or its primary contact, has a test address.
const DEAL_REAL_SQL = `NOT EXISTS (SELECT 1 FROM quote_requests tq WHERE tq.opportunity_id = o.id AND LOWER(TRIM(tq.email)) LIKE '%@example.com')
  AND NOT EXISTS (SELECT 1 FROM newsletter_contacts tc WHERE tc.id = o.primary_contact_id AND LOWER(TRIM(tc.email)) LIKE '%@example.com')`;
const QUOTE_REAL_SQL = "LOWER(TRIM(q.email)) NOT LIKE '%@example.com'";

// ---- 1. Funnel and stage conversion ------------------------------------------------------------------------------------------------

async function funnel(conn, win) {
  const w = windowSql('o.created_at', win);
  const [stages] = await conn.query('SELECT stage_key, label, sort_order FROM crm_pipeline_stages ORDER BY sort_order, id');
  const [deals] = await conn.query(
    `SELECT o.id, o.state, COALESCE((SELECT MAX(s.sort_order) FROM crm_opportunity_stage_history h JOIN crm_pipeline_stages s ON s.id = h.to_stage_id WHERE h.opportunity_id = o.id), cs.sort_order) AS max_sort
     FROM crm_opportunities o JOIN crm_pipeline_stages cs ON cs.id = o.stage_id WHERE ${DEAL_REAL_SQL}${typeSql(win)}${w.sql}`, w.params);
  const total = deals.length;
  const rows = stages.map((s, i) => {
    const reached = deals.filter(d => num(d.max_sort) >= num(s.sort_order)).length;
    return { key: s.stage_key, label: s.label, reached, shareOfAll: pct(reached, total), conversionFromPrevious: null };
  });
  for (let i = 1; i < rows.length; i++) rows[i].conversionFromPrevious = pct(rows[i].reached, rows[i - 1].reached);
  const outcomes = { open: 0, won: 0, lost: 0, inactive: 0 };
  for (const d of deals) if (d.state in outcomes) outcomes[d.state]++;
  // The mix of deal types created in the window, whatever type is picked, so a report that mixes them is never read as all new business.
  const [mix] = await conn.query(`SELECT o.opp_type AS t, COUNT(*) AS n FROM crm_opportunities o WHERE ${DEAL_REAL_SQL}${w.sql} GROUP BY o.opp_type`, w.params);
  const byType = Object.keys(DEAL_TYPES).map(k => ({ key: k, label: DEAL_TYPES[k], deals: num((mix.find(m => m.t === k) || {}).n) }));
  return {
    key: 'funnel', title: 'Funnel and stage conversion', window: win, windowLabel: windowLabel(win) + typeLabel(win),
    definition: 'Counts the deals created in the window. For each stage it shows how many of those deals reached that stage or a later one (a deal that skipped a stage still counts), and the share that went on from the stage before. Lost and inactive deals count for the stages they reached.',
    total, stages: rows, outcomes, byType,
    table: { header: ['Stage', 'Deals that reached it', 'Share of all deals (%)', 'Went on from previous stage (%)'], rows: rows.map(r => [r.label, r.reached, r.shareOfAll, r.conversionFromPrevious]).concat([['Deals created in the window', total, '', ''], ['Now open', outcomes.open, '', ''], ['Now won', outcomes.won, '', ''], ['Now lost', outcomes.lost, '', ''], ['Now inactive', outcomes.inactive, '', '']].concat(byType.map(t => ['Created in the window: ' + t.label, t.deals, '', '']))) },
  };
}

// ---- 2. Weighted pipeline (as of now) ------------------------------------------------------------------------------------------------

async function pipeline(conn, win) {
  const [rows] = await conn.query(
    `SELECT o.id, o.amount_cents, s.stage_key, s.label, s.sort_order, COALESCE(o.probability_override, s.default_probability) AS prob, COALESCE(u.username, '${UNOWNED}') AS owner
     FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id LEFT JOIN admin_users u ON u.id = o.owner_admin_id
     WHERE o.state = 'open' AND ${DEAL_REAL_SQL}${typeSql(win)}`);
  const group = (keyOf, labelOf, sortOf) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const g = m.get(k) || { key: k, label: labelOf(r), sort: sortOf(r), deals: 0, valued: 0, grossCents: 0, weightedCents: 0 };
      g.deals++;
      if (r.amount_cents !== null && r.amount_cents !== undefined) { g.valued++; g.grossCents += num(r.amount_cents); g.weightedCents += Math.round(num(r.amount_cents) * num(r.prob) / 100); }
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label)));
  };
  const byStage = group(r => r.stage_key, r => r.label, r => num(r.sort_order));
  const byOwner = group(r => r.owner, r => r.owner, r => (r.owner === UNOWNED ? 1 : 0));
  const sum = (k) => rows.reduce((s, r) => s + (k === 'g' ? (r.amount_cents === null || r.amount_cents === undefined ? 0 : num(r.amount_cents)) : (r.amount_cents === null || r.amount_cents === undefined ? 0 : Math.round(num(r.amount_cents) * num(r.prob) / 100))), 0);
  const totals = { deals: rows.length, withoutValue: rows.filter(r => r.amount_cents === null || r.amount_cents === undefined).length, grossCents: sum('g'), weightedCents: sum('w') };
  const line = (g) => [g.label, g.deals, g.valued, dollars(g.grossCents), dollars(g.weightedCents)];
  return {
    key: 'pipeline', title: 'Weighted pipeline', window: null, windowLabel: 'As of today (the date window does not apply)' + typeLabel(win),
    definition: 'Every open deal, as it is right now. Gross is the sum of the deal values. Weighted is each value times its probability (a CRM Admin\'s override on the deal, else the stage\'s default). A deal with no value is counted in "deals" but adds nothing, and is listed separately so it is never read as zero.',
    totals, byStage, byOwner,
    table: { header: ['Group', 'Deals', 'Deals with a value', 'Gross ($)', 'Weighted ($)'], rows: [['All open deals', totals.deals, totals.deals - totals.withoutValue, dollars(totals.grossCents), dollars(totals.weightedCents)]].concat(byStage.map(g => ['Stage: ' + g.label].concat(line(g).slice(1))), byOwner.map(g => ['Owner: ' + g.label].concat(line(g).slice(1)))) },
  };
}

// ---- 3. Win and loss -------------------------------------------------------------------------------------------------------------------

async function winloss(conn, win) {
  const w = windowSql('o.closed_at', win);
  const [rows] = await conn.query(
    `SELECT o.id, o.state, o.amount_cents, o.created_at, o.closed_at, COALESCE(u.username, '${UNOWNED}') AS owner, lr.label AS reason
     FROM crm_opportunities o LEFT JOIN admin_users u ON u.id = o.owner_admin_id LEFT JOIN crm_loss_reasons lr ON lr.id = o.loss_reason_id
     WHERE o.state IN ('won', 'lost', 'inactive') AND o.closed_at IS NOT NULL AND ${DEAL_REAL_SQL}${typeSql(win)}${w.sql}`, w.params);
  const by = (state) => rows.filter(r => r.state === state);
  const money = (rs) => rs.reduce((s, r) => s + (r.amount_cents === null || r.amount_cents === undefined ? 0 : num(r.amount_cents)), 0);
  const won = by('won'), lost = by('lost'), inactive = by('inactive');
  const cycle = won.map(r => days(r.created_at, r.closed_at)).filter(d => d !== null);
  const wonValued = won.filter(r => r.amount_cents !== null && r.amount_cents !== undefined);
  const reasons = new Map();
  for (const r of lost) reasons.set(r.reason || 'No reason recorded', (reasons.get(r.reason || 'No reason recorded') || 0) + 1);
  const owners = new Map();
  for (const r of rows) {
    const o = owners.get(r.owner) || { owner: r.owner, won: 0, lost: 0, inactive: 0 };
    o[r.state]++;
    owners.set(r.owner, o);
  }
  const totals = {
    won: won.length, lost: lost.length, inactive: inactive.length,
    wonCents: money(won), lostCents: money(lost), winRate: pct(won.length, won.length + lost.length),
    averageWonCents: wonValued.length ? Math.round(money(wonValued) / wonValued.length) : null,
    averageDaysToWin: round1(avg(cycle)),
  };
  const lossReasons = [...reasons.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const byOwner = [...owners.values()].map(o => ({ ...o, winRate: pct(o.won, o.won + o.lost) })).sort((a, b) => a.owner.localeCompare(b.owner));
  return {
    key: 'winloss', title: 'Win and loss', window: win, windowLabel: windowLabel(win) + typeLabel(win),
    definition: 'Counts deals closed in the window. Win rate is won divided by (won plus lost); inactive deals are left out of the rate and shown on their own. Values are the deal values at the time of the report, and a deal with no value adds nothing. Days to win run from the day the deal was created to the day it was closed.',
    totals, lossReasons, byOwner,
    table: { header: ['Measure', 'Value'], rows: [
      ['Won deals', totals.won], ['Lost deals', totals.lost], ['Inactive deals', totals.inactive], ['Win rate (%)', totals.winRate],
      ['Won value ($)', dollars(totals.wonCents)], ['Lost value ($)', dollars(totals.lostCents)], ['Average won value ($)', dollars(totals.averageWonCents)], ['Average days to win', totals.averageDaysToWin],
    ].concat(lossReasons.map(r => ['Lost: ' + r.label, r.count]), byOwner.map(o => ['Owner ' + o.owner + ': won / lost / inactive', `${o.won} / ${o.lost} / ${o.inactive}`])) },
  };
}

// ---- 4. Time in stage ------------------------------------------------------------------------------------------------------------------

async function timeInStage(conn, win, now = new Date()) {
  const [stages] = await conn.query('SELECT stage_key, label, sort_order FROM crm_pipeline_stages ORDER BY sort_order, id');
  const byId = new Map();
  const [hist] = await conn.query(
    `SELECT h.opportunity_id, h.to_stage_id, h.to_state, h.created_at, s.stage_key
     FROM crm_opportunity_stage_history h JOIN crm_pipeline_stages s ON s.id = h.to_stage_id JOIN crm_opportunities o ON o.id = h.opportunity_id
     WHERE ${DEAL_REAL_SQL}${typeSql(win)} ORDER BY h.opportunity_id, h.id`);
  for (const h of hist) { if (!byId.has(h.opportunity_id)) byId.set(h.opportunity_id, []); byId.get(h.opportunity_id).push(h); }
  const lo = win && win.from ? toMs(`${win.from} 00:00:00`) : -Infinity;
  const hi = win && win.to ? toMs(`${win.to} 23:59:59`) : Infinity;
  const visits = new Map(stages.map(s => [s.stage_key, []]));
  // A visit starts at a history row that leaves the deal open and ends at the next row of any kind (a move, a close or a reopen).
  for (const rows of byId.values()) {
    for (let i = 0; i + 1 < rows.length; i++) {
      if (rows[i].to_state !== 'open') continue;
      const end = toMs(rows[i + 1].created_at);
      if (end === null || end < lo || end > hi) continue;
      const d = days(rows[i].created_at, rows[i + 1].created_at);
      if (d !== null && visits.has(rows[i].stage_key)) visits.get(rows[i].stage_key).push(d);
    }
  }
  const [open] = await conn.query(
    `SELECT o.id, o.stage_entered_at, s.stage_key FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open' AND ${DEAL_REAL_SQL}${typeSql(win)}`);
  const nowing = new Map(stages.map(s => [s.stage_key, []]));
  for (const o of open) { const d = days(o.stage_entered_at, now); if (d !== null && nowing.has(o.stage_key)) nowing.get(o.stage_key).push(d); }
  const rows = stages.map(s => {
    const v = visits.get(s.stage_key), n = nowing.get(s.stage_key);
    return { key: s.stage_key, label: s.label, visits: v.length, averageDays: round1(avg(v)), medianDays: round1(median(v)), openNow: n.length, openNowAverageDays: round1(avg(n)) };
  });
  return {
    key: 'timeinstage', title: 'Time in stage', window: win, windowLabel: windowLabel(win) + ' (by the day the deal left the stage)' + typeLabel(win),
    definition: 'For each stage, how long deals stayed in it, from the stage history. Only visits that ended inside the window are counted; a visit ends when the deal moves, closes or is reopened. The last two columns are open deals still in the stage today and how long they have been there so far, which does not depend on the window.',
    stages: rows,
    table: { header: ['Stage', 'Visits that ended', 'Average days', 'Median days', 'Open deals in it now', 'Average days so far'], rows: rows.map(r => [r.label, r.visits, r.averageDays, r.medianDays, r.openNow, r.openNowAverageDays]) },
  };
}

// ---- 5. Source to paid -------------------------------------------------------------------------------------------------------------------

async function sourceToPaid(conn, win) {
  const w = windowSql('o.created_at', win);
  const [deals] = await conn.query(
    `SELECT o.id, COALESCE(NULLIF(TRIM(o.source), ''), 'Not recorded') AS src, o.state,
       CASE WHEN EXISTS (SELECT 1 ${PURCHASES_FROM} JOIN quote_requests q ON q.id = p.quote_id WHERE q.opportunity_id = o.id AND ${QUALIFYING_SQL}) THEN 1 ELSE 0 END AS paid
     FROM crm_opportunities o WHERE ${DEAL_REAL_SQL}${typeSql(win)}${w.sql}`, w.params);
  // Money: each qualifying purchase belongs to one quote and each quote to one deal, so summing per deal counts every purchase once.
  const [money] = await conn.query(
    `SELECT o.id, SUM(p.amount_cents) AS cents ${PURCHASES_FROM} JOIN quote_requests q ON q.id = p.quote_id JOIN crm_opportunities o ON o.id = q.opportunity_id
     WHERE ${QUALIFYING_SQL} AND ${DEAL_REAL_SQL}${typeSql(win)}${w.sql} GROUP BY o.id`, w.params);
  const cents = new Map(money.map(m => [m.id, num(m.cents)]));
  const groups = new Map();
  for (const d of deals) {
    const label = String(d.src).slice(0, 64);
    const g = groups.get(label) || { source: label, deals: 0, won: 0, paidDeals: 0, paidCents: 0 };
    g.deals++;
    if (d.state === 'won') g.won++;
    if (num(d.paid)) { g.paidDeals++; g.paidCents += cents.get(d.id) || 0; }
    groups.set(label, g);
  }
  // Every qualifying paid purchase in the window, by the day it was bought, split into those on a deal's quote and the rest (a card sale straight from the site has
  // no quote). The groups above only ever see the first kind, so without this line a direct sale looked like zero revenue (punch list B3).
  const pw = windowSql('p.purchased_at', win);
  const onDeal = 'EXISTS (SELECT 1 FROM quote_requests pq WHERE pq.id = p.quote_id AND pq.opportunity_id IS NOT NULL)';
  const [[paidAll]] = await conn.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(p.amount_cents), 0) AS cents, COALESCE(SUM(CASE WHEN ${onDeal} THEN 1 ELSE 0 END), 0) AS deal_n,
            COALESCE(SUM(CASE WHEN ${onDeal} THEN p.amount_cents ELSE 0 END), 0) AS deal_cents
     ${PURCHASES_FROM} JOIN newsletter_contacts pc ON pc.id = p.contact_id
     WHERE ${QUALIFYING_SQL} AND NOT (${TEST_ADDRESS_SQL.replace('email', 'pc.email')})${pw.sql}`, pw.params);
  // A purchase has no deal type of its own, so these lines only make sense when every deal type is counted.
  const purchases = typeOf(win) ? null : {
    count: num(paidAll.n), cents: num(paidAll.cents),
    onDealCount: num(paidAll.deal_n), onDealCents: num(paidAll.deal_cents),
    otherCount: num(paidAll.n) - num(paidAll.deal_n), otherCents: num(paidAll.cents) - num(paidAll.deal_cents),
  };
  const rows = [...groups.values()].map(g => ({ ...g, wonRate: pct(g.won, g.deals), paidRate: pct(g.paidDeals, g.deals) })).sort((a, b) => b.deals - a.deals || a.source.localeCompare(b.source));
  const totals = rows.reduce((t, g) => ({ deals: t.deals + g.deals, won: t.won + g.won, paidDeals: t.paidDeals + g.paidDeals, paidCents: t.paidCents + g.paidCents }), { deals: 0, won: 0, paidDeals: 0, paidCents: 0 });
  return {
    key: 'sourcetopaid', title: 'Source to paid', window: win, windowLabel: windowLabel(win) + ' (by the day the deal was created)' + typeLabel(win),
    definition: 'Groups the deals created in the window by their Source field, which is whatever staff typed (blank means "Not recorded"). "Paid" means a purchase on one of the deal\'s quotes that counts toward Customer: paid, more than $0, not a trial. Money is only from those purchases. The sources above only see money on a deal\'s quote and are grouped by the day the deal was created. The last three lines are different: every qualifying paid purchase bought in the window, by the day it was bought, split into those on a deal\'s quote and those on no deal (a card sale straight from the site has no quote). This is not marketing attribution; that is the "How they found us" card on a contact.',
    totals, sources: rows, purchases,
    table: { header: ['Source', 'Deals', 'Won', 'Won (%)', 'Deals with a paid purchase', 'Paid (%)', 'Paid amount ($)'], rows: rows.map(g => [g.source, g.deals, g.won, g.wonRate, g.paidDeals, g.paidRate, dollars(g.paidCents)]).concat([['All sources', totals.deals, totals.won, pct(totals.won, totals.deals), totals.paidDeals, pct(totals.paidDeals, totals.deals), dollars(totals.paidCents)]],
      purchases ? [
      ['All paid purchases bought in the window (by purchase date)', purchases.count, '', '', '', '', dollars(purchases.cents)],
      ['  of which on a deal\'s quote', purchases.onDealCount, '', '', '', '', dollars(purchases.onDealCents)],
      ['  of which not on any deal (for example a card sale from the site)', purchases.otherCount, '', '', '', '', dollars(purchases.otherCents)]] : []) },
  };
}

// ---- 6. Reconciliation ------------------------------------------------------------------------------------------------------------------

async function check(conn, key, label, why, whereFrom, idCol) {
  const [[{ n }]] = await conn.query(`SELECT COUNT(DISTINCT ${idCol}) AS n ${whereFrom}`);
  const [ids] = await conn.query(`SELECT DISTINCT ${idCol} AS id ${whereFrom} ORDER BY ${idCol} LIMIT ${ID_LIMIT}`);
  return { key, label, why, count: Number(n), ids: ids.map(r => r.id), ok: Number(n) === 0 };
}

async function reconciliation(conn) {
  const checks = [];
  checks.push(await check(conn, 'accepted_no_purchase', 'Accepted quotes with no purchase', 'The customer said yes but nothing was set up. Look at the quote.',
    `FROM quote_requests q WHERE q.accepted_at IS NOT NULL AND ${QUOTE_REAL_SQL} AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.quote_id = q.id)`, 'q.id'));
  checks.push(await check(conn, 'won_no_accepted_quote', 'Won deals with no accepted quote', 'Closed as won by hand, for example a phone deal handled elsewhere. Fine if you know why; otherwise check the deal.',
    `FROM crm_opportunities o WHERE o.state = 'won' AND ${DEAL_REAL_SQL} AND NOT EXISTS (SELECT 1 FROM quote_requests q WHERE q.opportunity_id = o.id AND q.accepted_at IS NOT NULL)`, 'o.id'));
  checks.push(await check(conn, 'accepted_deal_open', 'Accepted quotes whose deal is still open', 'The quote was accepted but the deal did not move to won.',
    `FROM crm_opportunities o WHERE o.state = 'open' AND ${DEAL_REAL_SQL} AND EXISTS (SELECT 1 FROM quote_requests q WHERE q.opportunity_id = o.id AND q.accepted_at IS NOT NULL)`, 'o.id'));
  checks.push(await check(conn, 'purchase_quote_no_deal', 'Purchases from a quote that is on no deal', 'Money came in for a quote nobody linked to a deal. Make or pick the deal in Quotes without a deal.',
    `FROM purchases p JOIN quote_requests q ON q.id = p.quote_id WHERE q.opportunity_id IS NULL AND ${QUOTE_REAL_SQL}`, 'p.id'));
  checks.push(await check(conn, 'invoice_purchase_disagree', 'An invoice and its purchase disagree on paid', 'The invoice says paid and the purchase does not, or the other way round.',
    `FROM purchases p JOIN invoices i ON i.id = p.invoice_id JOIN newsletter_contacts c ON c.id = p.contact_id
     WHERE NOT (${TEST_ADDRESS_SQL.replace('email', 'c.email')}) AND ((i.status = 'paid' AND p.payment_status <> 'paid') OR (i.status IN ('unpaid', 'cancelled') AND p.payment_status = 'paid'))`, 'p.id'));

  // Customer label against paid purchases, both ways. A Customer comes from a qualifying paid purchase or a staff override (locked); anything else is an exception.
  // The other way round, a contact with a qualifying paid purchase who is not a Customer yet means the nightly reconcile has not caught up (or a hook was missed).
  const testSql = TEST_ADDRESS_SQL.replace('email', 'c.email');
  const qualifying = (id) => `EXISTS (SELECT 1 ${PURCHASES_FROM} WHERE p.contact_id = ${id} AND ${QUALIFYING_SQL})`;
  checks.push(await check(conn, 'customer_without_purchase', 'Customers with no paid purchase behind them', 'A Customer with no qualifying paid purchase and no staff override, for example after a refund. The label is kept; look at the contact.',
    `FROM newsletter_contacts c WHERE c.crm_classification = 'customer' AND c.classification_locked = 0 AND NOT (${testSql}) AND NOT ${qualifying('c.id')}`, 'c.id'));
  checks.push(await check(conn, 'paid_not_customer', 'Paid purchases whose buyer is not a Customer', 'A qualifying paid purchase exists but the contact is not labeled Customer. The nightly reconcile normally fixes this by morning.',
    `FROM newsletter_contacts c WHERE c.crm_classification <> 'customer' AND NOT (${testSql}) AND ${qualifying('c.id')}`, 'c.id'));
  return {
    key: 'reconciliation', title: 'Reconciliation', window: null, windowLabel: 'All time (the date window does not apply)',
    definition: 'Plain checks that the CRM and the money records agree. Each shows how many exceptions it found and the first 20 internal ids so you can open them. A check with zero is fine. These are plain counts, and nothing here changes anything.',
    checks, allClear: checks.every(c => c.ok),
    table: { header: ['Check', 'Exceptions'], rows: checks.map(c => [c.label, c.count]) },
  };
}

// ---- entry points ------------------------------------------------------------------------------------------------------------------------

async function runReport(conn, key, win, now) {
  switch (key) {
    case 'funnel': return funnel(conn, win);
    case 'pipeline': return pipeline(conn, win);
    case 'winloss': return winloss(conn, win);
    case 'timeinstage': return timeInStage(conn, win, now);
    case 'sourcetopaid': return sourceToPaid(conn, win);
    case 'reconciliation': return reconciliation(conn);
    default: return null;
  }
}

async function runAll(conn, win, now) {
  const out = [];
  for (const k of KEYS) out.push(await runReport(conn, k, win, now));
  return out;
}

// A cell that starts with = + - @ (or a tab or return) is prefixed so a spreadsheet never runs it as a formula. A negative number is left alone.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(report) {
  const lines = [report.table.header, ...report.table.rows].map(r => r.map(csvCell).join(','));
  // The definition and the window travel with the numbers, so a pasted sheet is never a bare table.
  return [csvCell(report.title), csvCell(`Window: ${report.windowLabel}`), csvCell(`How this is counted: ${report.definition}`), '', ...lines].join('\r\n') + '\r\n';
}

module.exports = { KEYS, DEAL_TYPES, runReport, runAll, toCsv, csvCell, windowSql, windowLabel, DEAL_REAL_SQL };
