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

// Writes the attribution onto an already-inserted purchase row. Called with
// the same connection/transaction that created the row, so a purchase is
// never briefly visible as attributed-but-uncommissioned.
//
// The commission is a snapshot: it's computed from the rate as it stands right
// now and never recomputed, matching amount_cents and license_duration_days.
// Raising someone's rate next month doesn't rewrite what they already earned.
//
// A purchase with no known amount (a manual admin entry, say) can still be
// attributed, but its commission stays NULL rather than being recorded as $0 —
// unknown and zero are different answers, and the admin UI shows the
// difference.
async function attributePurchase(conn, purchaseId, code, amountCents) {
  const affiliate = await resolveActiveAffiliate(code, conn);
  if (!affiliate) return null;

  const commission = commissionCents(amountCents, affiliate.commission_rate);
  await conn.query(
    'UPDATE purchases SET affiliate_id = ?, affiliate_commission_cents = ? WHERE id = ?',
    [affiliate.id, commission, purchaseId]
  );
  return { affiliateId: affiliate.id, commissionCents: commission };
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
};
