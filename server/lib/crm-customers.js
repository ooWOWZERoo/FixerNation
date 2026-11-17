// Sales CRM punch list G11 (PRD section 17): the Customers & Renewals screen. Three READ-ONLY views over what the CRM already knows: renewals that are coming up (and which of them
// show plain signs of trouble), the expansion pipeline, and how onboarding is going on Won deals. Owner's answers, 2026-11-16: plain facts with reasons (never a score), open expansion
// deals plus well-used licenses, checklist progress per deal, every CRM role may read it.
//
// Rules this file keeps (each has a test):
//  - Nothing here writes anything. Every function takes `conn` and returns plain data.
//  - A license is on the renewal list only if it is a paid, non-trial group license (the one Customer rule, via lib/crm-growth.js sourcePurchases), ends within 120 days or ended in the
//    last 30, and has not already been renewed by a later license (growth.alreadyRenewed). A purchase by a test address (@example.com) is left out.
//  - "At risk" is a list of REASONS, each a fact the page can show: no open renewal deal; the renewal deal has no next step or its next step is overdue; fewer than half the seats are
//    registered (only when the seat count is known: unknown seat use is never a reason and never zero); a refund or dispute flag is waiting. No reasons means not flagged. No score,
//    no hot / warm / cold wording, and the customer-health score stays deferred (decision D9).
//  - Seats are counts only, never a teacher or student name. Money is a deal value or the last term's amount, shown to staff only.
//  - A source this server does not have yet (an older install) comes back as null, never as zero, and the page says so.
const growth = require('./crm-growth');
const cls = require('./crm-classification');
const OB = require('./crm-onboarding');

const LIST_LIMIT = 200;
const LOW_USE_PCT = 50;       // fewer than this share of seats registered is a reason
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
async function optional(fn) { try { return await fn(); } catch (err) { if (isMissing(err)) return null; throw err; } }
const day10 = (v) => String(v || '').slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${day10(b)}T12:00:00Z`) - Date.parse(`${day10(a)}T12:00:00Z`)) / 86400000);
const cents = (v) => (v === null || v === undefined ? null : Number(v));

// registered / total per purchase, from the seat table. total comes from the purchase; null when the purchase has no seat count (unknown, never zero).
async function seatCounts(conn, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const [rows] = await conn.query('SELECT purchase_id, COUNT(*) AS n FROM license_seats WHERE purchase_id IN (?) AND status = ? GROUP BY purchase_id', [ids, 'registered']);
  for (const r of rows) out.set(Number(r.purchase_id), Number(r.n));
  return out;
}
async function testBuyers(conn, contactIds) {
  if (!contactIds.length) return new Set();
  const [rows] = await conn.query("SELECT id FROM newsletter_contacts WHERE id IN (?) AND LOWER(TRIM(email)) LIKE '%@example.com'", [contactIds]);
  return new Set(rows.map(r => Number(r.id)));
}

// ---- 1. Renewals ------------------------------------------------------------------------------------------------------------------------------

async function renewals(conn, { today, now }) {
  const sources = await growth.sourcePurchases(conn, today);
  const test = await testBuyers(conn, [...new Set(sources.map(p => Number(p.contact_id)).filter(Boolean))]);
  const live = sources.filter(p => !test.has(Number(p.contact_id)));
  const seats = await seatCounts(conn, live.map(p => Number(p.id)));
  const [deals] = await conn.query(
    `SELECT o.id, o.name, o.account_id, o.renewal_of_purchase_id, o.next_step, o.next_step_due_at, o.owner_admin_id, ow.username AS owner_name, st.label AS stage_label
     FROM crm_opportunities o JOIN crm_pipeline_stages st ON st.id = o.stage_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     WHERE o.state = 'open' AND o.opp_type = 'renewal' ORDER BY o.id`);
  const byPurchase = new Map(), byAccount = new Map();
  for (const d of deals) {
    if (d.renewal_of_purchase_id && !byPurchase.has(Number(d.renewal_of_purchase_id))) byPurchase.set(Number(d.renewal_of_purchase_id), d);
    if (!byAccount.has(Number(d.account_id))) byAccount.set(Number(d.account_id), d);
  }
  const flagged = new Set();
  const flags = await optional(async () => (await conn.query("SELECT DISTINCT purchase_id FROM crm_purchase_refunds WHERE state = 'needs_review'"))[0]);
  for (const f of flags || []) flagged.add(Number(f.purchase_id));

  const rows = [];
  let alreadyRenewed = 0;
  for (const p of live) {
    const school = await growth.resolveSchool(conn, p);
    if (await growth.alreadyRenewed(conn, p, school)) { alreadyRenewed++; continue; }
    const account = await growth.resolveAccount(conn, school);
    const deal = byPurchase.get(Number(p.id)) || (account ? byAccount.get(Number(account.id)) : null) || null;
    const total = Number(p.seat_count) > 0 ? Number(p.seat_count) : null;
    const registered = total === null ? null : (seats.get(Number(p.id)) || 0);
    const reasons = [];
    if (!deal) reasons.push('No open renewal deal yet');
    else if (!deal.next_step || !String(deal.next_step).trim()) reasons.push('The renewal deal has no next step');
    else if (deal.next_step_due_at && String(deal.next_step_due_at) < now) reasons.push('The renewal deal’s next step is overdue');
    if (total !== null && registered * 100 < total * LOW_USE_PCT) reasons.push(`Fewer than half the seats are registered (${registered} of ${total})`);
    if (flagged.has(Number(p.id))) reasons.push('A refund or dispute flag is waiting for a decision');
    const left = daysBetween(today, p.expiration_date);
    rows.push({
      purchaseId: Number(p.id), school: p.school_domain || (school && school.domain) || null, accountId: account ? Number(account.id) : null, accountName: account ? account.name : null,
      endsOn: day10(p.expiration_date), daysLeft: left, endedDaysAgo: left < 0 ? -left : null, lastTermCents: cents(p.amount_cents),
      seatsRegistered: registered, seatsTotal: total,
      deal: deal ? { id: Number(deal.id), name: deal.name, stage: deal.stage_label, ownerName: deal.owner_name || null, nextStep: deal.next_step || null, nextStepDueAt: deal.next_step_due_at || null } : null,
      reasons, atRisk: reasons.length > 0,
    });
  }
  rows.sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || a.endsOn.localeCompare(b.endsOn) || a.purchaseId - b.purchaseId);
  return {
    total: rows.length, atRisk: rows.filter(r => r.atRisk).length, alreadyRenewedLeftOut: alreadyRenewed, windowDays: growth.LEAD_DAYS, lookbackDays: growth.LOOKBACK_DAYS,
    lowUsePercent: LOW_USE_PCT, rows: rows.slice(0, LIST_LIMIT), shown: Math.min(rows.length, LIST_LIMIT),
  };
}

// ---- 2. Expansion pipeline -------------------------------------------------------------------------------------------------------------------

async function expansion(conn, { today }) {
  const [deals] = await conn.query(
    `SELECT o.id, o.name, o.amount_cents, o.expected_close_date, o.account_id, a.name AS account_name, ow.username AS owner_name, st.label AS stage_label
     FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id JOIN crm_pipeline_stages st ON st.id = o.stage_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     WHERE o.state = 'open' AND o.opp_type = 'expansion'
       AND NOT EXISTS (SELECT 1 FROM crm_opportunity_contacts oc JOIN newsletter_contacts c ON c.id = oc.contact_id WHERE oc.opportunity_id = o.id AND LOWER(TRIM(c.email)) LIKE '%@example.com')
     ORDER BY o.expected_close_date IS NULL, o.expected_close_date, o.id LIMIT ${LIST_LIMIT}`);
  const valued = deals.filter(d => d.amount_cents !== null && d.amount_cents !== undefined);
  // Live paid group licenses where the seats are well used and nobody has an open expansion deal on the account yet.
  const [lic] = await conn.query(
    `SELECT p.id, p.contact_id, p.school_id, p.school_domain, p.seat_count, p.expiration_date ${cls.PURCHASES_FROM}
     WHERE p.product_type = 'group_license' AND ${cls.QUALIFYING_SQL} AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended')
       AND p.seat_count IS NOT NULL AND p.seat_count > 1 AND (p.expiration_date IS NULL OR p.expiration_date >= ?) ORDER BY p.id`, [today]);
  const test = await testBuyers(conn, [...new Set(lic.map(p => Number(p.contact_id)).filter(Boolean))]);
  const live = lic.filter(p => !test.has(Number(p.contact_id)));
  const seats = await seatCounts(conn, live.map(p => Number(p.id)));
  const openExp = new Set(deals.map(d => Number(d.account_id)));
  const well = [];
  for (const p of live) {
    const registered = seats.get(Number(p.id)) || 0;
    if (registered * 100 < Number(p.seat_count) * growth.EXPANSION_SEAT_PCT) continue;
    const school = await growth.resolveSchool(conn, p);
    const account = await growth.resolveAccount(conn, school);
    if (account && openExp.has(Number(account.id))) continue;
    well.push({ purchaseId: Number(p.id), school: p.school_domain || (school && school.domain) || null, accountId: account ? Number(account.id) : null, accountName: account ? account.name : null,
      seatsRegistered: registered, seatsTotal: Number(p.seat_count), endsOn: p.expiration_date ? day10(p.expiration_date) : null });
  }
  well.sort((a, b) => (b.seatsRegistered / b.seatsTotal) - (a.seatsRegistered / a.seatsTotal) || a.purchaseId - b.purchaseId);
  return {
    deals: deals.map(d => ({ id: Number(d.id), name: d.name, accountId: Number(d.account_id), accountName: d.account_name, stage: d.stage_label, ownerName: d.owner_name || null, amountCents: cents(d.amount_cents), expectedCloseDate: d.expected_close_date || null })),
    dealCount: deals.length, valueCents: valued.reduce((t, d) => t + Number(d.amount_cents), 0), withoutValue: deals.length - valued.length,
    wellUsed: well.slice(0, LIST_LIMIT), wellUsedCount: well.length, wellUsedPercent: growth.EXPANSION_SEAT_PCT,
  };
}

// ---- 3. Onboarding rollup -----------------------------------------------------------------------------------------------------------------------

async function onboarding(conn, { today, now }) {
  const [rows] = await conn.query(
    `SELECT s.opportunity_id AS id, o.name, a.name AS account_name, ow.username AS owner_name,
            COUNT(i.id) AS total, COALESCE(SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN i.status <> 'done' AND i.due_on IS NOT NULL AND i.due_on < ? THEN 1 ELSE 0 END), 0) AS overdue
     FROM crm_onboarding_started s JOIN crm_opportunities o ON o.id = s.opportunity_id JOIN crm_accounts a ON a.id = o.account_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     LEFT JOIN crm_opportunity_checklist_items i ON i.opportunity_id = o.id AND i.template_id IN (SELECT t.id FROM crm_procurement_templates t WHERE t.name = ?)
     GROUP BY s.opportunity_id, o.name, a.name, ow.username ORDER BY overdue DESC, (COUNT(i.id) - COALESCE(SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END), 0)) DESC, s.opportunity_id LIMIT ${LIST_LIMIT}`,
    [today, OB.TEMPLATE_NAME]);
  const deals = rows.map(r => ({ id: Number(r.id), name: r.name, accountName: r.account_name, ownerName: r.owner_name || null, total: Number(r.total), done: Number(r.done), overdue: Number(r.overdue) }));
  const sum = (k) => deals.reduce((t, d) => t + d[k], 0);
  // Won and paid deals with no checklist yet (the daily check has not started them, or the switch is off).
  const waiting = await optional(async () => (await OB.startOnboarding(conn, { apply: false, now })).wouldMake);
  const [[sw]] = await conn.query('SELECT setting_value FROM settings WHERE setting_key = ?', [OB.SWITCH]).catch(() => [[undefined]]);
  return { deals, dealCount: deals.length, steps: sum('total'), stepsDone: sum('done'), stepsOverdue: sum('overdue'), waitingForChecklist: waiting, switchOn: !!sw && sw.setting_value === 'true', template: OB.TEMPLATE_NAME };
}

// Everything the screen needs. A part this server cannot work out yet is null.
async function build(conn, { today, now }) {
  return {
    today,
    renewals: await optional(() => renewals(conn, { today, now })),
    expansion: await optional(() => expansion(conn, { today })),
    onboarding: await optional(() => onboarding(conn, { today, now })),
  };
}

module.exports = { build, renewals, expansion, onboarding, LOW_USE_PCT, LIST_LIMIT };
