// Sales CRM phase 6: the renewal and expansion generator (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec", feature 2).
//
// It finds PAID group licenses that are about to end and makes ONE deal for each, so a renewal is never missed and never made twice. It writes deals and nothing
// else: never a purchase, invoice, license, seat, quote, email or contact label (it does not even read crm_classification). A customer can hold a renewal deal and
// an expansion deal at once and stays a Customer, because Customer comes only from lib/crm-classification.js and a paid purchase.
//
// Which purchases count: the ONE Customer rule (QUALIFYING_SQL: paid, amount above zero, not a trial) and a group license. A purchase paid with a NULL or zero
// amount is never a source: it is counted ("amount unknown") so staff can confirm it on the review list, nothing more.
//
// Never twice: crm_opportunities.generated_key is UNIQUE ('crm.purchase.renewal_due:<purchaseId>' / 'crm.purchase.expansion_due:<purchaseId>'). A second or a
// concurrent run hits the key and counts "already made". Three more skips keep it out of a person's way: the license was already renewed (a later paid or pending
// non-trial group license at the same school), the school has no live CRM account (this never makes accounts), or the account already has an open deal of that type
// (or a renewal won in the last 90 days).
//
// Every function takes `conn` so the script and the tests choose the database. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters).
const cls = require('./crm-classification');
const { audit } = require('./audit');

// The thresholds are constants on purpose (no settings page): change them here, in one place, with a test.
const LEAD_DAYS = 120;            // a renewal deal appears this long before the license ends
const LOOKBACK_DAYS = 30;         // and is still made this long after, so a missed run or a late renewal is caught
const EXPANSION_SEAT_PCT = 90;    // an expansion deal also appears when this share of the seats is registered
const WON_GUARD_DAYS = 90;        // a renewal won this recently means the account is already being handled
const NEXT_STEP_DAYS = 7;

const RENEWAL_KEY = 'crm.purchase.renewal_due';
const EXPANSION_KEY = 'crm.purchase.expansion_due';
const keyFor = (type, purchaseId) => `${type === 'expansion' ? EXPANSION_KEY : RENEWAL_KEY}:${purchaseId}`;

const dayText = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day, n) => dayText(Date.parse(`${day}T12:00:00Z`) + n * 86400000);

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}

// Purchases that may start a deal today.
async function sourcePurchases(conn, today) {
  const [rows] = await conn.query(
    `SELECT p.id, p.contact_id, p.school_id, p.school_domain, p.amount_cents, p.seat_count, p.expiration_date, lp.name AS product_name
     ${cls.PURCHASES_FROM}
     WHERE p.product_type = 'group_license' AND ${cls.QUALIFYING_SQL}
       AND p.expiration_date IS NOT NULL AND p.expiration_date >= ? AND p.expiration_date <= ?
       AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended')
     ORDER BY p.expiration_date, p.id`, [addDays(today, -LOOKBACK_DAYS), addDays(today, LEAD_DAYS)]);
  return rows;
}

// Paid with no usable amount, expiring in the same window: never a source, only counted.
async function unknownAmountCount(conn, today) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n ${cls.PURCHASES_FROM}
     WHERE p.product_type = 'group_license' AND ${cls.NEEDS_REVIEW_SQL}
       AND p.expiration_date IS NOT NULL AND p.expiration_date >= ? AND p.expiration_date <= ?
       AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended')`, [addDays(today, -LOOKBACK_DAYS), addDays(today, LEAD_DAYS)]);
  return Number(r.n);
}

// A later group license at the same school (paid, or a PO still pending) means this one is already being renewed or has been.
async function alreadyRenewed(conn, p) {
  let where, params;
  if (p.school_id) { where = 'p.school_id = ?'; params = [p.school_id]; }
  else if (p.school_domain) { where = 'LOWER(p.school_domain) = LOWER(?)'; params = [p.school_domain]; }
  else return false;
  const [rows] = await conn.query(
    `SELECT p.id ${cls.PURCHASES_FROM}
     WHERE p.id <> ? AND p.product_type = 'group_license' AND p.payment_status IN ('paid', 'pending') AND NOT ${cls.TRIAL_LIKE_SQL}
       AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended')
       AND p.expiration_date IS NOT NULL AND p.expiration_date > ? AND ${where} LIMIT 1`, [p.id, p.expiration_date, ...params]);
  return rows.length > 0;
}

// Seats registered out of seats bought, counts only. null means unknown (no seat count on the purchase), never zero.
async function seatUse(conn, p) {
  const [rows] = await conn.query('SELECT status, COUNT(*) AS n FROM license_seats WHERE purchase_id = ? GROUP BY status', [p.id]);
  const by = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  const total = Number(p.seat_count) > 0 ? Number(p.seat_count) : null;
  if (total === null) return null;
  return { registered: by.registered || 0, total };
}

async function openDealOfType(conn, accountId, oppType) {
  const [rows] = await conn.query("SELECT id FROM crm_opportunities WHERE account_id = ? AND opp_type = ? AND state = 'open' LIMIT 1", [accountId, oppType]);
  return rows.length > 0;
}
async function recentlyWonRenewal(conn, accountId, today) {
  const [rows] = await conn.query("SELECT id FROM crm_opportunities WHERE account_id = ? AND opp_type = 'renewal' AND state = 'won' AND closed_at >= ? LIMIT 1", [accountId, `${addDays(today, -WON_GUARD_DAYS)} 00:00:00`]);
  return rows.length > 0;
}

async function makeDeal(conn, { type, p, account, stageId, seats, today, now }) {
  const key = keyFor(type, p.id);
  const renewal = type === 'renewal';
  const name = `${renewal ? 'Renewal' : 'Expansion'}: ${account.name}`.slice(0, 255);
  const nextStep = renewal
    ? `Check in about renewing (license ends ${p.expiration_date})`
    : `Talk about more seats (${seats.registered} of ${seats.total} in use)`;
  const due = `${addDays(today, NEXT_STEP_DAYS)} 12:00:00`;
  const source = renewal ? "Renewal due (value is last term's amount)" : 'Expansion signal (seats in use)';
  const amount = renewal && p.amount_cents !== null && p.amount_cents !== undefined ? Number(p.amount_cents) : null;
  const inTx = typeof conn.beginTransaction === 'function';
  if (inTx) await conn.beginTransaction();
  try {
    const [r] = await conn.query(
      `INSERT INTO crm_opportunities (account_id, name, owner_admin_id, stage_id, state, stage_entered_at, primary_contact_id, opp_type, amount_cents, source, product_focus,
         expected_close_date, next_step, next_step_due_at, renewal_of_purchase_id, generated_key)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [account.id, name, account.assigned_admin_id || null, stageId, now, p.contact_id, type, amount, source, p.product_name ? String(p.product_name).slice(0, 255) : null,
        p.expiration_date, nextStep, due, p.id, key]);
    const dealId = r.insertId;
    await conn.query(
      'INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, actor_admin_id, reason, created_at) VALUES (?, NULL, ?, NULL, ?, NULL, ?, ?)',
      [dealId, stageId, 'open', `Made by the ${renewal ? 'renewal' : 'expansion'} generator (license ends ${p.expiration_date})`, now]);
    if (p.contact_id) await conn.query("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'other')", [dealId, p.contact_id]);
    if (inTx) await conn.commit();
    await audit(conn, { actorType: 'system', action: 'crm_opportunity_created', entityType: 'crm_opportunity', entityId: dealId, newValue: { generated: key, accountId: account.id, type } });
    return { made: true, dealId };
  } catch (err) {
    if (inTx) { try { await conn.rollback(); } catch { /* the original error matters */ } }
    if (err && err.code === 'ER_DUP_ENTRY') return { made: false, reason: 'already_made' };
    throw err;
  }
}

// Runs the generator. apply=false changes nothing and says what it would do. Returns counts only (no names, no addresses).
async function runGrowth(conn, { apply = false, today = dayText(Date.now()), now = cls.sqlNow() } = {}) {
  const out = {
    sources: 0, amountUnknown: 0,
    renewal: { wouldMake: 0, made: 0 }, expansion: { wouldMake: 0, made: 0 },
    skipped: { alreadyMade: 0, alreadyRenewed: 0, noAccount: 0, openDeal: 0, wonRecently: 0, seatsUnknown: 0, belowSeatThreshold: 0 },
  };
  out.amountUnknown = await unknownAmountCount(conn, today);
  const sources = await sourcePurchases(conn, today);
  out.sources = sources.length;
  const [[stage]] = await conn.query("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'qualified'");
  if (!stage && sources.length) throw new Error('The pipeline stages are missing. Run the CRM setup script.');

  // A report-only run does not create deals, so it remembers which accounts it would have made one for, to say the same thing a real run would.
  const planned = { renewal: new Set(), expansion: new Set() };
  for (const p of sources) {
    if (await alreadyRenewed(conn, p)) { out.skipped.alreadyRenewed++; continue; }
    const [accts] = p.school_id ? await conn.query('SELECT id, name, assigned_admin_id FROM crm_accounts WHERE school_id = ? AND archived_at IS NULL', [p.school_id]) : [[]];
    const account = accts[0];
    if (!account) { out.skipped.noAccount++; continue; }

    // Renewal
    const [have] = await conn.query('SELECT id FROM crm_opportunities WHERE generated_key = ?', [keyFor('renewal', p.id)]);
    if (have.length) out.skipped.alreadyMade++;
    else if (planned.renewal.has(account.id) || await openDealOfType(conn, account.id, 'renewal')) out.skipped.openDeal++;
    else if (await recentlyWonRenewal(conn, account.id, today)) out.skipped.wonRecently++;
    else if (!apply) { out.renewal.wouldMake++; planned.renewal.add(account.id); }
    else {
      const r = await makeDeal(conn, { type: 'renewal', p, account, stageId: stage.id, today, now });
      if (r.made) out.renewal.made++; else out.skipped.alreadyMade++;
    }

    // Expansion: the seats are well used.
    const seats = await seatUse(conn, p);
    if (!seats) { out.skipped.seatsUnknown++; continue; }
    if (seats.registered * 100 < seats.total * EXPANSION_SEAT_PCT) { out.skipped.belowSeatThreshold++; continue; }
    const [haveX] = await conn.query('SELECT id FROM crm_opportunities WHERE generated_key = ?', [keyFor('expansion', p.id)]);
    if (haveX.length) out.skipped.alreadyMade++;
    else if (planned.expansion.has(account.id) || await openDealOfType(conn, account.id, 'expansion')) out.skipped.openDeal++;
    else if (!apply) { out.expansion.wouldMake++; planned.expansion.add(account.id); }
    else {
      const r = await makeDeal(conn, { type: 'expansion', p, account, stageId: stage.id, seats, today, now });
      if (r.made) out.expansion.made++; else out.skipped.alreadyMade++;
    }
  }
  return out;
}

module.exports = { runGrowth, sourcePurchases, keyFor, isMissing, LEAD_DAYS, LOOKBACK_DAYS, EXPANSION_SEAT_PCT, WON_GUARD_DAYS, NEXT_STEP_DAYS, RENEWAL_KEY, EXPANSION_KEY };
