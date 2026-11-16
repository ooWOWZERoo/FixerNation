// Sales CRM reports, second set (punch list G9; PRD FR-REP-02 and FR-OPP-07). Eight more read-only reports that follow the same hard rules as lib/crm-reports.js: one row per
// distinct deal, quote or purchase (EXISTS tests, never a join that fans out), money only from qualifying paid purchases, test addresses left out, no score and no
// hot / warm / cold wording, every report says what it counted and over which dates, and an input that is not there is unknown (null), never a zero.
// It is built with the first file's helpers (so the two cannot drift apart) and is reached only through lib/crm-reports.js.
const cls = require('./crm-classification');
const territories = require('./territories');
const growth = require('./crm-growth');
const { loadThresholds } = require('./crm-attention');

const KEYS = ['pipelinemix', 'forecast', 'velocity', 'quoteconversion', 'trialtopaid', 'procurement', 'coverage', 'renewals'];

module.exports = function build(h) {
  const { pct, dollars, num, days, round1, avg, median, windowSql, windowLabel, typeSql, typeLabel, DEAL_REAL_SQL, UNOWNED } = h;
  const TEST_BUYER = "LOWER(TRIM(c.email)) NOT LIKE '%@example.com'";
  const todayOf = (now) => (now instanceof Date ? now : new Date(now || Date.now())).toISOString().slice(0, 10);
  const label64 = (v) => String(v).replace(/\s+/g, ' ').trim().slice(0, 64);
  const AS_OF = 'As of today (the date window does not apply)';

  // ---- Pipeline by state, product, account type and source ---------------------------------------------------------------------------
  async function pipelinemix(conn, win) {
    const [rows] = await conn.query(
      `SELECT o.id, o.amount_cents, o.product_focus, o.source, a.state, a.account_type, COALESCE(o.probability_override, s.default_probability) AS prob
       FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id JOIN crm_accounts a ON a.id = o.account_id
       WHERE o.state = 'open' AND ${DEAL_REAL_SQL}${typeSql(win)}`);
    const by = (name, keyOf) => {
      const m = new Map();
      for (const r of rows) {
        const { key, label } = keyOf(r);
        const g = m.get(key) || { grouping: name, key, label, deals: 0, valued: 0, grossCents: 0, weightedCents: 0 };
        g.deals++;
        if (r.amount_cents !== null && r.amount_cents !== undefined) { g.valued++; g.grossCents += num(r.amount_cents); g.weightedCents += Math.round(num(r.amount_cents) * num(r.prob) / 100); }
        m.set(key, g);
      }
      return [...m.values()].sort((a, b) => b.grossCents - a.grossCents || b.deals - a.deals || a.label.localeCompare(b.label));
    };
    const free = (v, none) => { const t = v === null || v === undefined ? '' : label64(v); return t ? { key: t.toLowerCase(), label: t } : { key: '', label: none }; };
    const groups = {
      state: by('State', (r) => {
        const t = r.state === null || r.state === undefined ? '' : label64(r.state);
        if (!t) return { key: '', label: 'State not set' };
        const code = territories.matchStateLoose(t);
        return code ? { key: code, label: territories.stateName(code) } : { key: `?${t.toLowerCase()}`, label: `${t} (not a state we recognise)` };
      }),
      product: by('Product', (r) => free(r.product_focus, 'Product not set')),
      accountType: by('Account type', (r) => (r.account_type === 'district' ? { key: 'district', label: 'District' } : { key: 'school', label: 'School' })),
      source: by('Source', (r) => free(r.source, 'Source not set')),
    };
    const totals = { deals: rows.length, withoutValue: rows.filter(r => r.amount_cents === null || r.amount_cents === undefined).length };
    const line = (g) => [g.grouping, g.label, g.deals, g.valued, dollars(g.grossCents), dollars(g.weightedCents)];
    return {
      key: 'pipelinemix', title: 'Pipeline by state, product, account type and source', window: null, windowLabel: AS_OF + typeLabel(win),
      definition: 'Every open deal, as it is right now, shown four times: once grouped by the organization\'s State, once by the deal\'s Product, once by School or District, and once by the deal\'s Source. Each grouping adds up to the same open deals, so do not add the four sections together. Gross is the sum of deal values; weighted is each value times its probability. A deal with no value is counted but adds nothing. "Not set" means nobody filled that in; State matches PA or Pennsylvania in any case. Product and Source are the free text staff typed.',
      totals, groups,
      table: { header: ['Grouped by', 'Group', 'Deals', 'Deals with a value', 'Gross ($)', 'Weighted ($)'], rows: [...groups.state, ...groups.product, ...groups.accountType, ...groups.source].map(line) },
    };
  }

  // ---- Forecast by expected close period ---------------------------------------------------------------------------------------------
  async function forecast(conn, win, now) {
    const today = todayOf(now);
    const [rows] = await conn.query(
      `SELECT o.id, o.amount_cents, o.expected_close_date, COALESCE(o.probability_override, s.default_probability) AS prob
       FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open' AND ${DEAL_REAL_SQL}${typeSql(win)}`);
    const months = [];
    for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const nameOf = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
    const buckets = [{ key: 'passed', label: 'Expected date has passed', deals: [] }, ...months.map(m => ({ key: m, label: nameOf(m), deals: [] })), { key: 'later', label: 'More than 12 months away', deals: [] }, { key: 'none', label: 'No expected date', deals: [] }];
    const bucketOf = (r) => {
      const d = r.expected_close_date ? String(r.expected_close_date).slice(0, 10) : '';
      if (!d) return buckets[buckets.length - 1];
      if (d < today) return buckets[0];
      return buckets.find(b => b.key === d.slice(0, 7)) || buckets[buckets.length - 2];
    };
    for (const r of rows) bucketOf(r).deals.push(r);
    const sum = (ds, w) => ds.reduce((t, r) => (r.amount_cents === null || r.amount_cents === undefined ? t : t + (w ? Math.round(num(r.amount_cents) * num(r.prob) / 100) : num(r.amount_cents))), 0);
    const lines = buckets.map(b => ({ key: b.key, label: b.label, deals: b.deals.length, valued: b.deals.filter(r => r.amount_cents !== null && r.amount_cents !== undefined).length, grossCents: sum(b.deals, false), weightedCents: sum(b.deals, true) }));
    const all = rows;
    const valuedAll = all.filter(r => r.amount_cents !== null && r.amount_cents !== undefined);
    const totals = { deals: all.length, withoutValue: all.length - valuedAll.length, grossCents: sum(all, false), weightedCents: sum(all, true), averageOpenCents: valuedAll.length ? Math.round(sum(all, false) / valuedAll.length) : null };
    return {
      key: 'forecast', title: 'Forecast by expected close month', window: null, windowLabel: AS_OF + typeLabel(win),
      definition: 'Every open deal, put in the month of its expected close date (deals whose date has passed, deals more than 12 months out and deals with no date have their own lines). Gross is the sum of the deal values; weighted is each value times its probability. A deal with no value is counted and adds nothing; the average open deal size is the gross divided by the deals that have a value.',
      totals, lines,
      table: { header: ['Expected close', 'Deals', 'Deals with a value', 'Gross ($)', 'Weighted ($)'], rows: lines.map(l => [l.label, l.deals, l.valued, dollars(l.grossCents), dollars(l.weightedCents)]).concat([['All open deals', totals.deals, totals.deals - totals.withoutValue, dollars(totals.grossCents), dollars(totals.weightedCents)], ['Average open deal size ($)', '', '', dollars(totals.averageOpenCents), '']]) },
    };
  }

  // ---- Sale velocity ------------------------------------------------------------------------------------------------------------------
  async function velocity(conn, win) {
    const [open] = await conn.query(`SELECT o.amount_cents FROM crm_opportunities o WHERE o.state = 'open' AND o.amount_cents IS NOT NULL AND ${DEAL_REAL_SQL}${typeSql(win)}`);
    const w = windowSql('o.closed_at', win);
    const [closed] = await conn.query(`SELECT o.state, o.amount_cents, o.created_at, o.closed_at FROM crm_opportunities o WHERE o.state IN ('won', 'lost') AND o.closed_at IS NOT NULL AND ${DEAL_REAL_SQL}${typeSql(win)}${w.sql}`, w.params);
    const won = closed.filter(r => r.state === 'won'), lost = closed.filter(r => r.state === 'lost');
    const wonValued = won.filter(r => r.amount_cents !== null && r.amount_cents !== undefined);
    const cycle = won.map(r => days(r.created_at, r.closed_at)).filter(d => d !== null);
    const winRate = pct(won.length, won.length + lost.length);
    const avgWon = wonValued.length ? Math.round(wonValued.reduce((s, r) => s + num(r.amount_cents), 0) / wonValued.length) : null;
    const cycleDays = avg(cycle);
    const missing = [];
    if (!open.length) missing.push('there are no open deals with a value');
    if (winRate === null) missing.push('no deal was closed Won or Lost in these dates');
    if (avgWon === null) missing.push('no Won deal in these dates has a value');
    if (cycleDays === null || cycleDays <= 0) missing.push('there is no usable time-to-win');
    const perDay = missing.length ? null : Math.round((open.length * (winRate / 100) * avgWon) / cycleDays);
    const unknown = (v) => (v === null || v === undefined ? 'Unknown' : v);
    return {
      key: 'velocity', title: 'Sale velocity', window: win, windowLabel: windowLabel(win) + typeLabel(win),
      definition: 'Open deals with a value, times the win rate, times the average Won deal value, divided by the average days from creating a deal to winning it: roughly how many dollars of closed business the pipeline produces per day at the pace the closed deals set. The win rate, average Won value and days to win come from deals closed in the dates above; the open deal count is as of today. If any ingredient is missing the result is "Unknown" (with the reason), never a made-up number. It is a rule of thumb, not a promise.',
      inputs: { openDeals: open.length, winRate, won: won.length, lost: lost.length, averageWonCents: avgWon, averageDaysToWin: round1(cycleDays) },
      perDayCents: perDay, perThirtyDaysCents: perDay === null ? null : perDay * 30, unknownBecause: missing,
      table: { header: ['Ingredient or result', 'Value'], rows: [
        ['Open deals with a value (today)', open.length], ['Deals won in these dates', won.length], ['Deals lost in these dates', lost.length], ['Win rate (%)', unknown(winRate)],
        ['Average Won deal value ($)', avgWon === null ? 'Unknown' : dollars(avgWon)], ['Average days to win', cycleDays === null ? 'Unknown' : round1(cycleDays)],
        ['Sale velocity ($ per day)', perDay === null ? 'Unknown' : dollars(perDay)], ['Sale velocity ($ per 30 days)', perDay === null ? 'Unknown' : dollars(perDay * 30)],
      ].concat(missing.length ? [['Unknown because', missing.join('; ')]] : []) },
    };
  }

  // ---- Quote conversion ------------------------------------------------------------------------------------------------------------------
  async function quoteconversion(conn, win, now) {
    const today = todayOf(now);
    const w = windowSql('q.quote_sent_at', win);
    const [rows] = await conn.query(
      `SELECT q.id, q.quote_sent_at, q.accepted_at, q.quote_valid_until, q.status FROM quote_requests q
       WHERE q.quote_sent_at IS NOT NULL AND q.version_status = 'current' AND LOWER(TRIM(q.email)) NOT LIKE '%@example.com'${w.sql}`, w.params);
    // Paid means a qualifying paid purchase on that quote (the one Customer rule); an accepted quote with only a pending purchase order is accepted, not paid.
    const [paidRows] = await conn.query(`SELECT DISTINCT p.quote_id AS id ${cls.PURCHASES_FROM} WHERE p.quote_id IS NOT NULL AND ${cls.QUALIFYING_SQL}`);
    const paid = new Set(paidRows.map(r => Number(r.id)));
    const accepted = rows.filter(r => r.accepted_at);
    const paidN = accepted.filter(r => paid.has(Number(r.id))).length;
    const waiting = rows.filter(r => !r.accepted_at && (!r.quote_valid_until || String(r.quote_valid_until).slice(0, 10) >= today) && ['new', 'contacted'].includes(r.status)).length;
    const lapsed = rows.length - accepted.length - waiting;
    const dts = accepted.map(r => days(r.quote_sent_at, r.accepted_at)).filter(d => d !== null);
    const line = (label, n) => [label, n, pct(n, rows.length)];
    return {
      key: 'quoteconversion', title: 'Quote conversion', window: win, windowLabel: windowLabel(win),
      definition: 'Quotes whose latest send fell in these dates. A quote and its revisions count once (the newest one; a replaced quote can no longer be accepted). Accepted means the buyer accepted it; Paid means it also has a paid, non-trial purchase (a purchase order still waiting is accepted, not paid). Waiting is still open and not past its good-until date; the rest were closed or ran out. Whether anyone opened a quote is not part of this.',
      totals: { sent: rows.length, accepted: accepted.length, paid: paidN, waiting, lapsed, averageDaysToAccept: round1(avg(dts)), medianDaysToAccept: round1(median(dts)) },
      table: { header: ['Measure', 'Quotes', 'Share of quotes sent (%)'], rows: [['Quotes sent', rows.length, ''], line('Accepted', accepted.length), line('Accepted and paid', paidN), line('Still waiting', waiting), line('Closed or ran out', lapsed),
        ['Average days from sent to accepted', dts.length ? round1(avg(dts)) : 'Unknown', ''], ['Median days from sent to accepted', dts.length ? round1(median(dts)) : 'Unknown', '']] },
    };
  }

  // ---- Trial to paid -----------------------------------------------------------------------------------------------------------------------
  async function trialtopaid(conn, win, now) {
    const today = todayOf(now);
    const w = windowSql('p.purchased_at', win);
    const [trials] = await conn.query(
      `SELECT p.id, p.contact_id, p.school_id, p.purchased_at, p.trial_expiration_date ${cls.PURCHASES_FROM} JOIN newsletter_contacts c ON c.id = p.contact_id
       WHERE ${cls.TRIAL_LIKE_SQL} AND ${TEST_BUYER}${w.sql}`, w.params);
    const [paid] = await conn.query(`SELECT p.id, p.contact_id, p.school_id, p.purchased_at ${cls.PURCHASES_FROM} JOIN newsletter_contacts c ON c.id = p.contact_id WHERE ${cls.QUALIFYING_SQL} AND ${TEST_BUYER}`);
    // A trial converted when the same contact, or a purchase for the same school, later has a paid, non-trial purchase. The first one after the trial's start counts.
    const convertedAt = (t) => {
      let best = null;
      for (const p of paid) {
        if (String(p.purchased_at) < String(t.purchased_at)) continue;
        const same = Number(p.contact_id) === Number(t.contact_id) || (t.school_id && p.school_id && Number(p.school_id) === Number(t.school_id));
        if (same && (best === null || String(p.purchased_at) < String(best))) best = p.purchased_at;
      }
      return best;
    };
    const rows = trials.map(t => ({ t, at: convertedAt(t) }));
    const converted = rows.filter(r => r.at !== null);
    const open = rows.filter(r => r.at === null);
    const running = open.filter(r => r.t.trial_expiration_date && String(r.t.trial_expiration_date).slice(0, 10) >= today).length;
    const ended = open.length - running;
    const dts = converted.map(r => days(r.t.purchased_at, r.at)).filter(d => d !== null);
    return {
      key: 'trialtopaid', title: 'Trial to paid', window: win, windowLabel: windowLabel(win),
      definition: 'Trials that started in these dates (one row per trial). A trial counts as converted when the same person, or someone buying for the same school, has a paid, non-trial purchase on or after the day the trial started. Still running means no purchase yet and the trial has not ended; ended means no purchase and the trial is over. A trial with no end date counts as ended once it has no purchase. Counts only: nobody is named.',
      totals: { started: trials.length, converted: converted.length, stillRunning: running, endedWithoutBuying: ended, conversionRate: pct(converted.length, trials.length), averageDaysToBuy: round1(avg(dts)), medianDaysToBuy: round1(median(dts)) },
      table: { header: ['Measure', 'Trials', 'Share of trials started (%)'], rows: [['Trials started', trials.length, ''], ['Bought afterwards', converted.length, pct(converted.length, trials.length)], ['Still running, no purchase yet', running, pct(running, trials.length)], ['Ended without a purchase', ended, pct(ended, trials.length)],
        ['Average days from trial start to purchase', dts.length ? round1(avg(dts)) : 'Unknown', ''], ['Median days from trial start to purchase', dts.length ? round1(median(dts)) : 'Unknown', '']] },
    };
  }

  // ---- Procurement blockers ----------------------------------------------------------------------------------------------------------------
  async function procurement(conn, win, now) {
    const today = todayOf(now);
    const [items] = await conn.query(
      `SELECT i.label, i.due_on, i.opportunity_id FROM crm_opportunity_checklist_items i JOIN crm_opportunities o ON o.id = i.opportunity_id
       WHERE i.status = 'open' AND o.state = 'open' AND ${DEAL_REAL_SQL}${typeSql(win)}`);
    const by = new Map();
    for (const r of items) {
      const key = label64(r.label).toLowerCase();
      const g = by.get(key) || { label: label64(r.label), open: 0, overdue: 0, deals: new Set() };
      g.open++; if (r.due_on && String(r.due_on).slice(0, 10) < today) g.overdue++; g.deals.add(Number(r.opportunity_id));
      by.set(key, g);
    }
    const steps = [...by.values()].map(g => ({ label: g.label, open: g.open, overdue: g.overdue, deals: g.deals.size })).sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.label.localeCompare(b.label));
    const [[proc]] = await conn.query(`SELECT COUNT(*) AS n FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open' AND s.stage_key = 'procurement' AND ${DEAL_REAL_SQL}${typeSql(win)}`);
    const [[bare]] = await conn.query(
      `SELECT COUNT(*) AS n FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.state = 'open' AND s.stage_key = 'procurement' AND ${DEAL_REAL_SQL}${typeSql(win)}
         AND NOT EXISTS (SELECT 1 FROM crm_opportunity_checklist_items ci WHERE ci.opportunity_id = o.id)`);
    const totals = { openItems: items.length, overdueItems: steps.reduce((t, s) => t + s.overdue, 0), dealsInProcurementStage: Number(proc.n), procurementDealsWithoutChecklist: Number(bare.n) };
    return {
      key: 'procurement', title: 'Procurement blockers', window: null, windowLabel: AS_OF + typeLabel(win),
      definition: 'The procurement checklist steps still open on open deals, grouped by step name (most overdue first). Overdue means the step\'s due date has passed. "Deals" is how many different deals are waiting on that step. The last two lines count deals in the Procurement stage, and how many of them have no checklist at all (so nothing is tracking them).',
      totals, steps,
      table: { header: ['Step', 'Open items', 'Overdue', 'Deals waiting'], rows: steps.map(s => [s.label, s.open, s.overdue, s.deals]).concat([['(Open deals in the Procurement stage)', totals.dealsInProcurementStage, '', ''], ['(...of those with no checklist at all)', totals.procurementDealsWithoutChecklist, '', '']]) },
    };
  }

  // ---- Next-step and activity coverage -------------------------------------------------------------------------------------------------------
  async function coverage(conn, win, now) {
    const today = todayOf(now);
    const t = await loadThresholds(conn);
    const since = `${new Date(Date.parse(`${today}T00:00:00Z`) - t.quietDays * 86400000).toISOString().slice(0, 10)} 00:00:00`;
    const [rows] = await conn.query(
      `SELECT o.id, o.next_step, o.next_step_due_at, COALESCE(u.username, '${UNOWNED}') AS owner,
         (CASE WHEN EXISTS (SELECT 1 FROM crm_notes n WHERE n.opportunity_id = o.id AND n.created_at >= ?)
                 OR EXISTS (SELECT 1 FROM crm_tasks tk WHERE tk.opportunity_id = o.id AND tk.completed_at >= ?) THEN 1 ELSE 0 END) AS active
       FROM crm_opportunities o LEFT JOIN admin_users u ON u.id = o.owner_admin_id WHERE o.state = 'open' AND ${DEAL_REAL_SQL}${typeSql(win)}`, [since, since]);
    const nowStamp = `${today} 00:00:00`;
    const groups = new Map();
    const add = (name, r) => {
      const g = groups.get(name) || { owner: name, deals: 0, withNextStep: 0, overdue: 0, active: 0 };
      g.deals++;
      if (r.next_step && String(r.next_step).trim()) g.withNextStep++;
      if (r.next_step_due_at && String(r.next_step_due_at) < nowStamp) g.overdue++;
      if (Number(r.active)) g.active++;
      groups.set(name, g);
    };
    for (const r of rows) { add(r.owner, r); add('All owners', r); }
    const list = [...groups.values()].sort((a, b) => (a.owner === 'All owners') - (b.owner === 'All owners') || (a.owner === UNOWNED) - (b.owner === UNOWNED) || a.owner.localeCompare(b.owner));
    const view = list.map(g => ({ ...g, withNextStepPct: pct(g.withNextStep, g.deals), activePct: pct(g.active, g.deals) }));
    return {
      key: 'coverage', title: 'Next-step and activity coverage', window: null, windowLabel: AS_OF + typeLabel(win),
      definition: `For open deals, by owner: how many say what happens next, how many of those next steps are overdue, and how many had a note written or a task finished in the last ${t.quietDays} days (the "gone quiet" number on Hub Settings). It measures whether deals are being worked, not how good the work was. Deals nobody owns are listed under ${UNOWNED}.`,
      quietDays: t.quietDays, owners: view,
      table: { header: ['Owner', 'Open deals', 'With a next step (%)', 'Next step overdue', `Worked in the last ${t.quietDays} days (%)`], rows: view.map(g => [g.owner, g.deals, g.withNextStepPct, g.overdue, g.activePct]) },
    };
  }

  // ---- Renewals and expansions ----------------------------------------------------------------------------------------------------------------
  async function renewals(conn, win, now) {
    const today = todayOf(now);
    const w = windowSql('o.created_at', win);
    const [deals] = await conn.query(
      `SELECT o.opp_type, o.state, o.amount_cents, o.renewal_of_purchase_id FROM crm_opportunities o WHERE o.opp_type IN ('renewal', 'expansion') AND ${DEAL_REAL_SQL}${w.sql}`, w.params);
    const col = (type) => {
      const d = deals.filter(r => r.opp_type === type);
      const won = d.filter(r => r.state === 'won');
      return { created: d.length, open: d.filter(r => r.state === 'open').length, won: won.length, closedOther: d.filter(r => r.state === 'lost' || r.state === 'inactive').length,
        wonCents: won.reduce((t, r) => t + (r.amount_cents === null || r.amount_cents === undefined ? 0 : num(r.amount_cents)), 0), wonWithoutValue: won.filter(r => r.amount_cents === null || r.amount_cents === undefined).length, madeFromALicense: d.filter(r => r.renewal_of_purchase_id).length };
    };
    const ren = col('renewal'), exp = col('expansion');
    // Licenses: paid, non-trial group licenses whose end date falls in the window. Of those that have already ended, how many were followed by a later license (the generator's own rule).
    const lw = windowSql('p.expiration_date', win);
    let licenses = null;
    try {
      const [lic] = await conn.query(
        `SELECT p.id, p.school_id, p.school_domain, p.expiration_date ${cls.PURCHASES_FROM} JOIN newsletter_contacts c ON c.id = p.contact_id
         WHERE p.product_type = 'group_license' AND ${cls.QUALIFYING_SQL} AND ${TEST_BUYER} AND p.expiration_date IS NOT NULL${lw.sql}
           AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended') ORDER BY p.expiration_date, p.id LIMIT 2000`, lw.params);
      const ended = lic.filter(p => String(p.expiration_date).slice(0, 10) < today);
      let renewed = 0;
      for (const p of ended) if (await growth.alreadyRenewed(conn, p, await growth.resolveSchool(conn, p))) renewed++;
      licenses = { endedInWindow: ended.length, renewed, stillRunning: lic.length - ended.length, renewalRate: pct(renewed, ended.length) };
    } catch (err) {
      // An older install without license dates: the license half is unknown (null), the deal half still works.
      if (!(err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message))))) throw err;
    }
    const sums = (a, b) => [a, b];
    return {
      key: 'renewals', title: 'Renewals and expansions', window: win, windowLabel: windowLabel(win),
      definition: 'Two parts. First, the renewal and expansion deals created in these dates and where they stand (won value is the sum of the Won deals\' own values; a Won deal with no value adds nothing). Second, the paid, non-trial group licenses that ended in these dates and how many were followed by a later license for the same school (the same test the renewal generator uses: it must run well past the old one\'s end, so a short seat add-on does not count). Licenses that end in these dates but are still running are counted apart and left out of the rate. Deal type does not apply here.',
      renewal: ren, expansion: exp, licenses,
      table: { header: ['Measure', 'Renewals', 'Expansions'], rows: [
        ['Deals created in these dates', ...sums(ren.created, exp.created)], ['...still open', ...sums(ren.open, exp.open)], ['...won', ...sums(ren.won, exp.won)], ['...lost or set aside', ...sums(ren.closedOther, exp.closedOther)],
        ['Won value ($)', ...sums(dollars(ren.wonCents), dollars(exp.wonCents))], ['Won deals with no value', ...sums(ren.wonWithoutValue, exp.wonWithoutValue)], ['Made by the renewal generator from a license', ...sums(ren.madeFromALicense, exp.madeFromALicense)],
        ['Paid licenses that ended in these dates', licenses ? licenses.endedInWindow : 'Unknown', ''], ['...followed by a later license', licenses ? licenses.renewed : 'Unknown', ''],
        ['License renewal rate (%)', licenses && licenses.renewalRate !== null ? licenses.renewalRate : 'Unknown', ''], ['Paid licenses ending in these dates that are still running', licenses ? licenses.stillRunning : 'Unknown', ''],
      ] },
    };
  }

  return { KEYS, run: { pipelinemix, forecast, velocity, quoteconversion, trialtopaid, procurement, coverage, renewals } };
};
