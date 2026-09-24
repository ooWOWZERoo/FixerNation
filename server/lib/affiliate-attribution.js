// Stage 3 of the sales-affiliate program — crediting a sale to an affiliate.
// Design and confirmed decisions: docs/AFFILIATE_PROGRAM_SPIKE.md.
//
// The model is 90-day last-touch on a referral code. referral.js writes the
// code into the fn_ref cookie on any page load carrying ?ref=CODE, and because
// that cookie is a normal same-origin cookie it rides along on every /api call
// the browser makes afterwards — so a checkout request already carries it and
// nothing has to be threaded through the page's own JavaScript.
//
// The one path where that isn't true is the Stripe webhook: it's a request from
// Stripe, not from the buyer's browser, so there is no cookie on it at all.
// For card checkouts the code is stashed in the Stripe session's metadata at
// session-creation time (where the cookie IS present) and read back out in the
// webhook. Attribution for every path ultimately lands in one place,
// createPurchase() in routes/newsletter.js, which calls attributePurchase()
// inside its own transaction.
const pool = require('../db/pool');

const REF_COOKIE = 'fn_ref';
const REF_WINDOW_DAYS = 90;

// Same shape the admin UI and the approve endpoint enforce on a code.
const CODE_RE = /^[A-Z0-9-]{4,32}$/;

function normalizeCode(raw) {
  if (!raw) return null;
  const code = String(raw).trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

// Reads the referral code off a browser request. Returns null for anything
// that isn't a well-formed code, so a junk or hand-edited cookie is simply
// ignored rather than turning into a failed lookup later.
function refCodeFromRequest(req) {
  if (!req || !req.cookies) return null;
  return normalizeCode(req.cookies[REF_COOKIE]);
}

// The referral code belonging to an affiliate id, used to carry attribution
// from one purchase to a follow-on purchase (a trial converting to an annual
// license). Deliberately returns the code rather than the affiliate itself, so
// the follow-on sale goes back through the same resolve-and-check path as any
// other — including the check that the affiliate is still active, since a
// suspended affiliate shouldn't keep earning on new sales.
async function codeForAffiliateId(affiliateId, conn = pool) {
  if (!affiliateId) return null;
  const [[row]] = await conn.query('SELECT referral_code FROM affiliates WHERE id = ? LIMIT 1', [affiliateId]);
  return row ? row.referral_code : null;
}

async function resolveActiveAffiliate(code, conn = pool) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const [[affiliate]] = await conn.query(
    "SELECT id, commission_rate FROM affiliates WHERE referral_code = ? AND status = 'active' LIMIT 1",
    [normalized]
  );
  return affiliate || null;
}

// A suspended affiliate's code earns nothing, and an unknown code earns
// nothing — neither is an error, the sale just goes unattributed.
function commissionCents(amountCents, commissionRate) {
  const amount = Number(amountCents);
  const rate = Number(commissionRate);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amount * rate) / 100);
}

// Writes the attribution onto an already-inserted purchase row and opens the
// ledger entry for it. Called with the same connection/transaction that created
// the row, so a purchase is never briefly visible as
// attributed-but-uncommissioned.
//
// The commission is a snapshot: it's computed from the rate as it stands right
// now and never recomputed, matching amount_cents and license_duration_days.
// Raising someone's rate next month doesn't rewrite what they already earned.
//
// A purchase with no known amount (a manual admin entry, say) can still be
// attributed, but its commission stays NULL rather than being recorded as $0 —
// unknown and zero are different answers, and the admin UI shows the
// difference. No ledger row is opened in that case either; there's no figure
// to owe anyone.
//
// The ledger row's starting status follows the money, per the confirmed
// decision in docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md: a card sale is
// already paid by the time the webhook fires, so it opens 'approved'; a PO
// sale opens 'pending' and is approved when an admin marks the invoice paid.
// This is the whole point of the ledger — before it existed, a PO order
// recorded commission on money that had not arrived and might never.
async function attributePurchase(conn, purchaseId, code, amountCents, paymentStatus) {
  const affiliate = await resolveActiveAffiliate(code, conn);
  if (!affiliate) return null;

  const commission = commissionCents(amountCents, affiliate.commission_rate);
  await conn.query(
    'UPDATE purchases SET affiliate_id = ?, affiliate_commission_cents = ? WHERE id = ?',
    [affiliate.id, commission, purchaseId]
  );

  let status = null;
  if (commission !== null) {
    status = paymentStatus === 'paid' ? 'approved' : 'pending';
    await conn.query(
      `INSERT INTO affiliate_commissions
         (affiliate_id, purchase_id, status, source_type, gross_amount_cents, commission_rate, commission_cents, approved_at)
       VALUES (?, ?, ?, 'referral', ?, ?, ?, ?)`,
      [
        affiliate.id, purchaseId, status,
        amountCents, affiliate.commission_rate, commission,
        status === 'approved' ? new Date() : null,
      ]
    );
  }

  return { affiliateId: affiliate.id, commissionCents: commission, ledgerStatus: status };
}

// ---------------------------------------------------------------------------
// Ledger reads
// ---------------------------------------------------------------------------

// Every balance is filtered by status — a bare SUM() over the table would mix
// reversed entries back into what's owed. This is the single place that rule
// is expressed; no route computes a total inline. See the bookkeeping rule in
// docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md.
const LEDGER_TOTALS_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN status = 'pending'  THEN commission_cents END), 0) AS pending_cents,
    COALESCE(SUM(CASE WHEN status = 'approved' THEN commission_cents END), 0) AS approved_cents,
    COALESCE(SUM(CASE WHEN status = 'paid'     THEN commission_cents END), 0) AS paid_cents,
    COALESCE(SUM(CASE WHEN status = 'on_hold'  THEN commission_cents END), 0) AS on_hold_cents,
    COALESCE(SUM(CASE WHEN status = 'reversed' THEN commission_cents END), 0) AS reversed_cents,
    COUNT(*) AS entry_count
  FROM affiliate_commissions
`;

async function ledgerTotals(affiliateId, conn = pool) {
  const [[row]] = await conn.query(`${LEDGER_TOTALS_SQL} WHERE affiliate_id = ?`, [affiliateId]);
  return row;
}

// ---------------------------------------------------------------------------
// Settlement — driven by what happens to the invoice, not by the purchase's
// payment_status. Cancelling an invoice sets purchases.payment_status back to
// 'pending' (see routes/invoices.js), which makes a cancellation look exactly
// like an unpaid PO. Reading the invoice transition instead is the only way to
// tell "not paid yet" apart from "never going to be paid".
// ---------------------------------------------------------------------------

const NON_TERMINAL = ['pending', 'approved', 'on_hold'];

// Invoice marked paid → the money is real, so everything still waiting on it
// becomes payable. Already-approved or already-paid rows are left alone, which
// makes this safe to call again on a re-save of the same status.
async function approveForInvoice(conn, invoiceId, adminId) {
  const [result] = await conn.query(
    `UPDATE affiliate_commissions ac
       JOIN purchases p ON p.id = ac.purchase_id
        SET ac.status = 'approved', ac.approved_at = NOW(), ac.approved_by_admin_id = ?
      WHERE p.invoice_id = ? AND ac.status IN ('pending', 'on_hold')`,
    [adminId || null, invoiceId]
  );
  return result.affectedRows;
}

// Invoice cancelled → claw back what hasn't been paid out.
//
// A commission already marked 'paid' is deliberately NOT touched: that money
// has left the building and needs a conversation, not a silent adjustment. The
// count comes back so the caller can surface it instead of losing it.
async function reverseForInvoice(conn, invoiceId, adminId, reason) {
  const [[{ paid_count: paidCount }]] = await conn.query(
    `SELECT COUNT(*) AS paid_count
       FROM affiliate_commissions ac
       JOIN purchases p ON p.id = ac.purchase_id
      WHERE p.invoice_id = ? AND ac.status = 'paid'`,
    [invoiceId]
  );

  const [result] = await conn.query(
    `UPDATE affiliate_commissions ac
       JOIN purchases p ON p.id = ac.purchase_id
        SET ac.status = 'reversed', ac.reversed_at = NOW(),
            ac.reversed_by_admin_id = ?, ac.reversal_reason = ?
      WHERE p.invoice_id = ? AND ac.status IN (${NON_TERMINAL.map(() => '?').join(', ')})`,
    [adminId || null, reason || 'Invoice cancelled', invoiceId, ...NON_TERMINAL]
  );

  return { reversed: result.affectedRows, alreadyPaid: Number(paidCount) };
}

module.exports = {
  REF_COOKIE,
  REF_WINDOW_DAYS,
  normalizeCode,
  refCodeFromRequest,
  codeForAffiliateId,
  resolveActiveAffiliate,
  commissionCents,
  attributePurchase,
  ledgerTotals,
  approveForInvoice,
  reverseForInvoice,
  LEDGER_TOTALS_SQL,
  NON_TERMINAL,
};
